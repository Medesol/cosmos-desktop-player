---
name: deploy-podcastdesk
description: "Deploy PodcastDesk/cosmos-desktop-player from this repository to the current Ubuntu Docker server. Use when asked to publish, update, redeploy, verify, or roll back the production PodcastDesk site at 175.178.130.174, especially when using local git archive upload rather than server-side git pull. Includes the ICP/DNSPod domain-block caveat: validate by public IP for now, not podcastdesk.cn."
---

# Deploy PodcastDesk

## Overview

Deploy the latest local `main` build of PodcastDesk to the production Ubuntu server using a tarball upload and Docker Compose rebuild. The server currently does not have a git checkout at `/opt/cosmos-desktop-player`; do not assume `git pull` works there.

## Known Production Facts

- Local repo: `C:\Users\lxx20\Documents\podcast-desktop`
- Server: `ubuntu@175.178.130.174`
- SSH key: `C:\Users\lxx20\.ssh\cosmos_desktop_player`
- App dir: `/opt/cosmos-desktop-player`
- Container: `cosmos-desktop-player`
- Compose file: `/opt/cosmos-desktop-player/deploy/docker-compose.yml`
- Persistent DB path: `/opt/cosmos-desktop-player/data/podcasts.sqlite`
- Current access URL: `http://175.178.130.174/`
- Domain caveat: `podcastdesk.cn` and `www.podcastdesk.cn` may return DNSPod WebBlock/302 because ICP filing is not complete. Treat this as a domain/filing issue, not an app deployment failure. Validate with the public IP.

## Preferred Workflow

1. Confirm local `main` is clean and up to date.
2. Run tests before deployment:

```powershell
npm test
npm run check
git diff --check
```

3. Deploy with the bundled project script:

```powershell
& ".\.agents\skills\deploy-podcastdesk\scripts\deploy-podcastdesk.ps1"
```

4. Verify with public IP:

```powershell
curl.exe -I http://175.178.130.174/
curl.exe -i http://175.178.130.174/api/config
curl.exe "http://175.178.130.174/api/search?q=%E9%A9%AC%E5%88%BA%E8%BF%9B%E6%AD%A5%E6%8A%A5%E5%91%8A"
```

5. Check server state:

```powershell
ssh -i "$HOME\.ssh\cosmos_desktop_player" -o IdentitiesOnly=yes ubuntu@175.178.130.174 "sudo docker ps --filter name=cosmos-desktop-player && sudo docker logs --tail 80 cosmos-desktop-player"
```

## Deployment Mechanics

The deployment uses this sequence:

- `git archive --format=tar.gz HEAD` locally.
- `scp` the archive to `/tmp/cosmos-desktop-player.tar.gz`.
- On the server, unpack to `/opt/cosmos-desktop-player.release-<timestamp>`.
- Copy existing `/opt/cosmos-desktop-player/data/` into the new release if present.
- Move the old app dir to `/opt/cosmos-desktop-player.backup-<timestamp>`.
- Move the new release into `/opt/cosmos-desktop-player`.
- Run `sudo docker compose -f /opt/cosmos-desktop-player/deploy/docker-compose.yml up -d --build`.

This preserves SQLite data across deploys and keeps a rollback directory.

## Rollback

If the new release is bad, SSH to the server and restore the latest backup:

```bash
sudo docker compose -f /opt/cosmos-desktop-player/deploy/docker-compose.yml down
sudo mv /opt/cosmos-desktop-player /opt/cosmos-desktop-player.failed-$(date +%Y%m%d%H%M%S)
sudo mv /opt/cosmos-desktop-player.backup-YYYYMMDDHHMMSS /opt/cosmos-desktop-player
sudo docker compose -f /opt/cosmos-desktop-player/deploy/docker-compose.yml up -d --build
```

Use the concrete backup path printed by the deploy script.

## Important Checks

- `ADMIN_TOKEN` may intentionally be empty in production. In that state, `POST /api/admin/podcasts` returning `503` is expected.
- `source: "database"` from `/api/search?q=马刺进步报告` confirms SQLite search is working after the first catalog seed.
- If `podcastdesk.cn` fails but `http://175.178.130.174/` works, do not redeploy just for the domain failure. Verify DNS/ICP/DNSPod status separately.
- Do not delete `/opt/cosmos-desktop-player/data/` unless the user explicitly asks to reset the podcast database.
