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
            scanner = new Html5Qrcode('scanner-viewport', { verbose: false });
            await scanner.start(
                { facingMode: 'environment' },
                {
                    fps: 12,
                    qrbox: (vw, vh) => {
                        const side = Math.min(vw, vh) - 60;
                        const w = Math.max(220, side);
                        const h = Math.round(w * 0.65); // прямоугольник под штрихкод
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
