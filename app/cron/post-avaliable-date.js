const {MongoClient, Long} = require("mongodb");
const {CronJob} = require("cron");

const config = require("../config");

const MONGO_SORT_ASC = 1;
const MILLI_SECONDS_FOR_DAY = 1000 * 60 * 60 * 24;

const job = new CronJob({
    // Runs every days at 00:00:01
    cronTime : "1 0 0 * * *",
    onTick: async () => {
        console.info(`\u001b[36mJob "cache-post-available-dates" started.`);
        try {
            const db = await MongoClient.connect(config.mongo.url);

            const availableDates = await db.collection("tweets_cache").aggregate([
                {
                    $match: {
                        $and: [
                            {"entities.media": {$exists: true}},
                            {"entities.media.type": "photo"}
                        ],
                    },
                },
                {
                    $project: {
                        _id: {$dateToString: {format: "%Y-%m-%d", date: "$created_at"}},
                        string: {$dateToString: {format: "%Y-%m-%d", date: "$created_at"}},
                        year: {$year: "$created_at"},
                        month: {$month: "$created_at"},
                        day: {$dayOfMonth: "$created_at"},
                        year_str: {$dateToString: {format: "%Y", date: "$created_at"}},
                        month_str: {$dateToString: {format: "%m", date: "$created_at"}},
                        day_str: {$dateToString: {format: "%d", date: "$created_at"}},
                    }
                },
                {
                    $group: {
                        _id: "$string",
                        string: {$first: "$string"},
                        year: {$last: "$year"},
                        month: {$last: "$month"},
                        day: {$last: "$day"},
                        year_str: {$last: "$year_str"},
                        month_str: {$last: "$month_str"},
                        day_str: {$last: "$day_str"},
                    }
                },
                {
                    $sort: {
                        year: MONGO_SORT_ASC,
                        month: MONGO_SORT_ASC,
                        day: MONGO_SORT_ASC,
                    }
                }
            ]).toArray();

            availableDates.forEach((doc, idx) => {
                doc._id = idx + 1;
                doc.begin_unixtime = new Date(doc.year, doc.month - 1, doc.day).getTime();
                doc.end_unixtime = doc.begin_unixtime + MILLI_SECONDS_FOR_DAY - 1;
            });

            db.collection("post_available_dates").insert(availableDates);
        } catch (e) {
            console.error(e);
        }

        console.info(`\u001b[36mJob "cache-post-available-dates" ended.`);
    },
    start: true,
    runOnInit: true,
    onComplete: null,
    timeZone: "Asia/Tokyo"
});
