// QR-код прихода. Хранится в localStorage по user_id, поэтому работает
// и в офлайне, и не зависит от перезапусков сервера.
// Логика:
//   1. Если данных нет → показываем 2 кнопки: «Загрузить фото» / «Ввести вручную».
//   2. При загрузке фото — распознаём через jsQR. Если распозналось → сохраняем
//      строку и перерисовываем QR заново через qrcode-generator (SVG).
//      Поэтому это НЕ фото, а сгенерированный код — его не «сфоткаешь» как
//      оригинал; он отображается из расшифрованной строки.
//   3. Если фото не читается → подсказка про ручной ввод.
//   4. Можно «Изменить» (тот же диалог) или «Удалить».

const QR = (() => {
    const KEY_PREFIX = 'bar-app:qr:';

    function key() {
        const u = (typeof Auth !== 'undefined') ? Auth.user() : null;
        return KEY_PREFIX + (u?.id ?? u?.username ?? 'anon');
    }

    function load()  { return localStorage.getItem(key()) || null; }
    function save(s) { localStorage.setItem(key(), String(s)); }
    function clear() { localStorage.removeItem(key()); }

    function render() {
        const data = load();
        const empty  = document.getElementById('qr-empty');
        const filled = document.getElementById('qr-filled');
        if (!empty || !filled) return;
        if (data) {
            empty.classList.add('hidden');
            filled.classList.remove('hidden');
            renderQRImage(data);
            document.getElementById('qr-data').textContent = data;
        } else {
            empty.classList.remove('hidden');
            filled.classList.add('hidden');
        }
    }

    function renderQRImage(data) {
        const container = document.getElementById('qr-image');
        container.innerHTML = '';
        if (typeof qrcode === 'undefined') {
            container.textContent = data;
            return;
        }
        try {
            // typeNumber=0 — автоматический подбор размера. ECC level 'M'.
            const qr = qrcode(0, 'M');
            qr.addData(data);
            qr.make();
            container.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
        } catch (e) {
            container.textContent = data;
        }
    }

    // ----- Распознавание фото -----
    async function handleFile(file) {
        if (!file) return;
        if (typeof jsQR === 'undefined') {
            Utils.toast('Библиотека распознавания не загрузилась — используй ручной ввод');
            return;
        }
        Utils.toast('Распознаём…');
        try {
            const dataUrl = await readAsDataURL(file);
            const img = await loadImage(dataUrl);
            const result = decodeFromImage(img);
            if (result) {
                save(result);
                render();
                Utils.toast('QR распознан');
            } else {
                Utils.toast('Не получилось прочитать QR. Используй ручной ввод.');
                openManual();
            }
        } catch (e) {
            Utils.toast('Не удалось загрузить фото');
        }
    }

    function readAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload  = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    // Уменьшаем картинку до разумного размера — jsQR быстрее справляется.
    function decodeFromImage(img) {
        const MAX = 1200;
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, MAX / Math.max(w, h));
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
            inversionAttempts: 'attemptBoth'
        });
        return code ? code.data : null;
    }

    // ----- Ручной ввод -----
    function openManual() {
        const input = document.getElementById('qr-manual-input');
        input.value = load() || '';
        document.getElementById('qr-manual-modal').classList.add('show');
        setTimeout(() => input.focus(), 80);
    }

    function confirmManual() {
        const v = document.getElementById('qr-manual-input').value.trim();
        if (!v) {
            Utils.toast('Введи данные QR-кода');
            return;
        }
        save(v);
        render();
        document.getElementById('qr-manual-modal').classList.remove('show');
        Utils.toast('QR-код сохранён');
    }

    function init() {
        const up = document.getElementById('qr-upload');
        if (up) up.addEventListener('change', (e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
        });

        document.getElementById('qr-manual-btn')?.addEventListener('click', openManual);
        document.getElementById('qr-edit-btn')?.addEventListener('click', openManual);
        document.getElementById('qr-delete-btn')?.addEventListener('click', () => {
            if (confirm('Удалить QR-код?')) {
                clear();
                render();
                Utils.toast('Удалено');
            }
        });
        document.getElementById('qr-manual-confirm')?.addEventListener('click', confirmManual);
        document.getElementById('qr-manual-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmManual();
            }
        });
    }

    return { init, render };
})();
