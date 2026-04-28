#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cosmos-desktop-player}"
REPO_URL="${REPO_URL:-https://github.com/Medesol/cosmos-desktop-player.git}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root or with sudo."
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git nginx

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

docker compose -f "$APP_DIR/deploy/docker-compose.yml" up -d --build

cat <<EOF
App is running behind localhost:5173.

Next:
1. Point your domain A record to this server.
2. Copy deploy/nginx.conf.example to /etc/nginx/conf.d/cosmos-desktop-player.conf.
3. Replace example.com with your ICP-filed domain.
4. Run: nginx -t && systemctl reload nginx
EOF
