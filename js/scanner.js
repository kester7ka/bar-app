// Сканер штрихкодов и QR на основе html5-qrcode.
// Использование:
//     Scanner.open((code) => { ... });
// Колбэк вызывается один раз с распознанной строкой,
// после чего камера сама закрывается.

const Scanner = (() => {
    let scanner = null;
    let onDetect = null;

    async function open(callback) {
        if (typeof Html5Qrcode === 'undefined') {
            Utils.toast('Сканер ещё грузится — попробуй через секунду');
            return;
        }
        onDetect = callback;

        const overlay = document.getElementById('scanner-overlay');
        overlay.classList.add('show');

        // Подождём кадр, чтобы #scanner-viewport получил размеры.
        await new Promise(r => requestAnimationFrame(r));

        try {
            // useBarCodeDetectorIfSupported — задействует нативный BarcodeDetector
            // браузера (Chromium/Edge). Он распознаёт коды под произвольным углом,
            // включая повёрнутые на 90°/180° и наклонённые в сторону.
            // disableFlip: false — пытаемся читать и зеркальные кадры (фронт-камера).
            scanner = new Html5Qrcode('scanner-viewport', {
                verbose: false,
                experimentalFeatures: { useBarCodeDetectorIfSupported: true }
            });
            await scanner.start(
                { facingMode: 'environment' },
                {
                    fps: 15,
                    disableFlip: false,
                    qrbox: (vw, vh) => {
                        const side = Math.min(vw, vh) - 60;
                        const w = Math.max(240, side);
                        const h = Math.round(w * 0.7);
                        return { width: w, height: h };
                    }
                },
                handleSuccess,
                () => { /* per-frame fail — игнорируем */ }
            );
        } catch (e) {
            console.warn('scanner', e);
            Utils.toast('Не удалось включить камеру. Дай доступ в настройках браузера.');
            await close();
        }
    }

    function handleSuccess(decoded) {
        const cb = onDetect;
        onDetect = null; // защита от повторных срабатываний
        close().then(() => {
            if (cb) cb(decoded);
        });
    }

    async function close() {
        if (scanner) {
            try { await scanner.stop(); } catch {}
            try { scanner.clear(); } catch {}
            scanner = null;
        }
        document.getElementById('scanner-overlay').classList.remove('show');
        onDetect = null;
    }

    function init() {
        document.getElementById('scanner-close')?.addEventListener('click', close);
        document.getElementById('scanner-cancel')?.addEventListener('click', close);
    }

    return { init, open, close };
})();
