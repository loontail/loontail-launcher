# Launcher Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Loontail launcher UI/UX per [design-spec.md](./design-spec.md) — pure-monochrome "Obsidian Forge" with a left nav rail, Home dashboard, routed build-detail page, refined PLAY/install FSM — for every surface except Settings & Login.

**Architecture:** A token-first rewrite. Phase 0 lays the foundation (monochrome `@theme` tokens, glass/scrim utilities, a route-based navigation store, last-played tracking). Then the app shell (nav rail + title bar + download strip), then Home, Builds catalog, routed Build Detail, the PLAY/progress system, and the remaining surfaces (create/setup/console/toasts). Logic-heavy modules (install FSM, progress, hero/about/gallery/servers, RAM/loader controls) are **reused and restyled**, not rewritten.

**Tech Stack:** Electron + electron-vite, React 19, TypeScript, Tailwind CSS v4 (`@theme`), Zustand, TanStack Query, i18next, lucide-react, Nunito, Biome, Vitest, Playwright screenshot harness.

---

## Conventions (read first)

- **Testing model:** This is a UI redesign. Use **TDD for testable logic** (navigation store, last-played store/selectors, FSM selection, progress formatting, recent-builds sorting) — write the failing test first. For **visual components**, verification = `npm run typecheck` + `npm run lint` + `npm run build` clean, plus the **screenshot harness** (`npm run shots`) and the acceptance criteria listed per task. Don't fabricate brittle DOM assertions for layout.
- **Tokens only:** every color/spacing/radius/motion value comes from the §4/§6 tokens. No raw hex/px outside `index.css`. Monochrome — no chromatic accent anywhere.
- **Repo rules:** all content in **English**; comments only for genuine *why*; TypeScript `private` (never `#`); Biome (no ESLint); preserve **i18n keys** (EN/UA/RU) — add new keys to all three locales; keep **Nunito**.
- **Commits:** steps list commit points for granularity, but **do not commit unless the user asks** (repo policy). When committing is requested, no `Co-Authored-By: Claude` trailer.
- **i18n:** new strings go through `t()` with keys added to every locale file under `src/renderer/i18n/`.

---

## Phase 0 — Foundation

### Task 0.1: Green baseline + before-shots
**Files:** none (verification only)
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` in `loontail-launcher/`. Record pass/fail. Fix nothing yet — just establish the baseline.
- [ ] With any running launcher closed, run `npm run shots -- before` to capture `.shots/before/`. (Harness needs `playwright-core`, already installed.) If it can't launch (instance lock), note it and proceed.

### Task 0.2: Monochrome design tokens (`index.css` `@theme` rewrite)
**Files:** Modify `src/renderer/index.css`
- [ ] Replace the `@theme` block's color tokens with the §4.1 monochrome set (canvas/surface-0..3, glass-chrome/panel/spec, line/line-strong, text tiers, cta/on-cta, accent/accent-soft/focus-ring as neutrals, state-strong/muted/faint). Keep Nunito `--font-sans`. Add `--scrim-top`, `--scrim-hero`, radial-vignette helper, the §4.3 radii, and the §6 motion easings as `--ease-*`.
- [ ] Update the `glass` utility: fill from `--glass-chrome`, blur 12px (panel variant 16px), add `--glass-spec` top highlight; wrap blur in `@media (prefers-reduced-transparency: no-preference)` and provide an opaque `--surface-2` fallback otherwise.
- [ ] Add a global reduced-motion backstop (`@media (prefers-reduced-motion: reduce)` → near-zero durations) if not present.
- [ ] Acceptance: `npm run build` clean; existing screens still render (settings/login will visibly pick up the new palette — expected).
- [ ] Commit: `style(launcher): monochrome design tokens + glass/scrim/motion primitives`

### Task 0.3: Global background image layer
**Files:** Modify `src/renderer/app/App.tsx` (or new `features/app-shell/AppBackground.tsx`); asset `src/renderer/assets/background.webp`
- [ ] Add a fixed, `aria-hidden`, `pointer-events-none` background layer: `background.webp` (object-cover, full viewport) → `--scrim-top` gradient → radial vignette. Import the asset so Vite fingerprints it. It sits behind everything; content surfaces are opaque over it.
- [ ] Acceptance: background visible behind transparent chrome; cards remain fully legible (opaque surfaces); `prefers-reduced-transparency` still readable.
- [ ] Commit: `feat(launcher): full-bleed background image behind global scrim`

### Task 0.4: Route-based navigation store
**Files:** Rewrite `src/renderer/shared/lib/stores/navigation.ts`; Test `tests/renderer/navigation.test.ts`
- [ ] **Step 1 — failing test:** assert: initial route `{name:'home'}`; `push({name:'builds'})` then `push({name:'build',key})` then `pop()` returns to builds; `pop()` at root is a no-op; `replace` swaps top; `canGoBack` reflects depth; pushing the identical top route is a no-op.
- [ ] **Step 2:** run test → fails (new API absent).
- [ ] **Step 3 — implement:**
```ts
import { create } from 'zustand';
import type { CatalogKey } from '@shared/contracts/ids';

export type Route =
  | { name: 'home' }
  | { name: 'builds' }
  | { name: 'build'; key: CatalogKey }
  | { name: 'settings' };

const sameRoute = (a: Route, b: Route): boolean =>
  a.name === b.name && (a.name !== 'build' || b.name !== 'build' || a.key === b.key);

type NavState = {
  stack: Route[];
  push: (r: Route) => void;
  replace: (r: Route) => void;
  pop: () => void;
  reset: (r: Route) => void;
};

export const useNavigationStore = create<NavState>((set) => ({
  stack: [{ name: 'home' }],
  push: (r) => set((s) => (sameRoute(s.stack[s.stack.length - 1], r) ? s : { stack: [...s.stack, r] })),
  replace: (r) => set((s) => ({ stack: [...s.stack.slice(0, -1), r] })),
  pop: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s)),
  reset: (r) => set({ stack: [r] }),
}));

export const useCurrentRoute = (): Route =>
  useNavigationStore((s) => s.stack[s.stack.length - 1] ?? { name: 'home' });
export const useCanGoBack = (): boolean => useNavigationStore((s) => s.stack.length > 1);
```
- [ ] **Step 4:** run test → passes.
- [ ] **Step 5:** typecheck (downstream `Views`/`useCurrentView` consumers will break — App.tsx + AppBar; they're rewritten in Phase 1, so leave a temporary shim export `Views`/`useCurrentView` if needed to keep the build green between commits, removed in Task 1.3).
- [ ] Commit: `feat(launcher): route-based navigation store`

### Task 0.5: Last-played tracking (main + IPC + renderer hook)
**Files:** Modify `src/main/infra/store.ts` (schema + accessor); `src/main/services/minecraft/ops.ts` or `runtimeState.ts` (write on launch); a route in `src/main/services/clients/` or new `services/history/`; `src/preload/index.ts` + `index.d.ts`; new `src/shared/contracts/history.ts`; renderer `src/renderer/features/home/useRecentBuilds.ts`; Test `tests/main/history.test.ts`
- [ ] **Step 1 — failing test (pure selector):** `selectRecent(map, items, limit)` returns items whose `key` is in `map`, sorted by timestamp desc, capped at `limit`, ignoring stale keys not in `items`.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement the pure selector in `src/shared/domain/recent.ts` (no electron deps); add `lastPlayedAt: Record<string, number>` to `LauncherStoreSchema` (default `{}`); add `recordPlayed(key)` + `getLastPlayed()` accessors in `store.ts`; call `recordPlayed(catalogKey)` when a launch reaches RUNNING (find the LAUNCHING→RUNNING transition); expose `history.lastPlayed` over IPC + preload; `useRecentBuilds()` queries it and applies `selectRecent` against the catalog.
- [ ] **Step 4:** run → passes; typecheck clean.
- [ ] Commit: `feat(launcher): persist last-played per build for Home`

---

## Phase 1 — App shell

### Task 1.1: Title bar (retune existing WCO + restyle AppBar)
**Files:** Modify `src/main/windows/windowColors.ts` (overlay color → new tokens), `src/main/windows/mainWindow.ts` (overlay height 36 if not), rework `src/renderer/features/app-bar/components/AppBar.tsx` → `features/app-shell/TitleBar.tsx`
- [ ] WCO already exists (`titleBarStyle:'hidden'` + `titleBarOverlay`). Update overlay `color`/`symbolColor`/`height:36` to match `--surface-0`/`--text-hi`. Keep `title-bar-safe` (`env(titlebar-area-*)`) and drag/no-drag regions.
- [ ] Restyle: glass bar, small wordmark + ALPHA tag (keep `appBar.*` keys), right cluster = (search placeholder slot) + `UpdaterBadge` + native controls gap. Dim brand at `--text-faint` on window blur (`window` blur/focus listener).
- [ ] Acceptance: drag works (outside DevTools), native controls correct on Windows, brand dims on blur, build clean.
- [ ] Commit: `feat(launcher): glass title bar on Window Controls Overlay`

### Task 1.2: Nav rail
**Files:** Create `src/renderer/features/app-shell/NavRail.tsx`; i18n keys `nav.home/builds/settings/console`
- [ ] 60px glass column. Items (lucide): Home (`House`), Builds (`LayoutGrid`) top; Settings (`Settings`), Console (`Terminal`) bottom. Each = icon + 9–10px caption. Active = `--accent-soft` pill + 2px white left bar + bright icon (`aria-current="page"`); hover `--surface-2`. Roving tabindex; Enter/Space activate. Settings → `push({name:'settings'})`; Console → open console window (reuse existing console-open API); Home/Builds → `reset`/`push` routes.
- [ ] Acceptance: keyboard-navigable, active state correct, ≥24px hit targets, build clean.
- [ ] Commit: `feat(launcher): left navigation rail`

### Task 1.3: App shell composition + routing
**Files:** Create `src/renderer/features/app-shell/AppShell.tsx`, `features/app-shell/index.ts`; rewrite `src/renderer/app/App.tsx`; remove temporary nav shim from Task 0.4
- [ ] `AppShell` = TitleBar (full width) + row[ NavRail | `<main>` content ] + `DownloadStrip` (placeholder until Phase 5). Content switches on `useCurrentRoute()`: `home`→`HomePage` (Phase 2 placeholder now), `builds`→`BuildsPage` (Phase 3 placeholder), `build`→`BuildDetailPage` (Phase 4 placeholder), `settings`→ lazy `SettingsPage` (unchanged).
- [ ] `App.tsx` keeps the existing gates (bootstrapping spinner, `needsSetup`→Setup, signed-out→Login) but renders `AppShell` for the authenticated app instead of the old view switch. Mount the global listeners + `ToastContainer` as today. Login/Setup render WITHOUT the rail (full screen).
- [ ] Route enter/exit transitions per §6 (`motion-safe`).
- [ ] Acceptance: navigate Home↔Builds↔Settings via rail; Back works; login/setup unaffected; build + typecheck clean.
- [ ] Commit: `feat(launcher): app shell with rail + routed content`

---

## Phase 2 — Home dashboard

### Task 2.1: ContinueCard
**Files:** Create `src/renderer/features/home/ContinueCard.tsx`
- [ ] Full-width card (~180–220px), build key art (`BuildMedia` background slot) + hero scrim, title (`display`), one meta row (MC ver · loader), and the `PlayButton` for that item. Click art → `push({name:'build',key})`. Acceptance: renders for a given `CatalogItem`; Play wired; build clean.

### Task 2.2: RecentStrip + BuildTile compact variant
**Files:** Create `src/renderer/features/home/RecentStrip.tsx`; ensure `BuildTile` supports a `compact`/grid variant (done in Task 3.1 — if Phase 3 not yet built, render a minimal inline tile and swap later)
- [ ] Horizontal, wrap/reflow by width, sorted by `lastPlayedAt`. Each opens detail. Acceptance: ordering correct via `useRecentBuilds`.

### Task 2.3: HomePage
**Files:** Create `src/renderer/features/home/HomePage.tsx`, `features/home/index.ts`; wire into `AppShell`
- [ ] If recent exists: ContinueCard (most recent) + "Recently played" RecentStrip (rest). Else: centered first-run prompt → `push({name:'builds'})`. Loading skeleton while catalog/history pending.
- [ ] Acceptance: empty + populated states; build/typecheck clean.
- [ ] Commit: `feat(launcher): Home dashboard (continue + recently played)`

---

## Phase 3 — Builds catalog

### Task 3.1: Build tile (grid + list variants)
**Files:** Rework `src/renderer/features/clients/components/BuildTile.tsx` (+ move under `features/builds/` or keep path), `BuildIcon`, `BuildStatusMarker`
- [ ] **Grid variant:** `--surface-1`, `--r-lg`, overflow-hidden, 16:9 media top (poster→generated fallback via `BuildMedia`/`BuildVisualFallback`), title `body-med`, one meta row `caption --text-mute`, monochrome **status chip** (icon + label + grayscale weight). Hover: `--surface-2` + `--line-strong`, inner image `motion-safe:scale-[1.04]`, reveal quick Play; card `motion-safe:hover:scale-[1.02]`, `active:scale-[0.99]`.
- [ ] **List variant:** 56–64px row, thumb + title + meta + status + Play.
- [ ] Acceptance: both variants render from `CatalogItem`; status reads without color; build clean.

### Task 3.2: BuildGrid + skeleton
**Files:** Rework `BuildGrid.tsx`, `BuildGridSkeleton.tsx`, `CreateBuildTile.tsx`
- [ ] 3-up responsive grid, 12px gap, uniform gutters; skeleton matches real card dims. CreateBuildTile = dashed `--line-strong`, plus icon, first in My Builds.

### Task 3.3: BuildsPage
**Files:** Create `src/renderer/features/builds/BuildsPage.tsx` (from `BuildsHomePage.tsx`); index; remove old `BuildsHomePage` usage
- [ ] Header: title + unified **search** (filters both groups by title) + **grid/list** segmented toggle (persist choice in a small zustand value store). Sections: My Builds (CreateBuildTile + locals), Official (with degraded-CMS inline notice). Auto-hide empty groups → first-run prompt. Search miss → "No builds match 'X' · Clear". Open detail via route push (not modal).
- [ ] Acceptance: search, toggle, empty/no-results, degraded CMS all correct; build/typecheck clean.
- [ ] Commit: `feat(launcher): builds catalog page (search, grid/list, two groups)`

---

## Phase 4 — Build detail (routed page)

### Task 4.1: BuildDetailPage scaffold + routing
**Files:** Create `src/renderer/features/builds/BuildDetailPage.tsx`; wire `build` route in `AppShell` to resolve `key`→`CatalogItem` from `useCatalog`; back restores scroll/focus
- [ ] Resolve item by key (fallback: pop to builds if missing). Full-bleed *build* key art backdrop + scrims (reuse the modal's backdrop layering). Scroll container with `scroll-padding-top:44px`.
- [ ] Acceptance: navigating to a build shows its page; Back/Esc/mouse-back return to catalog with scroll restored.

### Task 4.2: BuildHero (sticky)
**Files:** Rework `src/renderer/features/clients/components/BuildHero.tsx`
- [ ] Title (`display`) bottom-left over scrim; **PlayButton** as the only primary CTA; version/loader selector beside Play. Becomes a **sticky compact header** (title + Play) once scrolled past the hero. Keep delete/uninstall hooks via the Settings tab overflow (move out of hero if present).
- [ ] Acceptance: Play reachable while scrolled; sticky transition smooth (`motion-safe`).

### Task 4.3: Detail tabs + restyle content
**Files:** Create `BuildDetailTabs.tsx`; rework `BuildAbout.tsx`, `BuildGallery.tsx`, `BuildMedia.tsx`, `ServersInfo.tsx`
- [ ] `tablist`/`tab`/`tabpanel` (roving tabindex, `aria-selected`), tabs About · Media · Servers · Settings, land on About. About = short+rendered description + key facts. Media = gallery. Servers = collapsible list, empty state. Restyle each to tokens.
- [ ] Acceptance: keyboard tab nav; each panel renders; build clean.

### Task 4.4: Per-build Settings tab
**Files:** New `features/builds/BuildSettingsTab.tsx` composing reused `RamControl`, `ClientLoaderSection`, `ClientActionsSection`, `UninstallConfirmModal`
- [ ] RAM + loader as inline-editable tiles; Export/Duplicate/Delete in a three-dot overflow (`DropdownMenu`). One entry point — no separate Edit/Settings modal. Reuse `useClientSettingsActions`.
- [ ] Acceptance: RAM/loader edits persist; destructive actions confirm (monochrome, icon + wording); build/typecheck clean.

### Task 4.5: Remove the modal
**Files:** Delete `BuildDetailModal.tsx`, `ClientSettingsModal.tsx` (if fully superseded); update all imports/usages; remove dead exports from `features/clients/index.ts`
- [ ] Acceptance: no references to deleted components; `npm run lint`/`typecheck`/`build` clean.
- [ ] Commit: `feat(launcher): routed build-detail page with tabs (replaces modal)`

---

## Phase 5 — PLAY / install button + progress

### Task 5.1: ActionButton restyle
**Files:** Rework `src/renderer/features/clients/components/install/ActionButton.tsx`
- [ ] White CTA (`--cta`/`--on-cta`), hover/press tokens, `--glass-spec` top highlight, ≥44px primary height, `active:scale-[0.98]`, focus-visible ring with dark halo. Secondary/muted and error variants (monochrome: error = icon + heavier `--line-strong` outline, not red). Loader spinner inline.
- [ ] Acceptance: all `PlayButton` actions render correctly through the existing `selectPlayButtonAction` switch (no logic change); build clean.

### Task 5.2: InstallProgress restyle (progress-as-button)
**Files:** Rework `install/InstallProgress.tsx`, `ProgressBody.tsx`, `ProgressControls.tsx`, `progressFormat.ts`, `progressLabels.ts`; possibly `useInstallProgress.ts`
- [ ] In compact contexts the button *becomes* the bar (white/light fill over `--surface-2`), phase label + `%`, detail line `% · done/total · speed · ETA` with **smoothed** speed/ETA (3–5s rolling avg — add to `useByteSpeed`/`progressFormat`). Never backwards; stall ≥10s copy; completion beat → ready. Pause/Cancel adjacent. Indeterminate phases keep a forward creep (reuse `install-indeterminate` keyframe).
- [ ] **TDD where applicable:** test smoothed-speed + ETA formatting + "never backwards" clamp in `progressFormat`.
- [ ] Acceptance: tests pass; install renders determinate/indeterminate correctly; build clean.

### Task 5.3: Global download strip
**Files:** Implement `src/renderer/features/app-shell/DownloadStrip.tsx`; wire into `AppShell`
- [ ] ~32px strip shown only when any install/bundle sync is active (subscribe to install/bundle stores). Collapsed: current item + overall %. Click → expands into a queue list. Same state source as cards/detail.
- [ ] Acceptance: appears/hides with activity; matches card/detail progress; build/typecheck clean.
- [ ] Commit: `feat(launcher): refined play/install button, progress, download strip`

---

## Phase 6 — Remaining surfaces

### Task 6.1: Create flow
**Files:** Rework `CreateBuildModal.tsx`, `LoaderChoiceModal.tsx`, `EmptyBuildsState.tsx`
- [ ] Restyle to tokens; linear wizard feel, one primary CTA per step; keep validation/logic. EmptyBuildsState = illustration + two CTAs (Browse Official / Create build). Acceptance: create flow works end-to-end; build clean.
- [ ] Commit: `feat(launcher): restyled create-build flow + empty state`

### Task 6.2: Setup (first-run)
**Files:** Rework `src/renderer/features/setup/components/SetupPage.tsx`
- [ ] Centered card over scrimmed background; tokens; one primary CTA per step; brand mark. Keep logic. Acceptance: setup renders + completes; build clean.
- [ ] Commit: `feat(launcher): restyled first-run setup`

### Task 6.3: Console window
**Files:** Rework `src/renderer/console/*` (`App.tsx`, `ConsoleHeader`, `ConsoleToolbar`, `ConsoleLogBody`, banners) + `console/styles.css`
- [ ] Apply tokens to chrome (header/toolbar/banners); keep monospaced high-contrast log body, auto-scroll/stick-to-bottom, copy-all, level filter, search. Acceptance: console opens + streams; build clean.
- [ ] Commit: `feat(launcher): restyled console window`

### Task 6.4: Toasts + updater badge + notifications
**Files:** Rework `shared/ui/Toast/*`, `features/updater/UpdaterBadge.tsx`, `features/notifications/*`
- [ ] Bottom-right under title bar; queue not stack; info/success auto-dismiss 3–5s, errors persist + action; left border + icon by severity (monochrome — icon/shape conveys type); `role`/`aria-live`. Updater badge = persistent marker. Acceptance: toasts/notifications render; a11y roles set; build clean.
- [ ] Commit: `feat(launcher): restyled toasts, updater badge, notifications`

---

## Phase 7 — Verification & polish

### Task 7.1: Screenshot coverage
**Files:** Modify `scripts/screenshot.mjs` (`SCREENS`)
- [ ] Add screens: `home`, `builds`, `build-detail` (open first build), `setup` (if reachable), `console` (if reachable). Keep tolerant navigation. Run `npm run shots -- after` (launcher closed). Compare `.shots/before` vs `.shots/after`.

### Task 7.2: Gates green
- [ ] `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` all clean. Fix any fallout.

### Task 7.3: Accessibility pass
- [ ] Verify: focus-visible rings everywhere, roving tabindex on grid + tabs, `scroll-padding-top`, hit targets ≥24px, status never color-only (auto-satisfied — confirm icons present), `prefers-reduced-motion` + `prefers-reduced-transparency` honored, contrast of grays vs surfaces and vs background.webp lightest region.

### Task 7.4: Review
- [ ] Run `/code-review` (or requesting-code-review) over the diff; address correctness + reuse/simplification findings. Confirm no dead code (removed modal, old nav `Views`).

---

## Self-review (against the spec)

- **§1 scope:** Phases 1–6 cover shell, home, builds, detail, play/progress, create, setup, console, toasts; Settings/Login untouched (inherit tokens via Task 0.2). ✓
- **§2 IA/nav:** Task 0.4 (routes) + 1.2 (rail) + 1.3 (shell). ✓
- **§4 tokens:** Task 0.2. ✓ (monochrome; Nunito kept)
- **§5 components:** mapped 1:1 to Phases 1–6 tasks. ✓
- **§5.10 last-played:** Task 0.5. ✓
- **§6 motion / §7 a11y:** Task 0.2 primitives + per-component criteria + Task 7.3. ✓
- **§9 verification:** Phase 7. ✓
- **Placeholder scan:** foundational logic tasks (0.4/0.5/5.2) carry concrete code/tests; visual tasks carry concrete token/structure criteria + build/screenshot verification (appropriate for design work). No "TBD".
- **Type consistency:** `Route`, `useCurrentRoute`, `useCanGoBack`, `selectRecent`, `useRecentBuilds` names used consistently across tasks.
