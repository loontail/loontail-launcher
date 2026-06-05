# UI-A audit triage (UI-5, 7-24)

Read-only triage. Classification: OPEN / RESOLVED / OBSOLETE with evidence,
concrete fix, Risk, Effort, test note. Per code-guideline §11 (no UI component
unit tests, no jsdom in repo) UI fixes need NO test unless they touch
pure non-DOM logic.

Counts: OPEN = 18, NEEDS-DECISION = 1 (UI-05). RESOLVED = 0, OBSOLETE = 0.

---

## UI-05 — BundleEventsListener reads store via getState() in useEffect

- File: `src/renderer/features/bundle/events.ts` (L10-46).
- Status: **NEEDS-DECISION (lean WONTFIX)**. The audit text itself concludes the
  `useBundleStore.getState().patch` pattern inside `useEffect` is the *correct*
  Zustand imperative pattern, and the empty-dep array is acceptable. The only
  residual risk (events firing before mount) is theoretical; current code
  registers listeners on first render of a top-level always-mounted component.
- Concrete action if pursued: none code-level; at most a `// why` comment noting
  the startup-ordering assumption. Not worth a refactor.
- Risk: Low · Effort: trivial (comment) / large (module-level buffer refactor).
- Test: none.

## UI-07 — STEP_NUMBER static ordinals diverge when LOADER/BUNDLE omitted — OPEN

- Files: `src/renderer/features/clients/components/install/progressLabels.ts`
  (`STEP_NUMBER`, L11-16); `InstallStepper.tsx` (L6 import, L78
  `stepNumber={STEP_NUMBER[step.key]}`).
- Evidence: `buildSteps` can omit LOADER/BUNDLE, so a no-loader client renders
  badges [1,2,4]. `InstallStepper` already has `index` in its `.map` (L74).
- Fix: delete `STEP_NUMBER`; pass `stepNumber={index + 1}` in the map callback;
  drop the `STEP_NUMBER` import. `renderStepIcon`/`StepBadge` signatures
  unchanged (they already take `stepNumber: number`).
- Risk: Low · Effort: trivial · Test: none.

## UI-08 — `#212121` (and title-bar literals) duplicated across window files — OPEN

- Files: `src/main/windows/consoleWindow.ts` (L11 `BACKGROUND_COLOR`, L13-14
  `TITLE_BAR_OVERLAY_COLOR`, `TITLE_BAR_SYMBOL_COLOR`);
  `src/main/windows/mainWindow.ts` (same L11-14).
- Evidence: `BACKGROUND_COLOR = '#212121'`, `TITLE_BAR_OVERLAY_COLOR =
  'rgba(0,0,0,0)'`, `TITLE_BAR_SYMBOL_COLOR = '#a3a3a3'` are identical in both.
  Main-process hex literals (not renderer Tailwind) — guideline §3 spirit, not
  a Tailwind-class violation, but DRY/sync risk is real.
- Fix: new `src/main/windows/windowColors.ts` exporting
  `WINDOW_BACKGROUND_COLOR`, `TITLE_BAR_OVERLAY_COLOR`, `TITLE_BAR_SYMBOL_COLOR`
  (and `TITLE_BAR_HEIGHT` is also duplicated — fold it in). Import in both.
- Risk: Low · Effort: trivial · Test: none.
- Shared file with UI-07? No. Cluster: WINDOW-MAIN.

## UI-09 — BUFFER_LIMIT = 10000 duplicated main+renderer — OPEN

- Files: `src/main/infra/consoleHub.ts` (L17); `src/renderer/console/App.tsx`
  (L15). Both `const BUFFER_LIMIT = 10000`.
- Fix: add `CONSOLE_BUFFER_LIMIT` to a shared console constants file. Cleanest:
  `src/shared/constants/console.ts` re-exported via
  `src/shared/constants/index.ts` (matches existing pattern: progress.ts,
  settings.ts). Both files import it. Note ConsoleHub passes it to
  `new ConsoleBuffer({ limit })`; App passes it to `useConsoleStream(limit, …)`.
- Risk: Low · Effort: small · Test: none.
- Shares the new shared constants file with nothing else in this batch (UI-22
  uses a *renderer-local* console constants file, disjoint). Cluster: CONSOLE-SHARED.

## UI-10 — reconcile poll runs every 1s in terminal states — OPEN

- File: `src/renderer/console/hooks/useConsoleStream.ts` (L162-190 interval;
  `RECONCILE_INTERVAL_MS = 1000` L15).
- Evidence: `window.setInterval` fires unconditionally; deps `[scheduleFlush,
  appendPending]` — does not depend on `state.status`. Runs while IDLE/EXITED/
  CRASHED.
- Fix: gate the interval on an "active" status. Add a derived boolean
  `isLive = state.status === LAUNCHING || RUNNING` and include it in the effect
  deps; early-return (skip creating the interval) when not live. Or keep the
  interval but `return` inside the tick when not live. Statuses come from
  `ConsoleStatuses` (already imported).
- Risk: Low (terminal states produce no new lines; gating is safe). Effort: small.
- Test: backlog asks for an interval test — but this is a React hook needing
  jsdom/fake timers → forbidden by §11. NO test.
- Cluster: CONSOLE-STREAM (shares `useConsoleStream.ts` with no other batch
  item; standalone within this file).

## UI-11 — Highlight not memoized, full char-scan per render — OPEN

- Files: `src/renderer/console/format.tsx` (`Highlight` L44-71, no `React.memo`);
  consumed in `ConsoleLogBody.tsx` (L66-70).
- Fix: wrap with `React.memo` (`export const Highlight = memo(({…}) => …)`).
  Props are `{message:string, query:string, active:boolean}` — shallow equality
  is sufficient, no custom comparator needed. Returns `ReactNode`.
- Risk: Low · Effort: trivial · Test: none.
- Shares `ConsoleLogBody.tsx` with UI-20 and UI-22 → see CLUSTER CONSOLE-LOGBODY.

## UI-12 — module-level seed state in minecraft/hooks.ts — OPEN (low value)

- File: `src/renderer/features/minecraft/hooks.ts` (L13-15
  `activeStatusSeedCount`, `statusSeedQueue`, `statusSeedRequests`; consumed
  L17-46; guard L56/L59).
- Evidence: module-level mutable state survives unmount/remount/HMR. The
  stale-clobber guard (`useMinecraftStore.getState().entries[slug]` at L56 and
  L59) already prevents live-event clobbering, so the real defect is
  test-leakage + a missing `// why` documenting that the guard is intentional.
- Fix (minimal, matches feedback "prove deadness / keep test seams"): add a
  `// why` above the module state explaining live IPC is source-of-truth and the
  entries-guard prevents clobber; optionally export `resetStatusSeedCacheForTests`.
  Do NOT migrate to context/store (over-engineering for a guarded cache).
- Risk: Low · Effort: trivial (comment) / medium (full encapsulation).
- Test: hook test → §11 forbids. NO test.
- NOTE duplicate-of-pattern: UI-04 (DONE, commit 7f3d665) already addressed the
  *bundle* copy of this exact pattern (`bundle/hooks.ts`). Check that commit's
  approach and mirror it here for consistency. Possible the chosen resolution
  there was comment-only.

## UI-13 — trimOverflow trims `lines` but not `pending` — OPEN

- File: `src/main/infra/consoleBuffer.ts` (`trimOverflow` L65-70; `pending`
  pushed in `append` L40; drained `consumePending` L49-53).
- Evidence: after an overflow batch, `consumePending()` returns lines whose ids
  were already spliced out of `this.lines`. Pure non-DOM main-process class.
- Fix: in `trimOverflow`, after `this.lines.splice(0, overflow)`, also drop the
  same count from the head of `this.pending` (pending is a suffix of recently
  appended ⇒ `this.pending.splice(0, Math.min(overflow, this.pending.length))`).
  Cleaner: derive a `minRetainedId` and filter pending — but head-splice is O(n)
  and sufficient.
- Risk: Low · Effort: small.
- Test: **YES, allowed** — `ConsoleBuffer` is a pure class (no DOM); §11 only
  forbids *UI component* tests. Add unit: append past limit in one batch, assert
  `consumePending()` ⊆ `getLines()`. (If a consoleBuffer test file already
  exists, extend it.)
- Cluster: CONSOLE-BUFFER (main-process, disjoint from renderer clusters).

## UI-14 — `'AUTO' as const` opaque wire-coercion — OPEN

- File: `src/main/services/skin/skin.ts` (L190 `const variant = 'AUTO' as const`).
- Fix: add single `// why` line: `// kit requires a literal variant type;
  'AUTO' = detect slim/classic from PNG dimensions`. No code change.
- Risk: Low · Effort: trivial · Test: none.
- Shares `skin.ts` with UI-16 (also edits skin.ts SkinError calls) → CLUSTER SKIN.

## UI-15 — ingest nested ternary in conditional spread — OPEN

- File: `src/main/infra/consoleHub.ts` (`ingest` L196-205; offending spread L203
  `...(code ? (lineArgs ? { code, args: lineArgs } : { code }) : {})`).
- Fix: extract a small `buildLineInput(...)` (or inline-assemble with explicit
  `if`s) so the nested ternary disappears. Keep it a module-private function.
- Risk: Low · Effort: small.
- Test: backlog suggests a `buildLineInput` unit test; the helper is pure (no
  DOM) so a test is *permitted*, but optional/low-value. Recommend NO test
  (trivial refactor, existing flows cover it).
- Shares `consoleHub.ts` with UI-09 (UI-09 only edits the `BUFFER_LIMIT`
  constant). Co-locate but logically separate. CLUSTER CONSOLE-HUB-MAIN.

## UI-16 — SkinError codes in shared errorCodes.ts not domain-local — OPEN

- Files: `src/shared/constants/errorCodes.ts` (Skin* codes L7-9);
  `src/main/services/skin/errors.ts` (`SkinError` typed as broad `ErrorCode`);
  `src/main/services/skin/skin.ts` (many `ERROR_CODES.Skin*` call sites: L37,44,
  76,154,185,207,218,239); renderer side `src/renderer/features/skin/hooks.ts`
  (mutations have NO `onError`/code inspection — errors surface as raw message).
- Evidence: bundle/minecraft put codes in `shared/contracts/*`; skin is the
  outlier. No `src/renderer/features/skin/errorCopy.ts` exists (bundle has
  `errorCopy.ts` as the template).
- Fix: (a) add `SkinErrorCodes` const + `SkinErrorCode` type to
  `src/shared/contracts/skin.ts`; move `SkinUploadFailed`, `SkinClearFailed`,
  `SkinNotAuthenticated` there; remove from `errorCodes.ts`. (b) retype
  `SkinError.code: SkinErrorCode`. (c) update skin.ts call sites. (d) create
  `src/renderer/features/skin/errorCopy.ts` with `KEY_BY_CODE: Record<
  SkinErrorCode,string>` + `localizeSkinError(code,message,t)` mirroring
  `bundle/errorCopy.ts`. (e) wire `onError` in `useUploadSkin`/`useClearSkin`
  to toast via code.
- Risk: **Medium** (cross-layer move: shared + main + renderer; must update all
  8 call sites and the IpcError code passthrough). Effort: medium.
- Test: `localizeSkinError` is pure → unit test permitted (assert non-empty key
  per code). Optional.
- Shares `skin.ts` with UI-14; shares skin renderer feature folder with UI-24.
  CLUSTER SKIN.

## UI-17 — ErrorBoundary logs raw componentStack via console.error — OPEN

- File: `src/renderer/app/ErrorBoundary.tsx` (L20-22).
- Evidence: `console.error('[renderer] uncaught error', error, info.componentStack)`
  — full component stack reaches renderer console → persisted to electron-log.
- Fix (minimal, no new IPC channel): log `error.name + error.message` always;
  include `info.componentStack` only behind a dev flag
  (`import.meta.env.DEV` is available in the Vite renderer). Keep the existing
  biome-ignore. The full IPC-log-channel proposal is larger scope — recommend
  the dev-gate as the pragmatic fix.
- Risk: Low · Effort: trivial · Test: none.
- Cluster: standalone (APP-ERRORBOUNDARY).

## UI-18 — rgba(255,255,255,0.10) inline style in ClientOverview — OPEN

- File: `src/renderer/features/clients/components/ClientOverview.tsx` (L134-137).
- Evidence: `boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 6px 18px -8px
  var(--color-glow-overlay-md)'`. Raw rgba literal — guideline §3/§9 violation.
- Fix: replace the rgba half with a token. Either define
  `--shadow-inset-highlight` (or a `--color-glass-10` mix) in `index.css`
  `@theme` and reference it, or use
  `color-mix(in srgb, var(--color-glass) 10%, transparent)` inline. Best: add a
  named Tailwind shadow utility in `@theme` and drop the inline style entirely.
  Verify the palette has a suitable existing glass token before adding a new one.
- Risk: Low · Effort: small · Test: none.
- Cluster: CLIENT-OVERVIEW (standalone file).

## UI-19 — rounded-xl / rounded-2xl outside radius token set — OPEN

- Files: `src/renderer/shared/ui/Toast/ToastItem.tsx` (L141 `rounded-xl`);
  `src/renderer/features/clients/components/ServersInfo.tsx` (L22, L42, L62
  `rounded-xl`); `src/renderer/features/clients/components/install/InstallProgress.tsx`
  (L29 `rounded-2xl`).
- Evidence: guideline §4 permits only `rounded-sm/md/lg` (+`rounded-full`).
  Confirmed all four occurrences present at stated lines.
- Fix: map `rounded-xl`→`rounded-md` (cards/surfaces are md per §4) for ToastItem
  + ServersInfo; `rounded-2xl`→`rounded-lg` for InstallProgress (top-level
  install card). Confirm visual intent against §4 sizing (md=14px, lg=20px). Do
  NOT add an `xl` token unless design insists.
- Risk: Low · Effort: trivial · Test: none.
- Three distinct files, each also touched by other radius/font tasks? ServersInfo
  has `text-[13px]` (L76) NOT in UI-20's list but a sibling drift — flag for the
  fixer to sweep opportunistically. CLUSTER RADIUS (disjoint files: ToastItem,
  ServersInfo, InstallProgress).

## UI-20 — magic px font sizes / widths — OPEN

- Files + tokens confirmed:
  - `ConsoleLogBody.tsx`: `text-[12.5px]` (L44), `w-[88px]` + `text-[10.5px]`
    (L85), `w-[44px]` + `text-[9.5px]` (L88).
  - `ConsoleToolbar.tsx`: `min-w-[52px]` + `text-[10.5px]` (L67).
  - `ConsoleHeader.tsx`: `text-[9.5px]` (L42).
  - `ProgressBody.tsx`: `text-[13px]` (L35), `text-[14px]` (L47).
- Fix: add named typography tokens in `index.css` `@theme` (e.g.
  `--text-console-body` 12.5px, `--text-console-meta` 10.5px,
  `--text-console-badge` 9.5px) → use `text-console-body` etc.; add column-width
  custom props (`--console-time-width: 5.5rem`, `--console-source-width:
  2.75rem`, `--console-counter-min: 3.25rem`). For ProgressBody prefer existing
  `text-sm`/`text-base` if visually acceptable, else `--text-progress-*` tokens.
- Risk: Low · Effort: medium (touches 4 files + theme; cross-file shared tokens).
- Test: none.
- Shares `ConsoleLogBody.tsx` with UI-11 + UI-22; shares console folder broadly.
  CLUSTER CONSOLE-TYPOGRAPHY (files: ConsoleLogBody, ConsoleToolbar,
  ConsoleHeader, ProgressBody, + index.css). ProgressBody overlaps install
  folder (InstallProgress UI-19) only by sibling, not same file.

## UI-21 — Switch aria-hidden / no standalone interactivity — OPEN

- Files: `src/renderer/shared/ui/Switch.tsx` (L8-24, `aria-hidden`, props only
  `{checked,disabled}`); `src/renderer/shared/ui/SettingsRow.tsx`
  (`SettingsSwitchRow` L52-84 reimplements `role="switch" aria-checked` on the
  button wrapper, renders `<Switch>` as decorative L80).
- Evidence: `<Switch>` is visual-only, usable only inside `SettingsSwitchRow`.
- Fix — recommend option (a) rename for clarity (lowest risk, no behavior
  change): rename `Switch` → `SwitchVisual` (or `ToggleIndicator`); keep
  `aria-hidden`; update the single importer (`SettingsRow.tsx`). This documents
  the contract without an a11y refactor. Option (b) (add `onChange`, self-manage
  role/aria, have SettingsSwitchRow delegate) is better long-term but Medium
  risk and changes the accessible-control ownership.
- Risk: Medium (a11y semantics) · Effort: small (rename) / medium (option b).
- Test: a11y/keyboard test → §11 forbids UI test. NO test.
- Shares `SettingsRow.tsx`/`Switch.tsx` with nothing else here. CLUSTER
  SHARED-SWITCH.

## UI-22 — console virtual-list constants in inverted location — OPEN

- Files: `src/renderer/console/ConsoleLogBody.tsx` (exports
  `CONSOLE_ROW_HEIGHT` L10; `OVERSCAN` L12 module-local); `App.tsx` imports
  `CONSOLE_ROW_HEIGHT` from ConsoleLogBody (L6, used L35).
- Fix: new `src/renderer/console/constants.ts` exporting `CONSOLE_ROW_HEIGHT`
  and `OVERSCAN`; ConsoleLogBody + App.tsx import from there; ConsoleLogBody no
  longer re-exports the constant.
- Risk: Low · Effort: small · Test: none.
- Shares `ConsoleLogBody.tsx` (UI-11, UI-20) and `App.tsx` (UI-09). CLUSTER
  CONSOLE-LOGBODY/APP — coordinate edits.

## UI-23 — Slider inline linear-gradient → CSS custom property — OPEN

- File: `src/renderer/shared/ui/Slider.tsx` (L45-49 inline `background:
  linear-gradient(...)`).
- Evidence: colours already use vars (compliant); only the gradient declaration
  + per-render style churn is the issue. §9 allows inline style for computed
  values — so this is a *perf/cleanliness* nicety, not a hard violation.
- Fix: set only `style={{ '--slider-progress': `${progress}%` } as CSSProperties}`
  and move the `linear-gradient(...)` into a CSS rule in `index.css`
  (e.g. an `@layer` rule on the range input referencing `var(--slider-progress)`).
- Risk: Low · Effort: small (touches Slider.tsx + index.css) · Test: none.
- Shares `index.css` with UI-18/UI-20 (theme/CSS edits) but disjoint component
  file. CLUSTER SHARED-SLIDER.

## UI-24 — validate PNG client-side before upload IPC — OPEN

- Files: `src/renderer/features/skin/hooks.ts` (`useSkinEditor.saveAll` L83-96;
  `useUploadSkin` L19-30 — no client validation, no error state);
  `src/renderer/features/skin/texture.ts` (`normalizeTextureToPng`).
- Evidence: only main-side `skin.ts` (L216) validates via `validatePngBuffer`,
  so dimension/corruption errors cost a full IPC round-trip.
- **Package concern RESOLVED:** `validatePngBuffer` in
  `@loontail/yggdrasil-core` (v0.0.7) is browser-safe — impl (dist/index.js
  L181-216) uses only Uint8Array/DataView, no `Buffer`; ESM `module` export
  exists. The renderer can import it directly; NO new build target needed.
- Fix: in `saveAll` (or a new `validateTexture` util), after
  `normalizeTextureToPng`, call `validatePngBuffer(buffer, 'skin'|'cape')`; if
  `!ok`, set a `useState<string|null>` error (localized) and skip
  `upload.mutate`. Surface the error in the skin editor UI. Map `SkinKinds`→
  `SkinAssetKinds` (the existing `SkinKindMatchesAsset` guard in skin.ts proves
  they share literals).
- Risk: Medium (touches upload UX flow; must thread error state into the editor
  component). Effort: medium.
- Test: `validateTexture` pure wrapper → unit permitted (optional). saveAll is a
  hook → §11 forbids. Recommend a pure-util test only if a util is extracted.
- Shares skin feature folder with UI-16 (errorCopy, hooks) — coordinate the new
  error-state plumbing with UI-16's `localizeSkinError`. CLUSTER SKIN.

---

## Clusters (disjoint file sets; shared files noted)

- **CLUSTER SKIN [Medium]**: IDs=[UI-14, UI-16, UI-24]
  files=[`src/main/services/skin/skin.ts`, `src/main/services/skin/errors.ts`,
  `src/shared/contracts/skin.ts`, `src/shared/constants/errorCodes.ts`,
  `src/renderer/features/skin/hooks.ts`, new
  `src/renderer/features/skin/errorCopy.ts`]. effort=medium.
  Shared: skin.ts (UI-14+UI-16), skin renderer feature (UI-16+UI-24).

- **CLUSTER CONSOLE-RENDERER [Low]**: IDs=[UI-09, UI-10, UI-11, UI-20, UI-22]
  files=[`src/renderer/console/App.tsx`, `ConsoleLogBody.tsx`,
  `ConsoleToolbar.tsx`, `ConsoleHeader.tsx`,
  `hooks/useConsoleStream.ts`, `format.tsx`, new `console/constants.ts`,
  `src/renderer/index.css`(theme tokens)]. effort=medium.
  Shared hot files: ConsoleLogBody.tsx (UI-11/UI-20/UI-22), App.tsx
  (UI-09/UI-22), index.css (UI-20 tokens). UI-09 also needs shared
  `src/shared/constants/console.ts`. ProgressBody.tsx (UI-20) lives in install
  folder, joins this cluster only via the shared typography-token edit.

- **CLUSTER CONSOLE-MAIN [Low]**: IDs=[UI-09(main half), UI-13, UI-15]
  files=[`src/main/infra/consoleHub.ts`, `src/main/infra/consoleBuffer.ts`,
  `src/shared/constants/console.ts`]. effort=small. UI-13 carries the only
  permitted unit test (pure ConsoleBuffer). UI-09 spans main+renderer (shared
  constant) — sequence it first so both halves import the new constant.

- **CLUSTER INSTALL-STEPPER [Low]**: IDs=[UI-07, UI-19(InstallProgress part)]
  files=[`progressLabels.ts`, `InstallStepper.tsx`, `InstallProgress.tsx`].
  effort=trivial.

- **CLUSTER RADIUS [Low]**: IDs=[UI-19]
  files=[`Toast/ToastItem.tsx`, `ServersInfo.tsx`, `InstallProgress.tsx`].
  effort=trivial. (InstallProgress also in INSTALL-STEPPER cluster — same file.)

- **CLUSTER WINDOW-MAIN [Low]**: IDs=[UI-08]
  files=[`src/main/windows/consoleWindow.ts`, `mainWindow.ts`, new
  `windowColors.ts`]. effort=trivial.

- **CLUSTER SHARED-UI [Low/Medium]**: IDs=[UI-21, UI-23]
  files=[`shared/ui/Switch.tsx`, `shared/ui/SettingsRow.tsx`,
  `shared/ui/Slider.tsx`, `index.css`]. effort=small. UI-21 Medium (a11y).

- **CLUSTER STANDALONE [Low]**: IDs=[UI-12, UI-17, UI-18]
  files=[`features/minecraft/hooks.ts`, `app/ErrorBoundary.tsx`,
  `features/clients/components/ClientOverview.tsx`]. effort=trivial each.
  UI-12 mirror DONE bundle fix (commit 7f3d665).

- **NEEDS-DECISION**: UI-05 (`features/bundle/events.ts`) — lean WONTFIX/comment.

### Cross-cluster shared-file warnings

- `src/renderer/index.css` (theme): UI-18, UI-20, UI-23 all add tokens — batch
  the `@theme` edits to avoid conflicts.
- `InstallProgress.tsx`: UI-07-adjacent + UI-19 (radius) — same file, sequence.
- `skin.ts`: UI-14 (comment) + UI-16 (code-code rewrite) — do UI-16 first, then
  UI-14 comment lands cleanly.
- UI-09 spans CONSOLE-RENDERER and CONSOLE-MAIN via the shared constant.
