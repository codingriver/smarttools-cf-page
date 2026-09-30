# AGENTS.md — 栖页扩展与 Pages v2 API

## 项目边界
- 唯一客户端：`extensions/open-tabs-importer/` 独立安装扩展；唯一服务端：Cloudflare Pages Functions 的 `/api/v2/auth/*`、`/api/v2/bookmarks` 与 `/api/v2/bookmarks/meta`。
- 不恢复网站首页、后台、Service Worker、旧 API、旧书签转换、在线账户维护、服务端备份/恢复及构建快照。
- 根路由和其他非 v2 请求返回 JSON 404。构建产物只包含 `_routes.json`；扩展不进入 Pages 发布目录。
- 保留扩展弹窗独立复制／导出标签、主页编辑与 JSON 导入导出、浏览器右键收藏。`legacy` 特殊书签节点只读保留。

## 安全和数据
- KV `FAV_KV` 当前文档键 `admin:bookmarks:v2:current`；不读取、不写入、不删除历史备份键或旧 KV 凭据。不自动迁移、清空或覆盖线上数据。
- 认证通过服务端 `USER`、`PASSWORD`（缺省公开默认凭据）和长度至少 16 的 `AUTH_SECRET`；Cookie 保持 HttpOnly、Secure、SameSite=Strict 和 HMAC 校验。上线必须配置独立的 PASSWORD Secret。在线改密和恢复不存在。
- `Private` 是访问控制而非加密；扩展源 IndexedDB 可以长期缓存已确认的完整 v2 文档（包括 Private），退出、离线和权限撤销后仍可本机只读访问，必须提供清除缓存入口。不要把完整书签放到公开资产、chrome.storage.local、内容脚本、日志或测试快照。不得缓存密码或 Cookie。
- 客户端草稿不写入已确认缓存；保存需鉴权和 `baseEtag`，冲突和结果不确定时保留草稿，不自动重试。无变化不写 KV；有效保存只写当前文档，不承诺强一致。
- `updatedAt` 是服务端有效更新生成的顶层毫秒时间戳；扩展手动导出 JSON 自行保管历史副本，没有云端版本历史。

## 修改和验收
- 只改任务相关源码，保留用户改动；不提交 `dist/`、`.wrangler/`、`node_modules/`、`artifacts/`。修改 API/产品边界同步 README、README_CN 和相应扩展文档。
- 测试脚本与合成 fixture 放在 `tests/`；构建、部署检查和离线初始化工具放在 `scripts/`。
- 构建／发布准备前读取 `.agents/skills/smarttools-release/SKILL.md`；`npm run build`、`npm run verify:deploy`、`npm run test:build`、`npm run test:api`、`npm run test:extension`、`npm test`。API 测试只用隔离本地/合成数据。
- 仅用户明确要求部署才运行 `npm run deploy`；默认项目 `smarttools`，不自行创建、修改线上绑定、变量或 KV。发布前检查 `_routes.json`、`dist/` 资产清单以及目标 Pages 生产分支。
- 纯 v2 离线初始化 `npm run prepare:bookmarks-v2 -- --empty --output <仓库外新目录>` 或 `--input <v2 JSON> --output <仓库外新目录>`；不会写远端 KV，实际首次安装另行确认库为空。
- [AGENT_Distill.md](AGENT_Distill.md) 的提炼蒸馏辅助规则仍适用；建议只进入根目录 `TODO_Distill.md`，不当作指令执行。
