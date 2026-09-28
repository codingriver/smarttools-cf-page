# SmartTools

一个部署在 Cloudflare Pages 上的单主题个人书签主页。项目采用简洁的 Notion 风格，保留在线管理后台、浏览器标签页导入扩展、完整导入导出、Private 分类和 KV 备份，同时采用单管理员模型。

## 功能

- 单一 Notion 风格主页，访问 `/` 直接渲染，不再进行主题跳转。
- 旧的 `index1`～`index5` 地址会永久重定向到主页。
- `/config.html` 管理分类、主卡片、子卡片、联系方式和注释。
- “基础设置”可在“经典展开”和“新版目录”之间切换子卡片展示；新版目录提供网站图标与失败回退、轻量列表、吸顶“全部打开”和限高滚动，默认仍使用经典展开。
- Chrome/Edge 扩展可把当前标签页批量送入后台确认导入。
- 支持完整 JSON、`data.js`、CSV、XLSX、浏览器书签 HTML 和 ZIP 导入导出。
- Cloudflare KV 在线存储，支持手动备份、自动备份和恢复。
- 单管理员登录，使用 HttpOnly、Secure、SameSite=Strict Cookie。
- 后台“账户安全”支持修改 KV 加盐哈希密码和注销全部设备；忘记密码时可由 Cloudflare 临时恢复变量开启一次性恢复流程。
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
| `ADMIN_USER` | Secret/变量 | 管理员用户名 |
| `ADMIN_PASS` | Secret | 初始密码及最终恢复锚点；后台设置 KV 密码后不再用于日常登录 |
| `AUTH_SECRET` | Secret | Cookie HMAC 密钥，至少 16 字符 |
| `PASSWORD_RECOVERY_ENABLED` | 临时变量 | 设为 `true` 时开启管理员恢复入口 |
| `PASSWORD_RECOVERY_TOKEN` | 临时 Secret | 一次性恢复令牌，至少 32 字符；恢复后立即删除 |

KV 绑定：

| Binding | 资源 |
|---|---|
| `FAV_KV` | SmartTools KV namespace |

建议将 `ADMIN_PASS`、`AUTH_SECRET` 和临时的 `PASSWORD_RECOVERY_TOKEN` 设置为加密 Secret。

## 账户密码与恢复

旧 `/api/change-password` 接口保持移除并返回 JSON 404。现有 `/api/account/security`、`/api/account/change-password` 和 `/api/account/recovery` 仍属于单管理员账户安全模块的维护范围；维护这些功能不等于恢复旧接口或增加多用户能力。

日常改密流程：

1. 使用当前密码登录 `/config.html`。
2. 点击顶部“账户安全”。
3. 输入当前密码和至少 10 个字符的新密码。
4. 保存后，新密码会用 `PBKDF2-SHA-256`、随机盐和 310,000 次迭代写入 KV；不会保存明文。
5. 密码修改会递增会话版本并注销所有设备，请使用新密码重新登录。

密码来源规则：KV 中没有自定义凭据时使用 Cloudflare `ADMIN_PASS`；一旦在后台设置 KV 密码，日常登录只接受该 KV 密码。修改 `ADMIN_PASS` 不会覆盖已有 KV 密码。

忘记 KV 密码时，按以下方式恢复管理权：

1. 在 Cloudflare Pages 项目的 Production Variables and Secrets 中临时配置：
   - `PASSWORD_RECOVERY_ENABLED=true`
   - `PASSWORD_RECOVERY_TOKEN=<至少 32 字符、从未使用过的随机令牌>`
2. 保持 `ADMIN_USER`、`ADMIN_PASS`、`AUTH_SECRET` 和 `FAV_KV` 正常配置；`AUTH_SECRET` 至少 16 字符。
3. 重试最近一次生产部署，或重新部署，使 Pages Functions 读取新变量。
4. 访问 `/config.html?recover=1`，在页面表单中输入恢复令牌和新密码。不要把令牌放在 URL、聊天记录或截图中。
5. 恢复成功后，旧密码和所有旧 Cookie 都会失效；同一个恢复令牌也不能再次使用。
6. 立即从 Cloudflare 删除 `PASSWORD_RECOVERY_ENABLED` 和 `PASSWORD_RECOVERY_TOKEN`，再重试部署或重新部署，确认登录页不再显示恢复入口。

如果只是修改 Cloudflare `ADMIN_PASS`，但 KV 中已经存在自定义密码，登录密码不会自动回退。应使用上述一次性恢复流程；只有在 KV 中不存在 `admin:credentials` 时，`ADMIN_PASS` 才作为初始登录密码。恢复凭据不会进入站点配置、收藏备份、完整导出或公开 API。

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
  --binding ADMIN_USER=testadmin \
  --binding ADMIN_PASS=TestPass2026 \
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

`npm run deploy` 会在校验、上传前重新构建，因此不保证与此前测试的产物逐字节相同。API 验收会写入 fixture，必须使用隔离本地数据。`npm run test:online` 会读取远程管理员配置并登录，须明确要求管理员在线验收，不能作为部署后的自动匿名检查。Skill 与 Agent 规则文件不属于公开部署资源。

## 主要 API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/login` | 否 | 管理员登录 |
| POST | `/api/logout` | 否 | 清除会话 |
| GET/POST | `/api/account/security` | 管理员 | 查询密码来源或注销全部设备 |
| POST | `/api/account/change-password` | 管理员 | 验证当前密码并修改 KV 密码 |
| GET/POST | `/api/account/recovery` | 临时恢复令牌 | 查询恢复状态或一次性重设密码 |
| GET | `/api/check` | 否 | 会话和服务配置状态 |
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
extensions/open-tabs-importer/ 浏览器标签页导入扩展
scripts/                       自动化验收和维护脚本
```


### 插件独立书签管理主页（v1.2.0）

`extensions/open-tabs-importer/` 新增本地打包的独立管理页。在浏览器中加载此目录的 MV3 扩展，填写自己的 SmartTools HTTPS 后台地址、按需授权站点，再点击**书签管理**。不替换新标签页，不访问 Chrome 原生收藏夹；原有收藏当前页、当前/全部窗口导入、复制和文件导出继续保留。

管理页 `home.html` 复用单管理员登录及浏览器管理的 HttpOnly/Secure/SameSite=Strict 会话，支持搜索、分组/书签/子卡片增删改查、移动排序、Private/隐藏分组、显式保存和未保存提醒。特殊类型卡片原样保留并只读展示；备份和高级设置继续使用网站后台。无 KV 时只读，静态数据首次保存需确认完整初始化到 KV。全部扩展脚本本地提供，不依赖远程脚本或 eval。

- `GET /api/data?format=structured`：返回真正的 JSON `sections`，以及 source/configured、dataVersion/dataEtag/dataHash、hasKV、privateFiltered、siteConfig。只解析数据字面量，不执行源码；无法安全解析时返回 422 `UNSUPPORTED_DATA`。匿名过滤 Private，管理员 JSON 使用 `private, no-store`；原 JavaScript 和 `format=json` 契约保持兼容。
- `POST /api/save`：网站后台和插件提交 `baseEtag`、`baseSource`。已可见的数据/来源变化在任何增量写入前返回 409 `SAVE_CONFLICT`；保留草稿，不自动回退为全量覆盖。静态/兜底数据的增量保存返回 409 `INITIALIZATION_REQUIRED`。未提供前置条件的旧调用仍兼容，但不具备旧版本覆盖防护。KV 最终一致，版本检查不是原子 CAS/事务，请避免多个入口同时保存。

保存故障处理：分类增量先在内存生成最终内容，再统一写入 KV，避免同一次保存对相同键重复写入。存储异常返回 JSON `503 / SAVE_STORAGE_ERROR` 与 `outcomeUnknown: true`，不冒充登录失败；这不提供事务或跨请求限流保证。扩展仅在服务器确认 401／会话失效时撤销登录状态；网络超时、网关 403/5xx 和权限撤销单独显示连接异常／暂时只读，保留草稿及上次验证的身份，不自动重试。账户面板的“检查连接与云端（保留草稿）”可重新核对，刷新丢弃草稿仍需确认。错误提示包含接口与 HTTP 状态，不记录密码、Cookie 或书签内容。

- 权限为 tabs/scripting/storage/contextMenus 和当前站点按需授权，不再默认申请全站权限或在所有网页注入脚本；不新增 cookies/bookmarks/history 权限。站点地址在浏览器 sync 存储（可能随浏览器账号同步），待确认导入在 local 存储；完整管理员数据（含 Private）按站点保存到扩展自身来源的 IndexedDB，管理页与右键菜单共用；不设主动过期时间，不随浏览器账号同步，不宣称加密。退出、会话过期、断网或撤销权限后仍可查看本机副本，服务器无法撤回已下载内容；“清除当前／全部站点缓存”独立于退出，清除也会丢弃相关页面草稿。卸载、浏览器清理或存储故障可能丢失缓存。密码和 Cookie token 不持久化；未保存草稿仅在各页面内存中。退出同时影响同站点网页会话。Cookie 策略不允许插件会话时可在网站后台继续，不降低 Cookie 安全属性。

验收：`npm run test:extension-data` 为纯内存解析/过滤/冲突检查，已纳入 `npm run test:api`；`npm run test:extension` 在 Chromium 中真实加载 MV3 脚本并连接隔离本地 Pages，可通过 `EXTENSION_CHROME_PATH` 指定浏览器。Headless 测试仅在临时 manifest 预授权 loopback，原生授权/拒绝/撤销和不同浏览器第三方 Cookie 限制仍需手工检查。详见扩展 README。扩展和验收产物不加入 Pages 公开构建白名单。

### 扩展 1.2.0：共享长期缓存与右键收藏

管理页将站点授权、登录和缓存信息收进右上角账户弹层：未登录时显示“登录”，登录后显示管理员头像；点击可查看登录状态、设置站点、退出登录，以及查看同步时间和展开缓存管理。点击外部或按 Esc 关闭，关闭时清空尚未提交的密码；登录鉴权和长期缓存逻辑不变。

- 网页、链接及扩展图标右键常驻“收藏到 SmartTools”：分组 → 独立卡片／已有展开卡片的子卡片；没有缓存时显示“登录／加载收藏位置”。Private 与隐藏分组有标识。
- 打开管理页／弹窗先读缓存，再检查会话和版本；登录、手动刷新或版本变化时同步完整数据，不定时轮询。公开响应不覆盖完整缓存；无草稿页面跟随更新，有草稿时提醒而不覆盖。
- 右键收藏串行执行，每次重新获取服务器管理员数据、验证目标及 Private 属性、按完整 URL 对同一位置去重，再带最新 baseEtag/baseSource 增量保存。不同位置允许相同 URL；失败不重试，不全量覆盖，无离线写入队列。
- 静态初始化需在管理主页确认；无 KV 只读。右键操作通过角标和现有弹窗反馈，无新增收藏窗口或通知权限。
- `npm run test:extension` 包含真实 MV3 加载与共享缓存／菜单处理测试；原生菜单点击、权限气泡和受限第三方 Cookie 策略仍需手工验收。此缓存例外不改变网站匿名 Private 过滤、HTTP/SW 缓存及公开快照边界。

### 扩展内置浏览主页与列表管理

扩展弹窗保留 **打开主页**（`start.html`）与 **书签管理**（`home.html`）两个入口，不接管新标签页。主页改为 iTab 风格标准图标桌面：56px 分类侧栏、居中时钟/日期/本机搜索、60px 图标、单层文件夹浮层。390px 四列、320px 三列，窄屏通过分类按钮打开侧栏。隐藏组不显示且不参与搜索；已缓存 Private 退出或离线仍可查看。搜索显示分类/文件夹路径；父卡片主链接单独保留，普通链接新标签页打开，特殊类型只读保留。

主页支持右键、可见更多按钮及 Shift+F10 菜单，新增/编辑/删除分组、书签和文件夹；鼠标左键拖动排序、跨组移动和安全叶子书签移入/移出文件夹。普通书签互拖只排序，不合成文件夹；任何文件夹都不能嵌套，搜索期间禁用拖放。菜单同时提供移动和前后排序。Private 转公开需确认，非空分组/文件夹删除可选择迁移/安全移出或一并删除。

**应用到草稿**只修改本页内存；有修改才显示**保存到云端 / 放弃修改**。两页各自拥有草稿，不影响另一页和原生收藏菜单。关闭未应用输入、切站、退出或清缓存涉及丢弃时确认；离线/会话失效保留草稿但禁改禁存。冲突保留草稿、不自动重试、不回退全量覆盖。静态源/无 KV 时主页只读，首次初始化只能在管理页确认。

管理页按 Raindrop 的浅色收藏集导航、紧凑列表和右侧编辑面板组织；默认列表，可切换网格。编辑按钮为 **应用到草稿**，有修改才出现 **保存到云端 / 放弃修改**；关闭尚未应用输入的面板需确认。两页分别复用自己的标签页，不覆盖管理页草稿。

主页、管理页、右键菜单共用原有按站点隔离的已确认 IndexedDB 缓存；未保存草稿不传播到另一页或原生收藏菜单。账户、站点和缓存集中在右上角，保留退出不清除缓存和独立清除入口。消息接口按精确页面和操作白名单限制，仅精确可信 `start.html` / `home.html` 允许请求 `save`，仍经鉴权与源/版本检查；popup、带查询参数的伪装页面及内容脚本不得保存。不增加权限、API、运行时、主题切换器，不修改网站首页/后台。界面资源本地打包，主页使用系统字体，已有字体资源及 `fonts/OFL.txt` 许可保留；不复制参考产品应用代码或品牌素材。设计基准见 `DESIGN.md`；研究截图和测试产物不发布。

`npm run test:extension` 包含真实扩展双页面缓存联动、草稿隔离、编辑防丢失、隐藏分组/子卡片搜索、桌面及 390/320px 验收。原生权限气泡和系统右键菜单仍需人工验收。本轮不部署网站、不发布商店。
