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
            case 'findbarcode':
                return findByBarcode();
            case 'export':
                return exportPdf();
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

    const findByBarcode = () => {
        if (typeof Scanner === 'undefined' || !Scanner.open) {
            Utils.toast('Сканер недоступен');
            return;
        }
        Scanner.open((code) => {
            if (!code) return;
            let tob = null;
            try {
                const map = JSON.parse(localStorage.getItem('bar-app:barcodes') || '{}');
                if (map[code] && map[code].tob) tob = map[code].tob;
            } catch {}
            if (!tob && /^\d{6,7}$/.test(code)) tob = code;
            const p = tob ? Storage.getByTob(tob) : null;
            if (p) {
                Nav.show('positions');
                setTimeout(() => Positions.openDetails(p.id), 100);
            } else {
                Utils.toast('Позиция по этому штрихкоду не найдена');
            }
        });
    };

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('load failed'));
            document.head.appendChild(s);
        });
    }

    async function ensurePdfMake() {
        if (window.pdfMake && window.pdfMake.vfs) return;
        await loadScript('https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js');
    }

    const exportPdf = async () => {
        const list = Storage.list();
        if (list.length === 0) {
            Utils.toast('Нечего экспортировать');
            return;
        }
        Utils.toast('Готовим PDF…');
        try {
            await ensurePdfMake();
        } catch {
            Utils.toast('Не удалось загрузить генератор PDF');
            return;
        }

        const pad = (n) => String(n).padStart(2, '0');
        const fmtDate = (s) => {
            const d = new Date(s);
            return isNaN(d) ? String(s || '') : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
        };
        const now = new Date();
        const stamp = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const bar = (typeof Auth !== 'undefined' && Auth.bar) ? Auth.bar() : null;
        const barLabel = bar
            ? (bar.name && bar.name.toLowerCase() !== (bar.code || '').toLowerCase() ? `${bar.code} · ${bar.name}` : bar.code)
            : '';

        const catShort = { ingredients: 'Ингредиенты', syrups: 'Сиропы', cookies: 'Печенье', other: 'Прочее' };
        const sorted = list.slice().sort((a, b) =>
            String(Utils.effectiveExpiry(a)).localeCompare(String(Utils.effectiveExpiry(b))));

        const header = ['Название', 'TOB', 'Категория', 'Статус', 'Истекает', 'Осталось']
            .map(t => ({ text: t, style: 'th' }));
        const body = [header];
        let nExpired = 0, nSoon = 0, nOpen = 0;

        sorted.forEach(p => {
            const exp = Utils.expiryLabel(p);
            const eff = Utils.effectiveExpiry(p);
            const days = Utils.daysUntil(eff);
            if (exp.level === 'expired') nExpired++;
            else if (exp.level === 'expiring-soon') nSoon++;
            if (p.is_open) nOpen++;
            const fill = exp.level === 'expired' ? '#fbe4e4'
                       : exp.level === 'expiring-soon' ? '#fbf0db' : null;
            const daysText = days < 0 ? `просрочено ${Math.abs(days)} дн`
                           : days === 0 ? 'сегодня' : `${days} дн`;
            body.push([
                { text: String(p.name || ''), fillColor: fill },
                { text: String(p.tob || ''), fillColor: fill },
                { text: catShort[p.category] || p.category || '', fillColor: fill },
                { text: p.is_open ? 'Открыта' : 'Закрыта', fillColor: fill },
                { text: fmtDate(eff), fillColor: fill },
                { text: daysText, fillColor: fill },
            ]);
        });

        const dd = {
            pageMargins: [26, 34, 26, 36],
            info: { title: 'Bar Manager — позиции' },
            content: [
                { text: 'Позиции бара', style: 'h1' },
                barLabel ? { text: barLabel, style: 'sub' } : '',
                {
                    text: `Выгружено ${stamp}  ·  всего ${list.length}  ·  открыто ${nOpen}  ·  некондиция ${nExpired}  ·  истекает скоро ${nSoon}`,
                    style: 'meta', margin: [0, 3, 0, 12],
                },
                {
                    table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body },
                    layout: {
                        hLineWidth: () => 0.5,
                        vLineWidth: () => 0,
                        hLineColor: () => '#e4e4e7',
                        paddingTop: () => 5, paddingBottom: () => 5,
                        paddingLeft: () => 7, paddingRight: () => 7,
                    },
                },
            ],
            styles: {
                h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
                sub: { fontSize: 12, color: '#52525b' },
                meta: { fontSize: 9, color: '#9a9aa2' },
                th: { fontSize: 9, bold: true, color: '#3f3f46', fillColor: '#f4f4f5' },
            },
            defaultStyle: { fontSize: 10, color: '#18181b' },
        };

        try {
            pdfMake.createPdf(dd).download(`bar-positions-${Utils.today()}.pdf`);
            Utils.toast('PDF сохранён');
        } catch {
            Utils.toast('Не удалось создать PDF');
        }
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
