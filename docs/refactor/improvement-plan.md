# Improvement Plan — Loontail Launcher Refactor

> **Implementation status (2026-06-13):** Waves 0–9 all landed and verified. Test suite grew
> 604 → 762 (+158), all green; `npm run verify` (biome + tsc + vitest + electron-vite build)
> passes. Coverage instrumentation (`@vitest/coverage-v8`) added (non-blocking). Work is on
> branch `redesign/ui-obsidian-forge`, uncommitted. Appendix C decisions (API_TOKEN strategy,
> release-pipeline trigger, DL-13 launch-pause semantics) remain OPEN — they need maintainer
> input and were intentionally not implemented.


Derived from a 10-dimension adversarial review (flow-download, flow-install-launch,
flow-build-creation, flow-update, arch-layering, arch-lifecycle-ipc, renderer-quality,
tests-quality, dedup-dead-code, perf-security). Every finding below was verified against
current code; where a verdict corrected scope, line numbers, or safety, those corrections
are folded into the task description. Read `architecture-map.md` for system context.

All paths are relative to `e:/workspace/elixir/loontail-launcher/`. Gate every task with
`npm run verify` (biome + tsc + vitest + electron-vite build). Conventions: Biome-only,
TypeScript `private` keyword, no decorative comments (only `// why`), no kit/yggdrasil
package changes, no UI redesign.

---

## 1. Executive summary

### Counts by kind

| Kind | Count | IDs (deduped across finders) |
|---|---|---|
| bug | 9 | DL-1 (classify ABORTED), DL-2 (pause-during-fetch delete), DL-3/DL-2 (startInstall op gap), DL-2 (launch cancel drop), DL-3 (updater wedge), DL-1 (window lifecycle), DL-2 (init-vs-load race), DL-1 (double-toast), DL-2 (create double-surface), DL-4 (updater empty version), DL-6 (clearSkin silent), DL-9/A17 (ENOENT processed), DL-4 (builds.listMinecraftVersions arg), DL-8 (kit version fallback), DL-3 (InstallOp.fresh) |
| structural | 12 | minecraft⇄bundle cycle, CatalogKey migration, sync state machine, DI getClient, DI setActiveCatalog, service registry, loader-ambiguity, progress normalization, install op-map for sync, launch op churn, typed emit, updater singletons, Context.resolved narrow, LAU-23 |
| perf | 5 | getInstallState TTL, buildPlan concurrency, query persister scope, updater dead surface |
| security | 2 | API_TOKEN (×2 finders), release pipeline ordering |
| test | 8 | SyncStateStore/OpRegistry seam, vitest setupFiles, shared fixtures, DLI-64 ordering, DLI-65 plan branch, updater coverage, integration wave, clients.list dead route |
| cleanup | 14 | resetForUninstall, dead HTTP helpers, dead clients.list, _internals trailer, sha256 dedup, renderer dead cluster, getCurrentLanguage, comment trims, over-exports, etc. |

### Counts by adjusted impact

- **high (3):** DL-1 classify-as-ABORTED misclassification; minecraft⇄bundle cycle break;
  main-window lifecycle orphan. (startInstall op gap is verified-high by one finder,
  medium by another — treated as high-priority Wave 1.)
- **medium (~16):** sync state machine, CatalogKey migration, DI consistency, progress
  normalization, getInstallState TTL, buildPlan concurrency, updater wedge, double-toast,
  service registry collapse, persister scope, test seams/fixtures, dead-route deletion.
- **low (~28):** comment trims, micro-dedup, dead-code removal, narrow type fixes,
  test-coverage additions on already-correct code.

### Headline structural moves

1. **Test seams first (Wave 0):** introduce an injectable sync-state/op seam and a typed
   `seedActiveSync`/`seedOp` helper so the state-machine and op-map refactors stop
   desynchronizing hand-copied private fixtures (S9). Add vitest `setupFiles` and shared
   fixture builders to drain ~22 duplicated env blocks and ~13 fixture copies.
2. **High-impact correctness bugs (Waves 1-2):** fix the four destructive/incorrect paths —
   error misclassification, pause-during-fetch mass-deletion, startInstall op-map gap +
   launch cancel drop, and the main-window lifecycle orphan.
3. **Structural decoupling (Waves 3-5):** break the minecraft⇄bundle import cycle via an
   injected heal port + neutral bundle-ownership module; make the sync lifecycle an explicit
   phase enum; collapse DI inconsistencies (getClient injection, setActiveCatalog removal,
   service-registry array); register a BUNDLE_SYNCING op for the post-install/repair sync.
4. **CatalogKey migration (Wave 6):** the one central type seam — retype the punned
   `minecraft.*`/`bundle.*`/`settings.*` channels to CatalogKey, with the required
   folder-naming decoupling, store migrations, and event-payload schema updates that the
   verdicts flagged as missing from the original proposals.
5. **Perf, dedup, cleanup, security (Waves 7-9):** TTL cache, bounded planning I/O,
   persister scoping, dead-code removal, comment trims, and the security/CI hardening that
   stays mostly server- or infra-bound.

---

## 2. Wave overview

| Wave | Theme | Tasks | Notes |
|---|---|---|---|
| 0 | Test seams (unblockers) | 3 | Must land before state-machine / op-map refactors |
| 1 | High-impact bugs A | 4 | classify, pause-delete, startInstall op gap, launch cancel |
| 2 | High-impact bugs B + window lifecycle | 3 | window orphan, double-toast, updater wedge |
| 3 | Structural: minecraft⇄bundle decouple | 1 | cycle break (large, file-isolated) |
| 4 | Structural: DI + op-map + sync machine | 4 | disjoint files |
| 5 | Structural: registry, loader, progress, narrow types | 5 | disjoint files |
| 6 | CatalogKey migration | 1 | central type seam (large) |
| 7 | Perf | 3 | TTL cache, plan concurrency, persister scope |
| 8 | Tests (coverage growth post-seam) | 4 | ordering, plan branch, updater, integration |
| 9 | Cleanup / dead code / comments / security | 9 | disjoint files |

Within each wave, files touched by different tasks are disjoint. Where two findings touched
the same file they were merged into one task or split across waves (noted per task).

---

## WAVE 0 — Test seams (unblock state-machine + op-map refactors)

### W0-T1 — Injectable SyncStateStore + OpRegistry seam; delete private-cast fixtures
- **Source:** tests-quality/DL-1 (S9), flow-download/DL-4 (registry sub-claim)
- **Files:**
  - `src/main/services/bundle/syncState.ts`
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/minecraft/manager.ts`
  - `src/main/services/minecraft/ops.ts`
  - `src/main/services/minecraft/env.ts`
  - `tests/main/services/bundle/managerPauseCleanup.test.ts`
  - `tests/main/services/bundle/managerResumeCleanup.test.ts`
  - `tests/main/services/bundle/managerSyncErrors.test.ts`
  - `tests/main/services/minecraft/managerCancel.test.ts`
  - `tests/main/services/minecraft/managerStatus.test.ts`
- **Change:** In `syncState.ts`, add a thin `SyncStateStore` facade over
  `Map<ClientSlug, ActiveSync>` (`get/set/delete/has/size/values`) plus a test-only
  `seedActiveSync(store, {slug, clientFolder, bundleSlug, forLaunch, paused?})` that builds
  the record through the real `createSyncTask`/`createActiveSync` so the shape lives in ONE
  place. Add an optional last constructor param `syncStore = new SyncStateStore()` to
  `BundleManager` and route `this.activeSyncs` through it. For minecraft, add an `OpRegistry`
  wrapping `Map<ClientSlug, Op>` plus `seedOp(registry, slug, op)`. **Critical (verdict
  correction):** the `ops` Map is shared into `env.ops` and mutated across install/launch/
  repair/uninstall — the OpRegistry MUST expose its backing Map so `env.ops` keeps pointing
  at the same object; do NOT migrate the six consumer modules to a new API in this task.
  Delete `ActiveSyncShape`, the inline rebuilders, and all `as unknown as {activeSyncs|ops}`
  manager-internals casts; replace seeding with the shared helpers.
- **Test plan:** All five touched files stay green with identical behavioral assertions
  (only seeding mechanism changes). Add a tsc-drift guard: temporarily add a required field
  to `ActiveSync` and confirm `npm run typecheck` errors in `syncState.ts`, not at runtime.
  `grep "as unknown as" tests/main/services/bundle` for manager files → 0.
- **Risk:** medium. Touches two production managers + five test files; env.ops aliasing is
  the trap — verify the same Map object is handed to `env.ops` after the wrap.

### W0-T2 — vitest setupFiles for env seeding; remove 22 vi.hoisted env blocks
- **Source:** tests-quality/DL-2 (D7/S8)
- **Files:**
  - `vitest.config.ts`
  - `tests/setup/env.ts` (new)
  - (edits the 22 test files carrying `process.env.API_URL ??=` / `API_TOKEN ??=`; the
    3 also seeding `MOJANG_CLIENT_ID ??=`)
- **Change:** Create `tests/setup/env.ts` setting `process.env.API_URL ??=
  'http://test.invalid'`, `API_TOKEN ??= 'test-token'`, and **MOJANG_CLIENT_ID ??=** the
  zero-UUID (required by the 3 auth/contract files — verdict). Register via
  `test.setupFiles: ['./tests/setup/env.ts']`. Strip the env lines from all 22 `vi.hoisted`
  blocks. Where a file's `vi.hoisted` existed ONLY for env (the 6 no-return blocks:
  install.test.ts, installManifest.test.ts, healer.test.ts, auth.test.ts env block,
  mojangAuth.test.ts, contractCoverage.test.ts) delete the block entirely. For
  store.test.ts/cache.test.ts keep the hoisted block (it returns mkdtemp dirs), strip only
  the 2 env lines. Do NOT change `config.ts` (import-time fail-fast is deliberate).
- **Test plan:** `npm test` green with no per-file env seeding; run with all env vars unset
  in the shell to confirm the setupFile supplies them.
- **Risk:** low. NOTE: this file set is disjoint from W0-T1's test files except none overlap
  the manager fixture files being edited there — verify no double-edit on shared lines (the
  env blocks and the cast/seed blocks are different regions, but sequence W0-T1 → W0-T2 to
  be safe since both touch `managerPauseCleanup`/`managerResumeCleanup`/`managerSyncErrors`).
  **Sequencing constraint:** W0-T2 runs AFTER W0-T1 (shared test files).

### W0-T3 — Shared test-fixture builders + single createTestRouter helper
- **Source:** tests-quality/DL-3 (D7)
- **Files:**
  - `tests/helpers/fixtures.ts` (new)
  - `tests/helpers/router.ts` (new)
  - all ~13 test files defining `launcherSettings`/`makeBroadcaster`/`makeHealer`/
    `createTestRouter`/`captureThrow` (verdict expands the finder's list to include
    `managerRepair.test.ts`, `minecraft/context.test.ts`,
    `bundle/managerSyncErrors.test.ts`, `bundle/managerSyncForLaunchSignal.test.ts`,
    `system/routes.test.ts`, `auth/auth.test.ts` — cover ALL of them, not a subset)
- **Change:** `fixtures.ts` exports `makeLauncherSettings(overrides?: DeepPartial<...>)`,
  `makeBroadcaster()` (bundle 3-method), `makeMinecraftBroadcaster()` (4-method), and
  `makeHealer()`. `router.ts` exports `createTestRouter()` and `captureThrow()`. Replace all
  inline copies with imports. **Verdict constraints:** keep `createTestRouter` a PURE fake
  (do NOT wrap the real `createRouter` — it would Error-wrap/sentinel-encode and break the
  `.rejects.toMatchObject({code})` assertions); do NOT touch the unrelated synchronous
  `captureThrow` in `parseArgs.test.ts`.
- **Test plan:** `npm test` green; spot-check managerStatus empty-clients vs
  managerPauseCleanup seeded-override both pass through the parameterized builder.
- **Risk:** low. **Sequencing:** runs AFTER W0-T1 and W0-T2 (shares manager test files;
  fixtures must be extracted last so the cast/env edits already landed).

---

## WAVE 1 — High-impact bugs (download/install/launch correctness)

### W1-T1 — classifyBundleError: check BundleError code before signal.aborted
- **Source:** flow-download/DL-1 (E1)
- **Files:**
  - `src/main/services/bundle/errors.ts`
  - `tests/main/services/bundle/managerSyncErrors.test.ts`
- **Change:** In `classifyBundleError`, swap the order: `if (error instanceof BundleError)
  return error.code;` FIRST, then `if (signal?.aborted) return ABORTED;`, then UNKNOWN. This
  is the single production callsite (manager.ts:343); all abort paths already wrap to
  `BundleError(ABORTED)`, and raw non-BundleError aborts still fall through to the signal
  check. `runner.ts`/`manager.ts` are NOT edited (their behavior is correct once classify is
  fixed) — keeping this task's files disjoint from W1-T2.
- **Test plan:** Direct unit: `BundleError(DOWNLOAD_FAILED)` + aborted signal → DOWNLOAD_FAILED;
  plain `Error` + aborted signal → ABORTED. In `managerSyncErrors.test.ts`, make the
  `runSyncPhases` mock call `task.abort.abort()` BEFORE throwing
  `BundleError(DOWNLOAD_INTEGRITY_FAILED)` (the sibling-abort pattern) and assert
  `broadcaster.error` got code `downloadIntegrityFailed` and status ERROR. Keep cancel→
  CANCELLED and pause→silent cases green.
- **Risk:** low.

### W1-T2 — Pause-during-FETCHING_MANIFEST + resume no longer deletes the bundle
- **Source:** flow-download/DL-2 (A2, subsumes DLI-11)
- **Files:**
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/bundle/syncState.ts`
  - `src/main/services/bundle/plan.ts`
- **Change:** Replace the `PreparedPlanSource` `loadRemoteManifest` closure pair with one
  ActiveSync-owned `ensureRemoteManifest()` that fetches via
  `fetchRemoteManifest(active.bundleSlug, task.abort.signal)` when
  `active.remoteManifestHash === ''` and returns the cached manifest otherwise;
  `continuePausedSync` uses the same method, so resume-after-pause-during-fetch refetches
  instead of planning against `{}`. **Preserve the `force` field** carried on
  `PreparedPlanSource` (runSync passes `req.force`, continuePausedSync passes false). Emit
  FETCHING_MANIFEST status only when `ensureRemoteManifest` actually fetches (skip on cached
  resume). Add a defensive guard in `persistLocalManifest`: if `remoteManifestHash === ''`,
  log a warning and skip the write (the `''` sentinel is unambiguous — real hashes are
  64-char hex). Optionally reject `bundle.pause` while status is FETCHING_MANIFEST.
  `plan.ts` is touched only minimally (no behavior change here — kept in this task to avoid
  a Wave conflict with W6 which also edits plan.ts; if no plan.ts edit is needed, drop it
  from this task's file list).
- **Test plan:** Public-surface test (managerResumeCleanup style): stub `fetchRemoteManifest`
  to reject ABORTED on first call, return a real manifest on second; seed a populated local
  manifest on disk; startSync → pauseSync during fetch → resumeSync; assert
  `fetchRemoteManifest` called twice, NO file deleted, persisted sidecar has non-empty hash.
  Unit: `persistLocalManifest` with hash `''` does not call `saveLocalManifest`.
- **Risk:** medium. **File-disjoint from W1-T1** (errors.ts vs manager/syncState/plan).

### W1-T3 — startInstall registers INSTALL_STARTING op before buildContext await
- **Source:** flow-download/DL-3 (A1, DLI-42), flow-install-launch/DL-1 (A1),
  flow-build-creation/DL-2 (A1, DLI-42)
- **Files:**
  - `src/main/services/minecraft/manager.ts`
  - `src/main/services/minecraft/ops.ts`
  - `src/main/services/minecraft/install.ts`
- **Change:** Add `INSTALL_STARTING` to `OpKinds` as `{kind, abort: AbortController}` with
  `OP_TO_STATUS → INSTALLING` and a cancel() branch + cancelAll() branch (adding the kind to
  the Op union forces TS exhaustiveness errors in both switches via assertNever — good). In
  `startInstall`, after requireIdle/acquireWriteLock, set the placeholder op synchronously,
  call `lock.setCancel` BEFORE the await (mirror startRepair), emit INSTALLING. On
  buildContext rejection: delete the op AND release the lock. On `signal.aborted` after
  buildContext resolves: delete the op, release the lock, AND bail to presence-derived status
  (both the op-delete and lock-release are mandatory per verdict — original proposal
  under-specified lock release). `beginInstall` then replaces the placeholder with the real
  InstallOp, **carrying the placeholder's abort controller forward** so a Stop during
  buildContext is honored. Do NOT reuse a real InstallOp as the placeholder (pause/resume
  would act on a non-running op). **Do NOT add a write-lock to startLaunch** — the verdicts
  confirm holding CLIENT_FOLDER into the bundle phase self-deadlocks (install.ts:142-145);
  the early op-registration alone closes the race. The launch-lock idea stays document-only.
- **Test plan:** managerInstall: mock buildContext deferred; while pending, getStatus →
  INSTALLING and concurrent startLaunch throws OP_IN_FLIGHT. Cancel during pending
  buildContext → no runInstall, op removed, lock released, status falls back to presence.
  Fold the new cancel branch into the existing `managerCancel.test.ts` it.each.
  Existing lock-release-once assertions stay green.
- **Risk:** medium.

### W1-T4 — Cancel during startLaunch buildContext window is honored
- **Source:** flow-install-launch/DL-2 (A4), flow-install-launch/DL-7 (op churn, folded)
- **Files:**
  - `src/main/services/minecraft/launch.ts`
  - `tests/main/services/minecraft/launch.test.ts`
- **Change:** Primary fix lands in `launch.ts` + its test (NOT manager.ts — that file is
  owned by W1-T3 this wave, so the after-await guard is implemented by threading the caller's
  op into runLaunch rather than editing startLaunch's catch). Collapse the double
  LAUNCH_STARTING controller: accept the caller's startingOp/signal as a parameter in
  `runLaunch` and delete the fresh-controller block (launch.ts:292-301); reuse the passed-in
  op for the `if (env.ops.get(slug) === startupOp) env.ops.delete(slug)` finally guard and
  preserve the LAU-29 post-`ops.set` abort check (launch.ts:383-387). Update all ~10
  `runLaunch(env, SLUG, ctx, account())` call sites in `launch.test.ts` and rework the
  "cancels startup during compose" test for the new signature.
  **Sequencing/conflict note:** the manager-side after-await `signal.aborted` guard for BOTH
  the local and official branches (using `this.env.emitStatus`, NOT the nonexistent
  `restoreInstalled`) MUST be added too — but `manager.ts` is edited by W1-T3 this wave. To
  keep files disjoint, **the manager-side guard is folded into W1-T3** (W1-T3 owns
  manager.ts) and this task (W1-T4) owns only `launch.ts` + `launch.test.ts`.
- **Test plan:** stub buildContext pending; startLaunch then cancel(slug); resolve
  buildContext; assert `kit.launch.run` NOT called and status settles INSTALLED. Regression:
  normal launch still spawns; cancel during compose still aborts.
- **Risk:** medium. **File-disjoint from W1-T3** (launch.ts vs manager/ops/install.ts).
  W1-T3's manager.ts edit adds the startLaunch after-await guard; W1-T4's launch.ts edit
  removes the second controller. Sequence W1-T3 → W1-T4.

---

## WAVE 2 — Window lifecycle + renderer error UX + updater wedge

### W2-T1 — Main-window lifecycle: close handling, console-window coupling, focus target
- **Source:** arch-lifecycle-ipc/DL-1 (W1)
- **Files:**
  - `src/main/index.ts`
  - `src/main/windows/mainWindow.ts`
- **Change:** Minimal safe fix per verdict (do NOT do the full WindowRegistry + nullable
  `getMain()` contract churn, and do NOT fold in the notifier-singleton migration — out of
  scope). Add `mainWindow.on('closed', () => consoleHub.getWindow()?.close())` and null/
  re-point the holder on close (re-attach on macOS recreate). Make `second-instance` focus
  the main ref specifically (not `getAllWindows()[0]`); make `activate` recreate only when
  the main window is gone. The dead-window dialog guard is near-unreachable (renderer IPC is
  gated by trustedSender) — add it only as cheap defense-in-depth if it stays a one-liner,
  not as load-bearing work.
- **Test plan:** With a fake BrowserWindow: closing main with console open quits (or closes
  console) on platform !== darwin; getMain re-points correctly. Manual: open console, close
  main on Windows → app quits.
- **Risk:** medium.

### W2-T2 — Global MutationCache.onError localizes coded errors; kill launch double-toast
- **Source:** renderer-quality/DL-1 (E3), renderer-quality/DL-2 (create double-surface)
- **Files:**
  - `src/renderer/shared/lib/queryClient.ts`
  - `src/renderer/features/minecraft/hooks.ts`
  - `src/renderer/features/bundle/hooks.ts`
  - `src/renderer/features/catalog/hooks.ts`
  - `src/main/services/minecraft/manager.ts`
  - `tests/renderer/.../globalErrorToast.test.ts` (new, `.ts`)
- **Change:** Extract `resolveErrorToastMessage(error, domain)`; in `queryClient.ts`
  `onError`: if `isIpcError(error)` and `mutation.meta.errorDomain` has a registered
  localizer, toast the localized string, else `formatError`. Set `meta.errorDomain`
  ('minecraft'|'bundle') in the shared `useSlugMutation`/`useInstallClient` and bundle
  equivalents (tagging siblings pause/resume/cancel is correct — they reject with the same
  codes). Set `meta:{skipGlobalErrorToast:true}` on `useCreateBuild` ONLY (thread a per-call
  meta option through `useCatalogMutation`; do NOT touch `useDeleteBuild`). **Verdict
  correction:** do NOT add the flag to `useUpdateBuild` — it has zero consumers and no inline
  surface; either leave it untouched or remove it as dead wiring (defer removal to W9).
  Suppress the launch double-toast: in `manager.ts` startLaunch, on a non-aborted bundle-sync
  failure during launch, settle INSTALLED and RETURN without rethrow (mirror runLaunch
  443-445; the BundleEventsListener already toasted the localized bundle error).
- **Test plan:** `.ts` unit on `resolveErrorToastMessage`: `IpcError{code:NO_ACCOUNT}` +
  'minecraft' → `clients.error.noAccount`; un-coded Error → formatError; domain undefined →
  fallback. Main-side: non-aborted bundle-sync failure during startLaunch resolves (no
  rethrow). Manual: no-account launch on uk → one localized toast; offline bundle sync during
  launch → exactly one bundle-error toast.
- **Risk:** medium. **manager.ts conflict:** also edited by W1-T3/W1-T4. **Sequence Wave 1
  before Wave 2** (manager.ts edits are additive and in different methods — startLaunch catch
  vs startInstall — but landing serially avoids merge churn).

### W2-T3 — Updater wedge watchdog + registered-gate; fix empty version + dead DOWNLOADING
- **Source:** flow-update/DL-3 (A10), flow-update/DL-4 (E9)
- **Files:**
  - `src/main/services/updater/index.ts`
  - `src/shared/contracts/updater.ts`
  - `src/renderer/features/updater/UpdaterBadge.tsx`
  - `src/renderer/i18n/locales/en.json`
  - `src/renderer/i18n/locales/uk.json`
- **Change:** (a) Watchdog: arm an unref'd 60s timer when a check kicks off; on fire, if still
  `inFlight`, reset and broadcast ERROR(timeout). **Verdict correction:** clear/disarm the
  watchdog on `update-available` (download phase intentionally stays in-flight until
  `update-downloaded` — a fixed 60s timer would false-fire mid-download), AND on all three
  terminal handlers, the sync-throw catch, and in `dispose()`. (b) Gate `updaterCheck` on
  `registered` (not just `isSquirrelEnabled()`); when false, broadcast ERROR/NOT_AVAILABLE so
  a click is acknowledged. (c) Make AVAILABLE `version` optional in the contract (Squirrel
  never provides it); render an `availableNoVersion` badge variant in `UpdaterBadge` when
  empty. (d) Remove the producerless DOWNLOADING state from the contract union, badge, toast
  switch, and the triggerAutoCheck busy-set in events.ts (events.ts edit folded into the
  renderer slice — see file note).
- **Test plan:** Fake autoUpdater: checking-for-update then no terminal → advance timers past
  watchdog → inFlight reset + ERROR broadcast + next check proceeds; update-available before
  the watchdog disarms the timer (no false ERROR mid-download). setFeedURL throws →
  registered=false → updaterCheck broadcasts terminal instead of silent. AVAILABLE empty
  version renders no-version label. tsc confirms no DOWNLOADING references.
- **Risk:** low. NOTE: `updater/events.ts` is also touched by W5-T4 (updater singletons). To
  keep disjoint, the DOWNLOADING busy-set removal here is the only events.ts edit; W5-T4 owns
  the singleton migration. **Sequence W2-T3 before W5-T4.**

---

## WAVE 3 — Structural: break the minecraft⇄bundle import cycle

### W3-T1 — Neutral bundle-ownership module + injected heal port (cycle elimination)
- **Source:** arch-layering/DL-1 (L1)
- **Files:**
  - `src/main/services/bundle/healer.ts`
  - `src/main/services/bundle/ownership.ts` (new)
  - `src/main/services/minecraft/bundleHealing.ts` (deleted)
  - `src/main/services/minecraft/repairWorkflow.ts`
  - `src/main/services/bundle/index.ts`
  - `src/main/services/minecraft/index.ts`
  - `src/main/index.ts`
  - `tests/main/services/bundle/healer.test.ts`
- **Change:** (A) Create `bundle/ownership.ts` exporting `bundleOwnedRelativePaths(folder,
  expectedBundleSlug)` (the LOCAL-manifest slug-match + Object.keys logic from
  repairWorkflow.ts:38-44) plus `toBundleKey`/`isBundleOwnedIssue`/
  `createBundleRepairIssueFilter` (moved verbatim from bundleHealing.ts). Relocate
  `verifyAndRepairExceptBundle` into the bundle service (fold into `healer.ts` to avoid a new
  `heal.ts` name collision — verdict). minecraft no longer imports `@main/services/bundle/*`.
  (B) Invert the heal direction with a port: make `createHealer(kit, deps)` require
  `deps.resolveContext`; add `MinecraftTargetPort = (slug) => Promise<{target, clientFolder}>`
  on MinecraftManager and inject it at the root
  (`createBundleService(..., { resolveContext: (slug) => minecraftService.manager.resolveHealTarget(slug) })`).
  **Verdict notes:** plan.ts's remote-derived `bundleOwnedRelativePaths` is a DIFFERENT input
  (remote manifest) and stays; ownership.ts is the LOCAL variant only — do NOT merge them.
  For zero static back-edge, prefer passing the owned-set via the repair op context (option b);
  option a (repairWorkflow statically imports the neutral ownership.ts) is acceptable since
  it is no longer a cycle.
- **Test plan:** `healer.test.ts` already injects `resolveContext` + mocks
  `@main/services/minecraft/context` — drop the `vi.mock` line, pass the stub directly. Add
  ownership.ts unit (slug match → set; mismatch → null; no manifest → null). Keep/add a
  minecraft repair test asserting bundle-owned paths filtered from `kit.repair.all`. Verify
  no cycle: `npx madge --circular src/main` (or grep that minecraft/* no longer imports
  `@main/services/bundle` and bundle/* no longer statically imports `@main/services/minecraft`).
- **Risk:** medium. Isolated to its file set; no other Wave-3 task.

---

## WAVE 4 — Structural: DI consistency, op-map for sync, sync state machine

All four tasks below touch DISJOINT file sets.

### W4-T1 — Inject getClient into BundleManager (delete the message-string sniff dependency)
- **Source:** flow-download/DL-7 (DLI-04/DLI-34), arch-layering/DL-2 (DLI-04)
- **Files:**
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/bundle/index.ts`
  - `src/main/index.ts`
- **Change:** Add a constructor dep `getClient: (slug: ClientSlug) => Promise<Client>` (keep
  the throwing signature — verdict: a `Promise<Client|null>` retype breaks `tryGetClient`'s
  swallow-everything semantics, so the safe minimal scope keeps `isClientNotFound` + the
  fetchClient/tryGetClient logic verbatim and only injects the function). Replace the two
  `getClient(slug)` call sites with `this.getClient(slug)`. Wire at root: add `getClient` to
  the `@main/services/clients` import in `index.ts` (**verdict: index.ts currently imports
  only `getClients` (plural) — add `getClient`**) and pass it into `createBundleService`.
  Leave `getSettings`/`resolveClientFolder` alone (separate L3 concern, out of scope). Defer
  the optional null-returning retirement of the string-match to a later cleanup.
- **Test plan:** Bundle manager tests pass a fake `getClient` into the constructor instead of
  `vi.mock('@main/services/clients')`; getClient throwing → MANIFEST_FETCH_FAILED;
  not-found message → UNKNOWN 'not found'. DLI-40 split (managerSyncErrors) stays green.
- **Risk:** low.

### W4-T2 — Replace setActiveCatalog global with injected resolveBuild port
- **Source:** arch-layering/DL-3 (L3)
- **Files:**
  - `src/main/services/catalog/catalog.ts`
  - `src/main/services/catalog/index.ts`
  - `src/main/services/minecraft/context.ts`
  - `src/main/services/minecraft/manager.ts`
  - `src/main/services/minecraft/index.ts`
  - `src/main/index.ts`
  - `tests/main/services/catalog/catalog.test.ts`
  - `tests/main/services/minecraft/context.test.ts`
- **Change:** Expose `resolveBuildByOpaqueId` as a method on the CatalogService instance
  (closing over its own `sources`). Add a `resolveBuild` dep to MinecraftManager and default
  `BuildContextDeps.resolveBuild` at **all THREE** internal buildContext call sites — verdict:
  startInstall (129), **startRepair (231)**, startLaunch (272), not just two; cleanest is to
  store it on `this`/ManagerEnv and pass via a private helper. Inject
  `catalogService.resolveBuildByOpaqueId` at the root. Delete `setActiveCatalog`/
  `activeCatalog`/the module-level `resolveBuild`/`resolveBuildByOpaqueId` free functions and
  the stale `bundle healer` comment (catalog.ts:67-70 — its only consumer is context.ts).
  **Verdict:** rewrite the two existing catalog.test.ts tests (95-123) to call the instance
  method, and update context.test.ts's `vi.mock` of the removed module export.
- **Test plan:** buildContext tests unaffected (already inject via BuildContextDeps). New
  catalog test: instance `resolveBuildByOpaqueId(localUuid)` hits LOCAL then OFFICIAL with no
  setActiveCatalog. Grep-verify zero `setActiveCatalog`/`activeCatalog` references remain.
- **Risk:** medium. **Conflict caution:** `minecraft/manager.ts` is also touched by Wave 1
  and Wave 2 — but those are different waves (sequenced). Within Wave 4, manager.ts is touched
  by W4-T2 only (W4-T3 touches ops.ts, W4-T4 touches different bundle files). Keep W4-T2 the
  sole Wave-4 editor of `minecraft/manager.ts` and `minecraft/index.ts`.

### W4-T3 — Register BUNDLE_SYNCING op for post-install / post-repair sync
- **Source:** flow-install-launch/DL-3 (A3)
- **Files:**
  - `src/main/services/minecraft/install.ts`
  - `src/main/services/minecraft/repair.ts`
  - `tests/main/services/minecraft/managerInstall.test.ts`
  - `tests/main/services/minecraft/managerRepair.test.ts`
- **Change:** Wrap the post-install `installHook` and post-repair `repairHook` in a
  BUNDLE_SYNCING op (`const op = {kind: BUNDLE_SYNCING, abort: new AbortController()};
  this.ops.set(slug, op); try { await hook(slug, op.abort.signal) } finally {
  this.ops.delete(slug) }`), symmetric with startLaunch's official path. **Verdict
  corrections:** (1) the hook signature changes (slug → slug, signal) which breaks
  `expect(hook).toHaveBeenCalledWith(SLUG)` in managerInstall.test.ts:159 and
  managerRepair.test.ts:124/186 — update those assertions to the 2-arg form. (2) Define
  abort-window behavior: on hook abort the finally deletes the op and getStatus falls back to
  presence (INSTALLED); do not log the abort as an error. **File-isolation note:** the hook
  wiring lives in startInstall/finishRepair inside `minecraft/manager.ts`, which W4-T2 owns
  this wave. To keep Wave-4 files disjoint, move the op-wrap into the `install.ts`/`repair.ts`
  hook-invocation helpers, OR sequence this task into a later wave. **Decision: defer the
  manager.ts portion; implement the op-wrap inside install.ts/repair.ts helper functions that
  beginInstall/finishRepair already call**, so W4-T3 touches install.ts/repair.ts (+ tests)
  and W4-T2 keeps manager.ts. If the wrap genuinely cannot leave manager.ts, move W4-T3 to
  Wave 5 as a standalone manager.ts task.
- **Test plan:** managerInstall: pending hook → getStatus reports LAUNCHING (not INSTALLED);
  cancel(slug) aborts hook signal; after resolve, op deleted, getStatus → presence. Same for
  repair. Fix the existing `toHaveBeenCalledWith(SLUG)` assertions.
- **Risk:** medium.

### W4-T4 — Bundle sync phase enum + discriminated runSyncPhases outcome (+ DLI-26 logging)
- **Source:** flow-download/DL-4 (DLI-16/26/60)
- **Files:**
  - `src/main/services/bundle/syncState.ts`
  - `src/main/services/bundle/runner.ts`
  - `tests/main/services/bundle/managerPauseCleanup.test.ts`
  - `tests/main/services/bundle/managerResumeCleanup.test.ts`
- **Change:** (a) Replace `task.paused`/`task.cancelled` with one `phase: 'running' |
  'paused' | 'cancelled'` plus transition helpers in `syncState.ts`. **Verdict correction:**
  cancel MUST be allowed from `paused` (cancelSync handles wasPaused with a special drop
  path) — the enum encodes "cancelled overrides paused", NOT "cancel only from running".
  (b) Make `runSyncPhases` return discriminated `{outcome: 'completed'|'paused'|'cancelled';
  deletedAny}` and collapse the byte-identical paused/fall-through branches (DLI-60); log
  secondary worker errors at debug before discarding (DLI-26). **Verdict correction:** the
  `runSyncPhases` mock return shape lives in the test files, so the "all tests unchanged"
  promise is false — update the mock return values in managerPauseCleanup/managerResumeCleanup
  to the new union. **File-isolation:** the catch-decode in `manager.ts` (343-360) and the
  `{deletedAny}` destructure (322-325) must also thread the new union — but `manager.ts` is
  owned by W4-T2 this wave. **Decision: split — W4-T4 lands the syncState/runner change plus
  a thin adapter so manager.ts's existing `{paused, cancelled, deletedAny}` reads still
  compile (keep backward-compatible getters on SyncTask derived from `phase`), and the full
  manager.ts catch-decode collapse moves to Wave 5 (W5-T5).** This keeps Wave-4 manager.ts
  edits solely in W4-T2.
- **Test plan:** Transition-guard units: cancel-after-cancel no-op; resume-from-running
  no-op; cancel-from-paused allowed. Update mocked `runSyncPhases` returns; all pause/resume
  assertions stay behaviorally green. DLI-26: assert a secondary worker error is logged at
  debug.
- **Risk:** medium.

---

## WAVE 5 — Structural: registry, loader, progress, narrow types, manager catch-decode

All tasks below touch DISJOINT file sets.

### W5-T1 — Collapse the triple service registry to one ordered {init, dispose} array
- **Source:** arch-lifecycle-ipc/DL-7 (G1)
- **Files:**
  - `src/main/index.ts`
- **Change:** Keep explicit per-service construction (DI wiring is genuinely per-service and
  reads handle members like `authService.session`, `minecraftService.manager`). Collect the
  15 services' `{init, dispose}` into one ordered array and drive both the init loop and the
  `Promise.allSettled` dispose loop from it; remove the redundant reverse-order dispose
  comment. **Verdict:** do NOT fold in the DL-2 register/init split (separate behavior
  change, out of scope here). **Conflict:** `index.ts` is also edited by W4-T1/W4-T2/W4-T4
  wiring and W3-T1 root wiring — but those are earlier waves; W5-T1 is the sole Wave-5 editor
  of `index.ts`. **Sequence after Wave 4.**
- **Test plan:** Bootstrap test asserts each array entry's init is invoked; contractCoverage
  stays green. `npm run verify`.
- **Risk:** medium.

### W5-T2 — Collapse loader-ambiguity rule onto resolveLoader/canChooseLoader
- **Source:** flow-build-creation/DL-4 (D3)
- **Files:**
  - `src/shared/domain/loader.ts`
  - `src/renderer/features/clients/components/PlayButton.tsx`
  - `src/renderer/features/clients/components/client-settings/ClientLoaderSection.tsx`
- **Change:** Export `isLoaderAmbiguous(spec, override) = resolveLoader(...).kind ===
  'ambiguous'` and `canChooseLoader(spec)` (**verdict: count NON-VANILLA available loaders >
  1**, so a single forge-only build that resolves to forge+vanilla does not show the switch).
  PlayButton: `needsLoaderChoice = isLoaderAmbiguous(spec, persistedLoader)`. ClientLoaderSection:
  `canSwitchLoader = canChooseLoader(spec)`. **Conflict:** PlayButton.tsx is also a candidate
  for W5-T3? No — W5-T3 touches install/* files. PlayButton.tsx is edited by W2-T2 (Wave 2,
  earlier) and W9 (G4 split). Within Wave 5, only W5-T2 edits PlayButton.tsx.
- **Test plan:** loader.test: `isLoaderAmbiguous` true for forge+fabric/no override, false
  once override valid, false single-loader; `canChooseLoader` counts non-vanilla. Existing
  selectPlayButtonAction tests unaffected.
- **Risk:** low.

### W5-T3 — Normalize install progress bytes + speed in the main-process adapter
- **Source:** flow-build-creation/DL-5 (D2)
- **Files:**
  - `src/main/services/minecraft/progressAdapter.ts`
  - `src/main/services/minecraft/install.ts`
  - `src/main/services/minecraft/broadcast.ts`
  - `src/shared/contracts/minecraft.ts`
  - `src/renderer/features/clients/components/install/installSteps.ts`
  - `src/renderer/features/clients/components/install/useByteSpeed.ts`
- **Change:** Reconcile per-stage `bytesDownloaded`/`bytesTotal` in the PLANNED adapter's
  `emitSnapshot` (compute `stageDone = stagePercent/100 * stageTotal`, round before IPC) and
  add a `speedBytesPerSec` sampler. **Verdict corrections:** (1) the throttle is in the kit
  for the planned path — add the sampler to the planned adapter (the repair adapter already
  resets bytes per stage; do not double-normalize it). (2) speed must be computed over
  per-stage reconstructed bytes and reset at a stage boundary (matching today's
  useByteSpeed behavior) — do NOT compute over the monotonic install-wide cumulative.
  (3) Relax/round the `MinecraftProgressEvent` Zod ints and add `speedBytesPerSec` to the
  schema AND to `ClientRuntimeState` + the STATUSES_WITHOUT_PROGRESS reset (verdict — these
  were omitted from the original proposal). Then delete `installStageBytes` from
  installSteps.ts and drop useByteSpeed from the install path. **Impact is low (maintainability,
  current rendering is correct) — schedule but do not prioritize.** If schema/contract churn
  proves heavier than budget, this task may be deferred to a follow-up.
- **Test plan:** progressAdapter unit: monotonic per-stage bytes, non-negative speed, stage
  boundary resets speed; update the repair adapter shape assertions
  (progressAdapter.test.ts:83-91,149-152); add planned-adapter coverage (none exists today).
  selectInstallProgress reads the emitted fields. Manual: forge install line self-consistent.
- **Risk:** medium.

### W5-T4 — Move updater module singletons into the store; clear on watchdog
- **Source:** flow-update/DL-5 (U3)
- **Files:**
  - `src/renderer/features/updater/events.ts`
- **Change:** Move `lastAutoCheckAt` and `userInitiatedCheck` into `useUpdaterStore` (or a
  sibling zustand store) so they are resettable and double-mount safe; clear
  `userInitiatedCheck` on terminal state AND on a watchdog timeout aligned with W2-T3.
  **Sequence after W2-T3** (W2-T3 made the only other events.ts edit — the DOWNLOADING busy-set
  removal; this task owns the singleton migration). Within Wave 5, only W5-T4 edits events.ts.
- **Test plan:** mount UpdaterEventsListener twice; user-initiated check then stalled-then-
  background NOT_AVAILABLE does not emit a success toast after the watchdog clears the flag.
- **Risk:** low.

### W5-T5 — Thread the sync phase union through manager catch-decode (DLI-16 closeout)
- **Source:** flow-download/DL-4 (DLI-16, continuation of W4-T4)
- **Files:**
  - `src/main/services/bundle/manager.ts`
- **Change:** Now that W4-T4 introduced the `phase` enum + discriminated `runSyncPhases`
  outcome (with backward-compatible getters), collapse the `executePreparedSync` catch-decode
  (manager.ts:342-360) and the `{deletedAny}` re-check (322-325) onto the discriminated
  outcome, and remove the temporary compat getters. DLI-16 (document the two-phase stop)
  becomes moot once the enum is authoritative. **manager.ts is edited here only in Wave 5**
  (W4-T2 was Wave 4). **Sequence after W4-T4.**
- **Test plan:** Existing pause/resume/cancel/error suites stay green; no behavioral change.
- **Risk:** low.

### W5-T6 — Narrow Context.resolved to the consumed slice (LAU-23 closeout)
- **Source:** flow-install-launch/DL-6 (LAU-23)
- **Files:**
  - `src/main/services/minecraft/context.ts`
  - `src/main/services/minecraft/launch.ts`
- **Change:** CC-16 is done (the conflict that deferred LAU-23 no longer applies). Narrow
  `Context.resolved` from full `ResolvedClientSettings` to an explicit
  `{ storage: {clientFolder; clientsFolder}; memory: {allocatedRamMb}; launch:
  {fullscreen; console} }` populated in buildContext. tsc surfaces any unexpected consumer.
  **Conflict:** `launch.ts` is edited by W1-T4 (Wave 1) and W5-T6 (Wave 5) — different waves,
  sequenced. Within Wave 5, only W5-T6 edits context.ts/launch.ts (W4-T2's context.ts edit
  was Wave 4). **Sequence after Wave 4.**
- **Test plan:** tsc is the gate; context.test.ts and launch.test.ts read only narrowed
  fields and pass unchanged.
- **Risk:** low.

---

## WAVE 6 — CatalogKey migration (central type seam)

### W6-T1 — Migrate punned ClientSlug channels to CatalogKey/CatalogRef
- **Source:** flow-build-creation/DL-1 (T1), arch-lifecycle-ipc/DL-3 (T1)
- **Files:**
  - `src/shared/ipc/contract.ts`
  - `src/shared/contracts/ids.ts`
  - `src/shared/contracts/catalog.ts`
  - `src/renderer/features/catalog/buildIdentity.ts`
  - `src/main/services/catalog/catalog.ts`
  - `src/main/services/instances/create.ts`
  - `src/main/services/minecraft/context.ts`
  - `src/main/services/minecraft/routes.ts`
  - `src/main/services/bundle/routes.ts`
  - `src/main/services/settings/routes.ts`
  - `src/main/services/settings/settingsDefaults.ts` (folder-naming decouple)
  - `src/main/services/settings/settingsOverrides.ts` / `sweepOrphans.ts` (settings migration)
  - `src/main/infra/store/...` lastPlayed + settings.clients store migration
  - `src/shared/contracts/minecraft.ts` + `bundle.ts` (event payload schemas)
  - renderer status-routing consumers (PlayButton/useInstallProgress/useBuildStatus/events)
- **Change:** Add `CatalogKeySchema` (`/^(official:|local:).+/` via parseCatalogKey refine).
  Retype the punned channels (9 `minecraft.*`, 3 `bundle.*` + `bundle.checkStatus`,
  `settings.setClientOverride`/`clearClientOverride`/`chooseClientFolder`) from ClientSlug to
  CatalogKey. Replace renderer `operationalId` with `item.key`; delete the `as unknown as`
  casts. Main: replace `resolveBuildByOpaqueId` with `catalog.resolve(parseCatalogKey(key))`.
  **Verdict-mandated additions (the original proposals omitted these and were marked unsafe):**
  1. **Folder-naming decouple:** `joinClientFolder` / `pickFolderWithSuffix` / resolveInstanceDir
     MUST keep using the bare ref value (parse the CatalogKey at that boundary) — `:` is an
     illegal Windows filename char and would brick createInstance and orphan existing installs.
  2. **Store migrations:** add read-time migrations for `settings.clients` (bare slug →
     `official:<slug>`) and `lastPlayed` (Record<string> keys); update `sweepOrphans` to
     build knownSlugs as CatalogKeys and know about local builds — otherwise existing
     overrides are pruned/abandoned. These are runtime regressions tsc will NOT catch.
  3. **Event payload schemas:** migrate the `slug` field in MinecraftStatus/Progress/Error
     and Bundle*Event schemas to CatalogKey in lockstep with the request channels, or status
     routing breaks.
  4. **Kit targetId:** keep `targetId` as the source-specific id (map CatalogKey → targetId at
     the boundary) so on-disk install-manifest/runtime paths are not re-keyed.
  Stage so tsc is green at each step (flip contract types first; the cast removal forces every
  call site).
- **Test plan:** CatalogKeySchema round-trip (rejects bare slug/uuid; accepts official:/
  local:). routes tests send CatalogKeys and assert IPC_INVALID_ARGS on bare ids. Migration
  tests: an existing settings.clients keyed by bare slug rehydrates under official:<slug>;
  lastPlayed keys migrate. buildContext('local:<uuid>') resolves local, 'official:<slug>'
  resolves Strapi. contractCoverage green. Manual: create local build, install/launch/
  uninstall, set RAM override, verify settings key is `local:<uuid>` and the default folder
  is still `<clientsFolder>/<uuid>` (NOT `local:<uuid>`).
- **Risk:** medium-high (L effort). Single dedicated wave because it touches the widest file
  set; depends on W4-T2 (resolveBuild already injected) and W0 seams. **Land before any
  later wave that re-touches these contract/routes files.**

---

## WAVE 7 — Perf

All tasks below touch DISJOINT file sets.

### W7-T1 — getInstallState short-lived manifest-hash TTL cache
- **Source:** flow-download/DL-5 (DLI-17/53), perf-security/PS-3 (DLI-17/53), flow-update/DL-2
- **Files:**
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/bundle/api.ts`
  - `src/main/constants/bundle.ts`
- **Change:** Add a private `manifestHashCache = new Map<BundleSlug, {hash; fetchedAt}>` and
  `MANIFEST_DRIFT_TTL_MS` (30-60s) in constants/bundle.ts (already imported by manager.ts —
  add `BundleSlug` to the `@shared/contracts/ids` import). getInstallState consults the cache
  before fetching; on a fetch (here and runSync's loadRemoteManifest) seed/refresh it. Add
  `AbortSignal.timeout(5000)` to the getInstallState fetch so a dead network degrades to the
  existing `signatureMatches:true` fallback in 5s. **Verdict corrections:** cache only the
  REMOTE hash keyed by BundleSlug (still read the LOCAL manifest fresh every call and compare);
  the sync path's loadRemoteManifest must NEVER consult the cache (always fresh); do NOT cache
  the computed `signatureMatches` boolean. Reject the event-push / skip-revalidation
  alternatives (they need new contract surface or mask genuine drift). **manager.ts conflict:**
  also touched by Wave 4/5 — sequence Wave 7 after Wave 5.
- **Test plan:** two getInstallState within TTL → one fetch; after fake-timer TTL → second
  fetch; never-resolving fetch with faked timeout → signatureMatches:true; after a completed
  sync → zero fetches within TTL; sync-path loadRemoteManifest always fetches fresh.
- **Risk:** low.

### W7-T2 — buildPlan bounded-concurrency classification + abort signal
- **Source:** flow-download/DL-6 (A5/DLI-18/47/49/72), perf-security/PS-2 (DLI-18/47/49)
- **Files:**
  - `src/main/services/bundle/plan.ts`
  - `src/main/services/bundle/hash.ts` (new)
  - `src/main/services/bundle/api.ts`
  - `src/main/infra/system.ts` (export createLimiter) OR `src/main/infra/concurrency.ts` (new)
  - `tests/main/services/bundle/plan.test.ts`
- **Change:** (a) Classify entries with bounded concurrency (16, matching
  BUNDLE_DOWNLOAD_CONCURRENCY) via `createLimiter` + `Promise.all(remoteEntries.map(e =>
  limit(() => classifyEntry(e))))`, then **assemble toDownload/toUpdate/toSkip by iterating
  the RESULTS array in input order** (verdict: plan.test.ts:102-103 asserts exact order — do
  NOT push from inside the async task). (b) Accept `signal?: AbortSignal` in PlanFlags, check
  at the start of each task callback, throw `BundleError(ABORTED)`; manager.ts passes
  `task.abort.signal`, and the UP_TO_DATE branch checks `task.cancelled`/phase first and
  throws ABORTED so cancel-during-planning surfaces CANCELLED to forLaunch (the manager.ts
  edit for this is small — but manager.ts is touched in W7-T1; **merge the two manager.ts
  edits or sequence W7-T2's manager.ts touch into W7-T1's task**). Decision: keep manager.ts
  out of W7-T2 by having buildPlan's caller (already in manager.ts via W7-T1's task scope)
  pass the signal — i.e. fold the manager.ts one-liner into W7-T1. (c) Extract `bundle/hash.ts`
  with `sha256String` + `sha256File`, consumed by api.ts and plan.ts (do NOT unify
  download.ts's inline stream hash — it hashes while writing). **Verdict:** drop the false
  "kit verifies in parallel" rationale.
- **Test plan:** plan.test.ts cases stay green (order-stable). Add cancel-during-planning
  (signal aborted) → ABORTED; ~50-entry concurrency test loses no classification; hash.ts
  known-vector unit.
- **Risk:** low-medium. **File-disjoint from W7-T1 except the manager.ts signal-pass line,
  which is folded into W7-T1.**

### W7-T3 — Scope the query persister to an allow-list of offline-first roots
- **Source:** renderer-quality/DL-4 (UI-32), perf-security/PS-4 (UI-32)
- **Files:**
  - `src/renderer/shared/lib/queryPersister.ts`
- **Change:** Invert the predicate from deny-list to allow-list: `PERSISTED_QUERY_ROOTS =
  {catalog, settings, auth, history}`; `shouldDehydrateQuery = status==='success' &&
  PERSISTED_QUERY_ROOTS.has(root)`. Extract `shouldDehydrateQuery` as a named const for
  unit testing. Keep the `gcTime >= maxAge` invariant. Rewrite the now-contradictory
  deny-list why-comment. This is the in-scope synchronous-payload-reduction half of UI-32;
  the async-IndexedDB rewrite stays deferred (needs-design).
- **Test plan:** unit on `shouldDehydrateQuery`: catalog/settings/auth/history success → true;
  system/builds/media/app/servers → false; non-success → false. Manual: install a client,
  reload, disk/folder sizes recompute (not stale), catalog renders offline, localStorage
  payload shrank.
- **Risk:** low.

---

## WAVE 8 — Tests (coverage growth, post-seam)

All tasks are test-only (no production change) and touch disjoint test files.

### W8-T1 — install→INSTALLED→launchHook ordering + non-fatal hook-failure invariants
- **Source:** flow-install-launch/DL-4 (DLI-64), tests-quality/DL-4 (DLI-64)
- **Files:** `tests/main/services/minecraft/managerInstall.test.ts`
- **Change:** Add cases: (1) success → INSTALLED status `invocationCallOrder` precedes the
  hook's first call (**filter to the INSTALLED call — beginInstall emits INSTALLING first**);
  (2) hook rejects → final status is INSTALLED, broadcaster.error NOT called; (3) cancel →
  hook never called. **Verdict:** to assert `logger.warn` fired, first refactor the logger
  mock to a shared hoisted spy as managerRepair.test.ts does (the current fresh-object-per-call
  mock is unobservable) — or treat the log assertion as optional and rely on the load-bearing
  status assertions. Use `vi.waitFor` (hook runs in a fire-and-forget IIFE).
- **Test plan:** new cases pass; temporarily reorder emit-vs-hook to confirm case (1) fails.
- **Risk:** low.

### W8-T2 — buildPlan non-force disk-hash-fallthrough branch test
- **Source:** flow-install-launch/DL-5 (DLI-65), tests-quality/DL-5 (DLI-65)
- **Files:** `tests/main/services/bundle/plan.test.ts`
- **Change:** Add: (a) remote has X w/ sha256, local manifest has an unrelated record (not
  null) and none for X, X on disk hashes to S → toSkip; (b) disk content differs → toUpdate.
  Use the existing `remote([...])` + on-disk write helpers. **Sequence after W7-T2** (plan.ts
  goes concurrent — keep these cases green as the parity check).
- **Test plan:** new cases pass; temporarily route `!known` → toDownload and confirm (a) fails.
- **Risk:** low.

### W8-T3 — Updater service behavioral coverage
- **Source:** flow-update/DL-9 (S4 slice)
- **Files:** `tests/main/services/updater/updater.test.ts` (new)
- **Change:** Fake `autoUpdater` event emitter: (1) checking→available→downloaded broadcasts
  CHECKING/AVAILABLE/READY with correct payloads + inFlight transitions; (2) error clears
  inFlight + broadcasts ERROR; (3) check while inFlight is a no-op; (4) non-Squirrel replies
  NOT_AVAILABLE without touching autoUpdater; (5) broadcast skips a destroyed window. Land
  AFTER W2-T3 so the watchdog + empty-version fixes are covered (case 1 AVAILABLE payload
  depends on the W2-T3 version fix).
- **Test plan:** tests are the deliverable; confirm they exercise the W2-T3 fixes.
- **Risk:** low.

### W8-T4 — Coverage instrumentation + public-surface integration tests
- **Source:** tests-quality/DL-6 (S4)
- **Files:**
  - `vitest.config.ts`
  - `package.json` (add `@vitest/coverage-v8` devDependency + lockfile refresh — verdict:
    the config alone errors without the provider)
  - `tests/main/services/bundle/managerResumeCleanup.test.ts`
  - `tests/main/services/minecraft/managerReadinessIntegration.test.ts`
- **Change:** Add `test.coverage = {provider:'v8', reporter:['text','html'],
  include:['src/main/services/**','src/shared/**']}` at the observed baseline (do not block CI
  initially). Using the W0 SyncStateStore/OpRegistry seams, add public-API integration
  coverage for the branches still seed-only (cancel-after-pause, idle-timeout via real
  timers, cancelAll) and a minecraft install→launch op-per-slug-invariant test against a real
  OpRegistry. **Verdict corrections:** several "missing" integration tests already exist
  (startInstall hook ordering in managerInstall, public pause→resume→terminal in
  managerPauseCleanup) — scope this task to ONLY the genuinely seed-only branches; do NOT
  delete seed-only tests that have no public equivalent; the invented `continuePausedSync
  refetch-when-empty guard` is actually delivered by W1-T2, so reference that, not a
  nonexistent guard. Do NOT widen vitest include to `.tsx` (no jsdom; out of scope).
- **Test plan:** `npm test --coverage` produces a report; record baseline %. `npm run verify`
  green. **Depends on W0 seams.**
- **Risk:** medium (devDependency + lockfile per the bump-deps convention).

---

## WAVE 9 — Cleanup / dead code / comments / security hardening

All tasks below touch DISJOINT file sets.

### W9-T1 — Delete dead clients.list IPC channel (route, contract, registry, shell)
- **Source:** flow-build-creation/DL-3 (D1), arch-lifecycle-ipc/DL-5 (D1), dedup-dead-code/DL-8
- **Files:**
  - `src/main/services/clients/routes.ts`
  - `src/shared/ipc/contract.ts`
  - `src/shared/ipc/channels.ts`
  - `src/main/services/clients/index.ts`
  - `src/main/index.ts`
  - `tests/main/ipc/contractCoverage.test.ts`
- **Change:** Remove the `clients.list` route, `clientsList` channel entry, contract entry,
  the `createClientsService` shell + its construction/init/dispose lines in index.ts, and the
  `registerClientsRoutes` call/import in contractCoverage.test.ts. Keep `getClients`/`getClient`
  (internal consumers: catalog listClients, sweepOrphans, root wiring). Two-way coverage guard
  + contractCoverage enforce balance. **Conflict:** index.ts is edited by W5-T1 (registry
  array) and W6 — sequence W9-T1 after Wave 6. contract.ts/channels.ts edited by W6 — sequence
  after Wave 6. **Sole Wave-9 editor of these files.**
- **Test plan:** grep `clientsList` → empty; contractCoverage + tsc green.
- **Risk:** medium (contract parity).

### W9-T2 — Remove dead resetForUninstall; clear bundle sidecar on residual uninstall
- **Source:** flow-download/DL-8 (X1), dedup-dead-code/DL-1 (X1)
- **Files:**
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/minecraft/uninstall.ts`
- **Change:** Delete `resetForUninstall` (and the lying comment + the manager import of
  `clearLocalManifest`). Add `clearLocalManifest(folder)` (from bundle/manifestRepo — the same
  edge repairWorkflow already uses) to runUninstall's residual-failure `Promise.allSettled`.
  **Conflict:** manager.ts edited by W7-T1 (Wave 7) — sequence W9-T2 after Wave 7. Within Wave
  9, only W9-T2 edits bundle/manager.ts + minecraft/uninstall.ts.
- **Test plan:** uninstall residual-failure path also removes `.loontail/bundle.json`; grep
  no resetForUninstall references.
- **Risk:** low.

### W9-T3 — Remove dead HTTP helpers + demote internal exports
- **Source:** dedup-dead-code/DL-2
- **Files:**
  - `src/main/infra/http.ts`
- **Change:** Delete `httpPost`, `httpPostMultipart`, `httpPutVoid`, `httpGetBinary` (zero
  callers). Demote `AuthMode` and `buildAuthHeader` from export to module-private. Keep
  `httpRequest`/`httpGet`/`buildMediaUrl`/`HttpError`. (skin.ts/mediaCache.ts are listed in the
  finding only as proof of non-use — no edit needed there.)
- **Test plan:** `npm run verify`; grep confirms removed helpers had no importers.
- **Risk:** low.

### W9-T4 — Remove vestigial InstallOp.fresh flag + dead else-branch
- **Source:** dedup-dead-code/DL-3 (X3)
- **Files:**
  - `src/main/services/minecraft/ops.ts`
  - `src/main/services/minecraft/install.ts`
- **Change:** Remove `fresh` from InstallOp, drop the `{fresh: true}` arg and `options.fresh`
  param, simplify the cancel cleanup to unconditionally take the cleanup branch when
  `op.abort.signal.aborted && op.cancelled`, drop the dead else and the `fresh=` log
  interpolation and the stale comment. **Conflict:** ops.ts edited by W1-T3 (INSTALL_STARTING)
  and W4-T3 — sequence W9-T4 last. install.ts edited by W1-T3, W4-T3 — sequence after those.
  Within Wave 9, only W9-T4 edits ops.ts/install.ts.
- **Test plan:** install-cancel test asserts folder removed; grep no `.fresh`.
- **Risk:** low.

### W9-T5 — Unify three bundle SHA-256 implementations
- **Source:** dedup-dead-code/DL-5 (DLI-72)
- **Files:**
  - `src/main/services/bundle/api.ts`
  - `src/main/services/bundle/plan.ts`
  - `src/main/services/bundle/download.ts`
- **NOTE — MERGE/DEFER:** `bundle/hash.ts` is created by W7-T2 (which already routes api.ts +
  plan.ts through `sha256String`/`sha256File`). To avoid double-editing api.ts/plan.ts, this
  task is **subsumed by W7-T2** — its only residual is the one-line `// keep in sync with
  hash.ts: sha256` invariant note on download.ts's inline stream hash. If W7-T2 ships, W9-T5
  reduces to that single download.ts comment. Listed here only so the DLI-72 finding is
  tracked to closure.
- **Test plan:** covered by W7-T2's hash.ts known-vector test.
- **Risk:** low.

### W9-T6 — ENOENT delete counts processedFiles; heal-progress byte leak; event-shape dedup
- **Source:** flow-download/DL-9 (A17), flow-download/DL-10 (D8)
- **Files:**
  - `src/main/services/bundle/runner.ts`
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/bundle/healProgress.ts`
- **Change:** (A17) In runDeletePhase's ENOENT branch add `task.processedFiles += 1;`
  (D8) Shrink `maybeEmit`'s patch to `{speedBytesPerSec, ...(currentFile?{currentFile}:{})}`
  and let `makeProgressEvent` defaults supply the rest; in `createHealProgressListener` always
  patch bytes explicitly (`bytesDownloaded: value.bytesDownloaded, bytesTotal: value.totalBytes`,
  zeros when no heal download) so HEALING events never inherit download-phase totals.
  **Conflict:** runner.ts edited by W4-T4 (phase enum), W9-T7 (comment trim); manager.ts edited
  by W7-T1, W9-T2. **Sequence W9-T6 after Waves 4 and 7; within Wave 9 it is the sole editor
  of healProgress.ts and shares runner.ts/manager.ts with W9-T7/W9-T2 — sequence W9-T2 →
  W9-T6 → W9-T7 to serialize the shared-file edits.**
- **Test plan:** runner delete-phase: one existing + one missing file → processedFiles===2,
  deletedAny===true. Heal-progress: HEALING emission after a nonzero download phase carries
  bytes 0/0.
- **Risk:** low.

### W9-T7 — Decorative/stale comment trims
- **Source:** flow-download/DL-11 (DLI-75/76/79), dedup-dead-code/DL-9 (DLI-75/76/79 + X3)
- **Files:**
  - `src/main/services/minecraft/manager.ts`
  - `src/main/services/bundle/runner.ts`
  - `src/main/services/bundle/manager.ts`
  - `src/main/services/catalog/catalog.ts`
  - `src/main/services/media/index.ts`
- **Change:** Trim runner.ts:33 to the file-boundary why; delete manager.ts:135-137; trim
  147-150 to the UI-ordering why; fix the bundle pauseSync comment to describe the
  rethrow-ABORTED/parked mechanism; correct catalog.ts:67-70 (only minecraft buildContext
  consumes it — but this comment is already removed by W4-T2; if W4-T2 shipped, drop catalog.ts
  from this task); correct media/index.ts:17 (protocol.handle persists, not "nothing to
  release"); update the LaunchHook type comment to drop the removed implicit-install phrase.
  **Conflict:** minecraft/manager.ts and bundle/manager.ts and runner.ts and catalog.ts are
  edited by many earlier tasks. **Sequence W9-T7 LAST of Wave 9** (and after Waves 1-7) so all
  semantic edits have landed and only comments remain to trim. Verify the target comment lines
  still exist (line numbers will have shifted).
- **Test plan:** comment-only; biome + tsc + vitest unchanged; grep removed phrases gone.
- **Risk:** low.

### W9-T8 — Renderer dead/over-exported cluster + getCurrentLanguage + over-exports
- **Source:** dedup-dead-code/DL-6 (X4), dedup-dead-code/DL-7, dedup-dead-code/DL-10
- **Files:**
  - `src/renderer/features/clients/components/BuildSection.tsx`
  - `src/renderer/features/clients/components/buildStatus.ts`
  - `src/renderer/features/clients/components/useBuildStatus.ts`
  - `src/renderer/features/app-shell/index.ts`
  - `src/renderer/features/bundle/statusSeeder.ts`
  - `src/renderer/i18n/index.ts`
  - `src/main/services/servers/serversProtocol.ts`
  - `src/main/infra/db/legacyImport.ts`
  - `tests/renderer/features/clients/useBuildStatus.test.ts`
  - `tests/renderer/features/bundle/statusSeeder.test.ts`
- **Change:** Delete `BuildSection` (keep SectionLabel); remove `tone`/`TONE_BY_STATUS`/
  `BuildStatusTone` + the test's tone assertion; remove the unused `TopNav` barrel re-export;
  point statusSeeder.test.ts at `@renderer/shared/lib/statusSeeder` and delete the two
  pass-through re-exports; delete `getCurrentLanguage`; demote serversProtocol's four helper
  exports to module-private; make legacyImport's `errorMeta` delegate to `infra/errorMessage`.
- **Test plan:** `npm run verify`; grep each removed symbol → zero refs; BuildStatusBadge
  still renders (labelKey+glyph only).
- **Risk:** low.

### W9-T9 — IPC hardening: assertNoIpcArgs on builds.listMinecraftVersions; typed emit helper; kit-version define
- **Source:** arch-lifecycle-ipc/DL-4 (IPC-01 gap), arch-lifecycle-ipc/DL-8 (T3), flow-update/DL-8 (DLI-71)
- **Files:**
  - `src/main/services/instances/routes.ts`
  - `src/shared/ipc/contract.ts` *(read-only/verify only — already edited by W6/W9-T1; no
    structural change here; if a touch is needed, sequence after those)*
  - `src/main/services/minecraft/broadcast.ts`
  - `src/main/services/bundle/broadcast.ts`
  - `src/main/infra/notifier.ts`
  - `src/main/infra/consoleWindowSink.ts`
  - `src/main/infra/consoleHub.ts`
  - `src/shared/ipc/emit.ts` (new, typed `emit<TEvent>` helper)
  - `src/main/services/minecraft/installManifest.ts`
  - `electron.vite.config.ts`
- **Change:** (a) Add `assertNoIpcArgs(rawArgs, ...)` to the `builds.listMinecraftVersions`
  handler. (b) Add a typed `emit<TEvent extends keyof IpcEventPayloads>(window, event,
  payload)` helper and route every main-side `webContents.send` through it (broadcasters,
  notifier, consoleWindowSink). (c) DLI-71: inject the kit version as a Vite `define`
  build-time constant (read package.json at config time), replace the runtime createRequire
  path in installManifest.ts, drop `parsePackageVersion`/`UNKNOWN_KIT_VERSION`, add a
  build-time semver assertion. **Conflict:** broadcast.ts files also feed W5-T3 (progress
  normalization). Sequence W9-T9 after Wave 5. This is the sole Wave-9 editor of the emit /
  broadcaster / notifier / consoleWindowSink / consoleHub / installManifest files. If
  bundling all three is too broad, split into W9-T9a (assertNoIpcArgs), W9-T9b (typed emit),
  W9-T9c (kit-version define) — they touch disjoint files and can run in any order.
- **Test plan:** routes test sends a payload to builds.listMinecraftVersions → IPC_INVALID_ARGS;
  type-level: a deliberate emit payload/event mismatch errors in tsc; build + grep out/main
  for the literal kit-version string; installManifest unit asserts version match logic.
- **Risk:** low-medium.

---

## Appendix A — Rejected / refuted findings (not scheduled)

- **flow-download/DL-12** (renderer discards bundle invoke rejections → zero feedback):
  REFUTED — the global `MutationCache.onError` already toasts bundle rejections; the
  "zero user feedback" claim is false in current code.
- **flow-update/DL-1** (pause-then-resume during manifest fetch deletes the bundle):
  REFUTED as a duplicate framing — the destructive path is real but is owned by
  flow-download/DL-2 (W1-T2); this finder's separate entry was refuted on reachability/dup.
- **arch-lifecycle-ipc/DL-6** (drain() has no watchdog timeout): the line citations are
  accurate but the finding was refuted/not-actioned in this batch (verdict left it out of the
  confirmed set as a standalone fix); the existing before-quit drain + cancelAll is the
  documented good path. Not scheduled. (Architecture-map A11 tracks it for a future wave.)
- **renderer-quality/DL-3** (PlayButton mutation triggers discard rejections; OP_IN_FLIGHT/
  cancel/stop rely on the global handler): the code citations are accurate but the global
  MutationCache handler already surfaces these; folded conceptually into W2-T2 (no separate
  task — the localization there covers the minecraft codes). Not scheduled separately.

---

## Appendix B — Stays deferred (package-bound / out of repo)

These cannot be completed inside `loontail-launcher` alone and are NOT scheduled as launcher
code tasks:

- **API_TOKEN public-read redesign** (flow-update/DL-6, perf-security/PS-1, S1): the genuine
  high-value fix is making the Strapi catalog + bundle-registry read endpoints public/anon
  (or minting a documented read-only token). That is a Strapi/Yggdrasil-plugin server change,
  out of the launcher repo and under the no-kit/yggdrasil-package-changes convention. The
  forked-PR exfiltration premise is moot (`pull_request` does not pass secrets to forks).
  See "needs user decision" below for the in-repo CI/token-rename slice.
- **Progress-contract normalization beyond install** (D2 monotonic-percent compensation):
  W5-T3 handles the install bytes/speed slice; the broader cross-process progress-contract
  unification (monotonic percent latching) is larger and stays deferred.
- **Async-IndexedDB query persister** (UI-32 second half): W7-T3 ships the synchronous-payload
  scoping; the async-driver rewrite stays needs-design.
- **Kit targetId identity** is deliberately preserved (not re-keyed) in W6-T1 to avoid
  touching kit-owned on-disk path semantics.

---

## Appendix C — Needs user decision (minimal)

1. **API_TOKEN strategy (infra change).** Decide between:
   (a) Grant the Strapi `public` role `find` on Client + the bundle-registry manifest route,
       then swap clientsApi/bundle api to a no-auth read mode and delete the token plumbing
       (requires a **server-first deploy** — the launcher change cannot merge ahead of it); OR
   (b) Keep a token but rename it `API_READ_TOKEN`, document it as non-secret/read-only, and
       remove it from PR CI (demote `requireEnv('API_TOKEN')` to optional in non-release
       builds). This is the only in-repo, independently-shippable slice and stops PR artifacts
       from embedding the production credential, but does NOT remove the shipped-asar exposure.
   Recommendation: (a) is the real fix; (b) is the minimum if (a) is deferred to the server
   repo. Either way, rotate the current token.

2. **Release pipeline ordering** (flow-update/DL-7, S2). Decide the trigger model: reorder so
   Windows `verify` gates the bump+tag+publish (verify on the pushed commit, publish-build on
   the bump commit — accept the two-commit split), AND/OR switch to intent-gated releases
   (tag-push or `workflow_dispatch`) instead of auto-release on every main push. Note CI
   already runs `verify` on PRs (Linux), so the residual gap is Windows-only failures + direct
   pushes — impact is lower than originally framed. This requires choosing a concrete trigger
   mechanism (moving tag creation, reworking the RELEASE_TOKEN bypass + loop-guard), so it is a
   user/maintainer decision rather than a mechanical task.

3. **DL-13 launch-chained-pause semantics** (flow-download/DL-13, DLI-62): "needs design".
   A Pause on a launch-chained sync currently holds the launch on LAUNCHING up to 5 minutes.
   The proposed fix (reject the forLaunch awaiters on pause → drop to INSTALLED, sync stays
   resumable) is a behavior flip that **breaks the pinned test** `managerPauseCleanup.test.ts`
   "keeps syncForLaunch pending across pause and resolves after resume" and requires an
   additional PlayButton/selectInstallProgress change (while PAUSED the card still shows
   PROGRESS, not PLAY). Decide whether to adopt this semantics (and rewrite the pinned test)
   or keep the current hold-until-resume/expiry behavior. Not scheduled until decided.

---

## Return summary

- **Wave count:** 10 (Wave 0 through Wave 9).
- **Task count per wave:** W0=3, W1=4, W2=3, W3=1, W4=4, W5=6, W6=1, W7=3, W8=4, W9=9
  (total 38 scheduled tasks; W9-T5 is largely subsumed by W7-T2).
