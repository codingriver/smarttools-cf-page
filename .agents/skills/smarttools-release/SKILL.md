---
name: smarttools-release
description: 构建 SmartTools、检查发布准备状态，或按明确请求更新现有 Cloudflare Pages 部署。用于本仓库的构建、发布校验、部署与上线任务；不用于创建远程资源或迁移到独立 Worker。
---

# SmartTools 构建与发布

所有命令在仓库根目录运行。先读根目录 `AGENTS.md`，再核对当前 `package.json`、`scripts/prepare-deploy.mjs` 和 `scripts/verify-deploy.mjs`；脚本发生变化时，以实际实现为准并报告与本文的差异，不绕过失败的检查。

## 按用户意图选择模式

| 用户意图 | 执行范围 | 不包含 |
| --- | --- | --- |
| 构建、打包 | 生成本地产物，报告快照状态 | 上传或修改远程资源 |
| 校验、准备发布 | 构建、发布检查及按影响范围选择的本地验收 | 实际部署 |
| 明确要求部署、上线、发布 | 核实目标、检查、部署、匿名上线检查 | 自动创建项目或修改基础设施 |

询问发布含义、分析流程、创建或修改本 Skill，都不是部署授权。意图不明确时只执行非部署部分并澄清。默认使用已有 Pages 项目 `smarttools`；静态文件与 Pages Functions 随 Pages 流程发布，不改用独立 Worker 的 `wrangler deploy`。

## 构建模式

1. 查看工作区差异，不回退、清理或提交用户现有修改。检查相关构建环境变量；不枚举或打印整个环境、密钥或私有数据。
2. 默认执行 `npm run build`，输出通常为 `dist/`。默认会从 `https://www.303066.xyz/api/data` 获取匿名公开快照，并可能下载公开图标；不要声称这是完全离线构建。
3. 仅本地验证且不需要线上快照时，可临时禁用快照。PowerShell 示例（保留并恢复原值）：

   ```powershell
   $previous = $env:SMARTTOOLS_INLINE_SNAPSHOT
   try {
     $env:SMARTTOOLS_INLINE_SNAPSHOT = '0'
     npm run build
     if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
   } finally {
     if ($null -eq $previous) {
       if (Test-Path Env:SMARTTOOLS_INLINE_SNAPSHOT) {
         Remove-Item Env:SMARTTOOLS_INLINE_SNAPSHOT
       }
     } else {
       $env:SMARTTOOLS_INLINE_SNAPSHOT = $previous
     }
   }
   ```

4. `SMARTTOOLS_OUTPUT_DIR` 改变输出目录，构建默认递归清理输出目录。运行前确认解析后的目标是仓库内专用生成物目录，而非源码、仓库根目录或目录联接指向的外部位置；不要把自定义源码目录当作输出目录。`SMARTTOOLS_OUTPUT_CLEAN=0` 会保留旧文件，不适合生产发布。
5. 快照请求失败时构建可能仅警告并成功退出。明确报告是否包含快照，不将构建成功等同于发布就绪。

## 发布准备与验收

- 生产发布使用干净的默认 `dist/`，不得沿用自定义输出目录、不清理模式、禁用快照或测试快照配置。发现环境覆盖时说明影响，按本次任务临时调整并恢复，不静默修改持久环境配置。
- `SMARTTOOLS_SNAPSHOT_URL` 默认指向上述公开接口。替代地址须确认是目标站点的匿名公开数据源；不得使用管理员响应、带凭据的地址、Cookie、Authorization 或测试 fixture。无法确认来源时停止发布，不把内容或敏感 URL 打入日志。
- 生产构建后执行 `npm run verify:deploy`。当前脚本只检查 `dist/index.html` 的内联运行时、快照、查看者信息标记及已知 fixture 字串；它不是完整的 Private 数据审计，不能证明任意快照安全。
- 修改公开发布文件时检查 `scripts/prepare-deploy.mjs` 白名单；`.agents/`、Agent 规则、蒸馏记录及测试产物不是公开资源，不加入白名单。不要为使用 Skill 新建另一套构建链或复制现有验收脚本。

按改动范围选择验收，不为纯 Skill/文档调整强制运行全部业务测试：

| 检查 | 条件及边界 |
| --- | --- |
| `npm run test:build` | 构建或发布内容变化；使用隔离的 `.wrangler/build-acceptance-*` fixture 输出，不代表生产 `dist/` 已验收。运行前避免继承禁用快照配置。 |
| `npm run test:api` / `npm run test:security` | API、认证或数据边界变化；先启动隔离本地 Pages，使用测试凭据和本地 KV。 |
| `npm run test:browser` | 页面交互变化；需本地 Pages 和可用 Chrome，可通过 `CHROME_PATH` 指定。包含缓存验收。 |
| `npm run test:cache` | HTML、缓存头、SW 或内联资源变化；先构建，测试自带本地服务，覆盖普通 F5、旧缓存升级及桌面/手机层级。 |
| `npm test` | 需要完整本地回归且本地 Pages、测试绑定与 Chrome 已准备好。 |

API 验收会登录并写入 fixture，`SMARTTOOLS_BASE_URL` 默认是 `http://127.0.0.1:8788`；运行前确认未指向生产或共享数据环境。不要将本地验收命令改向线上。参考根目录规则启动本地 Pages，不连接远程生产 KV；只停止本次任务启动的服务。

`npm run test:online` 会下载远程 Pages 配置、读取管理员凭据并登录，不是匿名冒烟检查。仅在用户明确要求包含管理员登录的在线验收时运行，且不得输出配置或凭据。`npm run test:performance` 仅在任务明确涉及线上性能时运行。

## 实际发布模式

1. 确认用户明确要求实际发布。说明目标、分支和现有工作区改动范围；已有清晰授权时无需重复确认，但不把“准备发布”视为授权。当前发布脚本使用 `--commit-dirty=true`，未提交修改也可能上线；发现无关或来源不明的改动会进入产物时，先澄清，不擅自提交、stash 或 reset。
2. 若环境提供 `wrangler` / `cloudflare` Skills，按需读取其平台指导；不修改这些全局 Skills。核实当前 CLI 帮助/官方文档，不套用独立 Worker 的初始化或部署流程。
3. 使用只读的 `npx wrangler@latest whoami`、`npx wrangler@latest pages project list` 核实账户及已有目标项目；无需为此下载含管理员变量的完整配置。账户不确定、项目不存在或无访问权限时停止并报告，不自动创建替代项目。检查生产分支是否为脚本指定的 `main`，不能仅因传了 `--branch main` 就认定是生产部署。
4. 完成上述发布准备。默认目标和生产分支匹配时执行 `npm run deploy`。当前命令依次执行构建、`verify:deploy`，再执行 `pages deploy dist --project-name smarttools --branch main --commit-dirty=true --skip-caching`。任一步失败都停止；不跳过校验或对结果未知的上传盲目重试。
5. 如果用户明确指定预览、其他项目或分支，不运行硬编码默认生产目标的 `npm run deploy`。按指定范围核实已有目标，再依据当前 Pages CLI 用法执行等价的构建、校验与定向部署；不为单次部署擅改项目默认值。目标缺失仍需单独授权创建。
6. 创建 Pages/Worker、KV 命名空间、修改 secrets、绑定、域名、生产分支或迁移平台是独立任务，不属于默认发布。失败时不自动回滚、删除部署或修改基础设施。
7. 发布后使用部署结果中的地址做无 Cookie/Authorization 的匿名检查：页面可访问、首页缓存头符合项目重验证策略、公开 API 可访问且不返回管理员视图。不要打印数据正文。若本次修复缓存/层级问题，重点检查已有 SW/暖缓存下的 F5，而非只看强刷。报告实际覆盖与未覆盖项，不把匿名检查称为管理员或全面安全验收。

## 交付说明

报告模式、实际执行命令与结果、输出目录及快照状态、未执行的检查和原因。只有实际部署成功才报告上线，提供目标项目、生产/预览环境及部署结果；上传成功但验证失败时分别说明，不宣称发布完全通过。

`npm run deploy` 会重新构建，快照和下载资源可能变化。因此不能声称此前测试的产物与最终上传内容逐字节一致；需要不可变产物发布时，应另行调整并验证发布流程，而非绕过本项目脚本。
