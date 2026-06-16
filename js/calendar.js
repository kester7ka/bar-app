const Calendar = (() => {
    const MONTHS_GEN = [
        'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    const WEEKDAYS = [
        'воскресенье', 'понедельник', 'вторник', 'среда',
        'четверг', 'пятница', 'суббота'
    ];

    const el = (id) => document.getElementById(id);

    let tickTimer = null;
    let endTime = null;

    function open() {
        el('calendar-overlay').classList.add('show');
        if (!el('cal-start').value) {
            el('cal-start').value = Utils.localISO(new Date());
            el('cal-days').value = 1;
        }
        compute();
        startTick();
    }

    function close() {
        el('calendar-overlay').classList.remove('show');
        stopTick();
    }

    function startTick() {
        stopTick();
        tickTimer = setInterval(renderRelative, 1000);
    }

    function stopTick() {
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    }

    function reset() {
        el('cal-start').value = Utils.localISO(new Date());
        el('cal-days').value = 0;
        el('cal-hours').value = 0;
        el('cal-mins').value = 0;
        compute();
    }

    function setStart(kind) {
        const d = new Date();
        if (kind === '-1h') d.setHours(d.getHours() - 1);
        else if (kind === '-6h') d.setHours(d.getHours() - 6);
        else if (kind === '-1d') d.setDate(d.getDate() - 1);
        el('cal-start').value = Utils.localISO(d);
        compute();
    }

    function setDuration(spec) {
        const [d, h, m] = spec.split(':').map(n => Number(n) || 0);
        el('cal-days').value = d;
        el('cal-hours').value = h;
        el('cal-mins').value = m;
        markActiveChip(spec);
        compute();
    }

    function markActiveChip(spec) {
        document.querySelectorAll('#calendar-overlay .cal-chip[data-set]').forEach(b => {
            b.classList.toggle('active', b.dataset.set === spec);
        });
    }

    function compute() {
        const startStr = el('cal-start').value;
        const days  = num(el('cal-days').value);
        const hours = clamp(num(el('cal-hours').value), 0, 23);
        const mins  = clamp(num(el('cal-mins').value),  0, 59);
        el('cal-hours').value = hours;
        el('cal-mins').value  = mins;

        const when = el('cal-result-when');
        const rel  = el('cal-result-rel');

        if (!startStr) {
            endTime = null;
            setLevel('faded', 'clock-countdown');
            when.textContent = '—';
            rel.textContent = 'введи дату и срок';
            return;
        }
        const start = new Date(startStr);
        if (isNaN(start)) {
            endTime = null;
            setLevel('faded', 'warning');
            when.textContent = 'неверная дата';
            rel.textContent = '';
            return;
        }
        const ms = ((days * 24 + hours) * 60 + mins) * 60 * 1000;
        if (ms === 0) {
            endTime = null;
            setLevel('faded', 'clock-countdown');
            when.textContent = 'укажи срок';
            rel.textContent = '';
            return;
        }
        const end = new Date(start.getTime() + ms);
        endTime = end.getTime();
        when.textContent = formatWhen(end);
        renderRelative();
    }

    function renderRelative() {
        if (endTime == null) return;
        const diff = endTime - Date.now();
        const day = 24 * 3600 * 1000;
        const level = diff < 0 ? 'expired' : (diff < day ? 'soon' : 'ok');
        const icon = diff < 0 ? 'warning-octagon' : (diff < day ? 'warning' : 'seal-check');
        setLevel(level, icon);
        const d = new Date(endTime);
        el('cal-result-rel').textContent = relative(diff) + ' · ' + WEEKDAYS[d.getDay()];
    }

    function setLevel(level, icon) {
        const r = el('cal-result');
        if (r) r.className = 'cal-result level-' + level;
        const ic = el('cal-result-ic');
        if (ic) ic.innerHTML = `<i class="ph ph-${icon}"></i>`;
    }

    function formatWhen(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function relative(ms) {
        const past = ms < 0;
        let s = Math.floor(Math.abs(ms) / 1000);
        const d = Math.floor(s / 86400); s -= d * 86400;
        const h = Math.floor(s / 3600);  s -= h * 3600;
        const m = Math.floor(s / 60);    s -= m * 60;
        const prefix = past ? 'прошло ' : 'через ';
        if (d >= 1) {
            const parts = [`${d} ${plural(d, 'день', 'дня', 'дней')}`];
            if (h) parts.push(`${h} ч`);
            return prefix + parts.join(' ');
        }
        if (h >= 1) {
            return prefix + `${h} ч ${m} мин`;
        }
        if (m >= 1) {
            return prefix + `${m} мин ${pad2(s)} с`;
        }
        return prefix + `${s} с`;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function plural(n, one, few, many) {
        n = Math.abs(n) % 100;
        const n1 = n % 10;
        if (n > 10 && n < 20) return many;
        if (n1 > 1 && n1 < 5) return few;
        if (n1 === 1) return one;
        return many;
    }

    function num(v) { return Math.max(0, Math.floor(Number(v) || 0)); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function init() {
        el('calendar-close').addEventListener('click', close);
        el('calendar-reset').addEventListener('click', reset);

        ['cal-start', 'cal-days', 'cal-hours', 'cal-mins'].forEach(id => {
            el(id).addEventListener('input', () => { markActiveChip(null); compute(); });
            el(id).addEventListener('change', compute);
        });

        document.querySelectorAll('[data-start]').forEach(b => {
            b.addEventListener('click', () => setStart(b.dataset.start));
        });
        document.querySelectorAll('[data-set]').forEach(b => {
            b.addEventListener('click', () => setDuration(b.dataset.set));
        });
    }

    return { init, open, close };
})();
