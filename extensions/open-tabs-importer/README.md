# 栖页 · 书签桌面（Chrome 扩展）

从此目录“加载已解压的扩展程序”。点击扩展打开 `start.html`；支持多层文件夹、Private、隐藏项、搜索、拖动整理、右键收藏和显式草稿保存。扩展弹窗单独提供标签复制和 HTML／JSON 文件导出；不发送到旧网站后台，不读取 Chrome 自带收藏夹。

高级设置输入 Pages 服务端 origin（例如 `https://your-site.example`），保存时申请该站点权限。升级前的 `/config.html` 地址会归一化为同一 origin，保留授权、v2 IndexedDB 数据库和界面偏好。登录走 `/api/v2/auth/login`，会话 `/api/v2/auth/session`，退出 `/api/v2/auth/logout`；完整文档 GET/PUT `/api/v2/bookmarks`，版本查询 GET `/api/v2/bookmarks/meta`。Cookie 浏览器管理，不保存密码或令牌。服务端缺省密码是公开信息，必须配置独立 PASSWORD；修改密码在服务端环境更新后重新部署，没有在线改密入口。

书签编辑只影响本页草稿；保存前验证会话、权限和 ETag，冲突／网络失败保留草稿，结果不确定不自动重试。账户菜单手动导出已确认 v2 JSON（含 Private，未加密），或严格校验 v2 JSON 导入本页草稿；导入不会直接覆盖云端。**没有云端备份或历史恢复**；请自行安全保管手动导出副本。

扩展源 IndexedDB 长期保存按 origin 隔离的已确认文档，Private 未加密；退出、离线、权限撤销后仍能本机只读查看。清缓存与退出登录是两项独立操作。旧 v1 `sections` 快照不再读取或自动转换，清除缓存会清理旧站点记录；v2 文档中的 `legacy` 节点仍只读保留并可导出。旧网页、旧 API 和服务端备份功能已删除；旧浏览器站点数据如需清除请手动操作。

权限：`tabs`（按用户操作复制/导出标签）、`storage`（地址和界面偏好）、`contextMenus`（右键收藏）；站点权限按需申请。无 `scripting`、`cookies`、`bookmarks`、`history` 权限，无内容脚本。服务端部署与离线初始化参见根目录 README_CN.md。
