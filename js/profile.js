const Profile = (() => {
    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('theme-label').textContent = theme === 'dark' ? 'Тёмная' : 'Светлая';
        const s = Storage.settings();
        s.theme = theme;
        Storage.saveSettings(s);
    };

    function render() {
        const u = Auth.user();
        const b = Auth.bar();
        if (!u || !b) return;
        const initial = (u.display_name || u.username || '?').trim().charAt(0).toUpperCase();
        document.getElementById('profile-avatar').textContent = initial;
        document.getElementById('profile-name').textContent = u.display_name || u.username;
        document.getElementById('profile-username').textContent = `@${u.username}`;
        document.body.classList.toggle('is-offline', !!Auth.isOffline?.());
        document.body.classList.toggle('is-admin',   !!Auth.isAdmin?.());
        if (typeof QR !== 'undefined') QR.render();

        
        
        const code = (b.code || '').trim();
        const name = (b.name || '').trim();
        const same = !name || name.toLowerCase() === code.toLowerCase();
        document.getElementById('profile-bar').textContent = same ? code : `${code} · ${name}`;
    }

    const init = () => {
        const s = Storage.settings();
        applyTheme(s.theme || 'light');

        document.getElementById('btn-theme').addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme');
            applyTheme(cur === 'dark' ? 'light' : 'dark');
        });

        document.getElementById('btn-about').addEventListener('click', () => {
            document.getElementById('about-modal').classList.add('show');
        });

        document.getElementById('btn-logout').addEventListener('click', async () => {
            if (!confirm('Выйти из аккаунта?')) return;
            await Auth.logout();
            location.reload();
        });

        Nav.onShow('profile', render);
    };

    return { init, render };
})();
