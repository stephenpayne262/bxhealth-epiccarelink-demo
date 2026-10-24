const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3010);
const CONFIG = {
  clientId: process.env.CLIENT_ID || 'epiccarelink',
  clientSecret: process.env.CLIENT_SECRET || 'epicsecret',
  redirectUri: process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`,
  scope: process.env.SCOPE || 'openid profile email',
  discoveryUrl: process.env.DISCOVERY_URL || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/realms/root/realms/alpha/.well-known/openid-configuration',
  authorizationEndpoint: process.env.AUTHORIZATION_ENDPOINT || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/alpha/authorize',
  tokenEndpoint: process.env.TOKEN_ENDPOINT || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/alpha/access_token',
  userInfoEndpoint: process.env.USERINFO_ENDPOINT || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/alpha/userinfo',
  issuer: process.env.ISSUER || 'https://openam-scp-1025.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha',
  registerAuthIndexType: process.env.AIC_REGISTER_AUTH_INDEX_TYPE || '',
  registerAuthIndexValue: process.env.AIC_REGISTER_AUTH_INDEX_VALUE || ''
};

function getClientConfig(flow) {
  return {
    clientId: CONFIG.clientId,
    clientSecret: CONFIG.clientSecret
  };
}

const sessions = new Map();
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256base64url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

async function loadDiscovery() {
  if (!CONFIG.discoveryUrl) return null;
  try {
    const response = await fetch(CONFIG.discoveryUrl);
    if (!response.ok) throw new Error(`Discovery failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('Discovery not loaded, using configured endpoints:', error.message);
    return null;
  }
}

async function resolveEndpoints() {
  const discovery = await loadDiscovery();
  return {
    authorizationEndpoint: discovery?.authorization_endpoint || CONFIG.authorizationEndpoint,
    tokenEndpoint: discovery?.token_endpoint || CONFIG.tokenEndpoint,
    userInfoEndpoint: discovery?.userinfo_endpoint || CONFIG.userInfoEndpoint,
    issuer: discovery?.issuer || CONFIG.issuer,
    claimsSupported: discovery?.claims_supported || []
  };
}

function decodeJwt(token) {
  if (!token || token.split('.').length < 2) return null;
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function extractMappedClaims(claims = {}, userInfo = {}) {
  const merged = { ...claims, ...userInfo };
  const address = merged.address || {};
  return {
    'Email Address': merged.email || '',
    'Date of Birth': merged.birthdate || '',
    'Zip Code': merged.postal_code || address.postal_code || '',
    'Full Name': merged.name || [merged.given_name, merged.family_name].filter(Boolean).join(' '),
    'Home Phone': merged.phone_number || ''
  };
}

function buildClaimsParameter() {
  return JSON.stringify({
    id_token: {
      given_name: { essential: false },
      family_name: { essential: false },
      birthdate: { essential: false },
      name: { essential: false },
      email: { essential: false },
      postal_code: { essential: false },
      phone_number: { essential: false }
    },
    userinfo: {
      given_name: { essential: false },
      family_name: { essential: false },
      birthdate: { essential: false },
      name: { essential: false },
      email: { essential: false },
      postal_code: { essential: false },
      phone_number: { essential: false }
    }
  });
}

async function exchangeCode(code, tokenEndpoint) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CONFIG.redirectUri,
    client_id: getClientConfig('register').clientId,
    code_verifier: ''
  });
  return body;
}

function renderResultPage({ flow, endpoints, tokenResponse, idTokenClaims, userInfo, mappedClaims, error }) {
  const payload = tokenResponse ? JSON.stringify(tokenResponse, null, 2) : '';
  const idPayload = idTokenClaims ? JSON.stringify(idTokenClaims, null, 2) : '';
  const uiPayload = userInfo ? JSON.stringify(userInfo, null, 2) : '';
  const mappedRows = Object.entries(mappedClaims || {}).map(([k, v]) => `
    <tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v || '—')}</td></tr>`).join('');
  const client = getClientConfig(flow === 'register' ? 'register' : 'login');
  const allClaimRows = Object.entries(idTokenClaims || {}).map(([k, v]) => {
    const rendered = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    return `\n    <tr><th>${escapeHtml(k)}</th><td>${escapeHtml(rendered || '—')}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>BX-Health OIDC Result</title>
<style>
:root {
  --bg: #0d1b2a; --panel: #ffffff; --panel-soft: #f4f7fb; --text: #132238; --muted: #5d6b80;
  --brand: #0b4c8c; --brand-dark: #082f57; --line: #d9e0ea; --good: #e9f7ef; --good-text: #19502b;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, Arial, sans-serif; background: linear-gradient(180deg, #eef4fa 0%, #f8fbfe 100%); color: var(--text); }
.shell { max-width: 1200px; margin: 0 auto; padding: 28px; }
.hero { background: linear-gradient(135deg, var(--brand-dark), var(--brand)); color: #fff; border-radius: 18px; padding: 28px; margin-bottom: 22px; }
.hero h1 { margin: 0 0 8px; font-size: 30px; }
.hero p { margin: 0; max-width: 70ch; line-height: 1.6; }
.grid { display: grid; grid-template-columns: 1.05fr 1fr; gap: 20px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(19,34,56,0.08); }
.card h2 { margin: 0 0 12px; font-size: 18px; }
.card h3 { margin: 16px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.meta { display: grid; gap: 10px; }
.meta-row { display: grid; grid-template-columns: 170px 1fr; gap: 14px; font-size: 14px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.meta-row:last-child { border-bottom: none; }
.meta-row strong { color: var(--brand-dark); }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
.table th { width: 170px; color: var(--brand-dark); }
pre { margin: 0; padding: 14px; background: var(--panel-soft); border: 1px solid var(--line); border-radius: 12px; overflow: auto; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.badge { display: inline-flex; align-items: center; gap: 8px; background: var(--good); color: var(--good-text); border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: 700; }
.actions { margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap; }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 16px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 14px; }
.btn-primary { background: var(--brand); color: #fff; }
.btn-secondary { background: #fff; color: var(--brand); border: 1px solid var(--line); }
.error { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; border-radius: 12px; padding: 14px; }
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .meta-row { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="shell">
  <section class="hero">
    <div class="badge">OIDC ${escapeHtml(flow || 'login')} complete</div>
    <h1>BX-Health token viewer</h1>
    <p>This page shows the raw token response, decoded ID token claims, optional UserInfo claims, and the business mappings you requested for the EpicCare-style demo app.</p>
  </section>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <section class="grid">
    <article class="card">
      <h2>Mapped claims</h2>
      <table class="table">${mappedRows}</table>
      <h3>Flow details</h3>
      <div class="meta">
        <div class="meta-row"><strong>Flow</strong><span>${escapeHtml(flow || 'login')}</span></div>
        <div class="meta-row"><strong>Client ID</strong><span>${escapeHtml(client.clientId)}</span></div>
        <div class="meta-row"><strong>Redirect URI</strong><span>${escapeHtml(CONFIG.redirectUri)}</span></div>
        <div class="meta-row"><strong>Authorization endpoint</strong><span>${escapeHtml(endpoints.authorizationEndpoint)}</span></div>
        <div class="meta-row"><strong>Token endpoint</strong><span>${escapeHtml(endpoints.tokenEndpoint)}</span></div>
        <div class="meta-row"><strong>UserInfo endpoint</strong><span>${escapeHtml(endpoints.userInfoEndpoint)}</span></div>
        <div class="meta-row"><strong>Issuer</strong><span>${escapeHtml(endpoints.issuer)}</span></div>
      </div>
      <div class="actions">
        <a class="btn btn-primary" href="/">Back to login</a>
        <a class="btn btn-secondary" href="/auth/register">Run registration again</a>
      </div>
    </article>
    <article class="card">
      <h2>OIDC payloads</h2>
      <h3>Token response</h3>
      <pre>${escapeHtml(payload || 'No token response captured.')}</pre>
      <h3>Decoded ID token</h3>
      <pre>${escapeHtml(idPayload || 'No ID token claims decoded.')}</pre>
      <h3>All ID token claims</h3>
      <table class="table">${allClaimRows || '<tr><th>Claims</th><td>No ID token claims decoded.</td></tr>'}</table>
      <h3>UserInfo response</h3>
      <pre>${escapeHtml(uiPayload || 'No UserInfo payload returned.')}</pre>
    </article>
  </section>
</div>
</body>
</html>`;
}

async function handleAuthorize(req, res, flow) {
  const endpoints = await resolveEndpoints();
  const state = randomString(24);
  const nonce = randomString(24);
  const codeVerifier = randomString(48);
  const codeChallenge = sha256base64url(codeVerifier);
  sessions.set(state, { codeVerifier, nonce, flow, createdAt: Date.now() });

  const client = getClientConfig(flow);
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', CONFIG.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('flow', flow);
  url.searchParams.set('scope', CONFIG.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('claims', buildClaimsParameter());

  const authIndexType = flow === 'register' ? CONFIG.registerAuthIndexType : '';
  const authIndexValue = flow === 'register' ? CONFIG.registerAuthIndexValue : '';
  if (authIndexType && authIndexValue) {
    url.searchParams.set('authIndexType', authIndexType);
    url.searchParams.set('authIndexValue', authIndexValue);
  }

  res.writeHead(302, { Location: url.toString() });
  res.end();
}

async function handleCallback(req, res, requestUrl) {
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');
  const endpoints = await resolveEndpoints();

  if (error) {
    return send(res, 400, renderResultPage({
      flow: 'error',
      endpoints,
      mappedClaims: {},
      error: `${error}${errorDescription ? `: ${errorDescription}` : ''}`
    }));
  }

  const session = state ? sessions.get(state) : null;
  if (!session || !code) {
    return send(res, 400, renderResultPage({
      flow: 'error',
      endpoints,
      mappedClaims: {},
      error: 'Missing or expired state/code. Start the flow again from the login page.'
    }));
  }

  sessions.delete(state);

  const client = getClientConfig(session.flow);
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CONFIG.redirectUri,
    client_id: client.clientId,
    code_verifier: session.codeVerifier
  });

  let tokenResponse;
  try {
    tokenBody.set('client_secret', client.clientSecret);

    const tokenRes = await fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenBody.toString()
    });
    tokenResponse = await tokenRes.json();
    if (!tokenRes.ok) {
      return send(res, 400, renderResultPage({
        flow: session.flow,
        endpoints,
        tokenResponse,
        mappedClaims: {},
        error: `Token exchange failed with ${tokenRes.status}.`
      }));
    }
  } catch (err) {
    return send(res, 500, renderResultPage({
      flow: session.flow,
      endpoints,
      mappedClaims: {},
      error: `Token exchange error: ${err.message}`
    }));
  }

  const idTokenClaims = decodeJwt(tokenResponse.id_token);
  let userInfo = null;
  if (tokenResponse.access_token && endpoints.userInfoEndpoint) {
    try {
      const uiRes = await fetch(endpoints.userInfoEndpoint, {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
      });
      if (uiRes.ok) userInfo = await uiRes.json();
    } catch (err) {
      console.warn('UserInfo call failed:', err.message);
    }
  }

  const mappedClaims = extractMappedClaims(idTokenClaims, userInfo);
  return send(res, 200, renderResultPage({
    flow: session.flow,
    endpoints,
    tokenResponse,
    idTokenClaims,
    userInfo,
    mappedClaims
  }));
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/') return send(res, 200, indexHtml);
  if (requestUrl.pathname === '/auth/login') return handleAuthorize(req, res, 'login');
  if (requestUrl.pathname === '/auth/register') return handleAuthorize(req, res, 'register');
  if (requestUrl.pathname === '/auth/callback') return handleCallback(req, res, requestUrl);
  if (requestUrl.pathname === '/health') return send(res, 200, JSON.stringify({ status: 'ok' }), 'application/json');

  send(res, 404, '<h1>Not found</h1>');
});

server.listen(PORT, () => {
  console.log(`BX-Health Epic OIDC demo listening on http://localhost:${PORT}`);
});
