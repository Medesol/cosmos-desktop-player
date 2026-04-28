#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cosmos-desktop-player}"
REPO_URL="${REPO_URL:-https://github.com/Medesol/cosmos-desktop-player.git}"
SERVER_NAME="${SERVER_NAME:-_}"

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

rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/conf.d/cosmos-desktop-player.conf <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name ${SERVER_NAME};

  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 120s;
  }
}
EOF

nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

cat <<EOF
App is running at http://<server-public-ip>/.

Next:
1. Open http://your-server-public-ip/ to verify the app.
2. After ICP filing, point your domain A record to this server.
3. Re-run this script with SERVER_NAME=your-domain.com or edit /etc/nginx/conf.d/cosmos-desktop-player.conf.
EOF
