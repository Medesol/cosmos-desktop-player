---
name: add-production-podcast
description: "Find a Xiaoyuzhou podcast by name or episode, confirm its 24-character podcast ID, and add it to the PodcastDesk production SQLite catalog. Use when asked to search for a podcast, discover a Xiaoyuzhou blog/podcast ID, seed the production database, or make a new podcast searchable on the deployed site at 175.178.130.174."
---

# Add Production Podcast

## Overview

Add one public Xiaoyuzhou podcast to the production PodcastDesk database. Production admin writes are normally unavailable because `ADMIN_TOKEN` is empty, so use the public `/api/podcast/:id` auto-upsert path after confirming the ID.

## Production Facts

- Production base URL: `http://175.178.130.174`
- Current domain caveat: `podcastdesk.cn` / `www.podcastdesk.cn` may be blocked by ICP/DNSPod WebBlock. Validate with the public IP.
- Admin API: `/api/admin/podcasts` returns `503` unless `ADMIN_TOKEN` is configured. Do not depend on it.
- Auto-upsert API: `GET /api/podcast/:id` fetches Xiaoyuzhou metadata and writes the podcast to SQLite.
- Database search: `GET /api/search?q=<name>` should return `source: "database"` after insertion. `results[].episodes` may be empty; the frontend hydrates episodes by podcast ID.

## Workflow

1. Search the web for the requested program. Prefer queries like:

```text
"节目名" 小宇宙 播客
site:xiaoyuzhoufm.com/podcast 节目名
site:xiaoyuzhoufm.com/episode 节目名
```

2. Confirm the podcast ID before writing. A valid ID is 24 lowercase hex characters from a URL like:

```text
https://www.xiaoyuzhoufm.com/podcast/<podcastId>
https://www.xiaoyuzhoufm.com/episode/<episodeId>
```

If only an episode URL is found, call production `/api/episode/<episodeId>` first and read `podcast.id` from the JSON. This does not write the podcast record.

3. Add the podcast with the bundled script:

```powershell
& ".\.agents\skills\add-production-podcast\scripts\add-production-podcast.ps1" `
  -PodcastId "64bf965274d8c90965c62fff" `
  -ExpectedTitle "二的三次方" `
  -SearchQuery "二的三次方"
```

If starting from an episode ID:

```powershell
& ".\.agents\skills\add-production-podcast\scripts\add-production-podcast.ps1" `
  -EpisodeId "64c7953ee8176c3ff824bb64" `
  -ExpectedTitle "二的三次方"
```

4. Verify the output:

- `inserted.id` equals the confirmed podcast ID.
- `inserted.title` matches the requested podcast.
- `search.source` is `database`.
- `search.containsPodcast` is `true`.

5. Report the confirmed podcast ID, source URL, and production search result to the user.

## Safety Rules

- Do not write a podcast unless the title and ID have been confirmed from Xiaoyuzhou data.
- Do not use the ICP-blocked domain for validation; use `http://175.178.130.174`.
- Do not delete or reset `/opt/cosmos-desktop-player/data/`.
- If search engines disagree, prefer Xiaoyuzhou episode/podcast page data over third-party snippets.
