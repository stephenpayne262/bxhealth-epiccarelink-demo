# Repository Guidance

- Read [README.md](README.md) for the demo overview and OIDC setup.
- Run and test the app only in Docker Desktop. Do not run Node.js or npm on the macOS host. Use `docker compose up --build -d`, check `http://localhost:3010` and `/health`, and stop it with `docker compose down` when testing is complete.
- Use `docker build -f Dockerfile --target check .` for the in-container syntax check. There is no test suite.
- The Node process reads `process.env`; Compose passes local values from `.env` into the container. Use `.env.example` as the reference and never copy environment files into the image.
- `server.js` owns HTTP routes and OIDC handling; `index.html` contains the login UI. Keep the CommonJS app simple and its dependencies inside the container.
- Treat this as a demo, not production authentication: ID tokens are verified before display, but sessions are process-local and the result page displays token data. Default credentials are demo values. Never add real credentials or tokens to the repository.
- Do not run `initialize.sh` for normal development; it initializes Git, creates a commit, configures a remote, and pushes.
- For AWS deployment, use only `.github/skills/redeploy-bxhealth-epiccarelink-demo/SKILL.md`. It is scoped to this app's resources and requires an approved preflight plan; never deploy manually or retarget the FHIR/MCP app.
- Always increase the version when making changes, and update the version number shown on the app.
- Always update documentation when adding features.