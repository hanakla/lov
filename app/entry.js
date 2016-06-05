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
    const db = await MongoClient.connect(config.mongo.url);

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

    app.keys = config.session.keys;
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
        this.set("X-UA-Compatible", "IE=edge");
        yield* next;
    });

    app.use(function* (next) {
        if (this.session.twitterAuth) {
            this.twit = new Twit({
                consumer_key: config.twitter.consumer_key,
                consumer_secret: config.twitter.consumer_secret,
                access_token: this.session.twitterAuth.token,
                access_token_secret: this.session.twitterAuth.tokenSecret,
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
        var tweets = yield cachedTweets.find({}).sort({_id: MONGO_SORT_DESC}).limit(40).toArray();

        if (this.session.twitterAuth) {
            tweets = (yield this.twit.get("statuses/lookup", {id: _.map(tweets, "_id").join(",")})).data;
            tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        }

        const oldestTweet = tweets[tweets.length - 1];

        this.render("index", {
            tweets: selectTweetWithIllust(tweets),
            lastStatusId: oldestTweet ? oldestTweet.id_str : null,
            isTwitterAuthenticated: !!this.session.twitterAuth,
        }, true);
    }));

    //-- Local API
    app.use(route.get("/api/index", function* () {
        const cachedTweets = db.collection("tweets_cache");
        var tweets = yield cachedTweets.find({
            _id: {
                $lt: Long.fromString(this.query.lastStatusId)
            }
        })
        .sort({_id: MONGO_SORT_DESC})
        .limit(40)
        .toArray();

        if (this.session.twitterAuth) {
            tweets = (yield this.twit.get("statuses/lookup", {id: _.map(tweets, "_id").join(",")})).data;
        }

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

    app.use(route.post("/api/fav/:statusId", function* (statusId) {
        if (! this.session.twitterAuth) {
            this.body = {success: false, reason: "You are not logged in Twitter."};
            return;
        }

        const res = (yield this.twit.post("favorites/create", {id: statusId})).data;

        if (res.errors) {
            if (res.errors[0].code !== 139) { // 139: Already favorited
                this.body = {success: false, reason: res.errors[0].message};
                return;
            }
        }

        this.body = {success: true};
    }));

    app.use(route.delete("/api/fav/:statusId", function* (statusId) {
        if (! this.session.twitterAuth) {
            this.body = {success: false, reason: "You are not logged in Twitter."};
            return;
        }

        const res = (yield this.twit.post("favorites/destroy", {id: statusId})).data;

        if (res.errors) {
            this.body = {success: false, reason: res.errors[0].message};
            return;
        }

        this.body = {success: true};
    }));

    // app.use(route.post("/api/retweet/:statusId", function* (statusId) {
    //     if (! this.session.twitterAuth) {
    //         this.body = {success: false, reason: "You are not logged in Twitter."};
    //         return;
    //     }
    //
    //     const res = (yield this.twit.post("favorites/create", {id: statusId})).data;
    //
    //     if (res.errors) {
    //         if (res.errors[0].code !== 139) { // 139: Already favorited
    //             this.body = {success: false, reason: res.errors[0].message};
    //             return;
    //         }
    //     }
    //
    //     this.body = {success: true};
    // }));
    //
    // app.use(route.delete("/api/retweet/:statusId", function* (statusId) {
    //     if (! this.session.twitterAuth) {
    //         this.body = {success: false, reason: "You are not logged in Twitter."};
    //         return;
    //     }
    //
    //     const res = (yield this.twit.post("favorites/destroy", {id: statusId})).data;
    //
    //     if (res.errors) {
    //         this.body = {success: false, reason: res.errors[0].message};
    //         return;
    //     }
    //
    //     this.body = {success: true};
    // }));

    ////-- twitter
    app.use(route.get("/auth/disconnect", function* () {
        if (this.session && this.session.twitterAuth) {
            delete this.session.twitterAuth;
            delete this.session.passport.user.twitter;
        }

        this.redirect("/");
    }));

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
