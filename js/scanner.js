const Scanner = (() => {
    let stream = null;
    let video = null;
    let detector = null;
    let rafId = null;
    let onDetect = null;
    let lastValue = null;
    let stableHits = 0;
    let lastDetectAt = 0;
    let torchOn = false;
    let detectInterval = 90;

    const STABLE_HITS_NEEDED = 2;

    function el(id) { return document.getElementById(id); }

    function pickDetector() {
        if (typeof AndroidDetector !== 'undefined' && AndroidDetector.supported()) {
            detectInterval = 80;
            return AndroidDetector.create();
        }
        if (typeof IOSDetector !== 'undefined' && IOSDetector.supported()) {
            detectInterval = 130;
            return IOSDetector.create();
        }
        return null;
    }

    function buildViewport() {
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
            <span class="scn-laser"></span>
        `;
        viewport.appendChild(target);

        const ripple = document.createElement('div');
        ripple.className = 'scanner-focus-ripple';
        ripple.id = 'scanner-focus-ripple';
        viewport.appendChild(ripple);

        viewport.onclick = handleTap;
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

    function pointsToRect(points) {
        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);
        return {
            x: Math.min(...xs), y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
        };
    }

    function moveTarget(rect) {
        const t = el('scanner-target');
        if (!t || !video || !video.videoWidth) return;
        const vRect = video.getBoundingClientRect();
        const vpRect = el('scanner-viewport').getBoundingClientRect();
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const coverScale = Math.max(vRect.width / vw, vRect.height / vh);
        const dispW = vw * coverScale;
        const dispH = vh * coverScale;
        const offX = (vRect.width - dispW) / 2 + (vRect.left - vpRect.left);
        const offY = (vRect.height - dispH) / 2 + (vRect.top - vpRect.top);
        const pad = 12;
        const left = offX + rect.x * coverScale - pad;
        const top = offY + rect.y * coverScale - pad;
        const w = rect.width * coverScale + pad * 2;
        const h = rect.height * coverScale + pad * 2;
        t.style.left = left + 'px';
        t.style.top = top + 'px';
        t.style.width = w + 'px';
        t.style.height = h + 'px';
        t.classList.add('locked');
    }

    async function open(callback) {
        onDetect = callback;
        lastValue = null;
        stableHits = 0;
        lastDetectAt = 0;
        torchOn = false;
        el('scanner-overlay').classList.add('show');
        await new Promise(r => requestAnimationFrame(r));
        buildViewport();

        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
                audio: false,
            });
            video.srcObject = stream;
            await video.play();
        } catch (e) {
            Utils.toast('Не удалось включить камеру. Дай доступ.');
            await close();
            return;
        }

        setupTorchButton();

        detector = pickDetector();
        if (!detector) {
            Utils.toast('Этот браузер не умеет сканировать вживую — загрузи фото');
        } else {
            startLoop();
        }
    }

    function startLoop() {
        const tick = async () => {
            if (!video || !detector) return;
            const now = Date.now();
            if (now - lastDetectAt < detectInterval) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            lastDetectAt = now;
            if (video.readyState >= 2) {
                let codes = [];
                try { codes = await detector.detect(video); } catch { codes = []; }
                if (codes && codes.length) {
                    const code = codes[0];
                    if (code.cornerPoints && code.cornerPoints.length) {
                        moveTarget(pointsToRect(code.cornerPoints));
                    }
                    if (code.rawValue === lastValue) {
                        stableHits++;
                        if (stableHits >= STABLE_HITS_NEEDED) {
                            return handleSuccess(code.rawValue, code);
                        }
                    } else {
                        lastValue = code.rawValue;
                        stableHits = 1;
                    }
                } else if (stableHits > 0) {
                    stableHits = Math.max(0, stableHits - 1);
                    if (stableHits === 0) { lastValue = null; resetTarget(); }
                } else {
                    resetTarget();
                }
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
    }

    function handleSuccess(code, meta) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        const cb = onDetect;
        onDetect = null;
        const t = el('scanner-target');
        if (t) t.classList.add('success');
        if (navigator.vibrate) { try { navigator.vibrate(40); } catch {} }
        setTimeout(() => {
            close().then(() => { if (cb) cb(code, meta || {}); });
        }, 180);
    }

    function getTrack() {
        const src = stream || (video && video.srcObject) || null;
        const tracks = src && src.getVideoTracks ? src.getVideoTracks() : null;
        return tracks && tracks[0];
    }

    function setupTorchButton() {
        const btn = el('scanner-torch');
        if (!btn) return;
        let hasTorch = false;
        try {
            const track = getTrack();
            const caps = track && track.getCapabilities ? track.getCapabilities() : {};
            hasTorch = !!caps.torch;
        } catch {}
        btn.classList.toggle('hidden', !hasTorch);
        btn.classList.remove('on');
    }

    async function toggleTorch() {
        const track = getTrack();
        if (!track || !track.applyConstraints) return;
        torchOn = !torchOn;
        try {
            await track.applyConstraints({ advanced: [{ torch: torchOn }] });
            el('scanner-torch')?.classList.toggle('on', torchOn);
        } catch {
            torchOn = !torchOn;
            Utils.toast('Фонарик недоступен');
        }
    }

    function handleTap(e) {
        if (!video) return;
        const rect = video.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        if (x < 0 || x > 1 || y < 0 || y > 1) return;
        try {
            const track = getTrack();
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
            const vp = el('scanner-viewport').getBoundingClientRect();
            ripple.style.left = (e.clientX - vp.left) + 'px';
            ripple.style.top = (e.clientY - vp.top) + 'px';
            ripple.classList.remove('show');
            void ripple.offsetWidth;
            ripple.classList.add('show');
        }
    }

    function frameToCanvas(source) {
        const w = source.videoWidth || source.naturalWidth || source.width;
        const h = source.videoHeight || source.naturalHeight || source.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(source, 0, 0, w, h);
        return canvas;
    }

    async function decodeStill(source) {
        if (detector) {
            try {
                const codes = await detector.detect(source);
                if (codes && codes.length) return codes[0].rawValue;
            } catch {}
        }
        const canvas = source.tagName === 'CANVAS' ? source : frameToCanvas(source);
        if ('BarcodeDetector' in window && (!detector || detector.engine !== 'android')) {
            try {
                const tmp = new BarcodeDetector();
                const codes = await tmp.detect(canvas);
                if (codes && codes.length) return codes[0].rawValue;
            } catch {}
        }
        if (typeof jsQR !== 'undefined') {
            try {
                const ctx = canvas.getContext('2d');
                const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
                if (r) return r.data;
            } catch {}
        }
        return null;
    }

    async function snapshot() {
        if (!video || !video.videoWidth) {
            Utils.toast('Камера ещё не готова');
            return;
        }
        const btn = el('scanner-snap');
        btn?.classList.add('busy');
        const found = await decodeStill(frameToCanvas(video));
        btn?.classList.remove('busy');
        if (found) handleSuccess(found, { source: 'snapshot' });
        else Utils.toast('На фото ничего не нашлось — поднеси ближе');
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async function handleUpload(file) {
        if (!file) return;
        Utils.toast('Распознаём фото…');
        try {
            const img = await loadImage(file);
            const found = await decodeStill(img);
            if (found) handleSuccess(found, { source: 'upload' });
            else Utils.toast('Код на фото не распознан');
        } catch {
            Utils.toast('Не удалось открыть фото');
        }
    }

    async function close() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (detector) { try { detector.dispose(); } catch {} detector = null; }
        if (stream) {
            stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
            stream = null;
        }
        if (video) {
            try { video.srcObject = null; } catch {}
            video = null;
        }
        lastValue = null;
        stableHits = 0;
        torchOn = false;
        const vp = el('scanner-viewport');
        if (vp) vp.innerHTML = '';
        el('scanner-overlay').classList.remove('show');
        onDetect = null;
    }

    function init() {
        el('scanner-close')?.addEventListener('click', close);
        el('scanner-snap')?.addEventListener('click', snapshot);
        el('scanner-torch')?.addEventListener('click', toggleTorch);
        el('scanner-upload')?.addEventListener('click', () => el('scanner-file')?.click());
        el('scanner-file')?.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            handleUpload(f);
            e.target.value = '';
        });
    }

    return { init, open, close };
})();
