# SmartTools

一个部署在 Cloudflare Pages 上的单主题个人书签主页。项目采用简洁的 Notion 风格，保留在线管理后台、浏览器标签页导入扩展、完整导入导出、Private 分类和 KV 备份，同时采用单管理员模型。

## 扩展优先的统一模型 v2（已实现，需显式启用）

栖页使用同一份 `{schemaVersion:2, updatedAt, roots}` 业务文档贯穿 KV、API、本机 IndexedDB 和页面草稿。根容器显示为分类，内部为多层文件夹；稳定 ID、children 排序、isPrivate 继承、visible 隐藏。只有有效云端保存更新时间，无变化保存保持原时间和 ETag；特殊旧内容只读保留。不新增扩展权限或认证机制。

- 新协议：管理员专用 `GET/PUT /api/v2/bookmarks`、`GET /api/v2/bookmarks/meta`；全量 PUT 必须携带 `baseEtag`，返回确认文档。账户登录／会话／退出改用 `/api/v2/auth/*`，旧账户协议返回 410。
- `BOOKMARKS_MODE` 默认 legacy；maintenance 冻结书签接口（503），v2 启用新库并令旧书签接口返回 410；`/account.html` 改为静态服务端配置说明。不自动迁移、不双写、不回退旧 KV。
- `npm run prepare:bookmarks-v2 -- <本地备份文件>` 默认只校验；显式 `--output <仓库外新目录>` 才输出备份和候选，不上传。新键 `admin:bookmarks:v2:current` 必须在另行授权的维护窗口核对后初始化；旧键冻结保留，不在本次开发删除。
- 构建时 `SMARTTOOLS_BOOKMARKS_MODE` 应与服务端模式一致；退休构建不含书签快照。v2/maintenance 的发布检查额外要求 `SMARTTOOLS_CONFIRMED_SERVER_MODE`，它是人工确认，不会查询线上绑定。legacy 原发布快照检查仍保留。
- 扩展主页账户菜单提供 JSON 导入/导出：导出当前站点最近确认的完整 v2 文档（包含隐藏项和 Private，不含草稿），文件未加密；导入经大小、结构、字段、ID、层级及安全链接校验后确认替换本页草稿，不合并、不立即写缓存或云端。仅登录并加载可写版本后可导入；仍需显式保存，沿用当前 ETag 和确认时间。
- `npm run test:v2` 覆盖模型/API、退休构建及暖 SW；`npm run test:extension` 使用合成数据、真实 MV3 和隔离 loopback 测试服务，不登录生产。
- 当前页／当前窗口／全部窗口采集及复制导出不重做。旧网站确认导入按钮暂时隐藏禁用，新版导入留待后续；原生右键单条收藏接入新协议。

详见 [完整协议、四层存储及维护切换手册](BOOKMARKS_V2.md) 和 [扩展使用说明](extensions/open-tabs-importer/README.md)。本次开发不部署、不迁移生产。KV 仍为最终一致，不提供原子 CAS，请避免并发保存。

## 旧网站功能（仅 BOOKMARKS_MODE=legacy）


- 单一 Notion 风格主页，访问 `/` 直接渲染，不再进行主题跳转。
- 旧的 `index1`～`index5` 地址会永久重定向到主页。
- `/config.html` 管理分类、主卡片、子卡片、联系方式和注释。
- “基础设置”可在“经典展开”和“新版目录”之间切换子卡片展示；新版目录提供网站图标与失败回退、轻量列表、吸顶“全部打开”和限高滚动，默认仍使用经典展开。
- 旧版本扩展可把标签页批量送入此后台确认；新版 v2 扩展暂缓这一集成。
- 支持完整 JSON、`data.js`、CSV、XLSX、浏览器书签 HTML 和 ZIP 导入导出。
- Cloudflare KV 在线存储，支持手动备份、自动备份和恢复。
- 单管理员登录，使用 HttpOnly、Secure、SameSite=Strict Cookie。
- 在线改密、注销全部设备及临时恢复接口均已停用；修改账户密码应调整 Pages 环境配置并重新部署。
- Private 分类只向已登录管理员返回。

## Private 安全边界

Private 是服务端访问控制，不是数据加密：

- `private: true` 的分类以明文保存在 KV 和管理员备份中。
- 未登录请求会在 `/api/data` 服务端过滤 Private 分类。
- 管理员登录后可以查看和编辑完整数据。
- 首页可把已过滤的公开数据写入浏览器 localStorage 以加速回访；管理员完整响应仍保持 `private, no-store`，不会写入该长期缓存。
- Cloudflare 账号管理员仍然可以读取 KV 明文。
- 公共仓库中的静态 `data.js` 不应放置 Private 内容。
- 构建时内联到公开 HTML 的快照受同一安全边界约束。调整快照来源、内联策略或公开白名单时，应核对匿名响应契约，并用合成数据覆盖 `private`/`no-store` 响应、管理员视图和 Private 内容的拒绝情况。这是维护要求，不表示当前发布标记检查已实现全部拒绝行为。
- 完整导出文件可能包含 Private 明文，请妥善保管。

项目不再支持 AES/PBKDF2 密文分类，也不兼容旧密文数据。

## Cloudflare Pages 部署

构建设置：

| 设置 | 值 |
|---|---|
| Build command | `npm run build` |
| Build output directory | `/dist` |
| Production branch | `main` |

构建脚本采用公开文件白名单，只会把主页、后台页面、运行时共享资源和浏览器扩展复制到 `dist`。README、测试脚本、包清单和其他开发文件不会作为静态资源发布。

Production 环境变量：

| 名称 | 类型 | 说明 |
|---|---|---|
| `USER` | 环境变量或 Secret | 管理员账号；缺失时默认 `admin` |
| `PASSWORD` | Secret | 管理员密码；缺失时默认使用公开的 `codingriver2026` |
| `AUTH_SECRET` | Secret | 独立的 HMAC 会话签名密钥，至少 16 字符，必须配置 |

继续绑定 `FAV_KV`。**生产环境务必设置独立 PASSWORD。** 缺失时自动回退公开默认密码，属于不安全配置；显式配置为空或类型错误时拒绝登录，不回退默认值。`USER` 和 `PASSWORD` 可单独覆盖；不要把密码复用作 `AUTH_SECRET`。旧 `ADMIN_USER`、`ADMIN_PASS`、KV 中的 `admin:credentials` 及恢复变量不参与新协议鉴权，保留配置也不会覆盖默认密码。

## 管理员账号密码与已停用的维护功能

在现有 Cloudflare Pages 项目环境设置中更新 `USER` 和／或 `PASSWORD`，重新部署后重新登录。修改账号、密码或 `AUTH_SECRET` 后，新配置实例将拒绝旧 v2 会话；部署切换期间不保证瞬时全局失效。旧 Cookie 不接受，退出或改密不会删除扩展本机含 Private 的长期缓存，共用设备请另行清除。`/account.html` 只显示配置说明，不再提供在线改密、恢复或注销全部设备。旧登录、检查、退出和 `/api/account/*` 接口在所有模式返回 JSON 410；旧 `/api/change-password` 继续 JSON 404。旧 KV 凭据保留但不再被新协议读取，本轮不删除、不迁移。

## 本地开发与验收

安装依赖：

```bash
npm install
```

启动本地 Pages：

```bash
npm run build

npx wrangler@latest pages dev dist \
  --kv FAV_KV \
  --binding USER=testadmin \
  --binding PASSWORD=TestPass2026 \
  --binding AUTH_SECRET=0123456789abcdef0123456789abcdef \
  --compatibility-date 2026-07-16 \
  --port 8788
```

运行 API 与浏览器验收：

```bash
npm test
```

浏览器验收同时覆盖已有缓存后的普通刷新、旧 Service Worker 缓存迁移、桌面/手机子卡片层级、离线回退及私有响应不进入 Cache Storage。构建后可单独运行 `npm run test:cache`，无需启动本地 Pages 服务。

直接部署生产环境：

```bash
npm run deploy
```

验收覆盖：单管理员登录、KV 加盐哈希改密、旧密码与旧会话失效、注销全部设备、一次性恢复令牌、敏感凭据不泄露、匿名写入拦截、Private 服务端隔离、单主题桌面/移动端渲染、旧主题地址跳转、导入导出入口、扩展资源、备份、注释和废弃 API 404。

## 项目构建与发布 Skill

仓库包含 1 个项目自有 Skill：`.agents/skills/smarttools-release/SKILL.md`。Agent 可通过 `$smarttools-release` 或 `AGENTS.md` 中的引用，在构建、发布准备和明确要求的实际部署任务中使用。

- **仅构建**：生成本地产物，不隐式部署。默认构建可能获取公开快照和图标；本地可禁用快照，但不满足生产发布检查。
- **准备发布**：构建、执行 `npm run verify:deploy`，并按改动范围选择本地验收，不上传。
- **实际发布**：仅在明确要求时更新已有 `smarttools` Cloudflare Pages 项目，包括 Pages Functions；核实账户和生产分支（当前脚本为 `main`）。不自动新建 Pages、独立 Worker、KV，也不自动修改 secrets、绑定或域名。

`npm run deploy` 会在校验、上传前重新构建，因此不保证与此前测试的产物逐字节相同。API 验收会写入 fixture，必须使用隔离本地数据。`npm run test:online` 须明确要求管理员在线验收，并显式提供 `SMARTTOOLS_ONLINE_ADMIN=1`、`SMARTTOOLS_ONLINE_USER`、`SMARTTOOLS_ONLINE_PASSWORD`；不再下载远程配置，不作为部署后的自动匿名检查。Skill 与 Agent 规则文件不属于公开部署资源。

## 主要 API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/v2/auth/login` | 否 | 管理员登录 |
| GET | `/api/v2/auth/session` | 否 | 会话及服务配置状态，已登录时返回默认密码警告标记 |
| POST | `/api/v2/auth/logout` | 否 | 清除会话，不删除扩展缓存 |
| GET/PUT | `/api/v2/bookmarks` | 管理员 | 读取／保存完整 v2 书签文档，PUT 须提交 baseEtag |
| GET | `/api/v2/bookmarks/meta` | 管理员 | 读取版本及更新时间 |
| 任意 | `/api/login`、`/api/check`、`/api/logout`、`/api/account/*` | 已停用 | JSON 410，不转接旧协议 |
| GET | `/api/data` | 可选 | 匿名返回公开数据，管理员返回完整数据 |
| GET | `/api/data-meta` | 可选 | 当前可见数据的哈希与 ETag |
| POST | `/api/save` | 管理员 | 保存完整数据或分类增量 |
| POST | `/api/comment` | 管理员 | 精确更新卡片注释 |
| GET/POST | `/api/source` | POST 管理员 | 查询或切换 KV/static 数据源 |
| GET/POST | `/api/site-config` | POST 管理员 | 标题、页头、页脚、子卡片布局和备份设置 |
| GET/POST/DELETE | `/api/backups` | 管理员 | 备份、恢复和删除 |
| POST | `/api/fetch-page-title` | 管理员 | 获取 URL 页面标题 |

未知 `/api/*` 路由统一返回 JSON 404。

匿名 `/api/data` JavaScript 响应允许长缓存。首页会优先渲染安全的公开本地缓存，再在后台按 ETag 校正；管理员响应继续使用 no-store 语义。

首页 HTML（`/` 与 `/index.html`）在联网访问及普通 F5 刷新时重新校验。Service Worker 对首页采用网络优先、断网回退，并在激活时清理旧版 SmartTools 缓存；带指纹的 shared 资源仍使用长期缓存，避免旧 HTML 内联的 CSS/JS 让已修复的布局问题再次出现。仅缓存公开响应，不缓存管理页面和 API 数据（公开图标图片除外）。

## 项目结构

```text
index.html                     单一 Notion 风格主页
config.html                    管理后台
data.js                        公开静态兜底数据
shared/                        数据加载、主页渲染、注释与导入导出
functions/api/                 Cloudflare Pages Functions
extensions/open-tabs-importer/ 栖页书签桌面与标签页导入扩展
scripts/                       自动化验收和维护脚本
```


### 栖页扩展主页

配套 v2 服务端与单一 start.html：多层容器、本机路径搜索、增删改/移动/排序、隐藏项整理及显式保存内存草稿。仅精确可信主页能保存，不读取原生收藏夹或接管新标签页。Private 完整缓存退出/离线后仍可查看，无主动过期，不宣称加密；共用设备须单独清除。旧缓存只读，收到新服务端确认后升级；保留站点设置、数据库名称和原会话。

### 扩展侧栏宽度

拖动栖页主页侧栏右边界即可调宽，双击恢复 180px；聚焦分隔条后用左右键调整 8px、Shift + 左右键调整 24px，Home/End 到最小/最大。Escape、指针取消或窗口失焦会取消未完成的拖动。≤600px 使用分类抽屉，不修改桌面偏好。宽度仅保存在本机 `chrome.storage.local.desktopSidebarWidth`，多个主页同步；窗口临时变窄、退出、切站或清除书签缓存不会重置偏好。无需登录、不产生草稿、不上传到云端；存储失败会提示“宽度未能记住”。
