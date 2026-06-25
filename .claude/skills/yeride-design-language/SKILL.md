---
name: yeride-design-language
description: Use when adding or restyling any YeRide screen or component — choosing colors/tokens, buttons and CTAs, cards, list rows, badges, empty states, spacing, or dark-mode styling.
---

# YeRide design language

The app's visual system: **Cab Yellow `#F7B731` + UPS Pullman Brown `#644117`**,
Uber-familiar, light + dark. Full reference (token tables, type scale, per-component
specs): `docs/superpowers/specs/2026-06-24-ui-redesign-design-language.md`.

## Tokens & dark mode (read first)

- Colors are CSS-variable tokens in **`global.css`** (repo root) as `R G B`
  triplets, wrapped in `tailwind.config.js` as `rgb(var(--token) / <alpha-value>)`.
  Style with the Tailwind classes: `bg-background` `text-foreground` `bg-primary`
  `text-primary-foreground` `text-brand-deep` `bg-card` `bg-muted`
  `text-muted-foreground` `border-border` `bg-honey` `text-honey-foreground`
  `text-success/warning/error/info` (+ `/10` tints).
- **Dark mode is automatic.** The `@media (prefers-color-scheme: dark)` block in
  `global.css` swaps the variable *values*, so **do NOT add `dark:` variants** —
  the token already switches. To add/change a token, edit BOTH the `:root` and the
  `@media` block in `global.css`, then wire it in `tailwind.config.js`.

## Palette + the one hard rule

- `primary` = Cab Yellow (CTAs, pins, active states); `primary-foreground` = dark
  brown text that sits on yellow.
- `brand-deep` = Pullman Brown (headings/wordmark; flips to gold in dark mode).
- `card` = cream surface · `muted` = field/secondary surface · `honey` = chip/badge fill.
- **Accessibility (non-negotiable): yellow is ONLY a fill behind dark text, or an
  accent on a dark surface — never yellow text/icons on a light background** (it
  fails contrast).

## Buttons

Use **`@presentation/components/ui/Button`** for every CTA — props: `label`,
`onPress`, `variant` (`primary` | `secondary`), `disabled`, `loading`, `testID`,
`accessibilityLabel`, `className`. It is full-width in a stretch parent and
content-width under `items-center`. For a busy state pass `loading`; for a
text-change busy state (e.g. "Saving…") pass `disabled` + a dynamic `label`.
**Never inline a `rounded-full` / `rounded-lg` / `rounded-xl bg-primary` pill CTA** —
that's the pre-redesign pattern.

## Patterns (quick reference)

| Element        | Recipe                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| List/link row  | honey icon circle (`h-9 w-9 rounded-full bg-honey` + brown glyph) · title · subtitle (`text-muted-foreground`) · `›` chevron   |
| Section label  | `text-xs font-semibold uppercase tracking-wide text-muted-foreground`                                                         |
| Empty state    | honey icon circle (`h-16 w-16 rounded-full bg-honey`) + heading + muted subtext + `<Button>`                                  |
| Badge / pill   | brand: `rounded-full bg-honey` + `text-[10px] font-bold uppercase text-honey-foreground`; semantic: `bg-success/10 text-success` |
| Card           | `rounded-2xl border border-border bg-card`                                                                                     |
| Bottom sheet   | `bg-card`, top `rounded-3xl`, grab handle (`h-1 w-10 rounded-full bg-border`)                                                 |
| Radii          | buttons/fields/cards `rounded-2xl` · pills & icon circles `rounded-full`                                                      |

## Gotchas (each one was a real bug in this codebase)

- **`text-destructive` is NOT a token** — it renders colorless. Use **`text-error`**.
- Native primitives can't read Tailwind tokens. **Map markers and `ActivityIndicator`
  need explicit hex**: cab yellow `#f7b731` (dark `#fac23c`), Pullman brown `#644117`,
  text-on-yellow `#3a2705`.
- A spinner on a surface that flips in dark mode: pick the color from
  `useColorScheme()` (brown `#644117` on light, gold `#fac23c` on dark) — no single
  static color reads on both.

## Red flags — you're drifting off-language

- Writing `rounded-full`/`rounded-lg`/`rounded-xl` on a `bg-primary` button → use `<Button>`.
- Adding a `dark:` class → the token already switches; remove it.
- `text-destructive`, or any color literal where a token exists.
- A new CTA with an inline `<Pressable>` + `<Text>` instead of `<Button>`.
