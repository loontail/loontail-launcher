# REP group triage (repair / heal flow)

Scope: REP-1,2,3,6,7,8,9,10,11,13,14,15,16,17,18,20,22,24,25,26,28,30
(REP-4,5,12,19,21,23,27,29 already marked DONE in backlog — not in this group.)

Date: 2026-06-06. Read-only audit.

Key files inspected:
- src/main/services/minecraft/bundleHealing.ts
- src/main/services/minecraft/repairWorkflow.ts
- src/main/services/minecraft/progressAdapter.ts
- src/main/services/minecraft/forgeProcessorHealing.ts
- src/main/services/minecraft/readinessPolicy.ts
- src/main/services/minecraft/manager.ts
- src/main/services/minecraft/repair.ts
- src/main/services/minecraft/ops.ts
- src/main/services/bundle/healer.ts
- src/main/services/bundle/runner.ts
- src/main/services/bundle/manager.ts
- src/main/services/bundle/syncState.ts
- src/main/infra/throttledEmitter.ts
- tests/main/services/minecraft/managerLaunch.test.ts

---

## ALREADY-RESOLVED

### REP-1 — cancel() ignores UNINSTALL
RESOLVED. `manager.ts` cancel() (L183-210) is now a discriminated `switch` over `op.kind` with `assertNever` default. UNINSTALL has an explicit case (L197-202) that logs a warn `cancel ignored: uninstall is not cancellable` — i.e. the backlog's option (b) "document intentionally non-cancellable" was taken. `cancelAll()` (L300-321) is also an exhaustive switch that explicitly skips UNINSTALL+LAUNCH with a comment. The backlog's alternative ask (remove UNINSTALL from OP_TO_STATUS) was not taken, but the chosen path fully addresses the silent-no-op concern. Note: this is effectively the same fix as the DONE REP-12.

### REP-11 — repair adapter dispose drops the last progress frame
RESOLVED. `createRepairProgressAdapter` (progressAdapter.ts L116-185) uses `createThrottledEmitter` and exposes `dispose: emitter.dispose`. In `throttledEmitter.ts`, `dispose === flush` (L49); `flush` (L27-35) emits the pending value BEFORE clearing the timer. The old `clearPendingFlush` (cancel-without-flush) the backlog described no longer exists. A thrown error before finally still flushes the last frame.

---

## OPEN

### Cluster A — bundleHealing context coupling (the big one)
IDs: REP-6, REP-10, REP-14, REP-18, REP-20, REP-22, REP-28, REP-30 (8 IDs, all describe the SAME defect)
Files: src/main/services/minecraft/bundleHealing.ts, src/main/services/bundle/healer.ts, src/main/services/bundle/manager.ts, src/main/services/bundle/syncState.ts
Risk: Medium. Effort: medium. Packages: none. New test: yes.

Evidence: `verifyAndRepairExceptBundle` (bundleHealing.ts L65-71) still takes `(kit, slug, …)` and calls `const ctx = await buildContext(kit, slug)` at L71, importing `buildContext` from `./context` (L10). `createHealer` (healer.ts L30-33) calls it with only `(kit, slug, bundleOwnedPaths, options)` — no target/clientFolder threaded. `BundleManager.executePreparedSync` (manager.ts L306-317) calls `healAfterDeletes(slug, plan.bundleOwnedRelativePaths, …)` and has NO resolved minecraft target/ctx in scope. So every bundle sync that deletes a file does a fresh Strapi `getClient` + `kit.targets.resolve` (network) inside the HEALING phase, not covered by the abort signal — exactly as described.

Concrete fix:
1. Change `verifyAndRepairExceptBundle(kit, target, clientFolder, bundleOwnedPaths, options?)`; delete the `buildContext` import and the `./context` dependency from bundleHealing.ts. Replace `ctx.target` → `target`, `ctx.clientFolder` → `clientFolder`. Keep `slug` only if needed for log lines (pass it, or derive logs from clientFolder).
2. Widen `Healer.healAfterDeletes` to accept the resolved target + clientFolder.
3. In BundleManager, resolve the minecraft target ONCE at sync entry (via `buildContext`) and store it on `ActiveSync` (add `target: Target` / `clientFolder` already on task). Thread it into the heal call. This also removes the TOCTOU/version-drift (REP-14) and the cross-service layer inversion (REP-10: bundle → minecraft/context → clients/Strapi).
Consider moving bundleHealing.ts physically into src/main/services/bundle/ (REP-10/22 suggest this) once it no longer imports minecraft/context — leaves it a pure function of (kit,target,clientFolder,paths). Optional, lower priority than the signature change.
Note: REP-28's filter-dedup observation is already satisfied (`createBundleRepairIssueFilter` is exported once from bundleHealing and imported in repairWorkflow.ts L12) — only its buildContext half remains, folded here.
Test: unit test verifyAndRepairExceptBundle with an injected fake Target + clientFolder — assert NO buildContext/getClient/kit.targets.resolve call, assert kit.verify.minecraft.run called with the injected target.

### Cluster B — forge processor SHA-1 / focused-plan internals
IDs: REP-7, REP-8, REP-25, REP-26 (cache-singleton siblings REP-19/21/23/27/29 already DONE)
Files: src/main/services/minecraft/forgeProcessorHealing.ts (only)
Risk: Low (REP-7/8/25) to High (REP-26). Effort: REP-8 trivial; REP-7/25 small; REP-26 large. Packages: minecraft-kit (REP-7/25/26). New test: yes (REP-7/8/25).

Evidence: hand-rolled `sha1OfFile` (L78-90, streaming createReadStream + createHash, swallows errors to null) and `fileMissing` (L92-99) still present; combined in `processorOutputsOk` (L105-112). `focusedBytes` (L179-181) sums ONLY `DOWNLOAD_FILE` actions, so EXTRACT/WRITE bytes are 0 → `focusedPlan.totalBytes` undercount (REP-8). The whole module re-runs Forge processors using kit internals (`InstallActionKinds.RUN_FORGE_PROCESSOR`, `action.outputs`, `action.index`) — REP-26.

Concrete fix:
- REP-8 (trivial): either include all byte-bearing action kinds in `focusedBytes`, or just carry `plan.totalBytes` forward unchanged (kit tracker tolerates extra unaccounted bytes). One-liner + a `// why` note.
- REP-7/25 (small, in-launcher half): consolidate `sha1OfFile`+`fileMissing` into one `hashFileHex(path): Promise<string|null>` and add a `try/finally` to destroy the read stream on abort (current stream leaks an fd if the signal fires mid-hash). Note `sha1OfFile` does NOT honor options.signal at all today.
- REP-7/25/26 (kit half): file minecraft-kit issue to expose `hashFileHex` and/or `kit.repair.forge.repairProcessorOutputs(target,{signal})`; once shipped, replace this module with a thin wrapper. Requires edit kit src → build → copy dist into node_modules or republish + bump pinned version. Large + High risk (REP-26) — defer behind the cheap launcher-side cleanups.
Test: processorOutputsOk false on missing file / sha mismatch, true on match; buildFocusedPlan totalBytes ≥ download-only sum.

### Cluster C — readiness/status dedup in repairWorkflow
IDs: REP-9, REP-17
Files: src/main/services/minecraft/repairWorkflow.ts, src/main/services/minecraft/readinessPolicy.ts
Risk: Low. Effort: small. Packages: none. New test: yes.

Evidence: `emitReadinessStatus` (repairWorkflow.ts L50-62) runs `hasCurrentTargetInstallManifest` + `isAnythingInstalled` (two fs reads) and is called from `finalizeRepairCancellation` (L162) and `finalizeRepairFailure` (L172) but NOT from `finalizeRepairSuccess` (L143-154, which emits INSTALLED directly) — matches REP-9. `readinessPolicy.resolveClientInstallPresence` (readinessPolicy.ts L20-29) computes the same manifest+installed presence (collapsing to INSTALLED/NOT_INSTALLED/UNVERIFIED) — duplicate domain logic (REP-17).

Concrete fix: rename `emitReadinessStatus` → `emitPostOpStatus` (REP-9; it's a side-effecting emitter, not a query). Have it call `resolveClientInstallPresence(slug)` and map `UNVERIFIED → notReadyStatus`, then emit. Single source of truth for "what counts as installed." Note slight semantic difference: emitReadinessStatus keys off `ctx.target` (current-target manifest) while resolveClientInstallPresence keys off any manifest — preserve the current-target intent if that distinction is load-bearing (verify with a test before collapsing).
Test: emitPostOpStatus maps UNVERIFIED → supplied notReadyStatus; emits INSTALLED when manifest+versions present.

### Cluster D — bundle runner ENOENT does not trigger heal
IDs: REP-3
Files: src/main/services/bundle/runner.ts (only)
Risk: Medium. Effort: trivial. Packages: none. New test: yes.

Evidence: `runDeletePhase` ENOENT branch (L189-194) increments `completedDeletes` but deliberately does NOT set `deletedAny` — there's an explicit comment defending this ("no signal to heal from it"). `deletedAny` gates the heal pass in manager.ts L310. If every pendingDelete was already externally removed, `deletedAny` stays false → heal skipped → vanilla file the bundle was overriding is never restored.
This is a design disagreement, not an oversight — the code consciously chose the opposite of the backlog. Recommend adopting the backlog's "needsHeal" semantics: set the heal-trigger true whenever `toDelete` was non-empty and the delete phase completed un-paused/un-cancelled (regardless of ENOENT), since the bundle no longer owns those paths and vanilla state must be reconciled. Cheap and removes the silent-broken-state window.
Test: runDeletePhase with all files pre-removed (ENOENT) → returned flag is true.

### Cluster E — progressAdapter undocumented `aspect` cast
IDs: REP-16
Files: src/main/services/minecraft/progressAdapter.ts (only)
Risk: Medium. Effort: small (launcher guard) / medium (kit). Packages: minecraft-kit. New test: yes.

Evidence: `AspectTaggedProgressEvent` (L36-38) augments the public event with optional `aspect?: VerificationKind`; `progressStageForAspect` (L104-107) casts every event to read `.aspect`. Not a typed/published field; a kit rename silently collapses verify-phase stage detection to the download-category fallback with no compile error.
Concrete fix: file kit issue to type-expose `aspect` on VERIFY_FILE_CHECKED / DOWNLOAD_* events. Interim: add a runtime narrowing (`typeof (event as …).aspect === 'string'`) with a one-time debug log on first miss; mark the cast `// TODO kit#NNN`. Test: progressStageForAspect returns null when aspect absent, correct stage when present.

### Cluster F — startRepair getStatus race
IDs: REP-13
Files: src/main/services/minecraft/manager.ts (only)
Risk: Medium. Effort: small. Packages: none. New test: yes.

Evidence: `startRepair` (L212-233) does `requireIdle` (L213) + `acquireWriteLock` (L214), then `await buildContext` (L220), and only sets `this.ops.set(slug, op)` at L222 AFTER the await + emits REPAIRING at L224. During the buildContext await window, `getStatus()` (L102-123) finds no op in the map and returns disk-based `resolveClientInstallPresence` (likely INSTALLED) — UI shows Play. The second-caller race is guarded by operationLocks (the test at managerLaunch.test.ts L255-264 proves OP_IN_FLIGHT via lock), but the getStatus window is real.
Concrete fix: set a sentinel `{kind: REPAIR, abort}` op synchronously right after `acquireWriteLock` and before `await buildContext`; on buildContext throw, delete it in the catch (which already releases the lock). Mirrors startInstall's `beginInstall` synchronous-ops pattern.
Test: call getStatus during an in-flight (un-awaited) startRepair buildContext → REPAIRING, not INSTALLED.

### Cluster G — bundle cancelAll blind grace timeout
IDs: REP-15
Files: src/main/services/bundle/manager.ts, src/main/services/bundle/syncState.ts
Risk: Medium. Effort: small. Packages: none. New test: yes.

Evidence: `ActiveSync` (syncState.ts L7-16) has no execution-promise field. `cancelAll(graceMs=250)` (manager.ts L470-476) cancels each sync then `await new Promise(setTimeout(graceMs))` — a blind sleep; it does not await the syncs' own run promises, so callers' finally blocks (manifest writes, lock release) may outlive cancelAll on slow disks.
Concrete fix: store each runSync execution promise on `ActiveSync.promise: Promise<void>`; `cancelAll` does `await Promise.allSettled(promises)` raced against a timeout for a deterministic teardown.
Test: cancelAll after a started sync → no manifest .tmp left on disk after it resolves.

### Cluster H — repair adapter overallPercent == stagePercent
IDs: REP-2
Files: src/main/services/minecraft/progressAdapter.ts (only; shares file with Cluster E)
Risk: Low. Effort: medium. Packages: none. New test: yes.

Evidence: `createRepairProgressAdapter` (L116-133) computes `percent = bytes/total` and sets BOTH `stagePercent` and `overallPercent` to it (L126-127). No phase-weight aggregation across verify → forge heal → ensureLaunchable → bundle sync, so overall flatlines at 0 during verify then spikes per download phase.
Concrete fix: introduce a repair phase-weight map (mirror install tracker) so overallPercent aggregates across phases while stagePercent stays per-download. Medium because repair phases are driven by separate awaited calls in repair.ts (verifyAndRepairBase / healForgeProcessors / ensureLaunchable) — needs a small phase coordinator. Lower priority (P3, cosmetic).
Test: feed verify+download events, assert overallPercent monotonic non-decreasing.
SHARED HOT FILE with Cluster E (progressAdapter.ts) — sequence E then H, or do together.

### Cluster I — missing finishRepair hook tests
IDs: REP-24
Files: tests/main/services/minecraft/ (managerLaunch.test.ts or new managerRepair.test.ts)
Risk: Low. Effort: small. Packages: none. New test: yes (this IS the task).

Evidence: managerLaunch.test.ts has "refreshes bundle state after a successful manual repair" (L267-305) covering the happy path (hook called, REPAIRING emitted). MISSING: (1) hook NOT called when `runRepair` resolves false (manager.ts L361 guard); (2) hook rejection is swallowed/not propagated (L363-367); (3) lock released before hook (L357-364). finishRepair is at manager.ts L348-368.
Concrete fix: add tests mocking `runRepair` → false (assert hook not called) and hook → reject (assert no throw, warn logged). No production change.

---

## Clusters summary (DISJOINT file sets, shared hot files noted)

- A bundleHealing-context [Med] IDs=6,10,14,18,20,22,28,30 — bundleHealing.ts, healer.ts, bundle/manager.ts, syncState.ts — medium
- B forge-processor-internals [Low→High] IDs=7,8,25,26 — forgeProcessorHealing.ts — trivial→large
- C readiness-dedup [Low] IDs=9,17 — repairWorkflow.ts, readinessPolicy.ts — small
- D delete-enoent-heal [Med] IDs=3 — bundle/runner.ts — trivial
- E aspect-cast [Med] IDs=16 — progressAdapter.ts — small
- F startRepair-race [Med] IDs=13 — minecraft/manager.ts — small
- G cancelAll-grace [Med] IDs=15 — bundle/manager.ts, syncState.ts — small
- H repair-overall-percent [Low] IDs=2 — progressAdapter.ts — medium
- I finishRepair-tests [Low] IDs=24 — tests/ — small

SHARED HOT FILES across clusters:
- progressAdapter.ts: Clusters E + H
- bundle/manager.ts + syncState.ts: Clusters A + G (A resolves target at sync entry / stores on ActiveSync; G adds promise to ActiveSync — coordinate both ActiveSync edits)

Counts: 22 candidate IDs → 2 ALREADY-RESOLVED (REP-1, REP-11) · 20 OPEN across 9 clusters.
