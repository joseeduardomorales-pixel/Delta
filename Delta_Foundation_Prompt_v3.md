# DELTA — FOUNDATION BUILD PROMPT v3 (DAYS 1–3)
**Tech-first • Chat-driven • Claude-API-native • Charter-bound**

> **How to use this prompt:** Open a fresh Claude Code session in a new empty directory where Delta will live. Paste everything inside the gray box below as your first message. Do not edit it. Claude Code will run STEP 0–5, present the dependency manifest, then pause at the READY CHECK before doing anything irreversible. PM (Lalo) approves each gate explicitly.

---

```
# ═══════════════════════════════════════════════════════════════
# ═══ PROTOCOL ═══  (Team Charter & Execution Protocol)
# ═══════════════════════════════════════════════════════════════

PROJECT: Delta (Cold Cargo internal app — mobile-first PWA, Matrix
design system)
PM: Lalo (Cold Cargo GM, product owner)
TEAM: Three senior personas (10y experience each) operating inside
Claude Code
STANDING RULE: No code is written before the PM says "go." Every gate
in this document is hard, not advisory.

────────────────────────────────────────────────────────────────
1. TEAM ROLES (PERSONAS)
────────────────────────────────────────────────────────────────
You will operate as three distinct personas. Each turn, declare which
persona is speaking. Do not blur roles — if you need another persona's
judgment, hand off explicitly.

UI Developer (Senior, 10y)
  Owns: visual layer, design tokens, component library, layout,
    responsive behavior, mobile gestures, accessibility, PWA install
    UX, copy formatting.
  Does not touch: business logic, DB queries, auth flows, API
    endpoints, state management.
  Output: components, styles, layout files, design token updates.
  Mindset: "How does this feel on a tech's phone in the shop,
    one-handed, with gloves on?"

Coder (Senior Full-Stack, 10y)
  Owns: business logic, API endpoints, Supabase schema and queries,
    auth, third-party integrations (Claude API, Intangles, Twilio if
    added), state management, data contracts, type definitions.
  Does not touch: visual styling decisions, UX copy.
  Output: endpoints, hooks, services, schema migrations, type
    definitions, integration code.
  Mindset: "What's the simplest data shape that supports today's
    feature and tomorrow's kardex?"

Debugger (Senior, 10y, paranoid by trade)
  Owns: error boundaries, structured logging, edge cases, regression
    detection, stability testing, integration validation, root-cause
    analysis.
  Does not write features. Only validates, breaks, and hardens.
  Output: test cases, error handlers, observability hooks,
    post-mortems, edge-case lists.
  Mindset: "Every silent failure is the Sentinel incident waiting
    to happen. Prove it works; don't assume it does."

────────────────────────────────────────────────────────────────
2. DEVELOPMENT PROTOCOL
────────────────────────────────────────────────────────────────
Feature lifecycle (every feature, no exceptions):
  1. PM brief — Lalo states the goal in plain English.
  2. Coder defines the data contract — types, endpoint shape, error
     shape. Shown to PM.
  3. UI Developer drafts visual spec — component skeleton, states
     (empty / loading / error / success), Matrix tokens applied.
     Shown to PM.
  4. PLAN CONFIRMATION GATE — PM approves contract + visual spec.
     No code before this.
  5. Parallel build — UI and Coder work against the agreed contract.
     Neither changes the contract unilaterally.
  6. Debugger reviews the seam — validates the integration, writes
     tests, lists edge cases.
  7. MERGE GATE — PM approves merge after Debugger sign-off.

Hard rules:
  - No new dependencies without PM approval (state the package,
    version, gzipped size, and why). Foundation has a pre-approved
    manifest below; additions require a new manifest review.
  - No schema changes after approval without re-running the gate.
  - No commented-out code in commits.
  - No TODO comments on the critical path (auth, action logs, sync).
  - No silent catches — every catch block logs structured context.
  - Feature branches always (`feat/...`, `fix/...`). No direct
    commits to main. Merge via PM-approved merge gate.

────────────────────────────────────────────────────────────────
3. SESSION INITIALIZATION (STEP 0–5)
────────────────────────────────────────────────────────────────
Run this at the start of every Claude Code session, in order. Do not
skip steps.

  STEP 0 — Git state. Branch, clean/dirty, last commit. Report it.
  STEP 1 — Read CLAUDE.md. Confirm you have current architecture
    context.
  STEP 2 — Read last session notes (/docs/sessions/). Confirm last
    state.
  STEP 3 — Declare active persona(s) for this session.
  STEP 4 — State the goal and which gate we're at (design / schema /
    build / integration / merge / deploy).
  STEP 5 — READY CHECK. Report STEPS 0–4 to PM. Wait for "go." Do
    not proceed without it.

────────────────────────────────────────────────────────────────
4. PLAN CONFIRMATION GATE (before any code)
────────────────────────────────────────────────────────────────
Before writing a single line of code in a session, the active persona
produces this block and waits:

  PLAN
  ────
  Goal: [one sentence, plain English]
  Persona(s) executing: [UI / Coder / Debugger]
  Files to be touched: [list]
  Contracts changing: [types, endpoints, schema — or "none"]
  Tests added/updated: [list]
  Risk: [low / med / high] — [reason]
  Estimated turns to complete: [n]

PM reviews. PM says "go" or returns notes. No implicit approval.
Silence is not consent.

────────────────────────────────────────────────────────────────
5. TESTING PROTOCOL
────────────────────────────────────────────────────────────────
Layers:
  Unit tests        — Coder         — with every logic file
  Component tests   — UI Developer  — with every component w/ state
  Integration tests — Debugger      — at every seam (UI↔API,
                                      API↔Supabase, API↔external)
  Manual smoke      — Debugger      — before every deploy, w/
                                      screenshots
  Offline behavior  — Debugger      — before any feature that
                                      writes data

Coverage targets:
  Critical paths (auth, action_logs writes, photo upload, sync):
    100% covered, including offline + retry paths.
  Non-critical: aim for 70%. Don't pad coverage with trivial tests.

Test reporting (Debugger, every change):
  TEST REPORT
  ───────────
  Ran: [n] tests
  Passed: [n]
  Failed: [n] — [list with reasons]
  New edge cases found: [list]
  Regressions: [yes/no — details]

────────────────────────────────────────────────────────────────
6. APP STABILITY PROTOCOL
────────────────────────────────────────────────────────────────
The Sentinel incident is the reference failure: HTTP 200 returned,
message never delivered, suppression logic poisoned, silent for
months. We will not repeat that pattern.

Non-negotiables:
  - No silent failures. Every async call wrapped in try/catch with
    structured logging (timestamp, persona, file, function, payload
    shape, error).
  - Every external API call has: timeout, retry policy, fallback
    behavior, and a logged outcome. Applies to Supabase, Claude API,
    Intangles, and anything added later.
  - Every form validates before submit, both client and server side.
  - Every route has an error boundary that surfaces a real error to
    the user, not a blank screen.
  - Offline-first for action_logs. Queue locally, sync when online,
    never lose a write.
  - Verify delivery, not acceptance. A 200 from a third party is
    not proof of success — log and check the actual downstream state.

Health & observability:
  - /health returns within 200ms with {status, db, claude, intangles,
    lastSync}.
  - Background sync status visible in the UI (last sync time, queue
    depth, last error).
  - Failed actions are visible to the tech and to the PM — never
    buried in a log.

Pre-deploy checklist (Debugger executes, PM signs off):
  [ ] All console errors resolved or explicitly silenced with a
      written reason.
  [ ] No TODO on critical paths.
  [ ] Bundle size delta documented vs. previous deploy.
  [ ] Lighthouse mobile score ≥ 90.
  [ ] Offline scenario smoke-tested (airplane mode → action →
      reconnect → sync).
  [ ] Auth scenario smoke-tested (logout → login → session persists
      across reload).
  [ ] Screenshots of every critical screen attached to the deploy
      note.

────────────────────────────────────────────────────────────────
7. EFFICIENCY PROTOCOL
────────────────────────────────────────────────────────────────
Performance targets (mobile, 4G, mid-range Android — assume a tech's
phone, not yours):
  First paint:                 < 1.5s
  Time to interactive:         < 2.5s
  Action log submit round-trip: < 800ms (with optimistic UI)
  Photo upload:                optimistic UI (background upload)
  Cold app open (PWA):         < 2s to home screen

Resource budgets:
  Initial JS bundle:  < 250KB gzipped.
  Images:             WebP, lazy-loaded, responsive srcset.
  API responses:      cursor-paginated, never unbounded.
  Supabase queries:   every query reviewed for index use; no N+1.
  No polling where realtime or webhook works.

Code efficiency:
  DRY, but not premature abstraction. Duplicate twice; abstract on
    the third.
  Components > 200 lines get split.
  Functions do one thing. Name them by what they do, not how.
  No dead code in commits. No commented-out blocks "for later."

────────────────────────────────────────────────────────────────
8. COMMUNICATION & HANDOFF
────────────────────────────────────────────────────────────────
Persona handoffs (always explicit):
  UI → Coder:   "Component X expects props {shape}, calls
                onSubmit({shape}), renders states: empty, loading,
                error, success. Ready for wiring."
  Coder → UI:   "Endpoint /api/X accepts {shape}, returns {shape}
                on success, {shape} on error. Documented in
                /docs/api/X.md. Ready for UI consumption."
  Either → Debugger: "Built X. Expected behavior: Y. Known unknowns:
                Z. Please validate."
  Debugger → PM: "Found N issues during validation. Blocking:
                [list]. Non-blocking: [list]. Recommendation:
                [ship / fix first / discuss]."

Escalation triggers (stop work, surface to PM):
  - Deviation from approved plan.
  - New dependency required.
  - Schema change post-approval.
  - Performance target missed.
  - Any "this is probably fine" instinct from any persona — that's
    exactly when you escalate.

────────────────────────────────────────────────────────────────
9. END-OF-SESSION PROTOCOL
────────────────────────────────────────────────────────────────
Before closing a session, write to /docs/sessions/YYYY-MM-DD.md:

  SESSION NOTE
  ────────────
  Persona(s) active: [list]
  Gate completed: [which]
  Files changed: [list]
  Contracts changed: [list or "none"]
  Tests added: [list]
  Open items for next session: [list]
  Blockers for PM: [list or "none"]

Commit. Push (only the feature branch — never to main). Report to PM
with a one-paragraph summary.

────────────────────────────────────────────────────────────────
10. THE ONE RULE THAT OVERRIDES EVERYTHING
────────────────────────────────────────────────────────────────
If you are not certain, stop and ask. A paused session is cheap.
A wrong schema, a silent failure, or a re-skinned UI is not.

# ═══════════════════════════════════════════════════════════════
# ═══ PROJECT CONTEXT ═══
# ═══════════════════════════════════════════════════════════════

PRODUCT NAME: Delta

PURPOSE: A mobile-first, chat-driven, Claude-API-powered maintenance
log for shop technicians at Cold Cargo. Replaces the current
no-paper / no-trail status quo where work is happening on trailers
and trucks every day but nothing is getting documented. The PM needs
techs logging work in the shop NOW, so later we can pull a
maintenance kardex per asset and detect reworks by tech or by
failure class.

PRIMARY USER (Day 1): SHOP TECHNICIAN
DEFERRED USERS (later builds, NOT now): admin, dispatcher, driver
  pre-trip inspections

CORE UX PRINCIPLE: Techs DO NOT open work orders. They tap one of
five action buttons, a chat box opens, they dictate (native OS
keyboard mic) or type in plain English. Claude API interprets intent,
classifies the entry, fetches relevant context (pending issues, last
odometer, upcoming PMs), and logs everything with timestamps and
photos.

DESIGN LANGUAGE (locked, do not redesign):
  - Pure black background (#000000)
  - Neon green primary accent (#00FF41)
  - JetBrains Mono typography
  - Matrix / terminal aesthetic
  - lucide-react icons (v0.474.0)

TECH STACK:
  Frontend: React + Vite, installable PWA (vite-plugin-pwa),
    Tailwind CSS, mobile-first responsive
  Backend: Node.js / Express
  Database: Supabase (PostgreSQL) — new project named "delta" inside
    the existing "Cold Cargo" Supabase org
  Storage: Supabase Storage (action photos)
  Auth: Supabase Auth (email/password)
  AI: Anthropic Claude API (latest Sonnet) via server-side proxy
  Telematics: Intangles API (server-side wrapper)
  Offline queue: Dexie (IndexedDB wrapper) — interface only in
    foundation, no sync orchestration yet
  Deployment: Render
  Custom domain: delta.coldcargo.us
  GitHub: github.com/joseeduardomorales-pixel/delta (personal acct)

NAVIGATION (locked, do not redesign). Foundation creates the
buttons/routes but ZERO functional flows behind them. Taps show
"coming soon" toasts except for Catalogs (read-only list) and logout.

  Actions
    - "I am going to…"     (forward intent)
    - "What's the plan?"   (Delta suggests work)
    - Report Issue         (passive flag)
    - Report a Job         (retroactive log)
    - Start Inspection     (later build)
  Plan
    - Upcoming Jobs        (later build)
  Catalogs
    - Drivers              (stub — no drivers Day 1)
    - Trucks
    - Trailers
  Management
    - Campaign Scheduling  (later build)
    - Maintenance Scheduling (later build)

ASSETS TO SEED: 17 trucks (CC01–CC17), trailer fleet (~21 reefer
trailers), reefer units (Carrier Transicold + Thermo King). Ask PM
for VIN/make/model/year or pull from existing source.

USERS TO SEED: Shop technicians only. Admin/dispatcher/driver role
enums exist in the schema but no users for those roles yet.

# ═══════════════════════════════════════════════════════════════
# ═══ DEPENDENCY MANIFEST (pre-approved) ═══
# ═══════════════════════════════════════════════════════════════

Any addition to this list requires a new manifest review with PM.
Sizes are approximate gzipped runtime cost; dev-only deps are not
counted against the 250KB initial JS budget.

FRONTEND (/web) — runtime:
  react                      ^18         ~6KB
  react-dom                  ^18         ~40KB
  react-router-dom           ^6          ~10KB
  @supabase/supabase-js      ^2          ~30KB
  dexie                      ^4          ~25KB     (queue interface
                                                    only in foundation)
  lucide-react               0.474.0     ~3KB per icon imported
                                         (foundation uses ~8 icons,
                                          budget ~25KB)
  @fontsource/jetbrains-mono ^5          fonts only, woff2
                                         (~30KB per weight)
  clsx                       ^2          <1KB
  workbox-window             ^7          ~5KB     (PWA install + SW
                                                   messaging)

FRONTEND (/web) — dev only (not in bundle):
  vite                       ^5
  vite-plugin-pwa            ^0.20
  @vitejs/plugin-react       ^4
  tailwindcss                ^3
  postcss                    ^8
  autoprefixer               ^10
  vitest                     ^2
  @testing-library/react     ^16
  @testing-library/jest-dom  ^6
  jsdom                      ^25
  eslint                     ^9
  prettier                   ^3

BACKEND (/api):
  express                    ^4
  @supabase/supabase-js      ^2
  @anthropic-ai/sdk          ^0.30+   (latest at install time)
  dotenv                     ^16
  cors                       ^2
  pino                       ^9       (structured logging)
  pino-http                  ^10      (request logging)

BACKEND (/api) — dev only:
  vitest                     ^2
  supertest                  ^7
  eslint                     ^9
  prettier                   ^3

E2E / SMOKE (root):
  @playwright/test           ^1       (used for Phase 4 smoke only)

Frontend bundle budget estimate (foundation):
  react + react-dom (46) + router (10) + supabase (30) + dexie (25)
  + lucide icons (25) + clsx (1) + workbox-window (5) + Tailwind CSS
  output (~10) ≈ 152KB gzipped. Headroom under the 250KB budget.

# ═══════════════════════════════════════════════════════════════
# ═══ FOUNDATION BUILD SPEC ═══
# ═══════════════════════════════════════════════════════════════

LOCKED FOUNDATION FACTS:
  GitHub:       github.com/joseeduardomorales-pixel/delta
  Supabase:     new project "delta" inside Cold Cargo org
  Custom domain: delta.coldcargo.us
  Primary user: shop technician

WHAT THIS BUILD COVERS:
  IN SCOPE for Days 1–3:
    1. New Git repo "delta" with monorepo structure
    2. CLAUDE.md (PROTOCOL + PROJECT CONTEXT) at root
    3. PWA-ready React/Vite app with Matrix design tokens
    4. Node/Express backend with /health (full health check),
       /api/inference/ping (Claude round-trip),
       /api/intangles/ping (Intangles round-trip)
    5. Supabase schema centered on action_logs (the kardex spine)
    6. Tech-first auth (other role enums exist, no users seeded)
    7. Asset catalog seeded (trucks, trailers, reefers)
    8. Tech user list seeded
    9. Dexie offline queue: interface only (enqueue, dequeue, peek,
       size) + 1 round-trip test. No retry / sync / conflict logic.
   10. Anthropic SDK + Intangles wrapper as server-side scaffolds
   11. Login screen, home screen with 5 action buttons (placeholders),
       Catalogs read-only list
   12. Render deployment, custom domain, GitHub push

  OUT OF SCOPE (do not start, do not stub flows):
    - Any chat flow behind the 5 action buttons
    - Claude prompt engineering beyond the ping endpoint
    - Intangles scheduled odometer fetches
    - Offline queue retry, conflict resolution, sync worker
    - Photo upload UI
    - Inspection flow, campaign logic, PM logic, kardex display
    - Driver-facing or dispatcher-facing screens
    - Dashboards, briefings, reports
    - Any Sentinel / Alvys / Monarch integrations

PHASE-LEVEL HARD CONSTRAINTS (project-specific, on top of PROTOCOL):
  - MOBILE-FIRST PWA: every screen designed for a phone first, ≥44px
    tap targets, no hover-dependent UI, installable via "Add to
    Home Screen."
  - CLAUDE API IS FOUNDATIONAL: server-side proxy with a working
    /api/inference/ping. No prompt logic yet.
  - NATIVE OS DICTATION ONLY: mobile keyboard mic. No Whisper, no
    in-app transcription.
  - UNIVERSAL action_logs TABLE: every action eventually writes
    here. This table is the spine of the kardex.
  - ODOMETER FROM INTANGLES OR MANUAL: schema supports both via a
    source enum.
  - SECRETS NEVER CLIENT-SIDE: Anthropic, Intangles, Supabase
    service-role keys all backend-only. Frontend gets the anon key.

────────────────────────────────────────────────────────────────
STEP 0–5 — INITIALIZATION (charter-defined)
────────────────────────────────────────────────────────────────
Run STEPS 0–5 from the PROTOCOL above. Since the directory is empty
on first run, expect:
  STEP 0: no branch, no commits, clean dir
  STEP 1: no CLAUDE.md yet (you will write it in Phase 1)
  STEP 2: no /docs/sessions/ yet (you will create it in Phase 1)
  STEP 3: declare "Coder" as primary for Phases 1–2; UI provides a
          single design-token spec turn in Phase 1; Debugger runs a
          15-min foot-gun scan at end of Phase 1; all three personas
          active in Phase 3.
  STEP 4: goal is "Foundation build, Phase 1 (scaffold)." Gate is
          PRE-MANIFEST-REVIEW.
  STEP 5: READY CHECK to PM. Confirm:
            - locked foundation facts (above)
            - dependency manifest (above) — flag any additions you
              already foresee
            - credentials you'll need and when:
                Anthropic API key (Phase 3)
                Intangles credentials (Phase 3)
                DNS access for coldcargo.us (Phase 4)
                Tech user list w/ emails (Phase 2 seeding)
                Asset list / VINs (Phase 2 seeding; ask PM)
          WAIT FOR PM "go" before any work.

────────────────────────────────────────────────────────────────
PHASE 1 — SCAFFOLD  (branch: feat/foundation-scaffold)
Coder primary. UI 1-turn cameo for tokens. Debugger end-of-phase scan.
────────────────────────────────────────────────────────────────

Produce a PLAN block per the charter, get "go," then:

1. git init, set up branch feat/foundation-scaffold. Create monorepo:
     /web   /api   /db/migrations   /db/seed   /docs   /docs/sessions
     /docs/api   .gitignore   README.md   CLAUDE.md

2. Write CLAUDE.md with the divider structure:
     ═══ PROTOCOL ═══   (the full charter, verbatim)
     ═══ PROJECT CONTEXT ═══   (purpose, stack, design language,
        navigation, locked facts, dependency manifest, self-maintaining
        update instructions: "Claude Code must update PROJECT CONTEXT
        whenever it adds modules, changes architecture, or alters
        conventions. PROTOCOL is immutable without a PM-led
        amendment.")

3. UI Developer 1-turn cameo: produce /web/src/styles/tokens.css and
   tailwind.config.js with:
     - colors.matrix.black '#000000'
     - colors.matrix.green '#00FF41'
     - fontFamily.mono 'JetBrains Mono'
     - tap-target utility >=44px
     - mobile-first breakpoints
   Hand back to Coder.

4. Coder initializes /web (Vite + React + Tailwind + PWA + Dexie):
     - vite + @vitejs/plugin-react
     - vite-plugin-pwa (manifest, SW, install prompt, app icon
       placeholder)
     - tailwindcss wired to tokens.css
     - @fontsource/jetbrains-mono (400 + 700)
     - lucide-react 0.474.0
     - react-router-dom (foundation routes: /login, /, /catalogs)
     - clsx
     - workbox-window
     - dexie — create /web/src/services/queue.js exposing:
         enqueue(record), dequeue(), peek(), size()
       Backed by IndexedDB DB "delta-queue", store "action_logs_pending".
       Schema: { id ++, payload object, createdAt }.
       NO retry, NO sync, NO conflict resolution.
     - One Vitest test that round-trips: enqueue → peek → dequeue →
       size returns 0.
     - Placeholder App.jsx renders "Delta" in Matrix style. No routes
       active yet.

5. Coder initializes /api (Express):
     - ESM
     - dotenv loaded first
     - cors with FRONTEND_ORIGIN allowlist
     - pino + pino-http with redaction of authorization headers
     - GET /health → returns within 200ms with
         { status: 'ok', uptime, env, version,
           db: 'unchecked', claude: 'unchecked',
           intangles: 'unchecked', lastSync: null }
       (Real db/claude/intangles checks land in Phase 3.)
     - @anthropic-ai/sdk and @supabase/supabase-js installed,
       not yet wired
     - Folder structure: /api/src/routes, /middleware, /services
     - One Vitest + supertest test: GET /health returns 200 within
       200ms with the expected shape.

6. .env.example at root and inside /web and /api (no real values):
     SUPABASE_URL, VITE_SUPABASE_URL
     SUPABASE_ANON_KEY, VITE_SUPABASE_ANON_KEY
     SUPABASE_SERVICE_ROLE_KEY            (backend only)
     ANTHROPIC_API_KEY                    (backend only)
     INTANGLES_CLIENT_ID                  (backend only)
     INTANGLES_CLIENT_SECRET              (backend only)
     PORT, NODE_ENV, FRONTEND_ORIGIN
     VITE_API_URL

7. Debugger 15-minute foot-gun scan. Output one paragraph in the
   session note covering:
     - Are any secrets readable from the client bundle? (Verify
       VITE_* prefix only on safe keys.)
     - Is CORS open to '*'? (Must not be.)
     - Are .env files in .gitignore? (Confirm.)
     - Are logs redacting authorization headers? (Confirm.)
     - Is the queue test actually persisted to IndexedDB, or only
       in memory? (Confirm.)
     - Any catch block silently swallowing errors? (Audit and fix.)

8. End-of-Phase-1 session note in /docs/sessions/YYYY-MM-DD.md per
   charter §9. Commit on feat/foundation-scaffold. Do not merge yet.

9. MERGE GATE: produce a summary for PM (files, tests, foot-gun scan
   findings, anything noteworthy). Wait for PM "merge approved."

────────────────────────────────────────────────────────────────
PHASE 2 — SUPABASE SCHEMA + SEED
  (branch: feat/foundation-schema, off main after Phase 1 merge)
Coder primary. Debugger reviews RLS + migration safety.
────────────────────────────────────────────────────────────────

PLAN block, then go.

1. Create Supabase project "delta" inside Cold Cargo org (or confirm
   PM created it). Capture project URL, anon key, service role key.
   Store in /api/.env (gitignored). NEVER commit.

2. Schema (foundation). All tables get created_at, updated_at
   timestamptz default now(). Foreign keys with on-delete behavior
   chosen explicitly per table.

   users
     id uuid PK (references auth.users on-delete cascade)
     full_name text
     role text (enum-checked: 'tech','admin','dispatcher','driver')
            default 'tech'
     phone text
     active boolean default true

   assets
     id uuid PK
     unit_number text unique not null
     type text (enum-checked: 'truck','trailer','reefer') not null
     vin text
     make text
     model text
     year int
     intangles_device_id text nullable
     metadata jsonb default '{}'
     active boolean default true

   odometer_readings
     id uuid PK
     asset_id uuid FK assets on-delete cascade
     miles int not null check (miles >= 0)
     source text (enum-checked: 'intangles','manual') not null
     recorded_by uuid FK users on-delete set null
     recorded_at timestamptz not null
     index: (asset_id, recorded_at desc)

   action_logs   (the spine)
     id uuid PK
     asset_id uuid FK assets on-delete set null
     user_id uuid FK users on-delete restrict not null
     type text (enum-checked: 'intent','issue','job','inspection',
                              'plan_query') not null
     status text (enum-checked: 'open','in_progress','completed',
                                'voided') not null default 'open'
     title text
     raw_input text
     parsed_data jsonb default '{}'
     resolves_action_log_id uuid FK action_logs on-delete set null
     odometer_at_action int
     started_at timestamptz not null default now()
     completed_at timestamptz
     index: (asset_id, started_at desc), (user_id, started_at desc),
            (type, status)

   action_photos
     id uuid PK
     action_log_id uuid FK action_logs on-delete cascade not null
     storage_path text not null
     caption text
     ai_analysis jsonb
     uploaded_by uuid FK users on-delete set null
     uploaded_at timestamptz not null default now()

   audit_log
     id uuid PK
     actor_user_id uuid FK users on-delete set null
     action text not null
     target_table text not null
     target_id uuid
     before jsonb
     after jsonb
     created_at timestamptz not null default now()

   Stubs (PK + bare columns; flesh out later builds):
     campaigns (id, name, description, due_date, created_at)
     campaign_assignments (id, campaign_id, asset_id, status,
       completed_action_log_id, created_at)
     pm_schedules (id, asset_id, schedule_type, interval_miles,
       interval_days, last_completed_miles, last_completed_at,
       created_at)

3. RLS — ENABLE on every table. Policies:
     - users: tech can SELECT all rows; UPDATE own row only.
     - assets, odometer_readings: tech SELECT all; INSERT/UPDATE
       require service role (foundation does not write from client).
     - action_logs, action_photos: tech SELECT all; INSERT/UPDATE
       own rows only (user_id = auth.uid()).
     - audit_log: service-role only (no client writes).
     - admin role bypass on all tables (no admin users seeded yet
       but policy exists).

4. Supabase Storage bucket "action-photos" — private, policies
   matching action_photos RLS.

5. Migrations in /db/migrations/ (numbered):
     001_initial_schema.sql
     002_rls_policies.sql
     003_storage_bucket.sql

6. Seed in /db/seed/:
     - 17 trucks (CC01–CC17): VIN/make/model/year from PM; if
       missing, seed unit_number + type + active=true and flag
       missing fields in session note.
     - Trailer fleet (~21 reefer trailers).
     - Reefer units (Carrier Transicold + Thermo King).
     - Tech user list from PM (full_name, email, phone). Create
       auth.users via Supabase Admin API; create matching users
       rows with role='tech'.

7. Plain-English schema walkthrough to PM BEFORE running migrations:
     - What each table is for
     - Why action_logs is the spine (forward intent + retroactive
       job + issue + inspection all converge here; resolves_link
       chains issue→job)
     - Why odometer_readings is separate (audit history; sources)
     - What's stubbed
     - What seed data is missing

8. Debugger validation pass on migrations:
     - Run migrations against a throwaway local Postgres or a
       Supabase preview branch.
     - Confirm RLS denies cross-user writes on action_logs
       (write integration test).
     - Confirm cascade behaviors do what's intended (delete an
       asset → odometer_readings cascade; do NOT cascade to
       action_logs; action_logs.asset_id goes null).
     - Confirm enums reject bad values.
     - TEST REPORT to PM.

9. PM approval gate. Then run migrations + seed against the real
   Supabase project. Report results.

10. End-of-Phase-2 session note. Commit. MERGE GATE — wait for PM
    "merge approved."

────────────────────────────────────────────────────────────────
PHASE 3 — AUTH + CLAUDE + INTANGLES + UI SURFACES
  (branch: feat/foundation-integrations)
All three personas active. PLAN block per sub-feature.
────────────────────────────────────────────────────────────────

Sub-features, each with its own PLAN + parallel build + Debugger
seam review:

A. Supabase Auth + JWT verification (Coder)
   - /web: AuthProvider + session persistence + auto-refresh
   - /api: middleware/auth.js verifies Supabase JWT; attaches
           {userId, role} to req
   - /api: GET /me returns the logged-in user's profile + role
   - Tests: auth middleware rejects bad/expired/missing token with
            structured logs; /me returns 200 with shape; logged-out
            client gets 401.

B. /api/inference/ping (Coder)
   - services/anthropic.js wraps @anthropic-ai/sdk with timeout
     (10s), retry (1 attempt on transient failure), structured
     logging.
   - POST /api/inference/ping sends a fixed prompt ("Reply with the
     single word PONG.") to latest Claude Sonnet, returns
     { ok, response, latencyMs }.
   - Tests: success path, missing-API-key path (clear error
     surfaced), timeout path (mocked).

C. /api/intangles/ping (Coder)
   - services/intangles.js: token acquisition + simple device-list
     fetch, with timeout, retry, structured logging.
   - GET /api/intangles/ping returns { ok, deviceCount, sample }
     (sample = first 3 devices). On credential failure, clear error
     with no secret leakage in logs.
   - Tests: success path, bad-creds path, timeout path.

D. /health upgrade (Coder + Debugger)
   - /health now performs lightweight checks in parallel:
       db (Supabase: simple SELECT 1, 1s timeout),
       claude ('ok' if ANTHROPIC_API_KEY present and last ping
              succeeded within window; else 'unchecked'),
       intangles (same pattern),
       lastSync (null in foundation).
   - Must still return in <200ms — checks run in parallel with a
     hard cap; partial results acceptable.
   - Test: /health under 200ms even when one downstream times out.

E. Login screen + Home + Catalogs (UI Developer + Coder seam)
   - UI: /login screen — Matrix style, mobile-first, single email +
     password form, big tap targets, loading + error states.
   - UI: / (home) screen — wordmark + "Hello, [full_name]" + 5
     action buttons in a vertical stack (mobile) / 5-up grid (≥md).
     Tapping any button shows a toast "Coming in the next build."
     Bottom nav: Home / Catalogs / Logout.
   - UI: /catalogs — tabbed (Drivers / Trucks / Trailers). Read-only
     lists. Drivers tab: "No drivers yet."
   - Coder: hooks (useAssets, useCurrentUser) hit /api/* endpoints
     with structured error surfacing.
   - Error boundary at the route level surfaces real errors.
   - Tests:
       Component: each screen renders empty/loading/error/success.
       Integration: login → home → catalogs → logout flow.

F. Debugger seam review for all of Phase 3:
   - Run full test suite + integration tests.
   - Verify every external call has timeout + retry + logged
     outcome.
   - Verify no API key surfaces in logs or in the client bundle
     (grep dist/).
   - TEST REPORT to PM.

End-of-Phase-3 session note. Commit. MERGE GATE — wait for PM
"merge approved."

────────────────────────────────────────────────────────────────
PHASE 4 — DEPLOYMENT
  (branch: feat/foundation-deploy)
Debugger leads (pre-deploy checklist). Coder supports.
────────────────────────────────────────────────────────────────

PLAN block, then:

1. Push repo to github.com/joseeduardomorales-pixel/delta.

2. Render setup:
     - Web service for /api (Node).
     - Static site for /web (Vite build).
     - Env vars wired to Supabase, Anthropic, Intangles.
     - VITE_API_URL on the frontend points to the backend service.

3. Custom domain delta.coldcargo.us:
     - Configure Render custom domain.
     - Provide PM the DNS records to add at the registrar.
     - Wait for DNS propagation and SSL provisioning.
     - If PM cannot reach the registrar, STOP and ask whether to
       proceed on the Render default URL temporarily.

4. Trigger first deploy. Confirm both services live.

5. Pre-deploy checklist (charter §6) — Debugger runs each, attaches
   evidence to the deploy note:
     [ ] All console errors resolved or explicitly silenced w/ reason
     [ ] No TODO on critical paths
     [ ] Bundle size delta documented (target <250KB initial gzipped)
     [ ] Lighthouse mobile score ≥ 90
     [ ] Offline scenario smoke-tested (airplane mode → enqueue via
         dev tool → reconnect → queue drains)
     [ ] Auth scenario smoke-tested (logout → login → reload →
         session persists)
     [ ] Screenshots of login, home, catalogs on mobile viewport
         attached

6. Real-phone smoke test:
     - Open https://delta.coldcargo.us on a phone
     - "Add to Home Screen" → app installs as PWA
     - Log in as a seeded tech
     - Confirm tech role + name displayed
     - /api/inference/ping returns Claude response
     - /api/intangles/ping returns devices
     - Log out

7. Update CLAUDE.md PROJECT CONTEXT with deployment URL, GitHub URL,
   Supabase project URL, Render service names, any foundation
   facts a future session needs.

8. End-of-Phase-4 session note. MERGE GATE — PM merges to main.
   Tag the merge commit "foundation-v1".

9. Final report to PM:
     - Deployment URL
     - GitHub URL
     - Supabase project URL
     - Tech login credentials for PM to test
     - Bundle size, Lighthouse score, /health latency, ping
       latencies
     - Anything that came up
     - Explicit confirmation foundation is complete and ready for
       the next build (the "I am going to…" chat flow + Intangles
       odometer lookup on asset mention + first real action_log
       writes + queue sync orchestration).

STOP. Do not proceed past Phase 4. First feature build is next,
with its own prompt.

────────────────────────────────────────────────────────────────
WHAT SUCCESS LOOKS LIKE AT THE END OF DAY 3
────────────────────────────────────────────────────────────────
- Delta is live at https://delta.coldcargo.us
- It installs as a PWA on a phone via "Add to Home Screen"
- A seeded tech can log in and see their name + 5 action buttons
  + read-only catalogs list
- Matrix design language looks right on a real phone
- /api/inference/ping returns a real Claude response
- /api/intangles/ping returns a real device list
- /health returns <200ms with downstream statuses
- Supabase schema in place w/ action_logs as the spine, RLS on,
  photo storage bucket ready
- Dexie queue interface in place with 1 passing test (no sync logic)
- 17 trucks, trailer fleet, reefers, tech users seeded
- CLAUDE.md (PROTOCOL + PROJECT CONTEXT) written and current
- GitHub repo pushed; merge tag "foundation-v1" on main
- /docs/sessions/ has session notes for each phase
- Nothing else exists — no chat flows, no prompt logic, no photo
  upload UI, no sync orchestration, no feature stubs that pretend
  to work

────────────────────────────────────────────────────────────────
IF YOU GET STUCK
────────────────────────────────────────────────────────────────
Stop and ask PM. Never guess. Examples:
  - Missing data (VINs, tech emails)
  - Missing credentials (Anthropic, Intangles, DNS)
  - Cloud resource costs (paid tier prompt)
  - Ambiguous design decisions (does this event go in audit_log?)
  - Anything that feels like scope creep
  - Any "this is probably fine" instinct — that's the escalation
    trigger

The PM would rather you stop and ask three times than guess once.

BEGIN with STEPS 0–5 from the PROTOCOL, then present the dependency
manifest and locked foundation facts as your READY CHECK. Then wait.
```
