// Dismiss the account disclosure without intercepting internal form/button events.
export function bindCacheMenu(menu) {
  menu.ownerDocument.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.ownerDocument.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      const restoreFocus = menu.contains(menu.ownerDocument.activeElement);
      menu.open = false;
      if (restoreFocus) menu.querySelector('summary').focus();
    }
  });
  menu.addEventListener('toggle', () => {
    if (!menu.open) {
      for (const child of menu.querySelectorAll('details')) child.open = false;
      menu.querySelector('#password').value = '';
    }
  });
}

export function renderAccountMenu(menu, { loggedIn, busy, connectionIssue }) {
  const find = selector => menu.querySelector(selector);
  find('#checkConnection').hidden = !connectionIssue;
  find('#checkConnection').disabled = !!busy;
  find('#accountAvatar').hidden = !loggedIn;
  find('#accountLabel').textContent = loggedIn ? '管理员' : '登录';
  find('#accountTitle').textContent = loggedIn ? '账户信息' : '登录 SmartTools';
  find('#accountTrigger').setAttribute('aria-label', loggedIn ? '管理员账户与缓存设置' : '登录与站点设置');
  find('#logout').hidden = !loggedIn;
  find('#loginForm').hidden = loggedIn;
  for (const control of menu.querySelectorAll('.connection input, .connection button, #logout')) control.disabled = !!busy;
}
