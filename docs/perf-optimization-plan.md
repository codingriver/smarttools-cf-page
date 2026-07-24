# www.303066.xyz 主页加载性能优化方案（可独立落地）

> 目标站点：CodingRiver 书签收藏站（Cloudflare Pages + Pages Functions + KV）
> 本文档基于对线上站点的**实测数据**编写，可脱离对话独立执行。
> 前提约定：**收藏数据不要求即时（允许秒级~分钟级延迟）**，因此可以对前端做激进缓存。

---

## 0. TL;DR（先看这里）

| 优先级 | 动作 | 收益 | 风险 |
|---|---|---|---|
| **P0 必做** | 首页公开数据写入本地缓存 400 天 + 拉长 `/api/data` 浏览器缓存 | 回访先用本地数据渲染，网络校正不阻塞首屏 | 极低 |
| **P0 必做** | 静态资源改「内容哈希 URL + 1 年 immutable」 | 静态资源 1 年不再回源，满足"缓存≥1 年"诉求，且部署后自动刷新 | 低（改 build） |
| **P1 建议** | 让 `index.html` 可被边缘缓存 | HTML TTFB 从 ~250ms 降到边缘命中 | 低 |
| **P2 已做** | 构建时把首屏数据快照内联进 `index.html` | **首访也不用等 `/api/data`**，直接消灭 2 秒白屏 | 中（会让后台改数据需重新部署或后台刷新） |

---

## 1. 实测基线与根因

### 1.1 已经做好的（清单里的假设大多不成立）

在改动前请先确认，以下项**线上已启用**，不要重复投入：

- ✅ 已在 **Cloudflare** 后面（`server: cloudflare`），并非"无 CDN"
- ✅ **HTTP/2 + HTTP/3**（`alt-svc: h3`）+ **TLS 1.3**
- ✅ **Brotli** 全站压缩（HTML 47KB → 9KB）
- ✅ 主页 CSS/JS **已内联**进 `index.html`，公开首页几乎没有外部阻塞资源
  - `shared/fav-page.js` 在构建时被 [scripts/prepare-deploy.mjs](../scripts/prepare-deploy.mjs) 压缩内联到 `</body>` 前
  - 数据加载器（`data-loader`）以内联 `<script>` 写在 [index.html](../index.html) 的 `<head>`

### 1.2 真正的瓶颈：串行瀑布

```
① GET /            HTML 外壳   TTFB≈578ms(含DNS/TCP/TLS)  → 外壳秒开
        │  解析 <head> 内联脚本，立即发起
        ▼
② GET /api/data    收藏数据     冷启动 TTFB≈1.07s / 边缘命中≈0.40s，13KB，来自 KV
        │  runScript 注入 sections
        ▼
③ 渲染             "正在加载收藏内容…" 消失
```

**结论：`正在加载收藏内容…` 停留 ~2 秒 = HTML 往返 + `/api/data` 往返（冷启动约 1s）之和。**

### 1.3 `/api/data` 为什么慢 / 为什么没被缓存住

见 [functions/api/data.js](../functions/api/data.js)：

- 每次**未命中**都要：并行 3 次 KV 读取（`SOURCE_KEY`/`DATA_KEY`/split 快照）+ `readSiteConfig` + 对全量内容做 **SHA-256** + 剥离私有分类。
- 响应头优化前为：
  ```
  Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300
  ```
  浏览器只缓存 30s、Worker 边缘缓存只 60s → **几乎每次访问都重算**。
- 边缘缓存用的是 Worker 的 `caches.default`，**按机房（colo）本地**，`cf-cache-status` 恒为 `DYNAMIC`（CDN 层不缓存 Function 响应）。
- [functions/api/save.js](../functions/api/save.js) 等写入接口已主动清本机房公共缓存；其它机房可接受 TTL 内最终一致，与"不要求即时"吻合。

---

## 2. 验收目标（对齐原始指标）

| 指标 | 目标 | 达成手段 |
|---|---|---|
| TTFB（HTML） | ≤ 200ms（边缘命中） | P1：index.html 边缘可缓存 |
| LCP | ≤ 1.2s | P0 数据缓存 + P2 首屏内联 |
| Load | ≤ 1.8s | P0 + 静态资源 1 年缓存 |
| 首次无痕访问 | 无明显长白屏 | P2 首屏数据内联（可选但最有效） |
| 回访 | 收藏内容"瞬开" | P0 浏览器长缓存 |

---

## 3. P0-A：优化 `/api/data` 和本地缓存（消灭重复的 2 秒）

### 3.1 思路

- **首页 localStorage 缓存 400 天** → 回访先同步注入公开数据，**不用等 `/api/data`**。
- **浏览器缓存（`max-age`）大胆拉长到 1 年** → 没有 localStorage 时也能复用 HTTP 本地副本。
- **Worker 边缘缓存（`s-maxage`）适度拉长到 1 天** → 每个机房的重算频率从"每 60s"降到"每天一次"。
- **保存时主动清缓存** → 后台改完立刻可见（管理员所在机房），不必等 TTL。

### 3.2 改动 1：调整响应缓存头

文件：[functions/api/data.js](../functions/api/data.js)，`onRequestGet` 内的 headers。

```diff
     const headers = {
         'Content-Type': 'application/javascript;charset=utf-8',
         'Cache-Control': isAdmin
             ? 'private, no-store'
-            : 'public, max-age=86400, s-maxage=3600, stale-while-revalidate=86400',
+            : 'public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000',
         'ETag': responseEtag,
```

含义：
- `max-age=31536000`：浏览器 HTTP 缓存 1 年。
- `s-maxage=86400`：每机房 Worker 缓存 1 天才重算一次。
- `stale-while-revalidate=31536000`：过期后先返旧、后台刷新，避免用户等冷启动。
- 首页另用 `localStorage['smarttools:public-data-cache:v1']` 保存公开 JS 数据 400 天；命中后立即渲染，再用 `cache: 'no-cache'` 后台按 ETag 校正。

> 若希望"更即时"，把 `s-maxage` 调小即可；若希望"更省算力"，调大即可。数据不即时，随便调。

### 3.3 改动 2：保存时清除 `/api/data` 边缘缓存

文件：[functions/api/save.js](../functions/api/save.js)。

`data.js` 里的缓存键构造（保持一致，`PUBLIC_CACHE_VERSION = 'v1'`）：
```js
// functions/api/data.js 现有逻辑
url.searchParams.set('__smarttools_public_cache', 'v1');
```

在 `save.js` 中，`contentChanged` 写入 KV 之后（约第 74 行 `Promise.all([...])` 之后）追加：

```js
// 保存成功后，主动失效本机房的 /api/data 公共缓存，让改动立即可见
if (contentChanged && typeof caches !== 'undefined') {
    try {
        const cacheUrl = new URL('/api/data', request.url);
        cacheUrl.searchParams.set('__smarttools_public_cache', 'v1'); // 必须与 data.js 的 PUBLIC_CACHE_VERSION 一致
        await caches.default.delete(new Request(cacheUrl.toString(), { method: 'GET' }));
    } catch { /* 缓存失效失败不影响保存主流程 */ }
}
```

> ⚠️ **局限**：`caches.default` 是机房本地的，`delete` 只清管理员保存请求命中的那个机房。其它机房仍靠 `s-maxage=86400` 到期刷新。对"不要求即时"的书签站完全够用。

### 3.4（可选进阶）全局即时失效 —— KV 代际号

若要求"任意机房、任意用户保存后立即刷新"，可用 KV 里的"代际计数器"参与缓存键：

- 在 `save.js` 的 `contentChanged` 分支里 `env.FAV_KV.put('admin:data_gen', String(Date.now()))`。
- 在 `data.js` 的 `publicCacheKey()` 里，把 `v1` 换成从 KV 读到的代际号（`await env.FAV_KV.get('admin:data_gen')`）。

代价：每次 `/api/data` 命中前多 1 次 KV 读（热点 KV 键在边缘有缓存，通常个位数毫秒）。**默认不建议**，除非确有全局即时刷新需求。

---

## 4. P0-B：静态资源「内容哈希 URL + 1 年 immutable」

### 4.1 为什么不能直接对稳定文件名设 1 年 immutable

`shared/*.js` 是稳定文件名（如 `shared/note-modal.js`）。若直接 `max-age=31536000, immutable`，部署新版本后浏览器 **1 年内不会重新拉取**，管理员后台（`config.html`）会一直用旧脚本。

**解决方案：给引用加内容哈希查询串 `?v=<hash>`**。构建时按文件内容算哈希写进引用；内容变→URL 变→浏览器自动拉新；旧 URL 的缓存无害留存。Cloudflare 默认按含 query 的完整 URL 缓存，浏览器也按完整 URL 作键，方案成立且**无需重命名文件**。

### 4.2 当前外部引用清单（需要打哈希的目标）

- [index.html](../index.html)：`shared/fav-page.js`（注意：生产构建已内联，非构建直开才用到）
- [config.html](../config.html)：`shared/emoji-data.js`、`shared/csv-schema.js`、`shared/xlsx-adapter.js`、`shared/zip-adapter.js`、`shared/note-modal.js`
- `shared/note-modal.css`（若被引用）
- 兜底 `data.js`（仅 `file://` 直开与服务端 `ASSETS.fetch` 用到，浏览器侧长缓存风险低）

### 4.3 改动 1：构建脚本注入内容哈希

文件：[scripts/prepare-deploy.mjs](../scripts/prepare-deploy.mjs)。在 `await writeFile(builtIndexPath, builtIndex);` 之前/之后加入对 `dist` 内 HTML 的引用改写：

```js
import { createHash } from 'node:crypto';

// 计算 dist/shared/<file> 的短哈希
async function assetHash(distDir, relPath) {
    const buf = await readFile(path.join(distDir, relPath));
    return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

// 对指定 HTML 文件里 shared/*.js|css 的引用追加 ?v=<hash>
async function fingerprintHtml(distDir, htmlRelPath) {
    const htmlPath = path.join(distDir, htmlRelPath);
    let html = await readFile(htmlPath, 'utf8');
    const refs = new Set([...html.matchAll(/shared\/[A-Za-z0-9._-]+\.(?:js|css)/g)].map(m => m[0]));
    for (const ref of refs) {
        const hash = await assetHash(distDir, ref);
        // 仅替换尚未带 ?v= 的引用
        const re = new RegExp(ref.replace(/[.]/g, '\\.') + '(?!\\?)', 'g');
        html = html.replace(re, `${ref}?v=${hash}`);
    }
    await writeFile(htmlPath, html);
}

await fingerprintHtml(outputDirectory, 'index.html');
await fingerprintHtml(outputDirectory, 'config.html');
await fingerprintHtml(outputDirectory, '404.html');
```

> 说明：`index.html` 里 `fav-page.js` 已在上一步被内联删除，故只会命中残留引用；`config.html` 的 5 处引用会被打哈希。

### 4.4 改动 2：`_headers` 增加 1 年 immutable 规则

文件：[_headers](../_headers)。**入口 HTML 保持短缓存**，静态资源设 1 年 immutable：

```
/
  Cache-Control: public, max-age=60, must-revalidate

/index.html
  Cache-Control: public, max-age=60, must-revalidate

/config.html
  Cache-Control: no-cache

# 静态资源：内容哈希后可安全长缓存 1 年
/shared/*
  Cache-Control: public, max-age=31536000, immutable

/extensions/*
  Cache-Control: public, max-age=31536000, immutable
```

> `data.js` 不列入 immutable（它是兜底数据、无哈希、可能随部署变化），保持默认或短缓存即可。

---

## 5. P1：让 `index.html` 可被边缘缓存（降 HTML TTFB）

实测 `/` 的 `cf-cache-status: DYNAMIC` —— HTML 每次回源。原因通常是存在通配 Function [functions/[[path]].js](../functions/%5B%5Bpath%5D%5D.js) 拦截了根路径，使其被当作动态响应。

排查与优化：
1. 打开 [functions/[[path]].js](../functions/%5B%5Bpath%5D%5D.js)，确认 `/`、`/index.html` 是否被该 Function 处理。
2. 若只是转发/加头，考虑：
   - 让根路径直接走 Pages 静态资源（不经 Function），使 CDN 可边缘缓存；或
   - 在该 Function 内对匿名用户命中时用 `caches.default` 缓存 HTML（类似 `/api/data` 的做法）。
3. 目标：匿名首页 HTML 边缘命中，TTFB 降至 ~200ms 内。

> 注意 `index.html` 仍保持 `max-age=60`（见 §4.4）——短缓存是为了让 §4.3 的哈希引用与 §6 的数据版本能及时更新，不要对入口 HTML 设长缓存。

---

## 6. P2（已落地，收益最大）：构建时内联首屏数据快照

### 6.1 目标

彻底消灭首访的 `/api/data` 往返：HTML 一到就带着收藏数据，直接渲染。

### 6.2 做法（混合模式：内联快照 + 后台校正）

1. **构建时**（[scripts/prepare-deploy.mjs](../scripts/prepare-deploy.mjs)）拉取线上公开数据并内联：
   ```js
   // 部署机需能访问线上；失败则跳过内联，回退到运行时 fetch
   let snapshot = '', snapshotEtag = '';
   try {
       const r = await fetch('https://www.303066.xyz/api/data');
       if (r.ok) { snapshot = await r.text(); snapshotEtag = r.headers.get('etag') || ''; }
   } catch {}
   if (snapshot) {
       builtIndex = builtIndex.replace('</head>',
           `<script data-inline-data="1" data-etag=${JSON.stringify(snapshotEtag)}>\n${snapshot}\n</script>\n</head>`);
   }
   ```
2. **运行时改造**内联加载器（[index.html](../index.html) `<head>` 内的 `loadData`）：
   - 若已存在内联数据（`document.querySelector('[data-inline-data]')`）→ **立即渲染**，首屏 0 等待。
   - 随后**后台** `fetch('/api/data', { cache: 'no-cache', headers: { 'If-None-Match': 内联的etag } })`：
     - 返回 `304` 或版本一致 → 不动。
     - 版本变化 → 重新注入并让 `fav-page` 重渲染（需 `fav-page.js` 支持二次渲染）。

### 6.3 代价与取舍

- 后台改数据后，**新访客要等下次部署**才更新内联快照（老访客仍会被后台校正刷新）。
- 内联使 `index.html` 增大约 13KB（Brotli 后约 +3KB），换取首屏 0 往返，值得。
- `fav-page.js` 已提供 `window.__favPageReloadData`，后台校正拿到新版本后可二次渲染。

> 当前实现还会把公开数据写入 400 天 localStorage；构建内联快照缺失时，回访也能先用本地缓存秒渲染。

---

## 7. 实施顺序与验证

### 7.1 建议顺序

1. **P0-A**（§3）：本地公开数据缓存 + `/api/data` 长缓存 + 写入后清缓存。
2. **P0-B**（§4）：build 打哈希 + `_headers` 1 年缓存。
3. **P2**（§6）：首屏数据内联 + 后台校正。
4. **P1**（§5）：`index.html` 边缘缓存（可继续优化）。

每步独立部署、独立验证。

### 7.2 部署

```bash
npm run build          # 生成 dist（含内联/哈希）
npm run deploy         # wrangler pages deploy dist ...
```

### 7.3 验证命令（部署后逐条跑）

```bash
# 1) /api/data 缓存头应为长缓存
curl -sS -D - -o /dev/null https://www.303066.xyz/api/data | grep -i cache-control
#   期望: public, max-age=31536000, s-maxage=86400, stale-while-revalidate=31536000

# 2) 冷/热 TTFB
curl -sS -o /dev/null -w 'ttfb=%{time_starttransfer}s total=%{time_total}s\n' https://www.303066.xyz/api/data

# 3) 静态资源 1 年 immutable（注意用带 ?v= 的实际 URL）
curl -sS -D - -o /dev/null 'https://www.303066.xyz/shared/note-modal.js?v=XXXXXXXX' | grep -i cache-control
#   期望: public, max-age=31536000, immutable

# 4) HTML 边缘缓存（P1 后）
curl -sS -D - -o /dev/null https://www.303066.xyz/ | grep -i cf-cache-status
#   期望: HIT（第二次请求起）

# 5) 保存后即时失效验证：在 config.html 保存 → 立即 curl /api/data 看内容是否更新

# 6) Core Web Vitals：用无痕窗口 + Lighthouse / PageSpeed Insights 复测 LCP、Load
```

### 7.4 回归测试（仓库已有）

```bash
npm run test           # api + browser 验收
npm run test:performance
npm run test:online
```

---

## 8. 回滚

所有改动均为配置/缓存值，风险可控：

- **P0-A**：把 `data.js` 缓存头改回旧值，并移除 `index.html` 里的 `smarttools:public-data-cache:v1` 本地缓存逻辑。
- **P0-B**：还原 `_headers`，移除 `prepare-deploy.mjs` 的 `fingerprintHtml` 调用。
- **P1**：还原 `functions/[[path]].js`。
- **P2**：移除构建内联逻辑与加载器改造。

缓存类问题若已污染边缘，可在 Cloudflare 控制台 **Caching → Purge Everything** 一键清空。

---

## 9. 附：预期效果

| 场景 | 优化前 | 优化后 |
|---|---|---|
| 首次访问（冷） | HTML 578ms + /api/data 冷 1.07s ≈ **2s** 白屏 | P0：≈ HTML + 边缘热 0.4s；P2：**首屏 0 往返** |
| 回访（400 天内） | 仍要 /api/data ≈ 0.4~1s | localStorage 同步命中，收藏**瞬开** |
| 后台改数据 | 60s 内生效 | 管理员机房**立即**，其它机房 ≤1 天（可调） |
| 静态资源 | 4h 后回源校验 | **1 年**不回源，部署自动刷新 |
