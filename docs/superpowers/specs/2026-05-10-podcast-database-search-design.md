# Podcast Database Search Design

## Purpose

PodcastDesk will stop relying on public search engines or unofficial live app APIs for keyword search. The backend will maintain its own SQLite podcast directory. Website search will query this local directory, while direct Xiaoyuzhou podcast links, episode links, and 24-character IDs remain supported.

## Goals

- Store public podcast metadata in a persistent SQLite database.
- Provide backend CRUD APIs for maintaining podcast records.
- Protect write APIs with an admin bearer token from server environment configuration.
- Search the local database by title, aliases, author, brief, and description.
- Automatically upsert a podcast when direct ID/link lookup succeeds.
- Keep episode lists out of the database for the first version; continue resolving episodes from public Xiaoyuzhou pages.
- Add short-lived backend search-result caching to reduce repeated database work while allowing new records to appear soon after import.

## Non-Goals

- No external search providers.
- No Xiaoyuzhou login, app token, or private API integration.
- No user account data, subscriptions, history, comments, or private media.
- No admin web UI in the first version.
- No local browser automation for database population in this implementation phase; treat automation as a separate future feature.

## Architecture

Add a new storage module, `src/podcastStore.js`, responsible for SQLite setup, migrations, CRUD, upsert, and search. `src/xiaoyuzhou.js` should keep Xiaoyuzhou page parsing and direct fetch behavior. `src/server.js` will wire HTTP endpoints to the store and keep auth checks close to admin routes.

Default database path should be `data/podcasts.sqlite`, configurable via `PODCAST_DB_PATH`. The `data/` directory should be ignored by git and created at runtime if missing. Docker deployment should mount or preserve this path so the catalog survives container rebuilds.

## Data Model

Initial table: `podcasts`.

Fields:

- `id` text primary key
- `title` text not null
- `author` text
- `brief` text
- `description` text
- `coverUrl` text
- `subscriptionCount` integer
- `episodeCount` integer
- `latestEpisodePubDate` text
- `sourceUrl` text
- `aliases` text containing JSON array
- `searchText` text normalized for fallback matching
- `createdAt` text ISO timestamp
- `updatedAt` text ISO timestamp

Search indexing should use SQLite FTS5 when available. Because Chinese tokenizer quality may vary by SQLite build, maintain `searchText` and a `LIKE` fallback regardless of FTS availability.

## Public Search Flow

`GET /api/search?q=...` should:

1. Sanitize and normalize the query.
2. If it is a podcast link, episode link, or bare 24-character ID, use existing direct resolution.
3. When direct resolution returns a podcast, upsert that podcast into SQLite.
4. For normal keywords, search SQLite only.
5. If no database result is found, use the existing curated fallback.
6. Return the current response shape: `query`, `source`, `podcasts`, and `results`.

For database search results, `results` can contain podcast metadata with an empty `episodes` array until the user selects a podcast and the backend fetches current episodes from the public podcast page.

## Admin CRUD API

Initial admin routes:

- `GET /api/admin/podcasts?q=&limit=&offset=`
- `GET /api/admin/podcasts/:id`
- `POST /api/admin/podcasts`
- `PUT /api/admin/podcasts/:id`
- `DELETE /api/admin/podcasts/:id`

All admin routes require `Authorization: Bearer <ADMIN_TOKEN>`. If `ADMIN_TOKEN` is unset, write routes should reject requests with a clear server configuration error instead of allowing anonymous writes.

`POST` and `PUT` should validate podcast IDs and normalize aliases. `POST` should upsert by ID to support import tools that rerun safely.

## Search Cache

Use an in-process cache for keyword searches:

- Key: normalized query plus limit.
- Value: complete search response.
- TTL: 60 seconds.
- Invalidation: clear the cache after any admin create, update, delete, or direct lookup upsert.

This cache intentionally does not persist. It reduces repeated searches while ensuring new records appear quickly.

## Error Handling

- Invalid query: HTTP 400 with the existing user-facing message style.
- Missing admin token on protected routes: HTTP 401.
- Server missing `ADMIN_TOKEN` for write routes: HTTP 503 with an explicit configuration message.
- Invalid podcast payload: HTTP 400 with field-specific messages where practical.
- SQLite errors: HTTP 500, avoiding leakage of filesystem details.

## Testing

Add focused `node:test` coverage for:

- Database initialization and migration.
- Podcast create, update, delete, get, and list.
- Search by title, alias, author, and Chinese substring fallback.
- Direct link/ID lookup upserts a found podcast.
- Search cache returns cached results and clears after CRUD/upsert.
- Admin auth accepts correct bearer token and rejects missing or wrong tokens.

## Rollout

Implement behind the existing `/api/search` endpoint so the frontend needs minimal change. Keep current direct Xiaoyuzhou page parsing as the source of truth for fresh episode lists. Document `PODCAST_DB_PATH`, `ADMIN_TOKEN`, and deployment persistence requirements in README and architecture docs.
