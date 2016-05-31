import koa from "koa";
import session from "koa-session";
import route from "koa-route";
import bodyParser from "koa-bodyparser";
import koaStatic from "koa-static";
import koaStylus from "koa-stylus";
import Pug from "koa-pug";
import Twit from "twit";
import _ from "lodash";

import passport from "koa-passport";
import TwitterStrategy from "passport-twitter";

import config from "./config";

const SEARCH_QUERY = "#ごちうさ版深夜の真剣お絵描き60分一本勝負 -filter:retweets";

const selectTweetWithIllust = tweets => {
    // _.each(tweets, tweet => console.log(tweet))
    return _(tweets)
        .filter(tweet => tweet.entities.media && _.some(tweet.entities.media, media => media.type === "photo"))
        .filter(tweet => !tweet.retweeted_status)
        .map(tweet => {
            return {
                id      : tweet.id_str,
                url     : `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`,
                user    : tweet.user,
                media   : _.filter(tweet.entities.media, media => media.type === "photo")[0]
            }
        })
        .value();
};


//-- Twitter clients
const t = new Twit({
    consumer_key: config.twitter.consumer_key,
    consumer_secret: config.twitter.consumer_secret,
    access_token: config.twitter.access_token,
    access_token_secret: config.twitter.access_token_secret,
});

passport.use(new TwitterStrategy({
    consumerKey: config.twitter.consumer_key,
    consumerSecret: config.twitter.consumer_secret,
    callbackURL: "http://localhost:8000/auth/twitter/callback"
}, (token, tokenSecret, profile, cb) => {
    cb();
}));


//-- App
const app = koa();

const pug = new Pug({
    viewPath: __dirname + "/views",
    debug: false,
    pretty: false,
    compileDebug: false,
});

app.use(bodyParser());

app.keys = ["secret"];
app.use(session(app))

app.use(passport.initialize());
app.use(passport.session());

// app.use(koaStylus({
//     src: __dirname + "/../static/",
//     force: true,
//     serve: false,
// }));

app.use(koaStatic(__dirname + "/../static/"));

app.use(pug.middleware);

app.use(function* (next) {
    if (this.session.twitter) {
        this.twit = new Twit({
            consumer_key: config.twitter.consumer_key,
            consumer_secret: config.twitter.consumer_secret,
            access_token: this.session.twitter.access_token,
            access_token_secret: this.session.twitter.access_token_secret,
        });
    }

    yield* next;
})


//-- Routes
app.use(route.get("/", function* () {
    const tweets = (yield t.get("search/tweets", {
        q: SEARCH_QUERY,
        result_type: "recent",
        count: 100
    })).data.statuses;

    this.render("index", {tweets: selectTweetWithIllust(tweets)}, true);
}));

app.use(route.get("/api/index", function* (next) {
    const tweets = (yield t.get("search/tweets", {
        q: SEARCH_QUERY,
        max_id : this.query.lastStatusId,
        result_type: "recent",
        count: 100
    })).data.statuses;

    console.log(this.query.lastStatusId);

    this.render("tweets", {tweets: selectTweetWithIllust(tweets)})
}));


app.use(route.get("/auth/twitter", passport.authenticate("twitter")));

app.use(route.get("/auth/twitter/callback", passport.authenticate("twitter", {
    successRedirect: "/",
    failureRedirect: "/"
})));


app.listen(process.env.PORT);
