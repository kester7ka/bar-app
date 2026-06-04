const Scanner = (() => {
    let stream = null;
    let video = null;
    let detector = null;
    let html5fallback = null;
    let rafId = null;
    let onDetect = null;
    let lastValue = null;
    let stableHits = 0;

    const STABLE_HITS_NEEDED = 2;

    function el(id) { return document.getElementById(id); }

    async function ensureVideo() {
        const viewport = el('scanner-viewport');
        if (video && viewport.contains(video)) return video;
        viewport.innerHTML = '';
        video = document.createElement('video');
        video.id = 'scanner-video';
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.setAttribute('playsinline', 'true');
        viewport.appendChild(video);
        const targetWrap = document.createElement('div');
        targetWrap.className = 'scanner-target';
        targetWrap.id = 'scanner-target';
        targetWrap.innerHTML = `
            <span class="scn-corner tl"></span>
            <span class="scn-corner tr"></span>
            <span class="scn-corner bl"></span>
            <span class="scn-corner br"></span>
        `;
        viewport.appendChild(targetWrap);
        const focusRipple = document.createElement('div');
        focusRipple.className = 'scanner-focus-ripple';
        focusRipple.id = 'scanner-focus-ripple';
        viewport.appendChild(focusRipple);
        viewport.addEventListener('click', handleTap);
        return video;
    }

    function resetTarget() {
        const t = el('scanner-target');
        if (!t) return;
        t.classList.remove('locked');
        t.style.left = '';
        t.style.top = '';
        t.style.width = '';
        t.style.height = '';
    }

    function moveTarget(rect) {
        const t = el('scanner-target');
        if (!t || !video) return;
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

    async function open(callback) {
        onDetect = callback;
        lastValue = null;
        stableHits = 0;
        el('scanner-overlay').classList.add('show');
        await new Promise(r => requestAnimationFrame(r));
        await ensureVideo();
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
            video.srcObject = stream;
            await video.play();
        } catch (e) {
            Utils.toast('Не удалось включить камеру. Дай доступ в настройках.');
            await close();
            return;
        }
        if ('BarcodeDetector' in window) {
            try {
                detector = new BarcodeDetector({
                    formats: ['qr_code', 'data_matrix', 'ean_13', 'ean_8',
                              'code_128', 'code_39', 'code_93', 'codabar',
                              'itf', 'upc_a', 'upc_e', 'pdf417', 'aztec']
                });
                startNativeLoop();
                return;
            } catch {}
        }
        startFallback();
    }

    function startNativeLoop() {
        const tick = async () => {
            if (!video || !detector) return;
            try {
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
                    if (stableHits > 0 || lastValue) {
                        stableHits = Math.max(0, stableHits - 1);
                        if (stableHits === 0) {
                            lastValue = null;
                            resetTarget();
                        }
                    } else {
                        resetTarget();
                    }
                }
            } catch {}
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }

    function startFallback() {
        if (typeof Html5Qrcode === 'undefined') {
            Utils.toast('Сканер не поддерживается этим браузером');
            close();
            return;
        }
        const viewport = el('scanner-viewport');
        const div = document.createElement('div');
        div.id = 'scanner-h5q';
        div.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
        viewport.appendChild(div);
        if (video) video.style.display = 'none';
        html5fallback = new Html5Qrcode('scanner-h5q', { verbose: false });
        html5fallback.start(
            { facingMode: 'environment' },
            { fps: 15, qrbox: { width: 260, height: 200 }, disableFlip: false,
              experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
            (text) => handleSuccess(text),
            () => {}
        ).catch(() => { Utils.toast('Не удалось включить камеру'); close(); });
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
        if (!stream || !video) return;
        const rect = video.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        try {
            const track = stream.getVideoTracks()[0];
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
        if (!found && typeof jsQR !== 'undefined') {
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imgData.data, imgData.width, imgData.height, {
                inversionAttempts: 'attemptBoth'
            });
            if (result) found = result.data;
        }
        btn?.classList.remove('busy');
        if (found) {
            handleSuccess(found);
        } else {
            Utils.toast('На фото ничего не нашлось — наведи ближе');
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
            video.srcObject = null;
            video.style.display = '';
        }
        detector = null;
        lastValue = null;
        stableHits = 0;
        resetTarget();
        const t = el('scanner-target');
        if (t) t.classList.remove('success');
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
