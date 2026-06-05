const Boot = (() => {
    function safeInit(name, fn) {
        try { fn(); }
        catch (e) { console.error('init failed:', name, e); }
    }

    async function start() {
        safeInit('Profile',  () => Profile.init());
        safeInit('Nav',      () => Nav.init());
        safeInit('Auth',     () => Auth.init());
        safeInit('Schedule', () => Schedule.init());
        safeInit('Calendar', () => Calendar.init());
        safeInit('Status',   () => Status.init());
        safeInit('Tools',    () => Tools.init());
        safeInit('Positions',() => Positions.init());
        safeInit('Home',     () => Home.init());
        safeInit('Weather',  () => Weather.init());
        safeInit('News',     () => News.init());
        safeInit('QR',       () => QR.init());
        safeInit('Scanner',  () => Scanner.init());
        safeInit('Admin',    () => Admin.init());
        safeInit('KB',       () => KB.init());

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
