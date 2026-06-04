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
                        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
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
    }

    return { init, open, close };
})();
