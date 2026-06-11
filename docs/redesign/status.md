# Redesign Status — "Obsidian Forge" (pure monochrome)

Branch: `redesign/ui-obsidian-forge`. Base: `main`. Date: 2026-06-08.
All gates green: `npm run verify` (Biome lint · `tsc -b` typecheck · 600 Vitest tests · build) + `node scripts/lintI18n.mjs`.

## Done
- **Foundation:** monochrome `@theme` token system (graphite surface ladder, tiered off-white text, white CTA, neutral focus/accent, motion easings, glass/scrim utilities, reduced-motion + reduced-transparency backstops); full-bleed `background.webp` behind a global scrim; route-based navigation store; last-played tracking (electron-store + IPC + write-on-launch).
- **App shell:** glass title bar (WCO), left icon nav rail (Home/Builds/Settings/Console, roving tabindex), routed content, global Esc/mouse-back.
- **Home dashboard:** Continue hero + Recently-played (reflowing grid), skeleton + empty states.
- **Builds catalog:** header search + grid/list toggle (persisted), two auto-hiding groups, monochrome status chips, skeleton/empty/no-results/degraded-CMS states, roving tabindex.
- **Build detail (routed page, replaces the old modals):** fixed key-art backdrop, IntersectionObserver sticky hero (Play always reachable), accessible tabs (About/Media/Servers/Settings), per-build Settings tab reusing the existing RAM/loader/actions controls.
- **Play/install:** existing FSM preserved, restyled to white CTA + monochrome variants; progress-as-bar with smoothed speed/ETA + monotonic clamp (TDD); stall hint.
- **Setup + Create flow + Console window + Toasts + Updater badge + Notifications:** restyled to the tokens; behavior unchanged.
- Old `BuildDetailModal`, `ClientSettingsModal`, `BuildStatusMarker`, `statusTone.ts`, `app-bar/`, and the old `Views`/`useCurrentView` nav API removed (no dangling refs).
- Settings + Login pages structurally untouched; they inherit the new tokens (per the approved decision).

## Deferred (optional, not built)
- **Global bottom download strip** (spec §2.1/§5.9): a persistent ~32px strip aggregating all active installs/syncs, expanding into a queue. Per-build progress (inside the Play button, on tiles, and in the detail sticky hero) already covers the core need; the global strip is an enhancement. Offered to the user as a follow-up.
- **Install-size confirmation > 150 MB** (spec §5.8): the pre-install download size isn't readily available at the button, so the confirm gate was not added.

## Intentional deviations from the spec
- **Title bar height 40px** (spec said 36px): matches the existing `TITLE_BAR_HEIGHT`/`titleBarOverlay` constant so the renderer height and native WCO overlay stay in lockstep. No visual break.
- **No global title-bar search** (spec §5.1/§2.1): the Builds catalog has its own search; a separate global search is redundant in a two-view app. Descoped.
- **Recently-played as a reflowing grid** (spec §5.3 said "horizontal strip"): reflows column count by width — better use of space than a single overflow row.
- **Per-build Settings as a clean stacked section** (spec §5.6 envisioned inline-editable tiles + a three-dot overflow): functionally equivalent, reuses the existing settings controls, single entry point. The richer tile/overflow layout is a possible future polish.

## Notes
- `biome.json` has a CSS-only override disabling `noUnknownMediaFeatureName` — Biome 1.9 doesn't recognize the valid `prefers-reduced-transparency` media feature; scoped to `**/*.css`.
- `scripts/screenshot.mjs` updated to launch under Playwright in this environment (strips `ELECTRON_RUN_AS_NODE`, adds `--no-sandbox`/`--disable-gpu`); covers home/builds/settings. Authenticated screens require a logged-in profile (the harness's fresh `Roaming/Electron` profile lands on Setup).
