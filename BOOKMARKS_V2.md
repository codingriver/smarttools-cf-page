# v2 书签协议

唯一当前文档 KV 键：`admin:bookmarks:v2:current`，内容为 `{ "document": { "schemaVersion": 2, "updatedAt": 0, "roots": [] }, "etag": "\"随机版本\"" }`。顶层 `updatedAt` 是 Unix 毫秒；`roots` 为容器数组，容器 `{id,type:"folder",title,isPrivate,visible,children}` 递归包含容器、书签 `{id,type:"bookmark",title,url}` 或不支持的只读 `legacy` 节点。私有状态沿祖先继承。服务端校验完整文档；扩展缓存和草稿共用业务文档格式（缓存外壳额外有 `site`、`etag`、`savedAt`）。

认证协议 `POST /api/v2/auth/login`、`GET /api/v2/auth/session`、`POST /api/v2/auth/logout`；书签协议 `GET/PUT /api/v2/bookmarks`、`GET /api/v2/bookmarks/meta`。PUT 请求 `{baseEtag,document}`；冲突返回 409。有效写入由服务器更新 `updatedAt` 并生成新 ETag，无变化不写入；写入结果不确定返回 `outcomeUnknown`，客户端不自动重试。KV 非强一致；无云端备份或恢复，旧历史键不读取/删除。

旧接口及网站地址统一 JSON 404；错误方法 405。首次初始化通过仓库外离线生成的 `{document,etag}` 候选手动安装，不自动访问 KV。扩展账户菜单手动导出 v2 JSON 供个人保管，导入后为草稿并需显式保存。
