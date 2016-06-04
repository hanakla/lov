const _ = require("lodash");
_.mixin(require("lodash-deep"));

const koa = require("koa");
const session = require("koa-generic-session");
const MongoStore = require("koa-generic-session-mongo");
const route = require("koa-route");
const bodyParser = require("koa-bodyparser");
const koaStatic = require("koa-static");
const koaStylus = require("koa-stylus");
const Pug = require("koa-pug");
const passport = require("koa-passport");
const TwitterStrategy = require("passport-twitter");

const {MongoClient, Long} = require("mongodb");

const Twit = require("twit");

const config = require("./config");

const MONGO_SORT_ASC = 1;
const MONGO_SORT_DESC = -1;

const SEARCH_QUERY = config.twitter.query;

const selectTweetWithIllust = tweets => {
    // _.each(tweets, tweet => console.log(tweet))
    return _(tweets)
        .filter(tweet => tweet.entities.media && _.some(tweet.entities.media, media => media.type === "photo"))
        .map(tweet => {
            return {
                id      : tweet.id_str,
                text    : tweet.text,
                url     : `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`,
                user    : tweet.user,
                media   : _.filter(tweet.entities.media, media => media.type === "photo")[0],
                favorited : tweet.favorited,
                retweeted : tweet.retweeted,
            }
        })
        .value();
};

(async () => {
    //-- MongoClient
    const db = await MongoClient.connect("mongodb://localhost:27017/gochiusa-lov");

    //-- Twitter clients
    const globalTwit = new Twit({
        consumer_key: config.twitter.consumer_key,
        consumer_secret: config.twitter.consumer_secret,
        access_token: config.twitter.access_token,
        access_token_secret: config.twitter.access_token_secret,
    });

    //-- passport
    passport.serializeUser((user, done) => { done(null, user); });
    passport.deserializeUser((user, done) => { done(null, user); });

    passport.use(new TwitterStrategy({
        consumerKey: config.twitter.consumer_key,
        consumerSecret: config.twitter.consumer_secret,
        callbackURL: "http://localhost:8000/auth/twitter/callback"
    }, (token, tokenSecret, profile, cb) => {
        cb(null, {twitter: {token, tokenSecret}});
    }));


    //-- App
    const app = koa();

    const pug = new Pug({
        viewPath: __dirname + "/views",
        debug: false,
        pretty: false,
        compileDebug: false,
    });

    app.keys = ["secret"];
    app.use(session({
        store: new MongoStore({
            // host: "localhost",
            // port: 27017,
            // db: "gochiusa-lov",
            db,
            ttl: 60 * 60 * 24 * 60,
            collection: "sessions",
            cookie: {
                maxage: 60 * 60 * 24 * 60,
            }
        })
    }));

    app.use(bodyParser());

    app.use(passport.initialize());
    app.use(passport.session());

    app.use(koaStatic(__dirname + "/../build/"));

    app.use(pug.middleware);

    app.use(function* (next) {
        if (this.session.twitterAuth) {
            this.twit = new Twit({
                consumer_key: config.twitter.consumer_key,
                consumer_secret: config.twitter.consumer_secret,
                access_token: this.session.passport.user.twitter.token,
                access_token_secret: this.session.passport.user.twitter.tokenSecret,
            });
        } else {
            this.twit = globalTwit;
        }

        yield* next;
    })


    //-- Routes
    app.use(route.get("/session", function* () {
        // console.log(this.session);
        this.body = this.session;
    }));

    app.use(route.get("/session/clear", function* () {
        this.session = null;
        this.body = "done";
    }));

    app.use(route.get("/", function* () {
        const cachedTweets = db.collection("tweets_cache");
        const tweets = yield cachedTweets.find({}).sort({_id: MONGO_SORT_DESC}).limit(100).toArray();

        const oldestTweet = tweets[tweets.length - 1];

        this.render("index", {
            tweets: selectTweetWithIllust(tweets),
            lastStatusId: oldestTweet ? oldestTweet.id_str : null,
            isTwitterAuthenticated: !!this.session.twitterAuth,
        }, true);
    }));

    app.use(route.get("/api/index", function* (next) {
        const cachedTweets = db.collection("tweets_cache");
        const tweets = yield cachedTweets.find({
            _id: {
                $lt: Long.fromString(this.query.lastStatusId)
            }
        })
        .sort({_id: MONGO_SORT_DESC})
        .limit(100)
        .toArray();

        const oldestTweet = tweets[tweets.length - 1];

        this.render("tweets", {
            tweets: selectTweetWithIllust(tweets),
            isTwitterAuthenticated: !!this.session.twitterAuth,
        });

        this.type = "application/json";
        this.body = {
            available: tweets.length !== 0,
            list: this.body,
            lastStatusId: oldestTweet ? oldestTweet.id_str : this.query.lastStatusId,
        }
    }));

    ////-- twitter
    app.use(route.get("/auth/twitter", passport.authenticate("twitter")));

    app.use(route.get("/auth/twitter/callback", passport.authenticate("twitter", {
        successRedirect: "/auth/twitter/success",
        failureRedirect: "/auth/failure"
    })));

    app.use(route.get("/auth/twitter/success", function* () {
        this.session.twitterAuth = this.session.passport.user.twitter;
        this.redirect("/");
    }));

    app.use(route.get("/auth/failure", function* () {
        this.render("auth/failure");
    }));


    console.log(`\u001b[32mServer listening on ${process.env.PORT}\u001b[m`);
    app.listen(process.env.PORT);
})();
