# UI Guideline — @loontail/minecraft-launcher

Visual layer rules: design system, typography, icons, theming.

- Code-style rules — see [`code-guideline.md`](./code-guideline.md).
- Structural decisions (process model, modules, IPC) — see
  [`architecture.md`](./architecture.md).

The authoritative token list is `src/renderer/index.css`. This document explains
the rules around it; when the two disagree, the CSS wins and this file is the
bug.

---

## 1. Design system

- The UI kit is **hand-owned**. `src/renderer/shared/ui/` (`Button`, `Modal`,
  `Tabs`, `Switch`, `Slider`, `Input`, `Badge`, `Segmented`, `Toast`, …) is
  written by this project on top of Tailwind v4 and nothing else.
- There is **no component library underneath**: no Radix, no Headless UI, no
  MUI. Do not run `npx shadcn@latest add <component>` — the generated components
  are Radix-based and wired to `bg-background`/`text-muted-foreground` tokens
  that do not exist here (§3), so they compile, render unstyled, and produce no
  lint or build error.
- The token vocabulary descends from shadcn's "neutral dark" palette, which is
  why `index.css` carries a translation table for the old names. That is
  archaeology, not a dependency.
- Adding a primitive means writing it in `src/renderer/shared/ui/` and exporting
  it there. Feature-specific UI lives inside the feature folder (see
  code-guideline §3.5).
- Modify a primitive freely — it belongs to us. But keep the modification at the
  primitive's level, not inside feature code. If a feature needs a tweaked
  button, fix the primitive (or compose around it), do not fork.
- Accessible behaviour is hand-built too: `RovingGroup` for arrow-key groups,
  `Modal` for focus trap + scroll lock, explicit `aria-*` on custom controls.
  Because nothing is inherited from a library, a new interactive primitive owns
  its keyboard model — write it, don't assume it.

## 2. Styling

- **Tailwind CSS v4** is the only styling layer. Pin `tailwindcss@^4` in
  `package.json`. Do **not** use Tailwind v3 syntax or configuration.
- Tailwind v4 is **CSS-first**: configuration lives in `src/renderer/index.css`
  via the `@theme` directive, not in `tailwind.config.ts`. There is no JS config
  file and no PostCSS plugin chain beyond what Tailwind ships.
- No CSS-in-JS, no CSS modules, no global `*.css` files except `index.css`.
- Custom utilities are declared with Tailwind v4's `@utility` in `index.css`:
  `app-region-drag` / `app-region-no-drag` (native window drag regions),
  `title-bar-safe` (Windows Controls Overlay insets), `scrim-hero`, `glass`,
  `glass-panel`.
- Use `cn()` from `renderer/shared/lib/cn.ts` for conditional classes; never
  concatenate class strings by hand. `cn()` is a `extendTailwindMerge` instance
  that registers the custom `--text-*` size tokens under the `font-size` group —
  plain `twMerge` silently drops the size class when a `text-<size>` and a
  `text-<color>` appear in the same call.
- Spacing follows the Tailwind scale. Do not introduce arbitrary `[7px]`-style
  values except in genuinely one-off layout cases; recurring magic sizes become
  a `@theme` token instead (see the `--console-*` / `--skin-viewer-*` tokens).

## 3. Color palette

The launcher is **monochrome and dark-only**. Every colour is hue 0 / chroma 0
plus alpha; there is no chromatic accent anywhere.

- **All colours come from the palette.** No hex literals, no bare `rgb(…)` /
  `hsl(…)` values, and no Tailwind default shades (`text-red-500`,
  `bg-zinc-900`) in components.
- The palette is declared once in `index.css` under `@theme`, and referenced
  through the Tailwind utilities Tailwind generates from those token names. The
  families, in the order a reader needs them:

  | Family | Tokens | Use |
  |---|---|---|
  | canvas + surface ladder | `canvas`, `surface-0` … `surface-3` | Opaque backgrounds. Lighter = more elevated. Elevation is lightness, **not** shadow. |
  | CTA | `cta`, `cta-hover`, `cta-press`, `on-cta` | The primary action (Play / Install / Update). White — the single brightest element on screen. |
  | text | `text-hi`, `text`, `text-mute`, `text-faint` | Tiered off-white. `text-faint` is decorative/disabled only: it fails 4.5:1 on opaque surfaces, so it must not carry label text. |
  | neutral accent | `accent-soft`, `ring` | Focus ring, active nav, progress fill, selection. |
  | status | `destructive`, `success`, `warn` (+ `-foreground`) | Differentiated by **brightness only**. Meaning is always carried by icon + shape + text as well — never by hue alone. |
  | translucent chrome | `glass`, `overlay`, `ghost`, `ghost-hover`, `ghost-active`, `chip`, `chip-dark`, `nav`, `modal`, `backdrop`, `glow-*` | Alpha layers for the immersive chrome. |
  | edges | `edge`, `edge-md`, `edge-lg`, `edge-xl` | 1px borders / rings, by prominence. |

- Adding a new colour = adding a new token. Never inline a fresh value in a
  component.
- Prefer **OKLCH** for opaque tokens (perceptually uniform lightness keeps the
  ladder honest); the alpha layers use `hsl(0 0% x% / a)` because alpha is the
  point there.
- The shadcn-era names (`background`, `foreground`, `primary`, `muted`, `accent`,
  `border`, `input`) **do not exist**. `index.css` carries the translation table;
  if you meet one of those names in an old snippet or a generated component,
  translate it rather than adding the token.

## 4. Border radius

- Four radius tokens are declared in `@theme`:
  - `--radius-xs` (4px) — micro chrome: tags, badges, tight chips.
  - `--radius-sm` (0.5rem) — buttons, inputs, dropdown items, single-line
    controls.
  - `--radius-md` (0.75rem) — cards, section containers, list groups, modal
    panels, viewer frames.
  - `--radius-lg` (1rem) — top-level page-spanning containers, hero panels.
- Components reference them through `rounded-xs` / `rounded-sm` / `rounded-md` /
  `rounded-lg`.
- `rounded-xl` / `rounded-2xl` / `rounded-3xl` are **off-ladder**: they resolve
  to Tailwind's stock values, not to a project token, so they silently escape the
  design system. A handful of empty-state icon frames still use them; do not add
  more, and prefer converting one to `rounded-lg` when you touch it.
- `rounded-full` is reserved for true pills/circles (switch tracks, avatars,
  badge dots).
- Do not introduce arbitrary radius values (`rounded-[7px]`). If a new scale
  step is genuinely needed, add a token and document it here.

## 5. Typography

- The single font family is **Nunito**, served via `@fontsource/nunito` and
  wired as `--font-sans` in `@theme`, so `font-sans` resolves to Nunito
  everywhere. Only the weights the UI uses are imported — no full bundle, no
  Google Fonts CDN (the app must work offline and make no third-party request).
- Sizes come from the `--text-*` scale in `@theme`, not from Tailwind's stock
  sizes. Each step carries its own line-height and default weight, so
  `text-h1` / `text-body` / `text-caption` set all three at once:
  `display`, `h1`, `h2`, `body`, `body-med`, `eyebrow`, `caption`,
  `microlabel`, plus the `console-*` and `progress-*` steps for the two dense
  surfaces.
- Adding a step means adding it to `@theme` **and** to the `font-size` class
  group in `renderer/shared/lib/cn.ts` (§2) — otherwise `cn()` drops it whenever
  a colour class is passed alongside.
- Weight differentiates hierarchy, not family. No second font without a
  discussion.
- `--tracking-eyebrow` is the letter-spacing for the uppercase micro-labels;
  use `tracking-eyebrow`, not an arbitrary value.

## 6. Icons

- Use **`lucide-react`**. No mixing icon libraries.
- Icon size is set via Tailwind (`size-4`, `size-5`), not via the `size` prop
  on the SVG, so it composes with the design system.
- Custom icons (non-Lucide assets) live in `src/renderer/shared/ui/icons/`
  as React components, not raw SVG files imported in components.

## 7. Theming and motion

- **The launcher is dark-only.** There is no light theme, no theme toggle, no
  system-theme detection, no theme store. The palette in §3 is the only palette.
- Do not gate any styles on `.dark` / `:not(.dark)` selectors. They have no
  meaning in this project.
- Motion uses the `--ease-*` tokens (`standard`, `decelerate`, `accelerate`,
  `emphasized`): enter decelerates, exit accelerates.
- Three user-preference backstops live in `index.css` and must keep working:
  - `prefers-reduced-motion` collapses animation and transition durations to
    near-instant. The `!important` there is load-bearing — it has to out-specify
    every utility class, which is why `noImportantStyles` and
    `noDescendingSpecificity` are disabled for CSS in `biome.json`.
    Determinate progress fills stay informative: they are data, not decoration.
  - `prefers-reduced-transparency` swaps `glass` / `glass-panel` to an opaque
    surface (which also avoids the `backdrop-filter` GPU cost).
  - `forced-colors: active` restores a solid `CanvasText` focus outline. A
    lightness-only monochrome ladder and alpha focus rings both collapse in
    Windows High Contrast, so this is the highest-risk mode for this palette —
    check it when you touch focus styling.
- The `glass` / `glass-panel` utilities are reserved for **chrome**: title bar,
  nav, hero scrims, floating overlays. Never the scrolling catalog — blur on a
  scrolling surface costs GPU per frame and reads as mush.

## 8. Component authorship rules

- A component does one thing. If it grows past ~200 lines or accepts more
  than ~8 props, split it.
- Props are typed inline with `type Props = { … }`; no generic `IProps`
  interfaces. Use discriminated unions for variant components rather than
  boolean prop soups.
- Compose by rendering children and accepting a `className`, and keep variant
  maps as plain objects fed to `cn()`. There is no `asChild`/slot polymorphism
  here — that pattern belongs to Radix, which this project does not use.
- No business logic in components. Data fetching goes through TanStack Query
  hooks; components stay declarative.

## 9. What we do NOT do

- No Tailwind v3 syntax (`@tailwind base;`, `tailwind.config.ts` as primary
  config) — the project is on **Tailwind v4** end-to-end.
- No raw colour literals and no Tailwind default colour shades in components.
  Everything goes through palette tokens.
- No chromatic status colours. Status is brightness + icon + shape + text.
- No light theme, no theme toggle, no `prefers-color-scheme` reads. Dark is
  the only mode (see §7).
- No Radix, shadcn CLI, Material UI, Chakra, Mantine, Ant Design, or other
  component kits.
- No `styled-components`, Emotion, or other CSS-in-JS.
- No global SCSS / Less / PostCSS plugins beyond what Tailwind ships with.
- No Google Fonts CDN — the font is bundled via `@fontsource`.
- No inline `style={{ … }}` for anything that could be a Tailwind class.
  Acceptable only for computed values (e.g. progress bar width, slider fill).
