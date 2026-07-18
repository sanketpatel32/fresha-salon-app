## Render Deployment Plan

Goal: deploy the app to Render with real Postgres persistence, a working health check, hardened config, and a reproducible setup. **No behavioral changes** — the app should work exactly as it does locally.

You chose **PostgreSQL**. Good news: there's **zero raw SQL** anywhere in the codebase — only `sequelize.fn`/`col`/`literal` calls, all of which are dialect-agnostic. The migration is small.

### Phase 1 — Database migration (SQLite → Postgres via Sequelize dialect swap)
Sequelize abstracts the dialect, so no controller/model changes needed.

1. **`utils/database.js`** — rewrite to pick dialect from `process.env`:
   - If `DATABASE_URL` is set (Render convention): construct Sequelize from that URL with `dialectModuleOptions: { ssl: { require: true } }` and `dialectOptions: { ssl: { rejectUnauthorized: false } }` (Render Postgres requires SSL).
   - Else (local dev): fall back to SQLite at `database.sqlite` — keeps your local workflow identical. No local install of Postgres required.
2. **`package.json`** — add `pg` (^8.11.0) dependency. Keep `sqlite3` for local dev. Run `npm install` to update lockfile.
3. **`app.js`** — change `sequelize.sync({ alter: false })` to `sequelize.sync()` (same effect, explicit). Confirm the seeder runs on both dialects (it will — pure Sequelize). No seeder changes needed.
4. **Verify locally against SQLite** — boot the app, confirm nothing broke. (We won't test Postgres locally unless you want to install it; the code path is straightforward.)

### Phase 2 — Bug fixes & production hardening
5. **Fix `authMiddleware.js:17` bug** — `decodedToken.exp * 10000` → `* 1000` (Unix seconds → milliseconds). This is the typo flagged earlier; it logs the wrong expiry time. Real bug, one-line fix. Also remove the noisy per-request `console.log` in production (replace with `import.meta`-style gate or just drop it).
6. **`app.js`** — add `app.set('trust proxy', 1)` so Express trusts Render's load balancer (required for correct `req.protocol`/secure-cookie behavior behind Render's TLS termination).
7. **Tighten CORS** — `app.js:26` `cors({ credentials: true })` with no `origin` allows all origins with credentials. Since the SPA is same-origin (served by Express), set `origin: true` (reflects request origin) or just rely on same-origin. Minimal change: add `app.use(cors({ origin: true, credentials: true }))`.

### Phase 3 — Health check & Render config
8. **`app.js`** — add a dedicated health endpoint registered **before** the SPA catch-all:
   ```js
   app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));
   ```
   Render's health checks will hit this. Returns JSON 200 immediately — no DB dependency, so Render doesn't kill the service during a slow DB connection.
9. **`render.yaml`** (new, root) — Render Blueprint. Defines one Web Service + one Postgres database. This lets you deploy with one click and makes the setup reproducible:
   ```yaml
   services:
     - type: web
       name: fresha-salon-app
       runtime: node
       plan: free
       buildCommand: npm install && npm run build
       startCommand: npm start
       healthCheckPath: /health
       envVars:
         - key: NODE_VERSION
           value: 18.20.4
         - key: JWT_SECRET
           generateValue: true          # Render creates a random secret
         - key: ADMIN_USER
           value: admin
         - key: ADMIN_PASS
           generateValue: true
         - key: BREVO_API_KEY
           sync: false                  # you'll fill this in manually
         - key: SENDER_EMAIL
           sync: false
         - key: DATABASE_URL
           fromDatabase:
             postgresName: fresha-db
             property: connectionString
     - type: pserv
       name: fresha-db
       runtime: postgresql
       plan: free
   ```
   Note: Render Postgres free tier expires **90 days** after creation (~$7/mo after). I'll document this in the README so it's not a surprise.

### Phase 4 — Cleanup & docs
10. **Remove dead dependencies from `package.json`** — `aws-sdk`, `mysql2`, `multer`, `cron`, `helmet`, `morgan`, `node-cron`. Confirmed by audit: none are `require()`d by any live code path. Also delete the dead file `services/aws.js` (never imported). Keeps `cashfree-pg`, `sib-api-v3-sdk`, `cors`, `bcrypt`, `jsonwebtoken`, `dotenv`, `express`, `sequelize`, `node-cron`-removed, `sqlite3`, `pg`.
    - *Note:* I will NOT touch `services/cashfreeServices.js` (it has hardcoded sandbox creds but it's live code — your call to externalize later). I'll leave it working.
    - *Also add* missing `uuid` to dependencies (controllers/appointmentController.js requires it but it's not declared — currently resolves via transitive install, which is fragile).
11. **Update `.env.example`** — add `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASS`; remove the `DB_*` and `MODE` vars that nothing reads. Keeps the file honest.
12. **New `DEPLOYMENT.md`** — step-by-step Render deploy guide: (a) push to GitHub (already done), (b) create Blueprint from repo, (c) fill in Brevo/SENDER_EMAIL env vars manually, (d) first-deploy note about `sequelize.sync()` creating tables, (e) the 90-day Postgres-free-tier warning, (f) how to view logs.
13. **Commit** — one focused commit per phase (4 commits). **Do NOT push** unless you say so.

### What I will NOT do
- Will not change `services/cashfreeServices.js` (hardcoded sandbox creds) — live code, your call.
- Will not change any controller logic, model fields, or frontend behavior.
- Will not run tests against Postgres locally (no Postgres installed here). The dialect-swap code path is small and standard; we'll verify on first Render boot. If you want, I can add a Postgres-specific smoke test, but it's not necessary.
- Will not push. Local commits only, on `main`, per standing constraint.

### Verification before completion
- Boot locally → confirm app starts on SQLite fallback and `/health` returns 200.
- Confirm `npm install` + `npm run build` succeed (Render will run the same commands).
- Confirm `package.json` scripts Render will call (`npm install`, `npm run build`, `npm start`) are correct and `postinstall` doesn't fight Render's install.
- Spot-check that removing dead deps doesn't break boot (no leftover `require()`).