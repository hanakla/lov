require("./thirdparty/fetch");

const $ = require("./util/domutil");
const querystring = require("querystring");
const Wookmark = require("./thirdparty/wookmark");

const ANIMATION_END_EVENTS = ["animationend", "webkitAnimationEnd", "oAnimationEnd", "mozAnimationEnd", "msAnimationEnd"];

const timer = ms => new Promise(resolve => setTimeout(resolve, ms))

const threshold = (eps, fn) => {
    var lastExecutionTimeMs = 0;
    var paddingTimeMs = 1000 / eps;
    var timerId;

    return _ => {
        var elapsedFromLastExectionMs = Date.now() - lastExecutionTimeMs;
        if (elapsedFromLastExectionMs < paddingTimeMs) {
            timerId = setTimeout(() => fn(), elapsedFromLastExectionMs);
            return;
        }

        clearTimeout(timerId);
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

    // Viewer Open/Close
    $(window).on("keyup", e => {
        if (! e.keyCode === 27) return; // Escape
        if ($(".viewer").is(".viewer--shown")) {
            $(".viewer").removeClass("viewer--shown");
            mixpanel.track("action:close-modal", {via: "esc-key"});
        }
    })

    $(".illusts").on("click", ".illust_overlay", async e => {
        const statusId = $(e.target).parents(".illust")[0].dataset.statusId;
        const illustUrl = $(e.target)[0].dataset.src;

        const req = await fetch(`/api/status/${statusId}`, {
            method: "GET",
            credentials: "same-origin",
        });
        const res = JSON.parse(await req.text());

        if (! res.available) return;

        const $viewer = $(".viewer");

        // Attach status to DOM
        $viewer.find(".viewer_illust")
            .attr("href", `https://twitter.com/${res.status.user.screen_name}/status/${statusId}`)
            .css("background-image", `url("${illustUrl}")`);

        $viewer.find(".viewer_meta_tweet").text(res.status.text);

        $(".viewer_meta_author-link")
            .attr("href", `https://twitter.com/${res.status.user.screen_name}`)
            .text(res.status.user.name);

        $(".viewer_meta_author-icon")
            .attr("href", `https://twitter.com/${res.status.user.screen_name}`)
            .css("background-image", `url("${res.status.user.profile_image_url}")`)

        // Displaying
        await $viewer
            .addClass("viewer--showing")
            .awaitEvent(ANIMATION_END_EVENTS);

        $viewer
            .addClass("viewer--shown")
            .removeClass("viewer--showing");

        mixpanel.track("action:open-modal", {statusId});
    });

    $(".viewer").on("click", e => {
        if (! $(e.target).is(".viewer")) return;
        $(".viewer").removeClass("viewer--shown");
        mixpanel.track("action:close-modal", {via: "click out-side"});
    });

    $(".viewer_close").on("click", e => {
        $(".viewer").removeClass("viewer--shown");
        mixpanel.track("action:close-modal", {via: "closer"});
    });

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

    // wait for image load
    Promise.race([$(window).awaitEvent("load"), timer(3000)]).then(() => {
        $(".loading").addClass("loading--hidden");

        for (let el of $(".illusts .illust")) {
            $(el).removeClass("illust--loading");
        }

        resetWookmark();
    });

    // mixpanel analytics
    mixpanel.track_links(".title_link--older a", "access:older", function (a) {
        return {date: a.innerText};
    });

    mixpanel.track_links(".title_link--newer a", "access:newer", function (a) {
        return {date: a.innerText};
    });

    //-- track modal controls
    mixpanel.track_links(".viewer_meta_author-icon", "access:twitter-goto-account", function (a) {
        return {url: a.href, via: "icon"};
    });

    mixpanel.track_links(".viewer_meta_author-link", "access:twitter-goto-account", function (a) {
        return {url: a.href, via: "author name"};
    });

    mixpanel.track_links(".viewer_illust", "access:twitter-goto-status", function (a) {
        return {url: a.href};
    });

    const trackId = document.cookie.match(/mixpanel_tracking_id=([^;]+)/);
    if (trackId) {
        mixpanel.identify(trackId[1]);
    }
});
