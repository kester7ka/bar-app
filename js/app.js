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
        KB.init();

        const ok = await Auth.bootstrap();
        if (ok) {
            await afterAuth();
        } else {
            Auth.show();
        }
    }

    async function afterAuth() {
        document.documentElement.classList.remove('pre-auth');
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
        if (typeof KB !== 'undefined' && KB.loadOverrides) {
            KB.loadOverrides();
        }
    }

    return { start, afterAuth };
})();

['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: true });
});

document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

document.addEventListener('DOMContentLoaded', () => {
    Boot.start();
});
