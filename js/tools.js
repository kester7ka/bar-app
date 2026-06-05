const Tools = (() => {
    const onTool = (name) => {
        switch (name) {
            case 'schedule':
                return Schedule.open();
            case 'calendar':
                return Calendar.open();
            case 'status':
                return Status.open();
            case 'kb':
                return KB.open();
            case 'admin':
                return Admin.open();
            case 'scan':
                return promptTob();
            case 'export':
                return exportCsv();
            case 'cleanup':
                return cleanup();
            case 'categories':
                return showCategories();
        }
    };

    const promptTob = () => {
        const tob = prompt('Введи TOB:');
        if (!tob) return;
        const p = Storage.getByTob(tob.trim());
        if (p) {
            Nav.show('positions');
            setTimeout(() => Positions.openDetails(p.id), 100);
        } else {
            Utils.toast('Позиция не найдена');
        }
    };

    const exportCsv = () => {
        const list = Storage.list();
        if (list.length === 0) {
            Utils.toast('Нечего экспортировать');
            return;
        }
        const head = ['tob', 'name', 'category', 'expiry_closed', 'shelf_open_days', 'is_open', 'opened_at'];
        const rows = list.map(p => head.map(k => {
            const v = p[k];
            if (v === null || v === undefined) return '';
            return `"${String(v).replace(/"/g, '""')}"`;
        }).join(','));
        const csv = [head.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bar-positions-${Utils.today()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        Utils.toast('CSV сохранён');
    };

    const cleanup = async () => {
        if (!confirm('Удалить всю некондицию?')) return;
        try {
            const removed = await Storage.removeExpired();
            Utils.toast(removed === 0 ? 'Нечего удалять' : `Удалено: ${removed}`);
            Home.render();
            Positions.render();
        } catch (err) { Utils.toast(err.message); }
    };

    const showCategories = () => {
        const list = Storage.list();
        const counts = Object.keys(Utils.CATEGORIES).map(k => {
            const cnt = list.filter(p => p.category === k).length;
            return `${Utils.CATEGORIES[k]}: ${cnt}`;
        }).join('\n');
        alert('Категории\n\n' + counts);
    };

    const init = () => {
        document.querySelectorAll('.tool-tile').forEach(t => {
            t.addEventListener('click', () => onTool(t.dataset.tool));
        });
    };

    return { init };
})();
