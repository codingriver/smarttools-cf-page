const unavailable = action => Object.assign(new Error(action === 'save' ? '扩展后台连接中断，保存结果未确认；草稿保留，请先核对云端，不要直接重复提交' : '扩展后台暂不可用，请检查连接'), { status: 0, code: 'BACKGROUND_UNAVAILABLE', outcomeUnknown: action === 'save' });
export async function client(action, configUrl, extra = {}) {
  let result;
  try { result = await chrome.runtime.sendMessage({ channel: 'qiye-client', action, configUrl, ...extra }); }
  catch {
    throw unavailable(action);
  }
  if (!result) throw unavailable(action);
  if (!result.ok) {
    const error = new Error(result?.error || '扩展后台暂不可用，请检查连接');
    Object.assign(error, { status: result.status, code: result.code, path: result?.path, outcomeUnknown: result?.outcomeUnknown }); throw error;
  }
  return result.value;
}
// Keep last verified identity separate from the ability to write. A network/permission failure is not logout.
export function applyClientError(state, error) {
  if (error.status === 401) { state.loggedIn = false; state.usesDefaultPassword = false; state.connectionIssue = ''; }
  else if (error.status === 0 || error.status === 403 || error.status >= 500 || error.outcomeUnknown || error.code === 'INVALID_RESPONSE') state.connectionIssue = error.message;
}
export function sessionLabel(state) {
  if (state.connectionIssue) return (state.loggedIn ? '已登录（上次验证）' : '会话待验证') + ' · 连接异常，暂时只读';
  return state.loggedIn ? '管理员会话 · ' + (state.source || '') : '未登录 · 本机缓存只读';
}
