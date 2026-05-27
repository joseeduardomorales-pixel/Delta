# Delta Design System — v1

> **Status:** draft, awaiting PM sign-off. Once approved, this doc is the
> contract for every UI screen built in Phase 3b and beyond. Changes
> require a new design-gate conversation, not silent drift.

This is **not** a brand guide. It's a *decision sheet* — the smallest
set of locked choices that lets two people (or one Claude and one PM)
agree what "right" looks like before any pixel ships.

---

## 1. Foundation (already locked from Phase 1)

| Decision | Value | Where |
|---|---|---|
| Background | `#000000` pure black | `--matrix-black` |
| Primary accent | `#00FF41` neon green | `--matrix-green` |
| Typography | JetBrains Mono everywhere (no sans-serif anywhere — terminal aesthetic carries to admin) | `--font-mono` |
| Tap target floor | 44×44 px (≥ Apple HIG) | `min-h-tap` / `min-w-tap` |
| Mobile-first breakpoints | `sm 480 / md 768 / lg 1024 / xl 1280` | `tailwind.config.js` |
| Border-radius scale | `sm 4 / md 8 / lg 12` | tokens |
| Glow shadow | `0 0 12px rgba(0,255,65,0.35)` | `shadow-matrix-glow` |
| Motion durations | `120ms fast / 200ms base` | `transition-fast/base` |
| Hover gated by touch | `@media (hover: none)` strips hover — touch UI never relies on hover | `tokens.css` |

These don't change. Everything below builds on them.

---

## 2. Color palette — extended

Today we have 7 color tokens. To build admin screens cleanly we need
~14. I'm proposing the **semantic** layer below sit on top of the
existing palette, so all the Matrix-era code keeps working.

### Surface (backgrounds)

| Token | Hex | Use |
|---|---|---|
| `matrix.black` | `#000000` | Page background (locked) |
| `surface.raised` | `#0A0F0A` | Cards, modal bodies — barely lifted from black |
| `surface.sunken` | `#000000` | Inputs (same as page; border carries the affordance) |
| `surface.overlay` | `rgba(0,0,0,0.85)` | Modal scrim |

### Lines & borders

| Token | Hex | Use |
|---|---|---|
| `line.dim` | `rgba(0,255,65,0.15)` | Quiet dividers between sections |
| `line.base` | `rgba(0,255,65,0.25)` | Default border on cards, inputs |
| `line.strong` | `#00FF41` | Focused input, primary button outline |

### Foreground (text)

| Token | Hex | Use |
|---|---|---|
| `matrix.green` | `#00FF41` | **Headlines**, primary actions, key data |
| `fg.high` | `#E6FFEC` | **Body text** — high-contrast off-white |
| `fg.mid` | `#8FBFA0` | Metadata, labels, captions |
| `fg.low` | `#4A6B53` | Hints, disabled, placeholder |

### Semantic (status)

| Token | Hex | Use |
|---|---|---|
| `success` | `#00FF41` | Same as primary green (success and primary are the same in this aesthetic) |
| `warning` | `#FFB300` amber | "Pending review", "due soon", overdue PM warnings |
| `danger` | `#FF3B3B` red | Errors, voids, rejections, destructive confirms |
| `info` | `#5BD3FF` cyan *(new)* | Neutral info banners — readings synced, syncing now |

### Backgrounds for status (tinted, not solid)

Always low-alpha so the black page bleeds through:

| Token | Value | Use |
|---|---|---|
| `success.bg` | `rgba(0,255,65,0.10)` | Approved row tint |
| `warning.bg` | `rgba(255,179,0,0.10)` | Pending-review row tint |
| `danger.bg` | `rgba(255,59,59,0.10)` | Rejected/error tint |
| `info.bg` | `rgba(91,211,255,0.10)` | Info banners |

---

## 3. Typography scale

JetBrains Mono only. Weights: **400** (normal) and **700** (bold).
Italic exists in the font but we use it only for verbatim quotes
(e.g., the tech's raw_input on a work-order row).

| Token | Tailwind class | Size / line-height | Use |
|---|---|---|---|
| `display` | `text-4xl tracking-tight` | 36 / 40 | Login screen title, error pages |
| `h1` | `text-2xl tracking-tight` | 24 / 32 | Page title (e.g., `/admin/users` h1) |
| `h2` | `text-lg` | 18 / 28 | Section headers within a page |
| `h3` | `text-sm uppercase tracking-widest` | 14 / 20 | Sub-section headers, label-style |
| `body` | `text-sm` | 14 / 20 | Default body, chat messages |
| `body-lg` | `text-base` | 16 / 24 | Inputs, primary buttons |
| `caption` | `text-xs` | 12 / 16 | Metadata, timestamps |
| `micro` | `text-[10px] uppercase tracking-widest` | 10 / 14 | Badges, status pills, button labels |
| `code` | `font-mono text-xs` | 12 / 16 | Identifiers (WO-xxx, VINs, IDs) — already monospace; tighter than body |

**Hierarchy via size + color**, not weight. We avoid bold for hierarchy because the terminal aesthetic relies on color/glow for emphasis. Bold is reserved for *names of things* inline (the user's name, an asset id).

---

## 4. Spacing & layout

Tailwind's default 4px-based scale is fine. Lock the **subset we use**
so it doesn't drift:

```
0 · 1 · 2 · 3 · 4 · 6 · 8 · 10 · 12 · 16
(=  0   4   8  12  16  24  32   40   48   64 px)
```

Anything outside this list requires a design comment.

### Container widths

| Surface | Max width | Reason |
|---|---|---|
| Chat (`/`) | none (full screen) | Mobile-primary, fills the device |
| Asset history (`/assets/:unit`) | `max-w-3xl` (768px) | Readable line lengths |
| Admin screens | `max-w-5xl` (1024px) | Tables + forms; desktop-primary |
| Modals | `max-w-md` (448px) | Single focused action |
| Form fields inside a modal | full width of modal | — |

### Page chrome

Every screen has the same header pattern:

```
┌──────────────────────────────────────────────────────────┐
│  Δ  Delta             [breadcrumb context]   [user info] │  ← header
│     ────────────────────────────────────────             │  ← line.dim
│                                                          │
│  <page content, max-width per table above>               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Header height: 56 px (mobile) / 64 px (md+). Sticky on admin screens
where the user might scroll long tables.

---

## 5. Component primitives

The minimum set for the admin work. Each lives in `web/src/components/ui/`
and gets used everywhere — no one-off button restyles.

### `Button`

```
Variants:
  primary    green outline + green text   default action
  secondary  dim outline + fg.high text   secondary actions
  ghost      no outline, fg.mid text      cancel, less-important
  danger     red outline + red text       destructive (reject, deactivate)

Sizes:
  sm   h-9   text-xs uppercase tracking-widest   inline / table actions
  md   h-11  text-sm                              form submits (default)
  lg   h-tap text-base                            mobile / chat send

States:
  default · hover (md+) · focus (visible ring) · disabled · loading (spinner)
```

### `Input` / `Textarea` / `Select`

All share the same visual shell:

```
border-1 line.base
focus:border line.strong  + outline-none
bg surface.sunken (= black)
text fg.high
placeholder fg.low
disabled: opacity-50, cursor-not-allowed
error:  border-1 danger
```

Label sits *above* the input as `h3` (`text-xs uppercase tracking-widest text-fg.mid`).
Error text sits *below* the input as `caption` in `danger`.

### `Card`

```
bg surface.raised
border-1 line.base
rounded-md (8px)
padding-3 mobile, padding-4 desktop
```

Used for: work-order rows, pm-schedule rows, user list rows.

### `Badge` / `Pill`

```
inline-flex, px-1.5 py-0.5
text-[10px] uppercase tracking-widest
border-1 line.base
rounded
```

Color variants follow the semantic palette. Status pills use
`warning` for pending, `success` for approved, `danger` for
rejected/voided, `fg.mid` for default.

### `Banner`

Top-of-page or top-of-section alert. Same shape as Card but a
status-tinted background:

```
bg success.bg / warning.bg / danger.bg / info.bg
border-1 success / warning / danger / info
px-3 py-2 text-sm
icon at left (lucide-react, 16px), optional dismiss X at right
```

### `Modal`

```
fixed inset-0, scrim = surface.overlay
center child = Card width=max-w-md
title h2, body text-sm, action row bottom-right (Cancel ghost + primary action)
focus trap, ESC + scrim click dismiss (unless destructive — destructive
needs explicit Cancel)
```

### `Toast`

Slides up from the bottom on mobile, top-right on desktop. Auto-dismiss
3 s for success, sticky for warning/danger until user closes.
Used sparingly — most state goes inline.

---

## 6. Navigation patterns

### Header

| Element | Mobile | Desktop |
|---|---|---|
| Logo + word "Delta" | left | left |
| Page context (e.g., "Review queue · 4 pending") | hidden | center, `text-sm fg.mid` |
| User name + role | hidden behind `≡` menu | right, `text-xs fg.mid` |
| Sign out | inside menu | right, `Button.ghost sm` |
| Admin-only links (review, users, schedules) | inside menu | right of header, before user |

### Role-gating

- Tech: chat only. Header shows their name. No admin links.
- Dispatcher: chat only. Header shows their name + role badge. No admin links.
- Admin: chat + admin links in header. Admin links use `code` token color (the keyboard-shortcut-y, slightly-quieter green).

### Modals vs page transitions

- **Page**: anything with > 3 form fields or > ~20 lines of content
- **Modal**: confirmations, ≤ 3 field forms (e.g., "Reject WO: enter a note"), bulk-action confirms
- **Inline**: row-level actions (approve, void) — no modal, just optimistic + undo toast

---

## 7. State patterns (every screen has these)

Every list / detail surface explicitly handles **four** states.

```
┌─ EMPTY ─────────────┐  ┌─ LOADING ──────────┐
│ centered, fg.mid    │  │ "loading…" pulse   │
│ one-line message    │  │ pre-mount only     │
│ + suggested action  │  │                    │
└─────────────────────┘  └────────────────────┘

┌─ ERROR ─────────────┐  ┌─ SUCCESS / NORMAL ─┐
│ danger banner top   │  │ render the data    │
│ "Retry" button      │  │                    │
│ underlying details  │  │                    │
│ collapsed below     │  │                    │
└─────────────────────┘  └────────────────────┘
```

**Never** show a spinner over real data — flash to loading is worse
than just rendering when ready. Skeleton states are overkill for our
list sizes.

---

## 8. Motion & feedback

Use sparingly. Two purposes only:

1. **Confirmation** — something the user did happened. Quick fade or
   subtle pulse. 120ms.
2. **State change** — sections appearing/dismissing. Slide or fade.
   200ms.

**No** entrance animations on page load. **No** decorative motion.
A terminal doesn't wiggle.

Specific patterns:

- **Pending → Approved** in the review queue: row fades to `success.bg`
  for 600ms then slides into the Approved section (or just disappears
  if the user already scrolled past Approved).
- **Toast** appears with a 200ms slide-in, 200ms slide-out.
- **Modal** scrim fades 200ms, content scales from 95% → 100%.
- **Input focus** transitions `border` color 120ms.

---

## 9. Accessibility floor

Non-negotiable, even in a terminal aesthetic:

- All interactive elements: `min-h-tap`, visible focus ring
  (`outline outline-2 outline-matrix-green outline-offset-2` on focus-visible)
- Form labels associated with inputs (`<label for="…">` or wrapping)
- Status colors have a non-color signal too (icon + text, not just hue)
- Contrast: `fg.high` on `matrix.black` = 14:1 (✓), `fg.mid` on
  `matrix.black` = 6.8:1 (✓ AA body, ✓ AAA large), `fg.low` only used
  for non-essential metadata
- All buttons have an aria-label when icon-only
- ESC closes modals; ENTER submits forms; nav links are real
  `<a href>` so right-click "open in new tab" works
- Reduced motion: `@media (prefers-reduced-motion: reduce)` strips
  all motion to 0ms

---

## 10. Component build order (after sign-off)

If you approve this doc, here's the order I'd build the primitives in.
Each is 30–80 lines.

1. **Token codification** — update `tokens.css` and `tailwind.config.js`
   with the new semantic colors + lock the type scale as Tailwind
   utility variants
2. **`Button`** (5 min) — variants × sizes × states
3. **`Input`/`Textarea`/`Select`** (10 min) — shared shell
4. **`Card`** (5 min)
5. **`Badge`/`Pill`/`Banner`** (10 min)
6. **`Header` + role-gating** (15 min)
7. **`Modal`** (15 min) — focus trap, ESC, scrim
8. **`Toast`** (10 min) — context provider + 1-2 lines per consumer

Total component-library budget: ~90 min of building before any admin
screen gets its first commit. Then:

9. `/admin/work-orders/pending`
10. `/admin/users`
11. `/admin/pm-schedules`

Each admin screen uses only primitives from the library — no one-off
styling allowed without adding to the library first.

---

## 11. Open questions for you

Things I have a default answer to but want your check on:

1. **`info` color (cyan #5BD3FF)** — that's new, used for "syncing"
   and "no data yet" banners. Stay in the green/amber/red family
   instead? My instinct says cyan is fine because it's clearly
   *not* a status — it's just informational.
2. **Density on admin screens** — desktop-primary means more on
   screen. Are you OK with smaller fonts (text-sm body instead of
   text-base) on admin? Or do you want admin to feel as "spacious"
   as the chat?
3. **`/admin/*` link styling in the header** — proposed `code`
   color (slightly duller green). Or do you want them to look like
   regular nav (matrix-green)?
4. **Voided / Rejected work orders** — keep them visible in the
   asset history with `line-through` styling? Or hide by default
   with a "show voided" toggle? I'd hide by default.
5. **Confirm dialogs for destructive actions** — "Reject WO" should
   require a note (forced). "Deactivate user" — modal confirm but no
   note required? "Void approved WO" — modal + reason note required?

---

## 12. Sign-off

If sections 1–10 look right, say **"design approved"** (with optional
notes on the open questions in §11). I'll codify tokens + build the
primitive library + start the admin screens against the locked system.

If anything's wrong, push back specifically — every line above is a
decision I can change.
