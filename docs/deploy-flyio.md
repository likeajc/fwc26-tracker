# Deploy the API to Fly.io (Path B — API + live updater)

This guide deploys the **full** FWC26 Tracker API to [Fly.io](https://fly.io):
the REST API **and** the 24/7 live updater (live scores every 3s, Polymarket
odds every 60s), backed by a free [MongoDB Atlas](https://www.mongodb.com/atlas)
database.

Both processes run in **one always-on machine** via PM2 (see
[`api/ecosystem.config.js`](../api/ecosystem.config.js) and
[`api/Dockerfile`](../api/Dockerfile)). The machine is configured **not to
auto-stop** — otherwise the live updater would stop polling.

> **Why not Vercel?** Vercel is serverless and can't run an always-on worker;
> the every-3s updater can't run there. Fly.io can keep a process alive 24/7.

---

## Cost reality check

- **MongoDB Atlas M0** — free forever (512 MB), no card for the cluster.
- **Fly.io** — pay-as-you-go with a small monthly allowance. A single
  `shared-cpu-1x` / 512 MB machine running 24/7 is roughly **~$3/mo** and may be
  largely covered by the allowance. A card is required even for free usage.
  Two Node processes don't fit comfortably in 256 MB, so 512 MB is the realistic
  minimum.

---

## Prerequisites

1. A [Fly.io account](https://fly.io/app/sign-up) + `flyctl` installed:
   ```bash
   # macOS
   brew install flyctl
   # Linux / WSL
   curl -L https://fly.io/install.sh | sh
   ```
   Then `fly auth login`.
2. A [MongoDB Atlas](https://www.mongodb.com/atlas/database) account.
3. This repo cloned locally.

---

## Step 1 — Create the database (MongoDB Atlas)

1. Create a **free M0** cluster.
2. **Database Access** → add a database user (username + password). Save them.
3. **Network Access** → add IP `0.0.0.0/0` (allow from anywhere — Fly machines
   don't have a fixed egress IP on the free tier).
4. **Connect → Drivers** → copy the connection string, e.g.:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/worldcup2026?retryWrites=true&w=majority
   ```
   Add the database name `worldcup2026` in the path as shown above.

---

## Step 2 — Generate secrets

```bash
# two strong random values
openssl rand -hex 32   # use for JWT_SECRET
openssl rand -hex 32   # use for SECRET
```
Pick any value for `ACCESSCODEDEV` (the admin write access code).

---

## Step 3 — Create the Fly app

Run from the `api/` directory (it contains `fly.toml`, `Dockerfile`,
`.dockerignore`):

```bash
cd api
fly launch --no-deploy --copy-config
```

- Accept the existing `fly.toml` when prompted.
- Choose a **globally unique app name** (this updates `app = ` in `fly.toml`).
- Pick a region near you/your users.
- Decline any offered Postgres/Redis — we use Atlas.

---

## Step 4 — Set secrets

```bash
fly secrets set \
  MONGODB_URL="mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/worldcup2026?retryWrites=true&w=majority" \
  JWT_SECRET="<from step 2>" \
  SECRET="<from step 2>" \
  ACCESSCODEDEV="<your admin code>" \
  CORS_ORIGINS="*"
```

> `CORS_ORIGINS` only affects the admin/auth routes — the public `/get/*`
> endpoints are always open. Once your app has a domain, set it to that origin,
> e.g. `CORS_ORIGINS="https://your-app.com"`.

---

## Step 5 — Deploy

```bash
fly deploy
```

This builds the Docker image and boots one machine running both the API and the
updater. The health check hits `/health` (returns 200 once MongoDB is connected
— an empty database still counts as healthy).

---

## Step 6 — Seed the data (one time only)

> ⚠️ The importers **drop and recreate** their collections. Run this **only
> once** for initial setup. Re-running it later **wipes live match scores** back
> to the seed values — never automate it on deploy.

After the first successful deploy, seed against your Atlas database:

```bash
fly ssh console -C "npm run import:all"
```

This seeds groups, teams, stadiums and matches. The live updater (already
running) then fills in scores/odds during the tournament.

**Alternative — seed locally** (no SSH; needs Node locally):
```bash
cd api
MONGODB_URL="mongodb+srv://...worldcup2026?retryWrites=true&w=majority" npm run import:all
```

---

## Step 7 — Verify

```bash
fly status
fly logs            # you should see both fwc26-api and fwc26-updater logging

# replace with your app's hostname
curl https://<your-app>.fly.dev/health
curl https://<your-app>.fly.dev/get/games
curl https://<your-app>.fly.dev/get/odds
```

`fly logs` should show the API serving requests **and** the updater polling
scores/odds on its interval.

Your app now points its `API_BASE_URL` at `https://<your-app>.fly.dev`.

---

## Operations

```bash
fly logs                 # tail logs (both processes)
fly ssh console          # shell into the machine
fly ssh console -C "pm2 status"   # see both PM2 processes
fly deploy               # redeploy after code changes (does NOT re-seed)
fly secrets set KEY=val  # update a secret (triggers a restart)
fly scale memory 1024    # bump RAM if you hit memory restarts
```

### Notes & gotchas

- **Don't re-seed on deploy.** Seeding is manual and one-time (Step 6).
- **Updater write-files are ephemeral.** `data/auto-matched-players.json` and
  `data/unmapped-players.json` are runtime audit logs written inside the
  container; they reset on each deploy/restart. That's fine — curated
  dictionaries (`player-names.json`, etc.) are in the image and unaffected.
- **Single machine.** Keep it to one machine. The updater is a singleton — don't
  scale the count to >1 or you'll get duplicate polling. To grow, scale memory,
  not count.
- **Outbound access.** The updater needs to reach `web-api.varzesh3.com` (scores)
  and `gamma-api.polymarket.com` (odds). Both are public HTTPS — no allowlist
  needed on Fly.
- **Swagger** is disabled in production (`ENABLE_SWAGGER=false`). Flip the env
  var if you want `/api-docs` live.

---

## Alternative host: Koyeb

Koyeb has a free instance and deploys the same `Dockerfile` straight from GitHub
(point it at the `api/` directory, expose port 3050). The same one-time seeding
caveat applies. Fly.io is recommended here because `fly.toml` pins the
no-auto-stop behavior the updater needs.
