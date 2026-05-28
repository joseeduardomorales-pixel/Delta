# CLAUDE.md — Delta

This file is the entry point for every Claude Code session on Delta. It has two parts:

- **PROTOCOL** — team charter and execution rules. Immutable without a PM-led amendment.
- **PROJECT CONTEXT** — what Delta is, the stack, current state, deferred work. Claude Code must update this whenever it adds modules, changes architecture, or alters conventions.

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

> **Maintenance note:** Claude Code must update PROJECT CONTEXT
> whenever it adds modules, changes architecture, or alters
> conventions. PROTOCOL above is immutable without a PM-led
> amendment.

PRODUCT NAME: Delta

PURPOSE: A mobile-first, chat-driven, Claude-API-powered maintenance
log for shop technicians at Cold Cargo. Replaces the current
no-paper / no-trail status quo where work is happening on trailers
and trucks every day but nothing is getting documented. The PM needs
techs logging work in the shop NOW, so later we can pull a
maintenance kardex per asset and detect reworks by tech or by
failure class.

PRIMARY USERS (v4): SHOP TECHNICIAN (chat surface), PM/ADMIN (admin
  surface). Dispatcher role exists with limited write rights.
DEFERRED ROLES: driver (enum exists in schema, no users, no policies).

CORE UX PRINCIPLE (v4 pivot from v3):
Techs see ONE screen — a chat thread + input box. They dictate via
native OS keyboard mic or type in plain English. The backend routes
every message through Claude (tool-use), which interprets intent,
fetches context (pending issues, last meter reading, upcoming PMs),
and writes structured rows to `work_orders` — the kardex spine.

Every Claude-driven write to `work_orders` echoes a confirmation back
("Logged WO-1487 on CC07 at 86,432 mi — say 'undo' to remove") with
a 5-minute grace window for the tech to undo. This is the
Sentinel-class safety net: silent miswrites can't happen.

PM/admin uses a separate, desktop-friendly surface at /admin/* for
managing users, defining PM schedules, and reviewing the per-asset
work-order history (the kardex view).

DESIGN LANGUAGE (v2 — Minimalist Modern, PM-approved 2026-05-27):
  - Canvas: #FAFAFA warm off-white background; #FFFFFF card surfaces
  - Foreground: #0F172A Slate-900
  - Primary accent: Electric Blue gradient #0052FF → #4D7CFF
  - Semantic palette: success #16A34A, warning #F59E0B, danger #DC2626,
    info #0EA5E9
  - Typography (dual + mono):
      Calistoga (display)  — h1/h2 only, the "personality" voice
      Inter (UI + body)    — everything else, the "clarity" voice
      JetBrains Mono       — section labels (uppercase tracked),
                             identifiers (WO ids, VINs, code-like data)
  - Tap target floor: 44×44 px
  - Mobile-first breakpoints unchanged from Phase 1
  - lucide-react icons (v0.474.0) for all UI iconography
  - Full spec: docs/design-system-v2.md (authoritative)
  - v1 (Matrix) archived: docs/archive/design-system-v1-matrix.md

  Surface calibration:
    /login          full showcase (gradient headline, rotating ring)
    /admin/*        full system (motion, hover lifts, breathing)
    /assets/:unit   mid (new tokens, subtle hover, no decorative motion)
    /             chat: RESTRAINED — new palette/type/primitives, NO
                  decorative motion (tech speed/density matters more
                  than visual flourish on a phone in the shop)

TECH STACK:
  Frontend: React + Vite, installable PWA (vite-plugin-pwa),
    Tailwind CSS, mobile-first responsive
  Backend: Node.js / Express
  Database: Supabase (PostgreSQL) — new project named "delta" inside
    the existing "Cold Cargo" Supabase org
  Storage: Supabase Storage (action photos)
  Auth: Supabase Auth (email/password)
  AI: Anthropic Claude API (latest Sonnet) via server-side proxy
  Telematics (truck miles): Intangles + Monarch
    (Monarch deferred until docs/creds land)
  Telematics (reefer hours): TrackFleet + manual entry
    (TrackFleet deferred until docs/creds land)
  Fleet catalog source: Alvys API (read-only mirror in Supabase
    via periodic sync; never queried directly from the client)
  Offline queue: Dexie (IndexedDB wrapper) — interface only in
    foundation, no sync orchestration yet
  Deployment: Render
  Custom domain: delta.coldcargo.us
  GitHub: github.com/joseeduardomorales-pixel/delta (personal acct)

ROUTES (v4):

  Tech / dispatcher / admin (all roles):
    /login                       email + password (Supabase Auth)
    /                            chat thread + input + file attach
    /assets/:unit_number         read-only work-order history (kardex)

  Admin-only (role-gated):
    /admin/users                 list / add / change role / deactivate
    /admin/pm-schedules          create / edit / bulk-import schedules

All routes other than /login require an authenticated session.
Role-gating is enforced at the route boundary (router guard) AND in
RLS at the DB layer — defense in depth.

PERMISSION MATRIX (locked):
  Capability                              Admin   Dispatch   Tech
  View assets / WOs / PM schedules         ✓        ✓         ✓
  Report an issue (work_orders.type=issue) ✓        ✓         ✓
  Open WOs (type=repair|pm|inspection)     ✓        ✗         ✓
  Edit/void WOs (any)                      ✓        ✗     own+grace
  Add/delete/change-role users             ✓        ✗         ✗
  Create/edit PM schedules                 ✓        ✗         ✗
  Reach /admin/* screens                   ✓        ✗         ✗

DATA SOURCES (Day 1):
  - Alvys: assets + drivers (read-only mirror, sync endpoint)
  - Intangles: truck miles for assets with intangles_device_id
  - Manual: reefer hours, fallback for any asset
  - Deferred (need docs + creds): Monarch (truck miles for some
    units), TrackFleet (reefer hours when available)

BOOTSTRAP:
  First admin is created via db/seed/bootstrap_admin.mjs from
  ADMIN_BOOTSTRAP_* env vars. After that, all user management
  happens through /admin/users (admin sends magic-link or temp
  password invites).

────────────────────────────────────────────────────────────────
DEPENDENCY MANIFEST (pre-approved — additions require PM review)
────────────────────────────────────────────────────────────────

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

FRONTEND (/web) — dev only:
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
  @anthropic-ai/sdk          ^0.30+
  dotenv                     ^16
  cors                       ^2
  pino                       ^9
  pino-http                  ^10

BACKEND (/api) — dev only:
  vitest                     ^2
  supertest                  ^7
  pg                         ^8       (migration runner + validation
                                       scripts only — not used by
                                       the runtime API)
  eslint                     ^9
  prettier                   ^3

FRONTEND (/web) — dev additions vs v3 manifest:
  fake-indexeddb             ^6       (Vitest+jsdom doesn't ship with
                                       IndexedDB; needed for the
                                       Dexie queue round-trip test)

E2E / SMOKE (root):
  @playwright/test           ^1

Frontend bundle budget (foundation estimate):
  react + react-dom (46) + router (10) + supabase (30) + dexie (25)
  + lucide icons (25) + clsx (1) + workbox-window (5) + Tailwind
  output (~10) ≈ 152KB gzipped. Headroom under the 250KB cap.

────────────────────────────────────────────────────────────────
LOCKED FOUNDATION FACTS
────────────────────────────────────────────────────────────────
  GitHub:         github.com/joseeduardomorales-pixel/delta
  Supabase:       project "delta" inside Cold Cargo org
                  project_ref:   ycmrdnavcvbtpfdzgwih
                  region:        us-east-1
                  connection:    session pooler over IPv4
                                 (aws-1-us-east-1.pooler.supabase.com:5432)
  Custom domain:  delta.coldcargo.us  (Phase 4)
  Primary users:  tech (chat) + admin/PM (admin screens)
  Local workspace: ~/delta (outside Dropbox, matches other Cold
                   Cargo project conventions)
  v4 plan:        docs/foundation-v4-plan.md  (authoritative)
  v3 prompt:      Delta_Foundation_Prompt_v3.md  (superseded; kept
                   for historical reference)

────────────────────────────────────────────────────────────────
SCOPE — FOUNDATION (v4)
────────────────────────────────────────────────────────────────
IN SCOPE (across Phases 1–4):
  Phase 1 (DONE — merged on main):
    Monorepo, /web (Vite+React+Tailwind+PWA+Dexie), /api
    (Express+pino+/health), CLAUDE.md, Matrix tokens, queue
    interface + round-trip test.
  Phase 2 (DONE — feat/foundation-schema):
    Supabase schema (10 tables, RLS, 24 policies), storage bucket
    `action-photos`, helper functions (is_admin, is_tech, etc.),
    bootstrap admin user, schema validation suite.
  Phase 3 (next):
    Supabase Auth wiring, /api/chat with Claude tool-use,
    confirm-after-write pattern on every work_orders insert,
    single-screen chat UI, /admin/users + /admin/pm-schedules +
    /assets/:unit screens, Alvys catalog sync, Intangles mileage
    wrapper, role-gated routing.
  Phase 4:
    Render deploy, delta.coldcargo.us DNS+SSL, GitHub push,
    real-phone smoke, foundation-v1 tag on main.

INSPECTIONS — OFFLINE-FIRST ARCHITECTURE
  The inspection runner (web/src/routes/InspectionRunner.jsx) is
  the only screen in Delta that uses IndexedDB as the source of truth.
  The tablet is authoritative while the tech is walking the trailer.
  Three local stores in `delta-inspections` IndexedDB:
    - inspection_cache    last-known server snapshot, overlaid with
                          queued actions for instant render
    - pending_actions     queued PATCH/POST calls, deduped by
                          (inspection_id + item_id), with status
                          ('queued' | 'syncing' | 'needs_attention')
    - pending_photos      Blob storage for photos awaiting upload
  The sync engine (web/src/lib/syncEngine.js) drains: uploads photos
  to /api/uploads, then sends mark_item PATCHes or finalize POSTs
  with the returned staging_paths. Retries 5xx with backoff; 4xx →
  needs_attention. Photos that fail 5x get marked failed and their
  parent actions go to needs_attention.
  Triggered: on mount, on `navigator.online`, on every store change.
  Other write paths (chat, report-issue, admin) are STILL online-only.
  If you touch InspectionRunner: do NOT add direct fetches; route
  through enqueueAction(). Tests in syncEngine.test.js cover the
  drain order, dedupe, retry behavior — run them on every change.

OUT OF SCOPE (do not start until PM asks):
  - Monarch tracking integration (needs docs/creds)
  - TrackFleet integration (needs docs/creds)
  - Offline support for chat / report-issue / admin writes (only
    inspections are offline-first; same pattern applies if extended)
  - Inspection flow beyond logging it as a work_orders.type='inspection'
  - Campaign scheduling UI (campaign tables not yet created)
  - Driver-facing UI (role enum exists, no users yet)
  - Dashboards, briefings, reports
  - Any Sentinel / Alvys-writeback / Monarch / TrackFleet integrations
    beyond what's in scope above
  - Photo AI analysis (column exists, no pipeline yet)

────────────────────────────────────────────────────────────────
PROJECT-SPECIFIC HARD CONSTRAINTS (on top of PROTOCOL)
────────────────────────────────────────────────────────────────
  - MOBILE-FIRST PWA: every screen designed for a phone first, ≥44px
    tap targets, no hover-dependent UI, installable via "Add to
    Home Screen."
  - CLAUDE API IS FOUNDATIONAL: server-side proxy with a working
    /api/inference/ping. No prompt logic yet.
  - NATIVE OS DICTATION ONLY: mobile keyboard mic. No Whisper, no
    in-app transcription.
  - UNIVERSAL work_orders TABLE: every action eventually writes
    here. This table is the spine of the kardex. The original v3
    name was `action_logs` — same role, renamed to match the
    business object.
  - UNIFIED meter_readings TABLE: miles (trucks) AND hours (reefers)
    live in one table. Source enum supports
    intangles | monarch | trackfleet | manual.
  - CONFIRM-AFTER-WRITE: every Claude-driven INSERT into work_orders
    echoes a confirmation message to the user with a 5-minute
    undo window. Hardcoded in public.wo_grace_window().
  - SECRETS NEVER CLIENT-SIDE: Anthropic, Intangles, Supabase
    service-role keys, DB password — all backend-only. Frontend
    gets only the Supabase URL + publishable (anon) key.
  - RLS ON EVERY TABLE: schema sanity check refuses to apply if
    any public.* table lacks RLS. audit_log has no policies
    (service-role only, default deny).

────────────────────────────────────────────────────────────────
CURRENT STATE (update each phase)
────────────────────────────────────────────────────────────────
Last phase completed:  Phase 2 — Supabase schema + RLS + bootstrap
Active branch:         feat/foundation-schema
Next gate:             MERGE GATE at end of Phase 2 (this session)
Deployment URL:        not yet deployed
Supabase project:      live (project_ref ycmrdnavcvbtpfdzgwih,
                       us-east-1); schema applied; admin user
                       (eduardo@coldcargo.us) bootstrapped;
                       action-photos storage bucket created.
GitHub repo state:     local only, not pushed (Phase 4)

KEY ARTIFACTS:
  docs/foundation-v4-plan.md        authoritative v4 plan
  supabase/migrations/0001..0003    schema, RLS, storage policies
  db/migrate.mjs                    idempotent migration runner
  db/seed/bootstrap_admin.mjs       one-shot admin bootstrap
  db/validate.mjs                   schema + RLS validation (11/11)
  api/.env                          local creds (GITIGNORED)
