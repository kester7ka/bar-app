const Schedule = (() => {
    
    
    
    const CACHE_KEY = 'bar-app:schedule-cache:v4';
    const CACHE_TTL_MS = 30 * 60 * 1000; 

    
    const RATES = { regular: 420, senior: 440 };

    
    
    const SENIOR_TITLE_RE = /(^|\s)ст\.?(\s|б)|старш/i;

    function isSeniorTitle(title) {
        return !!title && SENIOR_TITLE_RE.test(String(title));
    }
    function rateForTitle(title) {
        return isSeniorTitle(title) ? RATES.senior : RATES.regular;
    }
    function money(n) {
        return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
    }

    const MONTHS = [
        'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
        'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
    ];

    let state = {
        months: [],   
        monthIdx: 0,
        barIdx: 0
    };

    
    const readCache = () => {
        try {
            const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (!c || Date.now() - c.ts > CACHE_TTL_MS) return null;
            return c.data;
        } catch { return null; }
    };

    const writeCache = (data) => {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
        } catch {}
    };

    
    
    
    async function fetchWorkbook() {
        const url = `${Api.BASE}/api/schedule/xlsx`;
        const token = Api.getToken ? Api.getToken() : null;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const fileResp = await fetch(url, { headers });
        if (!fileResp.ok) throw new Error('Сервер не отдал таблицу (бэкенд лежит?)');
        const buf = await fileResp.arrayBuffer();
        if (typeof XLSX === 'undefined') throw new Error('Библиотека таблиц ещё грузится — попробуй ещё раз');
        return XLSX.read(buf, { type: 'array' });
    }

    
    
    
    
    
    
    
    
    const BAR_PREFIX = /^АВ/i;
    const SHIFT_OFF = new Set(['', 'о', 'О', 'в', 'В', '-', '—', null, undefined]);

    
    
    
    const STATUS_WORDS = [
        { key: 'ЗС',           kind: 'vacation-unpaid', label: 'за свой счёт' },
        { key: 'ОТПУСК',       kind: 'vacation-paid',   label: 'отпуск' },
        { key: 'ОТПУСКА',      kind: 'vacation-paid',   label: 'отпуск' },
        { key: 'УВОЛЬНЕНИЕ',   kind: 'fired',           label: 'уволен' },
        { key: 'УВОЛЕН',       kind: 'fired',           label: 'уволен' },
        { key: 'БОЛЬНИЧНЫЙ',   kind: 'sick',            label: 'больничный' },
        { key: 'БОЛЬНИЧНЫИ',   kind: 'sick',            label: 'больничный' },
        { key: 'БОЛЬН',        kind: 'sick',            label: 'больничный' },
        { key: 'БОЛ',          kind: 'sick',            label: 'больничный' },
        { key: 'КОМАНДИРОВКА', kind: 'business-trip',   label: 'командировка' }
    ].sort((a, b) => b.key.length - a.key.length);

    const KIND_LABELS = {
        'hours':            'часы',
        'other-bar':        'другой бар',
        'vacation-unpaid':  'за свой счёт',
        'vacation-paid':    'отпуск',
        'sick':             'больничный',
        'fired':            'уволен',
        'business-trip':    'командировка',
        'off':              'выходной',
        'unknown':          'не распознано'
    };

    
    
    let BAR_SHORT_CODES = new Set();

    function normCode(s) {
        return String(s || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '').replace('Ё', 'Е');
    }
    const MONTH_HEADERS = new Set([
        'ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ',
        'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'
    ]);

    function looksLikeBarHeader(val) {
        if (typeof val !== 'string') return false;
        const s = val.trim();
        if (s.length < 4 || s.length > 80) return false;
        if (!BAR_PREFIX.test(s)) return false;
        if (s.toUpperCase() === 'АВАНС') return false;
        
        const firstWord = s.split(/\s+/)[0].toUpperCase();
        if (MONTH_HEADERS.has(firstWord)) return false;
        return true;
    }

    function parseSheet(ws) {
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
        const bars = [];
        let current = null;
        let dayCols = null;       
        let nameCol = null;       
        let titleCol = null;      

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            
            const firstNonEmpty = row.find(c => typeof c === 'string' && c.trim().length > 0);
            if (looksLikeBarHeader(firstNonEmpty)) {
                if (current && current.employees.length) bars.push(current);
                current = makeBar(firstNonEmpty.trim());
                dayCols = null;
                nameCol = null;
                titleCol = null;
                continue;
            }

            
            if (!dayCols) {
                const idx = row.findIndex(c => String(c).trim().toLowerCase() === 'число');
                if (idx >= 0) {
                    dayCols = {};
                    
                    
                    
                    
                    let expected = 1;
                    for (let c = idx + 1; c < row.length; c++) {
                        const v = Number(row[c]);
                        if (v === expected) {
                            dayCols[c] = v;
                            expected++;
                            if (expected > 31) break;
                        } else if (expected > 1) {
                            
                            break;
                        }
                        
                        
                    }
                    nameCol = guessNameCol(rows, r - 1, idx);
                    titleCol = guessTitleCol(rows, r, idx);
                    continue;
                }
                continue;
            }

            
            if (current && dayCols && nameCol != null) {
                const fio = String(row[nameCol] || '').trim();
                if (!fio || fio.length < 4 || /^\d+$/.test(fio)) continue;
                if (looksLikeBarHeader(fio)) continue;
                const days = {};
                for (const [colIdx, day] of Object.entries(dayCols)) {
                    const raw = row[colIdx];
                    const v = (raw === null || raw === undefined) ? '' : String(raw).trim();
                    if (v) days[day] = v;
                }
                const phone = findPhone(row);
                const title = titleCol != null ? String(row[titleCol] || '').trim() : '';
                current.employees.push({ name: fio, phone, title, days });
            }
        }

        if (current && current.employees.length) bars.push(current);
        return dedupeBars(bars);
    }

    function guessTitleCol(rows, headerRow, dayColStart) {
        
        for (let r = Math.max(0, headerRow - 3); r <= headerRow + 1 && r < rows.length; r++) {
            const row = rows[r] || [];
            for (let c = 0; c < dayColStart; c++) {
                const v = String(row[c] || '').toUpperCase().replace('Ё', 'Е');
                if (v.includes('ДОЛЖНОСТ')) return c;
            }
        }
        
        
        const dataStart = headerRow + 1;
        const TITLE_RE = /бармен|официант|помощ|бариста|ст\.|старш/i;
        const scores = [];
        for (let c = 0; c < dayColStart; c++) {
            let hits = 0;
            for (let r = dataStart; r < Math.min(rows.length, dataStart + 12); r++) {
                const v = String((rows[r] || [])[c] || '').trim();
                if (TITLE_RE.test(v)) hits++;
            }
            if (hits > 0) scores.push({ c, hits });
        }
        scores.sort((a, b) => b.hits - a.hits);
        return scores[0] ? scores[0].c : null;
    }

    function guessNameCol(rows, headerRow, dayColStart) {
        
        for (let r = Math.max(0, headerRow - 1); r <= headerRow + 1 && r < rows.length; r++) {
            const row = rows[r] || [];
            for (let c = 0; c < dayColStart; c++) {
                const v = String(row[c] || '').toUpperCase();
                if (v.includes('ФИО') || v.includes('СОТРУДНИК')) return c;
            }
        }
        
        
        const dataStart = headerRow + 1;
        const scores = [];
        for (let c = 0; c < dayColStart; c++) {
            let score = 0;
            for (let r = dataStart; r < Math.min(rows.length, dataStart + 12); r++) {
                const v = String((rows[r] || [])[c] || '').trim();
                if (!v) continue;
                if (/^\d/.test(v)) continue;                  
                if (/^[+()\d\s\-]+$/.test(v)) continue;       
                if (looksLikeBarHeader(v)) continue;
                const letters = v.replace(/[^A-Za-zА-Яа-яЁё]/g, '').length;
                const hasSpace = /\s/.test(v);
                score += letters + (hasSpace ? 8 : 0);
            }
            scores.push({ c, score });
        }
        scores.sort((a, b) => b.score - a.score);
        return scores[0] && scores[0].score > 0 ? scores[0].c : Math.max(0, dayColStart - 2);
    }

    function findPhone(row) {
        for (const c of row) {
            const s = String(c || '');
            if (/^[\d\s()+\-]{10,}$/.test(s) && /\d{6,}/.test(s)) return s.trim();
        }
        return null;
    }

    function makeBar(rawHeader) {
        
        const code = rawHeader
            .replace(/\(.*?\)/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return { name: rawHeader, code, employees: [] };
    }

    

    
    function matchStatus(word) {
        const n = word.replace('Ё', 'Е');
        for (const s of STATUS_WORDS) {
            if (n === s.key) return s;
            if (n.length >= 2 && (n.startsWith(s.key) || s.key.startsWith(n))) return s;
        }
        return null;
    }

    
    
    function classifyDays(rawDays, dayList) {
        const out = {};
        let i = 0;
        while (i < dayList.length) {
            const d = dayList[i];
            const raw = String(rawDays[d] ?? '').trim();

            if (!raw || SHIFT_OFF.has(raw)) {
                out[d] = { kind: 'off', label: raw };
                i++; continue;
            }

            
            const numMatch = raw.match(/^(\d+(?:[.,]\d+)?)\s*ч?$/i);
            if (numMatch) {
                out[d] = { kind: 'hours', hours: parseFloat(numMatch[1].replace(',', '.')), label: raw };
                i++; continue;
            }

            
            const norm = normCode(raw);
            if (norm.length >= 2 && BAR_SHORT_CODES.has(norm)) {
                out[d] = { kind: 'other-bar', code: raw, label: raw };
                i++; continue;
            }

            
            if (/^[А-ЯЁа-яёA-Za-z]$/.test(raw)) {
                let j = i;
                let word = '';
                while (j < dayList.length) {
                    const v = String(rawDays[dayList[j]] ?? '').trim();
                    if (!/^[А-ЯЁа-яёA-Za-z]$/.test(v)) break;
                    word += v.toUpperCase();
                    j++;
                }
                if (j - i >= 2) {
                    const m = matchStatus(word);
                    if (m) {
                        for (let k = i; k < j; k++) {
                            out[dayList[k]] = { kind: m.kind, statusLabel: m.label, label: String(rawDays[dayList[k]]).trim() };
                        }
                    } else {
                        for (let k = i; k < j; k++) {
                            out[dayList[k]] = { kind: 'unknown', label: String(rawDays[dayList[k]]).trim() };
                        }
                    }
                    i = j; continue;
                }
            }

            out[d] = { kind: 'unknown', label: raw };
            i++;
        }
        return out;
    }

    function dedupeBars(bars) {
        
        const map = new Map();
        for (const b of bars) {
            const key = b.code.toLowerCase();
            if (!map.has(key)) {
                map.set(key, b);
            } else {
                const existing = map.get(key);
                const seen = new Set(existing.employees.map(e => e.name.toLowerCase()));
                for (const e of b.employees) {
                    if (!seen.has(e.name.toLowerCase())) existing.employees.push(e);
                }
            }
        }
        return Array.from(map.values());
    }

    
    function parseWorkbook(wb) {
        const months = wb.SheetNames.map(name => {
            const ws = wb.Sheets[name];
            const bars = parseSheet(ws);
            return { key: name, label: prettyMonth(name), bars };
        }).filter(m => m.bars.length > 0);

        
        
        BAR_SHORT_CODES = new Set();
        for (const m of months) {
            for (const b of m.bars) {
                const full = normCode(b.code);             
                const short = full.replace(/^АВ/, '');     
                if (full) BAR_SHORT_CODES.add(full);
                if (short && short.length >= 2) BAR_SHORT_CODES.add(short);
            }
        }

        
        for (const m of months) {
            for (const b of m.bars) {
                const days = collectDays(b);
                for (const e of b.employees) {
                    e.classified = classifyDays(e.days, days);
                }
            }
        }

        return { months, fetchedAt: Date.now() };
    }

    function prettyMonth(name) {
        return name.trim().replace(/\s+/g, ' ');
    }

    
    function open() {
        document.getElementById('schedule-overlay').classList.add('show');
        load(false);
    }

    function close() {
        document.getElementById('schedule-overlay').classList.remove('show');
    }

    async function load(force) {
        const body = document.getElementById('schedule-body');
        if (!force) {
            const cached = readCache();
            if (cached) {
                state.months = cached.months;
                pickCurrentMonth();
                render();
                return;
            }
        }
        body.innerHTML = `
            <div class="schedule-loading">
                <div class="spinner"></div>
                <p class="muted">Загружаем график…</p>
            </div>`;
        try {
            const wb = await fetchWorkbook();
            const data = parseWorkbook(wb);
            writeCache(data);
            state.months = data.months;
            pickCurrentMonth();
            render();
        } catch (e) {
            body.innerHTML = `
                <div class="schedule-error">
                    <strong>Не получилось загрузить график.</strong><br>
                    ${Utils.escape(e.message || 'неизвестная ошибка')}<br><br>
                    Проверь интернет и доступность таблицы.
                </div>`;
        }
    }

    function pickCurrentMonth() {
        const now = new Date();
        const want = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
        const idx = state.months.findIndex(m => m.label.toLowerCase().includes(want));
        state.monthIdx = idx >= 0 ? idx : (state.months.length - 1);
        state.barIdx = 0;
    }

    function render() {
        const body = document.getElementById('schedule-body');
        const month = state.months[state.monthIdx];
        if (!month) {
            body.innerHTML = `<p class="empty-text">В таблице нет данных.</p>`;
            return;
        }

        document.getElementById('schedule-month-label').textContent = month.label;

        
        
        const lockToBar = Auth.isAuthed?.() && !Auth.isAdmin?.();
        const userBar = lockToBar ? Auth.bar() : null;
        const visibleBars = userBar
            ? month.bars.filter(b => matchesBar(b, userBar))
            : month.bars;

        if (visibleBars.length === 0) {
            body.innerHTML = `
                <p class="empty-text">
                    В этом месяце в графике нет твоего бара (${Utils.escape(userBar?.code || '')}).
                </p>`;
            return;
        }

        if (state.barIdx >= visibleBars.length) state.barIdx = 0;
        const bar = visibleBars[state.barIdx];
        const todayDate = new Date();
        const today = monthMatchesNow(month) ? todayDate.getDate() : null;
        const days = collectDays(bar);

        
        
        const todayPeople = today
            ? bar.employees.filter(e => (e.classified?.[today]?.kind) === 'hours')
            : [];

        body.innerHTML = `
            ${userBar ? '' : `
            <div class="bar-select" id="bar-select">
                ${visibleBars.map((b, i) => `
                    <button class="bar-chip ${i === state.barIdx ? 'active' : ''}" data-idx="${i}">
                        ${Utils.escape(b.code)}
                    </button>
                `).join('')}
            </div>`}

            ${today ? `
            <div class="today-block">
                <div class="today-head">
                    <h3>Сегодня · ${today} ${MONTHS[todayDate.getMonth()]}</h3>
                    ${todayPeople.length ? `<span class="today-total" id="today-total">${money(totalPayToday(todayPeople, today))}</span>` : ''}
                </div>
                ${todayPeople.length === 0
                    ? '<p class="empty-today">Никто не выходит</p>'
                    : `<div class="today-people">${todayPeople.map(e => personRow(e, today)).join('')}</div>`}
                ${todayPeople.length ? `
                    <p class="pay-note">
                        Цифры <b>очень приблизительные</b> и показаны <b>до вычета налогов</b>.
                        Реальная сумма зависит от оценки смены, активных продаж, бонусов
                        и других факторов — поэтому считай это ориентиром, а не точной выплатой.
                        Базовые ставки: обычный — ${RATES.regular} ₽/ч, старший — ${RATES.senior} ₽/ч.
                    </p>` : ''}
            </div>` : ''}

            <div class="schedule-grid-wrap">
                <div class="schedule-grid-head">
                    <h3>${Utils.escape(bar.name)}</h3>
                    <span class="muted">${bar.employees.length} чел · ${days.length} дн</span>
                </div>
                <div class="schedule-grid-scroll">
                    <table class="schedule-grid">
                        <thead>
                            <tr>
                                <th class="col-name">Сотрудник</th>
                                ${days.map(d => `<th class="${d === today ? 'today' : ''}">${d}</th>`).join('')}
                                <th class="col-summary advance">Аванс<span>1–15</span></th>
                                <th class="col-summary salary">Зарплата<span>весь месяц</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${bar.employees.map(e => rowHtml(e, days, today)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="legend">
                <span class="legend-row"><b>цифры</b> — часы работы в этом баре</span>
                <span class="legend-row"><b class="dot other-bar"></b> код типа ПМ58 — работал в другом баре</span>
                <span class="legend-row"><b class="dot vacation-unpaid"></b> «З» + «С» по соседним дням — за свой счёт</span>
                <span class="legend-row"><b class="dot vacation-paid"></b> «О-Т-П-У-С-К» — отпуск</span>
                <span class="legend-row"><b class="dot sick"></b> «Б-О-Л…» — больничный</span>
                <span class="legend-row">«о», «в», пусто — выходной</span>
            </div>
        `;

        document.querySelectorAll('#bar-select .bar-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                state.barIdx = Number(chip.dataset.idx);
                render();
            });
        });

    }

    function monthMatchesNow(month) {
        const now = new Date();
        const want = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
        return month.label.toLowerCase().includes(want);
    }

    
    function matchesBar(scheduleBar, userBar) {
        const a = normCode(scheduleBar.code);
        const b = normCode(userBar.code);
        const bShort = normCode(userBar.short_code || '');
        
        return a === b || (bShort && (a.endsWith(bShort) || a.replace(/^АВ/, '') === bShort));
    }

    function collectDays(bar) {
        const set = new Set();
        bar.employees.forEach(e => Object.keys(e.days).forEach(d => set.add(Number(d))));
        
        if (set.size === 0) for (let i = 1; i <= 31; i++) set.add(i);
        return Array.from(set).sort((a, b) => a - b);
    }

    function rowHtml(emp, days, today) {
        let advance = 0;
        let salary = 0;
        for (const d of days) {
            const c = emp.classified?.[d];
            if (c?.kind === 'hours') {
                const h = c.hours || 0;
                salary += h;
                if (d <= 15) advance += h;
            }
        }
        const fmt = (n) => n ? (Math.round(n * 10) / 10).toString() : '';

        return `<tr>
            <td class="col-name" title="${Utils.escape(emp.name)}">${Utils.escape(formatName(emp.name))}</td>
            ${days.map(d => {
                const c = emp.classified?.[d] || { kind: 'off', label: '' };
                const title = KIND_LABELS[c.kind] + (c.statusLabel ? ` · ${c.statusLabel}` : '');
                return `<td class="cell-${c.kind} ${d === today ? 'today' : ''}" title="${Utils.escape(title)}">${Utils.escape(c.label || '')}</td>`;
            }).join('')}
            <td class="col-summary advance" title="часы за 1–15 (аванс)">${fmt(advance)}</td>
            <td class="col-summary salary" title="часы за весь месяц (зарплата)">${fmt(salary)}</td>
        </tr>`;
    }

    function formatName(full) {
        const parts = full.trim().split(/\s+/);
        if (parts.length < 2) return full;
        
        const surname = capitalize(parts[0]);
        const initial = parts[1][0];
        return `${surname} ${initial}.`;
    }

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }

    function personRow(e, today) {
        const initial = (e.name.trim()[0] || '?').toUpperCase();
        const fio = formatFull(e.name);
        const c = e.classified?.[today];
        const hours = c?.kind === 'hours' ? c.hours : 0;
        const rate = rateForTitle(e.title);
        const senior = isSeniorTitle(e.title);
        const pay = hours * rate;
        const meta = [
            `${hours} ч`,
            `${rate} ₽/ч`,
            senior ? 'старший' : (e.title || null),
            e.phone || null
        ].filter(Boolean).join(' · ');
        return `
            <div class="person-row">
                <div class="person-avatar">${Utils.escape(initial)}</div>
                <div class="person-info">
                    <div class="person-name">${Utils.escape(fio)}</div>
                    <div class="person-shift">${Utils.escape(meta)}</div>
                </div>
                <span class="person-pay">${money(pay)}</span>
            </div>
        `;
    }

    function totalPayToday(people, today) {
        return people.reduce((s, e) => {
            const c = e.classified?.[today];
            const h = c?.kind === 'hours' ? c.hours : 0;
            return s + h * rateForTitle(e.title);
        }, 0);
    }

    function formatFull(full) {
        return full.split(/\s+/).map(capitalize).join(' ');
    }

    
    let lastRefresh = 0;
    const MIN_REFRESH_INTERVAL = 60 * 1000;

    
    function init() {
        ['bar-app:schedule-cache', 'bar-app:schedule-cache:v2', 'bar-app:schedule-cache:v3', 'bar-app:senior-set']
            .forEach(k => localStorage.removeItem(k));
        document.getElementById('schedule-close').addEventListener('click', close);
        document.getElementById('schedule-refresh').addEventListener('click', () => {
            const elapsed = Date.now() - lastRefresh;
            if (elapsed < MIN_REFRESH_INTERVAL) {
                const readyAt = lastRefresh + MIN_REFRESH_INTERVAL;
                Utils.toast(() => {
                    const sec = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
                    return sec > 0 ? `Обновить можно через ${sec} сек` : 'Можно обновлять';
                }, { ttl: 4000 });
                return;
            }
            lastRefresh = Date.now();
            localStorage.removeItem(CACHE_KEY);
            load(true);
        });
    }

    return { init, open, close };
})();
