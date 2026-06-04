const Boot = (() => {
    async function start() {
        
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
        
        document.body.classList.toggle('is-admin', !!Auth.isAdmin?.());
        try {
            await Storage.refresh();
        } catch (err) {
            Utils.toast(err.message);
        }
        Nav.show('home');
        Home.render();
        Profile.render();
        if (typeof Positions !== 'undefined' && Positions.startHonestMarkPolling) {
            Positions.startHonestMarkPolling();
        }
    }

    return { start, afterAuth };
})();

['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
});
let __lastTouchEnd = 0;
const __FORM_TAGS = 'input, textarea, select, button, a, label, [contenteditable]';
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    
    
    
    if (now - __lastTouchEnd <= 350) {
        const t = e.target;
        if (!(t && t.closest && t.closest(__FORM_TAGS))) {
            e.preventDefault();
        }
    }
    __lastTouchEnd = now;
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener('DOMContentLoaded', () => {
    Boot.start();
});
