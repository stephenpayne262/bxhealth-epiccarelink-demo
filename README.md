# BX-Health EpicCare-style OIDC demo

This package contains a lightweight local demo app that mimics the target EpicCare Link login shape while using BX-Health branding and PingOne AIC OIDC.

## What it does
- Renders an EpicCare-style login page branded for BX-Health
- Shows the app version and Epic/MyChart trademark notice on the login page
- Highlights the Epic Toolbox integration, external provider use case, and Marketplace/Showroom listings
- Starts OIDC Authorization Code flow with PKCE from:
  - `/auth/login`
  - `/auth/register`
  - `/auth/recover`
- Supports optional AIC authIndex routing so the Register button can target a registration journey
- Logs out through the OIDC provider end-session endpoint to clear the AIC browser session
- Exchanges the authorization code server-side
- Displays:
  - the raw token response
  - verified ID token claims
  - UserInfo claims
  - mapped business concepts: Email Address, Date of Birth, Zip Code, Full Name, Home Phone
- Registration shows a mock initial-password step, account recovery shows a mock password-reset step, and sign-in goes directly to the provider dashboard. Passwords are only compared in the browser and are not sent or stored.

## Quick start
1. In the alpha realm, open **Applications > OAuth 2.0 > Clients > epiccarelink**. Register these separate URIs on the client:
  - Redirect URI: `http://localhost:3010/auth/callback`
  - Post Logout Redirect URI: `http://localhost:3010/`
2. Create the local environment file if needed:

```bash
cp .env.example .env
```

3. Run the app in Docker Desktop:

```bash
docker compose up --build -d
```

4. Open `http://localhost:3010`. Follow logs with `docker compose logs -f`; stop the local container with `docker compose down`.

The container receives settings from `.env`; the Node app does not read that file itself. No Node.js or npm installation on the Mac is needed. To run the syntax check inside Docker, use `docker build -f Dockerfile --target check .`.

## Logout
In the PingAM admin console, select the alpha realm, then go to **Applications > OAuth 2.0 > Clients > epiccarelink**. Add `http://localhost:3010/` to the client's **Post Logout Redirect URIs** setting. This is separate from the login Redirect URI ending in `/auth/callback`.

Logout posts the current ID token to the app, then redirects through the `end_session_endpoint` from OIDC discovery as `id_token_hint`. By default, the post-logout URL is derived from the redirect URI origin. Set `END_SESSION_ENDPOINT` if discovery is unavailable, or `POST_LOGOUT_REDIRECT_URI` to override the return URL; register that exact URL on the AIC client.

## Registration journey routing
If your PingOne AIC tenant uses a specific journey for registration, set these values in `.env`:

```dotenv
AIC_REGISTER_AUTH_INDEX_TYPE=service
AIC_REGISTER_AUTH_INDEX_VALUE=your-registration-journey-name
```

Account recovery can use a separate PingOne AIC journey by setting these values in `.env`:

```dotenv
AIC_RECOVER_AUTH_INDEX_TYPE=service
AIC_RECOVER_AUTH_INDEX_VALUE=your-recovery-journey-name
```


## Notes
- The app defaults to the values provided in the ticket.
- The code uses discovery first when available, then falls back to the explicit endpoints.
- The callback verifies ID-token signatures using the discovery JWKS and checks issuer, audience, expiration, issued-at time, and the login-flow nonce before displaying claims. Set `JWKS_URI` when discovery is unavailable and explicit endpoints are used.
- This remains a demo: sessions are process-local, and the result page intentionally displays the token response. Do not use real patient data or production credentials.

## AWS deployment

Use `/redeploy-bxhealth-epiccarelink-demo` only after completing local testing in Docker. The app Ingress uses the cluster's ExternalDNS hostname annotation to publish its hostname through AWS. Pass `--skip-dns` to defer the annotation and test with `curl --resolve` or a hosts-file override. The skill targets context `ping-dev-aws-us-east-2-oidc`, namespace `ping-devops-stephenpayne`, and the unique host `bxhealth-epiccarelink-demo.ping-devops.com`. It uses the existing `nginx-public` Ingress and the controller's `*.ping-devops.com` certificate. Never provision its DNS record manually in Route 53.

Register `https://bxhealth-epiccarelink-demo.ping-devops.com/auth/callback` as an allowed redirect URI in PingOne AIC; it is separate from the local callback. The app uses its own Kubernetes Secret. Create `infra/.env.k8s` from `infra/k8s/cluster.env.example` and enter the deployment-specific OIDC client values there. That file is ignored by Git. The deployment skill never changes the FHIR/MCP app, its Secret, or shared Ingress/TLS resources, and it publishes the container image without pushing the Git branch.
# bxhealth-epiccarelink-demo
# bxhealth-epiccarelink-demo
