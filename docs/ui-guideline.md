# UI Guideline — @loontail/minecraft-launcher

Visual layer rules: design system, typography, icons, theming.

- Code-style rules — see [`code-guideline.md`](./code-guideline.md).
- Structural decisions (process model, modules, IPC) — see
  [`architecture.md`](./architecture.md).

---

## 1. Design system

- The project uses **shadcn/ui** as its component primitive library, on top
  of **Radix UI** and **Tailwind CSS**.
- shadcn is not a runtime dependency — components are **copied into the
  repo** under `src/renderer/shared/ui/` and owned by the project.
- Adding a new primitive:

  ```bash
  npx shadcn@latest add <component>
  ```

  The CLI is configured via `components.json` in the repo root.
- Generic UI primitives (`Button`, `Dialog`, `Input`, `Switch`, …) live in
  `src/renderer/shared/ui/`. Feature-specific UI lives inside the feature
  folder (see code-guideline §3.5).
- Modify shadcn components freely — they belong to us. But keep the
  modification at the primitive's level, not inside feature code. If a
  feature needs a tweaked button, fix the primitive (or compose around it),
  do not fork.

## 2. Styling

- **Tailwind CSS v4** is the only styling layer. Pin `tailwindcss@^4` in
  `package.json`. Do **not** use Tailwind v3 syntax or configuration.
- Tailwind v4 is **CSS-first**: configuration lives in `index.css` via the
  `@theme` directive, not in `tailwind.config.ts`. A JS config file is added
  only if a plugin requires it.
- The entry CSS imports Tailwind with the v4 syntax:

  ```css
  @import "tailwindcss";

  @theme {
    --font-sans: 'Nunito', system-ui, sans-serif;
    /* palette tokens — see §3 Color palette */
  }
  ```

- No CSS-in-JS, no CSS modules, no global `*.css` files except `index.css`.
- Use `clsx` / `tailwind-merge` (`cn()` helper that shadcn generates) for
  conditional classes. Never concatenate class strings by hand.
- Spacing follows the Tailwind scale. Do not introduce arbitrary `[7px]`-style
  values except in genuinely one-off layout cases.

## 3. Color palette

- **All colors come from the project palette.** No hex literals, no
  `rgb(…)` / `hsl(…)` values, no Tailwind defaults like `text-red-500` or
  `bg-zinc-900` anywhere in components.
- The palette is the single source of truth and is declared once in
  `index.css` under `@theme`. The project ships **dark-only**, so dark
  values live directly under `@theme` — there is no `.dark` override block
  and no light palette to maintain:

  ```css
  @theme {
    --color-background:         oklch(0.15 0 0);
    --color-foreground:         oklch(0.95 0 0);
    --color-primary:            oklch(0.70 0.16 250);
    --color-primary-foreground: oklch(0.15 0 0);
    --color-muted:              oklch(0.22 0 0);
    --color-muted-foreground:   oklch(0.65 0 0);
    --color-accent:             oklch(0.30 0.04 250);
    --color-border:             oklch(0.28 0 0);
    --color-destructive:        oklch(0.60 0.22 25);
    /* … */
  }
  ```

- Components reference colors **only** through semantic Tailwind classes
  generated from these tokens: `bg-background`, `text-foreground`,
  `border-border`, `bg-primary`, `text-primary-foreground`,
  `text-muted-foreground`, `bg-destructive`, etc.
- Adding a new color = adding a new token to the palette. Never inline a
  fresh hue in a component.
- The palette tokens follow shadcn's semantic naming conventions
  (`background` / `foreground` pairs, `primary` / `primary-foreground`,
  `muted`, `accent`, `destructive`, `border`, `input`, `ring`). Do not
  invent parallel naming schemes.
- Prefer **OKLCH** over HSL/HEX in token definitions — perceptually uniform
  lightness, easier to keep contrast consistent across the palette.

## 4. Border radius

- Three radius tokens are declared in `@theme` and used everywhere:
  - `--radius-sm` (0.5rem / 8px) — small surfaces: buttons, inputs, chips,
    dropdown items, single-line controls.
  - `--radius-md` (0.875rem / 14px) — cards, section containers, list
    groups, modal panels, viewer frames.
  - `--radius-lg` (1.25rem / 20px) — top-level page-spanning containers,
    hero panels.
- Components reference them through Tailwind's `rounded-sm` /
  `rounded-md` / `rounded-lg`.
- `rounded-full` is reserved for true pills/circles (switch tracks,
  avatars, badge dots).
- Do not introduce arbitrary radius values (`rounded-[7px]`). If a new
  scale step is needed, add a fourth token and document it here.

## 5. Typography

- The single font family is **Nunito**, served via `@fontsource/nunito`.
- Installation:

  ```bash
  npm install @fontsource/nunito
  ```

- Import the needed weights once in the renderer entry
  (`src/renderer/main.tsx` or equivalent):

  ```ts
  import '@fontsource/nunito/400.css';
  import '@fontsource/nunito/500.css';
  import '@fontsource/nunito/600.css';
  import '@fontsource/nunito/700.css';
  ```

  Only weights actually used in the UI are imported. No `@fontsource/nunito`
  full bundle.
- Nunito is wired as the default sans family through Tailwind v4's
  `@theme` directive in `index.css` (see §2):

  ```css
  @theme {
    --font-sans: 'Nunito', system-ui, sans-serif;
  }
  ```

  `font-sans` (the Tailwind default) then resolves to Nunito everywhere.
- No other font families are added without a discussion. Headings and body
  share Nunito; weight differentiates hierarchy, not family.

## 6. Icons

- Use **`lucide-react`** (the shadcn default). No mixing icon libraries.
- Icon size is set via Tailwind (`size-4`, `size-5`), not via the `size` prop
  on the SVG, so it composes with the design system.
- Custom icons (non-Lucide assets) live in `src/renderer/shared/ui/icons/`
  as React components, not raw SVG files imported in components.

## 7. Theming

- **The launcher is dark-only.** There is no light theme, no theme toggle,
  no system-theme detection, no `themeStore`. The palette in §3 is the
  only palette.
- Do not gate any styles on `.dark` / `:not(.dark)` selectors. They have no
  meaning in this project.
- If a light theme becomes a product requirement later, it is introduced as
  a deliberate refactor: move current dark values into `.dark { … }`, add a
  light palette under `@theme`, add a theme store and a `.dark` toggle on
  `<html>`. Do not pre-build any of this scaffolding now.

## 8. Component authorship rules

- A component does one thing. If it grows past ~200 lines or accepts more
  than ~8 props, split it.
- Props are typed inline with `type Props = { … }`; no generic `IProps`
  interfaces. Use discriminated unions for variant components rather than
  boolean prop soups.
- Compose with Radix slots and `asChild` patterns (as shadcn does) — do not
  reinvent polymorphism.
- No business logic in components. Data fetching goes through TanStack Query
  hooks (`useBundleStatus()` etc.); components stay declarative.

## 9. What we do NOT do

- No Tailwind v3 syntax (`@tailwind base;`, `tailwind.config.ts` as primary
  config) — the project is on **Tailwind v4** end-to-end.
- No raw color literals (`#ffffff`, `rgb(…)`, `hsl(…)`) and no Tailwind
  default color shades (`text-red-500`, `bg-zinc-900`) in components.
  Everything goes through palette tokens.
- No light theme, no theme toggle, no `prefers-color-scheme` reads. Dark is
  the only mode (see §7).
- No Material UI, Chakra, Mantine, Ant Design, or other component kits.
- No `styled-components`, Emotion, or other CSS-in-JS.
- No global SCSS / Less / PostCSS plugins beyond what Tailwind ships with.
- No Google Fonts CDN — the font is bundled via `@fontsource` so the app
  works offline and avoids third-party requests.
- No inline `style={{ … }}` for anything that could be a Tailwind class.
  Acceptable only for computed values (e.g. progress bar width).
