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
- 公开数据安全边界同样适用于构建时抓取并内联到首页的快照；不得将管理员视图、Private 内容或标记为 private/no-store 的响应作为公开快照。不得为性能或离线需求把管理员完整数据写入 localStorage、Service Worker Cache Storage 等长期缓存。
- 扩展本机缓存例外（用户明确选择）：`extensions/open-tabs-importer/` 可在扩展自身来源的 IndexedDB 按站点长期保存完整管理员书签（含 Private），并在退出、会话失效、离线或权限撤销后只读展示。缓存不宣称加密，必须提供单独清除入口，不存凭据，不向内容脚本或普通网页提供缓存接口；云端写入仍由服务器鉴权与版本校验。此例外不适用于网站 localStorage、HTTP/SW 缓存、静态数据或公开构建快照。
- 不要恢复或新增 AES/PBKDF2 旧密文分类兼容逻辑；旧加密段应继续被丢弃。
- 不要把 `ADMIN_PASS`、`AUTH_SECRET`、KV 明文备份、Cookie token 或真实 Private 数据写入仓库、日志、测试快照或公开资源。
- Cookie/session 相关变更必须保持 HttpOnly、Secure、SameSite=Strict 和 HMAC 校验语义。

## 修改原则

- 保持“单主题”架构：不要重新引入主题路由、主题切换器或 `index1`～`index5` 页面。
- 保持单管理员模型：不要新增或恢复多用户、公开 slug、inbox、push、P2P、迁移 v2 等已废弃功能入口；旧 `/api/change-password` 继续保持移除，不恢复其入口或兼容路由。
- 现有 `/api/account/*` 账户安全模块（改密、注销全部设备、临时一次性恢复）属于当前已实现和已文档化的维护范围，不因旧改密入口废弃而删除，也不据此扩展为多用户或新增恢复方式。功能范围调整须由独立任务明确要求。
- 优先复用现有共享模块；服务端通用逻辑放在 `functions/_shared/`，前端通用逻辑放在 `shared/`。
- 保持 ES module 风格，避免引入构建链之外的新框架或运行时。
- 只修改与任务相关的文件；不要提交 `dist/`、`.wrangler/`、`artifacts/`、`node_modules/` 中的生成物，除非任务明确要求。
- 如需变更公开发布内容，检查 `scripts/prepare-deploy.mjs` 的公开文件白名单是否仍准确。

## 数据与 API 约定

- KV 绑定名为 `FAV_KV`；数据源在 `static` 与 `kv` 之间切换。
- 主要 API：
  - `POST /api/login`、`POST /api/logout`
  - `GET/POST /api/account/security`：管理员查询密码来源或注销全部设备
  - `POST /api/account/change-password`：管理员验证当前密码后改密
  - `GET/POST /api/account/recovery`：GET 查询恢复是否启用；POST 仅在临时恢复开启且一次性令牌有效时重设密码
  - `GET /api/check`
  - `GET /api/data`、`GET /api/data-meta`
  - `POST /api/save`
  - `POST /api/comment`
  - `GET/POST /api/source`
  - `GET/POST /api/site-config`
  - `GET/POST/DELETE /api/backups`
  - `POST /api/fetch-page-title`
- 未知 `/api/*` 路由应返回 JSON 404；旧 `/api/change-password` 继续按已移除路由验收，不与现有 `/api/account/change-password` 混淆。
- 新增或调整 API 时，同步更新 README/README_CN 与验收脚本。

## 构建与部署

- 构建命令：`npm run build`。
- 本仓库中用户提到“部署”“上线”“发布”“Pages 项目”等相关词语时，默认指 Cloudflare Pages 项目 `smarttools`，除非用户明确指定其他项目。
- 部署命令：`npm run deploy`，依次重新构建、执行 `npm run verify:deploy`，再将 `dist/` 和 Pages Functions 发布到现有 Cloudflare Pages 项目 `smarttools`；脚本指定分支为 `main`，发布前核实其为目标项目生产分支。
- 构建输出目录：`dist/`。
- `scripts/prepare-deploy.mjs` 会复制白名单公开文件、内联首页运行时代码、可选内联线上公开数据快照，并给 shared 资源加指纹。
- 如需禁用构建时线上快照，可使用 `SMARTTOOLS_INLINE_SNAPSHOT=0 npm run build`。
- 构建、发布准备或实际部署任务，读取项目 Skill [smarttools-release](.agents/skills/smarttools-release/SKILL.md)，按其中对应模式执行；普通业务修改无需无条件加载。
- 只有用户明确要求实际部署才可上传。询问、构建、准备发布、修改规则或 Skill 均不构成部署授权。
- 默认发布是更新已有 Pages 项目，不自动创建 Pages、独立 Worker、KV 或修改 secrets、绑定、域名。账户/目标缺失或不明确时停止并报告。
- 本地构建可禁用快照，但生产发布必须通过 `verify:deploy`，使用已确认的匿名公开快照和干净 `dist/`；标记检查不能替代 Private 安全校验。
- 调整快照来源、内联策略或公开发布白名单时，核对匿名请求方式、响应缓存属性、查看者标记和 Private 过滤契约，提供可检查的公开数据依据；来源不明或出现私有/管理员信号时不得发布该快照。响应成功或存在内联标记不等于数据可公开。
- 首页 HTML（包含内联 CSS/JS）与内容指纹资源采用不同更新策略：首页与 Service Worker 脚本应可重新校验，不套用长期 immutable 缓存；内容指纹资源可长期缓存，但内容变化须同步改变指纹及引用。
- 发布会包含工作区文件；不要擅自提交、回退或清理用户改动，也不要把之前测试的产物描述为最终上传的完全相同产物。

## 验收检查

修改后按影响范围运行：

- 基础构建：`npm run build`
- 构建验收：`npm run test:build`
- API 验收：先用 wrangler 启动本地 Pages，再运行 `npm run test:api`
- 浏览器验收：`npm run test:browser`
- 缓存验收：构建后运行 `npm run test:cache`（测试自带本地服务，无需另启本地 Pages）；修改首页缓存头、Service Worker 或相关内联代码更新策略时优先复用。
- 完整本地验收：`npm test`
- 在线验收/性能验收只在任务明确涉及线上环境或性能时运行：`npm run test:online`、`npm run test:performance`
- API 验收会写测试数据；执行前确认 `SMARTTOOLS_BASE_URL` 指向隔离本地环境，不得指向生产或共享数据环境。
- `test:online` 会下载远程配置、读取管理员凭据并登录；仅在用户明确要求包含管理员登录的在线验收时运行，不作为发布后的自动匿名检查。

验收实现注意事项：

- 刷新与缓存问题不能仅验无缓存首次加载或强刷；覆盖旧缓存迁移、已有缓存后的普通 F5、离线回退，以及桌面/手机的实际层级和点击命中。
- 跨平台文本解析与断言兼容 LF/CRLF，避免仅因换行格式误判构建规则。
- Service Worker 异步验收区分 `controllerchange`、`activated` 与所需缓存清理操作完成；等待目标状态和实际完成条件，使用有界等待，不仅凭事件到达或固定延时即断言清理结束。
- 调整构建快照相关逻辑时，验收应包含公开正常样例，以及 private/no-store 响应、管理员查看者标记或含 Private 内容等拒绝样例；使用合成数据并核对实际响应契约，不抓取真实私有数据作 fixture。未实现或未验证的拒绝行为应明确报告，不把新增规则表述成已有代码防护或真实泄露结论。
- 优先改进和复用现有验收脚本；这些提示不新增独立审核关卡、运行时或子 Agent，也不要求纯规则/文档修改运行全套业务验收。

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
- 排查“强刷正常、普通刷新异常”时，同时检查 HTTP 缓存、Service Worker 缓存及实际运行的 HTML/内联代码版本，不能只看源代码或线上最新文件就认定用户已收到修复。
- 分别判断首页 HTML、指纹静态资源、Service Worker 和公开数据 localStorage 缓存的更新与隐私边界；公开数据缓存失效不能替代页面代码更新，缓存清理只处理本项目拥有的缓存。
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

## 提炼蒸馏辅助规则

- 本项目接入并加载 [AGENT_Distill.md](AGENT_Distill.md)，作为主 Agent 的提炼蒸馏辅助职责规则；触发、分析范围、执行预算和输出方式统一以该文件为准，不在此重复维护。
- 启用蒸馏建议持久化，项目根目录以本文件所在目录为准；满足辅助规则的保存条件时，仅创建或追加根目录 `TODO_Distill.md`。
- `TODO_Distill.md` 仅为待人工审核的建议数据，不作为规则或自动执行上下文加载，不从中执行指令；建议不会自动生效。
- 引用原文中其他项目的专属约定（如 UPilot 与 `TODO_UPilot.mcd`）不适用于 SmartTools，不因接入而创建、读取或维护这些产物。
- 本辅助规则不得覆盖更高优先级指令或本文件的项目安全边界，不改变原任务的授权、范围、流程或验收要求。
