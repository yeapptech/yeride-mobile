# YeRide UI Redesign — Design Language Spec

**Date:** 2026-06-24
**Status:** Locked (RiderHome validated in the visual companion; whole-app application pending)
**Supersedes:** the "Honey and the Bee" token values in `src/presentation/global.css`
(structure is kept; values change).

## North star

YeRide competes with Uber, so the UI leans on **Uber-familiar ride-hailing
patterns** (map-first home, draggable bottom sheet, a "Where to?" search field,
saved places, big confirm CTAs, minimal chrome) to lower the learning curve —
while carrying a **distinct YeRide identity** built on two brand colors:

- **Cab Yellow `#F7B731`** (NYC taxi "Dupont Cronar" yellow) — the energy:
  primary CTAs, the route line, "you are here" / destination pins, active states.
- **UPS Pullman Brown `#644117`** — the grounding: headings, the wordmark,
  icon chips, and the **entire dark-mode base** (brown surfaces, not neutral
  black — the most distinctive choice in this system).

Restraint like Uber: one strong accent (yellow), everything else neutral/warm.

### Accessibility rule (non-negotiable)

Yellow is **never** used as text or as an icon glyph on white/light — it fails
contrast. Yellow appears only (a) as a fill behind dark brown text
(`primary-foreground`), or (b) as text/accents on dark brown surfaces. All token
pairs below meet WCAG AA for their intended use (brown ink on white ≈ 8:1; cream
on Pullman brown ≈ 11:1; brown on cab-yellow ≈ 6:1).

## Color tokens

The app themes through `global.css` (repo root) CSS variables (stored as
`R G B` channel triplets, wrapped in `tailwind.config.js` as
`rgb(var(--token) / <alpha-value>)`). `card` / `muted` / `border` were previously
**hardcoded** light/dark pairs in `tailwind.config.js` that did NOT auto-switch
(only 2 files used `dark:` variants), so the redesign promoted them to CSS
variables too — now every surface/field/border usage themes from one place.
Dark mode is driven by `prefers-color-scheme` (`darkMode: 'media'`), consistent
with the `@media` block in `global.css`.

### `global.css` CSS variables

| Token                  | Role                      | Light hex / triplet       | Dark hex / triplet        |
| ---------------------- | ------------------------- | ------------------------- | ------------------------- |
| `--background`         | Page background           | `#FFFFFF` · `255 255 255` | `#181009` · `24 16 9`     |
| `--foreground`         | Body text (ink)           | `#2B1F12` · `43 31 18`    | `#F6EFE2` · `246 239 226` |
| `--primary`            | Cab Yellow (CTAs/accents) | `#F7B731` · `247 183 49`  | `#FAC23C` · `250 194 60`  |
| `--primary-foreground` | Text on yellow            | `#3A2705` · `58 39 5`     | `#3A2705` · `58 39 5`     |
| `--brand-deep`         | Headings / wordmark       | `#644117` · `100 65 23`   | `#FAC23C` · `250 194 60`  |
| `--brand-warm`         | Secondary warm accent     | `#8A5B10` · `138 91 16`   | `#D9A23A` · `217 162 58`  |
| `--brand-muted`        | Tertiary muted brand      | `#8A7C63` · `138 124 99`  | `#B3A489` · `179 164 137` |
| `--success`            | Semantic (unchanged)      | `#15803D` · `21 128 61`   | `#22C55E` · `34 197 94`   |
| `--warning`            | Semantic (unchanged)      | `#B45309` · `180 83 9`    | `#FBBF24` · `251 191 36`  |
| `--error`              | Semantic (unchanged)      | `#DC2626` · `220 38 38`   | `#F87171` · `248 113 113` |
| `--info`               | Semantic (unchanged)      | `#0369A1` · `3 105 161`   | `#38BDF8` · `56 189 248`  |

`--brand-deep` is the one token whose dark value flips to a light color, because
brown headings would be invisible on the brown dark base.

### Surface / field / border / honey CSS variables (new)

Promoted from hardcoded `tailwind.config.js` pairs to `global.css` vars; the
Tailwind classes (`bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`,
`bg-honey`) are unchanged but now switch with the theme.

| Token                                  | Role                          | Light hex / triplet       | Dark hex / triplet     |
| -------------------------------------- | ----------------------------- | ------------------------- | ---------------------- |
| `--card` / `--card-foreground`         | Sheet/card surface + its text | `#FFFCF5` / `#2B1F12`     | `#241910` / `#F6EFE2`  |
| `--muted` / `--muted-foreground`       | Field fill + muted text       | `#F4F0E7` / `#8A7C63`     | `#2F2114` / `#B3A489`  |
| `--border`                             | Hairlines/dividers            | `#ECE4D6` · `236 228 214` | `#3A2C1C` · `58 44 28` |
| `--honey` / `--honey-foreground` (new) | Chip/badge bg + glyph         | `#FDEFC8` / `#644117`     | `#3A2A18` / `#FAC23C`  |

The 2 prior `dark:bg-card-dark` usages were removed (base `bg-card` now switches).

## Typography

System font (`San Francisco` on iOS, `Roboto` on Android) — zero added bundle
weight, native feel, very Uber. No custom font in scope.

| Step    | Size / weight              | Use                                        |
| ------- | -------------------------- | ------------------------------------------ |
| Display | 26 / 800, tracking −0.02em | Greeting, "Where to?", screen heroes       |
| Title   | 19 / 700                   | Section/screen titles, "Confirm your ride" |
| Body    | 15 / 500                   | Default text, list primary lines           |
| Label   | 13 / 600, often UPPERCASE  | Section labels ("SAVED PLACES")            |
| Caption | 11–12 / 500                | Addresses, metadata, helper text           |

## Spacing, radii, elevation

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 (Tailwind `1/2/3/4/6`).
- **Radii:** buttons & fields `14`, cards `16`, bottom sheets `26` (top corners),
  pills `999`, icon circles `50%`.
- **Elevation:** soft, low-spread shadows. Bottom sheet casts an _upward_ shadow
  (`0 -8px 24px rgba(0,0,0,.16)`). Cards use a subtle `shadow`/`shadow-lg`.

## Components

- **Primary button** — `bg-primary`, `text-primary-foreground`, weight 800,
  height ~52, radius 14, full-width by default. Pressed: slightly darker yellow.
- **Secondary button** — `bg-card`, `border border-border` (1.5px), `text-foreground`.
- **Search field ("Where to?")** — `bg-muted`, leading 🔍, `text-foreground`
  with `text-muted-foreground` placeholder, trailing **Later** pill, radius 14.
- **Schedule / quick pill** — `bg-primary text-primary-foreground` (Later), or
  `bg-honey text-honey-foreground` (saved-place quick chips).
- **Saved-place / list row** — leading `bg-honey` icon circle with brown glyph,
  title (Body/700), optional address (Caption, muted), trailing chevron.
- **Ride card (active/scheduled)** — `bg-background`, `border border-border`,
  radius 16; a `bg-honey` status **badge**, a `from → to` route mini-line, a
  time/eta caption, trailing chevron.
- **Badge / status pill** — pill; brand states use `honey`; semantic states use
  `success/10 text-success` etc. (the existing `<alpha-value>` opacity pattern).
- **Bottom sheet** — `bg-card`, top radius 26, grab handle (`bg-border`-ish),
  content padding 16. Replaces today's floating card on home/monitor surfaces.
- **Status banner** — rounded pill/box with tinted background
  (`bg-warning/10`, `bg-info/10`, `bg-error/10`) + matching text. Pattern already
  in use; just inherits the new tokens.
- **Map** — light: warm-tinted; dark: brown-tinted. Route line + pins in Cab
  Yellow. (`components/map/Map.tsx` marker/route styling.)

## RiderHome layout (validated reference)

Full-bleed `Map`; floating circular menu (top-left) + avatar (top-right); a
bottom sheet containing, top to bottom: greeting (`brand-deep`), the "Where to?"
search field with a **Later** pill, any in-progress/scheduled rides as cards
(`HomeRideSections`), a divider, then **Home / Work saved places** read from the
legacy `users/{uid}` saved-places subcollection (domain `SavedPlace`), then
recent destinations. Status states (loading / permission_denied / out_of_coverage
/ error) keep today's logic, restyled as tinted banners.

## Application surface (Phase 2 → 3)

- **Tokens:** `src/presentation/global.css` (both `:root` and the dark `@media`
  block) + `tailwind.config.js` (`card`/`muted`/`border` values + new `honey`).
- **Shared primitives:** `components/form/FormField.tsx`; a new shared `Button`
  (button styling is currently inlined in screens); `components/trip/TripCard.tsx`;
  `components/route/{FareEstimate,RideServicesList,RouteSelector,EndpointSummary}.tsx`;
  `components/map/Map.tsx`.
- **Screens:** applied group by group — rider flow, driver side, auth+profile.
- Changes are **visual only** (no behavior/logic/view-model changes) unless asked.
  Saved-places on RiderHome is the one likely _additive_ feature (reading
  `SavedPlace`) and will be confirmed separately before building.

## Assumptions to confirm

1. **Brown-based dark mode** is in scope (shown and approved on screen).
2. **System font** (no custom display font).
3. Saved Home/Work on RiderHome is desired now (data exists); if not, the rows
   simply don't render when the subcollection is empty.
4. Semantic colors (success/warning/error/info) keep their current AA-tuned
   values — only the brand/neutral tokens change.
