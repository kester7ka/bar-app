const IOSDetector = (() => {
    const MAX_SIDE = 860;

    function supported() {
        return typeof ZXing !== 'undefined' && !!ZXing.MultiFormatReader;
    }

    function buildHints() {
        const hints = new Map();
        const f = ZXing.BarcodeFormat;
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
            f.QR_CODE, f.DATA_MATRIX, f.AZTEC, f.PDF_417,
            f.EAN_13, f.EAN_8, f.CODE_128, f.CODE_39, f.CODE_93,
            f.ITF, f.UPC_A, f.UPC_E, f.CODABAR,
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        return hints;
    }

    function create() {
        const hints = buildHints();
        const reader = new ZXing.MultiFormatReader();
        reader.setHints(hints);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        function drawScaled(source) {
            const w = source.videoWidth || source.naturalWidth || source.width || 0;
            const h = source.videoHeight || source.naturalHeight || source.height || 0;
            if (!w || !h) return 0;
            const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
            return scale;
        }

        function zxingDecode(scale) {
            try {
                const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
                const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
                const result = reader.decode(bitmap, hints);
                const pts = (result.getResultPoints() || [])
                    .filter(p => p)
                    .map(p => ({ x: p.getX() / scale, y: p.getY() / scale }));
                return [{
                    rawValue: result.getText(),
                    format: result.getBarcodeFormat ? String(result.getBarcodeFormat()) : null,
                    cornerPoints: pts.length ? pts : null,
                }];
            } catch {
                return null;
            } finally {
                try { reader.reset(); } catch {}
            }
        }

        function jsqrDecode(scale) {
            if (typeof jsQR === 'undefined') return [];
            try {
                const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
                if (r && r.location) {
                    const L = r.location;
                    const pts = [L.topLeftCorner, L.topRightCorner, L.bottomRightCorner, L.bottomLeftCorner]
                        .map(p => ({ x: p.x / scale, y: p.y / scale }));
                    return [{ rawValue: r.data, format: 'qr_code', cornerPoints: pts }];
                }
            } catch {}
            return [];
        }

        return {
            engine: 'ios',
            async detect(source) {
                const scale = drawScaled(source);
                if (!scale) return [];
                const zx = zxingDecode(scale);
                if (zx) return zx;
                return jsqrDecode(scale);
            },
            dispose() {
                try { reader.reset(); } catch {}
            },
        };
    }

    return { supported, create };
})();
