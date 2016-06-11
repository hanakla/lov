require("./thirdparty/fetch");

const $ = require("./util/domutil");
const querystring = require("querystring");
const Wookmark = require("./thirdparty/wookmark");

const threshold = (eps, fn) => {
    var lastExecutionTimeMs = 0;
    var paddingTimeMs = 1000 / eps;

    return _ => {
        var elapsedFromLastExectionMs = Date.now() - lastExecutionTimeMs;
        if (elapsedFromLastExectionMs < paddingTimeMs) {
            return;
        }

        fn();

        lastExecutionTimeMs = Date.now();
    };
};

$.ready.then(() => {
    var wookmark;
    var activeRequest;
    var searchStatus = JSON.parse($("#search-status")[0].dataset.status)

    var wookmarkAnimationRequestId;

    const resetWookmark = () => {
        if (wookmarkAnimationRequestId != null) {
            cancelAnimationFrame(wookmarkAnimationRequestId);
        }

        wookmarkAnimationRequestId = requestAnimationFrame(() => {
            wookmark && wookmark.clear();
            wookmark = new Wookmark(".illusts", {
                autoResize: true,
                // itemWidth: 200,
                offset: 14
            });

            wookmarkAnimationRequestId = null;
        });
    };

    $(window).on("load", async e => {
        for (let el of $(".illusts .illust")) {
            $(".loading").addClass("loading--hidden");

            $(el).removeClass("illust--loading");
            resetWookmark();
        }
    });

    $(window).on("scroll", threshold(10, async e => {
        const scrollBottom = window.innerHeight + Math.max(document.body.scrollTop, document.documentElement.scrollTop) + 60;

        if (scrollBottom < document.body.scrollHeight) return;
        if (activeRequest) return;

        activeRequest = fetch("/api/index?" + querystring.stringify({
            date: searchStatus.date.current,
            lastStatusId: searchStatus.lastStatusId
        }), {
            method: "GET",
            credentials: "same-origin",
        });

        const response = JSON.parse(await (await activeRequest).text());

        mixpanel.track("access:next-page", {
            next_page_available: response.available,
            date: searchStatus.date.current
        });

        if (! response.available) return;

        const $list = $.parseHtml(response.list);
        $list.css("display", "none").appendTo(".illusts");

        await Promise.all($list.find("img").map(el => new Promise(resolve => {
            $(el)
                .once("load", resolve)
                .once("error", resolve);
        })));

        $list.css("display", "");
        resetWookmark();
        setTimeout(() => $list.removeClass("illust--loading"), 100);

        searchStatus = response.searchStatus;
        activeRequest = null;
    }));

    // Handle favorite
    $(".illusts").on("click", ".illust_action--fav", async e => {
        const statusId = $(e.target).parents(".illust")[0].dataset.statusId;
        const req = await fetch(`/api/fav/${statusId}`, {
            method: "POST",
            credentials: "same-origin",
        });
        const res = JSON.parse(await req.text());

        if (res.success) {
            $(e.target).removeClass("illust_action--fav").addClass("illust_action--favorited");
        }
    });

    $(".illusts").on("click", ".illust_action--favorited", async e => {
        const statusId = $(e.target).parents(".illust")[0].dataset.statusId;
        const req = await fetch(`/api/fav/${statusId}`, {
            method: "DELETE",
            credentials: "same-origin",
        });
        const res = JSON.parse(await req.text());

        if (res.success) {
            $(e.target).removeClass("illust_action--favorited").addClass("illust_action--fav");
        }
    });

    // mixpanel analytics
    mixpanel.track_links(".title_link--older a", "access:older", function (a) {
        return {date: a.innerText};
    });

    mixpanel.track_links(".title_link--newer a", "access:newer", function (a) {
        return {date: a.innerText};
    });

    const trackId = document.cookie.match(/mixpanel_tracking_id=([^;]+)/);
    if (trackId) {
        mixpanel.identify(trackId[1]);
    }
});
