const Admin = (() => {
    let bars = [];
    let allKeys = [];
    let keyFilter = 'all';

    async function loadBars() {
        try { bars = await Api.get('/api/bars'); }
        catch { bars = []; }
        return bars;
    }

    function barLabel(b) {
        const name = (b.name || '').trim();
        const same = !name || name.toLowerCase() === (b.code || '').toLowerCase();
        return same ? b.code : `${b.code} · ${b.name}`;
    }

    function fillSelect(sel, selectedId) {
        if (!sel) return;
        sel.innerHTML = bars
            .map(b => `<option value="${b.id}">${Utils.escape(barLabel(b))}</option>`)
            .join('');
        if (selectedId != null) sel.value = String(selectedId);
    }

    async function open() {
        if (!Auth.isAdmin?.()) {
            Utils.toast('Только для администратора');
            return;
        }
        document.getElementById('admin-overlay').classList.add('show');
        if (bars.length === 0) await loadBars();
        const activeId = Api.getBarOverride() || (Auth.bar()?.id ?? '');
        fillSelect(document.getElementById('admin-active-bar'), activeId);
        fillSelect(document.getElementById('admin-keygen-bar'), activeId);
        loadAllKeys();
        renderKbMeta();
    }

    function renderKbMeta() {
        const el = document.getElementById('admin-kb-meta');
        if (!el || typeof KB === 'undefined' || !KB.getOverridesMeta) return;
        const m = KB.getOverridesMeta();
        if (!m.updated_at) {
            el.textContent = 'обновления не загружались — используются встроенные данные';
            return;
        }
        const total = (m.count_shelf || 0) + (m.count_tov || 0);
        const dt = new Date(m.updated_at);
        const pad = (n) => String(n).padStart(2, '0');
        const ts = `${pad(dt.getDate())}.${pad(dt.getMonth()+1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
        el.textContent = `${total} обновлений · загружено ${ts}`;
    }

    function parseKbXlsx(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
                    resolve(extractKbRows(rows));
                } catch (err) {
                    reject(err);
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    function extractKbRows(rows) {
        const clean = (v) => v == null ? null : String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim() || null;
        const isCode = (s) => !!s && /^(ТОВ|ДВП)\d+/i.test(s);

        let shelfMode = null;
        let group = 'Прочее';
        const shelf = [];
        const tov = [];

        for (const r of rows) {
            const a = clean(r[0]);
            const b = clean(r[1]);
            const c = clean(r[2]);
            const d = clean(r[3]);

            if (shelfMode === null) {
                if (b === 'ТОВ' || c === 'Наименование товара') { shelfMode = true; continue; }
                if (a && /товар|номер|код/i.test(a) && b && /назван|товар/i.test(b)) { shelfMode = false; continue; }
            }

            if (shelfMode) {
                if (b && !isCode(b) && !c && !d) { group = b; continue; }
                if (isCode(b)) shelf.push({ tov: b, name: c, life: d, group });
            } else {
                if (!a && b && !c) { group = b; continue; }
                if (isCode(a)) tov.push({ tov: a, name: b, group });
            }
        }
        return { shelf, tov };
    }

    async function handleKbFile(file) {
        if (!file) return;
        try {
            Utils.toast('Парсим файл…');
            const parsed = await parseKbXlsx(file);
            const total = parsed.shelf.length + parsed.tov.length;
            if (total === 0) {
                Utils.toast('Не нашёл ТОВ в файле');
                return;
            }
            const res = await Api.post('/api/kb/upload', parsed);
            KB.invalidateCache();
            await KB.loadOverrides();
            renderKbMeta();
            Utils.toast(`Обновлено: сроки ${res.shelf_changed}, ТОВ ${res.tov_changed}`);
        } catch (err) {
            Utils.toast(err.message || 'Не удалось загрузить файл');
        }
    }

    async function resetKb() {
        if (!confirm('Сбросить все загруженные обновления базы знаний?')) return;
        try {
            await Api.delete('/api/kb');
            KB.invalidateCache();
            await KB.loadOverrides();
            renderKbMeta();
            Utils.toast('Сброшено');
        } catch (err) {
            Utils.toast(err.message || 'Не удалось сбросить');
        }
    }

    function close() {
        document.getElementById('admin-overlay').classList.remove('show');
    }

    async function switchBar(barId) {
        Api.setBarOverride(barId);
        try {
            await Auth.refreshMe();      
            await Storage.refresh();
            if (typeof Home !== 'undefined') Home.render();
            if (typeof Positions !== 'undefined') Positions.render();
            if (typeof Profile !== 'undefined') Profile.render();
            Utils.toast('Бар переключён');
        } catch (e) {
            Utils.toast(e.message || 'Не удалось переключить бар');
        }
    }

    async function generate() {
        const barId = Number(document.getElementById('admin-keygen-bar').value);
        const count = Number(document.getElementById('admin-keygen-count').value) || 1;
        const note = document.getElementById('admin-keygen-note').value.trim();
        if (!barId) { Utils.toast('Выбери бар'); return; }
        if (count < 1 || count > 50) { Utils.toast('Количество: 1–50'); return; }
        try {
            const r = await Api.post('/api/admin/keys', { bar_id: barId, count, note });
            renderKeys(r.keys, r.bar);
            document.getElementById('admin-keygen-note').value = '';
            Utils.toast(`Создано ключей: ${r.keys.length}`);
            loadAllKeys();   
        } catch (e) {
            Utils.toast(e.message || 'Не удалось сгенерировать');
        }
    }

    
    async function loadAllKeys() {
        const box = document.getElementById('admin-all-keys');
        if (!box) return;
        try {
            allKeys = await Api.get('/api/admin/keys');
            renderAllKeys();
        } catch (e) {
            box.innerHTML = '<p class="empty-text">Не удалось загрузить ключи</p>';
        }
    }

    function renderAllKeys() {
        const box = document.getElementById('admin-all-keys');
        if (!box) return;
        const filtered = allKeys.filter(k => {
            if (keyFilter === 'free') return !k.used;
            if (keyFilter === 'used') return k.used;
            return true;
        });
        if (filtered.length === 0) {
            box.innerHTML = '<p class="empty-text">Нет ключей в этой категории</p>';
            return;
        }
        box.innerHTML = filtered.map(k => {
            const status = k.used
                ? `использован${k.used_at ? ' · ' + k.used_at.slice(0, 16).replace('T', ' ') : ''}`
                : 'свободен';
            return `
                <div class="admin-key-row ${k.used ? 'is-used' : ''}">
                    <div class="admin-key-main">
                        <span class="admin-key-code">${Utils.escape(k.key)}</span>
                        <div class="admin-key-meta">
                            <span class="admin-key-bar">${Utils.escape(k.bar_code)}</span>
                            <span class="admin-key-status">${Utils.escape(status)}</span>
                            ${k.note ? `<span class="admin-key-note">· ${Utils.escape(k.note)}</span>` : ''}
                        </div>
                    </div>
                    <button type="button" class="admin-key-del" data-key="${Utils.escape(k.key)}" aria-label="Удалить">
                        <i class="ph ph-x" style="font-size:14px"></i>
                    </button>
                </div>
            `;
        }).join('');
        box.querySelectorAll('.admin-key-del').forEach(btn => {
            btn.addEventListener('click', () => deleteKey(btn.dataset.key));
        });
    }

    async function deleteKey(key) {
        if (!confirm(`Удалить ключ ${key}?`)) return;
        try {
            await Api.delete(`/api/admin/keys/${encodeURIComponent(key)}`);
            allKeys = allKeys.filter(k => k.key !== key);
            renderAllKeys();
            Utils.toast('Удалено');
        } catch (e) {
            Utils.toast(e.message || 'Не удалось удалить');
        }
    }

    function setFilter(f) {
        keyFilter = f;
        document.querySelectorAll('#admin-keys-filter .admin-filter-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.filter === f);
        });
        renderAllKeys();
    }

    function renderKeys(keys, bar) {
        const box = document.getElementById('admin-keys');
        if (!box) return;
        box.classList.remove('hidden');
        box.innerHTML = `
            <div class="admin-keys-head">
                <span>Ключи · ${Utils.escape(bar.code)}</span>
                <button type="button" class="admin-copy" id="admin-copy">Копировать все</button>
            </div>
            <div class="admin-keys-list">
                ${keys.map(k => `<span class="admin-key">${Utils.escape(k)}</span>`).join('')}
            </div>
        `;
        document.getElementById('admin-copy').addEventListener('click', () => {
            const text = keys.join('\n');
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(
                    () => Utils.toast('Скопировано'),
                    () => Utils.toast('Не удалось скопировать')
                );
            } else {
                Utils.toast('Буфер недоступен — скопируй вручную');
            }
        });
    }

    function init() {
        document.getElementById('admin-close')?.addEventListener('click', close);
        document.getElementById('admin-active-bar')
            ?.addEventListener('change', (e) => switchBar(e.target.value));
        document.getElementById('admin-keygen-btn')
            ?.addEventListener('click', generate);
        document.getElementById('admin-keys-refresh')
            ?.addEventListener('click', loadAllKeys);
        document.querySelectorAll('#admin-keys-filter .admin-filter-chip').forEach(c => {
            c.addEventListener('click', () => setFilter(c.dataset.filter));
        });
        const kbFile = document.getElementById('admin-kb-file');
        if (kbFile) {
            kbFile.addEventListener('change', (e) => {
                const f = e.target.files?.[0];
                handleKbFile(f);
                e.target.value = '';
            });
        }
        document.getElementById('admin-kb-reset')?.addEventListener('click', resetKb);
    }

    return { init, open, close };
})();
