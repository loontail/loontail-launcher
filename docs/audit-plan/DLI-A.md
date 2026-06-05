# DLI Group A — Triage (download/install + bundle sync)

Read-only audit. Backlog line numbers are stale (manager.ts/install.ts were reworked since the audit);
classification is against current `src/**`. Date: 2026-06-06.

Hot files (touched by many IDs): `src/main/services/bundle/manager.ts`, `src/main/services/bundle/plan.ts`,
`src/main/services/bundle/download.ts`.

## Summary table

| ID | Verdict | Note |
|----|---------|------|
| DLI-2 | ALREADY-RESOLVED | startInstall now releases lease once in a single `finally` inside the install IIFE (manager.ts:137-145). No `.then()` release. Dup of 35/39/46. |
| DLI-3 | ALREADY-RESOLVED | `continuePausedSync` wraps in try/finally→`dropActiveSync` (manager.ts:259-278); `runSync` outer catch drops too. Phantom-lock path closed. |
| DLI-4 | OPEN | Cross-service coupling: `getClient` direct import + `tryGetClient` (manager.ts:10,373-379); `bundleHealing.verifyAndRepairExceptBundle` re-`buildContext` (bundleHealing.ts:71). |
| DLI-6 | OPEN (dup) | Raw node:http/https in download.ts. Same fix as 14/24. |
| DLI-7 | OPEN | `createRequire` + `requirePackage('@loontail/minecraft-kit/package.json')` (installManifest.ts:14,46-47). |
| DLI-11 | OPEN (minor) | `persistLocalManifest` has no empty-`remoteManifest` guard (manager.ts:358-371); `remoteManifest` inits `{}` (syncState.ts:53). Currently safe, fragile. |
| DLI-12 | OPEN (dup) | `resolveClientFolder` returns `''` not null (manager.ts:381-384). Same fix as 30. |
| DLI-14 | OPEN | Raw HTTP streaming stack in download.ts (requestOnce/followRedirects). Cluster lead for 6/24. |
| DLI-15 | OPEN (low/uncertain) | downloadEntry resolves on writeStream `finish`, not `close` (download.ts:150-166). Post-finish write error window. Speculative. |
| DLI-16 | OPEN (trivial/doc) | Pause/abort two-phase stop — comment exists (manager.ts:117-118) but runner has none; mostly a doc/clarity task. |
| DLI-17 | OPEN | `getInstallState`→`fetchRemoteManifest` on every call, no cache/TTL (manager.ts:194). |
| DLI-18 | OPEN (dup) | Sequential exists/hashFile in `buildPlan` for-loop (plan.ts:63-121). Same fix as 47. |
| DLI-19 | OPEN | `saveLocalManifest` does `fs.rename(tmp,target)` with no `rm(target)` first (manifestRepo.ts:36) — download.ts already fixed this; manifest write did not. |
| DLI-20 | OPEN (low) | `resetTaskForResume` replaces abort+currentRequests with no `currentRequests.size===0` assert (syncState.ts:60-70). |
| DLI-24 | OPEN (dup) | Raw HTTP client in download.ts. Same fix as 6/14. |
| DLI-26 | OPEN | `runDownloadPhase` shared mutable `firstError` + `pendingDownloads.length=0` side-channel; secondary errors swallowed (runner.ts:118-138). |
| DLI-30 | OPEN (dup) | `resolveClientFolder` `\|\| ''` instead of `\|\| null` (manager.ts:383). Same fix as 12. |
| DLI-33 | OPEN | Double OP_IN_FLIGHT check: `activeSyncs.has` (manager.ts:204) + `acquireWriteLock` (386-396), different messages. |
| DLI-34 | OPEN | `resolveClientFolder` calls `getSettings()` singleton each call (manager.ts:382); not injected into ctor. |
| DLI-35 | ALREADY-RESOLVED | Same code as DLI-2: single `finally` release. |
| DLI-40 | OPEN | `tryGetClient` catch-all → null (manager.ts:373-379); `runSync` collapses to UNKNOWN (212). Network errors masked. |
| DLI-41 | OPEN | `executePreparedSync` catch emits to renderer but no `logger.error` for non-aborted failures (manager.ts:326-338). |
| DLI-42 | OPEN (low) | startInstall: lock acquired (manager.ts:127) before `beginInstall`/op.set (132); getStatus sees no op during buildContext window. Cosmetic status flash. |
| DLI-43 | OPEN | `resumeSync` is sync `void`, spawns fresh `startSync` with swallowed `.catch(warn)` (manager.ts:124-141); IPC caller gets no rejection. |
| DLI-44 | OPEN | `saveTargetInstallManifest` writeFile+rename, no try/finally tmp cleanup, no pre-rm (installManifest.ts:107-116). download.ts has the pattern; this doesn't. |
| DLI-45 | OPEN | `PlayButton.tsx` still 343 lines, 11 render branches, no extracted sub-components. `selectPlayButtonAction` covered by playButtonState.test.ts. |
| DLI-47 | OPEN (dup) | Sequential per-file I/O in `buildPlan` (plan.ts). Same fix as 18. |

Counts: OPEN 22 · ALREADY-RESOLVED 3 (DLI-2, 3, 35) · OBSOLETE 0.

## Resolved-since-audit context (not in this group but relevant)
- LocalManifestSchema landed (`@shared/contracts/bundle` LocalManifestSchema; manifestRepo uses safeParse) — closes the 5/9/25/32/38 cluster.
- `flattenRemoteEntries` shared in `manifestUtils.ts` (plan + manifestSnapshot consume it) — closes 13.
- `createThrottledEmitter` in `infra/throttledEmitter.ts` with `dispose: flush` — closes 27/37/48.
- `persistTargetInstallManifest` shared in installManifest.ts with `logPrefix` — closes 21/28.
- cancel()/cancelAll() are switch + `assertNever`, BUNDLE_SYNCING wired — closes 22/23/29/31/36.

---

## Clusters (disjoint file sets where possible; shared hot files flagged)

### CLUSTER http-client-extraction [risk: Medium]
- IDs: DLI-6, DLI-14, DLI-24 (exact duplicates — single fix)
- Files: `src/main/services/bundle/download.ts` (+ removes `currentRequests` from runner.ts/syncState.ts SyncTask)
- Fix: evaluate `FetchHttpClient` from minecraft-kit for streaming-body + per-chunk + AbortSignal cancellation. If sufficient, replace `requestOnce`/`followRedirects` with one fetch piped through the integrity hash and drop the `currentRequests` socket registry. If kit lacks streaming, document as a kit enhancement (edit src→build→copy dist; pinned 0.8.13).
- Effort: large. Packages: minecraft-kit (possible enhancement). New test: integration — redirect chain, timeout, abort mid-stream leaves no tmp, SHA-256 mismatch → DOWNLOAD_INTEGRITY_FAILED.

### CLUSTER plan-concurrency [risk: Low]
- IDs: DLI-18, DLI-47 (exact duplicates — single fix)
- Files: `src/main/services/bundle/plan.ts` (`buildPlan`)
- Fix: replace the sequential `for...of` (exists/hashFile awaits) with bounded-concurrency batching (semaphore/p-limit ~8-16). Each entry's classification is independent; collect then partition into toDownload/toUpdate/toSkip. Keep classification logic identical.
- Effort: small-medium. Packages: none. New test: parallel vs sequential classification identical; timing on 200-entry mock fs.

### CLUSTER atomic-tmp-writes [risk: Medium]
- IDs: DLI-19 (bundle manifest), DLI-44 (target install manifest)
- Files: `src/main/services/bundle/manifestRepo.ts` (saveLocalManifest), `src/main/services/minecraft/installManifest.ts` (saveTargetInstallManifest) — disjoint
- Fix: mirror download.ts: `fs.rm(target,{force:true})` before `fs.rename(tmp,target)`, wrap in try/catch that removes the stray `.tmp` on failure. Optional defensive pre-write tmp removal.
- Effort: trivial each. Packages: none. New test: mock rename throw → tmp unlinked; concurrent read+save → manifest readable.

### CLUSTER resolveClientFolder [risk: Medium]
- IDs: DLI-12, DLI-30 (return type), DLI-34 (DI of settings) — all same symbol
- Files: `src/main/services/bundle/manager.ts` (`resolveClientFolder` + 3 callsites; constructor)
- Fix: change return to `string | null` (`|| null`), update callsites to `=== null` guards (align with readinessPolicy.ts). For DLI-34, inject `getClientFolder: (slug) => string | null` via ctor (wired in bundle/index.ts) to drop the `getSettings()` singleton coupling. 12+30 are the same one-line change; 34 is the deeper DI refactor on the same method.
- Effort: 12/30 trivial; 34 small-medium. Packages: none. New test: returns null on empty setting; injected getClientFolder→null throws NO_CLIENT_FOLDER without module mocks.

### CLUSTER bundle-error-surfacing [risk: Medium]
- IDs: DLI-40 (tryGetClient masks errors), DLI-41 (no logger.error), DLI-43 (resumeSync swallows)
- Files: `src/main/services/bundle/manager.ts` (shared hot file — coordinate as one PR; + bundle IPC route for 43)
- Fix:
  - 40: split tryGetClient — distinguish NotFound (→null) from fetch/network errors (→ MANIFEST_FETCH_FAILED), reserve UNKNOWN for truly unexpected.
  - 41: add `logger.error` for non-aborted/non-paused codes before `emitError`; keep ABORTED+cancelled at info, omit on pause.
  - 43: make `resumeSync` async; when no active sync, `await startSync` and let rejection propagate to the IPC router (make route handler async).
- Effort: 40 small, 41 trivial, 43 small. Packages: none. New tests: network error→MANIFEST_FETCH_FAILED; DOWNLOAD_FAILED→logger.error with slug+code; resumeSync no-active→rejection propagates.

### CLUSTER op-in-flight-dedup [risk: Low]
- IDs: DLI-33
- Files: `src/main/services/bundle/manager.ts` (shared hot file)
- Fix: remove the early `activeSyncs.has` throw in runSync (rely on acquireWriteLock); unify OP_IN_FLIGHT message.
- Effort: trivial. New test: second startSync for same slug throws OP_IN_FLIGHT.

### CLUSTER cross-service-DI [risk: Medium]
- IDs: DLI-4
- Files: `src/main/services/bundle/manager.ts` (getClient/tryGetClient), `src/main/services/minecraft/bundleHealing.ts` (buildContext re-read), wiring in bundle/index.ts
- Fix: inject `getClient` slot into BundleManager ctor; pass `clientFolder`/`target` (or ctx) into the heal function instead of re-`buildContext`. Overlaps manager.ts with DLI-34 (both add ctor injection) — batch with resolveClientFolder DI.
- Effort: medium. New test: injected fake getClient→null throws UNKNOWN without clients-cache mocks.

### CLUSTER kit-version-constant [risk: Low]
- IDs: DLI-7
- Files: `src/main/services/minecraft/installManifest.ts`
- Fix: prefer a kit-exported version constant if available; else read kit version from launcher package.json `dependencies` inlined via electron-vite `define`, dropping runtime `createRequire`.
- Effort: small. Packages: minecraft-kit (only if a version export is added). Test: none required.

### CLUSTER runner-structured-concurrency [risk: Medium]
- IDs: DLI-26
- Files: `src/main/services/bundle/runner.ts` (`runDownloadPhase`)
- Fix: replace shared mutable `firstError` + array-truncation side-channel with an AbortController workers abort on first failure; log secondary errors at debug; rethrow primary after Promise.all. Gate any queue truncation on `signal.aborted`.
- Effort: small-medium. New test: two concurrent failures → one propagates, signal aborted, others exit clean.

### CLUSTER getInstallState-cache [risk: Medium]
- IDs: DLI-17
- Files: `src/main/services/bundle/manager.ts` (getInstallState) / `bundle/api.ts`
- Fix: cache manifestHash per bundleSlug with short TTL (~30s), or move drift-check to a background poll; minecraft-kit `createMemoryCache` available.
- Effort: small-medium. New test: 2nd call within TTL doesn't re-fetch; after TTL re-fetches.

### CLUSTER playbutton-split [risk: Medium]
- IDs: DLI-45
- Files: `src/renderer/features/clients/components/PlayButton.tsx` (+ new sibling components)
- Fix: keep PlayButton as orchestration; extract BundleErrorView / BundleUpdateButton / InstallButton / ErrorRetryView. `selectPlayButtonAction` already unit-covered.
- Effort: medium. New test: existing playButtonState.test.ts covers action selection; add per-view render tests if desired.

### Standalone / low-priority OPEN (no shared fix)
- DLI-11 [Low, trivial] manager.ts persistLocalManifest empty-guard — fragility only.
- DLI-15 [Low, uncertain] download.ts finish-vs-close — speculative Windows edge; verify before acting.
- DLI-16 [Low, trivial/doc] runner.ts pause comment — clarity only.
- DLI-20 [Low, trivial] syncState.ts resetTaskForResume assert — minor leak guard.
- DLI-42 [Low] minecraft/manager.ts startInstall op-registration race — cosmetic status flash; fix by emitting INSTALLING / registering placeholder op before buildContext.

## Duplicate-fix flags (do once)
- 6 ≡ 14 ≡ 24 (HTTP client)
- 18 ≡ 47 (plan concurrency)
- 12 ≡ 30 (resolveClientFolder null), 34 same method (DI)
- 2 ≡ 35 (≡ resolved 39/46/63/81) — already done

## Shared-hot-file coordination
`bundle/manager.ts` is touched by DLI-4, 11, 12, 17, 30, 33, 34, 40, 41, 43 — sequence these (suggest one PR per cluster: error-surfacing → op-in-flight-dedup → resolveClientFolder+DI+cross-service) to avoid merge churn. `plan.ts` only by 18/47 (single fix). `download.ts` only by 6/14/15/24.
