# PodcastDesk

第三方网页端小宇宙播放器。应用在本地或生产服务端运行，提供节目目录搜索、节目详情、最近公开单集列表和基础播放控制。

## 功能

- 搜索本地 SQLite 节目目录中的小宇宙公开节目
- 直接粘贴小宇宙节目链接、单集链接或 24 位 ID
- 成功解析公开节目后自动写入 SQLite 目录
- 选中数据库搜索结果后，通过 `/api/podcast/:id` 补拉最近公开单集
- 播放、暂停、上一集、下一集、前后 15 秒跳转、进度条、音量、倍速和自动连播
- 通过 `/api/media` 代理公开音频，支持浏览器跨域和 Range 请求

## 项目结构

```text
public/                  前端静态页面、样式和播放器逻辑
src/server.js            HTTP 服务、静态资源、公开 API、管理 API、媒体代理
src/xiaoyuzhou.js        小宇宙公开页面解析、节目/单集拉取、搜索编排
src/podcastStore.js      SQLite 节目目录和 FTS5 搜索
src/searchCache.js       关键词搜索短期缓存
src/*.test.js            Node test runner 测试
deploy/                  Docker Compose 和服务器初始化脚本
docs/                    架构和部署设计文档
.agents/skills/          项目级 Codex skills
data/                    运行时 SQLite 数据目录，默认不提交
```

## 本地运行

```bash
npm install
npm start
```

打开：

```text
http://localhost:5173
```

## 测试与检查

```bash
npm test
npm run check
git diff --check
```

`npm test` 使用 Node 内置 test runner。`npm run check` 对服务端模块和 `public/app.js` 做语法检查。

## 数据与搜索

关键词搜索只查 SQLite 节目目录，不再依赖外部搜索 provider。目录默认路径是 `data/podcasts.sqlite`，可用 `PODCAST_DB_PATH` 覆盖。

新节目入库有两种方式：

- 用户直接搜索节目链接、单集链接或 24 位 ID，解析成功后自动 upsert 节目 metadata。
- 维护者使用项目级 skill `$add-production-podcast`，先确认小宇宙 podcast ID，再调用生产 `/api/podcast/:id` 自动入库并验证 `/api/search`。

数据库搜索结果的 `results[].episodes` 可能为空。前端选中节目后会自动请求 `/api/podcast/:id` 补齐最近公开单集。

## API

- `GET /api/config`：返回公开备案配置
- `GET /api/search?q=`：搜索 SQLite 目录，或解析直接链接/ID
- `GET /api/podcast/:id`：拉取公开节目详情和最近单集，并自动 upsert 节目目录
- `GET /api/episode/:id`：拉取公开单集详情
- `GET /api/media?url=`：代理允许的小宇宙公开音频地址
- `GET /api/admin/podcasts?q=&limit=&offset=`
- `GET /api/admin/podcasts/:id`
- `POST /api/admin/podcasts`
- `PUT /api/admin/podcasts/:id`
- `DELETE /api/admin/podcasts/:id`

管理写接口要求：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

生产环境目前 `ADMIN_TOKEN` 可为空；为空时管理写接口返回 `503` 是预期行为。

## 环境变量

- `PORT`：服务监听端口，默认 `5173`
- `PODCAST_DB_PATH`：SQLite 节目目录路径，默认 `data/podcasts.sqlite`
- `ADMIN_TOKEN`：管理接口 Bearer token；未配置时管理接口不可用
- `PUBLIC_ICP_TEXT`：ICP 备案号，可留空
- `PUBLIC_ICP_URL`：ICP 备案链接，默认 `https://beian.miit.gov.cn/`
- `PUBLIC_SECURITY_RECORD_TEXT`：公安联网备案号，可留空
- `PUBLIC_SECURITY_RECORD_URL`：公安联网备案详情链接，可留空

## Docker

```bash
docker build -t cosmos-desktop-player .
docker run -d --name cosmos-desktop-player -p 5173:5173 -v ./data:/app/data cosmos-desktop-player
```

生产环境通过 `deploy/docker-compose.yml` 运行容器，并持久化 `/app/data/podcasts.sqlite`。

## 生产部署

生产站点当前通过公网 IP 验证：

```text
http://175.178.130.174/
```

`podcastdesk.cn` 和 `www.podcastdesk.cn` 可能因 ICP / DNSPod WebBlock 暂时不可用；域名失败但公网 IP 正常时，不应判断为应用部署失败。

使用项目级 skill `$deploy-podcastdesk` 部署：

```powershell
& ".\.agents\skills\deploy-podcastdesk\scripts\deploy-podcastdesk.ps1"
```

部署脚本会在本地运行测试和语法检查，使用 `git archive` 打包当前 `main`，上传到服务器，保留旧版本备份，复制持久化 `data/`，并用 Docker Compose rebuild。脚本最后用公网 IP 验证首页、配置接口和数据库搜索。

## 当前限制

- 只读取小宇宙公开网页暴露的数据，不登录账号，不读取私人订阅、历史记录或 App 内私有内容。
- 节目页只展示小宇宙公开页面直接提供的最近一批单集。
- 关键词搜索依赖已入库的 SQLite 目录；新节目需要先通过直接 ID/链接或 `$add-production-podcast` 入库。
