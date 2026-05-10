# Repository Guidelines

## Project Structure & Module Organization

本项目是小宇宙第三方桌面网页播放器，运行时为 Node.js ESM。核心源码在 `src/`：`server.js` 提供原生 HTTP 服务与 API，`xiaoyuzhou.js` 负责公开页面解析、搜索与音频地址校验，`config.js` 读取公开配置。前端静态资源在 `public/`，包括 `index.html`、`app.js` 和 `styles.css`。测试文件与被测模块同放在 `src/`，命名为 `*.test.js`。部署与运维文件在 `deploy/`，架构和部署说明在 `docs/`。

## Build, Test, and Development Commands

- `npm install`：安装项目依赖；当前项目无第三方运行依赖，但保留标准流程。
- `npm start`：启动本地服务，默认监听 `http://localhost:5173`。
- `npm test`：运行 Node 内置测试框架中的所有 `*.test.js`。
- `npm run check`：对服务端和前端 JavaScript 执行语法检查。
- `docker build -t cosmos-desktop-player .`：构建生产镜像。

## Coding Style & Naming Conventions

使用原生 ESM `import`/`export`，保持 2 空格缩进、双引号和分号。函数与变量使用 `camelCase`，常量可使用全大写，如 `PORT`、`ROOT`。优先使用标准库和现有辅助函数，不引入框架或依赖，除非能明显降低复杂度。API 错误应返回 JSON，并沿用 `XiaoyuzhouError` 的状态码模式。

## Testing Guidelines

测试使用 `node:test` 与 `node:assert/strict`。新增解析、配置、安全限制或搜索兜底逻辑时，添加相邻的 `*.test.js` 用例。网络相关逻辑应 mock `globalThis.fetch`，并在 `t.after()` 中恢复。提交前至少运行 `npm test` 和 `npm run check`。

## Commit & Pull Request Guidelines

现有提交采用简短英文祈使句或动词开头摘要，例如 `Build polished blog landing page`、`Document architecture and deployment norms`。提交标题保持单行、聚焦一个行为。PR 应说明变更目的、验证命令、关联 issue；涉及 UI 或部署变更时，附截图、访问地址或关键 `curl` 验证结果。

## Security & Configuration Tips

不要加入登录态、私有 API 或用户行为采集。`/api/media` 只能代理允许的小宇宙公开音频域名，避免开放代理。公开备案配置通过 `PUBLIC_ICP_TEXT`、`PUBLIC_ICP_URL`、`PUBLIC_SECURITY_RECORD_TEXT` 和 `PUBLIC_SECURITY_RECORD_URL` 注入，不要硬编码敏感信息。

## Agent-Specific Instructions

与本仓库交互时始终使用简体中文回复。修改代码前先阅读相关模块和测试，完成后报告实际运行过的验证命令。
