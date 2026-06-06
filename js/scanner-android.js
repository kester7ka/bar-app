const AndroidDetector = (() => {
    const FORMATS = ['qr_code', 'data_matrix', 'ean_13', 'ean_8',
        'code_128', 'code_39', 'code_93', 'codabar', 'itf',
        'upc_a', 'upc_e', 'pdf417', 'aztec'];

    function supported() {
        return 'BarcodeDetector' in window;
    }

    function rectToPoints(b) {
        if (!b) return null;
        return [
            { x: b.x, y: b.y },
            { x: b.x + b.width, y: b.y },
            { x: b.x + b.width, y: b.y + b.height },
            { x: b.x, y: b.y + b.height },
        ];
    }

    function create() {
        let det;
        try {
            det = new BarcodeDetector({ formats: FORMATS });
        } catch {
            det = new BarcodeDetector();
        }
        return {
            engine: 'android',
            async detect(source) {
                let codes;
                try {
                    codes = await det.detect(source);
                } catch {
                    return [];
                }
                return (codes || []).map(c => ({
                    rawValue: c.rawValue,
                    format: c.format || null,
                    cornerPoints: (c.cornerPoints && c.cornerPoints.length)
                        ? c.cornerPoints
                        : rectToPoints(c.boundingBox),
                }));
            },
            dispose() {},
        };
    }

    return { supported, create };
})();
