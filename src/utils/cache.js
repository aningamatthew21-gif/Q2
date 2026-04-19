// Caching utility
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

export const getCachedData = (key) => {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
};

export const setCachedData = (key, data) => {
    cache.set(key, { data, timestamp: Date.now() });
};

export const invalidateCache = (pattern) => {
    const keysToDelete = [];
    for (const key of cache.keys()) {
        if (key.includes(pattern)) {
            keysToDelete.push(key);
        }
    }
    keysToDelete.forEach(key => cache.delete(key));
};
