// Карточка «Что нового» на главной.
// Сейчас всегда видна (закрытия нет). На старте чистим старые
// флаги «news-seen» из localStorage — иначе после обновления у
// пользователя осталась бы скрытая карточка с прошлой логикой.

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
