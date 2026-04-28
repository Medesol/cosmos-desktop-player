# 小宇宙桌面播放器

一个第三方网页端小宇宙播放器原型，目标是补齐电脑浏览器端的基础播客体验：搜索节目、浏览单集、播放控制、音量、倍速、上一集/下一集和自动连播。

## 功能

- 搜索小宇宙公开节目，或直接粘贴小宇宙节目/单集链接
- 展示节目资料和最近公开单集
- 播放、暂停、上一集、下一集、前后 15 秒跳转
- 进度条拖动、音量控制、倍速控制、自动连播
- 本地服务端代理公开音频，处理浏览器跨域和 Range 请求

## 数据来源

应用只读取小宇宙公开网页中已经暴露的节目、单集和公开音频地址，不登录账号，不读取私人订阅、历史记录或用户数据。

关键词搜索通过公开搜索结果发现小宇宙节目页；粘贴节目链接或单集链接会直接解析对应页面。

## 本地运行

```bash
npm install
npm start
```

打开：

```text
http://localhost:5173
```

## 测试

```bash
npm test
npm run check
```

## Docker 部署

```bash
docker build -t cosmos-desktop-player .
docker run -d --name cosmos-desktop-player -p 5173:5173 cosmos-desktop-player
```

然后访问：

```text
http://服务器IP:5173
```

生产环境建议放在 Nginx/Caddy 后面，并配置 HTTPS。

## 中国大陆部署

面向中国大陆用户，推荐部署到腾讯云轻量应用服务器或阿里云 ECS，并使用 Docker + Nginx。详见：

```text
docs/mainland-deploy.md
```

## 环境变量

- `PORT`：服务监听端口，默认 `5173`
- `PUBLIC_ICP_TEXT`：ICP 备案号，可留空
- `PUBLIC_ICP_URL`：ICP 备案链接，默认 `https://beian.miit.gov.cn/`
- `PUBLIC_SECURITY_RECORD_TEXT`：公安联网备案号，可留空
- `PUBLIC_SECURITY_RECORD_URL`：公安联网备案详情链接，可留空

## 当前限制

- 节目页目前只展示小宇宙公开网页直接提供的最近一批单集。
- 关键词搜索依赖公开搜索结果，若搜索引擎结果变化，建议直接粘贴小宇宙节目链接。
- 不支持登录、小宇宙评论、订阅同步或 App 内私有内容。
