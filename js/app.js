// Точка входа.
// 1) Тема и тривиальный UI инициализируются сразу.
// 2) Пробуем восстановить сессию.
// 3) Если есть — грузим позиции с сервера и рендерим главную.
//    Если нет — показываем оверлей входа/регистрации.

const Boot = (() => {
    async function start() {
        // Инициализация модулей, которые не требуют auth.
        Profile.init();
        Nav.init();
        Auth.init();
        Schedule.init();
        Calendar.init();
        Status.init();
        Tools.init();
        Positions.init();
        Home.init();
        Weather.init();
        News.init();
        QR.init();
        Scanner.init();

        const ok = await Auth.bootstrap();
        if (ok) {
            await afterAuth();
        } else {
            Auth.show();
        }
    }

    async function afterAuth() {
        try {
            await Storage.refresh();
        } catch (err) {
            Utils.toast(err.message);
        }
        Nav.show('home');
        Home.render();
        Profile.render();
    }

    return { start, afterAuth };
})();

// --- Анти-зум для iOS (Safari игнорит user-scalable=no в части жестов).
//     Блокируем pinch-жесты и двойной тап на зум.
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
});
let __lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - __lastTouchEnd <= 350) e.preventDefault();
    __lastTouchEnd = now;
}, { passive: false });

// Блокируем многоточечные касания (pinch) тоже на уровне touchmove
document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener('DOMContentLoaded', () => {
    Boot.start();
});
