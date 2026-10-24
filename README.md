# BX-Health EpicCare-style OIDC demo

This package contains a lightweight local demo app that mimics the target EpicCare Link login shape while using BX-Health branding and PingOne AIC OIDC.

## What it does
- Renders an EpicCare-style login page branded for BX-Health
- Starts OIDC Authorization Code flow with PKCE from either:
  - `/auth/login`
  - `/auth/register`
- Supports optional AIC authIndex routing so the Register button can target a registration journey
- Exchanges the authorization code server-side
- Displays:
  - the raw token response
  - decoded ID token claims
  - UserInfo claims
  - mapped business concepts: Email Address, Date of Birth, Zip Code, Full Name, Home Phone

## Quick start
1. Make sure the OIDC client allows this redirect URI:
   `http://localhost:3010/auth/callback`
2. Optionally copy `.env.example` values into your shell environment and update as needed. The package now defaults both login and registration to `epiccarelink` / `epicsecret` using client secret post at the token endpoint.
3. Run:

```bash
node server.js
```

4. Open:
   `http://localhost:3010`

## Registration journey routing
If your PingOne AIC tenant uses a specific journey for registration, set:

```bash
export AIC_REGISTER_AUTH_INDEX_TYPE=service
export AIC_REGISTER_AUTH_INDEX_VALUE=your-registration-journey-name
```


## Notes
- The app defaults to the values provided in the ticket.
- The code uses discovery first when available, then falls back to the explicit endpoints.
- The ID token is decoded for display purposes in the browser result page; it is not signature-verified in the UI.
# bxhealth-epiccarelink-demo
# bxhealth-epiccarelink-demo
