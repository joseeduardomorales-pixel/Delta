# Delta — Deploy playbook

Targets:
- **`/api`** → Render web service `delta-api` (Node + Express)
- **`/web`** → Render static site `delta-web` (Vite build)
- **Custom domain** `delta.coldcargo.us` → Render's CNAME

Both services auto-deploy on every push to `main`. There's no manual
build step after first setup — push, wait ~90 seconds, see it live.

---

## 0. Prerequisites (one-time)

You need to have:

- [ ] **GitHub account** (`joseeduardomorales-pixel`) signed in
- [ ] **Render account** at https://render.com signed in
- [ ] **DNS access** to `coldcargo.us` at whatever registrar holds it
- [ ] All secrets from `~/delta/api/.env` (don't paste them in chat;
      copy them straight from the file into Render's UI)

---

## 1. Push the repo to GitHub

The repo isn't on GitHub yet. Two ways:

### Option A — `gh` CLI (recommended if you're going to push a lot)

```bash
# Install gh
brew install gh
# (or: npx -y @github/cli — npm-based alt if you don't have brew)

# Auth once (opens browser)
gh auth login
# → GitHub.com → HTTPS → "Login with web browser" → paste 8-char code

# From inside ~/delta:
cd ~/delta
gh repo create joseeduardomorales-pixel/delta \
  --private --source=. --remote=origin --push
```

That single command creates the repo, sets the remote, pushes `main`.

### Option B — Manual (skip if Option A worked)

1. Browser → https://github.com/new
   - Owner: `joseeduardomorales-pixel`
   - Name: `delta`
   - Visibility: **Private**
   - DO NOT initialize with README / .gitignore / license (we have ours)
   - Create
2. Back in your terminal:
   ```bash
   cd ~/delta
   git remote add origin https://github.com/joseeduardomorales-pixel/delta.git
   git push -u origin main
   ```
   You'll be prompted for GitHub credentials. Use a Personal Access
   Token (Settings → Developer Settings → Tokens) as the password if
   GitHub doesn't accept your normal one.

---

## 2. Connect Render to the GitHub repo

1. Browser → https://dashboard.render.com → New → **Blueprint**
2. Connect GitHub → grant access to the `delta` repo
3. Pick the repo → Render auto-detects `render.yaml`
4. Click **Apply**

Render will say "Some env vars need values" and list each one
marked `sync: false`. Fill them in from `~/delta/api/.env`:

### delta-api env vars (paste from `~/delta/api/.env`)

| Variable | Source |
|---|---|
| `FRONTEND_ORIGIN` | Initially leave blank; we fix it in step 4 |
| `SUPABASE_URL` | `https://ycmrdnavcvbtpfdzgwih.supabase.co` |
| `SUPABASE_ANON_KEY` | from .env |
| `SUPABASE_SERVICE_ROLE_KEY` | from .env |
| `ANTHROPIC_API_KEY` | from .env |
| `INTANGLES_VENDOR_ACCESS_TOKEN` | from .env |
| `ALVYS_CLIENT_ID` | from .env |
| `ALVYS_CLIENT_SECRET` | from .env |
| `TRACKFLEET_USERCODE` | from .env |
| `TRACKFLEET_USERNAME` | from .env |
| `TRACKFLEET_PASSWORD` | from .env |

### delta-web env vars

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ycmrdnavcvbtpfdzgwih.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key (`sb_publishable_*`) |
| `VITE_API_URL` | Initially leave blank; we fix it in step 4 |

Hit **Apply** — both services start building. ~3 minutes for first
build.

---

## 3. Wait for first build, get the URLs

Once both services show "Live" in the Render dashboard:

- `delta-api` will be at something like `https://delta-api.onrender.com`
- `delta-web` will be at something like `https://delta-web.onrender.com`

Note both URLs.

---

## 4. Stitch the env vars

The two services now need to know about each other.

1. `delta-api` settings → Environment → set `FRONTEND_ORIGIN`:
   - First pass: `https://delta-web.onrender.com`
   - After DNS goes live (step 6): `https://delta.coldcargo.us`
   - **Save** triggers a redeploy (~30s).

2. `delta-web` settings → Environment → set `VITE_API_URL`:
   - `https://delta-api.onrender.com`
   - **Save** triggers a redeploy. (Vite needs the var at build time —
     Render does the right thing here automatically.)

---

## 5. First smoke from your laptop

Open `https://delta-web.onrender.com` in a fresh browser tab.

- Sign in (`eduardo@coldcargo.us` + your temp password)
- Say "Quick test on CC07" → see Claude reply with a WO id
- Click "Review queue" → see the pending WO → Approve it
- Click "PM schedules" → empty → click Add → make one

If any of these break, screenshot the failure + the Render service logs
(dashboard → service → Logs tab), and I'll fix on a new branch.

---

## 6. Custom domain → `delta.coldcargo.us`

1. `delta-web` settings → **Custom Domains** → Add → `delta.coldcargo.us`
2. Render shows you a CNAME target like:
   ```
   delta.coldcargo.us  CNAME  delta-web.onrender.com
   ```
3. Go to your DNS registrar for `coldcargo.us`. Add that exact CNAME.
4. Wait for DNS propagation (5 min to 1 hour).
5. Render auto-provisions an SSL cert when DNS resolves. You'll see
   the green "verified" mark.
6. Update `delta-api` → `FRONTEND_ORIGIN` to
   `https://delta.coldcargo.us` and save (redeploys).

---

## 7. Real-phone smoke (charter §6 pre-deploy checklist)

Open `https://delta.coldcargo.us` on your phone:

- [ ] Loads in under 2s on 4G
- [ ] Add to Home Screen → installs as PWA
- [ ] Sign in
- [ ] "I'm going to check CC07" → Claude responds with the truck's
      current state (will mention mileage once we sync next)
- [ ] Attach a photo + "found a leak on CC09" → Claude logs + describes
      what it sees
- [ ] Open `/assets/CC07` → see the kardex
- [ ] Open `/admin/work-orders/pending` → review queue
- [ ] Sign out → sign back in → session persists

If everything works, **tag the milestone**:

```bash
cd ~/delta
git tag -a foundation-v1 -m "Delta foundation live at delta.coldcargo.us"
git push origin foundation-v1
```

---

## Day-2 operations

### Push a fix

```bash
# Make changes, commit
git checkout -b fix/something
# ...edits...
git commit -am "fix: ..."
git checkout main
git merge --ff-only fix/something
git push origin main
# Render auto-deploys both services. Watch the Render dashboard.
```

### Refresh fleet data

The meter sync isn't on a cron yet (Phase 5 work). To refresh manually:

```bash
cd ~/delta/api && node --env-file=.env ../db/seed/sync_alvys.mjs
cd ~/delta/api && node --env-file=.env ../db/seed/sync_meters.mjs
```

(Runs against the same Supabase the prod API uses.)

### Onboard a tech

In production, open `https://delta.coldcargo.us/admin/users` →
**Add user** → email + name + role=`tech` + temp password →
share password with them privately. They sign in and can immediately
chat.

### Rotate a secret

Render dashboard → service → Environment → edit value → Save.
Triggers a redeploy.

### Roll back

Render dashboard → service → Events → find a previous successful
deploy → **Rollback to this deploy**.

---

## Render plan & cost

Current `render.yaml` sets:
- `delta-api`: `plan: starter` (~$7/mo, always-on, no cold starts).
  If you want free tier with cold starts (15-min idle sleep), change
  to `plan: free`. The first request after sleep takes ~30 seconds
  to spin up — bad for chat UX but fine for personal testing.
- `delta-web`: free (static sites are free on Render).

Total: $7/mo. Cancellable anytime.
