const Storage = (() => {
    const POS_CACHE_KEY = 'bar-app:positions-cache';
    let cache = [];

    function writeLocal() {
        try { localStorage.setItem(POS_CACHE_KEY, JSON.stringify(cache)); } catch {}
    }
    function readLocal() {
        try { return JSON.parse(localStorage.getItem(POS_CACHE_KEY) || 'null'); }
        catch { return null; }
    }

    async function refresh() {
        try {
            cache = await Api.get('/api/positions');
            writeLocal();
            return cache;
        } catch (e) {
            
            const local = readLocal();
            if (local) {
                cache = local;
                return cache;
            }
            throw e;
        }
    }

    function list() {
        return cache.slice();
    }

    function get(id) {
        return cache.find(p => p.id === id) || null;
    }

    function getByTob(tob) {
        const t = String(tob).trim();
        return cache.find(p => p.tob === t) || null;
    }

    function findOpenSibling(name, category, excludeId = null) {
        const norm = name.trim().toLowerCase();
        return cache.find(p =>
            p.is_open &&
            p.id !== excludeId &&
            p.category === category &&
            p.name.trim().toLowerCase() === norm
        ) || null;
    }

    
    function countOpenSiblings(name, category, excludeId = null) {
        const norm = name.trim().toLowerCase();
        let n = 0;
        for (const p of cache) {
            if (!p.is_open) continue;
            if (p.id === excludeId) continue;
            if (p.category !== category) continue;
            if (p.name.trim().toLowerCase() !== norm) continue;
            n++;
        }
        return n;
    }

    
    
    
    
    
    function maxOpenFor(category) {
        if (category === 'syrups')  return 2;
        if (category === 'cookies') return 0;
        return Infinity;
    }

    async function save(position) {
        const payload = {
            tob: position.tob,
            name: position.name,
            category: position.category,
            production_date: position.production_date || null,
            closed_shelf_days: position.closed_shelf_days || null,
            expiry_closed: position.expiry_closed,
            shelf_open_days: position.shelf_open_days,
            is_open: position.is_open
        };
        let saved;
        if (cache.find(p => p.id === position.id)) {
            saved = await Api.put(`/api/positions/${position.id}`, payload);
        } else {
            saved = await Api.post('/api/positions', payload);
        }
        await refresh();
        return saved;
    }

    async function remove(id) {
        await Api.delete(`/api/positions/${id}`);
        await refresh();
    }

    async function openPos(id, opts = {}) {
        
        await Api.post(`/api/positions/${id}/open`, opts || {});
        await refresh();
    }

    async function closePos(id) {
        await Api.post(`/api/positions/${id}/close`);
        await refresh();
    }

    async function removeExpired() {
        const today = new Date().toISOString().slice(0, 10);
        const expired = cache.filter(p => {
            const exp = Utils.effectiveExpiry(p);
            return exp < today;
        });
        for (const p of expired) {
            await Api.delete(`/api/positions/${p.id}`);
        }
        await refresh();
        return expired.length;
    }

    
    function settings() {
        try { return JSON.parse(localStorage.getItem('bar-app:settings') || '{}'); }
        catch { return {}; }
    }
    function saveSettings(s) {
        localStorage.setItem('bar-app:settings', JSON.stringify(s));
    }

    return {
        refresh,
        list, get, getByTob, findOpenSibling, countOpenSiblings, maxOpenFor,
        save, remove, openPos, closePos, removeExpired,
        settings, saveSettings
    };
})();
