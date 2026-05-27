const Home = (() => {
    const render = () => {
        // Приветствие: если пользователь указал имя — используем его,
        // иначе ник, иначе просто «Доброе утро».
        const u = (typeof Auth !== 'undefined') ? Auth.user() : null;
        const name = (u?.display_name || u?.username || '').trim();
        const base = Utils.greeting();
        document.getElementById('greeting').textContent = name ? `${base}, ${name}` : base;
        // Дата теперь отображается в карточке часов/погоды (см. Weather.init).

        const list = Storage.list();
        const today = Utils.today();
        const tomorrow = Utils.addDays(today, 1);

        const totalEl = document.getElementById('stat-total');
        const openEl = document.getElementById('stat-open');
        const expiringEl = document.getElementById('stat-expiring');

        totalEl.textContent = list.length;
        openEl.textContent = list.filter(p => p.is_open).length;

        const expiringToday = [];
        const expiringTomorrow = [];

        list.forEach(p => {
            // effectiveExpiry теперь datetime — сравниваем по дню.
            const expDate = Utils.dateOnly(Utils.effectiveExpiry(p));
            if (expDate <= today) expiringToday.push(p);
            else if (expDate === tomorrow) expiringTomorrow.push(p);
        });

        expiringEl.textContent = expiringToday.length + expiringTomorrow.length;

        renderList('expiring-today', expiringToday,
            'Сегодня всё чисто', 'некондиции нет');
        renderList('expiring-tomorrow', expiringTomorrow,
            'Завтра тоже спокойно', 'ничего не истекает');

        document.getElementById('badge-today').textContent = expiringToday.length;
        document.getElementById('badge-today').classList.toggle('danger', expiringToday.length > 0);
        document.getElementById('badge-tomorrow').textContent = expiringTomorrow.length;
        document.getElementById('badge-tomorrow').classList.toggle('warning', expiringTomorrow.length > 0);
    };

    const renderList = (containerId, items, emptyText, emptySub) => {
        const c = document.getElementById(containerId);
        const section = c.closest('.section-block');
        section?.classList.toggle('is-empty', items.length === 0);

        if (items.length === 0) {
            c.innerHTML = `
                <div class="section-empty">
                    <div class="section-empty-icon">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M5 12.5l4.2 4.2L19 7"/>
                        </svg>
                    </div>
                    <div class="section-empty-info">
                        <div class="section-empty-text">${Utils.escape(emptyText)}</div>
                        ${emptySub ? `<div class="section-empty-sub">${Utils.escape(emptySub)}</div>` : ''}
                    </div>
                </div>
            `;
            return;
        }
        const ctx = buildCardCtx();
        c.innerHTML = items.map(p => Positions.cardHtml(p, ctx)).join('');
        c.querySelectorAll('.position-card').forEach(card => {
            card.addEventListener('click', () => Positions.openDetails(card.dataset.id));
        });
    };

    // Считаем мапы предупреждений (сиропы с дубликатом TOB / двумя открытыми),
    // чтобы карточки на главной показывали те же бейджи, что и в списке позиций.
    function buildCardCtx() {
        const list = Storage.list();
        const syrupDups = {};
        const openByName = {};
        for (const p of list) {
            if (p.category !== 'syrups') continue;
            syrupDups[p.tob] = (syrupDups[p.tob] || 0) + 1;
            if (p.is_open) {
                const k = p.name.trim().toLowerCase();
                openByName[k] = (openByName[k] || 0) + 1;
            }
        }
        return { syrupDups, openByName };
    }

    const init = () => {
        Nav.onShow('home', render);
    };

    return { init, render };
})();
