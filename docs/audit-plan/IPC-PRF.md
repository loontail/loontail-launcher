# IPC / PRF triage (audit group: IPC-02..09, PRF-01, PRF-02)

Read-only triage of the backlog group. IDs in the backlog use two-digit form
(IPC-02 = "IPC-2", PRF-01 = "PRF-1"). IPC-01 is already marked DONE (commit
58f373e) and introduced `assertNoIpcArgs`; it is referenced for context only.

## Verdicts

| ID | Verdict | One-line basis |
|----|---------|----------------|
| IPC-02 | OPEN | `trustedSender.ts:51` still uses `channel.startsWith(CONSOLE_CHANNEL_PREFIX)` prefix grant. |
| IPC-03 | OPEN | `bundle/manager.ts:194` `fetchRemoteManifest` network call still inside `getInstallState`, reached by the `bundle.checkStatus` handler. |
| IPC-04 | OPEN | `SLUG_REQUIRED` literal still duplicated in minecraft/bundle/settings routes (and an unlisted 4th: see note). |
| IPC-05 | OPEN (premise weakened) | `errors.ts:2` `code: string` still loose; but the cited renderer `IPC_LOGIN_ERROR_CODES` map no longer exists. Low value. |
| IPC-06 | OPEN (partial) | `minecraft/routes.test.ts` exists but only tests error reclassification — no Zod/arg-routing assertions; no `bundle/routes.test.ts` at all. |
| IPC-07 | OPEN | No `tests/main/services/settings/routes.test.ts`. |
| IPC-08 | OPEN | `schemas.test.ts` has no `PatchLauncherSettingsSchema` `.strict()` case. |
| IPC-09 | OPEN | No test pins IpcContract → registered-handler coverage. |
| PRF-01 | OBSOLETE | `resolveClientInstallPresence` no longer calls `targetInstallManifestMatches`; the INSTALLED→UNVERIFIED-on-kit-bump scenario cannot occur. Already documented. |
| PRF-02 | ALREADY-RESOLVED | `readinessPolicy.test.ts:62-67` already covers UNVERIFIED (files present, manifest null). |

Counts: **OPEN 7**, **ALREADY-RESOLVED 1** (PRF-02), **OBSOLETE 1** (PRF-01).
(IPC-05 counted OPEN but flagged low-value / premise weakened.)

---

## OBSOLETE / RESOLVED detail

### PRF-01 — OBSOLETE
- `src/main/services/minecraft/readinessPolicy.ts:20-29`: presence check is
  `manifest !== null ? INSTALLED : UNVERIFIED`. It never calls
  `targetInstallManifestMatches`, so a `kitVersion` bump does NOT flip an
  existing install to UNVERIFIED at open.
- The lines 12-19 comment already documents the intent ("A Strapi version bump
  is therefore not detected at open … surfaces at Play").
- `targetInstallManifestMatches` (`installManifest.ts:151-162`) still includes
  `kitVersion`, but it is only used by `hasCurrentTargetInstallManifest`, which
  is on the Play/verify path, not the open/seed path. The backlog's described
  failure mode is architecturally gone. No action.

### PRF-02 — ALREADY-RESOLVED
- `tests/main/services/minecraft/readinessPolicy.test.ts:62-67` asserts
  `loadTargetInstallManifest=null` + `isAnythingInstalled=true` → `UNVERIFIED`.
  The requested coverage exists. No action.

---

## OPEN detail

### IPC-02 — explicit console-channel allowlist
- File/symbol: `src/main/ipc/trustedSender.ts:51`; `src/shared/ipc/channels.ts:55`
  (`CONSOLE_CHANNEL_PREFIX`).
- Fix: replace the prefix test with a `Set` of the four console channels
  (`consoleGetInitial`, `consoleClear`, `consoleCopyAll`, `consoleCopyText`)
  built from `IPC_CHANNELS`; drop/retire `CONSOLE_CHANNEL_PREFIX`.
- Risk Low · Effort small · packages none · new test: yes (per-channel: console
  sender allowed only the four, rejected otherwise).

### IPC-03 — thin `bundle.checkStatus` route
- File/symbol: `src/main/services/bundle/manager.ts:185-199` (`getInstallState`
  drift block), `src/main/services/bundle/routes.ts:31-34`.
- Fix: have `getInstallState` return local/cached state synchronously and move
  the `fetchRemoteManifest` drift check into a background method that pushes
  `IPC_EVENTS.bundleStatus` on drift.
- Risk Med (touches live sync/notify flow) · Effort medium · packages none ·
  new test: yes (getInstallState returns without network; slow network does not
  block the handler).

### IPC-04 — dedupe `SLUG_REQUIRED`
- File/symbol: `minecraft/routes.ts:10`, `bundle/routes.ts:8`,
  `settings/routes.ts:18`. NOTE: backlog cites three files; the literal is the
  same `'slug must be a non-empty string'` in all three. (No 4th occurrence
  found — `clients/servers/skin` routes do not redefine it.)
- Fix: export `SLUG_REQUIRED_MSG` from `src/main/ipc/parseArgs.ts` (or a new
  `errorMessages.ts`) and import at the three callsites.
- Risk Low · Effort trivial · packages none · new test: no (covered by existing
  validation tests).

### IPC-05 — type `IpcError.code` (low value)
- File/symbol: `src/shared/ipc/errors.ts:2` (`code: string`); domain unions live
  in `errorCodes.ts` (`ErrorCode`), `minecraft.ts:54` (`MinecraftErrorCode`),
  `bundle.ts:52` (`BundleErrorCode`). No `SkinErrorCode` union exists (skin codes
  are in `ERROR_CODES`).
- Premise note: the cited renderer `IPC_LOGIN_ERROR_CODES`
  `Partial<Record<string,…>>` switch is GONE — `auth/hooks.ts:17`
  `loginErrorCodeFromRejection` branches on `TypeError`, not `ipcError.code`. The
  motivating unsafe call site no longer exists.
- Fix (if pursued): add `IpcErrorCode = ErrorCode | MinecraftErrorCode |
  BundleErrorCode` and type `IpcError.code` as it; keep `isIpcError`'s runtime
  shape check loose. Watch transport round-trip (`tryUnwrapIpcError`) — a closed
  union must still tolerate forward-added codes at runtime.
- Risk Med (shared type touched by main+renderer+preload) · Effort small ·
  packages none · new test: a tsc regression case. Recommend DEFER/close as
  low-value given the call site is gone.

### IPC-06 — route tests for minecraft + bundle
- File/symbol: `src/main/services/minecraft/routes.ts`,
  `src/main/services/bundle/routes.ts`. Existing
  `tests/main/services/minecraft/routes.test.ts` only covers kit-error
  reclassification (no Zod/arg-routing). No bundle routes test exists.
- Fix: extend the minecraft test (valid args reach the right manager method;
  invalid args throw `IPC_INVALID_ARGS` without calling the manager) and add
  `tests/main/services/bundle/routes.test.ts` (BundleStartRequestSchema +
  slug-only routes). Reuse the `createTestRouter` pattern from
  `system/routes.test.ts:59`.
- Risk Low · Effort medium · packages none · new test: yes (the deliverable).

### IPC-07 — route tests for settings
- File/symbol: `src/main/services/settings/routes.ts`.
- Fix: add `tests/main/services/settings/routes.test.ts` — valid
  PatchLauncherSettings reaches `patchLauncherSettings`; extra field throws
  IpcInvalidArgs; SetClientOverridePayload parses slug+patch; bad slug rejects.
  Mock `@main/services/settings/settings`.
- Risk Low · Effort small · packages none · new test: yes (the deliverable).

### IPC-08 — strictness test for PatchLauncherSettingsSchema
- File/symbol: `src/shared/contracts/settings.ts:93-99` (`.strict()`);
  `tests/shared/contracts/schemas.test.ts`.
- Fix: add two cases to `schemas.test.ts` — accepts a valid partial patch;
  rejects an object with an extra key.
- Risk Low · Effort trivial · packages none · new test: yes (the deliverable).

### IPC-09 — compile/runtime IpcContract handler-coverage test
- File/symbol: `src/shared/ipc/contract.ts` (IpcContract), all
  `src/main/services/*/routes.ts` registrars (`registerMinecraftRoutes`,
  `registerBundleRoutes`, `registerSettingsRoutes`, `registerSystemRoutes`,
  plus auth/app/media/clients/servers/skin/console). The compile-time
  `IpcChannelsCoverContract` guard in `channels.ts` only pins IPC_CHANNELS ↔
  IpcContract, NOT that a handler is registered.
- Fix: add a test that registers every routes function against a recording
  router and asserts the union of registered channels equals `Object.keys` of an
  IPC_CHANNELS-derived set. Some registrars need managers/windows — mock them.
- Risk Low · Effort medium (must wire/mock every registrar) · packages none ·
  new test: yes (the deliverable).

---

## Clusters (disjoint file sets)

### CLUSTER security-trust [Low] — IDs=[IPC-02]
- Files: `src/main/ipc/trustedSender.ts`, `src/shared/ipc/channels.ts`,
  + new `tests/main/ipc/trustedSender.test.ts`.
- Effort: small. Isolated; no file overlap with other clusters.

### CLUSTER bundle-thin-route [Med] — IDs=[IPC-03]
- Files: `src/main/services/bundle/manager.ts`,
  `src/main/services/bundle/routes.ts`, + new
  `tests/main/services/bundle/routes.test.ts` (drift/no-block assertions).
- Effort: medium. SHARED FILE with IPC-06 cluster:
  `src/main/services/bundle/routes.ts` and `tests/.../bundle/routes.test.ts`.
  Sequence IPC-03 (behavior change) before/with IPC-06 (route tests) to avoid
  rebasing the new bundle test.

### CLUSTER msg-dedup [Low] — IDs=[IPC-04]
- Files: `src/main/ipc/parseArgs.ts` (add export),
  `src/main/services/minecraft/routes.ts`,
  `src/main/services/bundle/routes.ts`,
  `src/main/services/settings/routes.ts`.
- Effort: trivial. SHARED FILES with IPC-06 (minecraft+bundle routes) and IPC-07
  (settings routes) — but it only changes the constant import, so apply it first
  (or fold into those clusters) to minimize churn.

### CLUSTER ipc-error-typing [Med] — IDs=[IPC-05]
- Files: `src/shared/ipc/errors.ts` (+ optional new `IpcErrorCode` alias);
  touches main/renderer/preload via the shared type.
- Effort: small. DEFER recommended (motivating call site removed). Disjoint from
  other clusters except its shared-type blast radius.

### CLUSTER route-tests [Low] — IDs=[IPC-06, IPC-07, IPC-08, IPC-09]
- Files (mostly new test files):
  - IPC-06: `tests/main/services/minecraft/routes.test.ts` (extend),
    `tests/main/services/bundle/routes.test.ts` (new).
  - IPC-07: `tests/main/services/settings/routes.test.ts` (new).
  - IPC-08: `tests/shared/contracts/schemas.test.ts` (extend).
  - IPC-09: new contract-coverage test (e.g. `tests/main/ipc/contractCoverage.test.ts`).
  - Shared reference (read-only): `tests/main/services/system/routes.test.ts`
    `createTestRouter` pattern.
- Effort: medium (mostly additive; no production-code edits except whatever
  IPC-04 import change lands). SHARED FILE caveat: IPC-06's bundle test overlaps
  IPC-03's cluster (see above).

Cross-cluster shared production files:
`bundle/routes.ts` (IPC-03, IPC-04, IPC-06-test), the three `routes.ts`
files (IPC-04 vs IPC-06/07 tests). Land IPC-04 first, then IPC-03, then the
test cluster.
