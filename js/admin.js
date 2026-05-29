// Админ-панель: переключение активного бара + генерация ключей регистрации.
// Видна только пользователю с is_admin. Все эндпоинты защищены на сервере
// (@require_admin), так что обычный пользователь ничего не сможет, даже если
// подделает UI.

const Admin = (() => {
    let bars = [];

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

    // Вызывается из Profile.render(). Прячет панель для не-админов.
    async function render() {
        const card = document.getElementById('admin-card');
        if (!card) return;
        if (!Auth.isAdmin?.()) { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');

        if (bars.length === 0) await loadBars();

        const activeId = Api.getBarOverride() || (Auth.bar()?.id ?? '');
        fillSelect(document.getElementById('admin-active-bar'), activeId);
        fillSelect(document.getElementById('admin-keygen-bar'), activeId);
    }

    async function switchBar(barId) {
        Api.setBarOverride(barId);
        try {
            await Auth.refreshMe();    // Auth.bar() станет активным баром
            await Storage.refresh();
            if (typeof Home !== 'undefined') Home.render();
            render();
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
        } catch (e) {
            Utils.toast(e.message || 'Не удалось сгенерировать');
        }
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
        document.getElementById('admin-active-bar')
            ?.addEventListener('change', (e) => switchBar(e.target.value));
        document.getElementById('admin-keygen-btn')
            ?.addEventListener('click', generate);
    }

    return { init, render };
})();
