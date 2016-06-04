const _ = require("lodash");
const {CronJob} = require("cron");
const {MongoClient, Long} = require("mongodb");
const Twit = require("twit");

const config = require("../config");
const twit = new Twit({
    consumer_key: config.twitter.consumer_key,
    consumer_secret: config.twitter.consumer_secret,
    access_token: config.twitter.access_token,
    access_token_secret: config.twitter.access_token_secret,
});


const job = new CronJob({
    // Runs every 30 minutes
    cronTime : "* */30 * * * *",
    onTick: async () => {
        console.info(`\u001b[36mJob "cache-oldest-tweets" started.\u001b[m`);

        try {
            const ASC = 1;
            const db = await MongoClient.connect("mongodb://localhost:27017/gochiusa-lov");
            const collection = db.collection("tweets_cache");

            var lastCachedStatusId = (await collection.find({}, {id_str: 1}).sort({created_at: ASC}).limit(1).toArray())[0];
            lastCachedStatusId = lastCachedStatusId ? lastCachedStatusId.id_str : null;

            while(true) {
                let tweets = (await twit.get("search/tweets", {
                    q : config.twitter.query,
                    max_id: lastCachedStatusId,
                    count: 100
                })).data.statuses;

                let oldestFetchTweet = tweets[tweets.length - 1];

                if (! oldestFetchTweet || oldestFetchTweet.id_str === lastCachedStatusId) {
                    break;
                }

                _.each(tweets, t => {
                    // Assign id_str as _id
                    t._id = Long.fromString(t.id_str);

                    // Remove personal data
                    delete t.retweeted;
                    delete t.favorited;

                    // Remove realtime data
                    delete t.retweet_count;
                    delete t.favorite_count;

                    // Remove unusing data
                    delete t.id;

                    // Restructure user data (exclusion realtime data)
                    t.user = {
                        id_str: t.user.id_str,
                        name: t.user.name,
                        screen_name: t.user.screen_name,
                        profile_image_url: t.user.profile_image_url,
                        profile_image_url_https: t.user.profile_image_url_https,
                    };

                    // Data type transform
                    t.created_at = new Date(t.created_at);

                    return t;
                });

                collection.insert(tweets);
                lastCachedStatusId = oldestFetchTweet.id_str;

                console.info(`\u001b[36m${tweets.length} tweets into cache\u001b[m`);

                if (tweets.length < 100) {
                    break;
                }
            }
        } catch (e) {
            console.error(e.stack);
        }

        console.info(`\u001b[36mJob "cache-oldest-tweets" ended.\u001b[m`);
    },
    start: true,
    runOnInit: true,
    onComplete: null,
    timeZone: "Asia/Tokyo"
});
