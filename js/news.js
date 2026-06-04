const News = (() => {
    function init() {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('bar-app:news-seen:')) keys.push(k);
            }
            keys.forEach(k => localStorage.removeItem(k));
        } catch {}
    }

    return { init };
})();
