// Состояние авторизации + UI оверлея регистрации/входа.
// Пока пользователь не аутентифицирован — основное приложение скрыто.

const Auth = (() => {
    const CACHE_KEY = 'bar-app:user-cache';
    let _user = null;
    let _bar = null;
    let _offline = false;

    const user = () => _user;
    const bar  = () => _bar;
    const isAuthed = () => !!_user && !!Api.getToken();
    const isOffline = () => _offline;

    function writeCache() {
        if (!_user || !_bar) return;
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                user: _user, bar: _bar, ts: Date.now()
            }));
        } catch {}
    }
    function readCache() {
        try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }
        catch { return null; }
    }
    function clearCache() {
        try { localStorage.removeItem(CACHE_KEY); } catch {}
    }

    // Пробуем восстановить сессию: сначала с сервера, при ошибке — из кэша.
    async function bootstrap() {
        if (!Api.getToken()) return false;
        try {
            const me = await Api.get('/api/auth/me');
            _user = me.user;
            _bar = me.bar;
            _offline = false;
            writeCache();
            return true;
        } catch (e) {
            // Если у сервера 401 — токен реально протух, валим в логин.
            // Если другая ошибка (нет связи, 5xx) — пробуем кэш и работаем офлайн.
            if (e && e.status === 401) {
                Api.setToken(null);
                clearCache();
                return false;
            }
            const cached = readCache();
            if (cached && cached.user && cached.bar) {
                _user = cached.user;
                _bar = cached.bar;
                _offline = true;
                return true;
            }
            return false;
        }
    }

    async function register(payload) {
        const r = await Api.post('/api/auth/register', payload);
        Api.setToken(r.token);
        _user = r.user;
        _bar = r.bar;
        _offline = false;
        writeCache();
        return r;
    }

    async function login(payload) {
        const r = await Api.post('/api/auth/login', payload);
        Api.setToken(r.token);
        _user = r.user;
        _bar = r.bar;
        _offline = false;
        writeCache();
        return r;
    }

    async function logout() {
        try { await Api.post('/api/auth/logout'); } catch {}
        Api.setToken(null);
        clearCache();
        _user = null;
        _bar = null;
        _offline = false;
    }

    // ----- UI -----
    function show()  { document.getElementById('auth-overlay').classList.add('show'); document.body.classList.add('locked'); }
    function hide()  { document.getElementById('auth-overlay').classList.remove('show'); document.body.classList.remove('locked'); }

    function switchTab(name) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        document.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('active', f.dataset.form === name));
        clearError();
    }

    function showError(msg) {
        const el = document.getElementById('auth-error');
        el.textContent = msg;
        el.classList.add('show');
    }
    function clearError() {
        document.getElementById('auth-error').classList.remove('show');
    }

    function bindForms() {
        // Переключение табов
        document.querySelectorAll('.auth-tab').forEach(t => {
            t.addEventListener('click', () => switchTab(t.dataset.tab));
        });

        // Маска для 8-значного ключа
        const keyInput = document.getElementById('reg-key');
        keyInput.addEventListener('input', () => {
            keyInput.value = keyInput.value.replace(/\D/g, '').slice(0, 8);
        });

        // Открытие политики — клик по ссылке внутри label.
        // stopPropagation, чтобы клик не пробрасывался в label и не дёргал
        // привязанный чекбокс лишний раз.
        document.querySelectorAll('[data-policy]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                document.getElementById('policy-modal').classList.add('show');
            });
        });

        // «Глаз» — переключение видимости пароля.
        document.querySelectorAll('[data-pwd-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = btn.parentElement.querySelector('input');
                if (!input) return;
                const visible = input.type === 'text';
                input.type = visible ? 'password' : 'text';
                btn.classList.toggle('visible', !visible);
                btn.setAttribute('aria-label', visible ? 'Показать пароль' : 'Скрыть пароль');
            });
        });

        // Регистрация
        document.getElementById('form-register').addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();
            const data = new FormData(e.target);
            try {
                await register({
                    key: String(data.get('key')).trim(),
                    username: String(data.get('username')).trim(),
                    password: String(data.get('password')),
                    display_name: String(data.get('display_name') || '').trim() || null,
                    accepted_policy: !!data.get('accepted_policy')
                });
                hide();
                if (typeof Boot !== 'undefined') Boot.afterAuth();
            } catch (err) {
                showError(err.message);
            }
        });

        // Логин
        document.getElementById('form-login').addEventListener('submit', async (e) => {
            e.preventDefault();
            clearError();
            const data = new FormData(e.target);
            try {
                await login({
                    username: String(data.get('username')).trim(),
                    password: String(data.get('password'))
                });
                hide();
                if (typeof Boot !== 'undefined') Boot.afterAuth();
            } catch (err) {
                showError(err.message);
            }
        });
    }

    function init() {
        bindForms();
    }

    return { init, bootstrap, show, hide, isAuthed, isOffline, user, bar, logout, register, login };
})();
