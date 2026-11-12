const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const pingoneDiscovery = {
  issuer: 'https://pingone.example/as',
  authorization_endpoint: 'https://pingone.example/as/authorize',
  token_endpoint: 'https://pingone.example/as/token',
  userinfo_endpoint: 'https://pingone.example/as/userinfo',
  jwks_uri: 'https://pingone.example/as/jwks',
  end_session_endpoint: 'https://pingone.example/as/signoff'
};
const aicDiscovery = Object.fromEntries(Object.entries(pingoneDiscovery).map(([key, value]) => [key, value.replaceAll('pingone.example', 'aic.example')]));

function response() {
  return {
    status: null, headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; }
  };
}

function loadApp(overrides = {}, globals = {}) {
  const requests = [];
  const errors = [];
  const logs = [];
  let handler;
  const context = vm.createContext({
    require: name => name === 'http' ? {
      createServer(callback) { handler = callback; return { listen() {} }; }
    } : require(name),
    __dirname,
    process: { env: {
      DISCOVERY_URL: 'https://aic.example/discovery',
      AIC_REGISTER_AUTH_INDEX_TYPE: 'service',
      AIC_REGISTER_AUTH_INDEX_VALUE: 'aic-registration',
      MYCHART_PINGONE_DISCOVERY_URL: 'https://pingone.example/discovery',
      MYCHART_PINGONE_CLIENT_ID: 'pingone-demo',
      MYCHART_PINGONE_CLIENT_SECRET: 'synthetic secret:+&',
      MYCHART_PINGONE_SCOPE: 'openid email',
      ...overrides
    } },
    console: { log(...args) { logs.push(args); }, warn(...args) { errors.push(args); }, error(...args) { errors.push(args); } },
    URL, URLSearchParams, Buffer, AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === 'https://pingone.example/discovery') return { ok: true, json: async () => pingoneDiscovery };
      if (url === 'https://aic.example/discovery') return { ok: true, json: async () => aicDiscovery };
      throw new Error('Unexpected provider request');
    },
    ...globals
  });
  vm.runInContext(`${source}\nthis.api = {
    sessions, getClientConfig, buildTokenRequest, renderPostLoginPage,
    setVerifier(fn) { verifyIdToken = fn; }
  };`, context);
  return {
    api: context.api, context, requests, errors, logs,
    diagnostics() {
      return [...logs, ...errors].flat().filter(value => typeof value === 'string' && value.startsWith('{')).map(value => JSON.parse(value));
    },
    async request(url, req = {}) {
      const res = response();
      await handler(Object.assign(req, { url, headers: { host: 'localhost:3010', ...req.headers } }), res);
      return res;
    }
  };
}

test('MyChart pages isolate provider links and only AIC exposes recovery', async () => {
  const app = loadApp();
  for (const route of ['/mychart-pingone', '/mychart-pingone/']) {
    const res = await app.request(route);
    assert.equal(res.status, 200);
    assert.match(res.body, /href="\/mychart-pingone\/auth\/login">Sign in with PingOne and DaVinci/);
    assert.match(res.body, /href="\/mychart-pingone\/auth\/register">Register with PingOne and DaVinci/);
    assert.doesNotMatch(res.body, /auth\/recover|PingOne AIC|\{\{/);
  }
  const aic = await app.request('/mychart');
  assert.match(aic.body, /href="\/mychart\/auth\/login">Sign in with PingOne AIC/);
  assert.match(aic.body, /href="\/mychart\/auth\/recover"/);
  assert.equal((await app.request('/mychart-pingone/auth/recover')).status, 404);
  assert.equal((await app.request('/epiccarelink-pingone')).status, 404);
});

test('EpicCare Link uses prefixed actions while both route families select its AIC client', async () => {
  const app = loadApp();
  const page = await app.request('/epiccarelink');
  for (const flow of ['login', 'register', 'recover']) {
    assert.ok(page.body.includes(`href="/epiccarelink/auth/${flow}"`));
    for (const prefix of ['/epiccarelink', '']) {
      const res = await app.request(`${prefix}/auth/${flow}`);
      assert.equal(res.status, 302);
      const url = new URL(res.headers.Location);
      assert.equal(url.origin + url.pathname, aicDiscovery.authorization_endpoint);
      assert.equal(url.searchParams.get('client_id'), 'epiccarelink');
      assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3010/epiccarelink/auth/callback');
      const session = app.api.sessions.get(url.searchParams.get('state'));
      assert.equal(session.app, 'epiccarelink');
      assert.equal(session.flow, flow);
      assert.equal(session.nonce, url.searchParams.get('nonce'));
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(require('node:crypto').createHash('sha256').update(session.codeVerifier).digest('base64url'), url.searchParams.get('code_challenge'));
    }
  }
  assert.doesNotMatch(page.body, /href="\/auth\//);
  assert.equal((await app.request('/epiccarelink-pingone/auth/login')).status, 404);
});

test('EpicCare Link callback aliases exchange codes directly and preserve configured redirect URIs', async () => {
  for (const [startPrefix, callbackPrefix, redirectUri] of [
    ['/epiccarelink', '/epiccarelink', 'http://localhost:3010/epiccarelink/auth/callback'],
    ['', '/epiccarelink', 'http://localhost:3010/epiccarelink/auth/callback'],
    ['/epiccarelink', '', 'https://demo.example/auth/callback'],
    ['', '', 'https://demo.example/auth/callback']
  ]) {
    const app = loadApp(redirectUri.startsWith('https:') ? { REDIRECT_URI: redirectUri } : {});
    const redirect = await app.request(`${startPrefix}/auth/login`);
    const state = new URL(redirect.headers.Location).searchParams.get('state');
    assert.equal(new URL(redirect.headers.Location).searchParams.get('redirect_uri'), redirectUri);
    const session = app.api.sessions.get(state);
    let exchanges = 0;
    app.api.setVerifier(async (token, nonce, endpoints, audience) => {
      assert.equal(token, 'synthetic-id-token');
      assert.equal(nonce, session.nonce);
      assert.equal(endpoints.issuer, aicDiscovery.issuer);
      assert.equal(audience, 'epiccarelink');
      return { sub: 'synthetic-user' };
    });
    const discoveryFetch = app.context.fetch;
    app.context.fetch = async (url, options) => {
      if (url !== aicDiscovery.token_endpoint) return discoveryFetch(url, options);
      exchanges++;
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('redirect_uri'), redirectUri);
      assert.equal(body.get('code_verifier'), session.codeVerifier);
      assert.equal(body.get('client_id'), 'epiccarelink');
      return { ok: true, json: async () => ({ id_token: 'synthetic-id-token' }) };
    };
    const wrongApp = await app.request(`/mychart/auth/callback?state=${state}&code=synthetic-code`);
    assert.equal(wrongApp.status, 400);
    assert.equal(exchanges, 0);
    assert.equal(app.api.sessions.has(state), true);
    const callback = await app.request(`${callbackPrefix}/auth/callback?state=${state}&code=synthetic-code`);
    assert.equal(callback.status, 200);
    assert.equal(callback.headers.Location, undefined);
    assert.equal(exchanges, 1);
    assert.match(callback.body, /EpicCare Link/);
    assert.match(callback.body, /action="\/epiccarelink\/auth\/logout"/);
    for (const prefix of ['/epiccarelink', '']) {
      const replay = await app.request(`${prefix}/auth/callback?state=${state}&code=synthetic-code`);
      assert.equal(replay.status, 400);
      assert.match(replay.body, /href="\/epiccarelink">Back to login/);
      assert.match(replay.body, /href="\/epiccarelink\/auth\/register"/);
    }
    assert.equal(exchanges, 1);
  }
});

test('EpicCare Link logout aliases use its provider and prefixed callbacks reject MyChart state', async () => {
  const app = loadApp();
  for (const prefix of ['/epiccarelink', '']) {
    const req = Readable.from([Buffer.from('id_token_hint=synthetic-id-token')]);
    req.method = 'POST';
    const logout = await app.request(`${prefix}/auth/logout`, req);
    assert.equal(logout.status, 302);
    const url = new URL(logout.headers.Location);
    assert.equal(url.origin + url.pathname, aicDiscovery.end_session_endpoint);
    assert.equal(url.searchParams.get('client_id'), 'epiccarelink');
    assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'http://localhost:3010/');
  }
  for (const prefix of ['/mychart', '/mychart-pingone']) {
    const redirect = await app.request(`${prefix}/auth/login`);
    const state = new URL(redirect.headers.Location).searchParams.get('state');
    const rejected = await app.request(`/epiccarelink/auth/callback?state=${state}&code=synthetic-code`);
    assert.equal(rejected.status, 400);
    assert.equal(app.api.sessions.has(state), true);
    assert.match(rejected.body, /href="\/epiccarelink">Back to login/);
  }
  assert.equal(app.requests.some(request => request.url === aicDiscovery.token_endpoint), false);
});

test('login and registration use PingOne settings and PKCE without AIC routing parameters', async () => {
  const app = loadApp();
  for (const flow of ['login', 'register']) {
    const res = await app.request(`/mychart-pingone/auth/${flow}`);
    assert.equal(res.status, 302);
    const url = new URL(res.headers.Location);
    assert.equal(url.origin + url.pathname, pingoneDiscovery.authorization_endpoint);
    assert.equal(url.searchParams.get('flow'), flow);
    assert.equal(url.searchParams.get('client_id'), 'pingone-demo');
    assert.equal(url.searchParams.get('scope'), 'openid email');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3010/mychart-pingone/auth/callback');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const session = app.api.sessions.get(url.searchParams.get('state'));
    assert.equal(session.app, 'mychart-pingone');
    assert.equal(session.nonce, url.searchParams.get('nonce'));
    assert.equal(require('node:crypto').createHash('sha256').update(session.codeVerifier).digest('base64url'), url.searchParams.get('code_challenge'));
    for (const key of ['authIndexType', 'authIndexValue', 'claims', 'client_secret']) assert.equal(url.searchParams.has(key), false);
  }
  for (const route of ['/auth/register', '/mychart/auth/register']) {
    const res = await app.request(route);
    const url = new URL(res.headers.Location);
    assert.equal(url.origin + url.pathname, aicDiscovery.authorization_endpoint);
    assert.equal(url.searchParams.get('authIndexValue'), 'aic-registration');
    assert.ok(url.searchParams.has('claims'));
  }
});

test('callback exchanges with the selected provider and auth method, verifies before display, and rejects replay', async () => {
  for (const method of ['client_secret_basic', 'client_secret_post']) {
    const app = loadApp({ MYCHART_PINGONE_TOKEN_ENDPOINT_AUTH_METHOD: method });
    const redirect = await app.request('/mychart-pingone/auth/register');
    const state = new URL(redirect.headers.Location).searchParams.get('state');
    const session = app.api.sessions.get(state);
    let verified = false;
    app.api.setVerifier(async (token, nonce, endpoints, audience) => {
      assert.equal(token, 'synthetic-id-token');
      assert.equal(nonce, session.nonce);
      assert.equal(endpoints.issuer, pingoneDiscovery.issuer);
      assert.equal(endpoints.jwksUri, pingoneDiscovery.jwks_uri);
      assert.equal(audience, 'pingone-demo');
      verified = true;
      return { sub: 'synthetic-user' };
    });
    const discoveryFetch = app.context.fetch;
    app.context.fetch = async (url, options) => {
      if (url !== pingoneDiscovery.token_endpoint) return discoveryFetch(url, options);
      assert.equal(options.method, 'POST');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('redirect_uri'), 'http://localhost:3010/mychart-pingone/auth/callback');
      assert.equal(body.get('code_verifier'), session.codeVerifier);
      assert.equal(body.get('code'), 'synthetic-code');
      if (method === 'client_secret_basic') {
        assert.equal(Buffer.from(options.headers.Authorization.slice(6), 'base64').toString(), 'pingone-demo:synthetic+secret%3A%2B%26');
        assert.equal(body.has('client_id'), false);
        assert.equal(body.has('client_secret'), false);
      } else {
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(body.get('client_id'), 'pingone-demo');
        assert.equal(body.get('client_secret'), 'synthetic secret:+&');
      }
      return { ok: true, json: async () => ({ id_token: 'synthetic-id-token' }) };
    };
    const wrongProvider = await app.request(`/mychart/auth/callback?state=${state}&code=synthetic-code`);
    assert.equal(wrongProvider.status, 400);
    assert.equal(verified, false);
    assert.ok(app.api.sessions.has(state));
    const callback = `/mychart-pingone/auth/callback?state=${state}&code=synthetic-code`;
    const res = await app.request(callback);
    assert.equal(res.status, 200);
    assert.equal(verified, true);
    assert.match(res.body, /Authentication completed through PingOne and DaVinci/);
    assert.match(res.body, /action="\/mychart-pingone\/auth\/logout"/);
    assert.match(res.body, /Choose an initial password/);
    assert.equal((await app.request(callback)).status, 400);
    const login = app.api.renderPostLoginPage({ flow: 'login', app: 'mychart-pingone', tokenResponse: {}, idTokenClaims: {}, mappedClaims: {} });
    assert.match(login, /id="password-step"[^>]* hidden/);
  }
});

test('missing config or failed/incomplete discovery reports unavailable without falling back to AIC', async () => {
  for (const overrides of [
    { MYCHART_PINGONE_DISCOVERY_URL: '' },
    { MYCHART_PINGONE_DISCOVERY_URL: 'http://pingone.example/discovery' },
    { MYCHART_PINGONE_CLIENT_ID: '' },
    { MYCHART_PINGONE_CLIENT_SECRET: '' },
    { MYCHART_PINGONE_SCOPE: 'email' }
  ]) {
    const app = loadApp(overrides);
    assert.equal((await app.request('/mychart-pingone/auth/login')).status, 503);
    assert.equal(app.requests.length, 0);
    assert.equal(app.api.sessions.size, 0);
    assert.ok(app.errors.length);
    assert.equal((await app.request('/auth/login')).status, 302);
  }
  for (const metadata of [null, { ...pingoneDiscovery, jwks_uri: '' }]) {
    const app = loadApp();
    app.context.fetch = async () => ({ ok: metadata !== null, status: 503, json: async () => metadata });
    const res = await app.request('/mychart-pingone/auth/register');
    assert.equal(res.status, 503);
    assert.equal(res.headers.Location, undefined);
    assert.equal(app.api.sessions.size, 0);
    assert.match(res.body, /Back to login/);
  }
});

test('logout stays with PingOne and callback errors link back to its demo', async () => {
  const app = loadApp();
  const req = Readable.from([Buffer.from('id_token_hint=synthetic-id-token')]);
  req.method = 'POST';
  const res = await app.request('/mychart-pingone/auth/logout', req);
  assert.equal(res.status, 302);
  const url = new URL(res.headers.Location);
  assert.equal(url.origin + url.pathname, pingoneDiscovery.end_session_endpoint);
  assert.equal(url.searchParams.get('client_id'), 'pingone-demo');
  assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'http://localhost:3010/');
  const error = await app.request('/mychart-pingone/auth/callback?error=access_denied');
  assert.equal(error.status, 400);
  assert.match(error.body, /href="\/mychart-pingone">Back to login/);
  assert.match(error.body, /OIDC error failed/);
  app.context.fetch = async () => ({ ok: true, json: async () => ({ ...pingoneDiscovery, end_session_endpoint: undefined }) });
  const secondReq = Readable.from([Buffer.from('id_token_hint=synthetic-id-token')]);
  secondReq.method = 'POST';
  const unavailable = await app.request('/mychart-pingone/auth/logout', secondReq);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.Location, undefined);
});

test('all demo login pages put the primary sign-in first and secondary actions after it', async () => {
  const app = loadApp();
  for (const [route, actionsClass] of [['/epiccarelink', 'actions'], ['/mychart', 'login-card'], ['/mychart-pingone', 'login-card']]) {
    const res = await app.request(route);
    const actions = res.body.slice(res.body.indexOf(`class="${actionsClass}"`));
    const links = [...actions.matchAll(/<a class="([^"]+)" href="([^"]+)">([^<]+)<\/a>/g)].filter(link => /\/auth\/(login|register|recover)$/.test(link[2]));
    assert.match(links[0][2], /\/auth\/login$/);
    assert.match(links[0][3], /^Sign in with Ping/);
    assert.equal(links[0][1].includes('secondary'), false);
    for (const link of links.slice(1)) assert.ok(link[1].includes('secondary'));
  }
});

test('both MyChart providers return logout to the overview, including overridden deployment origins', async () => {
  for (const settings of [
    { MYCHART_REDIRECT_URI: 'https://demo.example/mychart/auth/callback' },
    { MYCHART_PINGONE_REDIRECT_URI: 'https://demo.example/mychart-pingone/auth/callback' }
  ]) {
    const app = loadApp(settings);
    const route = 'MYCHART_REDIRECT_URI' in settings ? '/mychart' : '/mychart-pingone';
    const req = Readable.from([Buffer.from('id_token_hint=synthetic-id-token')]);
    req.method = 'POST';
    const res = await app.request(`${route}/auth/logout`, req);
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.Location).searchParams.get('post_logout_redirect_uri'), 'https://demo.example/');
  }
});

test('provider callback errors correlate to authorization and are redacted before logging', async () => {
  const app = loadApp({ OIDC_DEBUG: 'true' });
  const redirect = await app.request('/mychart-pingone/auth/login');
  const state = new URL(redirect.headers.Location).searchParams.get('state');
  const session = app.api.sessions.get(state);
  const callback = await app.request(`/mychart-pingone/auth/callback?state=${state}&error=invalid_request&error_description=Verification%20failed`);
  assert.equal(callback.status, 400);
  const reference = redirect.headers['X-OIDC-Correlation-ID'];
  assert.equal(callback.headers['X-OIDC-Correlation-ID'], reference);
  assert.match(reference, /^[a-f0-9-]{36}$/);
  assert.ok(callback.body.includes(reference));
  assert.equal(app.api.sessions.has(state), false);
  const entries = app.diagnostics();
  assert.ok(entries.some(entry => entry.event === 'discovery.completed'));
  const received = entries.find(entry => entry.event === 'callback.received');
  assert.equal(received.hasCode, false);
  assert.equal(received.stateMatched, true);
  const failed = entries.find(entry => entry.event === 'callback.provider_error');
  assert.equal(failed.oauthError, 'invalid_request');
  assert.equal(failed.providerReason, 'verification_failed');
  assert.equal(failed.correlationId, reference);
  assert.equal(failed.flow, 'login');
  assert.equal(entries.some(entry => entry.event === 'token_exchange.started'), false);
  const unknown = await app.request('/mychart-pingone/auth/callback?state=private-state-marker&code=private-code-marker&error=private-error-marker&error_description=private-description-marker');
  assert.equal(unknown.status, 400);
  const unknownError = app.diagnostics().filter(entry => entry.event === 'callback.provider_error').at(-1);
  assert.equal(unknownError.oauthError, 'redacted');
  assert.equal(unknownError.providerReason, 'redacted');
  const output = JSON.stringify([...app.logs, ...app.errors]);
  for (const value of [state, session.nonce, session.codeVerifier, 'synthetic secret:+&', 'pingone-demo',
    'private-state-marker', 'private-code-marker', 'private-error-marker', 'private-description-marker']) {
    assert.equal(output.includes(value), false);
  }
});

test('diagnostics are opt-in but redacted provider failures are always logged', async () => {
  const app = loadApp();
  await app.request('/mychart-pingone/auth/login');
  assert.equal(app.diagnostics().length, 0);
  await app.request('/mychart-pingone/auth/callback?error=invalid_request&error_description=Verification%20failed');
  assert.deepEqual(app.diagnostics().map(entry => entry.event), ['callback.provider_error']);
});

test('diagnostics trace token, verification and UserInfo stages without logging payloads or exceptions', async () => {
  for (const outcome of ['success', 'token_error', 'validation_error', 'network_error']) {
    const app = loadApp({ OIDC_DEBUG: 'true' });
    const redirect = await app.request('/mychart-pingone/auth/login');
    const state = new URL(redirect.headers.Location).searchParams.get('state');
    const discoveryFetch = app.context.fetch;
    app.context.fetch = async (url, options) => {
      if (url === pingoneDiscovery.token_endpoint) {
        if (outcome === 'network_error') throw new Error('private-exception-marker');
        return {
          ok: outcome !== 'token_error', status: outcome === 'token_error' ? 400 : 200,
          json: async () => outcome === 'token_error'
            ? { error: 'invalid_grant', error_description: 'private-description-marker' }
            : { id_token: 'private-id-token-marker', access_token: 'private-access-token-marker' }
        };
      }
      if (url === pingoneDiscovery.userinfo_endpoint) return { ok: true, status: 200, json: async () => ({ email: 'private-profile-marker' }) };
      return discoveryFetch(url, options);
    };
    app.api.setVerifier(async () => {
      if (outcome === 'validation_error') throw Object.assign(new Error('private-validation-marker'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
      return { sub: 'private-subject-marker' };
    });
    const res = await app.request(`/mychart-pingone/auth/callback?state=${state}&code=private-code-marker`);
    const entries = app.diagnostics();
    assert.ok(entries.some(entry => entry.event === 'token_exchange.started'));
    assert.equal(res.status, outcome === 'success' ? 200 : outcome === 'network_error' ? 500 : 400);
    if (outcome === 'success') {
      for (const event of ['id_token_validation.completed', 'userinfo.completed', 'callback.completed']) {
        assert.ok(entries.some(entry => entry.event === event));
      }
    } else if (outcome === 'validation_error') {
      assert.equal(entries.find(entry => entry.event === 'id_token_validation.failed').validationCode, 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
    } else {
      const failed = entries.find(entry => entry.event === 'token_exchange.failed');
      assert.ok(failed.durationMs >= 0);
      if (outcome === 'token_error') assert.equal(failed.httpStatus, 400);
    }
    assert.ok(entries.every(entry => entry.correlationId === redirect.headers['X-OIDC-Correlation-ID']));
    const output = JSON.stringify([...app.logs, ...app.errors]);
    for (const value of ['private-', state, 'synthetic secret:+&', 'Authorization', pingoneDiscovery.token_endpoint]) {
      assert.equal(output.includes(value), false);
    }
  }
});

test('failed PingOne ID-token validation never displays the returned tokens', async () => {
  const app = loadApp();
  const redirect = await app.request('/mychart-pingone/auth/login');
  const state = new URL(redirect.headers.Location).searchParams.get('state');
  const discoveryFetch = app.context.fetch;
  app.context.fetch = async (url, options) => url === pingoneDiscovery.token_endpoint
    ? { ok: true, json: async () => ({ id_token: 'synthetic-invalid-token' }) }
    : discoveryFetch(url, options);
  app.api.setVerifier(async () => { throw new Error('Signature verification failed'); });
  const res = await app.request(`/mychart-pingone/auth/callback?state=${state}&code=synthetic-code`);
  assert.equal(res.status, 400);
  assert.match(res.body, /ID token validation failed/);
  assert.doesNotMatch(res.body, /synthetic-invalid-token|Your demo workspace is ready/);
});

test('malformed URLs return 400 without rejecting the handler or logging raw input', async () => {
  const app = loadApp();
  for (const [url, host] of [['/', '['], ['http://[private-url-marker', 'localhost:3010']]) {
    const res = await app.request(url, { headers: { host } });
    assert.equal(res.status, 400);
    assert.equal(res.body, 'Invalid request URL.');
    assert.ok(res.headers['X-OIDC-Correlation-ID']);
  }
  assert.equal(app.diagnostics().filter(entry => entry.event === 'request.invalid_url').length, 2);
  assert.equal(JSON.stringify([...app.logs, ...app.errors]).includes('private-url-marker'), false);
  assert.equal((await app.request('/health')).status, 200);
});

test('pending sessions remain valid before ten minutes and are rejected at expiration', async () => {
  let now = Date.now();
  class Clock extends Date {
    static now() { return now; }
  }
  const app = loadApp({}, { Date: Clock });
  const redirect = await app.request('/mychart-pingone/auth/login');
  const state = new URL(redirect.headers.Location).searchParams.get('state');
  now += 10 * 60 * 1000 - 1;
  await app.request('/mychart/auth/login');
  assert.equal(app.api.sessions.has(state), true);
  now += 1;
  const expired = await app.request(`/mychart-pingone/auth/callback?state=${state}&code=synthetic-code`);
  assert.equal(expired.status, 400);
  assert.match(expired.body, /Missing or expired state\/code/);
  assert.equal(app.api.sessions.has(state), false);
  assert.equal(app.api.sessions.size, 1);
  assert.equal(app.requests.some(request => request.url === pingoneDiscovery.token_endpoint), false);
});

test('pending sessions cap at one thousand and recover capacity by pruning expired attempts', async () => {
  const app = loadApp();
  for (let index = 0; index < 1000; index++) {
    app.api.sessions.set(`synthetic-state-${index}`, { createdAt: Date.now(), app: 'mychart' });
  }
  for (const route of ['/auth/login', '/mychart/auth/register', '/mychart-pingone/auth/login']) {
    const res = await app.request(route);
    assert.equal(res.status, 429);
    assert.equal(res.headers['Retry-After'], '60');
    assert.equal(res.headers.Location, undefined);
    assert.equal(app.api.sessions.size, 1000);
  }
  app.api.sessions.get('synthetic-state-0').createdAt -= 10 * 60 * 1000;
  const retry = await app.request('/mychart-pingone/auth/login');
  assert.equal(retry.status, 302);
  assert.equal(app.api.sessions.size, 1000);
  assert.equal(app.api.sessions.has('synthetic-state-0'), false);
  assert.equal(app.api.sessions.has('synthetic-state-1'), true);
});

test('provider deadlines abort stalled discovery, token exchange and optional UserInfo calls', async () => {
  for (const stage of ['aic_discovery', 'pingone_discovery', 'token', 'userinfo']) {
    const deadlines = [];
    const app = loadApp({ OIDC_DEBUG: 'true' }, {
      AbortSignal: {
        timeout(milliseconds) {
          deadlines.push(milliseconds);
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 5);
          return controller.signal;
        }
      }
    });
    const stall = options => new Promise((resolve, reject) => {
      assert.ok(options.signal);
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
    if (stage.endsWith('_discovery')) {
      app.context.fetch = async (url, options) => stall(options);
      const res = await app.request(stage === 'aic_discovery' ? '/mychart/auth/login' : '/mychart-pingone/auth/login');
      assert.equal(res.status, stage === 'aic_discovery' ? 302 : 503);
      assert.ok(app.diagnostics().some(entry => entry.event === 'discovery.failed'));
    } else {
      const redirect = await app.request('/mychart-pingone/auth/login');
      const state = new URL(redirect.headers.Location).searchParams.get('state');
      const discoveryFetch = app.context.fetch;
      app.context.fetch = async (url, options) => {
        if (url === pingoneDiscovery.token_endpoint) {
          if (stage === 'token') return stall(options);
          return { ok: true, status: 200, json: async () => ({ id_token: 'synthetic-id-token', access_token: 'synthetic-access-token' }) };
        }
        if (url === pingoneDiscovery.userinfo_endpoint) return stall(options);
        return discoveryFetch(url, options);
      };
      app.api.setVerifier(async () => ({ sub: 'synthetic-user' }));
      const res = await app.request(`/mychart-pingone/auth/callback?state=${state}&code=synthetic-code`);
      assert.equal(res.status, stage === 'token' ? 500 : 200);
      assert.ok(app.diagnostics().some(entry => entry.event === (stage === 'token' ? 'token_exchange.failed' : 'userinfo.failed')));
    }
    assert.ok(deadlines.length > 0);
    assert.ok(deadlines.every(milliseconds => milliseconds === 10000));
  }
});
