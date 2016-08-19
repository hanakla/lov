const {Long} = require("mongodb");

module.exports = {
    "statusIds": [
        // Pasted retweet
        "744762639180570624",
        "744243039359623168",

        // Duplicated
        "766676059026698241", // 本垢とサブ垢投稿、申し訳ないけど後に投稿した方を除外

        // Unrelated tweets
        "764266522940354561",
        "766441366838648833",

        // INM
        "748084432855138304",
        "748073477488381956",
    ].map(statusId => Long.fromString(statusId))
};
