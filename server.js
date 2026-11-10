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
  jwksUri: process.env.JWKS_URI || '',
  endSessionEndpoint: process.env.END_SESSION_ENDPOINT || '',
  postLogoutRedirectUri: process.env.POST_LOGOUT_REDIRECT_URI || `${new URL(process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`).origin}/`,
  authorizationEndpoint: process.env.AUTHORIZATION_ENDPOINT || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/alpha/authorize',
  tokenEndpoint: process.env.TOKEN_ENDPOINT || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/alpha/access_token',
  userInfoEndpoint: process.env.USERINFO_ENDPOINT || 'https://openam-scp-1025.forgeblocks.com/am/oauth2/alpha/userinfo',
  issuer: process.env.ISSUER || 'https://openam-scp-1025.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha',
  registerAuthIndexType: process.env.AIC_REGISTER_AUTH_INDEX_TYPE || '',
  registerAuthIndexValue: process.env.AIC_REGISTER_AUTH_INDEX_VALUE || '',
  recoverAuthIndexType: process.env.AIC_RECOVER_AUTH_INDEX_TYPE || '',
  recoverAuthIndexValue: process.env.AIC_RECOVER_AUTH_INDEX_VALUE || ''
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
    jwksUri: discovery?.jwks_uri || CONFIG.jwksUri || null,
    endSessionEndpoint: discovery?.end_session_endpoint || CONFIG.endSessionEndpoint || null,
    issuer: discovery?.issuer || CONFIG.issuer,
    claimsSupported: discovery?.claims_supported || []
  };
}

const jwksCache = new Map();

async function verifyIdToken(token, expectedNonce, endpoints, clientId) {
  if (!token || !endpoints.jwksUri) {
    throw new Error('ID token or JWKS URI is missing');
  }

  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const jwksUrl = new URL(endpoints.jwksUri);
  let jwks = jwksCache.get(jwksUrl.href);
  if (!jwks) {
    jwks = createRemoteJWKSet(jwksUrl);
    jwksCache.set(jwksUrl.href, jwks);
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer: endpoints.issuer,
    audience: clientId,
    algorithms: ['RS256', 'PS256', 'ES256'],
    requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
    maxTokenAge: '10m',
    clockTolerance: 5
  });

  if (payload.nonce !== expectedNonce) {
    throw new Error('ID token nonce mismatch');
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) {
    throw new Error('ID token authorized party mismatch');
  }

  return payload;
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

function serializeForInlineScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

function renderPostLoginPage({ flow, tokenResponse, idTokenClaims, userInfo, mappedClaims }) {
  const demoData = serializeForInlineScript({ flow, tokenResponse, idTokenClaims, userInfo, mappedClaims });
  const needsPasswordStep = flow === 'register' || flow === 'recover';
  const passwordStepEyebrow = flow === 'recover' ? 'EpicCare Link | Account recovery' : 'EpicCare Link | Initial account setup';
  const passwordStepTitle = flow === 'recover' ? 'Reset your EpicCare Link Password' : 'Choose an initial password';
  const passwordStepIntro = flow === 'recover'
    ? 'Your provider identity is verified. Set a new password for this mock EpicCare Link experience.'
    : 'Your provider identity is verified. Set a password for this mock EpicCare Link experience.';
  const passwordStepAction = flow === 'recover' ? 'Reset EpicCare Link password' : 'Continue to EpicCare Link';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>EpicCare Link | BX-Health Demo</title>
<style>
:root {
  --ink: #17324d;
  --muted: #65788b;
  --line: #dce5ec;
  --paper: #ffffff;
  --canvas: #f2f6f8;
  --blue: #17618c;
  --blue-dark: #103d61;
  --blue-soft: #e9f2f7;
  --green: #247149;
  --green-soft: #e8f4ed;
  --red: #a52b3a;
  --shadow: 0 16px 40px rgba(24, 52, 77, 0.09);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; background: var(--canvas); color: var(--ink); font-family: Inter, Arial, sans-serif; }
button, input { font: inherit; }
.topbar { min-height: 68px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px clamp(18px, 5vw, 72px); background: var(--paper); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; font-weight: 700; }
.brand img { width: 38px; height: 38px; object-fit: contain; }
.brand-name { display: grid; gap: 2px; }
.brand-name small { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.brand-name strong { font-size: 15px; }
.topbar-actions { display: flex; align-items: center; gap: 14px; }
.demo-label { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.top-link { color: var(--blue); font-size: 13px; font-weight: 700; text-decoration: none; }
.logout-form { display: inline-flex; margin: 0; }
.logout-button { padding: 0; border: 0; background: none; cursor: pointer; }
.top-link:hover { text-decoration: underline; }
.setup-wrap { width: min(100% - 32px, 760px); margin: 34px auto 56px; }
.setup-banner { position: relative; min-height: 108px; display: grid; place-items: center; overflow: hidden; border: 1px solid #dbe5eb; border-radius: 14px; background-color: #f9fbfc; background-image: radial-gradient(circle at 20px 22px, rgba(23, 97, 140, 0.07) 1px, transparent 2px), radial-gradient(circle at 52px 46px, rgba(23, 97, 140, 0.05) 1px, transparent 2px); background-size: 70px 64px; }
.lock-mark { position: relative; width: 46px; height: 36px; margin-top: 18px; border-radius: 9px; background: #f2b528; box-shadow: 0 8px 16px rgba(147, 108, 17, 0.2); }
.lock-mark::before { content: ""; position: absolute; left: 12px; top: -20px; width: 20px; height: 24px; border: 5px solid #d4dee6; border-bottom: 0; border-radius: 15px 15px 0 0; }
.lock-mark::after { content: ""; position: absolute; left: 21px; top: 12px; width: 4px; height: 11px; border-radius: 3px; background: var(--blue-dark); }
.verified-banner { display: flex; align-items: center; gap: 9px; margin: 22px 0 24px; padding: 12px 14px; border: 1px solid #cce4d4; border-radius: 7px; background: var(--green-soft); color: var(--green); font-size: 13px; font-weight: 700; }
.check-mark { width: 18px; height: 18px; display: grid; place-items: center; flex: 0 0 18px; border-radius: 50%; background: var(--green); color: #fff; font-size: 12px; }
.setup-content { width: min(100%, 480px); margin: 0 auto; padding: 0 8px; }
.eyebrow { margin: 0 0 9px; color: var(--blue); font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
h1 { margin: 0 0 9px; color: var(--ink); font-size: 27px; line-height: 1.18; }
.intro { margin: 0 0 19px; color: var(--muted); font-size: 14px; line-height: 1.6; }
.identity-line { margin: -5px 0 20px; padding: 10px 12px; border-left: 3px solid #8bb6ce; background: #edf4f7; color: #3d5b70; font-size: 13px; overflow-wrap: anywhere; }
.field { margin: 0 0 15px; }
.field label { display: block; margin-bottom: 6px; color: var(--ink); font-size: 13px; font-weight: 700; }
.field input { width: 100%; height: 44px; padding: 0 12px; border: 1px solid #bdcbd5; border-radius: 6px; background: #fff; color: var(--ink); font-size: 14px; }
.field input:focus { border-color: var(--blue); outline: 3px solid rgba(23, 97, 140, 0.13); }
.field-hint { margin: 6px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.form-error { min-height: 20px; margin: 4px 0 7px; color: var(--red); font-size: 12px; }
.primary-action { width: 100%; min-height: 44px; border: 0; border-radius: 5px; background: var(--blue); color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
.primary-action:hover { background: var(--blue-dark); }
.primary-action:focus-visible, .copy-button:focus-visible, .top-link:focus-visible { outline: 3px solid #78aeca; outline-offset: 2px; }
.fine-note { margin: 16px 0 0; color: #758696; font-size: 11px; line-height: 1.55; }
.fine-note strong { color: #526a7d; }
.demo-footer { margin-top: 28px; padding-top: 13px; border-top: 1px solid var(--line); color: #8392a0; font-size: 11px; text-align: center; }
.dashboard-wrap { width: min(100% - 32px, 1160px); margin: 30px auto 60px; }
.welcome-panel { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 24px; padding: 26px 30px; border-radius: 12px; background: var(--blue-dark); color: #fff; }
.welcome-panel .eyebrow { color: #a9d0e2; }
.welcome-panel h1 { color: #fff; font-size: 30px; }
.welcome-panel p { max-width: 64ch; margin: 8px 0 0; color: #e3eef4; font-size: 14px; line-height: 1.6; }
.section { margin-top: 22px; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.section-heading h2 { margin: 0; font-size: 18px; }
.section-heading p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.profile-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.profile-item, .token-card, .claims-panel { min-width: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: var(--shadow); }
.profile-item { padding: 14px; }
.profile-item dt { margin-bottom: 7px; color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
.profile-item dd { margin: 0; color: var(--ink); font-size: 14px; overflow-wrap: anywhere; white-space: pre-wrap; }
.token-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.token-card { padding: 15px; }
.token-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.token-head h3 { margin: 0; font-size: 14px; }
.copy-button { min-height: 34px; padding: 0 11px; border: 1px solid #a9c2d1; border-radius: 5px; background: #f5fafc; color: var(--blue-dark); font-size: 12px; font-weight: 700; cursor: pointer; }
.copy-button:hover { background: var(--blue-soft); }
.copy-status { min-height: 17px; margin: 6px 0 0; color: var(--green); font-size: 11px; }
.token-details { margin-top: 7px; }
.token-details summary { color: var(--blue); font-size: 12px; cursor: pointer; }
.token-raw { max-height: 180px; margin: 8px 0 0; padding: 10px; overflow: auto; border-radius: 5px; background: #f2f6f8; color: #244258; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; white-space: pre-wrap; }
.claims-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.claims-panel { padding: 18px; }
.claims-panel h3 { margin: 0 0 12px; font-size: 15px; }
.claim-list { display: grid; grid-template-columns: minmax(100px, 0.7fr) minmax(0, 1.3fr); gap: 0 14px; margin: 0; }
.claim-list dt, .claim-list dd { padding: 9px 0; border-bottom: 1px solid #edf1f4; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
.claim-list dt { color: var(--muted); font-weight: 700; }
.claim-list dd { margin: 0; color: var(--ink); }
.empty-state { color: var(--muted); font-size: 13px; }
@media (max-width: 740px) {
  .topbar { padding: 12px 16px; }
  .demo-label { display: none; }
  .setup-wrap { margin-top: 20px; }
  .welcome-panel { align-items: flex-start; flex-direction: column; padding: 22px; }
  .profile-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .token-grid, .claims-grid { grid-template-columns: 1fr; }
}
@media (max-width: 440px) {
  .brand img { width: 32px; height: 32px; }
  .brand-name strong { font-size: 13px; }
  .top-link { font-size: 12px; }
  h1 { font-size: 23px; }
  .profile-grid { grid-template-columns: 1fr; }
  .claim-list { grid-template-columns: 1fr; }
  .claim-list dd { padding-top: 0; }
}
</style>
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/" aria-label="BX-Health demo home">
      <img src="https://demo.bxindustry.org/health/logo.svg" alt="" />
      <span class="brand-name"><small>BX-Health demo</small><strong>EpicCare Link</strong></span>
    </a>
    <div class="topbar-actions">
      <span class="demo-label">Epic Toolbox integration</span>
      <form class="logout-form" action="/auth/logout" method="post">
        <input type="hidden" name="id_token_hint" value="${escapeHtml(tokenResponse.id_token || '')}" />
        <button class="top-link logout-button" type="submit">Logout</button>
      </form>
    </div>
  </header>
  <main>
    <section class="setup-wrap" id="password-step" aria-labelledby="setup-title"${needsPasswordStep ? '' : ' hidden'}>
      <div class="setup-banner" aria-hidden="true"><span class="lock-mark"></span></div>
      <div class="verified-banner"><span class="check-mark" aria-hidden="true">&#10003;</span><span>Your identity was successfully verified with Ping.</span></div>
      <div class="setup-content">
        <p class="eyebrow">${passwordStepEyebrow}</p>
        <h1 id="setup-title">${passwordStepTitle}</h1>
        <p class="intro">${passwordStepIntro}</p>
        <p class="identity-line" id="provider-identity">Verified external provider</p>
        <form id="password-form" novalidate>
          <div class="field">
            <label for="initial-password">Password</label>
            <input id="initial-password" type="password" minlength="4" maxlength="256" autocomplete="new-password" required />
            <p class="field-hint">Use between 4 and 256 characters.</p>
          </div>
          <div class="field">
            <label for="confirm-password">Confirm password</label>
            <input id="confirm-password" type="password" minlength="4" maxlength="256" autocomplete="new-password" required />
          </div>
          <p class="form-error" id="password-error" role="alert" aria-live="polite"></p>
          <button class="primary-action" type="submit">${passwordStepAction}</button>
        </form>
        <p class="fine-note"><strong>Epic Toolbox demo:</strong> Identity proofing and orchestration do not set or manage an Epic password. This mock checks that the entries match, then discards them without sending or saving either value.</p>
        <p class="demo-footer">Demonstration only | No Epic account changes are made</p>
      </div>
    </section>

    <section class="dashboard-wrap" id="provider-dashboard" aria-labelledby="dashboard-title" tabindex="-1"${needsPasswordStep ? ' hidden' : ''}>
      <header class="welcome-panel">
        <div>
          <p class="eyebrow">EpicCare Link | Provider workspace</p>
          <h1 id="dashboard-title">Your demo workspace is ready</h1>
          <p>Identity verification completed through Ping. The profile and OIDC data below are provided for this customer demonstration.</p>
        </div>
        <form class="logout-form" action="/auth/logout" method="post">
          <input type="hidden" name="id_token_hint" value="${escapeHtml(tokenResponse.id_token || '')}" />
          <button class="top-link logout-button" type="submit" style="color:#fff">Logout</button>
        </form>
      </header>
      <section class="section" aria-labelledby="profile-heading">
        <div class="section-heading"><div><h2 id="profile-heading">Verified provider profile</h2><p>Business-friendly identity fields mapped from the verified claims.</p></div></div>
        <dl class="profile-grid" id="mapped-claims"></dl>
      </section>
      <section class="section" aria-labelledby="tokens-heading">
        <div class="section-heading"><div><h2 id="tokens-heading">Session tokens</h2><p>Raw token values are shown for demonstration only. Use a copy button to copy an individual token.</p></div></div>
        <div class="token-grid" id="token-list"></div>
      </section>
      <section class="section claims-grid" aria-label="All identity claims">
        <article class="claims-panel"><h3>ID token claims</h3><dl class="claim-list" id="id-claims"></dl></article>
        <article class="claims-panel"><h3>UserInfo claims</h3><dl class="claim-list" id="userinfo-claims"></dl></article>
      </section>
      <p class="demo-footer">Demonstration only | Tokens and claims are not stored by this page</p>
    </section>
  </main>
  <script>
    const demoData = ${demoData};
    const passwordForm = document.getElementById('password-form');
    const passwordInput = document.getElementById('initial-password');
    const confirmInput = document.getElementById('confirm-password');
    const passwordError = document.getElementById('password-error');
    const passwordStep = document.getElementById('password-step');
    const dashboard = document.getElementById('provider-dashboard');

    function showDashboard() {
      addProfileItems(demoData.mappedClaims);
      addTokenCards(demoData.tokenResponse);
      addClaimRows('id-claims', demoData.idTokenClaims);
      addClaimRows('userinfo-claims', demoData.userInfo);
      passwordStep.hidden = true;
      dashboard.hidden = false;
      dashboard.focus();
      window.scrollTo(0, 0);
    }

    function formatValue(value) {
      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      return JSON.stringify(value, null, 2);
    }

    function addClaimRows(targetId, claims) {
      const target = document.getElementById(targetId);
      const entries = Object.entries(claims || {});
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No claims returned.';
        target.appendChild(empty);
        return;
      }
      entries.forEach(function(entry) {
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = entry[0];
        detail.textContent = formatValue(entry[1]);
        target.append(term, detail);
      });
    }

    function addProfileItems(claims) {
      const target = document.getElementById('mapped-claims');
      Object.entries(claims || {}).forEach(function(entry) {
        const item = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        item.className = 'profile-item';
        term.textContent = entry[0];
        detail.textContent = formatValue(entry[1]) || 'Not provided';
        item.append(term, detail);
        target.appendChild(item);
      });
    }

    function copyToken(value) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(value);
      }
      const temporaryInput = document.createElement('textarea');
      temporaryInput.value = value;
      temporaryInput.setAttribute('readonly', '');
      temporaryInput.style.position = 'fixed';
      temporaryInput.style.opacity = '0';
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      const copied = document.execCommand('copy');
      temporaryInput.remove();
      return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard unavailable'));
    }

    function addTokenCards(tokenResponse) {
      const target = document.getElementById('token-list');
      const tokens = Object.entries(tokenResponse || {}).filter(function(entry) {
        return /token$/i.test(entry[0]) && typeof entry[1] === 'string' && entry[1].length > 0;
      });
      if (!tokens.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No raw tokens returned.';
        target.appendChild(empty);
        return;
      }
      tokens.forEach(function(entry) {
        const card = document.createElement('article');
        const header = document.createElement('div');
        const title = document.createElement('h3');
        const button = document.createElement('button');
        const status = document.createElement('p');
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        const raw = document.createElement('pre');
        card.className = 'token-card';
        header.className = 'token-head';
        title.textContent = entry[0].replace(/_/g, ' ').replace(/\b\w/g, function(letter) { return letter.toUpperCase(); });
        button.className = 'copy-button';
        button.type = 'button';
        button.textContent = 'Copy raw token';
        status.className = 'copy-status';
        status.setAttribute('aria-live', 'polite');
        summary.textContent = 'View raw token';
        raw.className = 'token-raw';
        raw.textContent = entry[1];
        button.addEventListener('click', function() {
          copyToken(entry[1]).then(function() {
            status.textContent = 'Copied to clipboard';
          }).catch(function() {
            status.textContent = 'Unable to access clipboard in this browser';
          });
        });
        details.className = 'token-details';
        details.append(summary, raw);
        header.append(title, button);
        card.append(header, status, details);
        target.appendChild(card);
      });
    }

    const identity = demoData.mappedClaims['Full Name'] || demoData.mappedClaims['Email Address'] || demoData.idTokenClaims.email || demoData.idTokenClaims.sub || 'Verified external provider';
    document.getElementById('provider-identity').textContent = 'Verified provider: ' + formatValue(identity);

    passwordForm.addEventListener('submit', function(event) {
      event.preventDefault();
      passwordError.textContent = '';
      const password = passwordInput.value;
      const confirmation = confirmInput.value;
      if (password.length < 4 || password.length > 256) {
        passwordError.textContent = 'Use a password between 4 and 256 characters.';
        passwordInput.focus();
        return;
      }
      if (password !== confirmation) {
        passwordError.textContent = 'The passwords do not match. Please try again.';
        confirmInput.focus();
        return;
      }

      passwordInput.value = '';
      confirmInput.value = '';
      showDashboard();
    });

    if (demoData.flow === 'login') showDashboard();
  </script>
</body>
</html>`;
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
    <p>This page shows the raw token response, verified ID token claims, optional UserInfo claims, and the business mappings you requested for the EpicCare-style demo app.</p>
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
      <h3>Verified ID token</h3>
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

  const authIndexType = flow === 'register'
    ? CONFIG.registerAuthIndexType
    : flow === 'recover' ? CONFIG.recoverAuthIndexType : '';
  const authIndexValue = flow === 'register'
    ? CONFIG.registerAuthIndexValue
    : flow === 'recover' ? CONFIG.recoverAuthIndexValue : '';
  if (authIndexType && authIndexValue) {
    url.searchParams.set('authIndexType', authIndexType);
    url.searchParams.set('authIndexValue', authIndexValue);
  }

  res.writeHead(302, { Location: url.toString() });
  res.end();
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    return res.end('Method not allowed');
  }

  const chunks = [];
  let bodySize = 0;
  for await (const chunk of req) {
    bodySize += chunk.length;
    if (bodySize > 65536) {
      return send(res, 413, 'Logout request is too large.', 'text/plain; charset=utf-8');
    }
    chunks.push(chunk);
  }

  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const idTokenHint = form.get('id_token_hint');
  if (!idTokenHint) {
    return send(res, 400, 'ID token hint is required for logout.', 'text/plain; charset=utf-8');
  }

  const endpoints = await resolveEndpoints();
  if (!endpoints.endSessionEndpoint) {
    return send(res, 503, 'Ping end-session endpoint is unavailable. Configure END_SESSION_ENDPOINT.', 'text/plain; charset=utf-8');
  }

  const url = new URL(endpoints.endSessionEndpoint);
  url.searchParams.set('id_token_hint', idTokenHint);
  url.searchParams.set('client_id', CONFIG.clientId);
  url.searchParams.set('post_logout_redirect_uri', CONFIG.postLogoutRedirectUri);
  res.writeHead(302, {
    Location: url.toString(),
    'Cache-Control': 'no-store'
  });
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

  let idTokenClaims;
  try {
    idTokenClaims = await verifyIdToken(tokenResponse.id_token, session.nonce, endpoints, client.clientId);
  } catch (err) {
    console.warn('ID token validation failed:', err.message);
    return send(res, 400, renderResultPage({
      flow: session.flow,
      endpoints,
      mappedClaims: {},
      error: 'ID token validation failed.'
    }));
  }

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
  return send(res, 200, renderPostLoginPage({
    flow: session.flow,
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
  if (requestUrl.pathname === '/auth/recover') return handleAuthorize(req, res, 'recover');
  if (requestUrl.pathname === '/auth/logout') return handleLogout(req, res);
  if (requestUrl.pathname === '/auth/callback') return handleCallback(req, res, requestUrl);
  if (requestUrl.pathname === '/health') return send(res, 200, JSON.stringify({ status: 'ok' }), 'application/json');

  send(res, 404, '<h1>Not found</h1>');
});

server.listen(PORT, () => {
  console.log(`BX-Health Epic OIDC demo listening on http://localhost:${PORT}`);
});
