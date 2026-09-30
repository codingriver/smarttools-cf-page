# 栖页统一书签文档与切换手册

本文件描述已实现的协议；不表示已在生产启用。默认 `BOOKMARKS_MODE=legacy`，本次开发不部署、不读取线上 Private，也不安装或删除线上 KV 数据。

## 1. 一个业务文档，四种生命周期

```json
{
  "schemaVersion": 2,
  "updatedAt": 0,
  "roots": [{
    "id": "work",
    "type": "folder",
    "title": "工作",
    "isPrivate": false,
    "visible": true,
    "children": [{
      "id": "docs",
      "type": "bookmark",
      "title": "文档",
      "url": "https://example.invalid/docs"
    }]
  }]
}
```

- `roots` 只能是容器；根容器显示为分类，内部容器显示为文件夹，允许嵌套，最多 32 层（包含根分类）。数组顺序就是手动排序。
- 每个节点的 `id` 全文档唯一，移动、重命名不变；不保存另一份父 ID 或排序表。
- 容器必须带 `isPrivate`、`visible`、`children`。私有向后代继承，子容器的 `false` 不解除祖先的保护。隐藏是展示偏好，不是访问控制。
- 叶子书签为 `type: bookmark`，必须有标题及安全链接；可带 `desc/comment/note/icon/iconImg/descUrl`。HTTP(S)、mailto、站点相对地址允许，脚本协议不允许。
- 无法直接管理的旧内容转换为只读 `type: legacy`，原始内容保存在 `extensions.legacyData`；可查看占位、导出原始节点、删除，不能伪装成普通书签编辑。未知字段保留，不执行旧源码或恢复旧密文。
- 仅顶层 `updatedAt` 是业务更新时间（Unix 毫秒）。节点不得出现同名时间字段。离线迁移候选使用 `0` 表示尚无可信的新库更新时间；首次有效 API 更新由服务端赋值，不用转换机器的时钟伪造云端更新时间。
- 有效增删改、排序、Private/隐藏变更才更新时间。服务端忽略客户端传入的更新时间，再比较规范化业务内容；无变化不写 KV、不生成备份、不改变 ETag/时间。草稿编辑、缓存写入和登录不更新时间。
- 单份文档上限 20 MiB，另有 64 KiB 请求包装余量；拒绝重复 ID、非法类型/链接、节点时间、非法 JSON 及过深数据。

| 层 | 外壳 | 业务内容 |
|---|---|---|
| KV 当前库 | `{document, etag}` | 同一 v2 document |
| API 确认响应 | `{ok, document, meta}` | 同一 v2 document |
| IndexedDB | `{schema:2, site, document, etag, savedAt}` | 同一已确认 document |
| 当前页内存 | `document` 草稿 + `baseline` + `dirty` + `etag` | 同一 document 的独立副本 |

`etag` 管版本冲突；`savedAt` 只表示本机缓存写入时间；二者都不等于业务 `updatedAt`。不再把 sections/cards/subCards 当作主页草稿的数据模型。旧转换器只用于一次性维护转换及旧缓存只读查看。

## 2. 扩展所用网络协议

所有请求仅发送到用户授权且已保存的站点 origin。浏览器携带 Cookie（`credentials: include`）；不读取/复制 Cookie，不新增长期 Token。

| 方法、路径 | 输入 | 输出 / 用途 |
|---|---|---|
| `POST /api/v2/auth/login` | `{username,password}` | 环境变量 USER/PASSWORD（缺失时公开默认凭据）验证，设置安全 Cookie |
| `GET /api/v2/auth/session` | 无 | 登录及服务状态；已登录时返回 usesDefaultPassword，不返回书签 |
| `POST /api/v2/auth/logout` | `{}` | 退出会话；本机书签不删除 |
| `GET /api/v2/bookmarks/meta` | 无 | `{ok,schemaVersion:2,updatedAt,etag}`；已登录时检查版本 |
| `GET /api/v2/bookmarks` | 无 | `{ok:true,document,meta:{etag,source:"kv",view:"admin"}}` |
| `PUT /api/v2/bookmarks` | `{document,baseEtag}` | 返回服务器确认的完整文档、版本及 `unchanged`；可能附 `warning` |

旧登录／账户接口返回 JSON 410，账户说明页无在线改密／恢复／注销全部设备操作。AUTH_SECRET 必填；PASSWORD 缺失时使用公开默认密码，生产必须配置独立 PASSWORD；旧 ADMIN_* 和 KV 自定义密码不用于 v2。新书签协议只提供管理员视图；未登录返回 401，不提供公开/匿名数据替代，不回退旧接口。管理员响应始终 `private, no-store`。

`baseEtag` 使用读取响应中的完整字符串（包括其引号），不是时间戳。新协议不再使用 `baseSource`、JavaScript content 或分类增量。正常同步先 check，再 meta，版本变化才下载全量；手动刷新/登录会获取全量。无轮询和离线写入队列。

关键状态：401 未登录；403 扩展来源/站点权限拒绝；409 版本冲突或新库未初始化（看 `code`）；413 过大；422 文档无效；428 缺少基准；429 写入过频；503 未启用/维护/无 KV/存储故障。结果未知可带 `outcomeUnknown:true`；不得直接重复提交。保存冲突不自动重试、不回退旧分类/全量覆盖协议。服务端全量 PUT 本身不是覆盖冲突的后备路径。

KV 是最终一致的存储。写前重读 ETag 只能发现已可见的变化，不提供原子 CAS、跨节点串行化或强一致。按单管理员、避免同时保存使用；服务端对同键最近写入作 1100ms 间隔检查，扩展串行写入至少间隔 1150ms，这也不是全局限流保证。

## 3. KV 切换时间与维护流程

**建议在本地回归、人工浏览器验收完成后，单独安排一次已授权的维护切换，而不是开发时在线双写。**

- 新当前键：`admin:bookmarks:v2:current`。
- 新自动备份前缀：`admin:bookmarks:v2:backup:`，有效保存前备份旧确认值，尽力保留最近 30 份；备份失败则不写当前值。备份清理失败单独提示，不将已成功的当前写入报为失败。
- 不覆盖原 `admin:data_js`、拆分类键或原数据源设置；也不根据旧键是否存在自动选择源。

### 准备工具（只读本地输入，无远程写入能力）

从**明确选定的数据源**导出管理员完整备份，先在设备本机整理成以下包装（不得把匿名响应/静态公开快照误认为完整库）：

```json
{"source":"kv","view":"admin","sections":[]}
```

`source` 是 `kv` 或 `static`。也可用 `content` 替代 `sections`，内容必须是可安全解析的旧 sections 数据字面量；禁止同时提供两者。不执行 JS，旧密文丢弃。

```powershell
# 默认只验证并输出计数及输入校验和，不输出标题、URL 或完整文档
npm run prepare:bookmarks-v2 -- D:\private-backups\selected-admin.json
# 指定仓库外、尚不存在的目录，产生 source-backup.json / candidate.json / report.json
npm run prepare:bookmarks-v2 -- D:\private-backups\selected-admin.json --output D:\private-backups\qiye-reviewed-candidate
```

工具不会读取生产、不自动上传、不覆盖已有输出、不把私有候选放进仓库。报告中的 opaque/legacy 内容需要人工离线检查，文件应由操作者通过本机访问控制保护；不宣称加密。

### 未来单独授权后才执行的顺序

1. 部署包含双模式开关的代码，确认当前仍为 legacy；保留可回退代码和完整、明确数据源的离线备份。
2. 服务端设置 `BOOKMARKS_MODE=maintenance`，停止旧书签 API 的读写；v2 登录仍可用，旧服务端配置说明接口已停用。用匿名和管理员请求确认写入口已冻结，等待在途写入结束后再导出最终数据。
3. 对最终导出本地转换、人工核对容器/书签数量、Private/隐藏、未知和特殊字段。已有新当前键时禁止直接重新初始化；必须另行核对，不盲目覆盖。
4. 在维护窗口由授权维护人员把核对后的 `candidate.json` 值写入新当前键，再读回比对；**本工具没有远程 apply 命令**。不要把 KV 内容或认证信息放入命令历史、终端输出或发布文件。
5. 服务端改为 `BOOKMARKS_MODE=v2`；构建同时使用 `SMARTTOOLS_BOOKMARKS_MODE=v2`。确认登录、新 API、扩展缓存同步、显式保存以及旧端点 410，再开放使用。
6. 原数据保留为冻结备份；不双写、不旧源兜底。v2 已产生新写入后，不能简单切回 legacy，否则会读到旧库；回退需要另行数据核对和恢复方案。旧键删除是后续独立任务。

## 4. 运行/构建模式

| BOOKMARKS_MODE | 旧书签接口 | 新书签接口 | 网站页面 |
|---|---|---|---|
| 未设置 / legacy | 保持原协议 | 已鉴权请求 503 | 原网站 |
| maintenance | 503 | 503 | 停用/维护说明 |
| v2 | 410 | 管理员 v2 | 扩展指引＋服务端配置说明 |

未知非空模式按维护处理。旧 `/api/change-password` 继续 404；`/api/account/*` 已返回 410。旧首页、config、data.js 和 SW 有精确路由守卫；新退休 SW 清理本项目 Cache Storage，说明页清理已知公开 localStorage 数据，不清理其他应用缓存。完全离线且从未收到新 SW 的设备不能被远程立即清除旧公开副本。

```powershell
# 仅本地构建，不发布
$env:SMARTTOOLS_BOOKMARKS_MODE='v2'
$env:SMARTTOOLS_INLINE_SNAPSHOT='0'
npm run build
npm run test:build
npm run test:v2
npm run test:extension
```

v2/maintenance 构建不抓在线快照，产物替换原首页、后台、data.js、SW；新账户/说明页共享资源带内容指纹。`bookmark-mode.json` 记录构建模式。未来发布前 `verify:deploy` 还要求 `SMARTTOOLS_CONFIRMED_SERVER_MODE` 与构建模式一致，这是维护人员确认值，不代替检查真实远端绑定。legacy 发布仍要求原公开快照校验。

## 5. 扩展缓存、安全和暂缓范围

IndexedDB 数据库名不变，版本升级到 2，确认文档进入 `documents` store；旧 `snapshots` 可只读转换显示，不自动上传、不把转换稿伪装成服务器确认值。成功获取新库时在同一事务写新缓存并删除该站点旧快照。损坏缓存明确报错，可联网恢复或独立清除；写入失败保留旧缓存。

每个主页独立持有草稿；新保存/原生右键收藏更新同一份确认缓存。缓存失败与云端失败分开。退出、断网、会话失效、权限撤销保留 Private 本机只读副本；服务器无法撤回已下载数据。清缓存、退出相互独立。普通网页、内容脚本和带 query/hash 的伪装扩展页面没有缓存/保存权限；只有精确 start.html 能请求 save，服务器仍重新鉴权。

文件夹面板支持逐层进入/面包屑返回；本机搜索带完整路径；整理菜单可显示隐藏容器。移动菜单支持容器变根分类，阻止自循环/移入后代；移动或取消 Private 时二次确认。原生右键递归列出容器，以稳定 ID 和有效 Private 状态定位；超过 200 个容器或平台限制时提供“主页手动添加”，不假装已保存。原生菜单/授权气泡/严格第三方 Cookie 策略须人工验收。

当前页、当前窗口、全部窗口采集逻辑与复制/导出保持原样，**不实施新版采集导入流程**。旧网站确认导入按钮暂时隐藏并禁用；原协议/权限代码保留，待后续版本另议。浏览器原生右键单条收藏使用新协议，不属于此次暂缓的批量采集改造。

## 主页 JSON 导入与导出

右上角管理员／账户菜单的“书签备份”中提供“导出 JSON”和“导入 JSON”，不新增扩展权限。

- **导出**：下载 `qiye-bookmarks-时间.json`，内容为当前站点最近确认的 `{schemaVersion:2, updatedAt, roots}` 文档；包括全部层级、隐藏项、Private 及保留字段，不包括当前页未保存修改、缓存外壳或凭据。存在有效 v2 缓存时，离线／退出后仍可导出；旧版只读缓存不提供此文档导出。导出前提示文件未加密，请妥善保管。
- **导入**：仅支持 `.json` 完整 v2 业务文档，最大 20 MiB。不接受 `sections`、JavaScript 源码、单节点导出或 `{document, etag}` 等存储/API 外壳；不执行文件中的代码。
- **校验**：检查 JSON 语法、schemaVersion、顶层更新时间、roots、节点类型及必填字段、全文档 ID 唯一性、最多 32 层、安全链接和已有模型规则；拒绝节点级 updatedAt。校验失败、读取失败或取消均保留现有草稿及缓存。
- **应用**：登录并加载可写云端版本后才能导入。校验通过会列出数量并确认**替换当前页全部书签与未保存修改，不合并**；空文档额外提示清空风险，Private/隐藏状态以文件为准。
- **保存**：导入仅形成本页草稿，不影响其他页面或右键菜单。保留本页当前 ETag 和基准 updatedAt，不采用文件时间伪造云端更新时间；点击“保存到云端”仍需鉴权和冲突检查，成功后才更新确认缓存。同内容导入无需保存。读取文件期间站点、数据或会话发生变化时取消导入。
- 导出的文件是独立副本，退出、清缓存或卸载扩展不会代为删除下载文件；需自行保管、删除。
