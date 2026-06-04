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

    function open() {
        el('calendar-overlay').classList.add('show');
        
        if (!el('cal-start').value) {
            el('cal-start').value = Utils.localISO(new Date());
            el('cal-days').value = 1;
        }
        compute();
    }

    function close() {
        el('calendar-overlay').classList.remove('show');
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

    
    function addPreset(spec) {
        const [d, h, m] = spec.split(':').map(n => Number(n) || 0);
        const days = clamp(num(el('cal-days').value) + d, 0, 99999);
        const hours = num(el('cal-hours').value) + h;
        const mins  = num(el('cal-mins').value)  + m;
        
        const totalMin = days * 24 * 60 + hours * 60 + mins;
        const nd = Math.floor(totalMin / (24 * 60));
        const rest = totalMin % (24 * 60);
        const nh = Math.floor(rest / 60);
        const nm = rest % 60;
        el('cal-days').value = nd;
        el('cal-hours').value = nh;
        el('cal-mins').value = nm;
        compute();
    }

    

    function compute() {
        const startStr = el('cal-start').value;
        const days  = num(el('cal-days').value);
        const hours = clamp(num(el('cal-hours').value), 0, 23);
        const mins  = clamp(num(el('cal-mins').value),  0, 59);
        el('cal-hours').value = hours;
        el('cal-mins').value  = mins;

        const result = el('cal-result');
        const when = el('cal-result-when');
        const rel  = el('cal-result-rel');

        if (!startStr) {
            result.classList.remove('expired');
            result.classList.add('faded');
            when.textContent = '—';
            rel.textContent  = 'введи дату и срок';
            return;
        }

        const start = new Date(startStr);
        if (isNaN(start)) {
            result.classList.add('faded');
            when.textContent = 'неверная дата';
            rel.textContent  = '';
            return;
        }

        const ms = ((days * 24 + hours) * 60 + mins) * 60 * 1000;
        if (ms === 0) {
            result.classList.add('faded');
            when.textContent = 'укажи срок';
            rel.textContent  = '';
            return;
        }

        const end = new Date(start.getTime() + ms);
        result.classList.remove('faded');

        when.textContent = formatWhen(end);

        const diff = end.getTime() - Date.now();
        result.classList.toggle('expired', diff < 0);
        rel.textContent = relative(diff) + ' · ' + WEEKDAYS[end.getDay()];
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
        const m = Math.floor(s / 60);
        const parts = [];
        if (d) parts.push(`${d} ${plural(d, 'день', 'дня', 'дней')}`);
        if (h) parts.push(`${h} ${plural(h, 'час', 'часа', 'часов')}`);
        if (m && !d) parts.push(`${m} ${plural(m, 'минута', 'минуты', 'минут')}`);
        if (parts.length === 0) parts.push('меньше минуты');
        return (past ? 'прошло ' : 'через ') + parts.join(' ');
    }

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
            el(id).addEventListener('input', compute);
            el(id).addEventListener('change', compute);
        });

        document.querySelectorAll('[data-start]').forEach(b => {
            b.addEventListener('click', () => setStart(b.dataset.start));
        });
        document.querySelectorAll('[data-add]').forEach(b => {
            b.addEventListener('click', () => addPreset(b.dataset.add));
        });
    }

    return { init, open, close };
})();
