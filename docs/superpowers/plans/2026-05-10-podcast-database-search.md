# Podcast SQLite Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent SQLite-backed podcast directory so website search queries local podcast metadata instead of public search providers or Xiaoyuzhou app APIs.

**Architecture:** Add a focused SQLite store module for podcast metadata, search, and CRUD. Keep Xiaoyuzhou public-page parsing in `src/xiaoyuzhou.js`, but make search use the store and auto-upsert successful direct lookups. Add admin-only CRUD routes in `src/server.js` protected by `ADMIN_TOKEN`, plus process-local search caching with explicit invalidation after writes.

**Tech Stack:** Node.js 24 ESM, built-in `node:sqlite` `DatabaseSync`, Node native `node:test`, existing native HTTP server, Docker Compose volume for `data/`.

---

## File Structure

- Create `src/podcastStore.js`: SQLite connection, schema migration, normalization, CRUD, FTS5 setup, `LIKE` fallback search, cache invalidation hook support.
- Create `src/podcastStore.test.js`: unit tests for schema, CRUD, search, Chinese substring fallback, and cache invalidation calls.
- Create `src/searchCache.js`: tiny TTL cache for normalized keyword search responses.
- Create `src/searchCache.test.js`: cache hit, expiry, and clear behavior.
- Modify `src/xiaoyuzhou.js`: remove public provider flow from normal keyword search, accept `podcastStore` and `searchCache`, upsert direct lookups, search SQLite for keyword queries, preserve response shape.
- Modify `src/xiaoyuzhou.test.js`: replace in-process `Map` catalog assumptions with store-backed tests.
- Modify `src/server.js`: initialize the default store, wire `/api/search`, add admin CRUD routes, add JSON body parsing and bearer auth helpers.
- Create or modify `src/server.test.js`: HTTP integration tests for admin auth and CRUD routes.
- Modify `.gitignore`: add `data/`.
- Modify `deploy/docker-compose.yml`: mount `../data:/app/data` and add `ADMIN_TOKEN` / `PODCAST_DB_PATH` environment entries.
- Modify `README.md` and `docs/architecture.md`: document SQLite path, admin token, CRUD API, search behavior, and deployment persistence.
- Modify `package.json`: add `check` coverage for new JavaScript files if the existing explicit `node --check` list remains.

---

### Task 1: SQLite Podcast Store

**Files:**
- Create: `src/podcastStore.js`
- Create: `src/podcastStore.test.js`

- [ ] **Step 1: Write failing store tests**

Create `src/podcastStore.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPodcastStore, normalizePodcastForStorage, normalizeSearchText } from "./podcastStore.js";

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), "podcast-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "podcasts.sqlite");
}

const basePodcast = {
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  title: "忽左忽右",
  author: "JustPod",
  brief: "从中文世界出发",
  description: "历史、文化与公共生活",
  coverUrl: "https://image.example/show.jpg",
  subscriptionCount: 120000,
  episodeCount: 300,
  latestEpisodePubDate: "2026-05-01T00:00:00.000Z",
  sourceUrl: "https://www.xiaoyuzhoufm.com/podcast/aaaaaaaaaaaaaaaaaaaaaaaa",
  aliases: ["忽左", "leftright"]
};

test("normalizeSearchText lowercases and removes repeated whitespace", () => {
  assert.equal(normalizeSearchText("  JustPod   忽左忽右  "), "justpod忽左忽右");
});

test("normalizePodcastForStorage validates id and title", () => {
  assert.throws(() => normalizePodcastForStorage({ ...basePodcast, id: "bad" }), /节目 ID/);
  assert.throws(() => normalizePodcastForStorage({ ...basePodcast, title: "   " }), /节目标题/);
  assert.deepEqual(normalizePodcastForStorage(basePodcast).aliases, ["忽左", "leftright"]);
});

test("podcast store creates, gets, updates, lists, and deletes records", (t) => {
  const store = createPodcastStore({ dbPath: tempDb(t), now: () => "2026-05-10T00:00:00.000Z" });
  t.after(() => store.close());

  store.upsertPodcast(basePodcast);
  assert.equal(store.getPodcast(basePodcast.id).title, "忽左忽右");

  store.upsertPodcast({ ...basePodcast, title: "忽左忽右新版", aliases: ["忽左忽右"] });
  assert.equal(store.getPodcast(basePodcast.id).title, "忽左忽右新版");
  assert.deepEqual(store.getPodcast(basePodcast.id).aliases, ["忽左忽右"]);

  assert.deepEqual(
    store.listPodcasts({ limit: 10, offset: 0 }).map((podcast) => podcast.id),
    [basePodcast.id]
  );

  assert.equal(store.deletePodcast(basePodcast.id), true);
  assert.equal(store.getPodcast(basePodcast.id), null);
  assert.equal(store.deletePodcast(basePodcast.id), false);
});

test("podcast store searches title, aliases, author, and Chinese substring fallback", (t) => {
  const store = createPodcastStore({ dbPath: tempDb(t) });
  t.after(() => store.close());

  store.upsertPodcast(basePodcast);
  store.upsertPodcast({
    id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    title: "随机波动",
    author: "声动活泼",
    brief: "女性主义播客",
    description: "讨论公共议题",
    aliases: ["stochastic volatility"],
    sourceUrl: "https://www.xiaoyuzhoufm.com/podcast/bbbbbbbbbbbbbbbbbbbbbbbb"
  });

  assert.deepEqual(store.searchPodcasts("忽左").map((podcast) => podcast.id), [basePodcast.id]);
  assert.deepEqual(store.searchPodcasts("leftright").map((podcast) => podcast.id), [basePodcast.id]);
  assert.deepEqual(store.searchPodcasts("声动").map((podcast) => podcast.id), ["bbbbbbbbbbbbbbbbbbbbbbbb"]);
  assert.deepEqual(store.searchPodcasts("不存在的节目").map((podcast) => podcast.id), []);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: FAIL because `src/podcastStore.js` does not exist.

- [ ] **Step 3: Implement `src/podcastStore.js`**

Create `src/podcastStore.js`:

```js
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ID_PATTERN = /^[a-f0-9]{24}$/i;
const DEFAULT_LIMIT = 20;

export function createPodcastStore(options = {}) {
  const dbPath = options.dbPath ?? process.env.PODCAST_DB_PATH ?? "data/podcasts.sqlite";
  const now = options.now ?? (() => new Date().toISOString());
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  migrate(db);

  return {
    upsertPodcast(podcast) {
      const record = normalizePodcastForStorage(podcast, now());
      db.prepare(`
        INSERT INTO podcasts (
          id, title, author, brief, description, coverUrl, subscriptionCount,
          episodeCount, latestEpisodePubDate, sourceUrl, aliases, searchText,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          author = excluded.author,
          brief = excluded.brief,
          description = excluded.description,
          coverUrl = excluded.coverUrl,
          subscriptionCount = excluded.subscriptionCount,
          episodeCount = excluded.episodeCount,
          latestEpisodePubDate = excluded.latestEpisodePubDate,
          sourceUrl = excluded.sourceUrl,
          aliases = excluded.aliases,
          searchText = excluded.searchText,
          updatedAt = excluded.updatedAt
      `).run(
        record.id,
        record.title,
        record.author,
        record.brief,
        record.description,
        record.coverUrl,
        record.subscriptionCount,
        record.episodeCount,
        record.latestEpisodePubDate,
        record.sourceUrl,
        record.aliasesJson,
        record.searchText,
        record.createdAt,
        record.updatedAt
      );
      refreshFts(db, record);
      return rowToPodcast(db.prepare("SELECT * FROM podcasts WHERE id = ?").get(record.id));
    },

    getPodcast(id) {
      assertPodcastId(id);
      return rowToPodcast(db.prepare("SELECT * FROM podcasts WHERE id = ?").get(id.toLowerCase()));
    },

    listPodcasts(options = {}) {
      const limit = clampLimit(options.limit);
      const offset = Math.max(0, Number(options.offset ?? 0));
      return db.prepare("SELECT * FROM podcasts ORDER BY updatedAt DESC, title ASC LIMIT ? OFFSET ?")
        .all(limit, offset)
        .map(rowToPodcast);
    },

    searchPodcasts(query, options = {}) {
      const normalized = normalizeSearchText(query);
      if (!normalized) return [];
      const limit = clampLimit(options.limit);
      const found = new Map();

      for (const row of searchFts(db, query, limit)) {
        found.set(row.id, rowToPodcast(row));
      }

      const like = `%${escapeLike(normalized)}%`;
      const rows = db.prepare(`
        SELECT * FROM podcasts
        WHERE searchText LIKE ? ESCAPE '\\'
        ORDER BY
          CASE
            WHEN title LIKE ? THEN 0
            WHEN aliases LIKE ? THEN 1
            WHEN author LIKE ? THEN 2
            ELSE 3
          END,
          subscriptionCount DESC,
          title ASC
        LIMIT ?
      `).all(like, `%${query}%`, `%${query}%`, `%${query}%`, limit);
      for (const row of rows) {
        found.set(row.id, rowToPodcast(row));
      }

      return [...found.values()].slice(0, limit);
    },

    deletePodcast(id) {
      assertPodcastId(id);
      const normalizedId = id.toLowerCase();
      db.prepare("DELETE FROM podcast_fts WHERE id = ?").run(normalizedId);
      const result = db.prepare("DELETE FROM podcasts WHERE id = ?").run(normalizedId);
      return result.changes > 0;
    },

    close() {
      db.close();
    }
  };
}

export function normalizePodcastForStorage(podcast, timestamp = new Date().toISOString()) {
  assertPodcastId(podcast?.id);
  const title = String(podcast.title ?? "").trim();
  if (!title) {
    throw new Error("节目标题不能为空。");
  }
  const aliases = normalizeAliases(podcast.aliases);
  const record = {
    id: podcast.id.toLowerCase(),
    title,
    author: text(podcast.author),
    brief: text(podcast.brief),
    description: text(podcast.description),
    coverUrl: text(podcast.coverUrl),
    subscriptionCount: nullableInteger(podcast.subscriptionCount),
    episodeCount: nullableInteger(podcast.episodeCount),
    latestEpisodePubDate: text(podcast.latestEpisodePubDate),
    sourceUrl: text(podcast.sourceUrl) || `https://www.xiaoyuzhoufm.com/podcast/${podcast.id.toLowerCase()}`,
    aliases,
    aliasesJson: JSON.stringify(aliases),
    createdAt: text(podcast.createdAt) || timestamp,
    updatedAt: timestamp
  };
  record.searchText = normalizeSearchText([
    record.title,
    record.author,
    record.brief,
    record.description,
    aliases.join(" ")
  ].join(" "));
  return record;
}

export function normalizeSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS podcasts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      brief TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      coverUrl TEXT NOT NULL DEFAULT '',
      subscriptionCount INTEGER,
      episodeCount INTEGER,
      latestEpisodePubDate TEXT NOT NULL DEFAULT '',
      sourceUrl TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      searchText TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS podcasts_updatedAt_idx ON podcasts(updatedAt);
    CREATE VIRTUAL TABLE IF NOT EXISTS podcast_fts USING fts5(
      id UNINDEXED,
      title,
      author,
      brief,
      description,
      aliases,
      tokenize = 'unicode61'
    );
  `);
}

function refreshFts(db, record) {
  db.prepare("DELETE FROM podcast_fts WHERE id = ?").run(record.id);
  db.prepare(`
    INSERT INTO podcast_fts (id, title, author, brief, description, aliases)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(record.id, record.title, record.author, record.brief, record.description, record.aliases.join(" "));
}

function searchFts(db, query, limit) {
  const ftsQuery = ftsTerms(query);
  if (!ftsQuery) return [];
  try {
    return db.prepare(`
      SELECT p.* FROM podcast_fts f
      JOIN podcasts p ON p.id = f.id
      WHERE podcast_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit);
  } catch {
    return [];
  }
}

function ftsTerms(query) {
  return String(query ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" ");
}

function rowToPodcast(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    brief: row.brief,
    description: row.description,
    coverUrl: row.coverUrl,
    subscriptionCount: row.subscriptionCount,
    episodeCount: row.episodeCount,
    latestEpisodePubDate: row.latestEpisodePubDate,
    sourceUrl: row.sourceUrl,
    aliases: parseAliases(row.aliases),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function normalizeAliases(value) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function parseAliases(value) {
  try {
    const aliases = JSON.parse(value || "[]");
    return Array.isArray(aliases) ? aliases : [];
  } catch {
    return [];
  }
}

function assertPodcastId(id) {
  if (!ID_PATTERN.test(String(id ?? ""))) {
    throw new Error("节目 ID 格式不对。");
  }
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function clampLimit(value) {
  const number = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(number)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.trunc(number)));
}

function text(value) {
  return String(value ?? "").trim();
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}
```

- [ ] **Step 4: Run store tests**

Run:

```bash
node --test src/podcastStore.test.js
```

Expected: PASS with all `podcastStore` tests green. The Node experimental SQLite warning is acceptable on Node 24.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/podcastStore.js src/podcastStore.test.js
git commit -m "Add SQLite podcast store"
```

---

### Task 2: Search Cache and Store-Backed Public Search

**Files:**
- Create: `src/searchCache.js`
- Create: `src/searchCache.test.js`
- Modify: `src/xiaoyuzhou.js`
- Modify: `src/xiaoyuzhou.test.js`

- [ ] **Step 1: Write failing cache tests**

Create `src/searchCache.test.js`:

```js
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
```

- [ ] **Step 2: Run cache tests to verify failure**

Run:

```bash
node --test src/searchCache.test.js
```

Expected: FAIL because `src/searchCache.js` does not exist.

- [ ] **Step 3: Implement `src/searchCache.js`**

Create `src/searchCache.js`:

```js
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
```

- [ ] **Step 4: Run cache tests**

Run:

```bash
node --test src/searchCache.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing store-backed search tests**

In `src/xiaoyuzhou.test.js`, remove provider-specific imports and tests. The import block should no longer include `extractEpisodeIdsFromSearchHtml` or `extractPodcastIdsFromSearchHtml`, and delete the two tests named `search html extraction deduplicates xiaoyuzhou podcast and episode ids` and `search html extraction handles encoded redirect result links`.

Add this import:

```js
import { createSearchCache } from "./searchCache.js";
```

Append these tests before helper functions:

```js
test("searchPodcasts searches the podcast store for keyword queries", async () => {
  const podcastStore = {
    searchPodcasts(query, options) {
      assert.equal(query, "忽左忽右");
      assert.equal(options.limit, 6);
      return [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          title: "忽左忽右",
          author: "JustPod",
          brief: "从中文世界出发",
          description: "",
          coverUrl: "",
          subscriptionCount: 1,
          episodeCount: 2,
          latestEpisodePubDate: "",
          sourceUrl: "https://www.xiaoyuzhoufm.com/podcast/aaaaaaaaaaaaaaaaaaaaaaaa",
          aliases: ["忽左"]
        }
      ];
    }
  };

  const result = await searchPodcasts("忽左忽右", { podcastStore });

  assert.equal(result.source, "database");
  assert.deepEqual(result.podcasts.map((podcast) => podcast.id), ["aaaaaaaaaaaaaaaaaaaaaaaa"]);
  assert.deepEqual(result.results.map((item) => item.episodes), [[]]);
});

test("searchPodcasts caches keyword database results and clears cache after direct upsert", async () => {
  let searches = 0;
  const cache = createSearchCache({ now: () => 1000 });
  const podcastStore = {
    searchPodcasts() {
      searches += 1;
      return [{ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右", sourceUrl: "" }];
    },
    upsertPodcast() {
      cache.clear();
    }
  };

  await searchPodcasts("忽左忽右", { podcastStore, searchCache: cache });
  await searchPodcasts("忽左忽右", { podcastStore, searchCache: cache });
  assert.equal(searches, 1);

  await searchPodcasts(`https://www.xiaoyuzhoufm.com/podcast/${SPURS_PODCAST_ID}`, {
    podcastStore,
    searchCache: cache,
    fetchPodcast: async () => ({
      podcast: { id: SPURS_PODCAST_ID, title: "马刺进步报告", sourceUrl: "" },
      episodes: []
    })
  });

  await searchPodcasts("忽左忽右", { podcastStore, searchCache: cache });
  assert.equal(searches, 2);
});
```

- [ ] **Step 6: Run xiaoyuzhou tests to verify failure**

Run:

```bash
node --test src/xiaoyuzhou.test.js
```

Expected: FAIL because `searchPodcasts` does not yet read `podcastStore` / `searchCache`.

- [ ] **Step 7: Modify `src/xiaoyuzhou.js` for store-backed search**

In `src/xiaoyuzhou.js`, keep parsing functions unchanged. Replace `runtimePodcastCatalog` lookup with store-backed logic. Add these helper functions near existing search helpers:

```js
function resultsFromPodcasts(podcasts) {
  return podcasts.map((podcast) => ({
    podcast,
    episodes: [],
    sourceUrl: podcast.sourceUrl
  }));
}

function upsertResolvedPodcast(result, podcastStore, searchCache) {
  if (result?.podcast && podcastStore?.upsertPodcast) {
    podcastStore.upsertPodcast(result.podcast);
    searchCache?.clear?.();
  }
}
```

Change the top of `searchPodcasts` to use these options:

```js
export async function searchPodcasts(rawQuery, options = {}) {
  const query = sanitizeQuery(rawQuery);
  const fetchPodcast = options.fetchPodcast ?? fetchPodcastById;
  const fetchEpisode = options.fetchEpisode ?? fetchEpisodeById;
  const podcastStore = options.podcastStore;
  const searchCache = options.searchCache;
  const limit = options.limit ?? 6;
  const direct = parseDirectTarget(query);
```

For every direct branch that obtains `const result = await fetchPodcast(...)`, call:

```js
upsertResolvedPodcast(result, podcastStore, searchCache);
```

For normal keyword queries, before curated fallback, add:

```js
  if (podcastStore?.searchPodcasts) {
    const cached = searchCache?.get?.({ query, limit });
    if (cached) return cached;

    const podcasts = podcastStore.searchPodcasts(query, { limit });
    if (podcasts.length) {
      const response = {
        query,
        source: "database",
        podcasts,
        results: resultsFromPodcasts(podcasts)
      };
      searchCache?.set?.({ query, limit }, response);
      return response;
    }
  }
```

Keep curated fallback after the database search and call `upsertResolvedPodcast` when curated fetch succeeds. Delete `SEARCH_PROVIDERS`, `searchPublicProviders`, `fetchSearchHtml`, `extractPodcastIdsFromSearchHtml`, `extractEpisodeIdsFromSearchHtml`, `uniqueMatches`, `searchHtmlVariants`, and `decodePercentEscapes` from `src/xiaoyuzhou.js`, because normal keyword search must not call external providers.

- [ ] **Step 8: Run search tests**

Run:

```bash
node --test src/searchCache.test.js src/xiaoyuzhou.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/searchCache.js src/searchCache.test.js src/xiaoyuzhou.js src/xiaoyuzhou.test.js
git commit -m "Use podcast store for search"
```

---

### Task 3: Admin CRUD HTTP API

**Files:**
- Modify: `src/server.js`
- Create: `src/server.test.js`

- [ ] **Step 1: Write failing server route tests**

Create `src/server.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createRequestHandler } from "./server.js";

function createMemoryStore() {
  const records = new Map();
  return {
    searchPodcasts() {
      return [...records.values()];
    },
    listPodcasts() {
      return [...records.values()];
    },
    getPodcast(id) {
      return records.get(id) ?? null;
    },
    upsertPodcast(podcast) {
      records.set(podcast.id, { ...podcast, aliases: podcast.aliases ?? [] });
      return records.get(podcast.id);
    },
    deletePodcast(id) {
      return records.delete(id);
    }
  };
}

async function withServer(t, options) {
  const server = createServer(createRequestHandler(options));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("admin podcast routes require bearer token", async (t) => {
  const baseUrl = await withServer(t, {
    podcastStore: createMemoryStore(),
    env: { ADMIN_TOKEN: "secret" }
  });

  const response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右" })
  });

  assert.equal(response.status, 401);
});

test("admin podcast routes create, list, get, update, and delete podcasts", async (t) => {
  const baseUrl = await withServer(t, {
    podcastStore: createMemoryStore(),
    env: { ADMIN_TOKEN: "secret" }
  });
  const auth = { authorization: "Bearer secret", "content-type": "application/json" };

  let response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右", aliases: ["忽左"] })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).podcast.title, "忽左忽右");

  response = await fetch(`${baseUrl}/api/admin/podcasts`, { headers: { authorization: "Bearer secret" } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).podcasts.map((podcast) => podcast.id), ["aaaaaaaaaaaaaaaaaaaaaaaa"]);

  response = await fetch(`${baseUrl}/api/admin/podcasts/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ title: "忽左忽右新版", aliases: ["leftright"] })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).podcast.title, "忽左忽右新版");

  response = await fetch(`${baseUrl}/api/admin/podcasts/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: "DELETE",
    headers: { authorization: "Bearer secret" }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
});

test("admin write routes fail closed when ADMIN_TOKEN is not configured", async (t) => {
  const baseUrl = await withServer(t, {
    podcastStore: createMemoryStore(),
    env: {}
  });

  const response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右" })
  });

  assert.equal(response.status, 503);
});
```

- [ ] **Step 2: Run server tests to verify failure**

Run:

```bash
node --test src/server.test.js
```

Expected: FAIL because `createRequestHandler` is not exported.

- [ ] **Step 3: Refactor `src/server.js` and add admin routes**

Modify `src/server.js` so it exports `createRequestHandler`. Keep `server.listen` only for direct CLI startup:

```js
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { publicConfigFromEnv } from "./config.js";
import { createPodcastStore } from "./podcastStore.js";
import { createSearchCache } from "./searchCache.js";
import {
  fetchEpisodeById,
  fetchPodcastById,
  isAllowedAudioUrl,
  searchPodcasts,
  XiaoyuzhouError
} from "./xiaoyuzhou.js";

const PORT = Number(process.env.PORT || 5173);
const ROOT = resolve(process.cwd(), "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function createRequestHandler(options = {}) {
  const podcastStore = options.podcastStore ?? createPodcastStore();
  const searchCache = options.searchCache ?? createSearchCache();
  const env = options.env ?? process.env;

  return async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    try {
      if (url.pathname === "/api/config") {
        return json(response, publicConfigFromEnv(env));
      }

      if (url.pathname === "/api/search") {
        return json(response, await searchPodcasts(url.searchParams.get("q"), { podcastStore, searchCache }));
      }

      const adminResult = await adminRoutes(request, response, url, { podcastStore, searchCache, env });
      if (adminResult) return adminResult;

      const podcastMatch = url.pathname.match(/^\/api\/podcast\/([a-f0-9]{24})$/i);
      if (podcastMatch) {
        const result = await fetchPodcastById(podcastMatch[1]);
        podcastStore.upsertPodcast(result.podcast);
        searchCache.clear();
        return json(response, result);
      }

      const episodeMatch = url.pathname.match(/^\/api\/episode\/([a-f0-9]{24})$/i);
      if (episodeMatch) {
        return json(response, await fetchEpisodeById(episodeMatch[1]));
      }

      if (url.pathname === "/api/media") {
        return proxyMedia(request, response, url.searchParams.get("url"));
      }

      return staticFile(response, url.pathname);
    } catch (error) {
      return json(
        response,
        { error: error.message || "服务器出错了。" },
        error instanceof XiaoyuzhouError ? error.status : 500
      );
    }
  };
}
```

Add these helpers below `staticFile` in `src/server.js`:

```js
async function adminRoutes(request, response, url, context) {
  if (!url.pathname.startsWith("/api/admin/podcasts")) return false;
  const auth = authorizeAdmin(request, context.env);
  if (!auth.ok) {
    return json(response, { error: auth.message }, auth.status);
  }

  const idMatch = url.pathname.match(/^\/api\/admin\/podcasts\/([a-f0-9]{24})$/i);

  if (url.pathname === "/api/admin/podcasts" && request.method === "GET") {
    if (url.searchParams.get("q")) {
      return json(response, {
        podcasts: context.podcastStore.searchPodcasts(url.searchParams.get("q"), {
          limit: url.searchParams.get("limit")
        })
      });
    }
    return json(response, {
      podcasts: context.podcastStore.listPodcasts({
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset")
      })
    });
  }

  if (url.pathname === "/api/admin/podcasts" && request.method === "POST") {
    const payload = await readJson(request);
    const podcast = context.podcastStore.upsertPodcast(payload);
    context.searchCache.clear();
    return json(response, { podcast });
  }

  if (idMatch && request.method === "GET") {
    const podcast = context.podcastStore.getPodcast(idMatch[1]);
    return podcast ? json(response, { podcast }) : json(response, { error: "节目不存在。" }, 404);
  }

  if (idMatch && request.method === "PUT") {
    const existing = context.podcastStore.getPodcast(idMatch[1]);
    if (!existing) return json(response, { error: "节目不存在。" }, 404);
    const payload = await readJson(request);
    const podcast = context.podcastStore.upsertPodcast({ ...existing, ...payload, id: idMatch[1].toLowerCase() });
    context.searchCache.clear();
    return json(response, { podcast });
  }

  if (idMatch && request.method === "DELETE") {
    const deleted = context.podcastStore.deletePodcast(idMatch[1]);
    context.searchCache.clear();
    return json(response, { deleted });
  }

  return json(response, { error: "Not found" }, 404);
}

function authorizeAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return { ok: false, status: 503, message: "ADMIN_TOKEN 未配置，管理接口不可用。" };
  }
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (request.headers.authorization !== expected) {
    return { ok: false, status: 401, message: "缺少或无效的管理令牌。" };
  }
  return { ok: true };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}
```

At the bottom of `src/server.js`, replace direct startup with:

```js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(createRequestHandler());
  server.listen(PORT, () => {
    console.log(`Cosmos Desktop Player listening on http://localhost:${PORT}`);
  });
}
```

- [ ] **Step 4: Run server tests**

Run:

```bash
node --test src/server.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/server.js src/server.test.js
git commit -m "Add admin podcast CRUD API"
```

---

### Task 4: Documentation, Deployment Persistence, and Checks

**Files:**
- Modify: `.gitignore`
- Modify: `deploy/docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `package.json`

- [ ] **Step 1: Write deployment/config updates**

Modify `.gitignore`:

```gitignore
.server.pid
cosmos-desktop-player.tar.gz
data/
```

Modify `deploy/docker-compose.yml` app service:

```yaml
    environment:
      NODE_ENV: production
      PORT: 5173
      PODCAST_DB_PATH: /app/data/podcasts.sqlite
      ADMIN_TOKEN: ""
      PUBLIC_ICP_TEXT: ""
      PUBLIC_ICP_URL: "https://beian.miit.gov.cn/"
      PUBLIC_SECURITY_RECORD_TEXT: ""
      PUBLIC_SECURITY_RECORD_URL: ""
    ports:
      - "127.0.0.1:5173:5173"
    volumes:
      - ../data:/app/data
```

- [ ] **Step 2: Update `package.json` check script**

Change `scripts.check` to include new source files:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test",
    "check": "node --check src/server.js && node --check src/xiaoyuzhou.js && node --check src/config.js && node --check src/podcastStore.js && node --check src/searchCache.js && node --check public/app.js"
  }
}
```

- [ ] **Step 3: Update README**

Add environment variables:

```markdown
- `PODCAST_DB_PATH`：SQLite 节目目录路径，默认 `data/podcasts.sqlite`
- `ADMIN_TOKEN`：管理接口 Bearer token；未配置时管理写接口不可用
```

Add admin API notes:

````markdown
## 节目目录管理 API

管理接口用于维护后端 SQLite 节目目录。请求头必须包含：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

接口：

- `GET /api/admin/podcasts?q=&limit=&offset=`
- `GET /api/admin/podcasts/:id`
- `POST /api/admin/podcasts`
- `PUT /api/admin/podcasts/:id`
- `DELETE /api/admin/podcasts/:id`

`POST` 和 `PUT` 接收公开节目 metadata，例如：

```json
{
  "id": "65487f03374dace9d5b577a4",
  "title": "马刺进步报告",
  "author": "佚名",
  "aliases": ["spurs progress report"]
}
```
````

- [ ] **Step 4: Update architecture docs**

In `docs/architecture.md`, add:

```markdown
### `src/podcastStore.js`

职责：

- 初始化 `data/podcasts.sqlite`
- 维护 `podcasts` 表和 FTS5 索引
- 提供节目 CRUD、upsert 和本地搜索
- 维护中文子串搜索所需的 `searchText` 兜底字段

默认路径为 `data/podcasts.sqlite`，可通过 `PODCAST_DB_PATH` 覆盖。生产部署应持久化 `data/`。
```

Update search boundary:

```markdown
- 关键词搜索默认只查 SQLite 节目目录，不调用外部搜索引擎或小宇宙私有 API。
- 直接粘贴节目链接、单集链接或 24 位 ID 成功后，会把公开节目 metadata 写入本地目录。
```

- [ ] **Step 5: Run docs/config checks**

Run:

```bash
npm run check
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add .gitignore deploy/docker-compose.yml README.md docs/architecture.md package.json
git commit -m "Document podcast database configuration"
```

---

### Task 5: Full Verification

**Files:**
- Verify all touched files

- [ ] **Step 1: Run complete tests**

Run:

```bash
npm test
```

Expected: all tests pass, including store, cache, server, config, landing page, and Xiaoyuzhou parser tests.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
npm run check
```

Expected: exit 0.

- [ ] **Step 3: Run whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 4: Smoke test local server search and admin CRUD**

Start server in one terminal:

```bash
$env:ADMIN_TOKEN='dev-secret'; npm start
```

In another terminal:

```bash
curl -s -H "Authorization: Bearer dev-secret" -H "Content-Type: application/json" `
  -d "{\"id\":\"aaaaaaaaaaaaaaaaaaaaaaaa\",\"title\":\"忽左忽右\",\"author\":\"JustPod\",\"aliases\":[\"忽左\"]}" `
  http://localhost:5173/api/admin/podcasts
curl -s "http://localhost:5173/api/search?q=%E5%BF%BD%E5%B7%A6"
```

Expected: first response contains `"title":"忽左忽右"`; second response has `"source":"database"` and includes podcast ID `aaaaaaaaaaaaaaaaaaaaaaaa`.

- [ ] **Step 5: Commit final fixes if smoke test reveals issues**

If files changed after smoke testing:

```bash
git add <changed-files>
git commit -m "Fix podcast database search smoke issues"
```

If no files changed, do not create an empty commit.
