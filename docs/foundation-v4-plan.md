# Delta Foundation Plan — v4

> Supersedes `Delta_Foundation_Prompt_v3.md`. Phase 1 (scaffold) already
> landed on `main` from v3 and is fully reusable. Phases 2–4 are
> redefined here based on PM-driven scope changes since v3 was written.
> The PROTOCOL section of CLAUDE.md is unchanged.

## 1 — What changed from v3, and why

| Decision | v3 | v4 | Why |
|---|---|---|---|
| Tech UI shape | 5 action buttons + Catalogs screen + nav | Single chat box | "Techs don't open work orders" taken literally. Less UI to maintain, more flexibility to mold from real usage. |
| Brain | Claude API present but no prompt logic | Claude tool-use IS the product | Every message routed through Claude with bounded tools. |
| Durable record table | `action_logs` (generic) | `work_orders` (named for the business object) | Same shape, business-true name. This table is the kardex. |
| Meter readings | `odometer_readings`, source enum `intangles \| manual` | Unified `meter_readings` (miles + hours), source enum `intangles \| monarch \| trackfleet \| manual` | Trucks have miles, reefers have hours. One query for "last measurement of any kind." |
| Asset catalog source | Manual seed from Excel | Periodic sync from Alvys (read-only mirror in Supabase) | Alvys is the canonical fleet system. No double-entry. |
| Telematics sources | Intangles only | Intangles + Monarch (trucks) + TrackFleet (reefers) | Truck mileage source varies by unit; reefer hours from TrackFleet when available, else manual. Monarch + TrackFleet deferred until docs/creds land. |
| PM scheduling | One stub table | First-class `pm_schedules` with cadence `miles \| hours \| months` | Trailers have two schedules (body by time, reefer unit by hours). Trucks by miles. |
| Permission model | Role enum existed, no policy | Three roles with explicit capability matrix; enforced via RLS + Claude tool-gating | Admin / Dispatcher / Tech (driver enum stays for later). |
| UI surfaces | One (mobile) | Two (mobile chat + PM admin) | PM needs forms/lists where precision matters. |
| Safety pattern | "no silent failures" general rule | Confirm-after-write on every Claude-driven `work_orders` insert | Adds friction but makes miswrites visible — Sentinel-class defense. |

## 2 — Locked foundation facts (carried over)

- Repo: `github.com/joseeduardomorales-pixel/delta`, local at `~/delta`
- Supabase project: `delta` inside Cold Cargo org (`ycmrdnavcvbtpfdzgwih`), region `us-east-1`, session pooler over IPv4
- Custom domain: `delta.coldcargo.us` (Render-hosted, Phase 4)
- Design language: pure black `#000000` + neon green `#00FF41`, JetBrains Mono, ≥44px tap targets, mobile-first
- Stack: React+Vite PWA, Node/Express, Supabase (Postgres+Auth+Storage), Anthropic Claude API, Render
- Charter PROTOCOL (in `CLAUDE.md`) unchanged

## 3 — Product model (v4)

### Tech surface — `/` (chat)

One screen. Mobile-first. Vertical message thread + single text input. Native OS keyboard for typing and dictation (mic button is the OS keyboard, not in-app). Image + file attach via OS picker.

Every message is sent to `/api/chat`. The backend calls Claude with the message, the conversation history, the caller's role, and a bounded toolset. Claude responds in natural language AND optionally invokes tools. Tool results round-trip and Claude composes the final user-facing reply.

**Confirm-after-write safety:** any tool that writes to `work_orders` (or other durable tables) triggers a confirmation message back to the user:

> "Logged **WO-1487** — oil change on **CC07** at **86,432 mi**. Say *undo* to remove."

The user has a small grace window to undo. After it, the row is permanent (still revisable via admin tools, but tracked in `audit_log`).

### PM surface — `/admin/*` (forms & lists, role-gated to `admin`)

- `/admin/users` — list, add (sends magic-link invite), set role, deactivate
- `/admin/pm-schedules` — create/edit PM schedules per asset; bulk import via Excel (same code path as Claude's `ingest_pm_schedule` tool)
- `/assets/:unit_number` — read-only work-order history for one asset (the kardex view), available to all logged-in users but most useful to PM/admin

### Routes summary

| Route | Auth | Visible to |
|---|---|---|
| `/login` | public | everyone |
| `/` (chat) | required | tech, dispatcher, admin |
| `/assets/:unit` | required | tech, dispatcher, admin |
| `/admin/users` | required + admin | admin only |
| `/admin/pm-schedules` | required + admin | admin only |

## 4 — Permission matrix (locked)

| Capability | Admin | Dispatcher | Tech |
|---|---|---|---|
| View assets, work orders, PM schedules | ✓ | ✓ | ✓ |
| Report an issue (`work_orders.type='issue'`) | ✓ | ✓ | ✓ |
| Open work orders (`type='repair' \| 'pm' \| 'inspection'`) | ✓ | ✗ | ✓ |
| Edit / void existing work orders (any) | ✓ | ✗ | ✗ (own only, within grace window) |
| Add / delete / change-role of users | ✓ | ✗ | ✗ |
| Create / edit PM schedules | ✓ | ✗ | ✗ |
| Reach `/admin/*` screens | ✓ | ✗ | ✗ |
| Tools Claude exposes to this role | All | `report_issue`, `query_*` | `report_issue`, `create_work_order`, `query_*`, `get_meter_reading` |

`driver` role enum exists, no users assigned yet, no policies.

## 5 — Schema (Phase 2)

All tables get `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger-maintained). All FKs explicit on-delete behavior. RLS enabled on every table.

### Core tables

```sql
users
  id                    uuid PK  references auth.users(id) ON DELETE CASCADE
  full_name             text     NOT NULL
  role                  text     NOT NULL CHECK (role IN ('admin','dispatcher','tech','driver')) DEFAULT 'tech'
  phone                 text
  active                boolean  NOT NULL DEFAULT true
  created_at, updated_at

assets
  id                    uuid PK
  unit_number           text     UNIQUE NOT NULL          -- "CC07", "T15"
  type                  text     NOT NULL CHECK (type IN ('truck','trailer','reefer'))
  vin                   text
  make                  text
  model                 text
  year                  int
  intangles_device_id   text
  monarch_device_id     text
  trackfleet_device_id  text
  alvys_id              text                              -- canonical Alvys identifier
  metadata              jsonb    DEFAULT '{}'
  active                boolean  NOT NULL DEFAULT true
  created_at, updated_at

drivers
  id                    uuid PK
  full_name             text     NOT NULL
  alvys_id              text     UNIQUE                   -- canonical
  phone                 text
  email                 text
  active                boolean  NOT NULL DEFAULT true
  created_at, updated_at

meter_readings
  id                    uuid PK
  asset_id              uuid     FK assets ON DELETE CASCADE NOT NULL
  unit                  text     NOT NULL CHECK (unit IN ('miles','hours'))
  value                 int      NOT NULL CHECK (value >= 0)
  source                text     NOT NULL CHECK (source IN ('intangles','monarch','trackfleet','manual'))
  recorded_by           uuid     FK users ON DELETE SET NULL
  recorded_at           timestamptz NOT NULL
  raw_payload           jsonb                              -- raw response from telematics
  INDEX (asset_id, recorded_at DESC)
  INDEX (asset_id, unit, recorded_at DESC)

work_orders                                                -- THE KARDEX SPINE
  id                    uuid PK
  asset_id              uuid     FK assets ON DELETE SET NULL
  asset_unit_number     text                              -- denormalized, survives asset delete
  user_id               uuid     FK users ON DELETE RESTRICT NOT NULL
  type                  text     NOT NULL CHECK (type IN ('pm','repair','issue','inspection','other'))
  status                text     NOT NULL CHECK (status IN ('open','in_progress','completed','voided')) DEFAULT 'open'
  title                 text                              -- Claude's short summary
  description           text                              -- longer narrative
  raw_input             text                              -- original chat message, never edited
  parsed_data           jsonb    DEFAULT '{}'             -- Claude's structured extraction
  resolves_work_order_id uuid    FK work_orders ON DELETE SET NULL
  meter_reading_id      uuid     FK meter_readings ON DELETE SET NULL
  pm_schedule_id        uuid     FK pm_schedules ON DELETE SET NULL
  started_at            timestamptz NOT NULL DEFAULT now()
  completed_at          timestamptz
  voided_at             timestamptz
  voided_by             uuid     FK users
  void_reason           text
  created_at, updated_at
  INDEX (asset_id, started_at DESC)
  INDEX (asset_unit_number, started_at DESC)
  INDEX (user_id, started_at DESC)
  INDEX (type, status)

pm_schedules
  id                    uuid PK
  asset_id              uuid     FK assets ON DELETE CASCADE NOT NULL
  scope                 text     NOT NULL CHECK (scope IN ('truck','trailer_body','reefer_unit','other'))
  name                  text     NOT NULL                 -- "Engine oil & filter", "DOT annual"
  cadence_type          text     NOT NULL CHECK (cadence_type IN ('miles','hours','months'))
  interval_miles        int      CHECK (interval_miles > 0)
  interval_hours        int      CHECK (interval_hours > 0)
  interval_months       int      CHECK (interval_months > 0)
  last_completed_at     timestamptz
  last_completed_miles  int
  last_completed_hours  int
  last_completed_work_order_id uuid FK work_orders ON DELETE SET NULL
  anchor_mode           text     NOT NULL CHECK (anchor_mode IN ('anchored','from_last_completion')) DEFAULT 'anchored'
  active                boolean  NOT NULL DEFAULT true
  notes                 text
  created_at, updated_at
  CHECK (
    (cadence_type='miles'  AND interval_miles  IS NOT NULL AND interval_hours IS NULL AND interval_months IS NULL) OR
    (cadence_type='hours'  AND interval_hours  IS NOT NULL AND interval_miles IS NULL AND interval_months IS NULL) OR
    (cadence_type='months' AND interval_months IS NOT NULL AND interval_miles IS NULL AND interval_hours IS NULL)
  )
  INDEX (asset_id, active)

action_photos
  id                    uuid PK
  work_order_id         uuid     FK work_orders ON DELETE CASCADE NOT NULL
  storage_path          text     NOT NULL                 -- bucket key
  caption               text
  ai_analysis           jsonb                              -- if Claude analyzed it
  uploaded_by           uuid     FK users ON DELETE SET NULL
  uploaded_at           timestamptz NOT NULL DEFAULT now()

conversations
  id                    uuid PK
  user_id               uuid     FK users ON DELETE CASCADE NOT NULL
  title                 text                              -- Claude-generated rolling title
  started_at            timestamptz NOT NULL DEFAULT now()
  last_message_at       timestamptz NOT NULL DEFAULT now()
  INDEX (user_id, last_message_at DESC)

messages
  id                    uuid PK
  conversation_id       uuid     FK conversations ON DELETE CASCADE NOT NULL
  role                  text     NOT NULL CHECK (role IN ('user','assistant','tool'))
  content               jsonb    NOT NULL                  -- full Anthropic content block(s)
  tool_calls            jsonb                              -- tool calls Claude made
  related_work_order_id uuid     FK work_orders ON DELETE SET NULL
  created_at
  INDEX (conversation_id, created_at)

audit_log
  id                    uuid PK
  actor_user_id         uuid     FK users ON DELETE SET NULL
  action                text     NOT NULL                  -- 'create' | 'update' | 'void' | 'role_change' | ...
  target_table          text     NOT NULL
  target_id             uuid
  before                jsonb
  after                 jsonb
  ip                    inet
  user_agent            text
  created_at            timestamptz NOT NULL DEFAULT now()
  INDEX (target_table, target_id)
  INDEX (actor_user_id, created_at DESC)
```

### RLS policy sketch (full SQL in migration `0002_rls_policies.sql`)

- `users`: SELECT all (any logged-in user); UPDATE own row only (except role); admin can do anything.
- `assets`, `drivers`, `meter_readings`: SELECT all (any logged-in); INSERT/UPDATE service role only (the sync jobs).
- `work_orders`: SELECT all (any logged-in); INSERT own row only with role-gated `type` constraint (dispatcher only `type='issue'`); UPDATE own row within grace window OR admin.
- `pm_schedules`: SELECT all; INSERT/UPDATE/DELETE admin only.
- `action_photos`: SELECT all; INSERT linked to own `work_orders` row; service role for AI analysis writes.
- `conversations`, `messages`: SELECT/INSERT own only; admin can SELECT any.
- `audit_log`: service role only (no client writes ever).

### Storage bucket

`action-photos` — private, served via signed URLs (60s). RLS mirrors `action_photos` table.

## 6 — API surface (Phase 3)

| Endpoint | Auth | Caller roles | Description |
|---|---|---|---|
| `GET /health` | none | — | Already exists. Upgraded with real db/claude/intangles/lastSync checks. |
| `POST /api/chat` | JWT | all | One-shot Claude turn. Body `{ conversationId?, message, attachments[] }`. Server: persists message, calls Claude with role-bounded toolset, persists tool calls, returns assistant reply + any side effects. |
| `GET /api/conversations` | JWT | all | List own conversations. |
| `GET /api/conversations/:id` | JWT | own or admin | Message thread. |
| `GET /api/assets` | JWT | all | List assets. |
| `GET /api/assets/:unit/work-orders` | JWT | all | Kardex history. |
| `POST /api/work-orders/:id/undo` | JWT | owner within grace | Voids a work order created in the last N minutes. |
| `POST /api/admin/users` | JWT + admin | admin | Create user; sends magic-link invite. |
| `PATCH /api/admin/users/:id` | JWT + admin | admin | Update role, deactivate. |
| `POST /api/admin/pm-schedules` | JWT + admin | admin | Create PM schedule. |
| `PATCH /api/admin/pm-schedules/:id` | JWT + admin | admin | Update. |
| `POST /api/admin/pm-schedules/import` | JWT + admin | admin | Bulk import from .xlsx. |
| `POST /api/sources/alvys/sync` | JWT + admin OR cron token | admin | Pulls trucks/trailers/drivers from Alvys, upserts. |
| `GET /api/sources/intangles/mileage/:unit` | JWT | all | Live mileage from Intangles for a truck. |
| `POST /api/inference/ping` | JWT + admin | admin | Health-check Claude API. |
| `POST /api/intangles/ping` | JWT + admin | admin | Health-check Intangles. |

### Claude tools (Phase 3)

Bounded per role. Every tool has: timeout, structured logging, idempotency where applicable.

- `list_assets({type?, active?})` — all roles
- `query_pending_work({asset?, user?})` — all roles
- `get_meter_reading({unit_number, kind})` — all roles
- `report_issue({asset, title, description, raw_input})` — all roles
- `create_work_order({asset, type, title, description, raw_input, meter_reading?})` — tech, admin only
- `void_work_order({work_order_id, reason})` — owner within grace OR admin
- `ingest_pm_schedule_excel({file_path})` — admin only
- `set_pm_schedule({asset, scope, name, cadence_type, interval, last_completed?})` — admin only
- `upload_photo({work_order_id, file_path, caption?})` — owner only

## 7 — Data sources (Phase 3 scope)

**Day 1 (foundation):**
- Alvys sync — `assets`, `drivers` tables populated from Alvys API
- Intangles wrapper — read mileage for trucks with `intangles_device_id`
- Manual reefer hours — entered via chat ("CC-trailer-15 reefer is at 4,200 hours")
- Manual fallback for any asset

**Deferred until docs + creds arrive:**
- Monarch tracking (trucks)
- TrackFleet API (reefers)

## 8 — Phase plan

### Phase 2 — Schema + Auth + Bootstrap (this session, after PM approves v4)

- `supabase/migrations/0001_initial_schema.sql` — all tables + enums + indexes
- `supabase/migrations/0002_rls_policies.sql` — RLS on all tables, full policy set
- `supabase/migrations/0003_storage_bucket.sql` — `action-photos` bucket + policies
- `supabase/migrations/0004_seed_meta.sql` — minimal seed (no users, no assets)
- `db/seed/bootstrap_admin.mjs` — one-shot script: creates Lalo's admin user via Auth Admin API, sends magic-link invite
- Update `CLAUDE.md` PROJECT CONTEXT to v4
- Tests:
  - pgTAP-style integration tests for cascade behavior, enum rejection, RLS denial
  - Vitest unit test for bootstrap script idempotency

### Phase 3 — Chat brain + UI + first integrations

- `/api/chat` with Claude tool-use, bounded by caller role
- `/web` single-screen chat UI, file/photo attach, message thread persistence
- `/admin/users`, `/admin/pm-schedules`, `/assets/:unit` screens
- `/api/sources/alvys/sync` + first sync run
- `/api/sources/intangles/mileage/:unit` wrapper
- Confirm-after-write pattern across all `work_orders` tool calls
- Auth middleware verifying Supabase JWT, attaching `{userId, role}` to req

### Phase 4 — Deploy

- Push to GitHub (needs `gh` install or manual)
- Render web service (`/api`) + static site (`/web`)
- `delta.coldcargo.us` DNS + SSL
- Pre-deploy checklist (charter §6) on real phone
- Tag `foundation-v1` on `main`

## 9 — Open decisions (still need PM input before kickoff)

1. **Your email** for the bootstrap admin account
2. **Magic link or temp password** for first login (recommend magic link)
3. **Confirm-after-write grace window length** — how long can a tech "undo" before it locks? Default 5 min, configurable
4. (Acknowledged not blocking but flagging) **Monarch + TrackFleet docs/creds** — needed before Phase 3 expands beyond Intangles+manual

## 10 — Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Claude misclassifies a chat message and writes the wrong work order | high | Confirm-after-write pattern; raw_input always stored; grace-window undo; full audit_log |
| RLS policy gap leaks data across users | high | pgTAP tests for every policy; default-deny; security-advisor scan before each merge |
| Alvys API rate-limits sync | med | Cursor pagination, scheduled cron, backoff on 429 |
| PWA installs cache stale Supabase keys after key rotation | med | Service-worker activates on `versionchange`; bump SW version on each deploy |
| Telematics call inside a Claude tool exceeds tool-call timeout | med | 5s timeout on inner fetch; tool returns `{ ok:false, reason:'timeout' }` so Claude can recover gracefully |
| Tech enters a non-existent unit number | low | Tool returns suggestions ("did you mean CC07?"); Claude asks for confirmation |

## 11 — Sign-off

PM (Lalo): approve / push back on:

- [ ] Section 3 (product model)
- [ ] Section 4 (permission matrix)
- [ ] Section 5 (schema)
- [ ] Section 8 (phase plan)
- [ ] Section 9 (open decisions answered)

On approval, I rewrite `CLAUDE.md` PROJECT CONTEXT to match this doc, then begin Phase 2 schema work on the current branch (`feat/foundation-schema`).
