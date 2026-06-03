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
        Admin.init();

        const ok = await Auth.bootstrap();
        if (ok) {
            await afterAuth();
        } else {
            Auth.show();
        }
    }

    async function afterAuth() {
        // Отметка для CSS: показывает админ-плитку, скрывает QR у админа.
        document.body.classList.toggle('is-admin', !!Auth.isAdmin?.());
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
const __FORM_TAGS = 'input, textarea, select, button, a, label, [contenteditable]';
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    // Защита от двойного-тап-зума. НО НЕ для полей ввода и кликабельного —
    // иначе на Android тап по input приводит к preventDefault и клавиатура
    // мгновенно закрывается, не успев толком открыться.
    if (now - __lastTouchEnd <= 350) {
        const t = e.target;
        if (!(t && t.closest && t.closest(__FORM_TAGS))) {
            e.preventDefault();
        }
    }
    __lastTouchEnd = now;
}, { passive: false });

// Pinch — только реально многоточечный жест. Один палец на input не трогаем.
document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener('DOMContentLoaded', () => {
    Boot.start();
});
