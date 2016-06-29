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
const MixPanel = require("mixpanel");
const uuid = require("uuid");

const {MongoClient, Long} = require("mongodb");
const moment = require("moment");

const Twit = require("twit");

const config = require("./config");

const MONGO_SORT_ASC = 1;
const MONGO_SORT_DESC = -1;

const SEARCH_QUERY = config.twitter.query;

const BLACKLISTED_STATUS_IDS = [
    // Pasted retweets
    "744762639180570624",

    // INM
    "748084432855138304",
    "748073477488381956",
].map(Long.fromString);

const selectTweetWithIllust = tweets => {
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
    const mixpanel = MixPanel.init(config.mixpanel.token);
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
            db,
            collection: "sessions",
        }),
        cookie: {
            maxAge: 1000 * 60 * 60 * 24 * 90, // 90days
        },
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
        if (! this.session.mixpanel_tracking_id) {
            this.session.mixpanel_tracking_id = uuid.v4();
        }

        // update maxAge
        this.cookies.set("koa.sid", this.cookies.get("koa.sid"), {
            maxAge : 1000 * 60 * 60 * 24 * 90, // 90days
        });

        this.cookies.set("mixpanel_tracking_id", this.session.mixpanel_tracking_id, {httpOnly: false});

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
    app.use(route.get("/", function* () {
        // Fetch previous/current post available dates
        const postAvailableDates = (yield db.collection("post_available_dates").find({}, {string: true}).sort({_id: MONGO_SORT_DESC}).limit(2).toArray())
        postAvailableDates.forEach(date => {
            delete date._id;
            date.url = "/archives/" + date.string.replace(/-/g, "/")
        });

        var tweets = yield db.collection("tweets_cache")
            .find({_id: {$nin: BLACKLISTED_STATUS_IDS}})
            .sort({_id: MONGO_SORT_DESC}).limit(40).toArray();

        if (this.session.twitterAuth) {
            tweets = (yield this.twit.get("statuses/lookup", {id: _.map(tweets, "_id").join(",")})).data;
            tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        const oldestTweet = tweets[tweets.length - 1];

        this.render("index", {
            tweets: selectTweetWithIllust(tweets),
            isTwitterAuthenticated: !!this.session.twitterAuth,
            doNotTrack: this.session.dnt,
            searchStatus: {
                lastStatusId: oldestTweet ? oldestTweet.id_str : null,
                date: {
                    older: postAvailableDates[1],
                    // current: postAvailableDates[0].string,
                }
            },
            searchStatusString: JSON.stringify({
                lastStatusId: oldestTweet ? oldestTweet.id_str : null,
                date: {
                    older: postAvailableDates[1],
                }
            })
        }, true);
    }));

    app.use(route.get("/archives/:year/:month/:day", function* (year, month, day) {
        const dateString = `${year}-${month}-${day}`;
        const pickDate = moment(dateString, "YYYY-MM-DD");

        if (! /^([1-2][0-9]{3})-([01][0-9])-([0-3][0-9])$/.test(dateString) || ! pickDate.isValid()) {
            this.render("index", {error: "Invalid date format"}, true);
            return;
        }

        // Check target date posts availability
        const dateInfo = (yield db.collection("post_available_dates").find({
            year_str: pickDate.format("YYYY"),
            month_str: pickDate.format("MM"),
            day_str: pickDate.format("DD"),
        }).toArray())[0];

        if (! dateInfo) {
            this.render("index", {
                tweets: [],
                doNotTrack: this.session.dnt,
            });
            return;
        }

        // Fetch previous/next post available dates
        const prevNextPostAvailableDates = (yield db.collection("post_available_dates").find({
            $or: [{_id: dateInfo._id - 1}, {_id: dateInfo._id + 1}]
        }, {
            string: true
        }).toArray())

        prevNextPostAvailableDates.forEach(date => {
            delete date._id;
            date.url = "/archives/" + date.string.replace(/-/g, "/")
        });

        var tweets = yield db.collection("tweets_cache").find({
            _id: {
                $nin: BLACKLISTED_STATUS_IDS
            },
            created_at: {
                $gte: new Date(dateInfo.begin_unixtime),
                $lte: new Date(dateInfo.end_unixtime),
            }
        }).toArray();

        if (this.session.twitterAuth) {
            tweets = (yield this.twit.get("statuses/lookup", {id: _.map(tweets, "_id").join(",")})).data;
            tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        const oldestTweet = tweets[tweets.length - 1];

        this.render("index", {
            date: pickDate.format("YYYY-MM-DD"),
            tweets: selectTweetWithIllust(tweets),
            isTwitterAuthenticated: !!this.session.twitterAuth,
            doNotTrack: this.session.dnt,
            searchStatus: {
                lastStatusId: oldestTweet ? oldestTweet.id_str : null,
                date: {
                    older: prevNextPostAvailableDates[0],
                    current: pickDate.format("YYYY-MM-DD"),
                    newer: prevNextPostAvailableDates[1],
                }
            },
            searchStatusString: JSON.stringify({
                lastStatusId: oldestTweet ? oldestTweet.id_str : null,
                date: {
                    older: prevNextPostAvailableDates[0],
                    current: pickDate.format("YYYY-MM-DD"),
                    newer: prevNextPostAvailableDates[1],
                }
            })
        }, true);

        process.nextTick(() => {
            if (this.session.dnt) return;

            mixpanel.track("access:archive", {
                distinct_id: this.session.mixpanel_tracking_id,
                date: pickDate.format("YYYY-MM-DD"),
            });
        });
    }));

    app.use(route.get("/dnt", function* () {
        this.session.dnt = true;
        this.redirect("/");
    }))

    //-- Local API
    app.use(route.get("/api/index", function* () {
        this.type = "application/json";

        var pickDate = moment(this.query.date, "YYYY-MM-DD");
        var prevNextPostAvailableDates;
        const searchCondition = {
            _id: {
                $lt: Long.fromString(this.query.lastStatusId),
                $nin: BLACKLISTED_STATUS_IDS,
            },
        };

        if (this.query.date && this.query.date !== "") {
            if (/^([1-2][0-9]{3})-([01][0-9])-([0-3][0-9])$/.test(this.query.date) && pickDate.isValid()) {
                // Check target date posts availability
                const dateInfo = (yield db.collection("post_available_dates").find({
                    year_str: pickDate.format("YYYY"),
                    month_str: pickDate.format("MM"),
                    day_str: pickDate.format("DD"),
                }).toArray())[0];

                if (! dateInfo) {
                    this.body = {success: true, available: false};
                    return;
                }

                searchCondition.created_at = {
                    $gte: new Date(dateInfo.begin_unixtime),
                    $lte: new Date(dateInfo.end_unixtime),
                };
            } else {
                this.body = {success: false, error: "Invalid date format"};
                return;
            }
        } else {
            pickDate = null;
        }

        var tweets = yield db.collection("tweets_cache").find(searchCondition)
        .sort({_id: MONGO_SORT_DESC})
        .limit(40)
        .toArray();

        if (this.session.twitterAuth) {
            tweets = (yield this.twit.get("statuses/lookup", {id: _.map(tweets, "_id").join(",")})).data;
            tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        const oldestTweet = tweets[tweets.length - 1];

        this.render("tweets", {
            tweets: selectTweetWithIllust(tweets),
            isTwitterAuthenticated: !!this.session.twitterAuth,
        });

        this.body = {
            available: tweets.length !== 0,
            list: this.body,
            searchStatus: {
                lastStatusId: oldestTweet ? oldestTweet.id_str : this.query.lastStatusId,
                date: {
                    current: pickDate ? pickDate.format("YYYY-MM-DD") : null,
                }
            }
        };
    }));

    app.use(route.get("/api/status/:statusId", function* (statusId) {
        this.type = "application/json";
        const statuses = yield db.collection("tweets_cache").find({id_str: statusId}).toArray();

        if (statuses.length === 0) return this.body = {available: false};
        return this.body = {available: true, status: statuses[0]};
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
        process.nextTick(() => {
            if (this.session.dnt) return;

            mixpanel.track("social:favorited", {
                distinct_id: this.session.mixpanel_tracking_id,
            });
        });
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
        process.nextTick(() => {
            if (this.session.dnt) return;

            mixpanel.track("social:un-favorited", {
                distinct_id: this.session.mixpanel_tracking_id,
            });
        });
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
        process.nextTick(() => {
            if (this.session.dnt) return;

            mixpanel.track("auth:disconnect-twitter", {
                distinct_id: this.session.mixpanel_tracking_id,
            });
        });
    }));

    app.use(route.get("/auth/twitter", passport.authenticate("twitter")));

    app.use(route.get("/auth/twitter/callback", passport.authenticate("twitter", {
        successRedirect: "/auth/twitter/success",
        failureRedirect: "/auth/failure"
    })));

    app.use(route.get("/auth/twitter/success", function* () {
        this.session.twitterAuth = this.session.passport.user.twitter;
        this.redirect("/");

        process.nextTick(() => {
            if (this.session.dnt) return;

            mixpanel.track("auth:authenticate-twitter", {
                distinct_id: this.session.mixpanel_tracking_id,
            });
        });
    }));

    app.use(route.get("/auth/failure", function* () {
        this.render("auth/failure");
    }));

    console.log(`\u001b[32mServer listening on ${process.env.PORT}\u001b[m`);
    app.listen(process.env.PORT);
})();
