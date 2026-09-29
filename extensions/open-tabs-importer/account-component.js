// Static extension-owned markup only; never interpolate server data here.
export function mountAccount(host) {
  host.innerHTML = `<details id="accountMenu" class="account-menu">
      <summary id="accountTrigger" aria-label="登录与站点设置"><span id="accountAvatar" class="account-avatar" aria-hidden="true" hidden>管</span><span id="accountLabel">登录</span><span aria-hidden="true" class="account-chevron">⌄</span></summary>
      <div class="account-panel" aria-label="账户与缓存设置">
        <div class="account-heading"><div><strong id="accountTitle">登录栖页</strong><div id="session" class="muted">尚未连接</div></div><button id="logout" type="button" hidden>退出登录</button></div>
        <section class="connection" aria-label="站点与登录">
          <form id="loginForm"><label for="username">管理员账号</label><input id="username" autocomplete="username" placeholder="用户名" required><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" placeholder="管理员密码" required><button class="primary">登录</button></form>
          <details id="siteSettings" class="site-settings"><summary>高级设置</summary><div class="site-settings-panel">
            <p class="muted">仅首次连接、更换站点或权限失效时需要配置，日常登录无需重复授权。点击保存地址时自动申请站点访问权限，通过后才保存；拒绝或取消则不保存。</p>
          <form id="siteForm"><label for="siteUrl">服务端地址</label><input id="siteUrl" type="url" required placeholder="https://your-site/config.html"><button>保存地址</button></form>
          </div></details>
        </section>
        <button id="checkConnection" type="button" hidden>检查连接与云端（保留草稿）</button>
        <section class="bookmark-transfer" aria-label="书签 JSON 备份">
          <strong>书签备份</strong>
          <div class="cache-actions"><button id="exportBookmarks" type="button" disabled>导出 JSON</button><button id="importBookmarks" type="button" disabled>导入 JSON</button></div>
          <p id="transferHint">导出已确认数据（含 Private，未加密），不含草稿。导入需登录并加载可写版本，只替换本页草稿，不立即保存。</p>
          <input id="bookmarkFile" type="file" accept=".json,application/json" aria-label="选择书签 JSON 文件" hidden>
        </section>
        <section class="cache-status" aria-label="本机缓存">
          <span id="cacheInfo" role="status" aria-live="polite"></span>
          <details class="cache-menu"><summary>缓存管理</summary><div class="cache-panel">
            <p>完整数据（包括 Private）长期保存在本机，未加密。退出登录不会删除本机缓存，离线或未登录仍可查看。共用设备请退出登录并清除缓存；仅清除缓存不会退出服务器会话。</p>
            <div class="cache-actions"><button id="clearCache" type="button">清除当前站点缓存</button><button id="clearAllCache" type="button">清除全部站点缓存</button></div>
          </div></details>
        </section>
      </div>
    </details>`;
  return host.querySelector("#accountMenu");
}
