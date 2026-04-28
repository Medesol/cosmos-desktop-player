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

## 腾讯云/阿里云

面向中国大陆用户，优先选择腾讯云轻量应用服务器或阿里云 ECS。详见：

```text
docs/mainland-deploy.md
```
