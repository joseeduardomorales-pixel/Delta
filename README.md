# Delta

Cold Cargo internal maintenance log. Mobile-first PWA, chat-driven, Claude API-native.

**Primary user:** shop technician. Other roles (admin, dispatcher, driver) are deferred.

## Structure

```
/web              React + Vite PWA (frontend)
/api              Node + Express (backend)
/db/migrations    Supabase SQL migrations
/db/seed          Asset + tech seed data
/docs             Architecture and session notes
/docs/sessions    Per-session notes (charter §9)
/docs/api         API documentation
```

## Quickstart

Requires Node 18+. Run frontend and backend separately:

```
cd web && npm install && npm run dev
cd api && npm install && npm run dev
```

Copy `.env.example` to `.env` in each package and fill in credentials.

## Charter

See `CLAUDE.md` for the team charter (PROTOCOL) and project context. Read it before writing any code.

## Conventions

- Feature branches (`feat/...`, `fix/...`). Merge gates approved by PM.
- No silent failures. Every async wrapped, every external call timed and logged.
- Mobile-first. Matrix design language (`#000000` / `#00FF41`, JetBrains Mono).
- `action_logs` is the spine of the kardex.
