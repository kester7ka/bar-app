const Status = (() => {
    const MIN_INTERVAL = 60 * 1000;
    const SVCS = ['server', 'db', 'api', 'hzn'];

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

        SVCS.forEach(s => setSvc(s, 'checking'));
        setFooter('проверяем…', '');
        setSummary('проверяем…');

        const start = performance.now();
        let serverOk = false;
        let dbOk = false;
        let hznOk = false;

        try {
            const data = await Api.get('/api/health');
            serverOk = true;
            dbOk = !!(data && data.db);
        } catch (e) {}

        if (serverOk) {
            try {
                const h = await Api.get('/api/honest-mark/health');
                hznOk = !!(h && h.ok);
            } catch (e) {}
        }

        const ms = Math.round(performance.now() - start);
        const apiOk = serverOk && dbOk;
        const result = {
            server: serverOk,
            db: dbOk,
            api: apiOk,
            hzn: hznOk,
            ms,
            time: new Date()
        };
        lastResult = result;
        lastCheck = Date.now();

        renderResult(result);
        btn?.classList.remove('spinning');
        _checking = false;
    }

    function renderResult(r) {
        setSvc('server', r.server ? 'ok' : 'fail');
        setSvc('db',     r.db     ? 'ok' : 'fail');
        setSvc('api',    r.api    ? 'ok' : 'fail');
        setSvc('hzn',    r.hzn    ? 'ok' : 'fail');

        const time = fmtTime(r.time);
        const left = r.server ? `проверено ${time}` : `нет связи · ${time}`;
        const right = r.server ? `${r.ms} мс` : '';
        setFooter(left, right);

        const allOk = r.server && r.db && r.api;
        const someFail = !r.server || !r.db || !r.api;
        if (allOk) setSummary('все системы в порядке');
        else if (!r.server) setSummary('сервер не отвечает');
        else if (!r.db) setSummary('проблема с БД');
        else if (someFail) setSummary('частичные проблемы');
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

    function setSvc(name, state) {
        const dot = document.getElementById(`svc-${name}-dot`);
        const text = document.getElementById(`svc-${name}-state`);
        if (!dot || !text) return;
        dot.className = `svc-dot ${state}`;
        if (state === 'ok') {
            text.className = 'svc-state ok';
            text.textContent = 'работает';
        } else if (state === 'fail') {
            text.className = 'svc-state fail';
            text.textContent = 'не отвечает';
        } else {
            text.className = 'svc-state';
            text.textContent = 'проверяем…';
        }
    }

    function setFooter(left, right) {
        const el = document.getElementById('status-footer');
        if (!el) return;
        el.innerHTML = `<span>${Utils.escape(left)}</span>` + (right ? `<span>${Utils.escape(right)}</span>` : '');
    }

    function setSummary(text) {
        const el = document.getElementById('status-summary');
        if (el) el.textContent = text;
    }

    function fmtTime(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function init() {
        document.getElementById('status-close')?.addEventListener('click', close);
        document.getElementById('status-refresh')?.addEventListener('click', manualRefresh);
    }

    return { init, open, close };
})();
