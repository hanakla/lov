const matchesSelector = Element.prototype.matches
    || Element.prototype.webkitMatchesSelector
    || Element.prototype.mozMatchesSelector
    || Element.prototype.msMatchesSelector
    || Element.prototype.oMatchesSelector;

const addListener = (elements, event, selector, listener, once) => {
    const delegator = (...args) => {
        const [e] = args;
        const target = e.target;

        if (!e.target instanceof Element) {
            return;
        }

        if (typeof selector === "string" && !matchesSelector.call(e.target, selector)) {
            return;
        }

        if (once) {
            e.target.removeEventListener(event, delegator, false);
        }
        return listener.apply(null, args);
    }

    return elements.each(el => el.addEventListener(event, delegator, false));
};

const proto = Object.assign(Object.create(Array.prototype), {
    on(event, selector, listener) {
        if (typeof selector === "function") {
            listener = selector;
            selector = null;
        }

        return addListener(this, event, selector, listener, false);
    },
    once(event, selector, listener) {
        if (typeof selector === "function") {
            listener = selector;
            selector = null;
        }

        return addListener(this, event, selector, listener, true);
    },
    addClass(className) {
        this.forEach(el => el.classList.add(className));
        return this;
    },
    removeClass(className) {
        this.forEach(el => el.classList.remove(className));
        return this;
    },
    filter(test) {
        if (typeof test === "string") {
            test = el => matches.call(el, selector);
        }

        return $(Array.prototype.filter.call(this, test))
    },
    find(selector) {
        const newList = [];
        this.each(el => newList.push.apply(newList, $(selector, el)))
        return $(newList);
    },
    each(iterator) {
        this.forEach(el => iterator(el));
        return this;
    },
    css(prop, value) {
        return this.each(el => el.style[prop] = value);
    },
    append(selector) {
        return $(selector).each(el => this[0].appendChild(el));
    },
    appendTo(selector) {
        const target = $(selector);
        return this.each(el => target[0].appendChild(el));
    },
    parents(selector) {
        const matchedParents = [];
        const matchParent = (el, selector) => {
            if (!el.parentElement) {
                return;
            }

            if (matchesSelector.call(el.parentElement, selector) === true) {
                matchedParents.push(el.parentElement);
            }

            matchParent(el.parentElement, selector);
        }

        this.each(el => matchParent(el, selector));

        return $(matchedParents);
    }
});

const $ = module.exports = (selector, el = document) => {
    var targets;

    if (typeof selector === "string") {
        targets = [].slice.call(el.querySelectorAll(selector));
    } else if (selector instanceof Array || selector instanceof HTMLCollection) {
        targets = [].slice.call(selector);
    } else {
        targets = [selector];
    }

    return Object.setPrototypeOf(targets, proto);
};


Object.assign(module.exports, {
    ready : new Promise(resolve => { window.addEventListener("DOMContentLoaded", resolve); }),
    parseHtml(string) {
        const root = document.createElement("div");
        root.innerHTML = string;
        return $(root.children);
    },

    cancelEvenet(event) {
        event.stopPropagation();
        event.preventDefault();
    }
});
