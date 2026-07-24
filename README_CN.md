# SmartTools

一个部署在 Cloudflare Pages 上的单主题个人书签主页。项目采用简洁的 Notion 风格，保留在线管理后台、浏览器标签页导入扩展、完整导入导出、Private 分类和 KV 备份，同时采用单管理员模型。

## 功能

- 单一 Notion 风格主页，访问 `/` 直接渲染，不再进行主题跳转。
- 旧的 `index1`～`index5` 地址会永久重定向到主页。
- `/config.html` 管理分类、主卡片、子卡片、联系方式和注释。
- Chrome/Edge 扩展可把当前标签页批量送入后台确认导入。
- 支持完整 JSON、`data.js`、CSV、XLSX、浏览器书签 HTML 和 ZIP 导入导出。
- Cloudflare KV 在线存储，支持手动备份、自动备份和恢复。
- 单管理员登录，使用 HttpOnly、Secure、SameSite=Strict Cookie。
- Private 分类只向已登录管理员返回。

## Private 安全边界

Private 是服务端访问控制，不是数据加密：

- `private: true` 的分类以明文保存在 KV 和管理员备份中。
- 未登录请求会在 `/api/data` 服务端过滤 Private 分类。
- 管理员登录后可以查看和编辑完整数据。
- 首页可把已过滤的公开数据写入浏览器 localStorage 以加速回访；管理员完整响应仍保持 `private, no-store`，不会写入该长期缓存。
- Cloudflare 账号管理员仍然可以读取 KV 明文。
- 公共仓库中的静态 `data.js` 不应放置 Private 内容。
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
| `ADMIN_PASS` | Secret | 管理员密码 |
| `AUTH_SECRET` | Secret | Cookie HMAC 密钥，至少 16 字符 |

KV 绑定：

| Binding | 资源 |
|---|---|
| `FAV_KV` | SmartTools KV namespace |

建议将 `ADMIN_PASS` 和 `AUTH_SECRET` 设置为加密 Secret。

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

直接部署生产环境：

```bash
npm run deploy
```

验收覆盖：单管理员登录、匿名写入拦截、Private 服务端隔离、单主题桌面/移动端渲染、旧主题地址跳转、导入导出入口、扩展资源、备份、注释和废弃 API 404。

## 主要 API

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/login` | 否 | 管理员登录 |
| POST | `/api/logout` | 否 | 清除会话 |
| GET | `/api/check` | 否 | 会话和服务配置状态 |
| GET | `/api/data` | 可选 | 匿名返回公开数据，管理员返回完整数据 |
| GET | `/api/data-meta` | 可选 | 当前可见数据的哈希与 ETag |
| POST | `/api/save` | 管理员 | 保存完整数据或分类增量 |
| POST | `/api/comment` | 管理员 | 精确更新卡片注释 |
| GET/POST | `/api/source` | POST 管理员 | 查询或切换 KV/static 数据源 |
| GET/POST | `/api/site-config` | POST 管理员 | 标题、页头、页脚和备份设置 |
| GET/POST/DELETE | `/api/backups` | 管理员 | 备份、恢复和删除 |
| POST | `/api/fetch-page-title` | 管理员 | 获取 URL 页面标题 |

未知 `/api/*` 路由统一返回 JSON 404。

匿名 `/api/data` JavaScript 响应允许长缓存。首页会优先渲染安全的公开本地缓存，再在后台按 ETag 校正；管理员响应继续使用 no-store 语义。

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
