const Positions = (() => {
    let activeCategory = 'all';
    let searchQuery = '';
    let editingId = null;

    const render = () => {
        const c = document.getElementById('positions-list');
        if (!c) return;
        try {
            const list = Storage.list();

            const tobDup = {};
            const openByName = {};
            for (const p of list) {
                if (!p || p.category !== 'syrups') continue;
                if (p.tob) tobDup[p.tob] = (tobDup[p.tob] || 0) + 1;
                if (p.is_open && p.name) {
                    const k = String(p.name).trim().toLowerCase();
                    openByName[k] = (openByName[k] || 0) + 1;
                }
            }

            const filtered = list
                .filter(p => p && (activeCategory === 'all' || p.category === activeCategory))
                .filter(p => {
                    if (!searchQuery) return true;
                    const q = searchQuery.toLowerCase();
                    const name = String(p.name || '').toLowerCase();
                    const tob = String(p.tob || '').toLowerCase();
                    return name.includes(q) || tob.includes(q);
                })
                .sort((a, b) => {
                    const ea = String(Utils.effectiveExpiry(a) || '');
                    const eb = String(Utils.effectiveExpiry(b) || '');
                    return ea.localeCompare(eb);
                });

            if (filtered.length === 0) {
                c.innerHTML = `<p class="empty-text">${list.length === 0 ? 'Нет позиций. Добавь первую с помощью + сверху.' : 'Ничего не найдено'}</p>`;
                return;
            }
            c.innerHTML = filtered.map(p => {
                try { return cardHtml(p, { syrupDups: tobDup, openByName }); }
                catch (e) { console.error('cardHtml failed for', p, e); return ''; }
            }).join('');
            c.querySelectorAll('.position-card').forEach(card => {
                card.addEventListener('click', () => openDetails(card.dataset.id));
            });
        } catch (e) {
            console.error('Positions render failed', e);
            c.innerHTML = `<p class="empty-text">Не удалось показать список. Проверь консоль.</p>`;
        }
    };

    
    function syrupWarning(p, tobDup, openByName) {
        if (p.category !== 'syrups') return null;
        const dupTob   = (tobDup[p.tob] || 0) > 1;
        const dupOpen  = p.is_open && (openByName[p.name.trim().toLowerCase()] || 0) > 1;
        if (dupOpen) return 'две открытые';
        if (dupTob)  return 'дубликат TOB';
        return null;
    }

    
    
    const cardHtml = (p, ctx = {}) => {
        const tobDup = ctx.syrupDups || {};
        const openByName = ctx.openByName || {};

        const exp = Utils.expiryLabel(p);
        const effExp = Utils.effectiveExpiry(p);
        const days = Utils.daysUntil(effExp);

        const statusCls = p.is_open ? 'open' : (exp.level !== 'ok' ? exp.level : '');
        const cardCls = exp.level !== 'ok' ? exp.level : '';
        const counterCls = exp.level !== 'ok' ? exp.level : '';

        const warn = syrupWarning(p, tobDup, openByName);
        const warnBadge = warn
            ? `<span class="dup-warn" title="нарушение использования товара">⚠ ${Utils.escape(warn)}</span>`
            : '';

        const sign = days < 0 ? '−' : '';
        const absDays = Math.abs(days);
        const unit = Utils.pluralDay(absDays);
        const dateStr = Utils.formatDateShort(effExp);

        const openInfo = p.is_open ? Utils.openedAgo(p.opened_at) : null;
        const catLabel = Utils.CATEGORIES[p.category] || '';

        const hmarkBadge = p.honest_mark
            ? '<span class="pos-hmark" title="Честный Знак привязан">ЧЗ</span>'
            : '';

        return `
            <div class="position-card ${cardCls} ${warn ? 'has-warn' : ''}" data-id="${p.id}">
                <div class="position-status ${statusCls}"></div>
                <div class="position-info">
                    <div class="position-name">${Utils.escape(p.name)}${hmarkBadge}</div>
                    <div class="position-meta">
                        <span class="tob-tag">${Utils.escape(p.tob)}</span>
                        <span class="pos-sep">·</span>
                        <span class="pos-cat">${Utils.escape(catLabel)}</span>
                        ${openInfo ? `<span class="pos-sep">·</span><span class="pos-open-tag">${Utils.escape(openInfo)}</span>` : ''}
                        ${warnBadge ? `<span class="pos-meta-line"></span>${warnBadge}` : ''}
                    </div>
                </div>
                <div class="position-aside">
                    <div class="position-counter ${counterCls}">
                        <span class="position-counter-n">${sign}${absDays}</span>
                        <span class="position-counter-u">${unit}</span>
                    </div>
                    <div class="position-date">${dateStr}</div>
                </div>
            </div>
        `;
    };

    
    const CAT_HINTS = {
        ingredients: 'Можно держать <b>сколько угодно открытых</b>. Срок после вскрытия учитывается, если указан.',
        syrups:      '<b>До 2 открытых</b> одновременно. Вторая помечается «⚠ две открытые». Срок после вскрытия учитывается.',
        cookies:     'Хранится <b>только закрытым</b> — поля «после вскрытия» и «открыть» не нужны.',
        other:       '<b>Без специальных правил</b>: лимит открытых не ограничен.'
    };

    
    function applyCategoryRules() {
        const form = document.getElementById('position-form');
        const cat = form.category.value;
        const isCookies = cat === 'cookies';

        form.querySelectorAll('.hide-for-cookies').forEach(el => {
            el.classList.toggle('hidden', isCookies);
        });
        if (isCookies) {
            form.is_open.checked = false;
        }

        const hint = document.getElementById('cat-hint');
        if (hint) hint.innerHTML = CAT_HINTS[cat] || '';

        updateSubmitLabel();
    }

    
    function setProduction(value) {
        const s = String(value || '');
        const date = s.slice(0, 10);
        const time = s.length >= 16 ? s.slice(11, 16) : '12:00';
        const dEl = document.getElementById('production-date');
        const tEl = document.getElementById('production-time');
        if (dEl) dEl.value = date;
        if (tEl) tEl.value = time;
        syncTimeChips(time);
        updateExpiryPreview();
    }

    
    function syncTimeChips(time) {
        document.querySelectorAll('#time-presets .time-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.time === time);
        });
    }

    
    function updateExpiryPreview() {
        const out = document.getElementById('expiry-preview');
        const valEl = document.getElementById('ep-value');
        if (!out || !valEl) return;
        const pd = document.getElementById('production-date').value;
        const pt = document.getElementById('production-time').value || '12:00';
        const cd = Number(document.getElementById('closed-shelf-days').value);
        if (!pd || !cd || cd < 1) {
            valEl.textContent = 'укажи дату и срок';
            out.classList.remove('ready');
            return;
        }
        const d = new Date(`${pd}T${pt}`);
        if (isNaN(d.getTime())) {
            valEl.textContent = '—';
            out.classList.remove('ready');
            return;
        }
        d.setDate(d.getDate() + cd);
        valEl.textContent = formatPreview(d);
        out.classList.add('ready');
    }

    function formatPreview(d) {
        const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
        const pad = (n) => String(n).padStart(2, '0');
        const date = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return time === '23:59' ? date : `${date}, ${time}`;
    }

    
    function formatProductionDate(s) {
        const d = new Date(String(s || ''));
        if (isNaN(d.getTime())) return '—';
        const pad = (n) => String(n).padStart(2, '0');
        const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return `${date} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    
    
    
    function applyExpiryFields(position) {
        const sd = document.getElementById('closed-shelf-days');
        if (position?.production_date && position?.closed_shelf_days) {
            setProduction(position.production_date);
            sd.value = position.closed_shelf_days;
            updateExpiryPreview();
            return;
        }
        const today = Utils.today();
        const exp = String(position?.expiry_closed || '');
        const expDate = exp.slice(0, 10) || today;
        const expTime = exp.length >= 16 ? exp.slice(11, 16) : '23:59';
        const days = Math.max(1, Math.round(
            (new Date(expDate) - new Date(today)) / 86400000
        ));
        setProduction(`${today}T${expTime}`);
        sd.value = days;
        updateExpiryPreview();
    }

    
    
    function setCategory(cat) {
        const form = document.getElementById('position-form');
        if (!form || !cat) return;
        form.category.value = cat;
        document.querySelectorAll('#category-chips .cat-chip').forEach(c => {
            const active = c.dataset.cat === cat;
            c.classList.toggle('active', active);
            c.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        applyCategoryRules();
    }

    
    let pendingDraft = null;
    let kbStashedDays = null;

    function parseShelfDays(life) {
        if (!life) return null;
        const s = String(life).toLowerCase();
        let m;
        if ((m = s.match(/(\d+)\s*суток/)))                       return parseInt(m[1], 10);
        if ((m = s.match(/(\d+)\s*(?:дней|дня|день)/)))           return parseInt(m[1], 10);
        if ((m = s.match(/(\d+)\s*(?:часов|часа|час)/))) {
            const h = parseInt(m[1], 10);
            return Math.max(1, Math.round(h / 24));
        }
        if ((m = s.match(/(\d+)\s*(?:месяцев|месяца|месяц)/)))    return parseInt(m[1], 10) * 30;
        return null;
    }

    function findInKB(digits) {
        if (!digits || digits.length < 6) return null;
        const merged = (typeof KB !== 'undefined' && KB.getMerged) ? KB.getMerged() : KB_DATA;
        for (const section of ['shelf', 'tov']) {
            const groups = merged[section] || [];
            for (const g of groups) {
                for (const it of g.items) {
                    if (!it.tov) continue;
                    const d = String(it.tov).replace(/^[А-Яа-яA-Za-z]+/, '').trim();
                    if (d === digits) {
                        return { name: it.name || null, life: it.life || null, group: g.group };
                    }
                }
            }
        }
        return null;
    }

    function tryKbAutofill(digits, opts = {}) {
        const hint = document.getElementById('tob-kb-hint');
        const nameInput = document.querySelector('#position-form input[name="name"]');
        if (!hint) return;
        if (!digits || digits.length < 6) {
            hint.textContent = '';
            hint.classList.remove('hit');
            kbStashedDays = null;
            return;
        }
        let hit = null;
        try { hit = findInKB(digits); } catch (e) { console.error('KB lookup failed', e); }
        if (!hit) {
            hint.textContent = 'в базе знаний не найдено';
            hint.classList.remove('hit');
            kbStashedDays = null;
            return;
        }
        hint.classList.add('hit');
        if (nameInput && hit.name && !nameInput.value.trim()) {
            nameInput.value = hit.name;
        }
        const days = parseShelfDays(hit.life);
        kbStashedDays = days;
        const bits = ['✓ ' + (hit.name || 'из базы')];
        if (hit.life) bits.push('после вскрытия: ' + hit.life);
        hint.textContent = bits.join(' · ');
        if (!opts.silent && !opts.quiet) Utils.toast('Подтянуто из базы знаний');
    }

    const openModal = (position = null) => {
        editingId = position ? position.id : null;
        const modal = document.getElementById('position-modal');
        const form = document.getElementById('position-form');
        form.reset();
        resetSteps();
        pendingBarcode = null;
        showHonestMark(position?.honest_mark || '');
        document.getElementById('modal-title').textContent = position ? 'Редактировать позицию' : 'Новая позиция';

        kbStashedDays = null;
        const hint = document.getElementById('tob-kb-hint');
        if (hint) { hint.textContent = ''; hint.classList.remove('hit'); }

        if (position) {
            form.name.value = position.name;
            form.tob.value = position.tob;

            form.is_open.checked = position.is_open;
            applyExpiryFields(position);
            setCategory(position.category);
            tryKbAutofill(position.tob, { silent: true });
        } else {
            form.tob.value = '';

            setProduction(`${Utils.today()}T12:00`);
            document.getElementById('closed-shelf-days').value = 30;
            updateExpiryPreview();
            setCategory('ingredients');
        }

        modal.classList.add('show');
    };

    const closeModal = (id) => {
        document.getElementById(id).classList.remove('show');
    };

    
    const BARCODES_KEY = 'bar-app:barcodes';
    let pendingBarcode = null;

    function loadBarcodes() {
        try { return JSON.parse(localStorage.getItem(BARCODES_KEY) || '{}'); }
        catch { return {}; }
    }

    function rememberBarcode(code, data) {
        if (!code) return;
        const all = loadBarcodes();
        all[code] = data;
        try { localStorage.setItem(BARCODES_KEY, JSON.stringify(all)); } catch {}
    }

    function looksLikeHonestMark(code) {
        const c = String(code || '');
        if (/\x1d/.test(c)) return true;
        if (/^01\d{14}/.test(c)) return true;
        if (c.length >= 20 && /\d/.test(c) && /[a-zA-Z]/.test(c)) return true;
        return false;
    }

    function applyBarcodeToForm(code) {
        const saved = loadBarcodes()[code] || null;
        openModal();
        pendingBarcode = code;
        if (saved) {
            const form = document.getElementById('position-form');
            form.name.value = saved.name || '';
            if (saved.tob) form.tob.value = saved.tob;
            if (saved.category) setCategory(saved.category);
            Utils.toast(`Подтянуто: ${saved.name}`);
        } else {
            Utils.toast('Новый штрихкод — заполни и сохрани');
        }
    }

    function startScan() {
        Scanner.open((code) => {
            if (!code) return;
            if (looksLikeHonestMark(code)) {
                handleHonestMarkResult(code, {});
            } else {
                applyBarcodeToForm(code);
            }
        });
    }

    function parseHonestMarkInfo(code) {
        const c = String(code || '');
        const info = { gtin: null, production_date: null, expiry_date: null };
        const gtin = c.match(/^01(\d{14})/);
        if (gtin) info.gtin = gtin[1];
        const grabDate = (ai) => {
            const re = new RegExp('(?:^|\\x1d|[^0-9])' + ai + '(\\d{6})');
            const m = c.match(re);
            if (!m) return null;
            const yy = +m[1].slice(0, 2);
            const mm = +m[1].slice(2, 4);
            const dd = +m[1].slice(4, 6);
            if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
            const pad = (n) => String(n).padStart(2, '0');
            return `${2000 + yy}-${pad(mm)}-${pad(dd)}`;
        };
        info.production_date = grabDate('11');
        info.expiry_date = grabDate('17');
        return info;
    }

    function showHonestMark(code) {
        const inp = document.getElementById('hmark-input');
        const disp = document.getElementById('hmark-display');
        const clr = document.getElementById('btn-clear-hmark');
        if (!inp || !disp) return;
        inp.value = code || '';
        disp.value = code ? (code.length > 40 ? code.slice(0, 18) + '…' + code.slice(-12) : code) : '';
        clr?.classList.toggle('hidden', !code);
    }

    function applyHonestMarkToForm(code) {
        showHonestMark(code);
        const info = parseHonestMarkInfo(code);
        const pd = document.getElementById('production-date');
        const pt = document.getElementById('production-time');
        const cd = document.getElementById('closed-shelf-days');
        if (!pd || !pt || !cd) return info;

        if (info.production_date) {
            pd.value = info.production_date;
            if (!pt.value) pt.value = '12:00';
        }
        if (info.expiry_date) {
            const baseStr = pd.value || info.production_date;
            if (baseStr) {
                const base = new Date(baseStr);
                const exp = new Date(info.expiry_date);
                if (!isNaN(base.getTime()) && !isNaN(exp.getTime())) {
                    const days = Math.max(1, Math.round((exp - base) / 86400000));
                    cd.value = days;
                }
            } else {
                const today = new Date();
                today.setHours(12, 0, 0, 0);
                const exp = new Date(info.expiry_date);
                if (!isNaN(exp.getTime())) {
                    const pad = (n) => String(n).padStart(2, '0');
                    pd.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
                    pt.value = '12:00';
                    cd.value = Math.max(1, Math.round((exp - today) / 86400000));
                }
            }
        }
        if (typeof updateExpiryPreview === 'function') updateExpiryPreview();
        return info;
    }

    async function handleHonestMarkResult(code, opts = {}) {
        if (!code) return;
        if (!opts.skipOpenModal) openModal();
        setCategory('cookies');
        const local = applyHonestMarkToForm(code);

        const parts = ['Код привязан'];
        if (local.production_date) parts.push('произведено ' + local.production_date);
        if (local.expiry_date) parts.push('до ' + local.expiry_date);
        if (!local.production_date && !local.expiry_date) {
            parts.push('даты в коде нет — введи вручную');
        }
        Utils.toast(parts.join(' · '));

        try {
            const r = await Api.post('/api/honest-mark/info', { code });
            if (r && r.ok && r.info && r.info.name) {
                const form = document.getElementById('position-form');
                if (!form.name.value.trim()) {
                    form.name.value = r.info.name;
                    Utils.toast('Название подтянуто из Честного Знака');
                }
            }
        } catch {}
    }

    function startHonestMarkScan(opts = {}) {
        Scanner.open((code) => handleHonestMarkResult(code, opts));
    }

    let _honestPollTimer = null;
    function startHonestMarkPolling() {
        if (_honestPollTimer) return;
        const tick = async () => {
            try {
                const r = await Api.post('/api/honest-mark/check');
                if (r && r.removed > 0) {
                    await Storage.refresh();
                    render();
                    if (typeof Home !== 'undefined') Home.render();
                    Utils.toast(`Продано: ${r.removed} — удалено из бара`);
                }
            } catch {}
        };
        _honestPollTimer = setInterval(tick, 25 * 60 * 1000);
        setTimeout(tick, 30 * 1000);
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = new FormData(form);
        const tob = String(data.get('tob')).trim();

        if (!Utils.isValidTob(tob)) {
            Utils.toast('TOB: 6 или 7 цифр');
            return;
        }

        
        const name = String(data.get('name')).trim();
        const category = String(data.get('category'));
        const isOpen = form.is_open.checked;

        if (isOpen) {
            const opens = Storage.countOpenSiblings(name, category, editingId);
            const max = Storage.maxOpenFor(category);
            if (opens >= max) {
                Utils.toast(`Уже открыто максимум (${max}) — закрой предыдущую`);
                return;
            }
        }

        
        const prodDate = String(data.get('production_date') || '').slice(0, 10);
        const prodTime = String(data.get('production_time') || '12:00').slice(0, 5);
        const closedDays = Number(data.get('closed_shelf_days'));
        if (!prodDate) {
            Utils.toast('Укажи дату производства');
            return;
        }
        if (!closedDays || closedDays < 1) {
            Utils.toast('Укажи срок годности (дней)');
            return;
        }
        const production_date = `${prodDate}T${prodTime || '12:00'}`;
        const _exp = new Date(production_date);
        _exp.setDate(_exp.getDate() + closedDays);
        const pad = (n) => String(n).padStart(2, '0');
        const expiry_closed = `${_exp.getFullYear()}-${pad(_exp.getMonth() + 1)}-${pad(_exp.getDate())}T${pad(_exp.getHours())}:${pad(_exp.getMinutes())}`;

        const current = editingId ? Storage.get(editingId) : null;
        
        
        const draft = {
            id: editingId || Utils.uuid(),
            tob,
            name,
            category,
            production_date,
            closed_shelf_days: closedDays,
            expiry_closed,
            shelf_open_days: current?.shelf_open_days || null,
            is_open: isOpen,
            opened_at: isOpen ? (current?.opened_at || Utils.today()) : null,
            honest_mark: (data.get('honest_mark') || '').trim() || current?.honest_mark || null,
            created_at: current?.created_at || new Date().toISOString()
        };

        
        
        if (isOpen && !editingId) {
            showStep2(draft);
            return;
        }

        await saveAndClose(draft);
    };

    async function saveAndClose(position) {
        try {
            await Storage.save(position);
            
            
            if (pendingBarcode && !editingId) {
                rememberBarcode(pendingBarcode, {
                    name: position.name,
                    tob: position.tob,
                    category: position.category
                });
            }
            pendingBarcode = null;
            closeModal('position-modal');
            resetSteps();
            render();
            Home.render();
            Utils.toast(editingId ? 'Изменения сохранены' : 'Позиция добавлена');
        } catch (err) {
            Utils.toast(err.message);
        }
    }

    
    function showStep2(draft) {
        pendingDraft = draft;
        document.querySelector('.modal-step[data-step="1"]').classList.add('hidden');
        document.querySelector('.modal-step[data-step="2"]').classList.remove('hidden');

        document.getElementById('step2-name').textContent = draft.name;
        document.getElementById('step2-tob').textContent = draft.tob;

        let value = draft.shelf_open_days;
        let source = '';
        if (!value) {
            const existing = Storage.getByTob(draft.tob);
            if (existing && existing.id !== draft.id && existing.shelf_open_days) {
                value = existing.shelf_open_days;
                source = 'tob';
            }
        }
        if (!value && kbStashedDays) {
            value = kbStashedDays;
            source = 'kb';
        }

        const input = document.getElementById('shelf-step-input');
        input.value = value || '';

        const hint = document.getElementById('step2-hint');
        if (source === 'tob') {
            hint.textContent = 'Подтянуто из позиции с тем же TOB. Можно изменить.';
        } else if (source === 'kb') {
            hint.textContent = 'Подтянуто из базы знаний (срок после вскрытия). Можно изменить.';
        } else if (value) {
            hint.textContent = 'Из основной формы. Можно изменить.';
        } else {
            hint.textContent = 'Если TOB уже встречался — значение подтянется автоматически. Иначе укажи вручную.';
        }

        setTimeout(() => { input.focus(); input.select(); }, 60);
    }

    function backToStep1() {
        document.querySelector('.modal-step[data-step="2"]').classList.add('hidden');
        document.querySelector('.modal-step[data-step="1"]').classList.remove('hidden');
    }

    async function confirmStep2() {
        const raw = document.getElementById('shelf-step-input').value;
        const days = Number(raw);
        if (!days || days < 1 || !Number.isFinite(days)) {
            Utils.toast('Укажи срок после вскрытия в днях');
            return;
        }
        if (!pendingDraft) return;
        const final = { ...pendingDraft, shelf_open_days: Math.floor(days) };
        await saveAndClose(final);
    }

    function resetSteps() {
        document.querySelector('.modal-step[data-step="1"]')?.classList.remove('hidden');
        document.querySelector('.modal-step[data-step="2"]')?.classList.add('hidden');
        pendingDraft = null;
    }

    
    function updateSubmitLabel() {
        const btn = document.getElementById('step1-submit');
        const form = document.getElementById('position-form');
        if (!btn || !form) return;
        const willStep2 = !editingId && form.is_open?.checked;
        btn.textContent = willStep2 ? 'Далее →' : 'Сохранить';
    }

    const CAT_ICON = { ingredients: 'drop', syrups: 'flask', cookies: 'cookie', other: 'package' };

    function findBarcodeForTob(tob) {
        if (!tob) return null;
        const all = loadBarcodes();
        for (const [code, data] of Object.entries(all)) {
            if (data && data.tob === tob) return code;
        }
        return null;
    }

    function renderDetailBarcode(value) {
        const svg = document.getElementById('detail-barcode');
        if (!svg || typeof JsBarcode === 'undefined') return;
        let format = 'CODE128';
        if (/^\d{13}$/.test(value)) format = 'EAN13';
        else if (/^\d{8}$/.test(value)) format = 'EAN8';
        const opts = { width: 2, height: 60, displayValue: true, fontSize: 13, margin: 6, background: '#ffffff', lineColor: '#111111' };
        try {
            JsBarcode(svg, value, { ...opts, format });
        } catch {
            try { JsBarcode(svg, value, { ...opts, format: 'CODE128' }); } catch {}
        }
    }

    const openDetails = (id) => {
        const p = Storage.get(id);
        if (!p) return;
        const exp = Utils.expiryLabel(p);
        const effExp = Utils.effectiveExpiry(p);

        
        
        
        
        
        
        const closedExp = p.expiry_closed;
        const openExp = (p.is_open && p.opened_at && p.shelf_open_days)
            ? Utils.addDays(p.opened_at, p.shelf_open_days)
            : null;
        const winnerIsOpen   = openExp && Utils.toDateTime(openExp) <= Utils.toDateTime(closedExp);
        const winnerIsClosed = !winnerIsOpen;
        const valueCls = exp.level === 'expired' ? 'danger'
                       : exp.level === 'expiring-soon' ? 'warning' : '';

        document.getElementById('detail-title').textContent = p.name;
        const body = document.getElementById('detail-body');

        const cat = Utils.CATEGORIES[p.category] || p.category;
        const catIcon = CAT_ICON[p.category] || 'package';
        const heroIcon = exp.level === 'expired' ? 'warning-octagon'
                       : exp.level === 'expiring-soon' ? 'warning' : 'seal-check';
        const barcodeVal = findBarcodeForTob(p.tob);
        const hz = p.honest_mark ? parseHonestMarkInfo(p.honest_mark) : null;

        const row = (label, value, cls = '') =>
            `<div class="detail-row ${cls}"><span class="label">${label}</span><span class="value">${value}</span></div>`;

        body.innerHTML = `
            <div class="detail-hero level-${exp.level}">
                <span class="detail-hero-ic"><i class="ph ph-${heroIcon}"></i></span>
                <div class="detail-hero-body">
                    <div class="detail-hero-main">${Utils.escape(exp.text)}</div>
                    <div class="detail-hero-sub">${Utils.formatDateTimeFull(effExp)}</div>
                </div>
            </div>

            <div class="detail-tags">
                <button class="detail-tag mono" data-copy="${Utils.escape(p.tob)}" title="Скопировать TOB">
                    <i class="ph ph-hash"></i>${Utils.escape(p.tob)}
                </button>
                <span class="detail-tag"><i class="ph ph-${catIcon}"></i>${Utils.escape(cat)}</span>
                <span class="detail-tag ${p.is_open ? 'tag-open' : ''}">
                    <i class="ph ph-${p.is_open ? 'lock-simple-open' : 'lock-simple'}"></i>${p.is_open ? 'Открыта' : 'Закрыта'}
                </span>
                ${p.honest_mark ? '<span class="detail-tag tag-hz"><i class="ph ph-seal-check"></i>ЧЗ</span>' : ''}
            </div>

            <div class="detail-section">
                ${p.production_date ? row('Произведено', Utils.escape(formatProductionDate(p.production_date))) : ''}
                ${p.closed_shelf_days ? row('Срок (от производства)', `${p.closed_shelf_days} ${Utils.pluralDay(p.closed_shelf_days)}`) : ''}
                <div class="detail-row ${winnerIsClosed ? 'winner' : 'loser'}">
                    <span class="label">Срок упаковки</span>
                    <span class="value">${Utils.formatDateTimeFull(closedExp)}</span>
                </div>
                ${openExp ? `
                <div class="detail-row ${winnerIsOpen ? 'winner' : 'loser'}">
                    <span class="label">После вскрытия<br><span class="sublabel">${Utils.formatDateFull(p.opened_at)} + ${p.shelf_open_days} дн</span></span>
                    <span class="value">${Utils.formatDateFull(openExp)}</span>
                </div>` : (p.shelf_open_days ? `
                <div class="detail-row">
                    <span class="label">После вскрытия</span>
                    <span class="value muted">${p.shelf_open_days} дн (не вскрыта)</span>
                </div>` : '')}
                <div class="detail-row big">
                    <span class="label">Фактический срок</span>
                    <span class="value ${valueCls}">${Utils.formatDateTimeFull(effExp)}</span>
                </div>
            </div>

            ${barcodeVal ? `
            <div class="detail-code">
                <div class="detail-code-head"><i class="ph ph-barcode"></i><span>Штрихкод</span></div>
                <div class="detail-barcode-wrap"><svg id="detail-barcode"></svg></div>
            </div>` : ''}

            ${p.honest_mark ? `
            <div class="detail-code">
                <div class="detail-code-head"><i class="ph ph-seal-check"></i><span>Честный Знак</span></div>
                ${(hz.gtin || hz.production_date || hz.expiry_date) ? `<div class="detail-code-grid">
                    ${hz.gtin ? `<div class="dc-cell"><span class="dc-k">GTIN</span><span class="dc-v mono">${Utils.escape(hz.gtin)}</span></div>` : ''}
                    ${hz.production_date ? `<div class="dc-cell"><span class="dc-k">Произведено</span><span class="dc-v">${Utils.escape(hz.production_date)}</span></div>` : ''}
                    ${hz.expiry_date ? `<div class="dc-cell"><span class="dc-k">Годен до</span><span class="dc-v">${Utils.escape(hz.expiry_date)}</span></div>` : ''}
                </div>` : ''}
                <button class="detail-code-copy" data-copy="${Utils.escape(p.honest_mark)}"><i class="ph ph-copy"></i>Скопировать код</button>
            </div>` : ''}

            <div class="detail-actions">
                ${p.is_open
                    ? `<button data-action="close">Закрыть</button>`
                    : (p.category === 'cookies'
                        ? ''
                        : `<button class="btn-success" data-action="open">Открыть</button>`)}
                <button data-action="edit">Изменить</button>
                <button class="btn-danger" data-action="delete">Удалить</button>
            </div>
        `;

        if (barcodeVal) renderDetailBarcode(barcodeVal);

        body.querySelectorAll('[data-copy]').forEach(elem => {
            elem.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                try {
                    await navigator.clipboard.writeText(elem.dataset.copy);
                    Utils.toast('Скопировано');
                } catch {
                    Utils.toast('Не удалось скопировать');
                }
            });
        });

        body.querySelector('[data-action="open"]')?.addEventListener('click', () => toggleOpen(p, true));
        body.querySelector('[data-action="close"]')?.addEventListener('click', () => toggleOpen(p, false));
        body.querySelector('[data-action="edit"]').addEventListener('click', () => {
            closeModal('detail-modal');
            openModal(p);
        });
        body.querySelector('[data-action="delete"]').addEventListener('click', async () => {
            if (!confirm(`Удалить «${p.name}»?`)) return;
            try {
                await Storage.remove(p.id);
                closeModal('detail-modal');
                render();
                Home.render();
                Utils.toast('Удалено');
            } catch (err) { Utils.toast(err.message); }
        });

        document.getElementById('detail-modal').classList.add('show');
    };

    const toggleOpen = async (position, open) => {
        if (open) {
            const opens = Storage.countOpenSiblings(position.name, position.category, position.id);
            const max = Storage.maxOpenFor(position.category);
            if (opens >= max) {
                Utils.toast(`Уже открыто максимум (${max}) — закрой предыдущую`);
                return;
            }
            
            openVskrytieModal(position);
            return;
        }
        
        try {
            await Storage.closePos(position.id);
            closeModal('detail-modal');
            render();
            Home.render();
            Utils.toast('Закрыта');
        } catch (err) { Utils.toast(err.message); }
    };

    
    let pendingOpenPosition = null;

    function openVskrytieModal(position) {
        pendingOpenPosition = position;
        document.getElementById('open-tob').textContent = position.tob;
        document.getElementById('open-name').textContent = position.name;

        
        setOpenedAt(new Date());

        
        const shelfWrap = document.getElementById('open-shelf-field');
        const shelfInput = document.getElementById('open-shelf-days');
        const hint = document.getElementById('open-hint');
        if (position.shelf_open_days) {
            shelfWrap.classList.add('hidden');
            shelfInput.value = position.shelf_open_days;
            hint.textContent = `После вскрытия позиция живёт ещё ${position.shelf_open_days} ${Utils.pluralDay(position.shelf_open_days)}.`;
        } else {
            shelfWrap.classList.remove('hidden');
            shelfInput.value = '';
            hint.textContent = 'Укажи, сколько позиция живёт после вскрытия.';
        }

        document.getElementById('open-modal').classList.add('show');
        setTimeout(() => {
            
            
            if (!shelfWrap.classList.contains('hidden')) {
                shelfInput.focus();
            }
        }, 80);
    }

    function setOpenedAt(d) {
        const pad = (n) => String(n).padStart(2, '0');
        document.getElementById('open-date').value =
            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        document.getElementById('open-time').value =
            `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    async function confirmVskrytie() {
        const dateV = document.getElementById('open-date').value;
        const timeV = document.getElementById('open-time').value || '12:00';
        if (!dateV) {
            Utils.toast('Укажи дату вскрытия');
            return;
        }
        const opened_at = `${dateV}T${timeV.slice(0, 5)}`;

        const shelfWrap = document.getElementById('open-shelf-field');
        const shelfInput = document.getElementById('open-shelf-days');
        let shelf_open_days = null;
        if (!shelfWrap.classList.contains('hidden')) {
            const v = Number(shelfInput.value);
            if (!v || v < 1) {
                Utils.toast('Укажи срок после вскрытия (дней)');
                return;
            }
            shelf_open_days = v;
        }

        try {
            const opts = { opened_at };
            if (shelf_open_days != null) opts.shelf_open_days = shelf_open_days;
            await Storage.openPos(pendingOpenPosition.id, opts);
            document.getElementById('open-modal').classList.remove('show');
            closeModal('detail-modal');
            render();
            Home.render();
            const stillCount = Storage.countOpenSiblings(
                pendingOpenPosition.name, pendingOpenPosition.category, pendingOpenPosition.id
            );
            const note = (pendingOpenPosition.category === 'syrups' && stillCount > 0)
                ? 'Открыта · ⚠ есть ещё одна'
                : 'Открыта';
            Utils.toast(note);
            pendingOpenPosition = null;
        } catch (err) {
            Utils.toast(err.message);
        }
    }

    
    const init = () => {
        Nav.onShow('positions', render);

        document.getElementById('btn-add-position').addEventListener('click', () => openModal());
        document.getElementById('btn-scan-position').addEventListener('click', startScan);
        document.getElementById('btn-scan-mark')?.addEventListener('click', startScan);
        document.getElementById('btn-scan-hmark')?.addEventListener('click', () => startHonestMarkScan({ skipOpenModal: true }));
        document.getElementById('btn-clear-hmark')?.addEventListener('click', () => showHonestMark(''));
        document.getElementById('position-form').addEventListener('submit', handleSubmit);


        document.querySelectorAll('[data-close]').forEach(el => {
            el.addEventListener('click', () => {
                el.closest('.modal').classList.remove('show');
            });
        });

        const sInput = document.getElementById('search-input');
        const sClear = document.getElementById('search-clear');
        sInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim();
            sClear.classList.toggle('visible', searchQuery.length > 0);
            render();
        });
        sClear.addEventListener('click', () => {
            sInput.value = '';
            searchQuery = '';
            sClear.classList.remove('visible');
            render();
            sInput.focus();
        });

        document.querySelectorAll('#filter-chips .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                activeCategory = chip.dataset.cat;
                render();
            });
        });

        
        document.querySelectorAll('#category-chips .cat-chip').forEach(chip => {
            chip.addEventListener('click', () => setCategory(chip.dataset.cat));
        });

        
        document.getElementById('is-open-check')
            .addEventListener('change', updateSubmitLabel);

        
        document.querySelectorAll('#time-presets .time-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.getElementById('production-time').value = chip.dataset.time;
                syncTimeChips(chip.dataset.time);
                updateExpiryPreview();
            });
        });

        
        ['production-date', 'production-time', 'closed-shelf-days'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                if (id === 'production-time') {
                    syncTimeChips(document.getElementById('production-time').value);
                }
                updateExpiryPreview();
            });
        });

        
        document.getElementById('step2-back').addEventListener('click', backToStep1);
        document.getElementById('step2-confirm').addEventListener('click', confirmStep2);
        document.getElementById('shelf-step-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmStep2();
            }
        });

        
        document.getElementById('open-confirm').addEventListener('click', confirmVskrytie);
        document.querySelectorAll('#open-time-presets .time-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                if (chip.dataset.quick === 'now') {
                    setOpenedAt(new Date());
                } else if (chip.dataset.time) {
                    document.getElementById('open-time').value = chip.dataset.time;
                }
            });
        });
        document.getElementById('open-shelf-days').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmVskrytie();
            }
        });

        
        
        
        const tobInput = document.getElementById('tob-input');
        if (tobInput) {
            tobInput.addEventListener('input', (e) => {
                const raw = e.target.value.replace(/\D/g, '').slice(0, 7);
                e.target.value = raw;
                if (raw.length < 6 || editingId) {
                    tryKbAutofill(raw);
                    return;
                }
                const form = document.getElementById('position-form');
                const existing = Storage.getByTob(raw);
                if (existing && !form.name.value.trim()) {
                    form.name.value = existing.name;
                    setCategory(existing.category);
                    Utils.toast(`Подтянуто: ${existing.name}`);
                }
                tryKbAutofill(raw);
            });
        }
    };

    return { init, render, openDetails, openModal, cardHtml, startHonestMarkPolling };
})();
