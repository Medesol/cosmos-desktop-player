# 部署说明

这个应用是一个纯 Node.js 服务，既托管静态前端，也提供 `/api/*` 后端接口，所以不能只用 GitHub Pages 静态托管。

## VPS + Docker

```bash
docker build -t cosmos-desktop-player .
docker run -d --restart unless-stopped --name cosmos-desktop-player -p 5173:5173 cosmos-desktop-player
```

## Nginx 反向代理示例

```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Render/Fly/Railway 等平台

选择 Docker 部署，暴露 `PORT=5173` 即可。平台如果会自动注入 `PORT`，应用也会读取对应环境变量。
