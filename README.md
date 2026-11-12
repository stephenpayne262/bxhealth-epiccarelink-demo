# PingOne Verify and Protect for Epic Toolbox

This package provides an Epic Toolbox overview at `/`, EpicCare Link with PingOne AIC at `/epiccarelink`, MyChart with PingOne AIC at `/mychart`, and MyChart with PingOne and DaVinci at `/mychart-pingone`.

The overview introduces the MyChart and EpicCare Link integrations and links to the [MyChart solution brief](https://hub.pingidentity.com/briefs/4415-pingone-verify-protect-mychart) and [Epic Showroom listing](https://showroom.epic.com/Listing?id=3821&returnTitle=6). Its **Simulated Demonstrations** section launches all three demos. **EpicCare Link with PingOne and DaVinci** remains a non-interactive future placeholder. DaVinci orchestration runs in your configured provider-hosted journey, not in this app.

## What it does
- Renders the Toolbox overview in `index.html` and the existing BX-Health EpicCare-style login page in `epiccarelink.html`
- Renders a separate Demo MyChart portal at `/mychart` with its own sign-in, registration, and recovery routes
- MyChart actions include **Register with PingOne AIC** and **Recover MyChart account using PingOne AIC**
- MyChart with PingOne and DaVinci offers sign-in and registration, with its own discovery, OIDC client, scope, callback, and logout configuration
- Uses a separate PingOne AIC OIDC client, callback URI, and logout return URI for Demo MyChart
- Shows the app version and Epic/MyChart trademark notice on the login page
- Keeps sign-in first as the blue primary action, with unshaded registration and recovery actions
- Highlights the Epic Toolbox integration, external provider use case, and Marketplace/Showroom listings
- Starts OIDC Authorization Code flow with PKCE from:
  - `/epiccarelink/auth/login`
  - `/epiccarelink/auth/register`
  - `/epiccarelink/auth/recover`
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
1. In the alpha realm, configure the existing **epiccarelink** client and a separate **Demo MyChart** client. Register these URIs on the corresponding clients:
  - Redirect URI: `http://localhost:3010/epiccarelink/auth/callback`
  - Post Logout Redirect URI: `http://localhost:3010/`
  - Demo MyChart Redirect URI: `http://localhost:3010/mychart/auth/callback`
  - Demo MyChart Post Logout Redirect URI: `http://localhost:3010/`
2. Create the local environment file if needed:

```bash
cp .env.example .env
```

3. Run the app in Docker Desktop:

```bash
docker compose up --build -d
```

4. Open `http://localhost:3010` for the Toolbox overview, `http://localhost:3010/epiccarelink` for EpicCare Link with AIC, `http://localhost:3010/mychart` for MyChart with AIC, or `http://localhost:3010/mychart-pingone` for MyChart with PingOne and DaVinci. Follow logs with `docker compose logs -f`; stop the local container with `docker compose down`.

EpicCare Link now uses `/epiccarelink/auth/*` for login, registration, recovery, callback, and logout. Its token viewer is rendered directly at `/epiccarelink/auth/callback`, not the Toolbox overview at `/`. The legacy `/auth/*` routes remain working aliases for the same EpicCare Link client and sessions; they do not redirect callbacks or authorization codes. Both MyChart integrations are unchanged, and logout still defaults to the overview at `/`.

To migrate, register the new callback URL on the AIC **epiccarelink** client, set `REDIRECT_URI` to that exact URL, and recreate the container (or separately update the Kubernetes Secret and restart the deployment). Existing environment overrides are preserved: a configured legacy `/auth/callback` continues to work, even when starting from the new sign-in links. Existing provider registrations are not changed automatically.

The container receives settings from `.env`; the Node app does not read that file itself. No Node.js or npm installation on the Mac is needed. Run syntax checks and the focused OIDC routing tests inside Docker with `docker build -f Dockerfile --target check .`.

Set `MYCHART_CLIENT_ID` and `MYCHART_CLIENT_SECRET` in `.env` to the credentials for the authorized PingOne AIC **Demo MyChart** client. The example values are placeholders. The original `CLIENT_ID` and `CLIENT_SECRET` remain dedicated to **epiccarelink**. `MYCHART_REDIRECT_URI` and `MYCHART_POST_LOGOUT_REDIRECT_URI` default to the local URIs above. The MyChart mock does not collect credentials; its sign-in buttons redirect to PingOne AIC.

The token endpoint authentication method must match each client's AIC configuration. MyChart defaults to `MYCHART_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_basic` (HTTP Basic); EpicCare Link retains `TOKEN_ENDPOINT_AUTH_METHOD=client_secret_post` (form body). Both settings support `client_secret_basic` and `client_secret_post`. An `invalid_client` response saying "Invalid authentication method" indicates a mismatch; changing these settings requires recreating the container. Failed exchanges consume the authorization code, so start a fresh sign-in rather than refreshing the callback page.

## MyChart with PingOne and DaVinci

Copy the **MyChart with PingOne and DaVinci** section from `.env.example` into your ignored `.env` and fill in:

- `MYCHART_PINGONE_DISCOVERY_URL`: the app's full OpenID configuration URL. For standard PingOne OIDC, the format is `https://<regional-auth-host>/<environment-id>/as/.well-known/openid-configuration`; copy the actual URL for your issuer rather than guessing the region or custom domain. A DaVinci-issued OIDC app has a different discovery URL.
- `MYCHART_PINGONE_CLIENT_ID` and `MYCHART_PINGONE_CLIENT_SECRET`: the confidential OAuth/OIDC web app credentials. Do not use a worker app credential or send secrets in chat.
- `MYCHART_PINGONE_TOKEN_ENDPOINT_AUTH_METHOD`: match the registered client's `client_secret_basic` or `client_secret_post` setting.
- `MYCHART_PINGONE_SCOPE`: scopes enabled for the app, initially `openid profile email`.
- `MYCHART_PINGONE_REDIRECT_URI` and `MYCHART_PINGONE_POST_LOGOUT_REDIRECT_URI`: register `http://localhost:3010/mychart-pingone/auth/callback` and `http://localhost:3010/` respectively on the app, or set both variables to your registered deployment URLs.

Enable the Authorization Code grant, response type `code`, and PKCE S256. Discovery provides the issuer, endpoints, and public-key location; there is no need to enter them separately. Configure the application's sign-on policy to use your DaVinci journey. A DaVinci SDK API key is not needed for this hosted OIDC configuration.

After recreating the Docker container, open `/mychart-pingone` or its launch link on the overview:

- **Sign in with PingOne and DaVinci** uses `/mychart-pingone/auth/login`, sending `flow=login` to the discovered authorization endpoint.
- **Register with PingOne and DaVinci** uses `/mychart-pingone/auth/register`, sending `flow=register`.
- Configure your DaVinci journey to read the `flow` parameter and branch accordingly. This is a custom routing convention, not a standard OAuth parameter or an automatic PingOne policy selector. This app does not create or modify provider policies.
- Both flows use a server-side code exchange with PKCE and validate ID-token issuer, signature, audience, and nonce before displaying the demo workspace. Registration retains the existing mock local password step; it does not set a PingOne or MyChart password.
- Logout posts to `/mychart-pingone/auth/logout` and uses this provider's discovered end-session endpoint and registered return URL. If discovery advertises no logout endpoint, the app reports that logout is unavailable.

The new demo never falls back to AIC endpoints or credentials. Missing settings, failed discovery, or incomplete provider metadata produce an explicit unavailable response and server log; the AIC demos remain independently usable. Recovery is not exposed for this new demo yet. See [PingOne's discovery documentation](https://developer.pingidentity.com/pingone-api/auth/openid-connect-oauth-2/authorization/discovery-openid-configuration.html).

## Logout
All demos now default to returning to the Toolbox overview at `/` after provider logout. In the PingAM admin console, select the alpha realm, then go to **Applications > OAuth 2.0 > Clients**. Add `http://localhost:3010/` to the **epiccarelink** and **Demo MyChart** clients' **Post Logout Redirect URIs** settings. Also allow `http://localhost:3010/` on the separate **MyChart PingOne/DaVinci** application's sign-off URL configuration. These settings are separate from login Redirect URIs.

Logout posts the current ID token to the app, then redirects through the `end_session_endpoint` from OIDC discovery as `id_token_hint`. Set `END_SESSION_ENDPOINT` if AIC discovery is unavailable. Explicit environment overrides still take precedence: update any old `/mychart/` or `/mychart-pingone/` logout return values to your site's root URL. Use `POST_LOGOUT_REDIRECT_URI`, `MYCHART_POST_LOGOUT_REDIRECT_URI`, and `MYCHART_PINGONE_POST_LOGOUT_REDIRECT_URI` for their corresponding clients. Register the exact return URLs with the providers; this app does not change remote registrations.

## OIDC diagnostic logging

Set `OIDC_DEBUG=true` in the ignored `.env` file and recreate the container with `docker compose up --build -d`. The example defaults to `false`. To watch the logs:

```bash
docker compose logs -f --tail=100 app
```

Diagnostic JSON events contain an independent random correlation ID, demo/provider key, flow, stage, timestamps, elapsed time, HTTP status, and safe outcome flags. The same correlation ID follows authorization through a matching callback. It is also returned in the `X-OIDC-Correlation-ID` response header and displayed as **Diagnostic reference** on callback error pages. It is not the OAuth state value. A callback without matching state receives a new reference; logs cannot reliably link it to an earlier attempt.

Stages cover authorization redirects, discovery, callbacks, token exchange, ID-token validation, UserInfo, and logout. Warning/error events are emitted even with debug disabled. Field names and error categories are allowlisted: OAuth error codes are recorded only when recognized, the provider description "Verification failed" becomes `verification_failed`, and other descriptions or arbitrary error codes are redacted. Raw exception messages are not logged.

The logger does **not** record client credentials, authorization codes, tokens, state/nonce values, PKCE verifiers, raw callback/endpoint URLs, request/response bodies, or identity claims. Do not enable HTTP body dumps or share browser HAR exports that could contain these values. Logs remain in Docker's normal container logging system; restrict access to them. Set `OIDC_DEBUG=false` and recreate the container after troubleshooting.

For the reported `invalid_request: Verification failed` case, look for `callback.provider_error`. If there is no `token_exchange.started` for that correlation ID, the provider rejected the authorization journey before the app attempted a token exchange. Use the event timestamp to inspect the corresponding PingOne audit events and DaVinci execution logs. Logging diagnoses this failure; it does not change the provider's journey or bypass verification.

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
- AIC uses discovery first when available, then falls back to its explicit endpoints. The separate PingOne demo requires its own HTTPS discovery URL and metadata.
- The callback verifies ID-token signatures using the discovery JWKS and checks issuer, audience, expiration, issued-at time, and the login-flow nonce before displaying claims. Set `JWKS_URI` when discovery is unavailable and explicit endpoints are used.
- Pending login sessions expire after 10 minutes and are pruned on authorization and callback requests. The process holds at most 1,000 pending attempts across all demos; at capacity, new attempts receive HTTP 429 with a retry hint instead of evicting active attempts. An expired journey must be restarted from its login page.
- Discovery, token exchange, and UserInfo requests have 10-second deadlines. Discovery preserves the documented AIC fallback behavior; token failures return an error, and optional UserInfo failures are logged while verified ID-token claims remain available.
- Malformed request URLs or Host values return HTTP 400 with a redacted diagnostic event rather than rejecting the request handler.
- This remains a demo: sessions are process-local, and the result page intentionally displays the token response. Do not use real patient data or production credentials.

## AWS deployment

Use `/redeploy-bxhealth-epiccarelink-demo` only after completing local testing in Docker. The app Ingress uses the cluster's ExternalDNS hostname annotation to publish its hostname through AWS. Pass `--skip-dns` to defer the annotation and test with `curl --resolve` or a hosts-file override. The skill targets context `ping-dev-aws-us-east-2-oidc`, namespace `ping-devops-stephenpayne`, and the unique host `bxhealth-epiccarelink-demo.ping-devops.com`. It uses the existing `nginx-public` Ingress and the controller's `*.ping-devops.com` certificate. Never provision its DNS record manually in Route 53.

Register `https://bxhealth-epiccarelink-demo.ping-devops.com/epiccarelink/auth/callback` and `https://bxhealth-epiccarelink-demo.ping-devops.com/mychart/auth/callback` as login redirect URIs on their corresponding PingOne AIC clients. Register the root URL `/` on the same host as both clients' post-logout redirect URI. Set both clients' deployment credentials and redirect settings in `infra/.env.k8s`, created from `infra/k8s/cluster.env.example`. That file is ignored by Git. The deployment skill never changes the FHIR/MCP app, its Secret, or shared Ingress/TLS resources, and it publishes the container image without pushing the Git branch.

To enable MyChart with PingOne and DaVinci in a future deployment, also configure the `MYCHART_PINGONE_*` settings from the cluster example and register `/mychart-pingone/auth/callback` as the login redirect and `/` as the post-logout return on that host with the separate PingOne app. No AWS resources are changed by local configuration or Docker testing.
# bxhealth-epiccarelink-demo
# bxhealth-epiccarelink-demo
