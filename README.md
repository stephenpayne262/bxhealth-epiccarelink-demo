# BX-Health EpicCare-style OIDC demo

This package contains a lightweight local demo app that mimics the target EpicCare Link login shape while using BX-Health branding and PingOne AIC OIDC.

## What it does
- Renders an EpicCare-style login page branded for BX-Health
- Shows the app version and Epic/MyChart trademark notice on the login page
- Starts OIDC Authorization Code flow with PKCE from either:
  - `/auth/login`
  - `/auth/register`
- Supports optional AIC authIndex routing so the Register button can target a registration journey
- Exchanges the authorization code server-side
- Displays:
  - the raw token response
  - verified ID token claims
  - UserInfo claims
  - mapped business concepts: Email Address, Date of Birth, Zip Code, Full Name, Home Phone

## Quick start
1. Make sure the OIDC client allows this redirect URI:
   `http://localhost:3010/auth/callback`
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

## Registration journey routing
If your PingOne AIC tenant uses a specific journey for registration, set these values in `.env`:

```dotenv
AIC_REGISTER_AUTH_INDEX_TYPE=service
AIC_REGISTER_AUTH_INDEX_VALUE=your-registration-journey-name
```


## Notes
- The app defaults to the values provided in the ticket.
- The code uses discovery first when available, then falls back to the explicit endpoints.
- The callback verifies ID-token signatures using the discovery JWKS and checks issuer, audience, expiration, issued-at time, and the login-flow nonce before displaying claims. Set `JWKS_URI` when discovery is unavailable and explicit endpoints are used.
- This remains a demo: sessions are process-local, and the result page intentionally displays the token response. Do not use real patient data or production credentials.

## AWS deployment

Use `/redeploy-bxhealth-epiccarelink-demo` only after completing local testing in Docker. Pass `--skip-dns` to defer Route 53 provisioning and test with a hosts-file override. The skill targets context `ping-dev-aws-us-east-2-oidc`, namespace `ping-devops-stephenpayne`, and the unique host `bxhealth-epiccarelink-demo.ping-devops.com`. It uses the existing `nginx-public` Ingress and the controller's `*.ping-devops.com` certificate. DNS provisioning, when enabled, is limited to this app's exact hostname and requires an approved plan.

Register `https://bxhealth-epiccarelink-demo.ping-devops.com/auth/callback` as an allowed redirect URI in PingOne AIC; it is separate from the local callback. The app uses its own Kubernetes Secret. Create `infra/.env.k8s` from `infra/k8s/cluster.env.example` and enter the deployment-specific OIDC client values there. That file is ignored by Git. The deployment skill never changes the FHIR/MCP app, its Secret, or shared Ingress/TLS resources, and it publishes the container image without pushing the Git branch.
# bxhealth-epiccarelink-demo
# bxhealth-epiccarelink-demo
