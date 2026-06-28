# Loontail Launcher — Redesign Spec ("Obsidian Forge", pure monochrome)

Status: **APPROVED — building**
Date: 2026-06-07
Companion: [research-brief.md](./research-brief.md) (7-agent, fully-cited best-practices synthesis)

This is the decided design. It supersedes the current UI for every surface **except the global
Settings page and the Login page** (their layout/components are left untouched; they inherit the new
tokens — see §1.2).

---

## 0. Decisions (locked by the user)

| Decision | Choice |
|---|---|
| Visual direction | **A — "Obsidian Forge"**: premium pro-tool discipline (Linear/Raycast) + big per-build hero art as identity, glass only on chrome. |
| Overhaul depth | **Full structural redesign**: new IA (left nav rail), Home dashboard split from Builds catalog, build detail promoted from modal → full in-app page, refined PLAY/install state machine. |
| Color | **Pure black & white (monochrome).** Graphite surface ladder + tiered off-white text; primary CTA = **white** (brightest element); focus / active-nav / progress / selection use **neutral white/gray** (no hue). **No chromatic accent.** Status conveyed by **icon + shape + text + grayscale weight**, not color. |
| Typography | **Keep Nunito** (already bundled). Apply the new type scale/weights to it. |
| Settings/Login | Layout untouched; **inherit** the new global tokens for consistency. |

Defaults adopted (no objection raised): **add lightweight last-played tracking** (§5.10); **routed
detail page** with a near-full-window sheet as the safe fallback (§5.6).

---

## 1. Scope

### 1.1 In scope (redesigned)
- **App shell**: frameless title bar + **new left nav rail** (replaces the back-button-only chrome).
- **Home** (new): a compact dashboard — "Continue" hero (last-played build) + a "Recently played" strip.
- **Builds** (the current home, reworked): dense two-group catalog ("My Builds" / "Official") with unified search + grid/list toggle.
- **Build detail** (modal → **routed page**): sticky hero with Play, tabbed body (About · Media · Servers · Settings).
- **Create build flow** (modal/wizard, restyled).
- **PLAY / install button + progress** (refined FSM, progress-as-button, global **download strip**).
- **States**: empty / loading (skeletons) / error, across all surfaces.
- **Toasts, auto-updater badge, notifications** (restyled).
- **Setup page** (first-run wizard, restyled).
- **Console window** (separate window, restyled to the new tokens; behavior unchanged).
- **Global design tokens** (`index.css` `@theme` rewrite), glass utility, motion primitives.

### 1.2 Out of scope (kept as-is, structurally)
- **Login page** (`features/auth/components/LoginForm.tsx`).
- **Global Settings page** (`features/settings/**`), including the **Account section + 3D skin viewer** (the skin viewer lives inside Settings → Account today; it stays there).
- Both **inherit** the new global tokens (palette/glass/type) so the app stays consistent; their layout/components are **not reworked**.

---

## 2. Information Architecture & Navigation

### 2.1 Shell layout (1000×624)
```
┌───────────────────────────────────────────────────────────────┐
│ Title bar — 36px (glass). [brand] … [global search] [updater] [native min/max/close] │
├──────┬────────────────────────────────────────────────────────┤
│ Nav  │                                                          │
│ rail │  Content area (≈908 × ~588, 16px gutters)                │
│ 60px │                                                          │
│ ⌂ Home                                                          │
│ ▤ Builds                                                        │
│ ─────                                                           │
│ (bottom) ⚙ Settings   ▦ Console                                │
├──────┴────────────────────────────────────────────────────────┤
│ Download strip — 32px, only when an install/sync is active (expands → queue) │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 Navigation model
- **Persistent left icon-rail (~60px)**: `Home`, `Builds` (top); `Settings`, `Console` (pinned bottom). Each item = icon (lucide) **+ tiny caption**. **Active** item = `--accent-soft` pill + a 2px **white** left indicator bar + a bright-white icon; hover = `--surface-2`.
- **Title bar status cluster** (right): global search field, auto-updater badge, then **native window controls** via Window Controls Overlay.
- **Hard rule**: no two nav items resolve to the same view. `Home` ≠ `Builds`.
- **Console** opens the existing separate window (current mechanism), not an in-shell view.

### 2.3 Views & routing (renderer)
Replace the 2-entry nav stack with a small route model that carries params.

```ts
// shared/lib/stores/navigation.ts  (rewrite)
type Route =
  | { name: 'home' }
  | { name: 'builds' }
  | { name: 'build'; key: CatalogKey }   // build detail page
  | { name: 'settings' };
```
- History stack preserved (`push`/`pop`/`replace`) for Back / Esc / mouse-back-button.
- `build` route restores **scroll position + focus** to the originating catalog card on back.
- Default route: `home`.

### 2.4 Home vs Builds
- **Home** = dashboard. One **Continue** hero (most-recently-played build, big white Play) + a single horizontal **Recently played** strip. No history yet → friendly first-run prompt routing to Builds. Requires **last-played tracking** (§5.10).
- **Builds** = the catalog. Two groups ("My Builds" first, then "Official"), each a labeled section; a **single search box spans both**; a **grid/list toggle**; empty groups auto-hide and show their first-run prompt. "Create build" is the first tile in My Builds.

---

## 3. Layout & Density
- **4px base grid**; spacing rhythm 4 / 8 / 12 / 16 / 24 / 32; line-heights divisible by 4.
- **Catalog grid: 3-up** compact cards in the ~908px usable width (`gap-3` = 12px, 16px page gutters → ~296px cards), 16:9 thumbnail + title + one meta row. Optional 2-up "featured" row for Official.
- Page gutter 16px; card padding 12px; **internal spacing ≤ external** so groups read as groups.
- **No text below 12px**; body 13–14px. Wide-tracked uppercase micro-labels only for true 1–2-word labels.
- Group by proximity, not dividers. Hit targets ≥ 24×24 CSS px (pad click areas beyond glyphs).

---

## 4. Design Token System (rewrite of `index.css` `@theme`)

Token **names are stable**; only values change. (A future color theme = value swap; structure stays.)

### 4.1 Color (OKLCH) — pure monochrome
```css
/* Canvas & surfaces — lighter = more elevated (NOT shadows). Faintly cool-neutral graphite. */
--canvas:    oklch(0.16 0.004 285);  /* behind everything; mostly covered by background image */
--surface-0: oklch(0.19 0.004 285);  /* content backdrop / nav rail base */
--surface-1: oklch(0.22 0.004 285);  /* cards, list rows */
--surface-2: oklch(0.26 0.005 285);  /* hover, raised card, inputs */
--surface-3: oklch(0.31 0.006 285);  /* active / pressed / deep card */

/* Glass — fill carries contrast, blur carries aesthetic */
--glass-chrome: oklch(0.19 0.004 285 / 0.62);  /* blur 12px — title bar, nav rail */
--glass-panel:  oklch(0.19 0.004 285 / 0.82);  /* blur 16px — detail hero scrim / overlays */
--glass-spec:   inset 0 1px 0 oklch(1 0 0 / 0.10);  /* specular top edge */

/* Hairlines — depth comes from these, not shadow */
--line:        oklch(1 0 0 / 0.08);
--line-strong: oklch(1 0 0 / 0.16);

/* Text — tiered off-white, never pure #fff for body */
--text-hi:    oklch(0.97 0 0);      /* headings / build title */
--text:       oklch(0.86 0.004 285);/* default body */
--text-mute:  oklch(0.65 0.006 285);/* secondary / meta / micro-labels */
--text-faint: oklch(0.50 0.006 285);/* disabled / group headers (+tracking) */

/* Primary CTA = WHITE (Play / Install / Update) — the single brightest element. */
--cta:        oklch(0.97 0 0);
--cta-hover:  oklch(1 0 0);
--cta-press:  oklch(0.90 0 0);
--on-cta:     oklch(0.17 0 0);

/* Accent = NEUTRAL (pure monochrome, no hue).
   Carries focus ring, active nav, progress fill, selection — as white/gray. */
--accent:       oklch(0.97 0 0);       /* white — progress fill, active marks */
--accent-soft:  oklch(1 0 0 / 0.12);   /* active-nav bg, selection, chip tint */
--focus-ring:   oklch(1 0 0 / 0.90);   /* paired with a dark halo per-component */

/* Status = MONOCHROME. No hue — convey via icon + shape + text + brightness.
   Faint neutral tints for backgrounds only. */
--state-strong: oklch(0.97 0 0);       /* ready / important: brightest */
--state-muted:  oklch(0.65 0.006 285); /* pending / secondary */
--state-faint:  oklch(0.50 0.006 285); /* idle / disabled */
/* Destructive actions: distinguished by icon + explicit wording + heavier outline,
   NOT red (pure-monochrome choice; revisit only if usability clearly suffers). */
```

### 4.2 Type scale (Nunito; new scale/weights)
Nunito ships weights 400/500/600/700 (already bundled). Rounder letterforms → lighter negative tracking.
```
display   28/32  700  -0.01em   (build hero title)
h1        20/28  700            (section headers)
h2        16/24  600            (card group / panel titles)
body      14/20  400            (descriptions, prose)
body-med  14/20  600            (default UI labels)
caption   12/16  400/500        (meta, secondary)
micro     11/16  700  +0.08em UPPERCASE   (group headers, status chips ONLY)
```
Tabular numerals for RAM / version / player counts / progress %.

### 4.3 Spacing & radii
```
--s-2:2 --s-4:4 --s-8:8 --s-12:12 --s-16:16 --s-24:24 --s-32:32
--r-xs:4  --r-sm:6 (buttons/inputs/nav)  --r-md:8  --r-lg:12 (cards/sheet)  --r-full:9999
gutter 16 · card pad 12 · grid gap 12 · titlebar 36 · rail 60 · row heights 56/64/72 · hero pad 24–32
```

### 4.4 Elevation (surface ladder + hairlines; shadow only for true overlays)
```
e0 flat:   --surface-0 + 1px --line
e1 card:   --surface-1 + 1px --line
e2 hover:  --surface-2 + 1px --line-strong
e3 active: --surface-3 + 1px --line-strong
overlay:   --glass-panel + blur(16px) + shadow 0 16px 48px oklch(0 0 0/0.55) + --glass-spec
```

### 4.5 Background image + glass legibility recipe
Layer order (bottom→top): `background.webp` → **global scrim** (top/bottom gradient + radial vignette) → **near-opaque content surfaces** (cards/panels on `--surface-*`) → **glass chrome** (title bar, rail) → **overlay** (sheet/toast w/ shadow).
- Pre-darken the background with the global scrim so glass always sits on a calm substrate.
- **Cards never use `backdrop-blur`** (perf + legibility). Real glass confined to title bar + nav rail + detail hero scrim (≤ 3 blurred surfaces on screen).
- Blur **12–16px** for chrome/panels; never animate `backdrop-filter`; promote glass to its own layer.
- Each glass text panel carries contrast via its **fill**, not the blur. Hero uses a bottom gradient so title + Play always sit on darkness. Add `--glass-spec` to chrome + CTA for a cheap "liquid glass" cue.
- Honor `prefers-reduced-transparency` → swap glass for opaque `--surface-2`.

---

## 5. Component Specs

### 5.1 Title bar (frameless, 36px)
- Adopt **Window Controls Overlay** (`titleBarStyle:'hidden'` + `titleBarOverlay:{height:36,…}`) so native min/max/close are correct on Windows (right) and macOS handles its own (left). Lay content via `env(titlebar-area-*)`; reflow on `geometrychange`.
- Whole bar `-webkit-app-region: drag`; every interactive child `no-drag`. Preserve double-click-maximize.
- Content (Windows): `[ drag + small wordmark + ALPHA tag ] … [ global search ] [ updater badge ] [ native controls ]`. **Dim brand on window blur.**
- Reuse current `AppBar`; rework into the glass title bar; keep i18n keys (`appBar.*`).

### 5.2 Nav rail (new — `features/app-shell/NavRail.tsx`)
- 60px glass column on `--surface-0`/`--glass-chrome`. Items: icon + 9–10px caption. **Active** = `--accent-soft` pill + left 2px **white** bar + bright-white icon; hover = `--surface-2`. Keyboard: roving tabindex, Enter/Space activate, `aria-current="page"`.

### 5.3 Home dashboard (new — `features/home/HomePage.tsx`)
- **Continue** card: last-played build's key art, title (`display`), one meta row, a big **white Play**. Full-width, ~180–220px tall.
- **Recently played** strip: horizontal row of compact cards (reuse `BuildTile` compact variant), sorted by `lastPlayedAt` desc, reflow column count by width.
- Empty (no history) → centered prompt "Pick a build to start playing" + button → Builds.

### 5.4 Builds catalog (rework of `BuildsHomePage` → `features/builds/BuildsPage.tsx`)
- Header row: title + unified **search** + **grid/list** segmented toggle.
- **My Builds** group: `CreateBuildTile` first, then local tiles. **Official** group below.
- Auto-hide an empty group → first-run prompt. Degraded official → inline "Official unavailable" notice (keep local builds visible).
- Skeleton grid while pending; "no results" state for search misses (distinct from empty).

### 5.5 Build tile (rework `BuildTile` + `BuildGrid`)
- `--surface-1`, `--r-lg`, `overflow-hidden`. **16:9 hero/icon** (poster → generated fallback) as the visual identity; title `body-med`; one meta row (`caption --text-mute`, `MC ver · loader`); a **status chip** (Installed / Update / New / not-installed) — distinguished by **icon + label + grayscale weight**, not hue.
- Hover: `--surface-2` + `--line-strong`, inner image subtle `scale-[1.04]` (Ken Burns, `motion-safe`), reveal a quick **Play** affordance; whole card `motion-safe:hover:scale-[1.02]`, `active:scale-[0.99]`.
- List variant: 56–64px row, thumb + title + meta + status + Play, denser.

### 5.6 Build detail (modal → routed page — `features/builds/BuildDetailPage.tsx`)
- **Full-bleed hero** = *that build's* key art (not the global background) + bottom hero scrim. Title overlaid bottom-left (`display`); **Play is the only primary CTA in the hero**; a version/loader selector sits beside Play (no Settings detour).
- **Sticky hero header** on scroll → title + Play pin (critical at 624px height).
- Body **tabs (icon+label)**: **About · Media · Servers · Settings** (`tablist`/`tab`/`tabpanel`, roving tabindex). Land on **About**.
  - About: `shortDescription` + rendered `description` (markdown), key facts (MC version, loader, server count).
  - Media: `BuildGallery` reworked into the tab.
  - Servers: `ServersInfo` list (collapsible), empty → "No servers · Add server".
  - **Settings (per-build)**: RAM + loader as **inline-editable tiles** (reuse `RamControl`, `ClientLoaderSection`); **Export / Duplicate / Delete** in a **three-dot overflow** (reuse `ClientActionsSection`, `UninstallConfirmModal`). One entry point — no Edit-vs-Settings ambiguity.
- Decompose: `BuildDetailPage` hosts `BuildHero` (sticky) + `BuildDetailTabs`; reuse `BuildAbout`, `BuildGallery`, `BuildMedia`, `ServersInfo`. Delete `BuildDetailModal`. Keep i18n keys.
- **Fallback** if routing proves too invasive: a near-full-window sheet with the same sticky-hero + tabs + focus trap.

### 5.7 Create flow (rework `CreateBuildModal` + `LoaderChoiceModal`)
- Linear wizard, **one primary CTA per step**: name + icon → MC version → loader → RAM. Restyle to new tokens; keep validation + logic.

### 5.8 PLAY / install button — refine the existing FSM
Keep the logic (`selectPlayButtonAction` + `ActionButton` + `InstallProgress`); restyle + re-shape presentation:

| State | Label | Visual |
|---|---|---|
| not-installed | **Install** | white CTA + download icon; confirm if >150 MB |
| checking/queued | **Checking… / Queued** | muted spinner |
| installing | **Installing… 64%** | button *becomes* the progress bar (white/light fill) + Pause/Cancel |
| update (bundle) | **Update** | white CTA + refresh icon + small dot badge |
| verifying/repairing | **Verifying… / Repairing…** | loading state, bar creeps |
| ready | **Play** | brightest element (white CTA), ≥44px |
| launching | **Launching…** → Cancel | inline spinner / cancel |
| running | **Running · Stop** | muted secondary + status dot |
| error | **Retry** | error-marked (icon + heavier outline) + inline reason + "Details → Console" |

Rules: one primary only; disable during transitions (no double-launch); **never disable silently** (show reason + alternate, e.g. "Set install folder"); progress-as-button in compact contexts; `ready → Play` is the single brightest element; **no auto-launch** after install.

### 5.9 Progress UX + download strip (rework `InstallProgress`, `ProgressBody`, add strip)
- **Determinate by default**; indeterminate only for manifest/verify-before-count (slow forward creep, never frozen).
- One weighted overall bar (white/light fill) + changing **phase label** (`Downloading mods · 142/350` → `Verifying…`). Detail line `64% · 412 MB / 1.2 GB · 8.4 MB/s · ~2 min` with **smoothed** speed/ETA (3–5s rolling avg).
- Never backwards; **stall ≥10s** → "Connection slow — still trying…"; accelerate near 100% + brief completion beat → `ready`.
- Pause/Cancel adjacent; Cancel confirms if significant bytes; downloads in **background**.
- **Same progress** on card + detail from one source. New global **bottom download strip** (~32px; expands into a queue) — reuse `useInstallProgress`/bundle stores.

### 5.10 Last-played tracking (new — small main-process addition)
- Persist `lastPlayedAt: Record<CatalogKey, number>` in `electron-store`; write on **successful launch** (hook the minecraft launch service); expose via a renderer hook (`useRecentBuilds`). Powers Home (§5.3) and "Recently" ordering.

### 5.11 Empty / loading / error
- Loading thresholds: <300ms nothing · 300ms–1s busy-button · >1s **skeleton cards** matching real dims · ≥10s determinate progress.
- Empty My Builds: illustration + line + **two CTAs** (primary "Browse Official", secondary "Create build").
- No search results ≠ empty: keep search bar, "No builds match 'X'", "Clear".
- Errors by severity: field-level inline · transient toast w/ Retry · blocking persistent banner w/ why + Console link.

### 5.12 Toasts / updater / notifications (rework `Toast/*`, `UpdaterBadge`)
- Info/success auto-dismiss 3–5s; **errors persist** + carry action (Retry / View log). One position (bottom-right under title bar); queue, don't stack many. Left border + **icon** by type (monochrome; icon/shape conveys severity, not color). `role=status`/`alert` + `aria-live`. Auto-updater badge is a persistent (non-dismissing) marker + "Update ready".

### 5.13 Setup (first-run) — `features/setup/SetupPage.tsx`
- Restyle to new tokens; keep wizard logic. Centered card on the scrimmed background; one primary CTA per step; brand mark.

### 5.14 Console window — `console/*`
- Keep monospaced/high-contrast; restyle header/toolbar/body/banners to new tokens. Destination for error "Details" links; keep auto-scroll/stick-to-bottom, copy-all, level filter.

### 5.15 Skin viewer
- **No structural change** (it lives in Settings → Account, which is out of scope). Inherits new tokens.

---

## 6. Motion & Micro-interactions
```css
--ease-standard:   cubic-bezier(0.4, 0, 0.2, 1);
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);   /* ENTER */
--ease-accelerate: cubic-bezier(0.4, 0, 1, 1);   /* EXIT */
--ease-emphasized: cubic-bezier(0.2, 0, 0, 1);
```
| Purpose | Duration | Easing |
|---|---|---|
| Hover/press/toggle | 100–150ms | decelerate/standard |
| Fade enter / exit | 150 / 75–100ms | decelerate / accelerate |
| Route/sheet enter / exit (build detail) | 200 / 150ms | emphasized-decelerate / accelerate |
| Accordion expand / collapse | 250 / 200ms | standard |
| Hero cross-fade on build switch | 200ms | decelerate |
| Install sweep / shimmer | continuous | linear (filled portion only) |

Enter decelerates, exit accelerates. Press `active:scale-[0.98]`. **Nothing > 250ms.** Everything behind Tailwind `motion-safe:`; global reduced-motion backstop; determinate progress fill stays informative under reduced motion (only shimmer is replaced).

---

## 7. Accessibility Checklist
- Contrast: body ≥ 4.5:1; large/UI ≥ 3:1; verify grays against `--surface-*` **and** the lightest region of `background.webp`.
- Glass legibility from scrim fill, never blur.
- Catalog grid + tabs: **roving tabindex**; don't make every card a tab stop.
- `:focus-visible` ring ≥2px, ≥3:1, with dark halo so it reads on any background; never `outline:none` without replacement.
- Focus not obscured (`scroll-padding-top: 44px`); toasts don't cover focused content.
- Hit targets ≥ 24×24 CSS px; **never color alone** for state — here that's automatic (monochrome), so status MUST pair icon + shape + text.
- Disabled controls carry `aria-disabled` + a reason; keyboard-operable everything; correct ARIA (`tablist`, `aria-current`, `aria-live`, `aria-pressed`).
- Honor `prefers-reduced-motion` and `prefers-reduced-transparency`.

---

## 8. Implementation Map (high level — detailed plan in writing-plans)

New / moved:
- `features/app-shell/` — `AppShell.tsx` (rail + content + download strip), `NavRail.tsx`, `TitleBar.tsx` (from `app-bar`), `DownloadStrip.tsx`.
- `features/home/` — `HomePage.tsx`, `ContinueCard.tsx`, `RecentStrip.tsx`, `useRecentBuilds.ts`.
- `features/builds/` — `BuildsPage.tsx` (from `BuildsHomePage`), `BuildDetailPage.tsx` (+ `BuildDetailTabs.tsx`) replacing `BuildDetailModal.tsx`.
- `shared/lib/stores/navigation.ts` — route model rewrite (§2.3).
- `index.css` — `@theme` token rewrite (§4) **keeping Nunito**; new `--scrim-*`, motion easings.
- Main: last-played store + IPC (§5.10); WCO title-bar config in window creation.

Reused (restyled, logic intact): `PlayButton`/`selectPlayButtonAction`, `ActionButton`, `InstallProgress`, `BuildHero`, `BuildAbout`, `BuildGallery`, `BuildMedia`, `ServersInfo`, `RamControl`, `ClientLoaderSection`, `ClientActionsSection`, `CreateBuildModal`, `LoaderChoiceModal`, `Setup`, `Console`, `Toast`, `UpdaterBadge`.

Constraints: **all repo content in English**; **comments only for genuine why**; **TypeScript `private`**, **Biome** (no ESLint), keep **i18n keys** (EN/UA/RU); no Claude co-author trailer; keep **Nunito**.

---

## 9. Verification
- `npm run lint` (Biome) · `npm run typecheck` · `npm test` · `npm run build`.
- Visual: `npm run shots` (extend `SCREENS` to cover home, builds, build detail, install state, setup, console). Capture **before/after** with the launcher closed. Manual: keyboard nav, reduced-motion, reduced-transparency.
