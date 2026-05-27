const Nav = (() => {
    const screens = ['home', 'positions', 'tools', 'profile'];
    const listeners = {};

    const show = (name) => {
        if (!screens.includes(name)) return;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(name).classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.screen === name);
        });
        (listeners[name] || []).forEach(fn => fn());
    };

    const onShow = (name, fn) => {
        listeners[name] = listeners[name] || [];
        listeners[name].push(fn);
    };

    const init = () => {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => show(btn.dataset.screen));
        });
    };

    return { init, show, onShow };
})();
