const Utils = (() => {
    const CATEGORIES = {
        ingredients: 'Ингредиенты',
        syrups: 'Сиропы',
        cookies: 'Печенье',
        other: 'Прочее'
    };

    const uuid = () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });

    
    const generateTob = () => {
        let result = '';
        for (let i = 0; i < 6; i++) result += Math.floor(Math.random() * 10);
        return result;
    };

    const isValidTob = (s) => /^\d{6}$/.test(String(s || '').trim());

    const today = () => new Date().toISOString().slice(0, 10);

    const addDays = (dateStr, days) => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + days);
        return d.toISOString().slice(0, 10);
    };

    
    
    
    const localISO = (d) => {
        const x = new Date(d);
        const pad = (n) => String(n).padStart(2, '0');
        return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
    };

    
    
    const toDateTime = (s) => {
        const str = String(s || '');
        if (str.length >= 16) return str.slice(0, 16);
        if (str.length === 10) return `${str}T23:59`;
        return str;
    };

    
    
    const effectiveExpiry = (position) => {
        const closed = toDateTime(position.expiry_closed);
        if (position.is_open && position.opened_at && position.shelf_open_days) {
            const openExp = toDateTime(addDays(position.opened_at, position.shelf_open_days));
            return openExp < closed ? openExp : closed;
        }
        return closed;
    };

    
    const dateOnly = (s) => String(s || '').slice(0, 10);

    const daysUntil = (dateStr) => {
        
        
        const t = new Date(today());
        const d = new Date(dateOnly(dateStr));
        return Math.round((d - t) / (1000 * 60 * 60 * 24));
    };

    const expiryLabel = (position) => {
        const exp = effectiveExpiry(position);
        const days = daysUntil(exp);
        if (days < 0) return { text: `некондиция · ${Math.abs(days)} дн`, level: 'expired' };
        if (days === 0) return { text: 'некондиция · сегодня', level: 'expired' };
        if (days === 1) return { text: 'истекает завтра', level: 'expiring-soon' };
        if (days <= 3) return { text: `${days} дн до истечения`, level: 'expiring-soon' };
        return { text: `до ${formatDateShort(exp)}`, level: 'ok' };
    };

    const formatDateShort = (dateStr) => {
        const d = new Date(dateStr);
        const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${d.getDate()} ${months[d.getMonth()]}`;
    };

    const formatDateFull = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    
    const formatDateTimeFull = (dateStr) => {
        const s = String(dateStr || '');
        const date = formatDateFull(s);
        if (s.length < 16) return date;
        const time = s.slice(11, 16);
        
        
        if (time === '23:59') return date;
        return `${date} · ${time}`;
    };

    const greeting = () => {
        const h = new Date().getHours();
        if (h >= 5 && h < 12) return 'Доброе утро';
        if (h >= 12 && h < 17) return 'Добрый день';
        if (h >= 17 && h < 23) return 'Добрый вечер';
        return 'Доброй ночи';
    };

    const dateLine = () => {
        const d = new Date();
        const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
        const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
    };

    const toast = (msg, opts = {}) => {
        const el = document.getElementById('toast');
        if (el._tick) { clearInterval(el._tick); el._tick = null; }
        const render = typeof msg === 'function' ? msg : () => msg;
        el.textContent = render();
        el.classList.add('show');
        clearTimeout(el._t);
        const ttl = opts.ttl || 2200;
        if (typeof msg === 'function') {
            el._tick = setInterval(() => {
                if (!el.classList.contains('show')) {
                    clearInterval(el._tick); el._tick = null; return;
                }
                el.textContent = render();
            }, opts.interval || 1000);
        }
        el._t = setTimeout(() => {
            el.classList.remove('show');
            if (el._tick) { clearInterval(el._tick); el._tick = null; }
        }, ttl);
    };


    const escape = (str) =>
        String(str ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));

    const pluralDay = (n) => {
        const abs = Math.abs(n) % 100;
        const last = abs % 10;
        if (abs >= 11 && abs <= 14) return 'дней';
        if (last === 1) return 'день';
        if (last >= 2 && last <= 4) return 'дня';
        return 'дней';
    };

    const openedAgo = (opened_at) => {
        if (!opened_at) return 'открыта';
        const days = Math.round(
            (new Date(today()) - new Date(dateOnly(opened_at))) / 86400000
        );
        if (days <= 0) return 'открыта сегодня';
        if (days === 1) return 'открыта вчера';
        return `открыта ${days} ${pluralDay(days)} назад`;
    };

    return {
        CATEGORIES,
        uuid,
        generateTob,
        isValidTob,
        today,
        addDays,
        localISO,
        toDateTime,
        dateOnly,
        effectiveExpiry,
        formatDateTimeFull,
        daysUntil,
        expiryLabel,
        formatDateShort,
        formatDateFull,
        greeting,
        dateLine,
        toast,
        escape,
        pluralDay,
        openedAgo
    };
})();
