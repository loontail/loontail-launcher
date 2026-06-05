# LAU group triage — launch + console flow

Scope: LAU-4..8, 12..16, 20, 22, 23, 25, 26, 27, 29..33.
Read-only audit. Line numbers below are *current* `src/**`, not the backlog's stale numbers.
The launch flow has been substantially refactored since the audit was written: `broadcaster.log` / `minecraft.log`
is gone, the console hub is a factory-injected port (no module singleton), classpath preflight is parallel,
exit-code threading and log4j flush-on-exit landed. Many tasks are therefore already-resolved or obsolete.

## Classification table

| ID | Verdict | Evidence |
|----|---------|----------|
| LAU-4 | OBSOLETE | `minecraft.log` / `broadcaster.log` removed (LAU-11 DONE). `broadcast.ts` has only status/progress/error; `recordMinecraft` is unconditional. No conditional contract channel remains. |
| LAU-5 | ALREADY-RESOLVED | `ConsoleWindowSink.send` (consoleWindowSink.ts:26-34) already guards `getWindow()` (null + `isDestroyed()`) and wraps `webContents.send` in try/catch. `flushPending` cannot throw on a torn-down window. |
| LAU-6 | OBSOLETE | `routes.ts` no longer imports `getStoredAccount`; the launch route is a thin slug parser and account resolution moved to `MinecraftManager` via injected `AccountProvider` (manager.ts:55,69,254). `getStoredAccount` (auth.ts:75) is still used by `resolveLaunchAuth` indirectly, but the cross-service-route coupling the task describes is gone. |
| LAU-7 | OPEN | `YggdrasilProfileSchema.uuid` (shared/contracts/auth.ts:79) is `z.string().refine(isUuidUndashed)` — plain `string`, no brand. launch.ts:291 must `asPlayerUuid(dashUuid(session.profile.uuid))`; nothing compile-time forces the `dashUuid`. |
| LAU-8 | OPEN (residual / doc-only) | bundle/manager.ts:97-110: `removeEventListener` runs in `finally` *after* `runSync` returns; `dropActiveSync` clears `activeSyncs` inside `runSync`. `cancelSync` is guarded on missing slug, so no crash — purely a documented ordering dependency. `managerSyncForLaunchSignal.test.ts` covers abort-already + mid-flight, not the completion race. |
| LAU-12 | OPEN | launch.ts:431-455 generic catch re-`throw error` at line 455 after `emitError`+`emitState`+status restore. router.ts catches and rejects the IPC → renderer gets both a pushed error event and an IPC rejection → double toast. |
| LAU-13 | OPEN | `verifyLaunchPreflight` (launch.ts:152-202) still calls `resolveLaunchVersion(ctx.target)` at line 164 even though `compose()` already resolved+gated it. Version-jar check (line 175) uses `ctx.target.minecraft.version` (vanilla) not the resolved `versionId`, so for modloaders it verifies the vanilla jar, not the patched/loader jar. |
| LAU-14 | OBSOLETE | `consoleEnabled` field already removed from `LaunchOp` (ops.ts:39-42). The setting is read fresh per-launch at launch.ts:364 and gates only `env.openConsole()` at call time — no stale snapshot in the op. |
| LAU-15 | OPEN | `guessLevel` (consoleHub.ts:26-33) compiles three regex literals inline on every text-line ingest. `ANSI_ESCAPE_PATTERN` already hoisted; the level regexes are not. |
| LAU-16 | OPEN | `resolveAuthlibInjectorJar` (launch.ts:86-95) hand-builds `authlib-injector-${AUTHLIB_INJECTOR_VERSION}.jar`. yggdrasil-client (`dist/index.d.ts`) exports `resolveAuthlibInjectorJarPath` + `AUTHLIB_INJECTOR_VERSION` but **no** `getAuthlibInjectorJarName()`. Filename template duplicated. |
| LAU-20 | ALREADY-RESOLVED | consoleHub.ts:242 exports `createConsoleHub()` factory; class has no module-level singleton instance. Injected as `ConsolePort` (env.ts:14-17) into `MinecraftManager`. launch.ts uses `env.console.*` exclusively — no direct hub import. |
| LAU-22 | OPEN | `isAnythingInstalled` (runtimeState.ts:9-29) still walks version dirs with a sequential `await fs.access` in a `for…of` loop (lines 18-27). Called by `resolveClientInstallPresence` (readinessPolicy.ts:25) on every open-status poll. |
| LAU-23 | OPEN | `Context.resolved` (context.ts:22) is still `ReturnType<typeof resolveClientSettings>` — full settings object exposed to all consumers. Consumers only use `storage.clientFolder/clientsFolder`, `memory.allocatedRamMb`, `launch.fullscreen/console`. |
| LAU-25 | ALREADY-RESOLVED | `managerCancel.test.ts:65-76` `it.each([REPAIR, BUNDLE_SYNCING, LAUNCH_STARTING])` asserts `abort.signal.aborted`. `cancelAll` BUNDLE_SYNCING covered at lines 98-107. |
| LAU-26 | OPEN | `sanitizeHttpAgentToken` (launch.ts:78-81) not exported; only exercised via the `'0.0.0-test'` integration path (launch.test.ts:517). The disallowed-char→`'dev'` fallback branch is untested. |
| LAU-27 | OPEN | `YGGDRASIL_HTTP_AGENT_NAME='LoontailLauncher'` (launch.ts:47) is a hardcoded brand literal; regex `/[^0-9A-Za-z.+_-]/g` (line 79) is an unnamed magic literal. No shared `brand.ts` constant. (Pairs with LAU-26.) |
| LAU-29 | ALREADY-RESOLVED (residual nil) | The described leak is closed: the session is launched with `signal: startupSignal` (launch.ts:375); aborting fires `LAUNCH_ABORTED` → `session.exited` settles → `endLaunch` runs `env.ops.delete(slug)` (launch.ts:220) unconditionally, clearing the LAUNCH op. The pre-set abort check (lines 406-409) handles abort-before-set. No path leaves a LAUNCH op wedged. |
| LAU-30 | OPEN | manager.ts:95-97 still has `// Called once at boot (after createBundleService)…` caller-reference comment above `attachLaunchHook`. |
| LAU-31 | OPEN | bundle/manager.ts:93-96 still has `// Called by MinecraftManager.startLaunch after the install step…` caller-reference comment above `syncForLaunch`. |
| LAU-32 | OPEN | launch.ts:61-68 `toComposeFailure` comment is 8 lines, mixes valuable why (compose reads only disk) with what-narration ("Non-kit errors pass through…"). |
| LAU-33 | OPEN | manager.ts:256-265: the "No pre-launch hash verification…" block (256-259) is what-narration; the BundleSyncingOp clause (263-265) is a genuine why. Trim to the cancel-abort invariant. |

Counts: OPEN 11 (LAU-7,8,12,13,15,16,22,23,26,27,30,31,32,33 → note LAU-8 is doc-only residual). ALREADY-RESOLVED 4 (LAU-5,20,25,29). OBSOLETE 3 (LAU-4,6,14).
Strictly-open actionable: **13** (LAU-7,12,13,15,16,22,23,26,27,30,31,32,33) + 1 doc-residual (LAU-8).

---

## Clusters (disjoint file sets where possible)

### CLUSTER A — launch.ts hot path (correctness) [risk: medium]
IDs: LAU-12, LAU-13
Files: `src/main/services/minecraft/launch.ts` (+ `src/main/ipc/router.ts` read-only for LAU-12 reasoning)
Shared hot file: launch.ts.
- **LAU-12** (Risk med, Effort trivial): in the generic catch (launch.ts:455) `return` instead of `throw`. The error is already pushed via `emitError`; the IPC rejection is redundant and double-toasts. New test: integration — assert one `broadcaster.error` and IPC resolves. Packages: none.
- **LAU-13** (Risk med, Effort medium): thread the `LaunchComposition` already produced by `compose()` into `verifyLaunchPreflight`; drop the redundant `resolveLaunchVersion` call (line 164) and fix the version-jar check to use the resolved `versionId` / first classpath entry rather than `ctx.target.minecraft.version` (currently verifies the wrong jar for Fabric/Forge). New test: Fabric/Forge fixture where vanilla jar present but loader jar missing → expect NOT_INSTALLED. Packages: none (may need kit's composition to expose `versionId`; verify before scheduling — could bump to "large" if kit change needed).

### CLUSTER B — launch.ts HTTP-agent / authlib extraction [risk: low]
IDs: LAU-16, LAU-26, LAU-27
Files: `src/main/services/minecraft/launch.ts`, `tests/main/services/minecraft/launch.test.ts`, `src/shared/constants/brand.ts` (new/edit), **package** `loontail-yggdrasil/yggdrasil-client` (LAU-16 only)
Shared hot file: launch.ts (overlaps Cluster A — sequence after A or coordinate edits).
- **LAU-26** (Risk low, Effort trivial): export `sanitizeHttpAgentToken`; add 2 unit tests (normal string; all-disallowed → `'dev'`). New test: yes. Packages: none.
- **LAU-27** (Risk low, Effort small): move `YGGDRASIL_HTTP_AGENT_NAME` into `src/shared/constants/brand.ts` (alongside `APP_NAME`); name the regex with an RFC 7231 §3.3.1 `// why`. Packages: none.
- **LAU-16** (Risk low, Effort small): add `getAuthlibInjectorJarName()` to yggdrasil-client; launcher composes only the resources dir + canonical filename. Packages: **loontail-yggdrasil** (edit yggdrasil-client src, build, copy dist into launcher node_modules OR republish + bump pinned version + refresh lockfile). New test: optional.

### CLUSTER C — console hub perf [risk: low]
IDs: LAU-15
Files: `src/main/infra/consoleHub.ts`
Disjoint.
- **LAU-15** (Risk low, Effort trivial): hoist the three `guessLevel` regexes to module-level constants (mirror `ANSI_ESCAPE_PATTERN`). Packages: none. New test: no.

### CLUSTER D — install-presence / context perf+shape [risk: low]
IDs: LAU-22, LAU-23
Files: `src/main/services/minecraft/runtimeState.ts` (LAU-22), `src/main/services/minecraft/context.ts` (LAU-23)
Disjoint from each other and from launch.ts.
- **LAU-22** (Risk low, Effort small): parallelise `isAnythingInstalled` version-dir checks with `Promise.any` (short-circuit on first hit; all-reject → false). Watch the empty-dir case (`Promise.any` over [] throws — guard). New test: dir with 10 entries, entry 5 matches → true. Packages: none.
- **LAU-23** (Risk low, Effort small): narrow `Context.resolved` to an explicit inline type (`storage:{clientFolder,clientsFolder}; memory:{allocatedRamMb}; launch:{fullscreen,console}`); populate in `buildContext`. Compiler-enforced; audit install/launch/repair/repairWorkflow consumers. Packages: none. New test: none (tsc).

### CLUSTER E — yggdrasil uuid brand [risk: low]
IDs: LAU-7
Files: `src/shared/contracts/auth.ts`, `src/main/services/minecraft/launch.ts` (call site 291), **package** `loontail-yggdrasil/yggdrasil-core` (add `UndashUuid` brand + `asUndashUuid`)
Shared hot file: launch.ts (overlaps A/B at the call site only — single line).
- **LAU-7** (Risk low, Effort medium): introduce `UndashUuid` brand in yggdrasil-core, apply as transform output of `YggdrasilProfileSchema.uuid`; launch path then gets a compile-time reminder that `dashUuid` precedes `asPlayerUuid`. Packages: **loontail-yggdrasil** (build + copy dist / republish + lockfile). New test: type-level negative-assignability check.

### CLUSTER F — comment cleanup (§10) [risk: low]
IDs: LAU-30, LAU-31, LAU-32, LAU-33
Files: `src/main/services/minecraft/manager.ts` (LAU-30, LAU-33), `src/main/services/bundle/manager.ts` (LAU-31), `src/main/services/minecraft/launch.ts` (LAU-32)
Shared hot file: launch.ts (LAU-32 overlaps A/B/E — coordinate or do comment edits last).
All Risk low, Effort trivial, no packages, no tests. Pure comment trims removing caller-reference / what-narration per §10. manager.ts is shared between LAU-30 and LAU-33 (do together).

### CLUSTER G — bundle sync ordering (doc-residual) [risk: low]
IDs: LAU-8
Files: `src/main/services/bundle/manager.ts`
Overlaps Cluster F on bundle/manager.ts (LAU-31). Do with F.
- **LAU-8** (Risk low, Effort trivial): no functional bug (guards already safe). Either add a one-line `// why` documenting the removeEventListener-before-cleanup ordering, or refactor to `AbortSignal.any([task.abort.signal, externalSignal])`. Recommend the comment; the refactor is gold-plating.

---

## Shared-file map (scheduling guidance)
- **launch.ts** is touched by Clusters A (12,13), B (16,26,27), E (7 call site), F (32). Heavily hot — serialise these or assign to one owner. Suggested order: A (correctness) → B → E call site → F (comment trim last).
- **manager.ts** (minecraft): LAU-30 + LAU-33 — one edit pass.
- **bundle/manager.ts**: LAU-31 + LAU-8 — one edit pass.
- Clusters C (consoleHub), D (runtimeState + context) are fully disjoint and parallelisable.
- **Packages touched**: LAU-16 (yggdrasil-client), LAU-7 (yggdrasil-core). Both need build + dist-copy/republish + lockfile refresh — batch them into a single yggdrasil monorepo PR to amortise the build/copy cost.

## Duplicate / superseded notes
- LAU-17/18/21/24/28 (classpath perf + empty-entry guard) all DONE (commit f7c223f) — `verifyLaunchPreflight` is already `Promise.all` with empty-array and empty-string guards (launch.ts:180-201); launch.test.ts:394-440 covers both empty-classpath and empty-string-entry branches. LAU-24's empty-classpath test gap is closed.
- LAU-09/10/19 (exit code, log4j flush, abort mis-classify) DONE — `launchExitCode`, `endSession`, and `exit.aborted` threading all present (launch.ts:207-252, consoleHub.ts:150-153).
- LAU-11 DONE removed the dead channel that LAU-4/14 depended on → those became obsolete.
- LAU-25 closed by `managerCancel.test.ts` (post-dates the audit).
