export function createSearchCache(options = {}) {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? (() => Date.now());
  const entries = new Map();

  return {
    get(keyParts) {
      const key = cacheKey(keyParts);
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() >= entry.expiresAt) {
        entries.delete(key);
        return null;
      }
      return structuredClone(entry.value);
    },

    set(keyParts, value) {
      entries.set(cacheKey(keyParts), {
        value: structuredClone(value),
        expiresAt: now() + ttlMs
      });
    },

    clear() {
      entries.clear();
    }
  };
}

export function normalizeCacheQuery(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function cacheKey({ query, limit }) {
  return `${normalizeCacheQuery(query)}::${Number(limit ?? 6)}`;
}
