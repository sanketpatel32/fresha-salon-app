# Design — Fresha Salon App

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Produced by a Hallmark `redesign` run (genre: editorial atelier). Replaces the
prior purple→pink gradient / glassmorphism / Outfit+Playfair system, which read
as the canonical AI-luxury SaaS register and was wrong for a tactile boutique
salon business.

## Genre

**Editorial** — the atelier voice. Warm paper, restrained serif headlines, a
single warm accent, hairline rules. Reads like a boutique salon's printed menu:
refined, hand-made, not SaaS-purple.

## Macrostructure family

Three families. Pages within a family share the family's shape; they vary only
in component archetypes, not in theme or voice.

- **Marketing pages** → `Long Document`. The landing page reads top-to-bottom
  like an editorial spread: a quiet typographic hero (no gradient text, no
  radial blooms), generous measure, hairline section dividers. Variation knob:
  hero is left-aligned, not centered.
- **App pages** (all dashboards, booking wizard, lists) → `Workbench`.
  Utilitarian console chrome. Function carries the page; no enrichment, no
  flourishes. Variation knob: density per surface (sparse for landing screens,
  dense for admin tables).
- **Auth pages** → a quiet `Letter` variant. Single centered card on the warm
  paper, no radial-bloom background, no gradient top-stripe. The card IS the
  page.

## Theme

Single accent. Every page uses these tokens. Dark mode is supported via the
existing `data-theme="dark"` attribute (see `tokens.css` for the dark variants
of the same names).

```
--color-paper       oklch(98% 0.008 80)   warm off-white canvas
--color-paper-2     oklch(96% 0.010 75)   card / raised surface
--color-paper-3     oklch(93% 0.012 72)   inset / muted surface
--color-ink         oklch(22% 0.020 60)   deep warm brown-black, body + headings
--color-ink-2       oklch(45% 0.020 60)   secondary text
--color-ink-3       oklch(60% 0.015 60)   muted / captions / placeholders
--color-rule        oklch(90% 0.010 70)   hairline borders + dividers
--color-rule-strong oklch(82% 0.012 70)   slightly stronger hairline (inputs)
--color-accent      oklch(58% 0.130 40)   clay terracotta — the one accent
--color-accent-ink  oklch(99% 0.005 80)   text on accent fills
--color-accent-soft oklch(94% 0.030 50)   accent wash for tags/eyebrows
--color-focus       oklch(55% 0.140 35)   focus ring
--color-success     oklch(55% 0.110 150)  confirmed / paid
--color-warning     oklch(60% 0.120 65)   pending (shipped value; tokens.css is canonical)
--color-danger      oklch(55% 0.170 25)   cancel / decline / delete
```

Dark variants (applied under `[data-theme="dark"]`):

```
--color-paper       oklch(18% 0.008 60)
--color-paper-2     oklch(22% 0.010 60)
--color-paper-3     oklch(27% 0.012 60)
--color-ink         oklch(95% 0.008 80)
--color-ink-2       oklch(78% 0.012 70)
--color-ink-3       oklch(62% 0.012 65)
--color-rule        oklch(28% 0.010 60)
--color-rule-strong oklch(36% 0.012 60)
--color-accent      oklch(70% 0.130 45)
--color-accent-soft oklch(30% 0.040 45)
```

Accent discipline: terracotta appears on **≤ 5 % of any viewport** — primary
CTAs, active states, links, and small accents only. It never becomes a section
background, a gradient, or a card header fill.

## Typography

- **Display:** Fraunces, weight 500, style `normal`. Modern variable serif with
  optical-size axis. Used for hero headlines, page titles, auth titles, panel
  titles. Letter-spacing −0.01em. Never italic on headings.
- **Body:** Inter, weight 400. All running text, labels, table cells, buttons.
- **Mono:** not used in this app.

Type scale (named tokens, fluid where it matters):

```
--text-xs:   0.75rem   badges, captions
--text-sm:   0.875rem  secondary labels, table secondary lines
--text-md:   1rem      body
--text-lg:   1.125rem  lead paragraph
--text-xl:   1.5rem    section subhead
--text-2xl:  2rem      panel title
--text-3xl:  clamp(2rem, 1.4rem + 2.5vw, 2.75rem)   page title
--text-display: clamp(2.5rem, 1.6rem + 3.6vw, 4rem) marketing hero
```

Hero headline sizing rule (from Hallmark typography): match size to copy length.
The landing hero headline is ≤ 50 chars → uses `--text-display`. Longer
auto-titles cap at `--text-3xl`.

## Spacing

4-point named scale. Pages must use named tokens (`var(--space-md)`), never raw
values. Inline `style={{ padding: '40px 24px' }}` in existing components will be
migrated to token-based utility classes; until migrated, raw values inherit the
scale's rhythm by convention.

```
--space-3xs: 0.25rem   4px
--space-2xs: 0.5rem    8px
--space-xs:  0.75rem  12px
--space-sm:  1rem     16px
--space-md:  1.5rem   24px
--space-lg:  2rem     32px
--space-xl:  3rem     48px
--space-2xl: 4.5rem   72px
--space-3xl: 7rem    112px   section padding
```

## Motion

Motion-cut project (no framer-motion / gsap). All animation is hand-rolled CSS,
and the discipline is **less, not more**.

- Easings: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`. Never the browser default `ease`. Never bounce/overshoot.
- Durations: `--dur-short: 160ms` (hover, focus), `--dur-base: 220ms` (open/close).
- Animate `transform` and `opacity` only — never layout properties.
- Reveal pattern: **none on scroll.** The only motion is state-change motion (modal open, toast in, hover, focus).
- `prefers-reduced-motion: reduce` → all motion collapses to ≤ 150ms opacity crossfade; hover transforms removed.

## Microinteractions stance

- **Silent success, never celebratory toasts.** Toasts stay (they carry
  information the user needs — "saved", "login failed"), but they are quiet:
  hairline left-border in the semantic colour, no slide-and-bounce.
- **Hover delay 800ms · focus delay 0ms** for any tooltip (none currently).
- **Optimistic update + revert on failure** for the favorites toggle (already
  implemented in `CustomerDashboard` — preserved).
- Buttons: hover = subtle colour shift (accent softens, or surface lifts one
  step), `:active` = `translateY(1px)` only. **No `translateY(-6px)` lift on
  every card.** Cards do not float on hover; they gain a hairline accent border.
- Focus ring: `2px solid var(--color-focus)` with `2px` offset, shown instantly
  on `:focus-visible`, never animated.

## CTA voice

- **Primary CTA:** solid `--color-accent` fill, `--color-accent-ink` text,
  `--radius-sm` (8px), weight 600, padding `--space-2xs --space-md`. Hover:
  darken one step (`oklch(52% 0.135 38)`). No gradient. No glow. No lift beyond
  1px on active.
- **Secondary CTA:** transparent fill, `1px solid --color-rule-strong` border,
  ink text. Hover: border → accent, text → accent.
- **Danger CTA:** transparent fill, `1px solid --color-danger` border, danger
  text. Hover: solid danger fill, accent-ink text.
- **Pills / tags / badges:** `--color-paper-3` fill, `--color-ink-2` text,
  `--radius-pill`. Status badges tint with their semantic colour at low chroma.

## Per-page allowances

- **Marketing pages (landing):** typography-only hero. No enrichment, no
  illustration, no gradient. The wordmark + a strong serif headline + a quiet
  accent rule carry the page.
- **App pages (dashboards, booking, lists):** function only. No enrichment.
  Tables, cards, forms use the system surfaces. Stat cards do NOT use coloured
  icon discs — a hairline accent number carries the emphasis instead.
- **Auth pages:** the card is the page. No radial-bloom background.

## What pages MUST share

- The wordmark / logotype: "Fresha" set in Fraunces 600, ink colour, with a
  small scissors glyph in accent. **No gradient clip on the wordmark.**
- The accent colour and its placement (≤ 5 % per viewport).
- The display (Fraunces) + body (Inter) fonts.
- The CTA voice (button shape, radius, padding, colour logic).
- Section heading rhythm: a small uppercase eyebrow (optional, ≤ 1 per section)
  directly above a Fraunces heading — never the tag-left / heading-right
  hanging pattern.

## What pages MAY differ on

- Density: marketing = generous `--space-3xl` section padding; app dashboards =
  tighter `--space-xl`.
- Surface treatment within the family: a salon card and a service card both
  belong to the Workbench family but may vary their internal layout.
- Table column counts and form field arrangements (already varied per page).

## What is explicitly removed (anti-slop)

These were in the prior `index.css` / `App.jsx` and are gone from the new system:

1. Purple→pink gradients on CTAs, wordmark, hero word, card headers, avatar.
2. `-webkit-background-clip: text` gradient text anywhere.
3. Glassmorphism nav (`backdrop-filter: blur(12px)` + translucent bg).
4. Radial violet/pink "bloom" backgrounds behind hero and auth pages.
5. `translateY(-6px/-8px)` hover-lift applied to every card and stat.
6. Coloured icon discs on stat cards (`stat-icon.primary/accent/success`).
7. Outfit + Playfair Display pairing → replaced by Inter + Fraunces.
8. Gradient top-stripe on auth cards.
9. Bounce easing on toasts (`cubic-bezier(...,1.275)`).

## Exports

Drop-in formats for re-using this design system in other projects.
See `references/export-formats.md` in the Hallmark skill for the canonical
mapping. The canonical, always-emitted export is `tokens.css` at the frontend
root (`frontend/src/tokens.css`); it is imported by `index.css`.

### tokens.css
See `frontend/src/tokens.css` — the authoritative source of every `--color-*`,
`--font-*`, `--space-*`, `--text-*`, `--ease-*`, `--dur-*`, `--rule-*`, and
`--radius-*` token. `index.css` consumes tokens by name, never inline values.

### Tailwind v4 `@theme`
Not applicable — this project uses plain CSS, not Tailwind. If Tailwind is
adopted later, mirror `tokens.css` into an `@theme` block per the Hallmark
mapping.

### DTCG `tokens.json`
Not emitted (no token pipeline in this project). Can be generated from
`tokens.css` on request.

### shadcn/ui CSS variables
Not applicable — this project uses hand-rolled components, not shadcn/ui.
