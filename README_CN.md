# 栖页 · 书签桌面

本仓库仅包含**独立安装的 Chrome 扩展**与 **Cloudflare Pages v2 API**；不再提供网站首页、网站后台或旧接口。扩展在 `extensions/qiye/`，可从主页编辑、拖拽与显式保存书签；账户菜单手动导入／导出 v2 JSON（包括 Private，文件不加密）；弹窗可复制及导出打开的标签，右键菜单可收藏。没有 Chrome 原生书签同步或新标签页接管。

## 安装和配置

1. 将 Pages Functions 发布到现有 Pages 项目，绑定 `FAV_KV`。设置独立 Secret `AUTH_SECRET`（至少 16 字符），并**务必设置独立的 `PASSWORD` Secret**；可用 `USER` 覆盖默认用户名。缺失时会使用公开的 `admin`／`codingriver2026`，不能视为安全配置；旧 `ADMIN_*` 与 KV 自定义密码均不会生效。修改变量并重新部署后重新登录，没有在线改密／恢复入口。
2. 若 KV 当前文档键 `admin:bookmarks:v2:current` 尚不存在，可离线生成初始化候选：`npm run prepare:bookmarks-v2 -- --empty --output <仓库外新目录>`，或 `--input <纯 v2 书签 JSON> --output <仓库外新目录>`。输出 `{document, etag}`，**不会上传**；另行确认目标 KV 为空后单独安装候选。不要对已有 KV 用此工具覆盖；日常导入走扩展草稿保存。
3. Chrome “加载已解压的扩展程序”选择 `extensions/qiye/`。在高级设置填写 Pages **origin** 并授予该站点访问权限；旧保存的 `/config.html` 地址自动归一化为相同 origin。登录后访问并保存。本次统一命名不迁移旧扩展数据，见下方说明。

## v2 API

- `POST /api/v2/auth/login`：`{username,password}` 登录；`GET /api/v2/auth/session`：状态；`POST /api/v2/auth/logout`：退出。
- `GET /api/v2/bookmarks`：返回完整管理员文档及 `meta.etag`；`PUT /api/v2/bookmarks`：`{baseEtag,document}`，检查版本后全量保存；`GET /api/v2/bookmarks/meta`：ETag 和顶层更新时间。
- 账户响应与管理员书签均 `private, no-store`。Cookie 为 HttpOnly、Secure、SameSite=Strict；无授权返回 401，未绑定 KV／未初始化返回明确错误，版本冲突返回 409。有效保存只写**当前文档键一次**，无变化不写且不更新 `updatedAt`。KV 最终一致，ETag 不是跨节点事务锁。
- **没有服务端备份、历史版本或云端恢复**；历史备份 KV 键不再访问但本次不删除。手动导出 JSON 并自行安全保管；导入只修改本页草稿，确认保存时仍需鉴权和版本校验。
- 其他路径（旧 API、旧网站、未知资源与尾斜杠）统一 JSON 404；允许路径使用错误方法返回 405。

## 缓存与旧站点

扩展自身 IndexedDB 按 origin 长期保存已确认 v2 文档，含 Private，未加密；退出、会话过期、离线或权限撤销后仍可只读查看。账户菜单单独清除本机缓存；草稿只在页面内存。浏览器数据清理或卸载可能使缓存丢失。Private 是服务端访问控制，不是端到端加密。旧 `sections`、v1 缓存不再读取或迁移；`legacy` 特殊节点仍在 v2 文档中只读保留。删除旧网站文件**不能远程擦除已访问浏览器中的缓存／SW 副本**，如需清理请在浏览器中手动清除旧站点数据。

## 本地验收／发布

API、构建和扩展验收脚本及合成 fixture 统一放在 `tests/`；构建、部署检查和离线初始化工具留在 `scripts/`。

`npm run build && npm run verify:deploy && npm test`。构建只生成 `dist/_routes.json`，扩展不复制到 Pages。`npm run deploy` 仅用于明确授权的线上部署；本次开发不自动执行。参见上方 v2 API 清单及[扩展说明](extensions/qiye/README.md)。

## qiye 命名与升级边界

- npm 包、默认 Pages 项目均为 `qiye`，扩展目录为 `extensions/qiye/`，发布 Skill 为 `.agents/skills/qiye-release/`。构建自定义输出使用 `QIYE_OUTPUT_DIR`／`QIYE_OUTPUT_CLEAN`。
- 默认服务端地址为 `https://qiye.pages.dev`，只是本地配置默认值；本次未核实其归属、创建远端项目或部署。使用前务必在高级设置确认或改为自己控制的实际 origin；已有已保存地址不会被自动重写。
- IndexedDB 改为 `qiye-confirmed-cache`，消息通道、菜单 ID、认证签名用途标识也统一使用 qiye。本次不兼容、不读取、不迁移、不删除旧名称数据库；清除缓存只作用于当前名称数据库，旧数据库如需删除须手动清理。
- 从新目录加载未打包扩展可能改变扩展身份，需要重新配置地址、授权及登录。旧签名会话失效；可从服务器重新加载已保存数据，必要时手动导入自己的 v2 JSON 备份。KV 绑定、当前文档键、v2 数据模型均未改变。
- 代码改名不等于远端仓库／Pages 项目或活动工作区目录改名；部署前必须核实目标项目、生产分支、Secret 和 KV 绑定。本次未修改线上资源。
