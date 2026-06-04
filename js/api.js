const Api = (() => {
    
    
    
    
    
    
    const BASE = (() => {
        if (typeof window !== 'undefined' && typeof window.BAR_APP_API === 'string') {
            return window.BAR_APP_API;
        }
        if (typeof location !== 'undefined' && location.protocol === 'file:') {
            return 'http://127.0.0.1:5000';
        }
        return '';
    })();
    const TOKEN_KEY = 'bar-app:token';

    const getToken = () => localStorage.getItem(TOKEN_KEY) || null;
    const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

    const BAR_OVERRIDE_KEY = 'bar-app:admin-bar';
    const getBarOverride = () => localStorage.getItem(BAR_OVERRIDE_KEY) || null;
    const setBarOverride = (id) => id
        ? localStorage.setItem(BAR_OVERRIDE_KEY, String(id))
        : localStorage.removeItem(BAR_OVERRIDE_KEY);

    async function call(method, path, body) {
        const headers = { 'Accept': 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const t = getToken();
        if (t) headers['Authorization'] = `Bearer ${t}`;
        
        const barOverride = getBarOverride();
        if (barOverride) headers['X-Bar-Id'] = barOverride;
        let resp;
        try {
            resp = await fetch(`${BASE}${path}`, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } catch (e) {
            throw new ApiError('Нет связи с сервером. Запусти backend/server.py.', 0);
        }
        if (resp.status === 204) return null;
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const msg = data?.error || `Ошибка ${resp.status}`;
            throw new ApiError(msg, resp.status);
        }
        return data;
    }

    class ApiError extends Error {
        constructor(message, status) {
            super(message);
            this.status = status;
        }
    }

    return {
        get:    (p)    => call('GET',    p),
        post:   (p, b) => call('POST',   p, b ?? {}),
        put:    (p, b) => call('PUT',    p, b ?? {}),
        delete: (p)    => call('DELETE', p),
        getToken,
        setToken,
        getBarOverride,
        setBarOverride,
        ApiError,
        BASE
    };
})();
