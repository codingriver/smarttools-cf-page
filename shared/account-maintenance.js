const $ = id => document.getElementById(id);
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok || !value.ok) throw new Error(value.error || '请求失败'); return value;
}
async function refresh() {
  const state = await api('check'); $('login').hidden = state.loggedIn; $('security').hidden = !state.loggedIn; $('recovery').hidden = !state.recoveryEnabled;
  if (state.loggedIn) { const info = await api('account/security'); $('source').textContent = '密码来源：' + info.passwordSource; }
}
async function run(task) { for (const button of document.querySelectorAll('button')) button.disabled = true; try { await task(); await refresh(); } catch (error) { $('status').textContent = error.message; } finally { for (const button of document.querySelectorAll('button')) button.disabled = false; } }
for (const [id, route] of [['login','login'],['password','account/change-password'],['recover','account/recovery']]) $(id).addEventListener('submit', event => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.target)); event.target.reset(); run(async () => { await api(route, body); $('status').textContent = id === 'login' ? '已登录' : '已更新密码，请重新登录。若使用恢复，请删除服务器临时恢复变量。'; }); });
$('revoke').addEventListener('click', () => { if (confirm('注销全部设备？')) run(async () => { await api('account/security', { action:'revoke-sessions' }); $('status').textContent = '已注销全部设备'; }); });
$('logout').addEventListener('click', () => run(async () => { await api('logout', {}); $('status').textContent = '已退出'; }));
run(async () => {});
