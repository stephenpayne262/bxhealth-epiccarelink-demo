# Repository Guidance

- Read [README.md](README.md) for the demo overview and OIDC setup.
- Run with `node server.js` or `npm start` (Node.js 18+; no package install is needed). The server listens on port 3010 by default.
- Configuration comes from `process.env`; the app does not load `.env` files. Use `.env.example` as a reference for supported variables.
- `server.js` owns HTTP routes and OIDC handling; `index.html` contains the login UI. Keep the existing dependency-free CommonJS approach.
- There is no test script or test suite. For server changes, run `node --check server.js` and smoke-test `/` and `/health` when practical.
- Treat this as a demo, not production authentication: ID tokens are verified before display, but sessions are process-local and the result page displays token data. Default credentials are demo values. Never add real credentials or tokens to the repository.
- Do not run `initialize.sh` for normal development; it initializes Git, creates a commit, configures a remote, and pushes.
- Always increase the version when making changes, and update the version number shown on the app.
- Always update documentation when adding features.