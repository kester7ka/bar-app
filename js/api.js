// Тонкая обёртка над fetch: автоматически подставляет токен и базовый URL.
// Базовый URL берётся из window.BAR_APP_API (если задан до загрузки app.js),
// либо предполагаем тот же origin.

const Api = (() => {
    const BASE = (typeof window !== 'undefined' && window.BAR_APP_API) || 'http://127.0.0.1:5000';
    const TOKEN_KEY = 'bar-app:token';

    const getToken = () => localStorage.getItem(TOKEN_KEY) || null;
    const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

    async function call(method, path, body) {
        const headers = { 'Accept': 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const t = getToken();
        if (t) headers['Authorization'] = `Bearer ${t}`;
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
        ApiError,
        BASE
    };
})();
