# 中国大陆部署方案

这个项目需要一个能运行 Node.js 后端的 Web Service。因为前端依赖 `/api/*` 搜索和音频代理，不能只部署到静态托管。

## 推荐路线

首选：腾讯云轻量应用服务器 Lighthouse，创建实例时选择 Docker CE 应用模板。

原因：

- 购买和初始化比标准 CVM 更轻，适合小型 Web 服务。
- Docker CE 应用模板会预装 Docker，并默认配置腾讯云 Docker 镜像源，部署路径短。
- 域名、DNS、备案、服务器在同一个云厂商里管理，后续操作少。
- 中国大陆用户访问延迟低于海外 PaaS。

备选：阿里云 ECS。

如果你已经有阿里云账号、域名或备案主体，选阿里云会更顺。ECS 更通用，但初始化 Docker/Nginx 的步骤会比轻量应用服务器多一点。

## 推荐规格

初版服务可以从低规格开始：

- 地域：上海、杭州、广州、北京任选，优先靠近目标用户。
- 系统：Ubuntu 22.04 LTS 或 24.04 LTS。
- CPU/内存：2 vCPU / 2 GB 起步。
- 带宽：按固定带宽 3-5 Mbps 起步，后续按访问量调整。
- 防火墙：开放 80、443；临时验收可开放 5173。

注意：这个应用会代理小宇宙公开音频。公开服务访问量上来后，带宽消耗会主要来自音频流量。

## 域名和备案

中国大陆服务器绑定域名提供公开网站服务，通常需要完成 ICP 备案。建议：

1. 在同一云厂商购买或接入域名。
2. 先用服务器公网 IP 验收应用。
3. 提交 ICP 备案，备案通过后再把域名 A 记录解析到服务器。
4. 域名可访问后配置 HTTPS。
5. 根据当地要求完成公安联网备案。

备案号拿到后，在服务器的 `deploy/docker-compose.yml` 中配置：

```yaml
PUBLIC_ICP_TEXT: "你的 ICP 备案号"
PUBLIC_ICP_URL: "https://beian.miit.gov.cn/"
PUBLIC_SECURITY_RECORD_TEXT: "你的公安备案号"
PUBLIC_SECURITY_RECORD_URL: "公安联网备案详情页"
```

## 部署步骤

服务器准备好后，用 SSH 登录服务器，执行：

```bash
sudo -i
APP_DIR=/opt/cosmos-desktop-player \
REPO_URL=https://github.com/Medesol/cosmos-desktop-player.git \
bash <(curl -fsSL https://raw.githubusercontent.com/Medesol/cosmos-desktop-player/main/deploy/bootstrap-ubuntu-docker.sh)
```

如果使用腾讯云 Docker CE 应用模板，Docker 已预装；脚本会跳过 Docker 安装，仅安装/确认 Git 和 Nginx。脚本会自动配置 Nginx，让服务器公网 IP 的 80 端口直接反代到应用。

域名备案并解析完成后，可以用域名重新配置：

```bash
sudo -i
SERVER_NAME=example.com \
APP_DIR=/opt/cosmos-desktop-player \
REPO_URL=https://github.com/Medesol/cosmos-desktop-player.git \
bash <(curl -fsSL https://raw.githubusercontent.com/Medesol/cosmos-desktop-player/main/deploy/bootstrap-ubuntu-docker.sh)
```

如果服务器访问 GitHub 不稳定，可以改用本地打包上传：

```bash
git archive --format=tar.gz -o cosmos-desktop-player.tar.gz main
scp cosmos-desktop-player.tar.gz root@服务器IP:/opt/
```

然后在服务器上解压并运行：

```bash
mkdir -p /opt/cosmos-desktop-player
tar -xzf /opt/cosmos-desktop-player.tar.gz -C /opt/cosmos-desktop-player
cd /opt/cosmos-desktop-player
docker compose -f deploy/docker-compose.yml up -d --build
```

## Nginx 反向代理

复制模板：

```bash
cp /opt/cosmos-desktop-player/deploy/nginx.conf.example /etc/nginx/conf.d/cosmos-desktop-player.conf
```

把 `example.com` 改成你的已备案域名，然后：

```bash
nginx -t
systemctl reload nginx
```

## HTTPS

域名备案和解析完成后，可以用云厂商免费证书、腾讯云/阿里云证书服务，或在服务器上使用 ACME 客户端签发证书。

## 更新应用

```bash
cd /opt/cosmos-desktop-player
git pull --ff-only
docker compose -f deploy/docker-compose.yml up -d --build
```
