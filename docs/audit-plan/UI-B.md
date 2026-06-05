# Audit triage — UI part B (UI-25 … UI-43)

Read-only triage. Classification: OPEN / ALREADY-RESOLVED / OBSOLETE.
Reference: `docs/ui-guideline.md`, code-guideline §10 (comments), §11 (no UI
component unit tests; repo has no jsdom — vitest runs node env only). Therefore
UI fixes below require **no new test** unless a pure helper is extracted.

Conventions to apply on fix: English, minimal comments (`// why` only),
TS `private`, aggressive dead-code removal, biome-only, palette tokens, no
inline style except computed values.

---

## Per-task findings

### UI-25 — ConsoleApp `flashFeedback` timer cleanup — **OPEN**
- File: `src/renderer/console/App.tsx:42-45` (`flashFeedback`), used at 50/52/72/74.
- Evidence: `window.setTimeout(... COPY_FEEDBACK_RESET_MS)` with no stored id and
  no unmount cleanup. Dangling timer fires `setState` after unmount.
- Fix: store id in a `useRef<number | null>`; clear prior timer before scheduling;
  `useEffect` cleanup clears on unmount. Optionally extract `useFlashFeedback`.
- Risk: Low · Effort: trivial · New test: no.

### UI-26 — Modal body-overflow lock not composable — **OPEN**
- File: `src/renderer/shared/ui/Modal.tsx:73-77` (save/restore `previousOverflow`).
- Evidence: stacking case is real — `ClientSettingsModal.tsx:106` mounts a nested
  `UninstallConfirmModal` (`Modal` at `:185`/`UninstallConfirmModal.tsx:21`), and
  `LoaderChoiceModal`/`PlayButton` also use `Modal`. Per-instance save/restore is
  non-composable: closing one modal can restore body overflow while another is
  still open.
- Fix: module-level ref-count — increment on open-effect, decrement on cleanup;
  set `overflow:hidden` only when count goes 0→1, clear only when 1→0. Lives in
  `Modal.tsx`. `// why` one-liner allowed for the singleton-counter invariant.
- Risk: Medium · Effort: small · New test: no (integration test the backlog asks
  for is infeasible — no jsdom; do not add).

### UI-27 — ConsoleLogBody virtualizer ignores dropped-count banner height — **OPEN**
- File: `src/renderer/console/ConsoleLogBody.tsx:32-37` (virtual math),
  `:46-50` (sticky banner inside the scroll container).
- Evidence: banner is `position: sticky` inside the same scroll `div` as the
  virtual rows; it overlaps the first visible row. Virtualizer math uses only
  `scroll.scrollTop`.
- Fix (preferred, simplest): render the dropped-count banner **outside/before**
  the scroll container (move the `droppedCount > 0` block above the
  `ref={scroll.bodyRef}` div) so it never overlaps virtual rows and its height is
  excluded from scroll metrics. Avoids ResizeObserver complexity.
- Risk: Low · Effort: small · New test: no.

### UI-28 — Slider rebuilds gradient style string each render — **OPEN (borderline)**
- File: `src/renderer/shared/ui/Slider.tsx:45-47`.
- Evidence: full `linear-gradient(...)` string rebuilt from `progress` on every
  change. Guideline §9 permits inline style for *computed values* (progress), so
  this is not a hard violation, but the multi-stop string rebuild is avoidable.
- Fix: `style={{ '--slider-progress': \`${progress}%\` } as React.CSSProperties}`
  and define the gradient once in `index.css` (`@layer components`) keyed on the
  CSS var. Single-var update; no React string rebuild.
- Risk: Low · Effort: small (touches `index.css`) · New test: no.

### UI-29 — SkinViewer fixed-size magic numbers + inline style — **OPEN**
- Files: `src/renderer/features/settings/components/sections/account/AccountSkinPreview.tsx:5-6,18,25-26`
  (VIEWER_WIDTH=180/HEIGHT=220, inline style on fallback + props),
  `src/renderer/features/skin/components/SkinViewerCard.tsx:36` (`style={{ width, height }}`).
- Evidence: pixel dims duplicated across fallback div + card wrapper; canvas
  genuinely needs numeric width/height for WebGL.
- Fix: keep numeric `width`/`height` props flowing to the **canvas only**
  (`SkinViewer` needs them). For the *wrapper/fallback sizing*, define
  `--skin-viewer-width/height` tokens (in `index.css` `@theme`) and size via
  `className`. Single source for the box dimensions.
- Risk: Low · Effort: small · New test: no.
- NOTE shared file with UI-30/UI-31 cluster (skin feature).

### UI-30 — No guard around SkinView3d WebGL construction — **OPEN**
- File: `src/renderer/features/skin/components/SkinViewer.tsx:29-41`
  (`new SkinView3d({ canvas, ... })` at `:32`, no try/catch).
- Evidence: constructor throws on missing WebGL context (headless / disabled GPU);
  exception propagates to app-root ErrorBoundary, unmounting all of Settings
  (incl. logout) — user can get stuck.
- Fix: wrap construction in try/catch inside the mount effect; on failure set a
  `canvasError` ref/state and render a placeholder div instead of the canvas
  (`console.warn` once). Localized; no error boundary needed.
- Risk: High (impact) · Effort: small · New test: no (backlog asks to mock the
  constructor — forbidden UI unit test, no jsdom).

### UI-31 — `saveAll` sequential, no per-item error/rollback — **OPEN**
- File: `src/renderer/features/skin/hooks.ts:83-96` (`saveAll`).
- Evidence: skin uploaded then cape uploaded **sequentially** (`await` then
  `await`); on cape failure the skin pending is already cleared (`:88`) and the
  error is a generic rejection — user can't retry cape alone, no per-texture
  context.
- Fix: build a list of pending textures, run via `Promise.allSettled`; clear a
  texture's pending only if *its own* result is `fulfilled`; surface per-texture
  toast (skin/cape) on rejection. Matches per-operation cleanup principle.
- Risk: Medium · Effort: small/medium · New test: no (pure-ish, but lives in a
  hook → no jsdom; skip per §11). If a pure helper is extracted it could get a
  node-level test, but not required.
- NOTE shared file consideration: same `hooks.ts` as UI-36.

### UI-32 — queryPersister uses synchronous localStorage — **OPEN (defer / large)**
- File: `src/renderer/shared/lib/queryPersister.ts:18-22` (`createSyncStoragePersister`).
- Evidence: real synchronous main-thread serialization on each throttled tick.
  Valid perf concern but the fix is architectural: swap to an async IndexedDB /
  async-storage persister (new dep) or a dedicated IPC channel to `userData`.
- Risk: Medium · Effort: large · New test: no (perf benchmark infeasible here).
- Recommendation: keep OPEN but defer — out of scope for a guideline-drift sweep;
  needs a dependency decision. Lowest priority in this group.

### UI-33 — MinecraftEventsListener no-op `offLog` subscription — **ALREADY-RESOLVED**
- File: `src/renderer/features/minecraft/events.ts` (full file read).
- Evidence: there is **no** `minecraftLog` / `offLog` subscription anywhere; the
  listener registers only `minecraftStatus`/`minecraftProgress`/`minecraftError`
  (`:77-100`). The dead subscription described in the backlog is gone.
- Action: mark DONE in backlog. No code change.

### UI-34 — BundleEventsListener `getState()` stale-ref note — **OPEN (trivial)**
- File: `src/renderer/features/bundle/events.ts:12-13` (`getState()` for
  `patch`/`reset`), `:34-36` (`reset` captured by ref), `:44` (empty deps).
- Evidence: pattern is correct for production Zustand; the only issue is a
  test-time stale `reset` ref and an undocumented assumption.
- Fix (preferred, no comment-bloat): dereference at call time —
  `useBundleStore.getState().reset(slug)` inside the `minecraftStatus` handler;
  optionally same for `patch`. Removes the captured-ref gotcha without adding a
  comment. (Backlog's "add a comment" alternative conflicts with the
  no-meaningless-comments rule — prefer the deref.)
- Risk: Low · Effort: trivial · New test: no.

### UI-35 — Updater module-level mutable state — **OPEN**
- File: `src/renderer/features/updater/events.ts:17,22-24` (`lastAutoCheckAt`,
  `userInitiatedCheck`, `lastToastedState`, `lastToastedErrorMessage`); read/
  written across `triggerAutoCheck`, `toastFor`, `UpdaterEventsListener`.
- Evidence: plain module-level mutables; HMR re-eval / second BrowserWindow would
  share/reset them. Real but low-likelihood (single updater listener today).
- Fix: scope the toast-dedup state into a `useRef` object inside
  `UpdaterEventsListener`; `lastAutoCheckAt`/`userInitiatedCheck` are shared
  between `markUserInitiatedCheck` (called elsewhere) and `triggerAutoCheck`, so
  those two are trickier — either move into the updater Zustand store slice or
  leave as-is and only relocate the toast-dedup pair. Lowest-risk partial fix:
  move `lastToastedState`/`lastToastedErrorMessage` into the component ref.
- Risk: Low · Effort: small/medium · New test: no.
- NOTE shared file with UI-37 (same `events.ts`).

### UI-36 — JSDoc on `useSkinEditor` — **ALREADY-RESOLVED**
- File: `src/renderer/features/skin/hooks.ts:45`.
- Evidence: `useSkinEditor` has **no** JSDoc block (declaration is bare at `:45`).
  The what-restating comment the backlog cites is not present. (A separate
  visual-wrapper comment exists in `SkinViewerCard.tsx:14-16`, a different symbol
  not named by UI-36.)
- Action: mark DONE. No change for UI-36 itself.
- Side note (not in scope): `SkinViewerCard.tsx:14-16` comment is mild what-
  restatement; could be trimmed opportunistically but is out of UI-36's scope.

### UI-37 — 'Mount once at app root…' comments in updater/events.ts — **OPEN**
- File: `src/renderer/features/updater/events.ts:103-104` (above
  `UpdaterEventsListener`) and `:120-121` (above `UpdaterAutoCheck`).
- Evidence: both present; what-narration + usage instruction (§10 forbidden).
- Fix: delete both. If the singleton invariant matters, replace with a single
  `// why`: `// Singleton — module-level toast-dedup state is shared.` (only if
  UI-35 leaves that state at module scope; if UI-35 moves it to a ref, drop the
  comment entirely).
- Risk: Low · Effort: trivial · New test: no.
- NOTE shared file with UI-35 — do UI-35 + UI-37 together.

### UI-38 — What-restating comments in PlayButton.tsx — **OPEN**
- File: `src/renderer/features/clients/components/PlayButton.tsx:183-185`
  (progress card) and `:195-196` (bundle error surface).
- Evidence: both present; narrate the following `if` blocks (§10).
- Fix: delete both comment blocks.
- Risk: Low · Effort: trivial · New test: no.
- NOTE shared file with UI-39 (same PlayButton.tsx).

### UI-39 — What-restating comment above `STATUS_PENDING` case — **OPEN**
- File: `src/renderer/features/clients/components/PlayButton.tsx:228-229`.
- Evidence: present; describes what the case renders (§10).
- Fix: delete the comment.
- Risk: Low · Effort: trivial · New test: no.
- NOTE shared file with UI-38 — do UI-38 + UI-39 together.

### UI-40 — 'Coalesce progress emissions…' comment — **OPEN**
- File: `src/renderer/console/hooks/useConsoleStream.ts:94`.
- Evidence: `// Coalesce inbound push batches so a burst of stdout becomes one
  setLines.` — what-restatement of `flushPending`/`scheduleFlush` (§10). The
  `queueMicrotask` rationale (`:121-122`) and Chromium-throttle note (`:160-161`)
  are genuine and must be **kept**.
- Fix: delete only line 94.
- Risk: Low · Effort: trivial · New test: no.
- NOTE shared file with UI-41 (same useConsoleStream.ts).

### UI-41 — Empty-catch block comment in useConsoleStream.ts — **OPEN**
- File: `src/renderer/console/hooks/useConsoleStream.ts:84-86`.
- Evidence: `catch(() => { /* main may not be ready yet — live updates will
  catch us up */ })`. §10 prefers a `// why` line over a `/* */` body comment for
  a non-obvious empty catch (startup race is genuinely non-obvious).
- Fix: replace with `// main may not be ready on mount; the reconcile poll catches up.`
- Risk: Low · Effort: trivial · New test: no.
- NOTE shared file with UI-40 — do UI-40 + UI-41 together.

### UI-42 — Magic `1024 ** 2` in FolderInfoBlock — **OPEN**
- File: `src/renderer/features/settings/components/FolderInfoBlock.tsx:9`
  (`BYTES_PER_GB` exists), `:15` (`1024 ** 2` inline).
- Evidence: `BYTES_PER_MB` missing; `1024 ** 2` used raw at `:15`.
- Fix: add `const BYTES_PER_MB = 1024 ** 2;` and use it at `:15`.
- Risk: Low · Effort: trivial · New test: no.

### UI-43 — `LAUNCHER_SETTINGS_STALE_TIME_MS` comment names internal fn — **OPEN**
- File: `src/renderer/features/settings/hooks.ts:22-24`.
- Evidence: comment cites `persistRuntime` as a cross-reference example (§10
  grey-zone; couples comment to a non-public fn name).
- Fix: replace `e.g. \`persistRuntime\` after install` with a generic phrasing,
  e.g. `e.g. runtime path stored after install`.
- Risk: Low · Effort: trivial · New test: no.

---

## Summary counts

- OPEN: 16 — UI-25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 37, 38, 39, 40, 41, 42, 43
  (that is 17 IDs; see note) 
- ALREADY-RESOLVED: 2 — UI-33, UI-36
- OBSOLETE: 0

Correction: OPEN = 17 (UI-25,26,27,28,29,30,31,32,34,35,37,38,39,40,41,42,43);
RESOLVED = 2 (UI-33, UI-36); OBSOLETE = 0. Total 19.

UI-32 is OPEN but recommended **deferred** (large/architectural, needs a dep
decision) — not part of the guideline-drift sweep.

---

## Clusters (disjoint file sets)

### CLUSTER comments-cleanup [Low] — pure §10 comment deletions/edits
- IDs: UI-37, UI-38, UI-39, UI-40, UI-41, UI-43 (and UI-36 already resolved)
- Files (disjoint per sub-pair):
  - `features/updater/events.ts` — UI-37 (shares file with UI-35)
  - `features/clients/components/PlayButton.tsx` — UI-38 + UI-39
  - `console/hooks/useConsoleStream.ts` — UI-40 + UI-41
  - `features/settings/hooks.ts` — UI-43
- Effort: trivial each. No tests. Do as one sweep.

### CLUSTER skin-feature [High] — SkinViewer robustness + sizing
- IDs: UI-29, UI-30, UI-31 (UI-36 resolved)
- Files:
  - `features/skin/components/SkinViewer.tsx` — UI-30
  - `features/skin/components/SkinViewerCard.tsx` — UI-29 (wrapper sizing)
  - `features/settings/.../account/AccountSkinPreview.tsx` — UI-29 (dims/fallback)
  - `features/skin/hooks.ts` — UI-31 (also UI-36-resolved symbol)
  - `index.css` — UI-29 (skin-viewer size tokens)
- Shared file: `hooks.ts` (UI-31) and the skin components; treat as one unit.
- Effort: small (29), small (30), small/medium (31). No tests.

### CLUSTER console [Low] — console window UI
- IDs: UI-25, UI-27 (plus UI-40/41 comments, listed under comments cluster)
- Files (disjoint):
  - `console/App.tsx` — UI-25 (timer cleanup)
  - `console/ConsoleLogBody.tsx` — UI-27 (banner out of scroll container)
- Effort: trivial (25), small (27). No tests.

### CLUSTER ui-primitives [Medium] — shared/ui primitives
- IDs: UI-26, UI-28
- Files (disjoint):
  - `shared/ui/Modal.tsx` — UI-26 (ref-counted overflow lock)
  - `shared/ui/Slider.tsx` + `index.css` — UI-28 (CSS-var gradient)
- Shared file: `index.css` is also touched by UI-29 (skin cluster) — coordinate
  the `@theme`/`@layer` edits to avoid conflicts.
- Effort: small each. No tests.

### CLUSTER events-state [Low] — listener module-state hygiene
- IDs: UI-34, UI-35 (and UI-37 comment in same updater file)
- Files (disjoint):
  - `features/bundle/events.ts` — UI-34 (deref at call time)
  - `features/updater/events.ts` — UI-35 + UI-37 (do together)
- Effort: trivial (34), small/medium (35). No tests.

### DEFERRED — perf/architecture
- UI-32 — `shared/lib/queryPersister.ts`. Large; needs dependency decision.
  Out of scope for the guideline-drift sweep.

## Cross-cluster shared-file note
- `src/renderer/index.css` is touched by UI-28 (Slider gradient), UI-29 (skin
  viewer size tokens). Serialize those edits (one PR or careful ordering).
- `features/updater/events.ts` touched by UI-35 and UI-37 — do as one change.
- `PlayButton.tsx` (UI-38/39), `useConsoleStream.ts` (UI-40/41), `skin/hooks.ts`
  (UI-31) each have intra-group overlaps already grouped above.
