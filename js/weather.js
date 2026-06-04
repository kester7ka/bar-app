const Weather = (() => {
    const LAT = 55.7558;
    const LON = 37.6176;
    const CITY = 'Москва';
    const TZ = 'Europe/Moscow';
    const CACHE_KEY = 'bar-app:weather';
    const CACHE_TTL = 30 * 60 * 1000;
    const URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&timezone=${encodeURIComponent(TZ)}`;

    let tickHandle = null;

    
    const ICONS = {
        sun: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"/>
        </svg>`,
        cloudSun: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="7" cy="8" r="2.5"/>
            <path d="M7 3v1M7 12v1M2 8h1M11 8h1M3.5 4.5l.7.7M10.5 11.5l.7.7M3.5 11.5l.7-.7M10.5 4.5l.7-.7"/>
            <path d="M10 19h9a3 3 0 100-6 4.5 4.5 0 00-8.7-1.2"/>
        </svg>`,
        cloud: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 17h11a3.5 3.5 0 100-7 5 5 0 00-9.7-1A4 4 0 007 17z"/>
        </svg>`,
        rain: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 14h11a3.5 3.5 0 100-7 5 5 0 00-9.7-1A4 4 0 007 14z"/>
            <path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/>
        </svg>`,
        snow: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 14h11a3.5 3.5 0 100-7 5 5 0 00-9.7-1A4 4 0 007 14z"/>
            <circle cx="9" cy="20" r="0.7" fill="currentColor"/>
            <circle cx="13" cy="20" r="0.7" fill="currentColor"/>
            <circle cx="17" cy="20" r="0.7" fill="currentColor"/>
        </svg>`,
        fog: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <path d="M3 8h13M3 12h18M3 16h13M3 20h18"/>
        </svg>`,
        storm: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 13h11a3.5 3.5 0 100-7 5 5 0 00-9.7-1A4 4 0 007 13z"/>
            <path d="M12 16l-2 4h2.5l-1.5 3"/>
        </svg>`
    };

    function codeMeta(code) {
        if (code === 0)                    return { label: 'ясно',          icon: ICONS.sun };
        if (code === 1)                    return { label: 'преим. ясно',   icon: ICONS.sun };
        if (code === 2)                    return { label: 'облачно',       icon: ICONS.cloudSun };
        if (code === 3)                    return { label: 'пасмурно',      icon: ICONS.cloud };
        if (code === 45 || code === 48)    return { label: 'туман',         icon: ICONS.fog };
        if (code >= 51 && code <= 57)      return { label: 'морось',        icon: ICONS.rain };
        if (code >= 61 && code <= 67)      return { label: 'дождь',         icon: ICONS.rain };
        if (code >= 71 && code <= 77)      return { label: 'снег',          icon: ICONS.snow };
        if (code >= 80 && code <= 82)      return { label: 'ливень',        icon: ICONS.rain };
        if (code >= 85 && code <= 86)      return { label: 'снегопад',      icon: ICONS.snow };
        if (code >= 95)                    return { label: 'гроза',         icon: ICONS.storm };
        return { label: '—', icon: ICONS.cloud };
    }

    
    function renderClock() {
        const clk = document.getElementById('wc-clock');
        const dt  = document.getElementById('wc-date');
        if (!clk || !dt) return;
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        clk.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        dt.textContent  = Utils.dateLine();
    }

    function startClock() {
        renderClock();
        if (tickHandle) clearInterval(tickHandle);
        
        const ms = (60 - new Date().getSeconds()) * 1000;
        setTimeout(() => {
            renderClock();
            tickHandle = setInterval(renderClock, 60 * 1000);
        }, ms);
    }

    
    function readCache() {
        try {
            const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (!c) return null;
            if (Date.now() - c.ts > CACHE_TTL) return null;
            return c.data;
        } catch { return null; }
    }

    function writeCache(data) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
    }

    function renderWeather(wx) {
        const tempEl = document.getElementById('wc-temp');
        const condEl = document.getElementById('wc-cond');
        const iconEl = document.getElementById('wc-icon');
        const card   = document.getElementById('weather-card');
        if (!tempEl || !condEl || !iconEl) return;
        if (!wx) {
            tempEl.textContent = '—';
            condEl.textContent = 'нет связи · ' + CITY;
            iconEl.innerHTML = ICONS.cloud;
            card?.classList.add('offline');
            return;
        }
        card?.classList.remove('offline');
        const sign = wx.temp > 0 ? '+' : (wx.temp < 0 ? '−' : '');
        const absT = Math.abs(wx.temp);
        tempEl.textContent = `${sign}${absT}°`;
        const meta = codeMeta(wx.code);
        condEl.innerHTML = `${meta.label} · ${CITY}`;
        iconEl.innerHTML = meta.icon;
    }

    async function loadWeather() {
        const cached = readCache();
        if (cached) {
            renderWeather(cached);
            return;
        }
        try {
            const r = await fetch(URL);
            if (!r.ok) throw new Error('api');
            const data = await r.json();
            const wx = {
                temp: Math.round(data.current.temperature_2m),
                code: Number(data.current.weather_code)
            };
            writeCache(wx);
            renderWeather(wx);
        } catch {
            renderWeather(null);
        }
    }

    function init() {
        startClock();
        loadWeather();
        
        setInterval(loadWeather, CACHE_TTL);
    }

    return { init };
})();
