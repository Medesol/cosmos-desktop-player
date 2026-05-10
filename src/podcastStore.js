import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PODCAST_ID_PATTERN = /^[0-9a-f]{24}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function normalizeSearchText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

export function normalizePodcastForStorage(podcast, timestamp = new Date().toISOString()) {
  const id = String(podcast?.id ?? "").trim().toLowerCase();
  if (!PODCAST_ID_PATTERN.test(id)) {
    throw new Error("节目 ID 必须是 24 位十六进制字符串");
  }

  const title = normalizeTextField(podcast.title).trim();
  if (!title) {
    throw new Error("节目标题不能为空");
  }

  const aliases = normalizeAliases(podcast.aliases);
  const author = normalizeTextField(podcast.author);
  const brief = normalizeTextField(podcast.brief);
  const description = normalizeTextField(podcast.description);
  const coverUrl = normalizeTextField(podcast.coverUrl);
  const latestEpisodePubDate = normalizeTextField(podcast.latestEpisodePubDate);
  const sourceUrl = normalizeTextField(podcast.sourceUrl) || `https://www.xiaoyuzhoufm.com/podcast/${id}`;
  const searchText = normalizeSearchText([title, author, brief, description, ...aliases].join(" "));

  return {
    id,
    title,
    author,
    brief,
    description,
    coverUrl,
    subscriptionCount: normalizeCount(podcast.subscriptionCount),
    episodeCount: normalizeCount(podcast.episodeCount),
    latestEpisodePubDate,
    sourceUrl,
    aliases,
    searchText,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function createPodcastStore(options = {}) {
  const dbPath = options.dbPath ?? process.env.PODCAST_DB_PATH ?? "data/podcasts.sqlite";
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }

  const memoryDb = dbPath === ":memory:" ? openDatabase(dbPath) : null;
  const useDb = (callback) => memoryDb ? callback(memoryDb) : withDb(dbPath, callback);
  useDb((db) => createSchema(db));

  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  return {
    upsertPodcast(podcast) {
      const normalized = normalizePodcastForStorage(podcast, now());
      return useDb((db) => {
        const existing = getPodcastRow(db, normalized.id);
        const stored = {
          ...normalized,
          createdAt: existing?.createdAt ?? normalized.createdAt
        };

        db.exec("BEGIN");
        try {
          db.prepare(`
            INSERT INTO podcasts (
              id, title, author, brief, description, coverUrl, subscriptionCount,
              episodeCount, latestEpisodePubDate, sourceUrl, aliases, searchText,
              createdAt, updatedAt
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
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
            stored.id,
            stored.title,
            stored.author,
            stored.brief,
            stored.description,
            stored.coverUrl,
            stored.subscriptionCount,
            stored.episodeCount,
            stored.latestEpisodePubDate,
            stored.sourceUrl,
            JSON.stringify(stored.aliases),
            stored.searchText,
            stored.createdAt,
            stored.updatedAt
          );
          refreshFtsRow(db, stored);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }

        return rowToPodcast(getPodcastRow(db, stored.id));
      });
    },

    getPodcast(id) {
      const normalizedId = normalizePodcastId(id);
      if (!normalizedId) {
        return null;
      }
      return useDb((db) => rowToPodcast(getPodcastRow(db, normalizedId)));
    },

    listPodcasts({ limit = DEFAULT_LIMIT, offset = 0 } = {}) {
      return useDb((db) => db.prepare(`
          SELECT * FROM podcasts
          ORDER BY updatedAt DESC, title ASC
          LIMIT ? OFFSET ?
        `).all(clampLimit(limit), clampOffset(offset)).map(rowToPodcast));
    },

    searchPodcasts(query, { limit = DEFAULT_LIMIT } = {}) {
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery) {
        return [];
      }

      const maxResults = clampLimit(limit);
      const results = [];
      const seen = new Set();
      const ftsQuery = buildFtsQuery(query);

      return useDb((db) => {
        if (ftsQuery) {
          try {
            const rows = db.prepare(`
              SELECT p.*
              FROM podcast_fts f
              JOIN podcasts p ON p.id = f.id
              WHERE podcast_fts MATCH ?
              ORDER BY rank, p.updatedAt DESC, p.title ASC
              LIMIT ?
            `).all(ftsQuery, maxResults);
            appendRows(results, seen, rows, maxResults);
          } catch {
            // Invalid MATCH syntax should not prevent the LIKE fallback.
          }
        }

        if (results.length < maxResults) {
          const rows = db.prepare(`
            SELECT * FROM podcasts
            WHERE searchText LIKE ? ESCAPE '\\'
            ORDER BY updatedAt DESC, title ASC
            LIMIT ?
          `).all(`%${escapeLike(normalizedQuery)}%`, maxResults);
          appendRows(results, seen, rows, maxResults);
        }

        return results;
      });
    },

    deletePodcast(id) {
      const normalizedId = normalizePodcastId(id);
      if (!normalizedId) {
        return false;
      }

      return useDb((db) => {
        db.exec("BEGIN");
        try {
          db.prepare("DELETE FROM podcast_fts WHERE id = ?").run(normalizedId);
          const result = db.prepare("DELETE FROM podcasts WHERE id = ?").run(normalizedId);
          db.exec("COMMIT");
          return result.changes > 0;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
    },

    close() {
      memoryDb?.close();
    }
  };
}

function withDb(dbPath, callback) {
  const db = openDatabase(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  return db;
}

function createSchema(db) {
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
      sourceUrl TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      searchText TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS podcasts_updatedAt_idx
      ON podcasts(updatedAt DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS podcast_fts
      USING fts5(
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

function refreshFtsRow(db, podcast) {
  db.prepare("DELETE FROM podcast_fts WHERE id = ?").run(podcast.id);
  db.prepare(`
    INSERT INTO podcast_fts (id, title, author, brief, description, aliases)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    podcast.id,
    podcast.title,
    podcast.author,
    podcast.brief,
    podcast.description,
    podcast.aliases.join(" ")
  );
}

function getPodcastRow(db, id) {
  return db.prepare("SELECT * FROM podcasts WHERE id = ?").get(id);
}

function rowToPodcast(row) {
  if (!row) {
    return null;
  }

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
    searchText: row.searchText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function appendRows(results, seen, rows, maxResults) {
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    results.push(rowToPodcast(row));
    if (results.length >= maxResults) {
      break;
    }
  }
}

function buildFtsQuery(query) {
  const terms = String(query ?? "").toLowerCase().trim().split(/\s+/).filter((term) => /^[\p{Letter}\p{Number}_-]+$/u.test(term));
  return terms.length > 0 ? terms.join(" AND ") : "";
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function normalizePodcastId(id) {
  const normalized = String(id ?? "").trim().toLowerCase();
  return PODCAST_ID_PATTERN.test(normalized) ? normalized : "";
}

function normalizeTextField(value) {
  return String(value ?? "");
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((alias) => String(alias ?? "").trim()).filter(Boolean);
}

function normalizeCount(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseAliases(value) {
  try {
    const aliases = JSON.parse(value);
    return Array.isArray(aliases) ? aliases.map((alias) => String(alias)) : [];
  } catch {
    return [];
  }
}

function clampLimit(value) {
  const limit = Number.isInteger(value) ? value : DEFAULT_LIMIT;
  return Math.min(Math.max(limit, 1), MAX_LIMIT);
}

function clampOffset(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}
