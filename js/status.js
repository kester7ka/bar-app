const Status = (() => {
    const MIN_INTERVAL = 60 * 1000;

    const SERVICES = [
        { id: 'server',    label: 'Сервер',          icon: 'hard-drives' },
        { id: 'db',        label: 'База данных',      icon: 'database' },
        { id: 'positions', label: 'API позиций',      icon: 'package' },
        { id: 'auth',      label: 'API авторизации',  icon: 'lock-simple' },
        { id: 'kb',        label: 'API базы знаний',  icon: 'books' },
        { id: 'schedule',  label: 'API графика',      icon: 'calendar-blank' },
        { id: 'hzn',       label: 'Честный Знак',     icon: 'seal-check' },
    ];

    let lastCheck = 0;
    let lastResult = null;
    let _checking = false;

    function open() {
        document.getElementById('status-overlay').classList.add('show');
        if (lastResult && Date.now() - lastCheck < MIN_INTERVAL) {
            renderResult(lastResult);
        } else {
            doCheck();
        }
    }

    function close() {
        document.getElementById('status-overlay').classList.remove('show');
    }

    async function doCheck() {
        if (_checking) return;
        _checking = true;
        const btn = document.getElementById('status-refresh');
        btn?.classList.add('spinning');

        renderRows(Object.fromEntries(SERVICES.map(s => [s.id, 'checking'])));
        setBanner('checking', 'Проверяем…', '');
        setSummary('проверяем…');

        const start = performance.now();
        let server = false, db = false, hznServer = false;

        try {
            const d = await Api.get('/api/health');
            server = true;
            db = !!(d && d.db);
        } catch (e) {}

        if (server) {
            try {
                const h = await Api.get('/api/honest-mark/health');
                hznServer = !!(h && h.ok);
            } catch (e) {}
        }

        const ms = Math.round(performance.now() - start);
        const result = {
            states: computeStates(server, db, hznServer),
            server, db, ms, time: new Date(),
        };
        lastResult = result;
        lastCheck = Date.now();

        renderResult(result);
        btn?.classList.remove('spinning');
        _checking = false;
    }

    function computeStates(server, db, hznServer) {
        if (!server) {
            const out = {};
            SERVICES.forEach(s => { out[s.id] = 'fail'; });
            return out;
        }
        return {
            server: 'ok',
            db: db ? 'ok' : 'fail',
            positions: db ? 'ok' : 'partial',
            auth: 'ok',
            kb: db ? 'ok' : 'partial',
            schedule: 'ok',
            hzn: hznServer ? 'ok' : 'local',
        };
    }

    function renderResult(r) {
        renderRows(r.states);
        const vals = Object.values(r.states);
        const time = fmtTime(r.time);
        const sub = r.server ? `проверено ${time} · ${r.ms} мс` : `нет связи · ${time}`;

        if (!r.server) {
            setBanner('fail', 'Сервер недоступен', sub);
            setSummary('нет связи');
        } else if (vals.includes('fail')) {
            setBanner('partial', 'Работает частично', sub);
            setSummary('частично');
        } else if (vals.includes('local') || vals.includes('partial')) {
            setBanner('partial', 'Работает частично', sub);
            setSummary('частично');
        } else {
            setBanner('ok', 'Все системы работают', sub);
            setSummary('всё в порядке');
        }
    }

    function renderRows(states) {
        const list = document.getElementById('status-list');
        if (!list) return;
        list.innerHTML = SERVICES.map(s => {
            const st = states[s.id] || 'checking';
            return `
                <div class="status-row state-${st}">
                    <span class="svc-ic"><i class="ph ph-${s.icon}"></i></span>
                    <span class="svc-name">${s.label}</span>
                    <span class="svc-state">${stateText(s.id, st)}</span>
                </div>`;
        }).join('');
    }

    function stateText(id, st) {
        if (st === 'ok') return 'работает';
        if (st === 'local') return 'работает локально';
        if (st === 'partial') return 'работает частично';
        if (st === 'checking') return 'проверяем…';
        return id === 'hzn' ? 'недоступен' : 'не отвечает';
    }

    function setBanner(state, title, sub) {
        const b = document.getElementById('status-banner');
        const ic = document.getElementById('status-banner-ic');
        const t = document.getElementById('status-banner-title');
        const s = document.getElementById('status-banner-sub');
        const icon = { ok: 'check-circle', partial: 'warning', fail: 'x-circle', checking: 'circle' }[state] || 'circle';
        if (b) b.className = `status-banner state-${state}`;
        if (ic) ic.innerHTML = `<i class="ph ph-${icon}"></i>`;
        if (t) t.textContent = title;
        if (s) s.textContent = sub;
    }

    function setSummary(text) {
        const el = document.getElementById('status-summary');
        if (el) el.textContent = text;
    }

    function fmtTime(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function manualRefresh() {
        const elapsed = Date.now() - lastCheck;
        if (elapsed < MIN_INTERVAL) {
            const wait = Math.ceil((MIN_INTERVAL - elapsed) / 1000);
            Utils.toast(`Подожди ещё ${wait} сек до проверки`);
            return;
        }
        doCheck();
    }

    function init() {
        document.getElementById('status-close')?.addEventListener('click', close);
        document.getElementById('status-refresh')?.addEventListener('click', manualRefresh);
    }

    return { init, open, close };
})();
