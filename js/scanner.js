const Scanner = (() => {
    let stream = null;
    let video = null;
    let detector = null;
    let html5fallback = null;
    let rafId = null;
    let onDetect = null;
    let lastValue = null;
    let stableHits = 0;
    let lastDetectAt = 0;

    const STABLE_HITS_NEEDED = 2;
    const DETECT_INTERVAL = 80;

    function el(id) { return document.getElementById(id); }

    function clearViewport() {
        const v = el('scanner-viewport');
        v.innerHTML = '';
    }

    function buildNativeViewport() {
        const viewport = el('scanner-viewport');
        viewport.innerHTML = '';
        video = document.createElement('video');
        video.id = 'scanner-video';
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.setAttribute('playsinline', 'true');
        viewport.appendChild(video);
        const target = document.createElement('div');
        target.className = 'scanner-target';
        target.id = 'scanner-target';
        target.innerHTML = `
            <span class="scn-corner tl"></span>
            <span class="scn-corner tr"></span>
            <span class="scn-corner bl"></span>
            <span class="scn-corner br"></span>
        `;
        viewport.appendChild(target);
        const ripple = document.createElement('div');
        ripple.className = 'scanner-focus-ripple';
        ripple.id = 'scanner-focus-ripple';
        viewport.appendChild(ripple);
        viewport.addEventListener('click', handleTap);
    }

    function buildFallbackViewport() {
        const viewport = el('scanner-viewport');
        viewport.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.id = 'scanner-h5q';
        wrap.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        viewport.appendChild(wrap);
        const target = document.createElement('div');
        target.className = 'scanner-target static';
        target.id = 'scanner-target';
        target.innerHTML = `
            <span class="scn-corner tl"></span>
            <span class="scn-corner tr"></span>
            <span class="scn-corner bl"></span>
            <span class="scn-corner br"></span>
        `;
        viewport.appendChild(target);
    }

    function resetTarget() {
        const t = el('scanner-target');
        if (!t || t.classList.contains('static')) return;
        t.classList.remove('locked');
        t.style.left = '';
        t.style.top = '';
        t.style.width = '';
        t.style.height = '';
    }

    function moveTarget(rect) {
        const t = el('scanner-target');
        if (!t || t.classList.contains('static') || !video) return;
        const vRect = video.getBoundingClientRect();
        const viewport = el('scanner-viewport');
        const vpRect = viewport.getBoundingClientRect();
        const sx = vRect.width / Math.max(1, video.videoWidth);
        const sy = vRect.height / Math.max(1, video.videoHeight);
        const left = (vRect.left - vpRect.left) + rect.x * sx;
        const top = (vRect.top - vpRect.top) + rect.y * sy;
        const w = rect.width * sx;
        const h = rect.height * sy;
        const pad = 10;
        t.style.left = (left - pad) + 'px';
        t.style.top = (top - pad) + 'px';
        t.style.width = (w + pad * 2) + 'px';
        t.style.height = (h + pad * 2) + 'px';
        t.classList.add('locked');
    }

    function pointsToRect(points) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    async function checkCameraPermission() {
        if (!window.isSecureContext) {
            return { ok: false, reason: 'Нужен HTTPS. Открой приложение через https:// (на github.io уже так).' };
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            return { ok: false, reason: 'Браузер не умеет в камеру через сайт. Попробуй Chrome или Firefox.' };
        }
        try {
            if (navigator.permissions?.query) {
                const st = await navigator.permissions.query({ name: 'camera' });
                if (st.state === 'denied') {
                    return { ok: false, reason: 'Камера заблокирована. Открой ⓘ слева от адресной строки → «Разрешения» → «Камера» → «Разрешить», потом перезагрузи страницу.' };
                }
            }
        } catch {}
        return { ok: true };
    }

    async function open(callback) {
        onDetect = callback;
        lastValue = null;
        stableHits = 0;
        lastDetectAt = 0;
        const perm = await checkCameraPermission();
        if (!perm.ok) {
            Utils.toast(perm.reason);
            return;
        }
        el('scanner-overlay').classList.add('show');
        await new Promise(r => requestAnimationFrame(r));
        const hasNative = 'BarcodeDetector' in window;
        if (hasNative) {
            await openNative();
        } else {
            await openFallback();
        }
    }

    function cameraErrorText(e) {
        const n = e?.name || '';
        if (n === 'NotAllowedError' || n === 'SecurityError') {
            return 'Доступ к камере не дан. Тапни ⓘ слева от адресной строки → Разрешения → Камера → Разрешить.';
        }
        if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'Камера не найдена на устройстве.';
        if (n === 'NotReadableError' || n === 'TrackStartError') return 'Камера занята другим приложением. Закрой его и попробуй снова.';
        if (n === 'OverconstrainedError') return 'Камера не поддерживает нужный режим. Попробуй на другом устройстве.';
        if (n === 'AbortError') return 'Запуск камеры прерван. Попробуй ещё раз.';
        return 'Не удалось включить камеру: ' + (e?.message || n || 'неизвестная ошибка');
    }

    async function openNative() {
        buildNativeViewport();
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            video.srcObject = stream;
            await video.play();
        } catch (e) {
            Utils.toast(cameraErrorText(e));
            await close();
            return;
        }
        try {
            detector = new BarcodeDetector({
                formats: ['qr_code', 'data_matrix', 'ean_13', 'ean_8',
                          'code_128', 'code_39', 'code_93', 'codabar',
                          'itf', 'upc_a', 'upc_e', 'pdf417', 'aztec']
            });
            startNativeLoop();
        } catch (e) {
            await openFallback();
        }
    }

    async function openFallback() {
        buildFallbackViewport();
        if (typeof Html5Qrcode === 'undefined') {
            Utils.toast('Сканер не поддерживается этим браузером');
            await close();
            return;
        }
        html5fallback = new Html5Qrcode('scanner-h5q', { verbose: false });
        try {
            await html5fallback.start(
                { facingMode: { ideal: 'environment' } },
                {
                    fps: 12,
                    qrbox: undefined,
                    disableFlip: false,
                    experimentalFeatures: { useBarCodeDetectorIfSupported: true }
                },
                (text) => handleSuccess(text),
                () => {}
            );
            await new Promise(r => setTimeout(r, 250));
            video = document.querySelector('#scanner-h5q video');
            if (video) {
                video.setAttribute('playsinline', 'true');
                video.playsInline = true;
                video.style.objectFit = 'cover';
            }
        } catch (e) {
            Utils.toast(cameraErrorText(e));
            await close();
        }
    }

    function startNativeLoop() {
        const tick = async () => {
            if (!video || !detector) return;
            const now = Date.now();
            if (now - lastDetectAt < DETECT_INTERVAL) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            lastDetectAt = now;
            try {
                if (video.readyState >= 2) {
                    const codes = await detector.detect(video);
                    if (codes && codes.length) {
                        const code = codes[0];
                        const rect = code.cornerPoints
                            ? pointsToRect(code.cornerPoints)
                            : (code.boundingBox || null);
                        if (rect) moveTarget(rect);
                        if (code.rawValue === lastValue) {
                            stableHits++;
                            if (stableHits >= STABLE_HITS_NEEDED) {
                                return handleSuccess(code.rawValue);
                            }
                        } else {
                            lastValue = code.rawValue;
                            stableHits = 1;
                        }
                    } else {
                        if (stableHits > 0) {
                            stableHits = Math.max(0, stableHits - 1);
                            if (stableHits === 0) {
                                lastValue = null;
                                resetTarget();
                            }
                        } else {
                            resetTarget();
                        }
                    }
                }
            } catch {}
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }

    function handleSuccess(code) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        const cb = onDetect;
        onDetect = null;
        const t = el('scanner-target');
        if (t) t.classList.add('success');
        close().then(() => { if (cb) cb(code); });
    }

    function handleTap(e) {
        if (!video) return;
        const rect = video.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        try {
            const src = stream || (video.srcObject || null);
            const tracks = src && src.getVideoTracks ? src.getVideoTracks() : null;
            const track = tracks && tracks[0];
            if (track && track.getCapabilities) {
                const caps = track.getCapabilities();
                const advanced = [];
                if (caps.focusMode && caps.focusMode.includes('manual')) {
                    advanced.push({ focusMode: 'manual', pointsOfInterest: [{ x, y }] });
                } else if (caps.focusMode && caps.focusMode.includes('single-shot')) {
                    advanced.push({ focusMode: 'single-shot', pointsOfInterest: [{ x, y }] });
                }
                if (advanced.length) track.applyConstraints({ advanced }).catch(() => {});
            }
        } catch {}
        const ripple = el('scanner-focus-ripple');
        if (ripple) {
            const viewport = el('scanner-viewport');
            const vp = viewport.getBoundingClientRect();
            ripple.style.left = (e.clientX - vp.left) + 'px';
            ripple.style.top = (e.clientY - vp.top) + 'px';
            ripple.classList.remove('show');
            void ripple.offsetWidth;
            ripple.classList.add('show');
        }
    }

    async function snapshot() {
        if (!video) {
            video = document.querySelector('#scanner-viewport video');
        }
        if (!video || !video.videoWidth) {
            Utils.toast('Камера ещё не готова');
            return;
        }
        const btn = el('scanner-snap');
        btn?.classList.add('busy');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        let found = null;
        if (detector) {
            try {
                const codes = await detector.detect(canvas);
                if (codes && codes.length) found = codes[0].rawValue;
            } catch {}
        }
        if (!found && 'BarcodeDetector' in window && !detector) {
            try {
                const tmp = new BarcodeDetector();
                const codes = await tmp.detect(canvas);
                if (codes && codes.length) found = codes[0].rawValue;
            } catch {}
        }
        if (!found && typeof jsQR !== 'undefined') {
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'attemptBoth'
            });
            if (result) found = result.data;
        }
        if (!found && typeof Html5Qrcode !== 'undefined') {
            try {
                const tmpDiv = document.createElement('div');
                tmpDiv.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;';
                document.body.appendChild(tmpDiv);
                const tmpId = 'scn-tmp-' + Date.now();
                tmpDiv.id = tmpId;
                const fileLike = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
                if (fileLike) {
                    const tmpScanner = new Html5Qrcode(tmpId, { verbose: false });
                    const file = new File([fileLike], 'snap.png', { type: 'image/png' });
                    const txt = await tmpScanner.scanFile(file, false).catch(() => null);
                    if (txt) found = txt;
                    try { await tmpScanner.clear(); } catch {}
                }
                tmpDiv.remove();
            } catch {}
        }
        btn?.classList.remove('busy');
        if (found) {
            handleSuccess(found);
        } else {
            Utils.toast('На фото ничего не нашлось — поднеси ближе');
        }
    }

    async function close() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (html5fallback) {
            try { await html5fallback.stop(); } catch {}
            try { html5fallback.clear(); } catch {}
            html5fallback = null;
        }
        if (stream) {
            stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
            stream = null;
        }
        if (video) {
            try { video.srcObject = null; } catch {}
            video = null;
        }
        detector = null;
        lastValue = null;
        stableHits = 0;
        lastDetectAt = 0;
        clearViewport();
        el('scanner-overlay').classList.remove('show');
        onDetect = null;
    }

    function init() {
        el('scanner-close')?.addEventListener('click', close);
        el('scanner-cancel')?.addEventListener('click', close);
        el('scanner-snap')?.addEventListener('click', snapshot);
    }

    return { init, open, close };
})();
