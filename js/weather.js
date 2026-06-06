const Weather = (() => {
    const LAT = 55.7558;
    const LON = 37.6176;
    const CITY = 'Москва';
    const TZ = 'Europe/Moscow';
    const CACHE_KEY = 'bar-app:weather:v2';
    const CACHE_TTL = 30 * 60 * 1000;
    const URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,is_day&timezone=${encodeURIComponent(TZ)}`;

    let tickHandle = null;

    
    const ICO = (name) => `<i class="ph ph-${name}" style="font-size:30px"></i>`;
    const ICONS = {
        sun:       ICO('sun'),
        moon:      ICO('moon-stars'),
        cloudSun:  ICO('cloud-sun'),
        cloudMoon: ICO('cloud-moon'),
        cloud:     ICO('cloud'),
        rain:      ICO('cloud-rain'),
        snow:      ICO('cloud-snow'),
        fog:       ICO('cloud-fog'),
        storm:     ICO('cloud-lightning')
    };

    function codeMeta(code, isDay = true) {
        const clear  = isDay ? ICONS.sun : ICONS.moon;
        const partly = isDay ? ICONS.cloudSun : ICONS.cloudMoon;
        if (code === 0)                    return { label: 'ясно',          icon: clear };
        if (code === 1)                    return { label: 'преим. ясно',   icon: clear };
        if (code === 2)                    return { label: 'облачно',       icon: partly };
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
        const meta = codeMeta(wx.code, wx.isDay !== false);
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
                code: Number(data.current.weather_code),
                isDay: data.current.is_day !== 0
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
