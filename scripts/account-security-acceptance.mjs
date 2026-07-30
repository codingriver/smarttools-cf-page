import { onRequestGet as checkStatus } from '../functions/api/check.js';
import { onRequestPost as login } from '../functions/api/login.js';
import { onRequestPost as changePassword } from '../functions/api/account/change-password.js';
import {
  onRequestGet as getSecurity,
  onRequestPost as updateSecurity
} from '../functions/api/account/security.js';
import {
  onRequestGet as getRecovery,
  onRequestPost as recoverPassword
} from '../functions/api/account/recovery.js';
import {
  ADMIN_CREDENTIALS_KEY,
  ADMIN_RECOVERY_USED_PREFIX,
  PASSWORD_ALGORITHM,
  PASSWORD_ITERATIONS
} from '../functions/_shared/account-security.js';

const username = 'testadmin';
const environmentPassword = 'EnvironmentPass2026!';
const customPassword = 'CustomPassword2026!';
const recoveredPassword = 'RecoveredPassword2026!';
const recoveryToken = 'one-time-recovery-token-2026-abcdefghijk';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class MemoryKV {
  constructor() {
    this.values = new Map();
    this.metadata = new Map();
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async getWithMetadata(key) {
    return {
      value: await this.get(key),
      metadata: this.metadata.get(key) || null
    };
  }

  async put(key, value, options = {}) {
    this.values.set(key, String(value));
    if (options.metadata) this.metadata.set(key, options.metadata);
  }

  async delete(key) {
    this.values.delete(key);
    this.metadata.delete(key);
  }
}

const kv = new MemoryKV();
const env = {
  FAV_KV: kv,
  ADMIN_USER: username,
  ADMIN_PASS: environmentPassword,
  AUTH_SECRET: '0123456789abcdef0123456789abcdef'
};

async function invoke(handler, path, {
  method = 'GET',
  body,
  cookie,
  ip = '203.0.113.10',
  bindings = env
} = {}) {
  const headers = new Headers({ 'CF-Connecting-IP': ip });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  const request = new Request(`https://smarttools.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const response = await handler({ request, env: bindings });
  const payload = await response.json();
  return { response, payload };
}

function cookieFrom(result) {
  return (result.response.headers.get('set-cookie') || '').split(';')[0];
}

async function loginWith(password, ip) {
  return invoke(login, '/api/login', {
    method: 'POST',
    body: { username, password },
    ip
  });
}

const initialStatus = await invoke(checkStatus, '/api/check');
assert(initialStatus.response.status === 200, 'initial status request failed');
assert(initialStatus.payload.recoveryEnabled === false, 'recovery must be disabled by default');

const recoveryDisabled = await invoke(getRecovery, '/api/account/recovery');
assert(recoveryDisabled.payload.recoveryEnabled === false, 'recovery endpoint exposed an inactive flow');

const initialLogin = await loginWith(environmentPassword, '203.0.113.11');
assert(initialLogin.response.status === 200, 'environment password login failed');
const initialCookie = cookieFrom(initialLogin);
assert(initialCookie.startsWith('auth='), 'initial auth cookie missing');

const secondLogin = await loginWith(environmentPassword, '203.0.113.12');
assert(secondLogin.response.status === 200, 'second device login failed');
const secondCookie = cookieFrom(secondLogin);

const initialSecurity = await invoke(getSecurity, '/api/account/security', { cookie: initialCookie });
assert(initialSecurity.response.status === 200, 'authenticated security status failed');
assert(initialSecurity.payload.passwordSource === 'environment', 'initial password source is not environment');

const weakPassword = await invoke(changePassword, '/api/account/change-password', {
  method: 'POST',
  cookie: initialCookie,
  body: { currentPassword: environmentPassword, newPassword: 'short' }
});
assert(weakPassword.response.status === 400, 'weak password was accepted');

const wrongCurrentPassword = await invoke(changePassword, '/api/account/change-password', {
  method: 'POST',
  cookie: initialCookie,
  body: { currentPassword: 'WrongCurrentPassword!', newPassword: customPassword }
});
assert(wrongCurrentPassword.response.status === 401, 'wrong current password was accepted');

const changed = await invoke(changePassword, '/api/account/change-password', {
  method: 'POST',
  cookie: initialCookie,
  body: { currentPassword: environmentPassword, newPassword: customPassword }
});
assert(changed.response.status === 200 && changed.payload.sessionsRevoked, 'password change failed');
assert((changed.response.headers.get('set-cookie') || '').includes('Max-Age=0'), 'password change did not clear current cookie');

const storedCredentialsText = await kv.get(ADMIN_CREDENTIALS_KEY);
const storedCredentials = JSON.parse(storedCredentialsText);
assert(storedCredentials.algorithm === PASSWORD_ALGORITHM, 'credential algorithm is invalid');
assert(storedCredentials.iterations === PASSWORD_ITERATIONS, 'PBKDF2 iteration count is invalid');
assert(storedCredentials.sessionVersion === 1, 'password change did not increment session version');
assert(storedCredentials.salt && storedCredentials.hash, 'salted password hash is incomplete');
assert(!storedCredentialsText.includes(environmentPassword), 'environment password leaked into KV');
assert(!storedCredentialsText.includes(customPassword), 'custom password leaked into KV');
assert(!Object.hasOwn(storedCredentials, 'password'), 'plaintext password field exists in KV');

const staleSecondSession = await invoke(getSecurity, '/api/account/security', { cookie: secondCookie });
assert(staleSecondSession.response.status === 401, 'old device session survived password change');

const oldPasswordLogin = await loginWith(environmentPassword, '203.0.113.13');
assert(oldPasswordLogin.response.status === 401, 'environment password still works after custom password was set');

const customLogin = await loginWith(customPassword, '203.0.113.14');
assert(customLogin.response.status === 200, 'custom KV password login failed');
const customCookie = cookieFrom(customLogin);

const customSecurity = await invoke(getSecurity, '/api/account/security', { cookie: customCookie });
assert(customSecurity.payload.passwordSource === 'custom', 'custom password source was not reported');

const revoked = await invoke(updateSecurity, '/api/account/security', {
  method: 'POST',
  cookie: customCookie,
  body: { action: 'revoke-sessions' }
});
assert(revoked.response.status === 200 && revoked.payload.sessionsRevoked, 'session revocation failed');
const revokedSession = await invoke(getSecurity, '/api/account/security', { cookie: customCookie });
assert(revokedSession.response.status === 401, 'revoked session remains valid');

const recoveryBindings = {
  ...env,
  PASSWORD_RECOVERY_ENABLED: 'true',
  PASSWORD_RECOVERY_TOKEN: recoveryToken
};
const recoveryStatus = await invoke(getRecovery, '/api/account/recovery', { bindings: recoveryBindings });
assert(recoveryStatus.payload.recoveryEnabled === true, 'configured recovery flow is not enabled');

const sessionBeforeRecovery = await loginWith(customPassword, '203.0.113.15');
assert(sessionBeforeRecovery.response.status === 200, 'pre-recovery login failed');
const preRecoveryCookie = cookieFrom(sessionBeforeRecovery);

const wrongRecovery = await invoke(recoverPassword, '/api/account/recovery', {
  method: 'POST',
  bindings: recoveryBindings,
  ip: '203.0.113.16',
  body: { recoveryToken: 'wrong-recovery-token-00000000000000', newPassword: recoveredPassword }
});
assert(wrongRecovery.response.status === 401, 'invalid recovery token was accepted');

const recovered = await invoke(recoverPassword, '/api/account/recovery', {
  method: 'POST',
  bindings: recoveryBindings,
  ip: '203.0.113.17',
  body: { recoveryToken, newPassword: recoveredPassword }
});
assert(recovered.response.status === 200 && recovered.payload.recoveryTokenConsumed, 'password recovery failed');
assert((recovered.response.headers.get('set-cookie') || '').includes('Max-Age=0'), 'recovery did not clear current cookie');

const recoveryKeys = [...kv.values.keys()].filter(key => key.startsWith(ADMIN_RECOVERY_USED_PREFIX));
assert(recoveryKeys.length === 1, 'recovery token fingerprint was not recorded exactly once');
assert(!recoveryKeys[0].includes(recoveryToken), 'raw recovery token leaked into its KV key');
assert(!(await kv.get(recoveryKeys[0])).includes(recoveryToken), 'raw recovery token leaked into its KV value');

const staleRecoverySession = await invoke(getSecurity, '/api/account/security', { cookie: preRecoveryCookie });
assert(staleRecoverySession.response.status === 401, 'old session survived password recovery');

const repeatedRecovery = await invoke(recoverPassword, '/api/account/recovery', {
  method: 'POST',
  bindings: recoveryBindings,
  ip: '203.0.113.18',
  body: { recoveryToken, newPassword: 'AnotherSecurePassword2026!' }
});
assert(repeatedRecovery.response.status === 409, 'consumed recovery token was reusable');

const customAfterRecovery = await loginWith(customPassword, '203.0.113.19');
assert(customAfterRecovery.response.status === 401, 'pre-recovery custom password remains valid');
const recoveredLogin = await loginWith(recoveredPassword, '203.0.113.20');
assert(recoveredLogin.response.status === 200, 'recovered password login failed');

const finalCredentialText = await kv.get(ADMIN_CREDENTIALS_KEY);
assert(!finalCredentialText.includes(recoveryToken), 'recovery token leaked into credential record');
assert(!finalCredentialText.includes(recoveredPassword), 'recovered password leaked into credential record');

console.log(JSON.stringify({
  ok: true,
  passwordHashing: `${PASSWORD_ALGORITHM}/${PASSWORD_ITERATIONS}`,
  environmentFallbackBeforeCustomPassword: true,
  oldPasswordInvalidated: true,
  oldSessionsInvalidated: true,
  allSessionsRevoked: true,
  oneTimeRecovery: true,
  plaintextSecretsInCredentials: false
}, null, 2));
