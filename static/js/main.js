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
    var lastStatusId = $("#last-status-id")[0].dataset.lastStatusId;

    var wookmarkAnimationRequestId;

    const resetWookmark = () => {
        if (wookmarkAnimationRequestId != null) {
            cancelAnimationFrame(wookmarkAnimationRequestId);
        }

        wookmarkAnimationRequestId = requestAnimationFrame(() => {
            wookmark && wookmark.clear();
            wookmark = new Wookmark("#illusts", {
                autoResize: true,
                // itemWidth: 200,
                offset: 8
            });

            wookmarkAnimationRequestId = null;
        });
    };

    $(window).on("load", async e => {
        for (let el of $("#illusts .illust")) {
            $(".loading").addClass("loading--hidden");

            $(el).removeClass("illust--loading");
            resetWookmark();
        }
    });

    $(window).on("scroll", threshold(10, async e => {
        const scrollBottom = window.innerHeight + Math.max(document.body.scrollTop, document.documentElement.scrollTop) + 60;

        if (scrollBottom < document.body.scrollHeight) return;
        if (activeRequest) return;

        activeRequest = fetch("/api/index?" + querystring.stringify({lastStatusId}));

        const response = JSON.parse(await (await activeRequest).text());

        if (! response.available) return;

        const $list = $.parseHtml(response.list);
        $list.find("img").once("load", e => {
            $(e.target).parents(".illust--loading").removeClass("illust--loading")
            resetWookmark();
        });

        $list.appendTo("#illusts");
        lastStatusId = response.lastStatusId;

        activeRequest = null;
    }));
});
