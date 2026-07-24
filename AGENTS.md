# AGENTS.md

本文件面向在本仓库中工作的 AI coding agents。请先阅读本规则，再修改代码。

## 项目定位

- SmartTools 是部署到 Cloudflare Pages 的单主题个人书签主页。
- 前台入口是 `index.html`，后台管理入口是 `config.html`。
- Cloudflare Pages Functions 位于 `functions/api/`，共享服务端逻辑位于 `functions/_shared/`。
- 浏览器扩展位于 `extensions/open-tabs-importer/`。
- `data.js` 是公开静态兜底数据，不应包含 Private 内容。

## 核心安全边界

- Private 是服务端访问控制，不是加密。不得把 `private: true` 分类或管理员完整数据暴露给匿名响应。
- 匿名 `/api/data` 和 `/api/data?format=json` 必须过滤 Private 分类。
- 管理员响应必须使用 private/no-store 语义，匿名公开响应可以使用公共缓存，但不得被管理员数据污染。
- 不要恢复或新增 AES/PBKDF2 旧密文分类兼容逻辑；旧加密段应继续被丢弃。
- 不要把 `ADMIN_PASS`、`AUTH_SECRET`、KV 明文备份、Cookie token 或真实 Private 数据写入仓库、日志、测试快照或公开资源。
- Cookie/session 相关变更必须保持 HttpOnly、Secure、SameSite=Strict 和 HMAC 校验语义。

## 修改原则

- 保持“单主题”架构：不要重新引入主题路由、主题切换器或 `index1`～`index5` 页面。
- 保持单管理员模型：不要新增多用户、公开 slug、inbox、push、P2P、迁移 v2、改密码等已废弃功能入口。
- 优先复用现有共享模块；服务端通用逻辑放在 `functions/_shared/`，前端通用逻辑放在 `shared/`。
- 保持 ES module 风格，避免引入构建链之外的新框架或运行时。
- 只修改与任务相关的文件；不要提交 `dist/`、`.wrangler/`、`artifacts/`、`node_modules/` 中的生成物，除非任务明确要求。
- 如需变更公开发布内容，检查 `scripts/prepare-deploy.mjs` 的公开文件白名单是否仍准确。

## 数据与 API 约定

- KV 绑定名为 `FAV_KV`；数据源在 `static` 与 `kv` 之间切换。
- 主要 API：
  - `POST /api/login`、`POST /api/logout`
  - `GET /api/check`
  - `GET /api/data`、`GET /api/data-meta`
  - `POST /api/save`
  - `POST /api/comment`
  - `GET/POST /api/source`
  - `GET/POST /api/site-config`
  - `GET/POST/DELETE /api/backups`
  - `POST /api/fetch-page-title`
- 未知 `/api/*` 路由应返回 JSON 404。
- 新增或调整 API 时，同步更新 README/README_CN 与验收脚本。

## 构建与部署

- 构建命令：`npm run build`。
- 本仓库中用户提到“部署”“上线”“发布”“Pages 项目”等相关词语时，默认指 Cloudflare Pages 项目 `smarttools`，除非用户明确指定其他项目。
- 部署命令：`npm run deploy`，等价于部署 `dist/` 到 Cloudflare Pages 项目 `smarttools`。
- 构建输出目录：`dist/`。
- `scripts/prepare-deploy.mjs` 会复制白名单公开文件、内联首页运行时代码、可选内联线上公开数据快照，并给 shared 资源加指纹。
- 如需禁用构建时线上快照，可使用 `SMARTTOOLS_INLINE_SNAPSHOT=0 npm run build`。

## 验收检查

修改后按影响范围运行：

- 基础构建：`npm run build`
- 构建验收：`npm run test:build`
- API 验收：先用 wrangler 启动本地 Pages，再运行 `npm run test:api`
- 浏览器验收：`npm run test:browser`
- 完整本地验收：`npm test`
- 在线验收/性能验收只在任务明确涉及线上环境或性能时运行：`npm run test:online`、`npm run test:performance`

本地 Pages 示例：

```bash
npm run build

npx wrangler@latest pages dev dist \
  --kv FAV_KV \
  --binding ADMIN_USER=testadmin \
  --binding ADMIN_PASS=TestPass2026 \
  --binding AUTH_SECRET=0123456789abcdef0123456789abcdef \
  --compatibility-date 2026-07-16 \
  --port 8788
```

## 前端注意事项

- 首页默认通过 `/api/data` 获取带站点配置和查看者信息的 JavaScript 响应。
- 不要让首页重新阻塞加载旧的 `shared/data-loader.js`。
- 保持移动端和桌面端的 Notion 风格体验，避免破坏卡片、子卡片、注释弹窗、导入导出和 Private 标识。
- 大文件 `index.html`、`config.html` 修改前先定位相关 DOM、脚本和样式片段，避免全文件重写。

## 浏览器扩展

- 扩展必须继续位于 `extensions/open-tabs-importer/`，并保留 `manifest.json`、`popup.*`、`background.js`、`pending-import.js` 和图标资源。
- 权限变化需同步检查 `PERMISSION_JUSTIFICATION.md`、`REVIEWER_NOTES.txt`、隐私政策和商店描述。
- 不要增加与“导入当前打开标签页到后台确认流程”无关的高风险权限。

## 文档同步

- 用户可见功能、部署变量、API、Private 安全边界或项目结构变化时，同步更新 `README.md` 与 `README_CN.md`。
- 安全相关说明优先使用清楚、保守的表述，不要暗示 Private 数据已加密。

## 工作流建议

- 开始前用 `rg` 快速查找相关符号、API 路由或 UI 文案。
- 修改安全、缓存、数据过滤、构建白名单或扩展权限时，优先补充或更新验收覆盖。
- 完成后报告已运行的检查；若未运行某项检查，说明原因。
