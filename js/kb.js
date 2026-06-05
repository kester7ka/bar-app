const KB = (() => {
    const el = (id) => document.getElementById(id);
    const OVERRIDES_KEY = 'bar-app:kb-overrides';

    let activeTab = 'shelf';
    let searchQuery = '';
    let expanded = new Set();
    let pickMode = null;
    let overrides = { shelf: [], tov: [], updated_at: null };
    let mergedCache = null;

    try {
        const raw = localStorage.getItem(OVERRIDES_KEY);
        if (raw) overrides = JSON.parse(raw);
    } catch {}

    async function loadOverrides() {
        try {
            const data = await Api.get('/api/kb');
            if (data) {
                overrides = {
                    shelf: data.shelf || [],
                    tov: data.tov || [],
                    updated_at: data.updated_at || null,
                    uploaded_by: data.uploaded_by || null,
                };
                try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); } catch {}
                mergedCache = null;
            }
        } catch {}
    }

    function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

    function getMerged() {
        if (mergedCache) return mergedCache;
        const base = deepClone(KB_DATA);
        for (const section of ['shelf', 'tov']) {
            const groups = base[section];
            const byTov = {};
            groups.forEach(g => g.items.forEach(it => {
                if (it.tov) byTov[it.tov] = { group: g, item: it };
            }));
            const newByGroup = {};
            for (const ov of (overrides[section] || [])) {
                const tov = ov.tov;
                if (!tov) continue;
                if (byTov[tov]) {
                    if (ov.name) byTov[tov].item.name = ov.name;
                    if (section === 'shelf' && ov.life !== undefined) byTov[tov].item.life = ov.life;
                } else {
                    const gname = ov.group || 'Прочее';
                    if (!newByGroup[gname]) newByGroup[gname] = [];
                    const itm = { tov, name: ov.name || null };
                    if (section === 'shelf') itm.life = ov.life || null;
                    newByGroup[gname].push(itm);
                }
            }
            for (const [gname, items] of Object.entries(newByGroup)) {
                let g = groups.find(x => x.group === gname);
                if (!g) { g = { group: gname, items: [] }; groups.push(g); }
                g.items.push(...items);
            }
        }
        mergedCache = base;
        return base;
    }

    function invalidateCache() { mergedCache = null; }

    function getOverridesMeta() {
        return {
            updated_at: overrides.updated_at || null,
            uploaded_by: overrides.uploaded_by || null,
            count_shelf: (overrides.shelf || []).length,
            count_tov: (overrides.tov || []).length,
        };
    }

    function open() {
        pickMode = null;
        el('kb-overlay').classList.add('show');
        el('kb-overlay').classList.remove('pick-mode');
        activeTab = 'shelf';
        searchQuery = '';
        expanded = new Set();
        const inp = el('kb-search');
        if (inp) inp.value = '';
        render();
    }

    function openPicker(callback) {
        pickMode = callback;
        el('kb-overlay').classList.add('show');
        el('kb-overlay').classList.add('pick-mode');
        activeTab = 'tov';
        searchQuery = '';
        expanded = new Set();
        const inp = el('kb-search');
        if (inp) inp.value = '';
        render();
    }

    function close() {
        el('kb-overlay').classList.remove('show');
        el('kb-overlay').classList.remove('pick-mode');
        pickMode = null;
    }

    function setTab(t) {
        if (t === activeTab) return;
        activeTab = t;
        expanded = new Set();
        const inp = el('kb-search');
        if (inp) { inp.value = ''; searchQuery = ''; }
        render();
    }

    function matchesQuery(item, q) {
        if (!q) return true;
        const hay = ((item.tov || '') + ' ' + (item.name || '') + ' ' + (item.life || '') + ' ' + (item.pack || '')).toLowerCase();
        return hay.includes(q);
    }

    function filteredGroups() {
        const merged = getMerged();
        const groups = activeTab === 'shelf' ? merged.shelf : merged.tov;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return groups;
        return groups
            .map(g => ({ group: g.group, items: g.items.filter(it => matchesQuery(it, q)) }))
            .filter(g => g.items.length > 0);
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function highlight(text, q) {
        if (!q || !text) return escapeHtml(text);
        const t = String(text);
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
        return escapeHtml(t).replace(re, '<mark>$1</mark>');
    }

    function lifeIcon() {
        return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 7v5l3 2"/>
        </svg>`;
    }
    function packIcon() {
        return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 8l9-5 9 5v8l-9 5-9-5V8z"/>
            <path d="M3 8l9 5 9-5M12 13v9"/>
        </svg>`;
    }
    function copyIcon() {
        return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2"/>
            <path d="M5 15V5a2 2 0 012-2h10"/>
        </svg>`;
    }
    function chevronIcon() {
        return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6"/>
        </svg>`;
    }

    function render() {
        const tabs = document.querySelectorAll('.kb-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));
        const wrap = el('kb-content');
        const groups = filteredGroups();
        if (!groups.length) {
            wrap.innerHTML = `<div class="kb-empty">Ничего не найдено</div>`;
            return;
        }
        const q = searchQuery.trim().toLowerCase();
        const forceOpen = !!q;
        const isShelf = activeTab === 'shelf';
        wrap.innerHTML = groups.map((g, gi) => {
            const isOpen = forceOpen || expanded.has(g.group);
            const items = isOpen ? g.items.map(it => itemCard(it, isShelf, q)).join('') : '';
            return `
                <section class="kb-group ${isOpen ? 'open' : ''}">
                    <button class="kb-group-head" data-group="${escapeHtml(g.group)}">
                        <span class="kb-group-name">${escapeHtml(g.group)}</span>
                        <span class="kb-group-meta">
                            <span class="kb-group-count">${g.items.length}</span>
                            <span class="kb-group-chev">${chevronIcon()}</span>
                        </span>
                    </button>
                    ${isOpen ? `<div class="kb-group-body">${items}</div>` : ''}
                </section>
            `;
        }).join('');
        wrap.querySelectorAll('.kb-group-head').forEach(b => {
            b.addEventListener('click', () => {
                if (forceOpen) return;
                const g = b.dataset.group;
                if (expanded.has(g)) expanded.delete(g);
                else expanded.add(g);
                render();
            });
        });
        wrap.querySelectorAll('.kb-copy').forEach(b => {
            b.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (pickMode) {
                    const cb = pickMode;
                    const data = {
                        tov: b.dataset.tov,
                        digits: b.dataset.copy,
                        name: b.dataset.name,
                        life: b.dataset.life
                    };
                    close();
                    cb(data);
                    return;
                }
                const v = b.dataset.copy;
                try {
                    await navigator.clipboard.writeText(v);
                    Utils.toast('Скопировано · ' + v);
                } catch {
                    Utils.toast('Не удалось скопировать');
                }
            });
        });
    }

    function itemCard(it, isShelf, q) {
        const digits = it.tov ? it.tov.replace(/^[А-Яа-яA-Za-z]+/, '').trim() : '';
        const code = `
            <button class="kb-tov kb-copy" data-copy="${escapeHtml(digits)}" data-tov="${escapeHtml(it.tov)}" data-name="${escapeHtml(it.name || '')}" data-life="${escapeHtml(it.life || '')}" title="${pickMode ? 'Выбрать' : 'Скопировать номер'}">
                <span class="kb-tov-text">${highlight(it.tov, q)}</span>
                <span class="kb-copy-ic">${pickMode ? '' : copyIcon()}</span>
            </button>
        `;
        const name = it.name
            ? `<div class="kb-name">${highlight(it.name, q)}</div>`
            : `<div class="kb-name kb-name-empty">без названия</div>`;
        let meta = '';
        if (isShelf) {
            meta = it.life
                ? `<div class="kb-meta kb-life">${lifeIcon()}<span>${highlight(it.life, q)}</span></div>`
                : `<div class="kb-meta kb-life kb-meta-empty">${lifeIcon()}<span>не указано</span></div>`;
        }
        return `
            <div class="kb-item${pickMode ? ' pickable' : ''}" data-pick="${pickMode ? '1' : ''}">
                <div class="kb-item-head">${code}</div>
                ${name}
                ${meta}
            </div>
        `;
    }

    function init() {
        el('kb-close')?.addEventListener('click', close);
        document.querySelectorAll('.kb-tab').forEach(t => {
            t.addEventListener('click', () => setTab(t.dataset.tab));
        });
        const inp = el('kb-search');
        if (inp) {
            inp.addEventListener('input', () => {
                searchQuery = inp.value;
                render();
            });
        }
        el('kb-expand-all')?.addEventListener('click', () => {
            const merged = getMerged();
            const groups = activeTab === 'shelf' ? merged.shelf : merged.tov;
            if (expanded.size === groups.length) {
                expanded = new Set();
            } else {
                expanded = new Set(groups.map(g => g.group));
            }
            render();
        });
    }

    return { init, open, close, openPicker, getMerged, invalidateCache, loadOverrides, getOverridesMeta };
})();
