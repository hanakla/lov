(() => {
    var $ = selector => [].slice.call(document.querySelectorAll(selector));
    var qs = obj => Object.keys(obj).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`).join("&")
    var wookmark;
    var body = document.body;
    var activeRequest;

    window.addEventListener("DOMContentLoaded", co.wrap(function* () {
        yield Promise.all($("img").map(img => {
            return new Promise((resolve, reject) => {
                img.addEventListener("load", resolve);
                img.addEventListener("error", resolve)
            });
        }));

        wookmark = new Wookmark("#illusts", {
            autoResize: true,
            itemWidth: 200,
            offset: 8
        });

        console.log(wookmark);
    }));

    window.addEventListener("scroll", co.wrap(function* () {
        const scrollBottom = window.innerHeight + body.scrollTop + 60;
        // console.log(scrollBottom, body.scrollHeight);
        if (scrollBottom < body.scrollHeight) return;
        if (activeRequest) return;

        const lastStatusId = $(".illust").pop().dataset.statusId;

        activeRequest = fetch("/api/index?" + qs({lastStatusId}));
        $("#illusts")[0].innerHTML += yield (yield activeRequest).text();
        activeRequest = null;

        yield Promise.all($("img").map(img => {
            return new Promise((resolve, reject) => {
                img.addEventListener("load", resolve);
                img.addEventListener("error", resolve)
            });
        }));

        wookmark.clear();
        wookmark = null;

        wookmark = new Wookmark("#illusts", {
            autoResize: true,
            itemWidth: 200,
            offset: 8
        });
    }));
})();
