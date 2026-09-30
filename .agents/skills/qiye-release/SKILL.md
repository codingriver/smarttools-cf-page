---
name: qiye-release
description: 构建并本地验收栖页的 Cloudflare Pages v2 API；仅在用户明确要求时部署到 qiye。
---

# Pages v2 API 发布

在仓库根目录查看工作区状态与 package.json，不回退用户修改。唯一静态产物为 `dist/_routes.json`（全站 Functions 边界）；Pages Functions 来自 `functions/`。扩展目录是独立安装的客户端，**不发布到 Pages**。构建不访问网络、不抓取快照或下载图标。

## 本地准备

1. `npm run build`，脚本仅允许干净的 `dist` 或 `.wrangler` 下输出。
2. `npm run verify:deploy`：仅校验干净 `dist/` 和全站路由，不能代替逐条 API 验收。
3. `npm run test:build && npm run test:api && npm run test:extension`，或 `npm test`（验收脚本及合成 fixture 位于 `tests/`）。所有数据使用合成或隔离本地 KV；不要指向生产进行写入测试。
4. `git diff --check`；查看 `dist/` 不含网站、扩展、书签或密钥。不得擅自清理线上历史 KV 键。

## 仅明确部署请求

确认 `qiye` Pages 项目生产分支是 `main`、账户和 KV 绑定匹配；检查运行环境 `USER`/`PASSWORD`（尤其 PASSWORD 不得无意使用公开默认值）、`AUTH_SECRET`、`FAV_KV`，不打印密钥。随后运行 `npm run deploy`（构建、verify、wrangler pages deploy）。目标不明确或凭据缺失时停下并报告；不自行创建项目、绑定或迁移 KV。部署后仅做匿名、只读验证，不在未授权下用线上管理员凭据测试。保留旧站点已有浏览器副本不能通过删除 Pages 源码远程保证清除。

命名调整只修改本地配置，不代表远端项目已创建或归当前账户所有；不得将默认 origin 当作已部署服务。仓库目录、Git 远端与线上资源改名需要单独操作和确认。
