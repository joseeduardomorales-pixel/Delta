# Delta Design System — v2 (Minimalist Modern)

> **Status:** PM-approved (2026-05-27). Supersedes
> `docs/archive/design-system-v1-matrix.md`. This is the authoritative
> spec for every UI surface in Delta. Changes require a new PM
> design-gate conversation, not silent drift.

This document is half decision-sheet, half implementation guide. It
captures the system PM Lalo chose, adapted to Delta's reality (chat
PWA for shop techs + admin screens for the PM on a laptop).

The system is **"Minimalist Modern"**: white canvas, Electric Blue
gradient accent, Calistoga display serif + Inter body sans + JetBrains
Mono for technical labels. Confident, design-forward, alive without
being busy.

---

## 0 · Philosophy & Delta-specific calibration

The source design system is portfolio-grade — rotating rings,
floating hero cards, generous marketing space. Delta is a working
app. Two principles govern how we apply the system across surfaces:

| Surface | Aesthetic dial |
|---|---|
| **`/login`** | Full showcase — gradient headline, decorative ring, generous space. First impression matters. |
| **`/admin/*`** (laptop/desktop primary) | Full system — gradient accents, breathing motion, cards floating slightly on hover. PM has screen real estate. |
| **`/` (chat)** (mobile primary) | **Restrained** — new palette + type + primitives, but NO decorative motion. A tech in gloves needs density and speed, not a 60-second rotating ring between turns. |
| **`/assets/:unit`** (data-dense, both contexts) | Mid — new tokens, optional row-level hover lift on desktop, no decorative animation. |

The system's DNA still shows everywhere (signature gradient, dual
fonts, semantic colors, asymmetry where appropriate). The chat just
gets it in a quieter dose.

---

## 1 · Color tokens

### Surface

| Token | Hex | Use |
|---|---|---|
| `background` | `#FAFAFA` | Page canvas — warmer than pure white, lower eye strain |
| `card` | `#FFFFFF` | Elevated surfaces — pure white for maximum lift over the warm bg |
| `foreground` | `#0F172A` (Slate-900) | Primary text. Also inverted-section background. |
| `muted` | `#F1F5F9` (Slate-100) | Secondary surfaces, hover fills |
| `muted-foreground` | `#64748B` (Slate-500) | Secondary text, descriptions |
| `border` | `#E2E8F0` (Slate-200) | Default borders |

### Accent (the signature)

| Token | Hex | Use |
|---|---|---|
| `accent` | `#0052FF` Electric Blue | Primary actions, links, key data, focus rings |
| `accent-secondary` | `#4D7CFF` | Gradient endpoint — used with `accent` for the signature gradient |
| `accent-foreground` | `#FFFFFF` | Text on accent backgrounds — always white |

**The signature gradient** (where it appears across Delta):

```css
background: linear-gradient(to right, #0052FF, #4D7CFF);
```

- Primary buttons (`Submit`, `Send`, `Approve`)
- Icon containers on stat cards
- Pricing tier outlines *(not used in Delta yet)*
- Featured card border strokes (the active PM schedule row, the WO under review)
- The last word of every page headline (`text-clip` technique)

### Semantic (status)

| Token | Hex | Use |
|---|---|---|
| `success` | `#16A34A` Green-600 | Approved WOs, sync success |
| `warning` | `#F59E0B` Amber-500 | Pending review, due-soon PMs |
| `danger` | `#DC2626` Red-600 | Errors, rejected WOs, voided WOs, destructive confirms |
| `info` | `#0EA5E9` Sky-500 | Neutral info ("syncing now", "no data yet") |

Tinted background variants for banners and row highlights:

| Token | Value |
|---|---|
| `success.bg` | `rgba(22, 163, 74, 0.08)` |
| `warning.bg` | `rgba(245, 158, 11, 0.10)` |
| `danger.bg` | `rgba(220, 38, 38, 0.08)` |
| `info.bg` | `rgba(14, 165, 233, 0.08)` |
| `accent.bg` | `rgba(0, 82, 255, 0.05)` |

### Ring (focus)

`ring` = `accent` (Electric Blue). All focus states use a 2px ring
with 2px offset against `background`.

---

## 2 · Typography

Three fonts, each with a strict purpose. Loading via `@fontsource/*`
(self-hosted, no Google Fonts runtime).

| Role | Font | Weights | When |
|---|---|---|---|
| **Display** | Calistoga | 400 | h1/h2 only — the personality voice. Headlines on Login, page titles on admin. |
| **UI / Body** | Inter | 400, 500, 600, 700 | Everything else — body, labels, buttons, inputs |
| **Mono** | JetBrains Mono | 400, 700 | Section labels (uppercase tracked), identifiers (WO ids, VINs), code-like data |

### Type scale

| Token | Tailwind | Size / line-height | Tracking | Use |
|---|---|---|---|---|
| `text-display` | `text-5xl font-display tracking-tight leading-[1.05]` | 48 / 50 | `-0.02em` | Login headline, error pages |
| `text-h1` | `text-3xl font-display tracking-tight leading-tight` | 30 / 36 | `-0.01em` | Page titles on admin |
| `text-h2` | `text-2xl font-sans font-semibold tracking-tight` | 24 / 32 | `-0.01em` | Section headlines within a page |
| `text-h3` | `text-lg font-sans font-semibold` | 18 / 28 | normal | Card titles, sub-section heads |
| `text-body` | `text-sm font-sans` | 14 / 22 | normal | Default body, chat messages |
| `text-body-lg` | `text-base font-sans` | 16 / 26 | normal | Inputs, button labels (md size) |
| `text-caption` | `text-xs font-sans` | 12 / 18 | normal | Metadata, timestamps |
| `text-label` | `text-xs font-mono uppercase tracking-[0.15em]` | 12 / 18 | `0.15em` | Section labels (badge style) |
| `text-code` | `text-xs font-mono` | 12 / 18 | normal | Identifiers (WO-xxx, VINs) |

### Gradient text effect

Used on the LAST word of major headlines. Applied via Tailwind class
`text-gradient`:

```css
.text-gradient {
  background: linear-gradient(to right, #0052FF, #4D7CFF);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

---

## 3 · Spacing & layout

Tailwind's 4px scale, locked subset:

```
0 · 1 · 2 · 3 · 4 · 6 · 8 · 10 · 12 · 16
(=  0   4   8  12  16  24  32   40   48   64 px)
```

Anything off this scale requires a design note.

### Container widths

| Surface | Max width | Reason |
|---|---|---|
| `/login` | `max-w-md` (28rem / 448px) inside a full-screen hero | Single focused action |
| `/` chat | none on mobile; `max-w-2xl` desktop | Mobile-primary fills the device |
| `/assets/:unit` | `max-w-4xl` (56rem) | Readable line lengths over data density |
| `/admin/*` | `max-w-6xl` (72rem) | Tables + forms; desktop-primary |
| Modals | `max-w-md` (28rem) | Single focused action |

### Section vertical rhythm

- Chat: tight (`p-3` body, no section breaks)
- Asset history: medium (`py-6` between sections like Pending / Approved / Rejected)
- Admin: generous (`py-10` to `py-14` between sections)
- Login showcase: large (`py-16` on the hero)

### Asymmetry where appropriate

The system loves asymmetry. We use it on:
- **Login**: text + decorative ring, `lg:grid-cols-[1.1fr_0.9fr]`
- **Asset history page header**: title left, primary action right, but slightly offset
- **PM Schedule edit modal**: form left (`60%`), preview right (`40%`)

Chat stays symmetric — alignment is more important than visual interest in functional surfaces.

---

## 4 · Component primitives

All primitives live in `web/src/components/ui/`. They're built once
and used everywhere — no one-off styling allowed.

We use **`cva`** (class-variance-authority) for variant APIs +
**`tailwind-merge`** via a `cn()` helper for safe class composition,
matching the Shadcn API patterns.

### `Button`

```
Variants:
  primary    gradient bg from accent to accent-secondary, white text
             shadow-sm default, shadow-accent on hover, -translate-y-0.5
             brightness-110 on hover
  secondary  white bg, border, foreground text
             hover: border accent/30 + subtle shadow
  ghost      transparent, muted-foreground text
             hover: foreground text + muted bg
  danger     white bg, border-danger, danger text
             hover: danger bg, white text

Sizes:
  sm    h-9 px-3 text-xs uppercase tracking-widest    inline / table actions
  md    h-11 px-4 text-sm                              form submits (default)
  lg    h-14 px-6 text-base                            primary CTAs

States: default · hover · focus-visible (ring) · disabled · loading (spinner inside)
```

### `Input` / `Textarea` / `Select`

Shared shell:
- `h-12` (input) or auto-grow (textarea)
- `border` default → `accent` on focus
- `bg-card` (white) for inputs that sit on the page; `bg-muted/30` for inputs in a card
- `placeholder:text-muted-foreground/60`
- Focus: `ring-2 ring-accent ring-offset-2 ring-offset-background`
- Error variant: red border + red helper text below
- Label sits ABOVE the input as `text-xs font-medium text-muted-foreground`

### `Card`

```
bg-card  border  rounded-xl  shadow-sm
hover (interactive variant only): shadow-md, -translate-y-0.5, transition-all duration-200
```

Padding scale: `p-4` (compact), `p-6` (standard), `p-8` (showcase).

**Featured card** (gradient border via 2px nested-div trick — used for the WO under review and the current PM schedule):

```jsx
<div className="rounded-xl bg-gradient-to-br from-accent via-accent-secondary to-accent p-[2px]">
  <div className="rounded-[calc(0.75rem-2px)] bg-card p-6">
    {/* content */}
  </div>
</div>
```

### `Badge` / `StatusPill`

Pill shape with semantic color. Used for WO status, approval status, PM cadence type.

```
inline-flex items-center gap-1.5
px-2.5 py-0.5 rounded-full
text-[11px] font-medium
+ border + bg.tinted from the semantic palette
```

### `SectionLabel`

The signature small-label pattern from the source design system —
used at the start of every section on admin pages:

```jsx
<div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-3 py-1">
  <span className="h-1.5 w-1.5 rounded-full bg-accent" />  {/* optionally animate-pulse */}
  <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-accent">
    Section Name
  </span>
</div>
```

### `Banner`

Top-of-page or top-of-section status notice. Uses the semantic
`*.bg` tints with a left icon (lucide-react), main text, optional
right-side dismiss X.

### `Modal`

Centered, `max-w-md`, `bg-card`, `rounded-2xl`, `shadow-xl`. Backdrop
`bg-foreground/40 backdrop-blur-sm`. Focus trap, ESC to dismiss
(unless destructive — those require explicit Cancel).

Header: title (`text-h3`), close X top-right. Body: `text-sm` content.
Footer: actions right-aligned, Cancel (`ghost`) then primary action.

### `Toast`

Bottom-center on mobile, top-right on desktop. `bg-card` with a
semantic left border (3px). Auto-dismiss 3s for success, sticky for
warning/danger until clicked. Slides in 200ms, out 200ms.

### `Header`

Top bar present on every screen except `/login`. Mobile: collapses
user info / nav into a `≡` menu. Desktop: logo left, page context
center, role-gated nav + user info right.

---

## 5 · Motion

**Two purposes only, per the system spec:**
1. *Confirmation* (something happened) — 120ms fade/pulse
2. *State change* (sections appearing/dismissing) — 200ms slide/fade

Plus the **continuous animations** from the source system, applied
selectively:
- **Login screen**: rotating decorative ring (60s linear infinite),
  pulsing dot in the section label (2s ease-in-out infinite)
- **Admin dashboards**: subtle hover lift on cards (-translate-y-0.5,
  shadow deepens). Entrance fade-up on first paint via framer-motion.
- **Chat**: NONE. Messages slide in 100ms, nothing else moves.

All continuous motion is disabled under `@media (prefers-reduced-motion: reduce)`.

### Framer Motion variants (shared)

```js
const easeOut = [0.16, 1, 0.3, 1];

export const fadeInUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: easeOut } },
};

export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
```

Viewport options: `{ once: true, amount: 0.15, margin: "-60px" }` for
optimal load timing.

---

## 6 · Accessibility floor (locked)

- All interactive elements ≥ 44×44 px tap target
- Focus visible at all times: `ring-2 ring-accent ring-offset-2`
- Contrast: `foreground` on `background` = 16:1 ✓ AAA
  `muted-foreground` on `background` = 5.7:1 ✓ AA
  `accent` on `background` = 7.4:1 ✓ AA
  `accent-foreground` (white) on `accent` = 7.0:1 ✓ AA
- Status never color-only — icon + text accompanies every status pill
- Form labels associated (`<label for>` or wrapping)
- ESC closes modals, ENTER submits forms, real `<a href>` for nav
- `@media (prefers-reduced-motion: reduce)` strips all continuous
  motion to 0s

---

## 7 · Build order (this is what I'm executing now)

1. Update `CLAUDE.md` PROJECT CONTEXT — replace Matrix lock with this system
2. Install `framer-motion`, `class-variance-authority`, `tailwind-merge`, `@fontsource/inter`, `@fontsource/calistoga`
3. Rewrite `tokens.css` + `tailwind.config.js`
4. Write `web/src/lib/cn.js` (tailwind-merge helper)
5. Build primitives in `web/src/components/ui/`: Button → Input → Card → Badge → SectionLabel → Banner → Modal → Toast → Header
6. Refactor `Login` (showcase aesthetic — gradient headline, rotating ring)
7. Refactor `Chat` (restrained — new tokens/primitives, no decorative motion)
8. Refactor `AssetHistory` (mid — new tokens, hover lift on rows)
9. Update PWA: theme_color, background_color, favicon
10. Build admin screens: `/admin/work-orders/pending` → `/admin/users` → `/admin/pm-schedules`
11. Smoke + commit + Phase 3b MERGE GATE

---

## 8 · The lucide-react icon set

The source system uses lucide for everything except decorative shapes
(which are pure SVG). We already have lucide-react@0.474.0 pinned.
Used icons so far in Delta:

- `Paperclip` (attach)
- `X` (close, remove)
- Adding in Phase 3b admin: `Check`, `XCircle`, `Edit3`, `Plus`,
  `Trash2`, `ChevronRight`, `Search`, `Filter`, `Upload`,
  `RefreshCw`, `ShieldCheck`, `Truck`, `Container` *(or `Box`)*,
  `Wrench`, `AlertTriangle`, `CheckCircle2`

Each icon stays at 16/18/20/24 px depending on context. No rotations
applied to icons themselves (only to the decorative rings on Login).
