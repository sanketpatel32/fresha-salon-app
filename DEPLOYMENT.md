# Deploying to Render

This guide deploys the app to [Render](https://render.com) with a managed
PostgreSQL database. The `render.yaml` Blueprint in the repo makes this a
one-click operation.

## What gets deployed

| Service      | Render type | Plan | Purpose |
| ------------ | ----------- | ---- | ------- |
| `fresha-salon-app` | Web Service  | Free | Express + built React SPA |
| `fresha-db`        | PostgreSQL   | Free | Persistent database (replaces local SQLite) |

The web service builds the React frontend (`npm run build`) and then starts
Express (`npm start`), which serves both the `/api/*` endpoints and the
static SPA from `frontend/dist/`.

## Prerequisites

1. The code is pushed to GitHub (already done — this repo).
2. A free Render account.
3. Optional but recommended: a [Brevo](https://www.brevo.com/) account for
   appointment-confirmation emails. The app boots fine without it.

## Step 1 — Create the Blueprint

1. In Render, click **New → Blueprint**.
2. Pick this repository (`sanketpatel32/fresha-salon-app`).
3. Render reads `render.yaml` and shows the two services it will create
   (the web service and the Postgres instance).
4. Click **Apply**.

Render now:
- Provisions the Postgres database.
- Builds the web service (`npm install && npm run build`).
- Sets `DATABASE_URL` automatically from the Postgres connection string.
- Auto-generates `JWT_SECRET` and `ADMIN_PASS`.
- Starts the service (`npm start`) and begins hitting `/health` to confirm
  it's up.

First deploy typically takes 3–5 minutes (mostly `npm install` and the
Vite build).

## Step 2 — Fill in the manual env vars

Two env vars are flagged `sync: false` in `render.yaml` because they need
your input. Set them in the Render dashboard
(**Web Service → Environment**):

| Var | Required? | Notes |
| --- | --------- | ----- |
| `BREVO_API_KEY` | No | Brevo (Sendinblue) API key. If unset, booking emails fail silently — the app otherwise works. |
| `SENDER_EMAIL` | No | Verified sender email in your Brevo account. |

After setting them, trigger a redeploy (or just save — Render redeploys on
env-var change).

## Step 3 — Find your admin password

`ADMIN_PASS` was auto-generated. Find it in
**Web Service → Environment → ADMIN_PASS**. Login at `/admin` with
`ADMIN_USER=admin` and that password.

## Step 4 — Verify

Once the deploy is live, check:

- `https://<your-service>.onrender.com/health` → `{"status":"ok",...}`
- `https://<your-service>.onrender.com/` → the React SPA loads
- `https://<your-service>.onrender.com/api/buisness/getall` → JSON with
  the seed salons (seeder ran on first boot against the empty Postgres DB)

## Database lifecycle notes

- **First boot creates all tables** via `sequelize.sync()` and seeds sample
  data (3 salons, 4 staff, services, 2 sample users). This only runs when
  the DB is empty.
- **Subsequent deploys do NOT drop data** — `sync()` without `force` only
  creates missing tables. Existing rows persist.
- **Schema changes** (new columns/models) require either `sync({ alter:
  true })` once or a migration. The current code uses plain `sync()`, so
  changes to existing models will not propagate to the live DB until you
  run a migration or alter.

## Cost warnings

- **Web service (free plan):** sleeps after 15 minutes of inactivity.
  First request after sleep takes ~30–60 seconds to wake up. Upgrading to
  a paid plan ($7/mo) removes the sleep.
- **PostgreSQL (free plan):** free for **90 days** from creation, then
  **~$7/month** automatically. Watch the expiry date in the Render
  dashboard. Before it expires, either:
  - Upgrade the database to a paid plan (preserves data), or
  - Export data (`pg_dump` the connection string), delete the free
    instance, create a new one, and `pg_restore`.

## Viewing logs

- **Web service logs:** Dashboard → Web Service → Logs (or the `Events`
  and `Settings → Health` tabs). This is where boot errors, DB-sync
  failures, and the seeder output show up.
- **Database logs:** Dashboard → Postgres → Logs.

## Local dev

Run `npm install` then `npm run dev`. Without a `DATABASE_URL` env var,
the app uses `./database.sqlite` (auto-created and seeded on first boot).
To test against Postgres locally, set `DATABASE_URL` to any reachable
Postgres connection string.
