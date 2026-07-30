# SmartTools 首页缓存与“立即显示”深度分析

> 目标：打开首页不再出现约 2 秒的“正在加载收藏内容…”，把非及时性主页尽量本地化（含界面全部内容），并厘清“哪些已本地缓存 / 哪些没有 / 没缓存的怎么改”。
> 分析基于当前源码与 `dist/` 构建产物（部署站点 `www.303066.xyz`）。

---

## 1. 一句话结论

首页“约 2 秒加载”**不是数据没缓存**，而是 **HTML 文档本身缓存太短 + 体积偏大**：

- 已部署的 `dist/index.html` 已经把「渲染脚本 `fav-page.js`」和「公开收藏数据快照」**内联进 `<head>`**，首屏渲染不需要为数据发网络请求（`index.html:55` 附近的 `data-inline-data` 脚本先于 `loadData` 解析执行）。
- 但 `index.html` 的 HTTP 缓存只有 **`max-age=60`（60 秒）**（`_headers:2,5`），加上文档约 **182 KB**（`dist/index.html` 186,540 字节），一旦浏览器磁盘缓存过期或冷启动（新设备/无痕/跨区 CDN miss），就必须重新下载整份 HTML 才能首屏，这就是约 2 秒的来源。
- “正在加载收藏内容…” 这段静态文案写在 HTML 里（`index.html:1781`），要等 `fav-page.js` 在 `DOMContentLoaded` 渲染完才被替换（`shared/fav-page.js:1184`），文档下载/解析越慢，它露脸越久。

**要做到“立即显示 + 全部本地 + 最长本地（3 年或更久）”，需要三件事同时成立：文档长期本地命中、首屏内容写进文档（或可离线缓存）、第三方图标也本地化。**

---

## 2. 首页从“点击”到“看到内容”的真实时序

1. 浏览器请求 `index.html`。若命中本地/边缘缓存且未过期 → 直接本地读取（理想状态，秒开）；否则重新下载 182 KB。
2. `<head>` 中 `data-inline-data` 脚本（构建期注入，含 `window.__siteConfig`、`window.__viewerInfo` 和 `var sections=...`）执行，公开数据进入全局。
3. `<head>` 中 `loadData()` 运行（`index.html:161`）：找到内联脚本 → 写入 localStorage 公共缓存 + 后台 `refreshData()`，**立即返回，不阻塞渲染**（`index.html:166-170`）。
4. 解析到 `</body>` 前的 `fav-page-inline` 脚本（构建期把 `fav-page.js` 内联，`scripts/prepare-deploy.mjs:53-56`）→ 注册 `DOMContentLoaded` 渲染。
5. `DOMContentLoaded` → `bootFavPage()` 等待 `__SmartToolsDataReady`（已 resolved）→ `applyLoadedData()` → `renderAllSections()` 把 `#sectionsRoot` 里的“加载中”替换为真实卡片（`shared/fav-page.js:1184-1190`）。
6. 卡片里的图标（远程 `https://` 图片）随后以 `loading="lazy"` 异步加载（`shared/fav-page.js:481`），**不阻塞首屏文案消失**。

> 关键事实：在**已部署**站点上，第 2、3 步已经让首屏数据本地可用，**渲染本身很快**。瓶颈只在第 1 步“文档能否本地秒回”。

---

## 3. 当前已本地缓存 / 可本地命中的内容

| 内容 | 机制 | 缓存时长 | 证据 |
|---|---|---|---|
| `/shared/*`（fav-page.js、note-modal.js、*.css 等） | HTTP `public, max-age=31536000, immutable` + 内容指纹 `?v=hash` | 1 年（不可变） | `_headers:11`、 `scripts/prepare-deploy.mjs:110-132` |
| `/extensions/*`（浏览器扩展资源） | HTTP `public, max-age=31536000, immutable` | 1 年 | `_headers:14` |
| 匿名 `/api/data` 响应 | HTTP `public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000` + 边缘 `caches.default` HIT/MISS | 浏览器 1 年 / CDN 1 天 / SWR 1 年 | `functions/api/data.js:14,75-86` |
| 公开收藏数据（localStorage） | `localStorage['smarttools:public-data-cache:v1']` | TTL = `400*24h` ≈ **400 天**（非 3 年） | `index.html:58-59,87-89,105-108` |
| 构建期内联数据快照（在 HTML 里） | 随 `index.html` 一起到达，首次解析即可用 | 取决于 `index.html` 的缓存 | `scripts/prepare-deploy.mjs:90-98`、`index.html:166-170` |
| 站点 favicon | `data:` URI 内联 | 永久（无网络） | `index.html:53` |

> 注意：`/api/data` 与 localStorage 只会在**匿名/公开**响应上缓存；管理员响应用 `private, no-store`（`functions/api/data.js:133-135`），不会被本地缓存。

---

## 4. 当前**未本地缓存 / 仍依赖网络**的内容

| 内容 | 现状 | 为什么重要 |
|---|---|---|
| **`index.html` 文档本身** | HTTP `max-age=60, must-revalidate`（`_headers:2,5`） | **这是“2 秒”的主因**：60 秒后必须重验，冷加载/跨区要重新下载 182 KB 才首屏。 |
| **第三方图标图片**（`iconImg: https://...`） | 每次访问都按原 URL 走网络，无本地缓存（无 Service Worker） | 首屏文案虽不阻塞，但卡片图标会闪、慢、甚至失败；不符合“界面全部本地”。 |
| **后台 `refreshData` 请求** | 每次加载都 `fetch('/api/data', {cache:'no-cache'})`（`index.html:129-131`） | 非阻塞，但每次都抢带宽拉全量数据；内联数据已经是最新构建快照，此请求多数情况冗余。 |
| **图标域名连接** | 无 `preconnect`/`dns-prefetch`（`index.html` head 无相关标签） | 图标首批请求要多付 DNS+TLS 时间。 |
| **注释弹窗 `note-modal.js/css`** | 首次点击才按需加载（空闲预热），走 `/shared/*` 1 年缓存 | 已较优；首次仍有一次网络取模块（重复访问命中缓存）。 |

---

## 5. “约 2 秒加载”的根因（精确定位）

1. **主因：`index.html` 仅缓存 60 秒 + 体积 182 KB。** 任意一次“缓存未命中/过期重验”都要重新下载整份文档。慢速移动网络或 CDN 边缘冷启动下，下载+解析 182 KB 约 1–3 秒，`#sectionsRoot` 里的“加载中”文案在此期间可见。
2. **次因：首屏内容依赖 JS 渲染。** “加载中”是静态 DOM，要等 `fav-page.js` 在 `DOMContentLoaded` 执行渲染后才消失。文档解析越慢，等待越久。
3. **可优化但非阻塞：后台 `refreshData` 用 `no-cache` 每次都拉全量**，与首屏渲染并行但占用带宽，弱网下会拖慢整页资源到达。

> 反直觉点：项目**不是没做缓存**，相反已经把数据+脚本内联了；真正短板是“承载一切的 HTML 文档没被长期本地化”。

---

## 6. 改造建议（分级）

### A. 快速见效（不改架构，分钟级，建议先做）

1. **`index.html` 文档缓存拉到最长（核心改动）**
   - `_headers` 中 `/` 与 `/index.html` 由 `max-age=60, must-revalidate` 改为：
     `public, max-age=31536000, immutable`
   - 说明：HTTP 单条 `max-age` 的实际上限约 **1 年**（`31536000` 秒），浏览器对更大值通常会截断到 1 年；`immutable` 让浏览器/中间缓存不再做条件重验。这样重复访问纯本地命中、秒开，正是“最长缓存”的诉求。
   - 更新如何不丢失：单靠 HTTP 标 `immutable` 1 年，重新部署后用户最长约 1 年才看到新 HTML。要“既最长本地、又能在部署后更新”，必须用下方 **B 的 Service Worker**：SW 拦截导航，本地 Cache Storage **长期保留（可设 3 年甚至更久的 prune 窗口）**，并用 `fetch(url, {cache:'reload'})` 绕过 HTTP 缓存、在后台拉取最新 HTML/数据，发现变化后 `skipWaiting`+`clients.claim` 立即生效或提示刷新。
   - 若暂不上 SW，接受最长缓存的代价就是更新延迟约 1 年——这与“期望最长缓存时限”一致，属可接受的取舍。
2. **`refreshData` 改用默认缓存/条件请求**：将 `index.html:131` 的 `cache: 'no-cache'` 改为 `cache: 'default'`（或直接依赖 `If-None-Match`，代码已有 etag 逻辑）。内联快照已是最新构建版，后台刷新不必每次拉全量。
3. **图标域名加 `preconnect`/`dns-prefetch`**：在 `index.html` head（第 4 行附近）为图标所用域名加预连接，缩小首批图标请求的 DNS/TLS 耗时。

### B. 彻底方案：Service Worker（真正“全部本地 + 立即显示 + 3 年 + 离线”）

- 新增 `sw.js`，在 `index.html` 注册；手写、无新框架（符合 AGENTS.md 约束）。
- 策略（对导航、`/shared/*`、匿名 `/api/data`）：
  - **cache-first + 后台更新（stale-while-revalidate）**：首屏直接从 Cache Storage 返回 HTML，渲染脚本与数据已在本地 → “加载中”几乎不可见。
  - **本地保留拉到最长**：Cache Storage 自行管理，条目保留 **3 年或更久**（可设为不主动 prune，仅受源存储配额约束）；更新检测用 `fetch(url, {cache:'reload'})` 绕过 HTTP 缓存拉取最新版，比对 etag/版本变化后再写回缓存，确保“最长本地”与“部署后仍能更新”不冲突。
  - 图标：运行时 cache-first，首次访问后落本地，之后离线可用。
- 更新生效：`skipWaiting` + `clients.claim`（或部署后轻量“刷新以更新”提示），确保新版本能覆盖。
- **安全边界**：SW 只缓存**匿名/公开**响应；凡响应头含 `private`/`no-store` 或 `X-Private-Filtered: 0`（管理员视图）**一律不缓存**（与 `functions/api/data.js` 的 private 边界一致，AGENTS.md 强制要求）。

### C. 极致方案：构建期全量内联 / 预渲染（离线也能看、零加载态）

1. **构建期把公开 sections 预渲染进 `#sectionsRoot`（SSG）**：HTML 直接含卡片 DOM，“加载中”仅作无 JS 兜底。改动点在 `scripts/prepare-deploy.mjs` + 抽出一个 Node 侧纯渲染函数（复用 `fav-page.js` 的 section 渲染逻辑）。这样首屏即内容，不再依赖 JS 渲染才消失“加载中”。
2. **构建期把远程图标下载本地化**：在 `prepare-deploy.mjs` 中把公开 `iconImg: https://...` 下载到 `dist/assets/icons/<hash>.png` 并改写 data，使图标也走长缓存 + SW 缓存 → 真·“界面全部本地”。**仅对公开数据做，private 图标不进公开产物。**
3. 把 `note-modal.js/css` 一并指纹化/可选内联，彻底消除首次按需加载的网络取模块。

---

## 7. 安全边界（必须遵守，来自 AGENTS.md）

- 本地缓存（localStorage、Service Worker、CDN）**只能缓存匿名/公开响应**，绝不能缓存带管理员 cookie 或 `X-Private-Filtered: 0` 的内容。
- 不要把 `ADMIN_PASS`、`AUTH_SECRET`、KV 明文备份、Cookie token 或真实 private 数据写进内联 HTML 或 SW 缓存。
- 当前内联快照是构建期从**匿名** `/api/data` 拉取且已 `stripPrivateSections` 过滤，符合边界；新增任何缓存都要沿用同一过滤开关。

---

## 8. 推荐落地顺序

1. **A1 + A2**（改 `_headers` 缓存、改 `refreshData` 缓存策略）：成本最低，立刻减少“需重新验证”的等待与冗余拉取。
2. **A3**（图标域名 `preconnect`）。
3. **B**（Service Worker）：实现“立即显示 + 最长本地（3 年或更久）+ 后台更新 + 离线”，是满足用户诉求的决定性一步。
4. **C1 + C2**（构建期预渲染 + 图标本地化）：若仍追求“零加载态 / 完全离线”，再做这两项。

---

## 9. 关于“最长本地缓存”的具体数值与上限

- **HTTP 单条 `max-age` 的实际上限约 1 年（`31536000` 秒）**：浏览器/中间缓存对超过 1 年的值通常会截断；`immutable` 进一步禁止条件重验。因此所有指纹化资源（`/shared/*`、`/extensions/*`）与 HTML 条目都可标到这个上限。
- **超过 1 年的“最长本地”由本地存储层承担**，不受 HTTP 上限约束：
  - **localStorage 公共数据缓存**：当前 `PUBLIC_DATA_CACHE_TTL_MS = 400 * 24h`（≈400 天，`index.html:59`）。要“最长”，可改为 **3 年** `1095 * 24 * 60 * 60 * 1000`，或干脆去掉时间过期、只在收到更新版本（etag 变化）时覆盖——对非及时性主页最合适。
  - **Service Worker Cache Storage**：可长期保留（3 年或更久，甚至仅在源配额压力下才 prune），由我们自行管理版本与 prune 窗口；更新检测用 `cache:'reload'` 绕过 HTTP 缓存。
- **结论**：指纹化资源走 `immutable` 1 年（内容 hash 自动失效）；HTML 与数据走“SW 长期持有 + 后台 `reload` 更新”，从而同时拿到**最长本地缓存**与**部署后仍能更新**，而不是把文档标成超长 `immutable` 而牺牲更新。

---

## 10. 我可以直接帮你做的下一步

如果认可，我可以按 A → B → C 顺序动手，最小侵入先改 `_headers`（文档改 `immutable` 1 年）+ `refreshData`（用默认缓存）+ `index.html:59` 的 localStorage TTL 调到 3 年（或改“仅 etag 变化时覆盖”），再补一个手写 Service Worker（带 private 边界校验、用 `cache:'reload'` 做后台更新）。你点头我就开工。

---

## 11. 实现状态（已完成 A1/A2/A3/B）

> 已落地，构建验收 `npm run test:build` 通过（`ok:true`）。

### A1 — `_headers` 文档缓存改最长
- `/` 与 `/index.html`：`public, max-age=31536000, immutable`（`_headers:2,5`）。
- 新增 `/sw.js`：`no-cache`，确保 Service Worker 脚本可被浏览器持续检测更新、不会被 immutable 钉死。
- `/shared/*`、`/extensions/*` 维持 `immutable` 1 年。

### A2 — `refreshData` 缓存策略 + 数据 TTL
- `index.html:2181` `refreshData` 的 `fetch('/api/data', {cache:'no-cache'})` 改为 `cache:'default'`：复用匿名 `/api/data` 已有的 1 年浏览器缓存，减少每次后台冗余全量拉取；仍保留 `If-None-Match` 走 304。
- `index.html:2109` `PUBLIC_DATA_CACHE_TTL_MS` 由 `400*24h` 提升到 `1095*24h`（**3 年**），公共数据本地保留更久。

### A3 — 图标域名 preconnect + CSP 放行
- `index.html` `<head>` 新增 `<link rel="preconnect" href="https://o.n29.net">`（所有 `iconImg` 远程图标均来自该域名）。
- CSP `default-src` 增加 `https://o.n29.net`，否则 preconnect 会被 `connect-src` 拦截。

### B — Service Worker（决定性的一步）
- 新增 `sw.js`（根目录），并加入 `scripts/prepare-deploy.mjs` 的 `publicEntries` 白名单，构建后会进入 `dist/`。
- `index.html` 在 `<body>` 末尾注册 `/sw.js`（`https`/localhost 才注册）。
- 缓存策略（仅公开资源）：
  - 首页 HTML（`/`、`/index.html`）：**cache-first + 后台 `cache:'reload'` 更新**（stale-while-revalidate），绕过 HTTP 缓存始终拉到最新，部署后立即生效。
  - `/shared/*`、`/extensions/*` 与跨源图标图片（`destination==='image'`）：**cache-first，命中即返回**，未命中才联网。
  - 所有条目写入元数据，`activate` 时 **prune 超过 3 年的条目**；旧版本缓存一并清理。
- **安全边界（严格遵循 AGENTS.md）**：非 GET 请求（登录/保存等 POST）一律直连不缓存；`/api/*`、管理页 `config.html` 从不进入缓存；同源响应若带 `private`/`no-store` 直接拒绝缓存。**Private 数据与管理端响应绝不会落入 Cache Storage。**

### C 级 — 图标本地化（已完成，2026-07-29）
目标：彻底消除外部图标引发的第三方防盗链/跨域 403，并实现“全部缓存本地、离线可用”。线上验收 `npm run test:online` 已通过（`browserErrors: []`）。

- **构建期下载（`scripts/prepare-deploy.mjs`）**：解析内联快照与静态 `data.js` 里的 `iconImg` 外部 URL，下载到 `dist/icons/<sha256前12位>.<ext>`，并把引用改写为同域 `/icons/<hash>`；下载失败（如 `hvoy.ai` 403）则保留原 URL，由客户端代理兜底。新增 `/icons/*` 的 `_headers`：`public, max-age=31536000, immutable`。
- **同域代理（`functions/api/icon.js`，新增）**：浏览器把剩余外部 `http(s)` 图标改写为 `/api/icon?u=<encoded>`。函数服务端拉取，成功返回图片（`immutable`），失败（4xx/5xx/超时/网络错误/SSRF）回退 **200 透明 SVG**，因此浏览器**绝不**再报 403。带 SSRF 防护（拦截私有/回环主机字面量）、8s 超时、5MB 上限。
- **客户端改写**：`shared/fav-page.js` 的 `__safeImgUrl` 与 `config.html` 的 `renderIconTo` 把外部 `http(s)` 图标统一走 `/api/icon`；`data:`/相对/同域（`/icons/*`）保持原样。
- **SW 缓存**：`sw.js` 的 `isCacheableSameOrigin` 新增 `/icons/*`，并新增 `isCacheableIconProxy` 对 `/api/icon` 做 cache-first → 图标离线可用。
- **效果**：线上验收此前唯一阻塞项（`https://hvoy.ai/favicoin.svg` 403）消失；所有图标均为同域请求，可被 SW 与边缘缓存长期持有；首屏内容本就内联，图标下载/代理失败也有兜底，不再出现“正在加载收藏内容”期间的外部阻塞。

### 仍建议（未做，可选优化）
- 构建期把公开 `sections` 预渲染进 `#sectionsRoot`，做到“零加载态”零等待（当前内联数据已能做到首屏立即渲染，加载态几乎不可见）。
