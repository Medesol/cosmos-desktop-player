import test from "node:test";
import assert from "node:assert/strict";

import { createSearchCache } from "./searchCache.js";

test("search cache returns values until ttl expires", () => {
  let now = 1000;
  const cache = createSearchCache({ ttlMs: 60_000, now: () => now });
  const key = { query: "忽左忽右", limit: 6 };

  cache.set(key, { source: "database", podcasts: [{ id: "aaaaaaaaaaaaaaaaaaaaaaaa" }] });
  assert.equal(cache.get(key).source, "database");

  now += 60_001;
  assert.equal(cache.get(key), null);
});

test("search cache normalizes query and clears all entries", () => {
  const cache = createSearchCache({ now: () => 1000 });
  cache.set({ query: "  忽左   忽右 ", limit: 6 }, { ok: true });

  assert.deepEqual(cache.get({ query: "忽左 忽右", limit: 6 }), { ok: true });
  cache.clear();
  assert.equal(cache.get({ query: "忽左 忽右", limit: 6 }), null);
});
