# DLI Part B — audit triage

Read-only triage of DLI-49…DLI-80 (assigned subset). Source inspected at HEAD on
2026-06-06. Note: the backlog line numbers predate several refactors; current
`manager.ts` has diverged heavily and many `manager.ts`-keyed tasks are already
resolved by the present awaiter + idle-timer + single-`finally` design.

Hot/shared files (touched by multiple OPEN items): `bundle/manager.ts`,
`bundle/runner.ts`, `bundle/syncState.ts`, `minecraft/installManifest.ts`.

Legend: classification — concrete fix — Risk / Effort.

---

## DLI-49 — buildPlan double-syscall (access + hash) — OPEN
- **Files/symbols:** `src/main/services/bundle/plan.ts` — `exists()` (l.35), `hashFile()` (l.26), the disk-hash branch (l.110-120).
- **Evidence:** `exists()` still calls `fs.access`; `hashFile` opens `createReadStream` with no `highWaterMark`. The `!known` branch (l.96-105) does `exists(destPath)` then falls through to `hashFile(destPath)` — two syscalls on the inode for every "no record but on disk" / force-mode file.
- **Fix:** Replace the `exists()`+`hashFile()` pair in the hash branches with a single `createReadStream(destPath,{highWaterMark:256*1024})` whose `error` handler maps `ENOENT`→`toDownload`. The standalone `exists()` is still needed by the `downloadOnce` (l.70) and `!entry.sha256` (l.82) branches, so keep it but stop pre-checking before hashing.
- **Risk:** Low · **Effort:** small · packages: no · **Test:** yes — extend `plan.test.ts`: ENOENT→toDownload, hash-match→toSkip still hold.

## DLI-50 — runSync activeSyncs.has() vs lock dual-guard — OPEN (cleanup)
- **Files/symbols:** `manager.ts` `runSync` — `activeSyncs.has(slug)` pre-check (l.204-209) vs `acquireWriteLock` (l.227).
- **Evidence:** Both guards still present. `acquireWriteLock` already throws `OP_IN_FLIGHT`. The map check is redundant — the lock is the single source of truth; the dual guard can diverge during pause/resume (active still present, lock logic differs) and yields a non-deterministic error origin.
- **Fix:** Remove the `activeSyncs.has()` pre-check; rely on `acquireWriteLock`. The `OP_IN_FLIGHT` BundleError is equivalent. (Minor behavior change: a paused active sync currently rejects a fresh `startSync` via the map check; after removal it rejects via the still-held lock — same outcome, the lease is held until `dropActiveSync`.)
- **Risk:** Medium (concurrency-adjacent) · **Effort:** small · packages: no · **Test:** yes — concurrent `startSync` same slug → 2nd gets `OP_IN_FLIGHT` from lock. Verify the pause-then-fresh-startSync path still rejects (`managerPauseCleanup` "rejects manual bundle sync while writer lock held" partly covers).

## DLI-51 — pauseSync not idempotent (double-arm idle timer) — OPEN
- **Files/symbols:** `manager.ts` `pauseSync` (l.112-122).
- **Evidence:** Guards `active.task.cancelled` (l.115) but NOT `active.task.paused`. A second `pauseSync` re-aborts, re-emits PAUSED, and re-arms the idle timer (`armPauseIdleTimer`→`clearPauseIdleTimer`+new `setTimeout`), resetting the expiry window.
- **Fix:** Add `if (active.task.paused) return;` after the cancelled guard.
- **Risk:** Low · **Effort:** trivial · packages: no · **Test:** yes — pauseSync twice → `armPauseIdleTimer` called once (or PAUSED emitted once).

## DLI-52 — expirePausedSync redundant `pauseIdleTimer = null` — OPEN (dead code)
- **Files/symbols:** `manager.ts` `expirePausedSync` (l.448-459), l.451 `active.pauseIdleTimer = null`.
- **Evidence:** `dropActiveSync` (l.458) deletes the active entry wholesale, so the manual null on l.451 is dead.
- **Fix:** Delete l.451.
- **Risk:** Low · **Effort:** trivial · packages: no · **Test:** no (existing idle-timeout test still green).

## DLI-53 — getInstallState blocks UI on remote manifest fetch — OPEN
- **Files/symbols:** `manager.ts` `getInstallState` (l.168-200), `fetchRemoteManifest` await (l.194).
- **Evidence:** On a local-manifest hit it still `await`s `fetchRemoteManifest` for the drift check. The try/catch swallows errors but the await is on the critical path — a slow/flaky CDN hangs the seed call (comment l.189-191 claims non-blocking; code blocks).
- **Fix:** Return `{installed:true, signatureMatches:true, progress:null}` immediately on local hit; run the drift check in the background and emit a separate status/event when it resolves (the broadcaster + a `signatureMatches`-style status, or a dedicated drift event). Simpler interim: keep synchronous result but bound the fetch with an `AbortSignal` timeout. Background-emit is the correct fix.
- **Risk:** Medium (changes IPC seed contract / adds an async event) · **Effort:** medium · packages: no · **Test:** yes — local manifest present + stalled fetch → returns <100ms.

## DLI-54 — workers close over reassigned task.abort — OPEN (latent)
- **Files/symbols:** `runner.ts` `runDownloadWorker` (l.91-109, reads `task.abort.signal` l.99), `syncState.ts` `resetTaskForResume` (l.60-70, reassigns `task.abort` l.63).
- **Evidence:** Workers read `task.abort.signal` fresh each loop iteration; `resetTaskForResume` swaps `task.abort` in place. In practice resume only runs after pause fully drained workers (`runSyncPhases` returns), so no live worker observes the swap — but the shared-mutable-object pattern is fragile and untested for the overlap.
- **Fix:** Capture `const signal = task.abort.signal` once per `downloadEntry` call inside the worker (already effectively done — passed to `downloadEntry`), OR make `resetTaskForResume` return a new `SyncTask` and atomically re-point `active.task`. Lowest-risk: snapshot the signal at worker entry per file; document the "resume only after drain" invariant in a `// why`.
- **Risk:** Medium · **Effort:** small (snapshot) / medium (immutable task) · packages: no · **Test:** optional stress test for pause/resume/cancel signal observation. Lower priority — no reproduced failure.

## DLI-55 — cancelAll blind 250ms grace sleep — OPEN
- **Files/symbols:** `manager.ts` `cancelAll` (l.470-476), `setTimeout(resolve, graceMs)` l.474.
- **Evidence:** Still a blind sleep. Both a floor (truncates slow cleanup) and ceiling (wastes time on fast cleanup), delaying shutdown.
- **Fix:** Reuse the awaiter mechanism: in `cancelAll`, for each active sync create a completion awaiter resolved by `dropActiveSync`, then `Promise.allSettled` with a `maxMs` timeout guard. Requires a per-active "drop" signal (could fold into `ActiveSync` — see DLI-74 cluster).
- **Risk:** Low · **Effort:** medium · packages: no · **Test:** yes — resolves promptly when syncs finish fast; times out at maxMs otherwise.

## DLI-56 — manifest-write failure demotes completed sync — ALREADY-RESOLVED
- **Files/symbols:** `manager.ts` `completePreparedSync` (l.346-356).
- **Evidence:** Now wraps `persistLocalManifest` in `try { … } finally { emitStatus; resolveAwaiters }` (l.350-355) with the exact `// why` the backlog requested ("trailing manifest-write failure must never demote"). `persistLocalManifest` (l.358-371) already warns-and-swallows. The status + awaiter settle regardless. This is DLI-69 (DONE 2026-05-31) generalized.
- **Classification:** ALREADY-RESOLVED. Pinned by `managerLockCleanup.test.ts` "resolves a forLaunch sync … even when the manifest write fails".

## DLI-57 — cancel window between ops.set and lock.setCancel — OPEN (narrow)
- **Files/symbols:** `minecraft/manager.ts` `startInstall` (l.125-163): `beginInstall` (l.132) calls `env.ops.set` synchronously; `lock.setCancel` at l.133.
- **Evidence:** `beginInstall` (`install.ts` l.31) does `env.ops.set(slug, op)` then returns; `lock.setCancel(() => this.cancel(slug))` runs on the next line (l.133). Both are synchronous with NO await between them, so `cancelAll`/`cancel` cannot interleave in single-threaded JS — the window the backlog describes does not exist at runtime. The residual nit: the lock has `cancel:null` for those two statements, but no async yield occurs, so it is unobservable.
- **Classification:** OPEN only as a defensive tidy (effectively a non-bug). Optional fix: pass the cancel via the lock acquire descriptor, or call `op.abort`-wiring before `ops.set`. **Recommend: DOWNGRADE / OBSOLETE** unless an async step is later introduced between `beginInstall` and `setCancel`.
- **Risk:** Low · **Effort:** trivial · packages: no · **Test:** not worth a dedicated test given no real window.

## DLI-58 — download worker error doesn't abort siblings — OPEN
- **Files/symbols:** `runner.ts` `runDownloadPhase` catch (l.121-125).
- **Evidence:** On worker throw it sets `firstError` and drains `pendingDownloads.length = 0`, but does NOT call `task.abort.abort()`. Sibling workers each finish their current `downloadEntry` (up to concurrency-1 extra files) before observing the empty queue.
- **Fix:** In the catch, also call `task.abort.abort()`. `downloadEntry` (`download.ts` l.167-177) already listens on `options.signal` and fails in-flight. Guard: aborting also flips `task.abort.signal.aborted`, so the post-loop classification (l.131) must still map to `DOWNLOAD_FAILED` for a genuine failure, not `ABORTED` — current code checks `firstError instanceof BundleError` first (l.130), so a download `BundleError` rethrows correctly; only a non-BundleError + aborted would mis-map. Re-check ordering after adding abort.
- **Risk:** Low-Medium (error-code classification interaction) · **Effort:** small · packages: no · **Test:** yes — 10 files / 4 workers, file 2 fails → ≤3 extra downloads start, abort called, error surfaces as DOWNLOAD_FAILED.

## DLI-60 — runSyncPhases duplicated pause/cancel checks return partial result — OPEN (cleanup)
- **Files/symbols:** `runner.ts` `runSyncPhases` (l.213-226).
- **Evidence:** Two `if (task.cancelled || task.paused)` blocks (l.215, l.221). The l.221 paused branch returns `deleteResult` (partial) as if successful. Current caller `executePreparedSync` re-checks `task.paused` (l.307, l.322) and short-circuits, so the partial result is ignored — correct today but a foot-gun for future callers.
- **Fix:** Return a discriminated result `{kind:'paused'|'cancelled'|'completed', deletedAny}` (or throw a `PausedError`) so a caller can't silently treat paused as done.
- **Risk:** Low · **Effort:** small · packages: no · **Test:** yes — pause during delete → caller receives `paused` discriminant.

## DLI-61 — LocalManifest Zod schema — ALREADY-RESOLVED
- **Files/symbols:** `shared/contracts/bundle.ts` `LocalManifestSchema` (l.81-88), `LocalManifestFileSchema` (l.74-77); `bundle/manifestRepo.ts` `loadLocalManifest` (l.13) uses `LocalManifestSchema.safeParse`.
- **Evidence:** The manual typeof checks are gone; `safeParse` with a full schema (bundleSlug/manifestHash/syncedAt/files record of file schema) is in place. This is DLI-73 (DONE 2026-05-31). `manifestRepo.test.ts` exists.
- **Classification:** ALREADY-RESOLVED.

## DLI-62 — executePreparedSync paused-mid-heal awaiter — NEEDS-DESIGN (deferred)
- **Files/symbols:** `manager.ts` `executePreparedSync` (l.280-344): heal phase l.310-321, catch l.326-338 (`ABORTED && task.paused` → return l.333-335), finally l.339-343 (`if (!task.paused || task.cancelled) dropActiveSync`).
- **Analysis:** The backlog's "permanent hang" premise is largely mitigated by the current design. A `forLaunch` awaiter parked on pause is INTENTIONALLY left pending and is later settled by exactly one of: `resumeSync`→completion (resolve), `cancelSync` (reject, l.160-163), or `expirePausedSync` idle-timer (reject, l.454-457). Tests `managerPauseCleanup.test.ts` "keeps syncForLaunch pending across pause and resolves after resume" and "rejects paused syncForLaunch when cancelled" pin this. The only trigger that reaches `ABORTED && task.paused` (l.333) is `pauseSync`; an `externalSignal` abort routes through `cancelSync` (sets `cancelled=true`), hitting l.328 which rejects. So a true permanent leak is not reachable in the current code.
- **Residual design question (why deferred):** heal (`healAfterDeletes`) is not pause-aware — on pause it aborts and throws rather than checkpointing. Resume then re-plans from disk and re-heals from scratch. Whether pause should be allowed to interrupt the heal phase at all (vs. finishing heal then parking) is the open design decision a prior session deferred. No code change recommended until that is decided.
- **Classification:** NEEDS-DESIGN. Risk if mis-handled: High (LAUNCHING stuck), but current mechanism prevents the hang. **Effort if pursued:** medium-large (pause-aware healer or a finally-settle guard for forLaunch awaiters).

## DLI-64 — no full install→launch integration test — OPEN (partial)
- **Files/symbols:** `minecraft/manager.ts` `startInstall` (l.137-162) emit-ordering + launchHook; `tests/main/services/minecraft/managerInstall.test.ts`.
- **Evidence:** `managerInstall.test.ts` covers (a) lock released once before hook, (b) lock released once on install failure + hook skipped. It does NOT assert: INSTALLED emitted BEFORE `launchHook` (l.150 vs l.151-159), launchHook throw keeps INSTALLED (l.154-158), install-cancel skips hook. `managerReadinessIntegration.test.ts` mocks runInstall/runLaunch.
- **Fix:** Add three cases to `managerInstall.test.ts`: emitStatus(INSTALLED) call-order vs launchHook spy; launchHook rejects → final status stays INSTALLED, warn logged; cancelled install → launchHook not called.
- **Risk:** Low · **Effort:** small · packages: no · **Test:** yes (the deliverable is the tests).

## DLI-65 — buildPlan "no local record but file on disk" branch untested — OPEN
- **Files/symbols:** `plan.ts` l.96-105 (`!known` → exists → fall-through to disk hash); `tests/main/services/bundle/plan.test.ts`.
- **Evidence:** `plan.test.ts` has toSkip cases but no test for: remote has X, local manifest has NO record for X, X on disk with correct hash → toSkip; wrong content → toUpdate. Grep of plan.test.ts shows no "no record"/"disk hash" coverage.
- **Fix:** Two test cases in the buildPlan describe block. (Pairs naturally with DLI-49 which rewrites this branch — sequence DLI-65 tests first, then DLI-49 refactor, to lock behavior.)
- **Risk:** Low · **Effort:** small · packages: no · **Test:** yes.

## DLI-66 — download.ts no transport injection point — OPEN
- **Files/symbols:** `download.ts` `requestOnce` (l.32-90) calls `http/https.request` directly; `tests/.../download.test.ts` uses real servers.
- **Evidence:** No injection seam. Edge cases (redirect-loop limit, timeout, abort-during-stream, SHA mismatch) need real HTTP servers.
- **Fix:** Add `type HttpTransport = typeof https.request` and thread an optional transport param through `downloadEntry`→`followRedirects`→`requestOnce`, defaulting to the real Node modules (select by protocol). Mirrors kit's `FetchHttpClient` injection.
- **Risk:** Low · **Effort:** medium · packages: no · **Test:** yes — fake transport for redirect/timeout/abort/SHA-mismatch.

## DLI-67 — consolidate isAnythingInstalled around durable manifest — OPEN (partial / scoped down)
- **Files/symbols:** `minecraft/runtimeState.ts` `isAnythingInstalled` (l.9); callers: `install.ts:47`, `repairWorkflow.ts:58`, `readinessPolicy.ts:25`, `uninstall.ts:50`.
- **Evidence:** `readinessPolicy.ts` (l.23-26) already runs `loadTargetInstallManifest` + `isAnythingInstalled` in parallel via `Promise.all` and has the documented UNVERIFIED state (l.27-28). The backlog's proposed end-state is mostly in place. Remaining nit: on the happy path (manifest present) it still pays the `isAnythingInstalled` disk scan because of `Promise.all`; the backlog suggests deferring the scan to the `manifest === null` case to save one stat.
- **Fix (small):** In `readinessPolicy.resolveClientInstallPresence`, load the manifest first; only call `isAnythingInstalled` when `manifest === null`. Keep the scan as a fallback in repair/install/uninstall (cancel/cleanup correctness). This is a micro-optimization, not a correctness change.
- **Risk:** Low · **Effort:** trivial-small · packages: no · **Test:** yes — assert `isAnythingInstalled` not called when manifest present. NOTE: the false-INSTALLED-for-foreign-install concern is already addressed (foreign install → manifest null → UNVERIFIED).

## DLI-68 — local ProgressStages shadows kit's — OPEN
- **Files/symbols:** `shared/contracts/minecraft.ts` `ProgressStages` (l.26-34); `minecraft/progressAdapter.ts` imports from `@shared/contracts/minecraft` (l.15-19).
- **Evidence:** Kit DOES export `ProgressStages`/`ProgressStage` (`@loontail/minecraft-kit` dist/index.d.ts l.2945-2964) with identical values: PREPARE/RUNTIME/MINECRAFT/LOADER/FINALIZE — byte-identical to the shared const (l.27-31). So the shared definition is a true duplicate domain enum. `progressAdapter.ts` maps kit verify/download categories into these stages.
- **Fix:** Two viable paths. (1) If the renderer can import the kit enum (kit is a launcher dep), delete the shared `ProgressStages`/`ProgressStageSchema` and re-export from the kit, updating `progressAdapter.ts` + `healProgress.ts` + any renderer importers. (2) If the shared layer must stay renderer-safe / kit-free, keep the local enum but add a compile-time assertion that it equals the kit's (`satisfies`) and a `// why` documenting the intentional mirror. Decide based on whether the renderer bundle is allowed to pull `@loontail/minecraft-kit`.
- **Risk:** Medium (touches shared contract + IPC enum + possibly renderer imports) · **Effort:** medium · packages: no (kit already a dep) · **Test:** compile-only + verify IPC `ProgressStage` round-trip. NEEDS a quick decision on renderer→kit import boundary before executing.

## DLI-71 — kit version via createRequire(package.json) at runtime — OPEN
- **Files/symbols:** `minecraft/installManifest.ts` l.2 (`createRequire`), l.14 (`requirePackage`), l.46-47 (`requirePackage('@loontail/minecraft-kit/package.json')` → `MINECRAFT_KIT_VERSION`).
- **Evidence:** Runtime `createRequire(import.meta.url)('@loontail/minecraft-kit/package.json')`. In a packaged Electron build without `node_modules`, `parsePackageVersion` falls back to `'unknown'` (l.43), and `targetInstallManifestMatches` (l.162) compares `manifest.kitVersion === MINECRAFT_KIT_VERSION` — so a packaged build that wrote `'unknown'` would still self-match, BUT manifests written by a dev build (real version) would then be reported stale after packaging, and vice-versa. Fragile.
- **Fix:** Inject a build-time constant via Vite `define` (e.g. `__MINECRAFT_KIT_VERSION__`), read from package.json at Vite config time. Remove `createRequire`/`requirePackage`/`parsePackageVersion`. Add CI assertion the constant is a semver (not `'unknown'`).
- **Risk:** Medium (build config change; must wire `define` + ambient type decl) · **Effort:** small-medium · packages: no (build config only) · **Test:** build-time assert semver; unit mock constant for `targetInstallManifestMatches` mismatch.

## DLI-72 — duplicated sha256 (api.ts vs plan.ts) — OPEN
- **Files/symbols:** `bundle/api.ts` `sha256(string)` (l.23); `bundle/plan.ts` `hashFile(path)` (l.26-33); `bundle/download.ts` inline `createHash('sha256')` (l.135,154).
- **Evidence:** Three separate `createHash('sha256')` sites.
- **Fix:** New `bundle/hash.ts` exporting `sha256String(input)` and `sha256File(path)`; `api.ts` + `plan.ts` import; optionally `download.ts` adopts `sha256File`/a streaming helper. NOTE: coordinate with DLI-49 — that task rewrites `plan.ts` `hashFile` to add highWaterMark + ENOENT handling, so define `sha256File` with those traits and have DLI-49 consume it. Sequence DLI-72 before/with DLI-49.
- **Risk:** Low · **Effort:** small · packages: no · **Test:** yes — `sha256String` known vector; `sha256File` == `sha256String` on a file's bytes.

## DLI-74 — activeLocks parallel map desync — OPEN
- **Files/symbols:** `manager.ts` `activeSyncs` (l.80) + `activeLocks` (l.81); `dropActiveSync` (l.399-405) deletes both; lock set at l.231.
- **Evidence:** Two `Map<ClientSlug,…>` kept in lockstep manually. `dropActiveSync` releases+deletes the lock; every exit path must call it or the lease leaks (client permanently locked). The risk is real but currently contained by `dropActiveSync` being the sole drop site.
- **Fix:** Add `lock: ClientOperationLease` to `ActiveSync` (in `syncState.ts` `ActiveSync` type + `createActiveSync`), remove `activeLocks`. `dropActiveSync` → `active.lock.release(); this.activeSyncs.delete(slug)`. Makes desync structurally impossible. NOTE: the lease is acquired in `runSync` (l.227) BEFORE `createActiveSync` (l.234); reorder so the lease is passed into `createActiveSync`, and the pre-active throw path (l.227-236 setup) still releases (currently `dropActiveSync` handles it because `activeLocks.set` is at l.231 before active exists — with the merge, handle the "lock acquired but active not yet built" window by releasing the lease directly in that catch).
- **Risk:** Medium (rewrites the lifecycle of the lease; the "lock before active" gap needs care) · **Effort:** medium · packages: no · **Test:** yes — after cancelSync on paused sync, lock free + slug gone; sequential syncs after cancel succeed. This is the lynchpin enabling DLI-55's awaiter-based cancelAll.

## DLI-75 — per-field label comments on DownloadOptions / SyncTask — OPEN (docs)
- **Files/symbols:** `download.ts` l.23-24 (currentRequests — KEEP, cancel-protocol why); `runner.ts` SyncTask l.31-32 (currentRequests — KEEP), l.33-34 (`// Cooperative pause/cancel flags. Workers check between file boundaries.`).
- **Evidence:** l.33-34 restates the field names `paused`/`cancelled`; only "between file boundaries" is non-obvious.
- **Fix:** Reduce l.33-34 to `// Workers check these between file boundaries, not mid-chunk.` Leave currentRequests comments.
- **Risk:** Low · **Effort:** trivial · packages: no · **Test:** no.

## DLI-76 / DLI-79 — startInstall narrating comments — OPEN (docs, same hunk)
- **Files/symbols:** `minecraft/manager.ts` `startInstall` (l.134-159).
- **Evidence:** l.134-136 (`// runInstall handles errors internally …`) is what-narration. l.146-149 (`// Mark Minecraft itself as installed BEFORE …`) opens with a what-restatement of `emitStatus(INSTALLED)` attached to a genuine ordering why. l.155-157 (`// Bundle failures surface via the bundle.error event channel …`) is a pure why — KEEP.
- **Fix:** Delete l.134-136. Trim l.146-149 to drop the "Mark Minecraft itself as installed BEFORE" clause, keep the UI-ordering why: `// INSTALLED is emitted before the bundle phase so the UI can swap the progress card from Minecraft download to bundle sync.` Keep l.155-157.
- **Risk:** Low · **Effort:** trivial · packages: no · **Test:** no. (DLI-76 and DLI-79 are the SAME comments — merge into one edit.)

## DLI-77 — cancelAll / resetForUninstall caller-reference comments — OPEN (docs)
- **Files/symbols:** `manager.ts` l.466-469 (above `cancelAll`), l.478-479 (above `resetForUninstall`).
- **Evidence:** l.466-469 mixes a genuine why (cooperative pause doesn't stop sockets) with shutdown/what narration. l.478-479 is the forbidden "Called by MinecraftManager.uninstall …" caller-reference; only "when the client folder isn't fully removed" is valuable.
- **Fix:** l.466-469 → `// Cooperative pause/cancel doesn't stop in-flight sockets; destroy them directly and allow a grace window for runner finally blocks.` l.478-479 → `// Clears the manifest sidecar when the client folder is kept (partial uninstall path).`
- **Risk:** Low · **Effort:** trivial · packages: no · **Test:** no.

## DLI-78 — install.ts narrating comment — OBSOLETE
- **Files/symbols:** `minecraft/install.ts` l.110 `// No derivable equivalent for runtime path elsewhere in settings.`
- **Evidence:** The backlog's own conclusion: this file is clean; the surviving comment is a valid non-obvious why. No other narrating comment present (verified l.101-123).
- **Classification:** OBSOLETE (no action). The backlog item itself concluded "no action required."

## DLI-80 — pauseIdleTimer dispose path on shutdown — OPEN (partial / verify)
- **Files/symbols:** `manager.ts` `armPauseIdleTimer` (l.431-439, `.unref()` l.437), `cancelAll` (l.470-476); `bundle/index.ts` `dispose` (l.30-32) calls `manager.cancelAll()`.
- **Evidence:** `index.ts` dispose DOES `await manager.cancelAll()` (l.31). `cancelAll`→`cancelSync`→`clearPauseIdleTimer` (l.146) for paused syncs, so the timer is cleared on shutdown. The `.unref()` already prevents the timer keeping the process alive. The residual concern: if the idle timer fires during the `cancelAll` grace window it calls `expirePausedSync`→`emitStatus`→`broadcaster.status` on a possibly-disposed broadcaster — but `cancelSync` clears the timer synchronously before the grace `setTimeout`, so the timer can't fire after cancelSync ran. The path is effectively safe TODAY.
- **Fix (defensive):** Verify `src/main/index.ts` drains the bundle service (cancelAll) BEFORE tearing down the broadcaster/mainWindow. If ordering is guaranteed, downgrade to a one-line `// why` documenting the invariant. If DLI-55 lands (awaiter-based cancelAll), the grace-window race disappears entirely.
- **Risk:** Low-Medium · **Effort:** small (verify + possibly reorder dispose in `src/main/index.ts`) · packages: no · **Test:** yes — cancelAll with a live pauseIdleTimer → timer cleared, no emitStatus after cancelAll.

---

# Clusters (disjoint file sets where possible)

Shared hot file `bundle/manager.ts` spans several clusters; clusters are split by
the OTHER files they touch so they can be parallelized with manager.ts edits
serialized.

### CLUSTER manager-lifecycle [Medium] — the load-bearing refactor
- IDs: DLI-74, DLI-55, DLI-50, DLI-51, DLI-52, DLI-80
- Files: `bundle/manager.ts`, `bundle/syncState.ts` (DLI-74 type), `bundle/index.ts` + `src/main/index.ts` (DLI-80 verify)
- Effort: medium (DLI-74 + DLI-55 are the bulk; 50/51/52 trivial). DLI-74 must land first (enables awaiter-based cancelAll in DLI-55).

### CLUSTER plan-and-hash [Low] — pure plan/hash path
- IDs: DLI-72, DLI-49, DLI-65
- Files: `bundle/hash.ts` (new), `bundle/api.ts`, `bundle/plan.ts`, `tests/.../plan.test.ts`
- Effort: small. Order: DLI-65 tests → DLI-72 extract → DLI-49 rewrite branch consuming `sha256File`.

### CLUSTER runner-phases [Low-Medium]
- IDs: DLI-58, DLI-60, DLI-54
- Files: `bundle/runner.ts`, `bundle/syncState.ts` (DLI-54)
- Effort: small-medium. DLI-54 overlaps syncState.ts with DLI-74 — serialize syncState edits.

### CLUSTER download-testability [Low]
- IDs: DLI-66
- Files: `bundle/download.ts`, `tests/.../download.test.ts`
- Effort: medium. Standalone.

### CLUSTER getInstallState-nonblocking [Medium]
- IDs: DLI-53
- Files: `bundle/manager.ts`, broadcaster/IPC event surface
- Effort: medium. Touches manager.ts — serialize with manager-lifecycle cluster.

### CLUSTER minecraft-install-manifest [Medium]
- IDs: DLI-71, DLI-67, DLI-64
- Files: `minecraft/installManifest.ts` (DLI-71 + Vite config), `minecraft/readinessPolicy.ts` (DLI-67), `minecraft/manager.ts` + `tests/.../managerInstall.test.ts` (DLI-64)
- Effort: small-medium (DLI-71 build-config is the heavy bit).

### CLUSTER progress-enum [Medium] — needs a boundary decision
- IDs: DLI-68
- Files: `shared/contracts/minecraft.ts`, `minecraft/progressAdapter.ts`, `bundle/healProgress.ts`, possible renderer importers
- Effort: medium. Blocked on a renderer→kit import-boundary decision.

### CLUSTER comments [Low] — docs-only, no overlap with logic edits if done last
- IDs: DLI-75, DLI-76+DLI-79 (merge), DLI-77
- Files: `bundle/download.ts`, `bundle/runner.ts`, `minecraft/manager.ts`, `bundle/manager.ts`
- Effort: trivial. Run AFTER the logic clusters to avoid churn/conflicts on the same hunks (esp. DLI-76/79 vs DLI-53/manager edits).

---

# Counts
- Total assigned: 27
- OPEN: 19 — DLI-49, 50, 51, 52, 53, 54, 55, 58, 60, 64, 65, 66, 67(scoped), 68, 71, 72, 74, 75, 76/79, 77, 80
  (DLI-76 and DLI-79 are one item; DLI-57 counted as effectively-non-bug below)
- ALREADY-RESOLVED: 3 — DLI-56, DLI-61, (DLI-69/73/63/70/81 already marked DONE in backlog)
- OBSOLETE / no-action: 2 — DLI-78, DLI-57 (non-reachable window; downgrade)
- NEEDS-DESIGN: 1 — DLI-62

Net unique OPEN actionable IDs: 49,50,51,52,53,54,55,58,60,64,65,66,67,68,71,72,74,75,76,77,79,80.
