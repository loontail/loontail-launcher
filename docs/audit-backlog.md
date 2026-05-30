# Engineering Audit Backlog — @loontail/minecraft-launcher

> Generated from a 12-area deep audit (each finding adversarially verified against the code at `file:line`).
> Scope: `loontail-launcher` measured against `docs/architecture.md`, `docs/code-guideline.md`, `docs/ui-guideline.md`,
> and the public APIs of `@loontail/minecraft-kit` and `@loontail/yggdrasil-core` / `-client`.
> This is a **backlog to execute in stages** — it is not a request to rewrite the project at once.

**Totals:** 156 tasks — P0: 4 · P1: 30 · P2: 65 · P3: 57. Touch `minecraft-kit`: 12. Touch `yggdrasil`: 2.

## 1. Executive summary

1. The launcher is a **mature, carefully-engineered codebase** that closely follows its own documented architecture. This audit produced **156 verified findings** (P0: 4, P1: 30, P2: 65, P3: 57) across 12 areas; an adversarial verification pass corrected or down-scoped ~45 of them and rejected 2 as inaccurate. The defects are concentrated, not systemic.
2. The **4 P0s cluster on the IPC error boundary**: thrown `Error` subclasses lose their `message` through `JSON.stringify` (router `normalizeError`), domain error codes are rejected by `isIpcError`’s closed registry, and a bundle download promise can never settle when the abort signal is already set (leaking the operation lock). Together these surface common failures (double-click `OP_IN_FLIGHT`, skin-upload errors) to the user as opaque `[object Object]`.
3. The **error model is fragmented**: four parallel, inconsistently-cased code vocabularies (`ERROR_CODES`, `BundleErrorCodes`, `MinecraftErrorCodes`, `LOGIN_ERROR_CODE`) cross the same bridge with no single `toIpcError()` boundary — the structural root cause of the P0s.
4. Layer boundaries are real but **enforced only by tsconfig path separation plus convention**: Biome has no import-restriction rules, and `architecture.md` both overstates enforcement and is stale (it omits the shipping `bundle` service and references a non-existent `services/launch/`).
5. Two genuine cross-service hazards: a **`bundle` ↔ `minecraft` circular import**, and a **P0-class operation-lock footgun** where the shared lock registry is defaulted to a fresh instance in four places, so a future wiring slip silently disables cross-domain mutual exclusion.
6. **Single-source-of-truth duplication** is the largest quick-win class: status/code unions are hand-mirrored next to their Zod enums (5 pairs), `ErrorCode` / `StrapiList` / `Client` types duplicate their schemas, and the guideline-mandated `BundleSlug` brand is missing.
7. The two consumed packages are **under-leveraged**: the launcher re-implements file hashing (3×), Forge-processor-output healing (reverse-engineering kit internals), launch preflight (vs `kit.verify.targetReady`), a repair progress adapter (vs `createInstallProgressTracker`), cooperative pause (vs `PauseController`), and PNG/skin + authlib/uuid helpers that `yggdrasil-core`/`-client` already export.
8. The **renderer is well-structured** but drifts from `ui-guideline.md`: icon `size=` props instead of `size-N`, off-token radii (`rounded-xl/2xl`), arbitrary `text-[Npx]`, one raw `rgba()`; and the largest components (`PlayButton` 343L, `ClientSettingsModal`, `FolderInfoBlock` with 14 props) carry controller logic that belongs in hooks.
9. **Test gaps sit on the most failure-prone logic**: auth verify/refresh state machines, the schema-migration gap-throw, the `bundleHealing` ownership filter (data-loss-adjacent), the updater FSM, and pure domain units (`resolveLoader`, `accountFromSession`).
10. **Comment hygiene was already ~95% compliant** with §10 — only ~10 genuinely meaningless lines existed (now removed) amid dense, high-value "why" comments. The real risk was a future blind sweep destroying institutional knowledge, addressed by reinforcing guideline §10 with explicit FORBIDDEN/KEEP examples (already applied).

## 2. How to read a task

Each task carries: **Category** (architecture / code / flow / performance / testing / UI / IPC / error-handling / dependency-extraction / docs), **Priority** (P0 critical → P3 minor), **Effort** (quick = near-zero risk / medium = needs tests / large = careful architectural change), **Change risk** (risk *of making* the change), **Flow** group, **Area** (`file:line`), **Problem / Why / Solution**, whether it **touches packages** (and the required dist rebuild), and the **tests** that would lock it.

## 3. Priority index

### P0 — fix first (correctness / data-loss / boundary breakage)

- [LL-004](#ll-004) — Shared operation-lock registry is defaulted to a fresh instance in four places — silent loss of cross-domain mutual exclusion
- [LL-090](#ll-090) — IpcError JSON.stringify drops `message` for every thrown Error subclass (SkinError/ManagerError/BundleError)
- [LL-091](#ll-091) — Domain error codes (MinecraftErrorCodes/BundleErrorCodes) thrown to IPC are rejected by isIpcError — disjoint code namespaces
- [LL-106](#ll-106) — Bundle download promise never settles when signal is already aborted

### P1 — high value

- [LL-001](#ll-001) — Shell-redirect junk files litter repo root and minecraft-kit root; .gitignore does not guard them
- [LL-002](#ll-002) — Layer boundaries are not lint-enforced; architecture doc overstates enforcement
- [LL-003](#ll-003) — Bundle and Minecraft services have a module-level circular dependency
- [LL-006](#ll-006) — Architecture doc is significantly out of date: bundle service undocumented, non-existent launch service still described
- [LL-015](#ll-015) — normalizeError leaks non-ERROR_CODES error shapes (incl. MinecraftKitError) across the bridge
- [LL-016](#ll-016) — Console window gets full IPC privilege via trusted-sender check despite being sandbox:false
- [LL-017](#ll-017) — Router validates args by cast only — Zod parsing is opt-in per handler, not enforced by the contract
- [LL-028](#ll-028) — Write lock can leak on synchronous throw between acquireWriteLock and executePreparedSync
- [LL-029](#ll-029) — Download phase has no per-file retry — one transient 5xx aborts the whole sync
- [LL-030](#ll-030) — Resume never refreshes the remote manifest or its hash — persists a possibly stale signature
- [LL-044](#ll-044) — Repair progress adapter re-implements kit's createInstallProgressTracker by hand
- [LL-045](#ll-045) — Manual launch preflight file-walk duplicates kit.verify.targetReady
- [LL-046](#ll-046) — Forge processor healing reaches into kit-internal action shapes (InstallActionKinds, RunForgeProcessorAction.outputs) and re-hashes by hand
- [LL-047](#ll-047) — Kit coupling surface is unbounded — no adapter narrows kit-internal contracts behind services/kit.ts
- [LL-060](#ll-060) — Successful token refresh demoted to forced logout when the trailing safeStorage write throws
- [LL-075](#ll-075) — PlayButton.tsx (343L) bundles the whole install/launch/repair UI state machine with rendering and five mutations
- [LL-092](#ll-092) — No unified toIpcError(): five parallel error models and ad-hoc per-call translation
- [LL-094](#ll-094) — IPC router logs EVERY handler failure at logger.error, including expected/recoverable ones
- [LL-098](#ll-098) — isIpcError gates on a closed ERROR_CODES registry, so any new IpcError code from main is silently dropped at the preload
- [LL-108](#ll-108) — getFolderSize walks the entire client tree (tens of thousands of stats) on every IPC call
- [LL-120](#ll-120) — updater fsm untested
- [LL-121](#ll-121) — verifySession untested
- [LL-122](#ll-122) — auth refresh untested
- [LL-123](#ll-123) — MIGRATIONS gap-throw untested
- [LL-126](#ll-126) — Forge-processor output healing is generic kit logic re-implemented in the launcher
- [LL-135](#ll-135) — BundleSlug brand never defined — bundle slugs flow as raw string
- [LL-136](#ll-136) — Status/code enums list every member twice (as const + parallel z.enum) — silent drift
- [LL-142](#ll-142) — Pure domain units resolveLoader and accountFromSession have no tests
- [LL-155](#ll-155) — Representative KEEP set — non-obvious 'why' comments the cleanup must NOT strip
- [LL-156](#ll-156) — Reinforce code-guideline §10 + strip meaningless comments repo-wide

## 4. Backlog by area

### Architecture, layer boundaries & file organization

<a id="ll-001"></a>
#### LL-001 · Shell-redirect junk files litter repo root and minecraft-kit root; .gitignore does not guard them

- **Category:** code · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** e:\workspace\elixir\loontail-launcher\ root (13 zero-byte untracked files: '({,', '({,-', ',+', '[A-Z][a-z]+', '[result.kind', 'fs.rm(dir', 's.key', 'stage', 'undefined)', 'version', '{,', '{,+', '{,-'); e:\workspace\elixir\minecraft-kit\ root (7 files: 'a.kind', 'e.type', 'i.path', 'result.kind', 'verification.isValid)', '{,', '{,-'); .gitignore
- **Problem:** Zero-byte files with names like '({,', 'fs.rm(dir', '[result.kind', 'undefined)' sit at the launcher repo root, and seven more at the minecraft-kit root. They are shell-redirect artifacts (a stray `> ({,` etc. from copy-pasted command fragments). All are untracked (git status shows them as '??'), so they permanently pollute `git status`, risk being accidentally `git add .`-ed into a commit, and clutter the working tree. The .gitignore (node_modules/out/dist/build/*.log/*.tsbuildinfo/.env) has no rule that would catch these names.
- **Why it matters:** Untracked garbage in the working root erodes trust in `git status`/`git add .`, and a name like 'fs.rm(dir' getting committed would be embarrassing and confusing. The same pattern recurring in two sibling repos shows it is a repeated accident, not a one-off.
- **Proposed solution:** Delete the junk files from both roots (`git clean -n` to preview, then remove the specific paths; do NOT blanket `git clean -fdx` which would nuke node_modules/out). Add a guard to .gitignore at both repos. Optionally add a pre-commit/CI check that fails if a tracked path matches `^[^a-zA-Z0-9._-]` to stop these from ever being committed.
- **Touches packages:** Yes — minecraft-kit. In minecraft-kit: delete the 7 zero-byte junk files at its repo root (a.kind, e.type, i.path, result.kind, 'verification.isValid)', '{,', '{,-'). No dist rebuild needed — these are not part of the package build.
- **Tests needed:** none
- **Guideline:** CLAUDE.md 'NEVER save working files or tests to root'; docs/architecture.md §12 project tree (these files are not part of the documented tree)

<a id="ll-002"></a>
#### LL-002 · Layer boundaries are not lint-enforced; architecture doc overstates enforcement

- **Category:** architecture · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** biome.json:26-49 (linter.rules has no noRestrictedImports / boundary rule); docs/architecture.md:63 ('Hard rules (enforced by linter and tsconfig paths)') and the three bullets at :65-67; tsconfig.main.json, tsconfig.renderer.json
- **Problem:** The doc claims renderer/main/shared boundaries are 'enforced by linter and tsconfig paths', but biome.json defines no import-restriction rule (no `noRestrictedImports`, no boundary plugin — confirmed the entire linter.rules block). The only real enforcement is structural tsconfig path separation: tsconfig.renderer.json omits the `@main/*` alias and includes only src/renderer+src/shared, so `import '@main/...'` from the renderer fails to resolve. But that does NOT stop a relative import like `../../main/foo`, and nothing stops `shared/` from importing `node:fs`/`electron`/`react` — purity there is currently maintained by convention only (verified clean today: grep for node:/electron/react imports under src/shared returned zero matches, but unguarded).
- **Why it matters:** A boundary that is 'enforced by convention' silently degrades: the first relative cross-layer import or the first `node:`/`react` import in shared/ will compile and ship, breaking the platform-agnostic guarantee the whole architecture rests on. The doc actively misleads maintainers into believing the tool will catch it.
- **Proposed solution:** Add Biome `noRestrictedImports` overrides per layer: forbid `@main/*`, `electron`, `node:*` in src/renderer and src/shared; forbid `@renderer/*`, `react`, `react-dom` in src/main and src/shared; forbid `node:*`/`electron`/DOM globals in src/shared. Where Biome's pattern support is insufficient, add `dependency-cruiser` as a lint:boundaries script. Then correct architecture.md §2 to state exactly what is enforced (tsconfig path separation + the new lint rules) versus convention.
- **Touches packages:** No
- **Tests needed:** A CI lint step (biome check / dependency-cruiser) that fails on a deliberately-added cross-layer import fixture.
- **Guideline:** docs/architecture.md §2 line 63 'Hard rules (enforced by linter and tsconfig paths)'; docs/code-guideline.md (Biome-only lint stack)

<a id="ll-003"></a>
#### LL-003 · Bundle and Minecraft services have a module-level circular dependency

- **Category:** architecture · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Repair flow
- **Area:** src/main/services/bundle/healer.ts:3 (imports verifyAndRepairExceptBundle from @main/services/minecraft/bundleHealing); src/main/services/minecraft/repairWorkflow.ts:8 (imports loadLocalManifest from @main/services/bundle/manifestRepo); note bundleHealing.ts:10 itself imports buildContext from minecraft/context, so the shared logic is not trivially poolable to a neutral leaf
- **Problem:** bundle/healer.ts imports `verifyAndRepairExceptBundle` from the minecraft service (line 3), while minecraft/repairWorkflow.ts imports `loadLocalManifest` from the bundle service (line 8). That is a bidirectional bundle<->minecraft import edge at module-resolution time. The doc (§5) permits cross-service direct imports but implies a layered, non-cyclic graph ('the router is a renderer->main edge, not a main-internal bus'). The cycle also means bundle-ownership logic (`createBundleRepairIssueFilter`, `verifyAndRepairExceptBundle`) lives inside the minecraft service even though it is fundamentally bundle-domain knowledge.
- **Why it matters:** Import cycles cause non-deterministic module-init ordering (one side can see `undefined` for a not-yet-evaluated export under certain bundler/ESM orderings), make the two services impossible to test or reason about in isolation, and block any future extraction of either service. The coupling is hidden because it is split across two files.
- **Proposed solution:** Break the cycle by extracting the shared bundle-ownership/verify-except-bundle logic into a neutral leaf. NOTE: bundleHealing.ts:65-71 calls buildContext (minecraft/context), so a clean extraction must either parameterize the context (pass target+clientFolder in) or move just the pure ownership filter (toBundleKey, isBundleOwnedIssue, createBundleRepairIssueFilter, countBundleOwnedIssues) plus the manifest-ownership-set construction into a leaf module both services depend on, leaving the kit-orchestration in minecraft. Verify acyclicity with dependency-cruiser.
- **Touches packages:** No
- **Tests needed:** Unit test for the extracted ownership/filter module (bundle-owned paths skipped, non-owned repaired); dependency-cruiser rule asserting no cycles between services/bundle and services/minecraft.
- **Guideline:** docs/architecture.md §5 'Cross-service calls go through direct imports … the router is not a main-internal bus' (implies an acyclic service graph)

<a id="ll-004"></a>
#### LL-004 · Shared operation-lock registry is defaulted to a fresh instance in four places — silent loss of cross-domain mutual exclusion

- **Category:** architecture · **Priority:** P0 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/services/minecraft/index.ts:24 and bundle/index.ts:24 (factory param `operationLocks: ClientOperationLocks = createClientOperationLocks()`); minecraft/manager.ts:62 and bundle/manager.ts:86 (constructor param same default); index.ts:95,104-105 (single shared instance threaded in); manager.ts:9 / bundle/manager.ts:8 still import createClientOperationLocks
- **Problem:** The whole point of clientOperationLocks is to make bundle-sync and minecraft-install/repair mutually exclusive on the same client folder. That invariant requires ONE registry shared across both services. But the shared instance is passed as an optional parameter that defaults to `createClientOperationLocks()` in FOUR independent spots (both service factories and both manager constructors), and both managers also still `import { createClientOperationLocks }` (manager.ts:9 / bundle/manager.ts:8) though index.ts always injects. If any caller (a future refactor, a test, a new entry point) constructs a manager/service without threading the exact same instance, each gets its own empty registry and the cross-domain lock silently becomes a no-op — bundle and minecraft can then mutate the same folder concurrently with no compile error and no runtime warning.
- **Why it matters:** This is a data-corruption-class footgun: concurrent bundle-delete + minecraft-repair on the same folder is exactly what the lock exists to prevent, and the failure mode is silent. Defaulting a cross-service-singleton dependency to a fresh instance is the classic way to ship a correctness bug that no type checker catches.
- **Proposed solution:** Make the locks a required (non-defaulted) constructor/factory argument so omitting it is a compile error. Remove the `import { createClientOperationLocks }` from both managers. Construct the single instance once in index.ts (as today) and require it everywhere downstream. If a default is wanted for ergonomics in tests, make tests pass an explicit shared instance rather than relying on the silent default.
- **Touches packages:** No
- **Tests needed:** Integration test that starts a bundle sync and a minecraft repair on the same slug and asserts the second is 'blocked' by the lock; a constructor test asserting the locks argument is required.
- **Guideline:** docs/architecture.md §5 (services receive dependencies at construction time); docs/code-guideline.md (no hidden invariants / fail at boundaries)

<a id="ll-005"></a>
#### LL-005 · Infrastructure modules kit.ts and clientOperationLocks.ts sit loose under services/ instead of infra/

- **Category:** architecture · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/kit.ts (loose 8-line file, not a <name>/ folder, no init/dispose); src/main/services/clientOperationLocks.ts (loose 166-line file, pure factory, no IPC, no lifecycle); contrast docs/architecture.md §3.2 lines 96-104 (services/<name>/ folders vs infra/ for low-level integrations)
- **Problem:** Both kit.ts and clientOperationLocks.ts live directly under src/main/services/ as bare files, but neither is a domain service: kit.ts is a single-statement factory wrapping the @loontail/minecraft-kit construction (a low-level integration), and clientOperationLocks.ts is a generic in-memory mutual-exclusion registry (cross-cutting infrastructure). Neither exposes the `init(ctx)`/`dispose()` Service shape, neither registers IPC routes, and both are consumed by multiple real services. The doc reserves services/<name>/ for 'one folder per domain capability' (line 96) and infra/ for 'low-level integrations' (line 100).
- **Why it matters:** Mixing infrastructure with services under the same directory blurs the very layer distinction the architecture is built on, makes the service inventory harder to read (a reader scanning services/ sees two things that are not services), and invites future code to treat them as services (e.g. expecting a dispose()).
- **Proposed solution:** Move both to src/main/infra/: `infra/kit.ts` (kit construction is exactly a low-level integration like store.ts/http.ts) and `infra/operationLocks.ts` (a generic lock registry, not a domain). Update the import sites. This also reinforces that clientOperationLocks is shared infra, complementing the required-argument fix above.
- **Touches packages:** No
- **Tests needed:** Existing imports must still resolve; the operationLocks unit tests (if any) move with the file. No new behavior tests.
- **Guideline:** docs/architecture.md §3.2 lines 96-104 (services/<name>/ are domain capabilities; infra/ holds low-level integrations)

<a id="ll-006"></a>
#### LL-006 · Architecture doc is significantly out of date: bundle service undocumented, non-existent launch service still described

- **Category:** docs · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** docs/architecture.md:177-180 (init-order line omits bundle) and :189-205 ('Currently shipping services' list omits bundle); docs/architecture.md:277 ('Launched via child_process.spawn from main/services/launch/') and :337 (tree comment 'services/<name>/ # domain services (settings, bundle, launch, updater)' lists a phantom 'launch')
- **Problem:** The architecture doc's authoritative service list (§5, lines 189-205) and init-order line (lines 178-180: app->auth->system->settings->skin->clients->servers->media->minecraft->console->updater) omit `bundle` completely — yet bundle is wired into index.ts (factory at line 105, init at line 123, between minecraft and console) and cross-coupled into the launch flow via attachLaunchHook (index.ts:108-110). Meanwhile §8.2 line 277 says launch happens 'from main/services/launch/' and the §12 tree comment at line 337 lists 'launch' as a domain service — but services/launch/ does not exist (launch logic lives in services/minecraft/launch.ts).
- **Why it matters:** The architecture doc is explicitly the single source of truth for 'what goes where and why' and the audit baseline. A doc that omits a shipping service and invents a phantom one misleads every new contributor and any reviewer using it to gate PRs, and undermines its authority for everything else.
- **Proposed solution:** Add `bundle` to the §5 init-order line (…media -> minecraft -> bundle -> console -> updater, matching index.ts:122-124) and to the 'Currently shipping services' list with a one-line description (download/verify/update/heal client bundles + launch-time sync hook). Replace the `main/services/launch/` reference at §8.2 line 277 with `main/services/minecraft/`, and fix the §12 tree comment at line 337 to drop the phantom 'launch'. Note the bundle<->minecraft launch-hook wiring (index.ts:108-110) in §5 so the coupling is documented rather than hidden.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** docs/architecture.md §5 and §12 (single source of truth for service inventory and project tree)
- **Verification note:** Core claims confirmed: doc init-order line (177-180) and service list (189-205) omit bundle; index.ts wires bundle init at line 123 with the launch-hook at 108-110. §8.2 line 277 cites the non-existent main/services/launch/. ADJUSTED one inaccuracy in the original: the original said the §12 tree at line 337 'describes services/launch/ that does not exist' AND framed it as omitting bundle — but line 337's comment actually reads '(settings, bundle, launch, updater)', i.e. it DOES list bundle and the phantom is only 'launch'. Corrected the area/solution to reflect that line 337 already names bundle and only the 'launch' entry is wrong. Priority P1 stands (the init-order list and §5 service inventory genuinely omit bundle).

<a id="ll-007"></a>
#### LL-007 · Per-service event broadcasters duplicate the same window.isDestroyed()+webContents.send boilerplate

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/main/services/minecraft/broadcast.ts:10-27 (4 repetitions); src/main/services/bundle/broadcast.ts:9-22 (3 repetitions); src/main/services/updater/index.ts:25-28 (inline broadcast, 1 repetition)
- **Problem:** Three places independently re-implement the identical guarded send: `if (window.isDestroyed()) return; window.webContents.send(channel, payload);`. minecraft/broadcast.ts repeats it four times (status/progress/log/error), bundle/broadcast.ts three times (status/progress/error), updater/index.ts inlines it once in its `broadcast` closure. Each is a hand-rolled copy of the same destroyed-window guard.
- **Why it matters:** Duplicated send-guard logic means the 'is the window still alive?' invariant is enforced in N places; the day someone adds a new event and forgets the guard, a send to a destroyed window throws. It also obscures that all renderer-bound events share one transport.
- **Proposed solution:** Add a single `infra/broadcast.ts` helper, e.g. `createWindowBroadcaster(window)` returning `send(channel, payload)` with the destroyed-window guard, or a typed `emit<E extends keyof IpcEvents>(event, payload)` bound to the contract. Refactor minecraft/bundle broadcasters and the updater inline broadcast to use it. Keeps the guard in one place and makes event channels contract-checked.
- **Touches packages:** No
- **Tests needed:** Unit test for the helper: no-throw when window.isDestroyed() is true; forwards channel+payload otherwise.
- **Guideline:** docs/code-guideline.md (DRY — each broadcaster re-states the guard); docs/architecture.md §3.2 (infra holds low-level integrations like the IPC send transport)

<a id="ll-008"></a>
#### LL-008 · minecraft dispose does not await in-flight teardown while bundle dispose does — asymmetric cancellation in the Promise.allSettled drain

- **Category:** flow · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Launch flow
- **Area:** src/main/services/minecraft/index.ts:32-34 (`dispose: async () => { manager.cancelAll(); }` — cancelAll is synchronous and only fires AbortControllers); src/main/services/bundle/index.ts:33-35 (`dispose: async () => { await manager.cancelAll(); }`, where bundle cancelAll awaits a 250ms grace timer); index.ts:144,146-159 drain()
- **Problem:** MinecraftManager.cancelAll() (manager.ts:276-289) is synchronous: it only calls `cancel(slug)` which calls `op.abort.abort()` (manager.ts:172-186) — it signals in-flight install/repair ops to stop but does not await the detached `void runInstall(...)`/`void finishRepair(...)` promises to settle. BundleManager.cancelAll() (bundle/manager.ts:448-454) is async and awaits a fixed 250ms grace window after signalling. So in drain()'s Promise.allSettled the minecraft dispose resolves immediately even though the install/repair async work it just aborted is still unwinding. Note the finding's original 'orphaned game process' concern is wrong: cancelAll deliberately leaves a running game alone (only LAUNCH_STARTING, not a spawned session, is aborted — see the manager.ts:274-275 comment).
- **Why it matters:** On before-quit the app awaits drain() before app.quit(). The minecraft dispose resolving before its aborted install/repair persistence (e.g. saveCurrentTargetInstallManifest) has flushed means the process can exit mid-unwind — a real (if narrow) window for a half-written install manifest. The asymmetry with bundle (which at least waits a grace period) suggests the minecraft side was overlooked. This is lower severity than originally rated because no game process is orphaned and the abort itself is synchronous-correct.
- **Proposed solution:** Have MinecraftManager track its in-flight operation promises and expose an async cancelAll() that awaits them (or a bounded grace window like bundle's), then `await manager.cancelAll()` in minecraft/index.ts dispose. Also reconcile the double-cancel path: index.ts:144 calls clientOperationLocks.cancelAll() (which invokes each lease's registered cancel -> manager.cancel) before the per-service disposes also call manager.cancelAll(); ensure teardown runs and is awaited exactly once.
- **Touches packages:** No
- **Tests needed:** Unit test: minecraft dispose() resolves only after the in-flight install/repair promise settles; test that the install manifest persist completes before drain resolves.
- **Guideline:** CLAUDE.md 'Wrap long-running operations in try/finally so timers/subscriptions are always cleaned up'; docs/architecture.md §5 (disposal via Promise.allSettled — implies disposes resolve when teardown is done)
- **Verification note:** Asymmetry is real (minecraft/index.ts:33 calls a synchronous cancelAll without await; bundle/index.ts:34 awaits an async cancelAll that sleeps 250ms — confirmed at bundle/manager.ts:448-454). But the original OVERSTATED the failure mode and priority. Reading manager.ts:172-186 and 274-289: cancelAll only fires AbortControllers and EXPLICITLY does not kill a running game (comment at 274-275), so 'orphaned game process' is false. The real (narrow) risk is an aborted install/repair's trailing persist not flushing before quit. Downgraded P2->P3 and rewrote the failure-mode description; kept risk=medium for the change itself since it touches teardown ordering. Also note index.ts:144 already calls clientOperationLocks.cancelAll() first, so there is a genuine double-cancel path worth deduping — kept that.

<a id="ll-009"></a>
#### LL-009 · tsconfig.test.json is not a project reference, so `tsc -b` skips it; tests typechecked by a separate appended invocation

- **Category:** testing · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** tsconfig.json:3-7 (references main/preload/renderer only); tsconfig.test.json:1-18 (noEmit, no composite, includes tests/** + env.d.ts + vitest.config.ts); package.json:24 (`typecheck: tsc -b --noEmit && tsc --noEmit -p tsconfig.test.json`)
- **Problem:** The solution-style tsconfig.json references only main, preload, and renderer projects (lines 3-7). tsconfig.test.json (which typechecks tests/**) is excluded from the build graph and is instead typechecked by a second, separate `tsc --noEmit -p tsconfig.test.json` appended to the typecheck script (package.json:24). Because tsconfig.test.json is noEmit / not composite and not referenced, `tsc -b` does not incrementally track it, and a developer running `tsc -b` directly (or an IDE using the solution file) will not typecheck tests at all.
- **Why it matters:** Tests are part of the maintained surface (doc §11 lists domain/ipc-route/zod tests as first-class); a typecheck setup where they are only validated by a tacked-on second command is easy to break silently (drop the `&&` tail, or rely on `tsc -b` alone) and means IDE/solution-level typechecking gives a false 'all green'.
- **Proposed solution:** Either add tsconfig.test.json as a referenced project (make it composite with its own outDir/tsbuildinfo and reference it from tsconfig.json so `tsc -b` covers it), or document explicitly in code-guideline.md that tests are typechecked only via the dedicated script and ensure CI always runs the full `npm run typecheck`. Preferred: include it in the build graph so a single `tsc -b` covers everything.
- **Touches packages:** No
- **Tests needed:** CI assertion that `tsc -b` (alone) reports test type errors, or that `npm run typecheck` is the only sanctioned entrypoint.
- **Guideline:** docs/architecture.md §10 (per-target tsconfigs under one base) and §11 (tests are a first-class surface); docs/code-guideline.md (strict TS everywhere)

<a id="ll-010"></a>
#### LL-010 · System route open-path allowed-roots computation is security-relevant domain logic living in routes.ts

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/system/routes.ts:19-29 (getOpenPathAllowedRoots iterates Object.values(settings.clients) overrides, reads override.storage.clientFolder / override.runtime.path, appends userData + clientsFolder, filters Boolean); imports getSettings from @main/services/settings/settings (line 11)
- **Problem:** registerSystemRoutes embeds a non-trivial, security-relevant function `getOpenPathAllowedRoots` (lines 19-29) that walks every client override in launcher settings to build the allowlist of folders the user is permitted to open via shell.openPath. This is domain/policy logic (which paths are safe to expose), not a thin IPC wrapper. The doc's service shape (§3.2 line 99) says routes.ts should be 'thin wrappers over the core'; this allowlist gates filesystem exposure and should be unit-testable in isolation.
- **Why it matters:** Path-allowlist computation guards against opening arbitrary directories from a renderer-supplied path. Burying it in routes.ts (a) makes it untested (routes are not the documented unit-test surface), (b) couples the system route file to settings-override internals, and (c) violates the thin-wrapper contract, making the security boundary harder to audit.
- **Proposed solution:** Move getOpenPathAllowedRoots into a pure function in shared/domain/ (input: LauncherSettings + userDataPath -> string[]) or the system infra layer, and unit-test it (override with clientFolder, override with runtime.path, null override, empty/falsey filtering). routes.ts then calls openPath(path, computeAllowedRoots(getSettings(), app.getPath('userData'))).
- **Touches packages:** No
- **Tests needed:** Pure unit tests for the extracted allowed-roots function covering override.storage.clientFolder, override.runtime.path, null overrides, and Boolean filtering.
- **Guideline:** docs/architecture.md §3.2 line 99 (routes.ts = thin wrappers over the core); docs/architecture.md §11 (pure domain logic is the unit-test surface)

<a id="ll-011"></a>
#### LL-011 · buildContext writes persisted settings as a side effect during a read-shaped 'build context' call

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Profile / version flow
- **Area:** src/main/services/minecraft/context.ts:46-52 (persistClientOverride to drop a stale loader override), :60-62 (persist a chosen loaderOverride), :72-80 (persist runtime: undefined to clear a stale runtime ref)
- **Problem:** buildContext is named and used like a pure resolver (install/launch/repair and bundleHealing.verifyAndRepairExceptBundle all call it to assemble a Context), but it performs up to three persisted-settings writes as side effects: clearing a stale loader override (line 51), persisting a loaderOverride when it differs from persisted (line 61), and clearing a stale runtime ref (line 78). These mutations to launcherSettings happen implicitly every time any minecraft op builds its context, so a 'repair' or a bundle heal can silently rewrite user settings.
- **Why it matters:** Hidden persistence inside a context-builder makes settings mutations non-obvious and hard to test (every buildContext test must mock the settings store), and risks a settings write firing during operations the user would not expect to mutate config (e.g. a repair clearing a loader override because Strapi momentarily reported the loader unavailable at line 47's isLoaderAvailable check). It mixes read-resolution with write-policy.
- **Proposed solution:** Split the pure resolution (compute Context from current settings) from the reconciliation writes. Return the resolution plus an explicit list of pending settings patches, and let the caller (a dedicated reconcile step at install/launch entry) apply them — or at minimum rename to make the mutation explicit and gate the writes behind the operations that should own them. Keep the stale-override cleanup but make it a deliberate, named step rather than a side effect of every context build.
- **Touches packages:** No
- **Tests needed:** Unit tests: buildContext does not persist when nothing is stale; reconcile step persists exactly the stale-loader/stale-runtime clears; a status-only path performs no writes.
- **Guideline:** docs/architecture.md §3.1 (pure resolution belongs in shared/domain — buildContext mixes I/O writes into resolution)
- **Verification note:** The behavior is confirmed verbatim: context.ts:51 persistClientOverride({loader: undefined}) on stale loader, :61 persistClientOverride({loader: loaderOverride}), :78 persistClientOverride({runtime: undefined}) on stale runtime ref. It is a read-shaped resolver doing writes, and bundleHealing.verifyAndRepairExceptBundle:71 also calls it (broadening the blast radius). ADJUSTED the guidelineViolation: the original cited CLAUDE.md 'do not demote a successful op on a trailing bookkeeping failure' — that rule is about NOT failing a succeeded op, which does not fit here (these are eager side-effect writes, not a trailing-failure demotion). Replaced with the accurate citation: docs/architecture.md §3.1 (pure resolution belongs in shared/domain; I/O side effects do not belong in a resolver). Problem/solution/priority unchanged.

<a id="ll-012"></a>
#### LL-012 · Most services hand-duplicate an identical Service type and empty no-op dispose; no shared Service interface exists

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/app/index.ts:4-7,13; clients/index.ts:6-9,15; settings/index.ts:5-8,17; system/index.ts; servers/index.ts; media/index.ts; skin/index.ts; auth/index.ts:9-12,22 — each re-declares `type XService = { init: () => Promise<void>; dispose: () => Promise<void> }` and most have `dispose: async () => {}`
- **Problem:** Eight services declare their own structurally-identical `type <Name>Service = { init: () => Promise<void>; dispose: () => Promise<void> }`, and the simple ones (app, clients, settings, system, servers, media, skin, auth) all use a no-op `dispose: async () => {}`. There is no shared `Service` interface in code, so each service re-declares the shape. Separately, the doc §5 (lines 168-171) shows `init(ctx: ServiceContext): Promise<void>` — but no service implements a ctx-taking init: all take deps via the factory and `init()` is zero-arg. So the doc and code already disagree on the lifecycle signature.
- **Why it matters:** Re-declaring the same contract per service means a future change to the lifecycle shape must be edited in eight-plus places, and drift is invisible. The doc/code mismatch on init(ctx) vs init() means the documented Service type is aspirational, not real.
- **Proposed solution:** Define one `Service` type in a shared main module (e.g. main/services/types.ts) — `{ init(): Promise<void>; dispose(): Promise<void> }` — and have each service's exported type alias it. Reconcile the doc: update §5 to the actual zero-arg `init()` + factory-injected-deps pattern (or introduce the ServiceContext the doc describes). Pick one and make code and doc agree.
- **Touches packages:** No
- **Tests needed:** none (type-only refactor); typecheck must stay green.
- **Guideline:** docs/architecture.md §5 lines 168-171 (single `Service` type with `init(ctx)` signature) — code declares the type 8x and uses a zero-arg init()

<a id="ll-013"></a>
#### LL-013 · Console and updater services place IPC route registration and listener wiring inline in index.ts instead of a routes.ts

- **Category:** architecture · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/console/index.ts:16-31 (router.handle calls inline in the init closure, no routes.ts/<name>.ts); src/main/services/updater/index.ts:64-116 (router.handle handlers + autoUpdater.on/removeListener wiring inline in init/dispose); contrast app/clients/settings which delegate to a routes.ts
- **Problem:** The documented service shape (§3.2 lines 96-99) is index.ts (lifecycle) + <name>.ts (core) + routes.ts (thin IPC wrappers). console/ and updater/ have neither routes.ts nor <name>.ts — all IPC handlers and (for updater) the autoUpdater event listeners are defined inline inside the init closure of index.ts. updater/index.ts is 117 lines mixing feed-URL construction (line 67), event handlers (37-62), in-flight state (34-35), and route handlers (83-106) in one file.
- **Why it matters:** Inconsistent service internal structure makes the codebase harder to navigate (a reader expecting routes.ts finds handlers in index.ts) and concentrates unrelated concerns (lifecycle + transport + autoUpdater protocol state) in one closure, hurting testability of the route handlers in isolation.
- **Proposed solution:** For console/: extract a `routes.ts` (registerConsoleRoutes(router)) and keep index.ts to lifecycle (init wires routes + dispose flushes consoleHub). For updater/: split into `updater.ts` (feed URL, in-flight state machine, autoUpdater listener setup/teardown) and `routes.ts` (updaterCheck/updaterInstall handlers), leaving index.ts as the thin init/dispose. This matches the conforming services.
- **Touches packages:** No
- **Tests needed:** IPC-route unit tests for console (getInitial/clear/copyAll/copyText) and updater (check/install) against a mocked manager/hub, now that handlers are isolated.
- **Guideline:** docs/architecture.md §3.2 lines 96-99 (index.ts lifecycle, <name>.ts core, routes.ts thin IPC wrappers)

<a id="ll-014"></a>
#### LL-014 · bootstrap and several services deep-import settings/settings.ts internals instead of the service barrel

- **Category:** architecture · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** 8 deep importers of @main/services/settings/settings: src/main/bootstrap/seed.ts:2, bootstrap/sweepOrphans.ts:3, services/system/routes.ts:11, services/minecraft/manager.ts (getSettings/persistClientOverride), services/minecraft/context.ts:3-6, services/minecraft/readinessPolicy.ts, services/bundle/manager.ts:11; settings/index.ts exports only createSettingsService (not getSettings/writeSettings/setClientOverride)
- **Problem:** The settings service's public surface (settings/index.ts) exports only createSettingsService; getSettings/writeSettings/setClientOverride/patchLauncherSettings live in settings/settings.ts. Yet 8 modules (verified via grep) import the deep path `@main/services/settings/settings` directly, bypassing the service's index.ts barrel. The doc (§3.4 line 129) treats index.ts as the only file other parts may import from. Contrast clients/index.ts:4 which DOES re-export getClient/getClients — so clients is consistent and settings is not.
- **Why it matters:** Deep imports into a service's internal file defeat the index.ts-as-public-API boundary the architecture relies on. settings/settings.ts is the de-facto shared read/write API used by 8 call sites, but it is not advertised as public, so a maintainer refactoring settings.ts cannot know it is a consumed contract.
- **Proposed solution:** Decide and make explicit: either re-export getSettings/writeSettings/patchLauncherSettings/setClientOverride/clearClientOverride from settings/index.ts (matching clients/index.ts:4) and have all 8 consumers import from `@main/services/settings`, or move the shared settings read/write API into an infra/store-backed module if it is really infrastructure. Update the import sites accordingly.
- **Touches packages:** No
- **Tests needed:** none (import-path refactor); typecheck stays green.
- **Guideline:** docs/architecture.md §3.4 line 129 (index.ts is the only file other parts may import from — applied to services per §3.2)

### IPC contract, router & preload

<a id="ll-015"></a>
#### LL-015 · normalizeError leaks non-ERROR_CODES error shapes (incl. MinecraftKitError) across the bridge

- **Category:** error-handling · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/ipc/router.ts:49-57 (normalizeError); wrapForTransport:63-64; reachable via src/main/services/minecraft/context.ts:64 (unguarded kit.targets.resolve)
- **Problem:** normalizeError returns `error as IpcError` for ANY object with `code` and `message` (router.ts:50-52). MinecraftKitError extends Error with a `code` (e.g. 'MANIFEST_NOT_FOUND'), `message`, a frozen `context`, and a `toJSON()` (verified at node_modules/@loontail/minecraft-kit/dist/index.mjs:80-98). buildContext calls `kit.targets.resolve(...)` unguarded (context.ts:64); a kit failure there propagates synchronously through startInstall/startRepair/startLaunch (manager.ts:119/196/229) into the router handler. normalizeError passes it through verbatim, and wrapForTransport's JSON.stringify invokes toJSON() — shipping kit `code`/`context`/`name`. On the preload side isIpcError (errors.ts:9-17) rejects it (kit code not in ERROR_CODES), so tryUnwrapIpcError returns null and the renderer receives a raw Error, not a structured IpcError.
- **Why it matters:** The renderer cannot switch on the code (isIpcError gate fails) and internal kit structure is serialized into the transport message. The router test at router.test.ts:120-136 already locks the loose duck-typed pass-through, so this is current, tested behavior — not hypothetical.
- **Proposed solution:** Replace the `'code' in error && 'message' in error` branch with a registry-checked validator (use isIpcError from shared/ipc/errors.ts). For MinecraftKitError, map via isMinecraftKitError → a stable ERROR_CODES value (IpcHandlerFailed) and attach kitCode/kitContext only under devDetailsFor() (devDetailsFor already does this at router.ts:42-45 but is unreachable for kit errors because the duck-typed branch short-circuits first).
- **Touches packages:** No
- **Tests needed:** unit: router.test.ts cases for (a) a thrown MinecraftKitError → code IpcHandlerFailed, no kitContext when packaged, (b) a plain {code:'NOT_IN_REGISTRY',message} normalized to a valid ERROR_CODES code rather than passed through.
- **Guideline:** docs/code-guideline.md §9 (IpcError shape; details minimal in prod) — note the doc types code as `string`, but the launcher's own isIpcError requires a registry code, so a leaked kit code breaks rehydration

<a id="ll-016"></a>
#### LL-016 · Console window gets full IPC privilege via trusted-sender check despite being sandbox:false

- **Category:** IPC · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** IPC flow
- **Area:** src/main/ipc/trustedSender.ts:43-50; src/main/windows/consoleWindow.ts:35 (sandbox:false)
- **Problem:** createTrustedSenderCheck returns true for EITHER the main window OR the console window for EVERY channel (trustedSender.ts:46-49). The console window is created with sandbox:false (consoleWindow.ts:35). It only uses console.getInitial/clear/copyAll/copyText invoke channels plus console.* events (verified at src/renderer/console/api.ts:10-28), yet it can invoke auth.login, minecraft.launch, settings.setLauncher, system.openPath, etc. There is no per-channel allow-list scoping a sender to a channel group.
- **Why it matters:** Defense in depth: the console renderer runs unsandboxed, so a renderer-side compromise there gains the full IPC surface (account login, launching processes, opening filesystem paths). The trust check validates WHICH window, never WHICH channels that window may call.
- **Proposed solution:** Scope the validator to a channel group. Pass the channel into the sender check (router.handle already has it at router.ts:73) and allow the console window only the console.* set; allow the main window the full set. Implement as a predicate `(event, channel) => boolean`, keeping the frame/parent checks as-is.
- **Touches packages:** No
- **Tests needed:** unit: trustedSender test asserting the console-window frame is rejected for a non-console channel (e.g. 'auth.login') and accepted for 'console.getInitial'.
- **Guideline:** docs/architecture.md §4 IPC ('validates the sender frame'); docs/code-guideline.md §1 (validate input at system boundaries) — least-privilege intent

<a id="ll-017"></a>
#### LL-017 · Router validates args by cast only — Zod parsing is opt-in per handler, not enforced by the contract

- **Category:** IPC · **Priority:** P1 · **Effort:** large · **Change risk:** medium · **Flow:** IPC flow
- **Area:** src/main/ipc/router.ts:69-87 (casts `rawArgs as IpcArgs<TChannel>` at line 78); per-route parseIpcArgs calls in services/*/routes.ts
- **Problem:** The router never validates args; it casts `rawArgs as IpcArgs<TChannel>` (router.ts:78) and relies on each handler to call parseIpcArgs. Coverage happens to be complete today (verified across auth/system/settings/minecraft/bundle/servers/clients/skin routes), but nothing structurally guarantees it: a future payload channel whose handler forgets parseIpcArgs silently trusts renderer input. The docs say the router 'validates arguments through the Zod schema co-located with the channel' (architecture.md:159-161), but that responsibility currently lives in handlers.
- **Why it matters:** A single forgotten parseIpcArgs is an unvalidated trust boundary with no compile-time signal. The guideline mandates IPC zod-validation on entry to the router; making it a router responsibility (schema registry keyed by channel) closes the gap permanently.
- **Proposed solution:** Introduce IPC_ARG_SCHEMAS: Record<channel, ZodTypeAny> (z.undefined() for no-arg channels) and have router.handle look up + parse before dispatch. Add a compile-time guard (like IpcChannelsCoverContract at channels.ts:55-62) asserting every contract channel has a schema. Handlers then receive already-parsed args.
- **Touches packages:** No
- **Tests needed:** unit: type-level coverage test that every IpcContract channel has a registered schema; router test that invalid args reject with IPC_INVALID_ARGS before the handler runs.
- **Guideline:** docs/architecture.md §4 ('router … validates arguments through the Zod schema co-located with the channel'); docs/code-guideline.md §4/§5 ('IPC arguments are validated by a Zod schema on entry to main', 'validated on entry to the router')

<a id="ll-018"></a>
#### LL-018 · No compile-time coverage guard between IPC_EVENTS values and IpcEventPayloads keys

- **Category:** IPC · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/shared/ipc/channels.ts:64-79 (IPC_EVENTS, IpcEventName) vs src/shared/ipc/contract.ts:95-108 (IpcEventPayloads)
- **Problem:** Channels have a bidirectional guard (IpcChannelsCoverContract, channels.ts:55-62). Events do not. IPC_EVENTS (the runtime string map used by every webContents.send) is never type-checked against IpcEventPayloads (the map keying preload on()). IpcEventName (channels.ts:79) is exported/re-exported (ipc/index.ts:2) but never used as a constraint. A typo in an IPC_EVENTS value, or a payload key added without an IPC_EVENTS entry (or vice versa), compiles cleanly and silently breaks the event at runtime.
- **Why it matters:** Events are the launcher's live progress/status/log channel for install/launch/console/updater. A silent name/payload drift produces a frozen UI with no error. The asymmetry with the channel guard is a low-cost gap to close.
- **Proposed solution:** Add a type guard mirroring IpcChannelsCoverContract: assert Exclude<keyof IpcEventPayloads, IpcEventName> extends never and the reverse, so IPC_EVENTS values exactly cover IpcEventPayloads keys. Use IpcEventName (currently only re-exported) as the constraint.
- **Touches packages:** No
- **Tests needed:** none (compile-time guard); optionally a tests/shared/ipc type-coverage test.
- **Guideline:** docs/code-guideline.md §4 ('Server→client events are described in a separate IpcEvents map') / §6.1 (event names extracted) — single source of truth intent

<a id="ll-019"></a>
#### LL-019 · Server→client events use raw webContents.send with no shared typed emit helper — payload/name pairing unchecked

- **Category:** IPC · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/main/services/minecraft/broadcast.ts:10-27; src/main/services/bundle/broadcast.ts:9-22; src/main/services/updater/index.ts:25-28; src/main/infra/notifier.ts:13-21; src/main/infra/consoleHub.ts:225-227 + consoleWindowSink.ts:26-34
- **Problem:** Every emitter calls window.webContents.send(IPC_EVENTS.x, payload) directly. There is no single typed emit(event, payload) helper tying IPC_EVENTS name to IpcEventPayloads[name]. consoleHub.sendToWindow / ConsoleWindowSink.send take (channel: string, payload: unknown) (consoleWindowSink.ts:26) — fully untyped, so a wrong channel or wrong-shaped payload for console.lines/state/bufferReset is not caught. The per-broadcaster methods (minecraft/bundle) get payload typing from their own method signatures, but there is no end-to-end binding of name↔payload.
- **Why it matters:** Without a typed emit boundary, contract type-safety stops at the renderer's on() and never reaches the sender. A mismatched payload (e.g. a bare object where ConsoleLine[] is expected) is silent. This is the send-side analogue of the validated invoke side.
- **Proposed solution:** Add a shared `emit<E extends keyof IpcEventPayloads>(window, event: E, payload: IpcEventPayloads[E])` helper (main/infra) that does the isDestroyed guard once and constrains payload by event. Route all broadcasters and consoleHub through it; type ConsoleWindowSink.send via the same generic instead of (string, unknown).
- **Touches packages:** No
- **Tests needed:** unit: a small test that emit() forwards the typed payload and no-ops on a destroyed window.
- **Guideline:** docs/code-guideline.md §4 (events single-source-of-truth); contract-typed payloads end to end

<a id="ll-020"></a>
#### LL-020 · parseIpcArgs throws a bare IpcError object, relying on router's duck-typed normalizeError to forward it

- **Category:** error-handling · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/ipc/parseArgs.ts:12-19 (throws plain {code,message,details}); coupled to router.ts:50-52
- **Problem:** parseIpcArgs throws a plain object literal IpcError (parseArgs.ts:13-18), not an Error. It only survives transport because normalizeError's loose `'code' in error && 'message' in error` check passes it through. This is the same fragile duck-typing flagged in the normalizeError finding: if normalizeError is tightened to require an Error or a registry-valid code, the validation error path changes behavior. The two modules are coupled through an implicit contract with no direct test (the only test of the pass-through is router.test.ts:120-136 using a hand-built {code,message}, not parseIpcArgs).
- **Why it matters:** The arg-validation failure path is the most security-relevant error (malformed renderer input). It should be explicit and locked by a test, not dependent on a permissive normalizer that the prior finding wants to tighten.
- **Proposed solution:** Have normalizeError use isIpcError() (registry-checked) so IPC_INVALID_ARGS round-trips by validation, not by structure (its code IS in ERROR_CODES, so it survives a tightened check). Add a router+parseIpcArgs integration test asserting a parseIpcArgs failure reaches the renderer as {code:IPC_INVALID_ARGS}.
- **Touches packages:** No
- **Tests needed:** unit: integration test through createRouter+parseIpcArgs asserting invalid args produce a transported IPC_INVALID_ARGS IpcError (details only in dev).
- **Guideline:** docs/code-guideline.md §9 (single IpcError shape) / §4 (validation on entry)

<a id="ll-021"></a>
#### LL-021 · Renderer cannot recover IpcError details cleanly — details are packed into Error.message before rehydration

- **Category:** error-handling · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/preload/index.ts:17-29 (invokeWithStructuredErrors); src/shared/ipc/errors.ts:26-37 (tryUnwrapIpcError); src/main/ipc/router.ts:63-64 (wrapForTransport)
- **Problem:** The structured-error transport packs the entire IpcError JSON (sentinel + {code,message,details}) into Error.message, then tryUnwrapIpcError parses it back. In dev builds the full details (stack, zod format(), kit context) are serialized into the message string; if any catch site upstream of the preload api wrapper logs raw.message before rehydration, it logs the sentinel+JSON blob. In prod, details ARE already omitted (devDetailsFor returns undefined when packaged at router.ts:36-37, and parseArgs.ts:16 strips details when app.isPackaged), so there is no production stack leak.
- **Why it matters:** The documented model is a structured object, not a stringified blob. Stuffing details into message is a transport hack that risks leaking dev detail into message-based logging and makes the message non-human-readable until unwrapped.
- **Proposed solution:** Keep the sentinel mechanism (it correctly handles Electron dropping non-Error structure). Document that no renderer code should read err.message before window.api.invoke rehydrates, and add a test that the packaged wrapper message contains no 'stack' substring. This is a hygiene/coupling note, not a prod-leak bug.
- **Touches packages:** No
- **Tests needed:** unit: assert wrapForTransport message in packaged mode contains no 'stack' substring (already covered indirectly by router.test.ts:102-118); preload test that invoke rehydrates {code,message} and drops the sentinel.
- **Guideline:** docs/code-guideline.md §9 (IpcError as structured payload; details minimal in prod)
- **Verification note:** Real but overstated — downgraded P2→P3 and effort medium→quick. The auditor's own text concedes 'In prod details is omitted so it's fine', and I confirmed details are stripped when packaged in BOTH paths (devDetailsFor router.ts:36-37 and parseArgs.ts:16), and router.test.ts:102-118 already asserts no details when packaged. So there is no production leak; the residual concern is purely dev-build message-logging hygiene plus the sentinel/message coupling. The sentinel design is intentional and correct (Electron drops non-Error structure, per errors.ts:19-24 comment). Reframed as a documentation/test hardening item rather than a transport redesign; dropped the 'separate dev details channel' alternative as unnecessary.

<a id="ll-022"></a>
#### LL-022 · Renderer-side events are not validated against their Zod schemas despite schemas existing

- **Category:** IPC · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/preload/index.ts:33-44 (on() casts payload to IpcEventPayloads[TEvent]); schemas exist e.g. src/shared/contracts/minecraft.ts:87-122, src/shared/contracts/bundle.ts:115-145
- **Problem:** The preload on() handler casts the incoming payload `(_event, payload: IpcEventPayloads[TEvent])` with no runtime validation (preload/index.ts:37), even though full Zod schemas exist (MinecraftStatusEventSchema, MinecraftProgressEventSchema, MinecraftErrorEventSchema, Bundle equivalents). The renderer feature handler consumes them by cast (minecraft/events.ts:77-96 destructures fields directly). Invoke args ARE validated on the main side; events crossing main→renderer are trusted blindly, so a main-side payload bug surfaces as a malformed React state update rather than a caught validation error, and the authored schemas go unused on entry.
- **Why it matters:** The guideline lists zod as a tested boundary and the event payload schemas already exist. Validating on the emit boundary (or at least in dev) turns a silent shape drift into a clear error and exercises the authored schemas.
- **Proposed solution:** Preferred: validate at the emit boundary in main (before webContents.send, ideally inside the proposed typed emit() helper) so a producer bug is caught at source. Alternatively register the event schemas in a map and parse in dev builds in the preload on() handler.
- **Touches packages:** No
- **Tests needed:** unit: parse each broadcast payload through its schema in the broadcaster tests.
- **Guideline:** docs/code-guideline.md §5 (validation at boundaries) / 'tests = … zod'; event payload schemas exist but are not enforced on entry

<a id="ll-023"></a>
#### LL-023 · media.* channels are split across two service modules, obscuring channel ownership

- **Category:** architecture · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/media/routes.ts:5-8 (mediaClearCache/mediaGetCacheSize) vs src/main/services/skin/routes.ts:7-14 (mediaUploadSkin/mediaClearSkin)
- **Problem:** The four media.* channels are registered by two different services: skin/routes.ts owns media.uploadSkin + media.clearSkin (skin/routes.ts:8,13), while media/routes.ts owns media.clearCache + media.getCacheSize (media/routes.ts:6-7). The channel namespace 'media.' does not map to a single service, so 'who handles media.uploadSkin' is non-obvious (it is the skin service, not media).
- **Why it matters:** The docs describe one service per domain capability registering its routes in init (architecture.md:185). A namespace handled by two services makes the contract→handler mapping ambiguous and complicates the per-channel sender-scoping work and route audits.
- **Proposed solution:** Either rename the skin-owned channels to a 'skin.' namespace (skin.upload/skin.clear) so namespaces map 1:1 to services, or move clearCache/getCacheSize so all media.* live in one module. Update IPC_CHANNELS + contract.ts keys together (the compile guard at channels.ts:55-62 enforces consistency).
- **Touches packages:** No
- **Tests needed:** none (rename); existing router/channel coverage guard validates the rename.
- **Guideline:** docs/code-guideline.md §4 channel naming '<feature>.<action>'; docs/architecture.md §5 ('a service registers its IPC routes inside init')

<a id="ll-024"></a>
#### LL-024 · Architecture doc's IPC contract example and updater section are stale vs the real contract

- **Category:** docs · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** docs/architecture.md:139-153 (IpcContract/IpcEvents example) and docs/architecture.md:204-205 (updater)
- **Problem:** The doc's IpcContract sample lists 'bundle.status' as an invoke channel returning BundleStatus and 'settings.setClient' (architecture.md:143,145), neither of which exists — the real contract has bundle.checkStatus → BundleInstallState (contract.ts:83) and settings.setClientOverride (contract.ts:48). The events example uses an 'IpcEvents' map and 'bundle.reset' (architecture.md:149-152), but the code uses IpcEventPayloads and console.bufferReset (contract.ts:95-108; no bundle.reset). Lines 204-205 document the updater as 'electron-updater' with states 'checking/available/downloading/ready/error', but updater/index.ts:5 imports autoUpdater from 'electron' (Squirrel) and never emits DOWNLOADING (onUpdateAvailable emits AVAILABLE at updater/index.ts:49).
- **Why it matters:** The doc is declared the single source of truth and the onboarding map for the IPC layer. Stale channel/event names and the electron-updater mislabel send new contributors to the wrong abstractions and undermine the doc's authority.
- **Proposed solution:** Sync the snippets: use real channel names (bundle.checkStatus, settings.setClientOverride), reference IpcEventPayloads (not IpcEvents) with real event names (console.bufferReset), and correct §204 to electron.autoUpdater/Squirrel — and note that UpdaterStates.DOWNLOADING exists in the type (updater.ts:5,16) but is never emitted at runtime.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** docs/architecture.md §4 ('Single source of truth: shared/ipc/contract.ts' — doc contradicts the code it documents)
- **Verification note:** Real; corrected one nuance. All channel/event mismatches confirmed (bundle.checkStatus/BundleInstallState, settings.setClientOverride, IpcEventPayloads, console.bufferReset, no bundle.reset). The 'electron-updater' mislabel is confirmed (updater/index.ts:5 imports autoUpdater from 'electron'). BUT the auditor implied DOWNLOADING does not exist — it DOES exist in UpdaterStates (updater.ts:5) and the UpdaterStatusEvent union (updater.ts:16 with percent); it is simply never emitted by the service (onUpdateAvailable→AVAILABLE at updater/index.ts:49). Adjusted the problem/solution wording to 'exists in the type but never emitted' instead of 'without a real DOWNLOADING transition' implying absence.

<a id="ll-025"></a>
#### LL-025 · isDestroyed() guard duplicated across every broadcaster method instead of a single send wrapper

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/main/services/minecraft/broadcast.ts:11-26 (4x guard); src/main/services/bundle/broadcast.ts:10-21 (3x); src/main/services/updater/index.ts:26-27; src/main/infra/notifier.ts:14-21
- **Problem:** createBroadcaster repeats `if (window.isDestroyed()) return; window.webContents.send(...)` in all four minecraft methods and three bundle methods; updater and notifier each have their own. ConsoleWindowSink.send (consoleWindowSink.ts:26-34) and notifier.send (notifier.ts:14-21) already wrap send in try/catch to survive the race between isDestroyed() and send(), but the minecraft/bundle/updater broadcasters do NOT — they only check isDestroyed() and can still throw if the window is torn down between the check and the send.
- **Why it matters:** Duplication invites the subtle race already handled in ConsoleWindowSink/notifier (a window torn down between the isDestroyed check and send throws). The typed-emit helper proposed earlier would also remove this duplication and add the missing try/catch.
- **Proposed solution:** Fold this into the shared typed emit() helper: one guarded send with the isDestroyed check + try/catch, reused by minecraft/bundle/updater/notifier broadcasters.
- **Touches packages:** No
- **Tests needed:** covered by the emit() helper unit test.
- **Guideline:** docs/code-guideline.md §1 (DRY; try/finally-style cleanup robustness)

<a id="ll-026"></a>
#### LL-026 · errorCodes registry duplicates the union and the const object by hand, allowing silent drift

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/shared/constants/errorCodes.ts:1-22 (ErrorCode union literal-listed separately from ERROR_CODES values)
- **Problem:** ErrorCode is a hand-written union of string literals (errorCodes.ts:1-10) AND ERROR_CODES is a separate const object whose values must match it via `satisfies Record<string, ErrorCode>` (line 22). `satisfies` only checks values ARE ErrorCodes, not that every ErrorCode is present in the object. isIpcError (errors.ts:15) validates against Object.values(ERROR_CODES), so the const object is the real registry; the union is a redundant second source. A code added to ERROR_CODES but omitted from the union, or dropped from the object but left in the union, is not fully caught.
- **Why it matters:** Two sources for the same registry is exactly the magic-literal duplication the guideline warns against. The renderer narrows on ErrorCode; a drift means a real code that isIpcError accepts but the union type doesn't know about (or vice versa).
- **Proposed solution:** Derive the union from the object: `export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]` and drop the hand-written literal union, mirroring IpcChannel/IpcEventName in channels.ts:50,79. Single source of truth, no satisfies needed for completeness.
- **Touches packages:** No
- **Tests needed:** none (type derivation); existing isIpcError tests still pass.
- **Guideline:** docs/code-guideline.md §6.1 ('error codes are named consts' / single source of truth) / §6 as-const-derived types

<a id="ll-027"></a>
#### LL-027 · Launcher re-implements an error-code registry + isErrorCode model already exported by the kit/ygg packages

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/shared/constants/errorCodes.ts + src/shared/ipc/errors.ts vs @loontail/minecraft-kit (MinecraftKitErrorCodes/isMinecraftKitError/isErrorCode) and @loontail/yggdrasil-core (YggdrasilCoreErrorCodes/isYggdrasilCoreError)
- **Problem:** The launcher hand-rolls a code registry + type guard pattern that both sibling packages already ship. The launcher's IpcError model is legitimately its own boundary set, but the kit→IpcError mapping has no shared adapter: each consumer maps kit codes ad hoc. There are three parallel registries — launcher ERROR_CODES (errorCodes.ts), the contract's MinecraftErrorCodes (minecraft.ts:53-67), and kit MinecraftKitErrorCodes — with manual translation at minecraft/errors.ts:14-35 (KIT_CODE_TO_LAUNCHER_CODE). This ad-hoc mapping is the same fragility that lets the normalizeError leak through (the router has no kit→IpcError adapter at all).
- **Why it matters:** Three parallel error-code registries with manual mapping is brittle and is the root of the normalizeError leak. A documented kit-code→IpcError-code map would centralize the translation the router needs.
- **Proposed solution:** Keep launcher ERROR_CODES as the IPC boundary set, but add a single typed adapter (kitErrorToIpcError) using isMinecraftKitError/isErrorCode from the kit, consumed by router.normalizeError and the minecraft service. Do NOT re-derive code lists; consume the kit's MinecraftKitErrorCodes (already done at minecraft/errors.ts via MinecraftKitErrorCode). No package change required.
- **Touches packages:** No. No package change needed; the kit already exports MinecraftKitErrorCodes/isErrorCode (used at services/auth/routes.ts:1 and minecraft/errors.ts:1). Launcher should consume them in a single mapping module rather than re-listing codes.
- **Tests needed:** unit: table-driven test mapping representative MinecraftKitErrorCodes to expected IpcError/MinecraftErrorCode values.

### Bundle download / install / heal flow

<a id="ll-028"></a>
#### LL-028 · Write lock can leak on synchronous throw between acquireWriteLock and executePreparedSync

- **Category:** flow · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:231-249 (acquireWriteLock → executePreparedSync handoff)
- **Problem:** acquireWriteLock (line 231) takes a ClientOperationLease, then createSyncTask (232), createActiveSync (233), createAwaiter (234), activeSyncs.set (235), activeLocks.set (236), and lock.setCancel (237) run with NO try/finally before the awaited executePreparedSync (239) takes over cleanup. If anything in 232-237 throws synchronously — most dangerously BEFORE activeLocks.set (236) — the lease is held by operationLocks but is unreachable by dropActiveSync (which only releases what is in activeLocks). That leaks the lease and wedges the slug for the session. The original finding's NO_BUNDLE framing is incorrect: runSync returns at 221-222 BEFORE acquireWriteLock, so that path is safe; the real (narrow) gap is the unbracketed acquisition-to-handoff window.
- **Why it matters:** A leaked ClientOperationLease permanently blocks every future bundle AND minecraft write op for that client until app restart — a silent, hard-to-diagnose wedge. code-guideline.md mandates try/finally so lock entries are always cleaned up even on throw.
- **Proposed solution:** Bracket from acquireWriteLock through the activeSyncs/activeLocks.set + setCancel in a try that, on synchronous throw before executePreparedSync owns cleanup, releases the lease and deletes any activeSyncs/activeLocks entries. Simplest robust fix: set activeLocks immediately after acquire (so dropActiveSync can always find it), or have executePreparedSync own the entire lease lifecycle.
- **Touches packages:** No
- **Tests needed:** unit: force createActiveSync/createAwaiter to throw after acquireWriteLock and assert the lease is released (a subsequent startSync for the same slug succeeds rather than throwing OP_IN_FLIGHT)
- **Guideline:** code-guideline.md — try/finally for cleanup; architecture.md — services lifecycle / lock cleanup
- **Verification note:** Real but the title/problem were misleading. The NO_BUNDLE no-op (manager.ts:221-222) returns BEFORE acquireWriteLock (231), so that path never holds a lock — the original title 'leaks on the NO_BUNDLE no-op path' is wrong and I retitled it. The genuine issue is the unbracketed 232-237 window; the worst case is a throw before activeLocks.set (236), after which dropActiveSync (377-383) finds no lock entry and never calls lease.release(). Probability is low (these are pure in-memory constructors) but the consequence (permanent slug wedge for both bundle and minecraft write ops sharing CLIENT_FOLDER/BUNDLE_MANIFEST resources) is severe, so P1 stands.

<a id="ll-029"></a>
#### LL-029 · Download phase has no per-file retry — one transient 5xx aborts the whole sync

- **Category:** flow · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/download.ts:87-103 (followRedirects), runner.ts:113-141 (runDownloadPhase)
- **Problem:** requestOnce/followRedirects perform exactly one request attempt per URL; any non-2xx terminal (line 100), socket reset, or timeout (lines 70-77) throws immediately with no retry/backoff. In runDownloadPhase, the first worker error sets firstError and drains pendingDownloads (line 126), failing the entire sync of potentially hundreds of files. Manifest entries carry a single url and a known sha256, which would make idempotent GET retries safe.
- **Why it matters:** Bundle downloads run over real networks where transient 503/timeout/connection-reset are common. Failing a 300-file sync because file #142 hit a momentary 503 forces a full re-plan + re-download. minecraft-kit's download runner already implements a per-URL retry budget with mirror fallback (DownloadAction url: string | readonly string[], 'Each URL gets a full retry budget' at index.d.ts:2178-2183) — verified present.
- **Proposed solution:** Add a bounded retry-with-backoff around followRedirects/requestOnce for idempotent GETs (retry on ECONNRESET/ETIMEDOUT/5xx; never on 4xx, integrity mismatch, or when aborted). Extract retryDownload(entry, dest, opts, {maxAttempts, baseDelayMs}). Longer term, align the manifest entry shape with kit's mirror-URL convention so the same retry policy can be shared.
- **Touches packages:** Yes — minecraft-kit. Optional: minecraft-kit could export a reusable downloadFile/retryableFetchToFile primitive (its retry+mirror logic is currently internal to the install runner, not in the public d.ts export list). If extracted into kit, dist must be rebuilt and copied into launcher node_modules. Short-term the retry lives in the launcher (affectsKit can be treated as optional/future).
- **Tests needed:** unit: mock requestOnce to fail twice with 503 then succeed, assert the file lands; assert 404 is not retried; assert abort short-circuits retries

<a id="ll-030"></a>
#### LL-030 · Resume never refreshes the remote manifest or its hash — persists a possibly stale signature

- **Category:** flow · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:252-262 (continuePausedSync), 336-349 (persistLocalManifest), constants/bundle.ts:24 (5-min idle window)
- **Problem:** continuePausedSync passes loadRemoteManifest: () => active.remoteManifest (line 260) — the object captured at pause time — and never re-fetches or re-hashes. A paused sync may sit idle up to BUNDLE_PAUSED_SYNC_MAX_IDLE_MS (5 min). On resume the plan is rebuilt against the OLD remote manifest, and persistLocalManifest writes active.remoteManifestHash (line 342) from before the pause. If upstream changed during the pause, the local manifest claims a manifestHash that no longer matches reality, and getInstallState's drift check (line 196-197, manifestHash === local.manifestHash) reports signatureMatches=true incorrectly until the next full sync.
- **Why it matters:** manifestHash is the cheap drift signal the renderer relies on to show 'update available'. Writing a stale hash silently defeats it, producing a 'looks up to date' UI for an out-of-date client. The 5-min idle window makes the staleness realistic.
- **Proposed solution:** On resume, re-fetch the remote manifest (re-emit FETCHING_MANIFEST) so both the plan and the persisted manifestHash reflect current upstream. If the manifestHash changed, treat resume as a fresh plan. At minimum re-fetch the hash and refuse to persist one older than the on-disk record.
- **Touches packages:** No
- **Tests needed:** unit: pause with manifest A, change remote to B, resume, assert loadRemoteManifest re-fetches and saveLocalManifest receives hash B (not A)

<a id="ll-031"></a>
#### LL-031 · BundleManager mixes 6+ responsibilities — extract AwaiterRegistry, PauseTimer, ProgressEventFactory, SyncRegistry

- **Category:** architecture · **Priority:** P2 · **Effort:** large · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts (468-line file: 47-77 progress factory, 393-407 awaiters, 409-437 pause timer, 330-349 persistence, 80-81/377-383 dual maps)
- **Problem:** manager.ts conflates: (1) progress event construction (makeProgressEvent/createEmit, top-level fns reaching into task internals, 47-77), (2) write-lock lifecycle (acquireWriteLock/dropActiveSync/activeLocks), (3) awaiter promise registry (createAwaiter/resolve/reject, 393-407), (4) pause-idle timer bookkeeping (arm/clear/expire, 409-437), (5) local manifest persistence (336-349), (6) status/error broadcast wiring. It holds two parallel Maps (activeSyncs, activeLocks) keyed by the same slug whose lifecycles must stay in lock-step by hand.
- **Why it matters:** Each concern has independent state that leaks across methods, making the pause/resume/cancel/expire interplay hard to reason about (it already needs dedicated test files managerPauseCleanup.test.ts and managerSyncForLaunchSignal.test.ts). Splitting reduces the surface where a missed dropActiveSync/clearPauseIdleTimer wedges state and lets each piece be unit-tested in isolation.
- **Proposed solution:** Extract AwaiterRegistry (createAwaiter/resolve/reject), PauseTimer (arm/clear/onExpire, owns the unref'd timer), ProgressEventFactory (makeProgressEvent + createEmit), and fold activeSyncs+activeLocks into a single SyncRegistry entry so the slot and its lease are added/removed atomically. manager.ts then orchestrates.
- **Touches packages:** No
- **Tests needed:** unit per extracted unit (AwaiterRegistry resolve/reject ordering; PauseTimer arm/clear/expire); existing manager tests should pass unchanged
- **Guideline:** architecture.md — services single-responsibility
- **Verification note:** Responsibility-mixing claim is real and the extractions are sound, but two corrections drop this to P2: (1) the file is 468 lines (counted), still UNDER the CLAUDE.md 500-line limit — so the 'keeps files under 500 / CLAUDE.md violation' citation is WRONG and I removed it; this is architectural hygiene, not a hard guideline breach. (2) Priority lowered P1→P2 since the code is currently correct and well-tested; the value is maintainability, not a defect. Existence of the parallel maps and the six concerns is confirmed by the cited lines.

<a id="ll-032"></a>
#### LL-032 · activeSyncs and activeLocks are two parallel Maps mutated in lock-step by hand

- **Category:** code · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:80-81 (maps), 235-236 (populate), 377-383 (dropActiveSync)
- **Problem:** The manager keys two separate Maps (activeSyncs, activeLocks) by ClientSlug. They are populated together (235-236) and torn down together in dropActiveSync (377-383), but nothing enforces consistency. cancelSync's paused branch calls dropActiveSync (line 166) while the non-paused branch defers teardown to executePreparedSync's finally (324-326), so the two paths drop the pair at different sites and a future edit could delete from one Map but not the other.
- **Why it matters:** Divergent maps keyed by the same id are a classic leak source (lock removed but sync entry lingers, or vice versa). A single SyncRegistry<{active, lease}> makes the broken-invariant state unrepresentable.
- **Proposed solution:** Replace the two Maps with one Map<ClientSlug, {active: ActiveSync; lease: ClientOperationLease}>; dropActiveSync releases the lease and deletes the single entry. ActiveSync already exists, so just carry the lease alongside it at the call site.
- **Touches packages:** No
- **Tests needed:** covered by existing pause/cancel tests once refactored; add an invariant test that every activeSyncs key has a corresponding lease

<a id="ll-033"></a>
#### LL-033 · BundleSyncStatus is flag-soup string union driving control flow, not a discriminated union

- **Category:** code · **Priority:** P2 · **Effort:** large · **Change risk:** medium · **Flow:** Renderer / UI flow
- **Area:** src/shared/contracts/bundle.ts:7-49 (BundleSyncStatuses + BUSY_BUNDLE_STATUSES); manager.ts emits 13 statuses with no payload
- **Problem:** BundleSyncStatus is a 13-member flat string union (bundle.ts:7-21). Terminal vs in-flight vs paused is distinguished only by an out-of-band BUSY_BUNDLE_STATUSES Set (43-49) kept in sync by hand. Status-specific data (error code/message, progress snapshot) rides on separate sibling events (BundleErrorEvent, BundleProgressEvent) rather than as a discriminated payload, so the renderer correlates three event streams to reconstruct one state machine. No assertNever exhaustiveness check exists over these statuses anywhere.
- **Why it matters:** code-guideline.md mandates discriminated unions + assertNever exhaustiveness and warns against flag soup. The parallel-Set means adding a status (e.g. a future VERIFYING) silently omits it from busy-detection. A discriminated union would let TS enforce every status is handled in the renderer reducer.
- **Proposed solution:** Model BundleSyncState = {phase:'idle'} | {phase:'downloading'; progress} | {phase:'error'; code; message} | {phase:'completed'} ... and derive isBusy/isTerminal as exhaustive switch helpers with assertNever instead of a hand-maintained Set. Keep the wire-level string consts but compute classifications from the union.
- **Touches packages:** No
- **Tests needed:** unit: exhaustiveness test that isBusy/isTerminal cover every phase via assertNever; zod round-trip for the union
- **Guideline:** code-guideline.md — discriminated unions + assertNever exhaustiveness; flag-soup status enums

<a id="ll-034"></a>
#### LL-034 · getInstallState fabricates signatureMatches:true and installed:false while a sync is active

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:170-178
- **Problem:** When a sync is active, getInstallState returns {installed:false, signatureMatches:true, progress: active.lastProgress} (172-177). signatureMatches:true is a fabricated constant unrelated to on-disk-vs-remote, and installed:false is reported even when a fully-installed client is merely mid-re-sync (e.g. a force/repair on an already-installed bundle). The renderer uses installed/signatureMatches to pick affordances, so repairing an installed bundle momentarily reports it as not installed.
- **Why it matters:** Conflating 'a sync is running' with 'not installed' can flip the UI from Play to Download mid-operation; signatureMatches:true is meaningless during a sync. The contract documents installed = 'a successful sync produced a local manifest' (bundle.ts:148-149), which this violates while a re-sync runs.
- **Proposed solution:** While a sync is active, derive installed from whether a local manifest already exists on disk (loadLocalManifest) rather than hardcoding false, and either omit signatureMatches or compute it. Better: return a dedicated 'syncing' discriminant carrying lastProgress instead of overloading the install-state booleans.
- **Touches packages:** No
- **Tests needed:** unit: active sync over an already-installed client returns installed:true (or a syncing discriminant), not installed:false

<a id="ll-035"></a>
#### LL-035 · Hand-rolled sha256 streaming duplicated 3x; minecraft-kit centralizes file integrity

- **Category:** dependency-extraction · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/download.ts:128/146-148, plan.ts:36-43 (hashFile), api.ts:21 (sha256 string)
- **Problem:** createHash('sha256') stream/string hashing is re-implemented in three bundle files: download.ts:128 verifies the streamed body, plan.hashFile (36-43) re-hashes on-disk files, api.ts:21 hashes the manifest text. minecraft-kit centralizes file integrity in its verify/repair pipeline (algorithm 'sha1'|'sha256', index.d.ts:2695/2700 — verified), and the launcher already depends on kit for healing.
- **Why it matters:** Three copies of crypto-streaming each carry their own error handling (plan.hashFile has no explicit stream cleanup on the resolve path — no destroy()/close on success) and drift risk. A single shared hashFile/hashBuffer helper removes duplication and gives one place to get backpressure/cleanup right.
- **Proposed solution:** Introduce one shared sha256File(absPath, signal?) / sha256String helper in a launcher infra module and use it from plan/download/api. If kit exposes (or is extended to expose) a public file-hash util matching its internal verify hashing, prefer importing that to keep the algorithm identical to the healer's verify pass.
- **Touches packages:** Yes — minecraft-kit. minecraft-kit does NOT currently export a standalone file-hash helper (hashing is internal to verify/repair; confirmed — no hashFile in the index.d.ts export list). Extracting one (e.g. hashFile(path, algorithm)) into kit would require a kit dist rebuild + copy into launcher node_modules. Otherwise consolidate within the launcher only (no package change).
- **Tests needed:** unit: shared hashFile matches a known vector and propagates stream errors

<a id="ll-036"></a>
#### LL-036 · Cooperative pause re-implemented with boolean flags + AbortController abuse instead of kit's PauseController

- **Category:** dependency-extraction · **Priority:** P2 · **Effort:** large · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:114-124/126-143, runner.ts:93-94, syncState.ts:60-70
- **Problem:** Pause sets task.paused=true and abort.abort() to interrupt in-flight downloads (manager.ts:118-121), then re-creates a fresh AbortController on resume (resetTaskForResume, syncState.ts:63). Workers cooperatively check task.paused at file boundaries (runner.ts:94, runSyncPhases 217/223). minecraft-kit exports PauseController (index.d.ts:1113, confirmed in export list) — a cooperative pause primitive with waitWhilePaused() at safe checkpoints, designed to be independent from AbortSignal so abort and pause don't conflate. The healer path already drives kit operations.
- **Why it matters:** Conflating pause with abort means a paused download must be fully discarded and re-requested on resume (no in-flight resume), and the abort signal means both 'cancel' and 'pause' — exactly the ambiguity executePreparedSync must untangle (manager.ts:312-319 branches on task.cancelled vs task.paused after an ABORTED). PauseController separates the two axes and lets queued work wait rather than be torn down.
- **Proposed solution:** Adopt kit's PauseController for the pause axis and reserve AbortController strictly for cancel. Workers call waitWhilePaused() at boundaries; cancel keeps using abort. Removes the cancelled-vs-paused disambiguation scattered through executePreparedSync and runSyncPhases.
- **Touches packages:** No. PauseController is already exported by minecraft-kit (index.d.ts:1113, in the public export list); no package change/dist rebuild needed — just import it.
- **Tests needed:** unit: pause mid-download leaves queued entries waiting (not drained); resume continues without re-fetching completed files; cancel still aborts

<a id="ll-037"></a>
#### LL-037 · Progress throttling + speed-window logic hand-rolled in two places; kit ships createInstallProgressTracker

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/runner.ts:59-91 (maybeEmit), healProgress.ts:6-79; constants/bundle.ts:13 vs healProgress.ts:6
- **Problem:** runner.maybeEmit (59-91) implements time-throttled emission + a sliding speed window; healProgress.ts (6-79) implements a second, separate throttle (HEAL_PROGRESS_THROTTLE_MS=100 hardcoded at line 6, with pendingFlush setTimeout/unref/clearPendingFlush/scheduleFlush). minecraft-kit exports createInstallProgressTracker(plan, {throttleMs}) (index.d.ts:2884 — confirmed) plus ProgressStages, an aggregator built for throttle + byte/file accounting, already used implicitly by the healer's kit calls.
- **Why it matters:** Two bespoke throttle implementations with their own timers are more code to keep correct (healProgress needs unref + clearPendingFlush + scheduleFlush to avoid leaks). The 100ms constant is duplicated: BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS (constants/bundle.ts:13) and a separate hardcoded HEAL_PROGRESS_THROTTLE_MS (healProgress.ts:6).
- **Proposed solution:** Evaluate replacing the bundle download throttle with createInstallProgressTracker (or factor one shared throttle util used by both runner and healProgress). At minimum unify the two 100ms constants — the heal throttle is an inline magic literal that should reference a named const.
- **Touches packages:** No. createInstallProgressTracker is already exported (index.d.ts:2884); no dist change. The bundle download plan shape differs from kit's InstallPlan, so full reuse may need a thin adapter rather than a package change.
- **Tests needed:** unit: throttle emits at most once per interval; final force-emit always fires
- **Guideline:** code-guideline.md — no magic literals (HEAL_PROGRESS_THROTTLE_MS is an inline literal in healProgress.ts:6, duplicating the named BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS)

<a id="ll-038"></a>
#### LL-038 · In-flight downloads continue after the first worker error before abort propagates

- **Category:** performance · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/runner.ts:121-130 (worker fan-out catch), download.ts:160-170
- **Problem:** When one worker throws, the catch only does task.pendingDownloads.length = 0 (runner.ts:126) to stop NEW pulls; it does NOT call task.abort.abort(). Other workers' currently-streaming downloads run to completion (download.ts only aborts on options.signal, lines 160-170). So on a hard failure the sync keeps streaming up to BUNDLE_DOWNLOAD_CONCURRENCY-1 more files before Promise.all (line 130) settles, even though the sync is doomed.
- **Why it matters:** Wasted bandwidth/CPU and delayed error surfacing on failure, plus partially-written extra files that need re-planning. Aborting immediately on first error makes failure crisp.
- **Proposed solution:** In the worker catch, also call task.abort.abort() (a distinct internal abort) so concurrent downloads stop streaming at once. Guard so this internal abort isn't misclassified as a user cancel (pause/cancel already overload abort) — use a separate internal-abort flag.
- **Touches packages:** No
- **Tests needed:** unit: with concurrency>1, first file failing aborts the others' in-flight streams quickly (assert their downloadEntry rejects with ABORTED)

<a id="ll-039"></a>
#### LL-039 · completePreparedSync persists manifest then emits terminal status — persist failure invisible beyond a warn

- **Category:** error-handling · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/services/bundle/manager.ts:330-349 (completePreparedSync + persistLocalManifest)
- **Problem:** persistLocalManifest swallows save errors with a warn (346-348) and never demotes the op — correctly following the 'do not demote a successful op on trailing bookkeeping failure' guideline. But completePreparedSync awaits persist (331) THEN emits COMPLETED/UP_TO_DATE and resolves awaiters (332-333). If saveLocalManifest fails, the user sees COMPLETED, but the next getInstallState (187) finds no/stale local manifest and reports installed:false or a signatureMatches mismatch — a silent inconsistency between the broadcast 'completed' and persisted state, surfaced only as a warn log.
- **Why it matters:** The files are correctly on disk so 'completed' is defensible, but the persisted manifest is the source of truth for installed/drift detection. A persist failure invisible beyond a warn means the very next checkStatus contradicts the completion the user just saw, with no telemetry/affordance to re-run.
- **Proposed solution:** Keep not-demoting, but make the inconsistency observable: on persist failure emit a distinct non-fatal warning event the renderer can act on, or schedule a best-effort manifest re-write, and log at error level (currently only warn) so operators can detect a persistent sidecar write failure (e.g. read-only .loontail dir).
- **Touches packages:** No
- **Tests needed:** unit: saveLocalManifest rejects → status still COMPLETED, awaiters resolve, AND a warn/event is emitted; getInstallState afterwards is consistent with the surfaced warning

<a id="ll-040"></a>
#### LL-040 · Unused/duplicated error codes and test-only exports leak into the contract and manager

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/shared/contracts/bundle.ts:51-64 (BundleErrorCodes); manager.ts:216 (UNKNOWN for client-not-found), 466-467 (_internals/type re-export)
- **Problem:** BundleErrorCodes defines NO_BUNDLE_SLUG (bundle.ts:52) but the missing-bundle path uses BundleSyncStatuses.NO_BUNDLE (manager.ts:221) and never emits that code; runSync throws UNKNOWN for 'Client not found' (manager.ts:216) where a dedicated code would be clearer. manager.ts:466 exports _internals = { flattenRemote } 'only for tests' and re-exports ActiveSync/SyncPlan types — test-only surface in the production module.
- **Why it matters:** Dead/duplicated error codes erode the named-const error model (the guideline mandates error codes as a single source of truth), and the test-only _internals export bloats the public surface of the largest file.
- **Proposed solution:** Remove or wire up NO_BUNDLE_SLUG (delete it, or use it where bundleSlug is absent if that should be an error); introduce a CLIENT_NOT_FOUND code instead of UNKNOWN at manager.ts:216; move flattenRemote's test access to import it directly from manifestSnapshot.ts (where it lives) and drop the _internals re-export.
- **Touches packages:** No
- **Tests needed:** unit: each BundleErrorCode is reachable from some throw site (coverage/grep test)
- **Guideline:** code-guideline.md — error codes as named consts / single source of truth
- **Verification note:** The NO_BUNDLE_SLUG dead code (bundle.ts:52 vs NO_BUNDLE status at manager.ts:221), the UNKNOWN-for-client-not-found (manager.ts:216), and the test-only _internals/type re-export (manager.ts:466-467) are all REAL and verified. BUT the finding's claim that 'classifyBundleError collapses HttpError detail from api.ts to UNKNOWN' is WRONG: api.ts already converts HttpError into a typed BundleError (MANIFEST_FETCH_FAILED, api.ts:56-71) BEFORE it propagates, so classifyBundleError (errors.ts:15) returns that code via the `instanceof BundleError` branch — no HttpError ever reaches classifyBundleError unwrapped. I removed that incorrect sub-claim and the corresponding 'IpcError detail lost' reasoning and architecture.md citation. flattenRemote already lives in manifestSnapshot.ts (verified), so the fix is trivial. Remaining sub-claims confirmed; kept P3.

<a id="ll-041"></a>
#### LL-041 · cleanEmptyDirs invoked per-deleted-file — redundant syscalls and repeated warns on a locked dir

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/runner.ts:145-165 (cleanEmptyDirs), 188 (call site)
- **Problem:** cleanEmptyDirs walks parents after each delete and rmdir's empty ones. On ENOTEMPTY it returns (correct, 156-157), on ENOENT it keeps walking (154-155), but on any other error (EPERM/EACCES from AV/locks on Windows) it logs a warn and returns (159-160). It is invoked per-deleted-file (line 188), so on a large delete set with a locked directory it re-attempts and re-warns for every sibling delete, and the partially-cleaned tree is never reconciled.
- **Why it matters:** Per-file invocation means O(deletes) redundant readdir/rmdir syscalls up the same parent chain, and repeated warns spam the log on a single locked dir. Minor correctness: orphan empty dirs may linger and won't be retried.
- **Proposed solution:** Collect the set of distinct leaf parent dirs touched during the delete phase and run cleanEmptyDirs once per unique dir after all deletes (dedupe by dirname), instead of after every unlink.
- **Touches packages:** No
- **Tests needed:** unit: deleting N files in one dir triggers a single empty-dir cleanup pass, not N

<a id="ll-042"></a>
#### LL-042 · resumeSync silently spawns a fresh sync when no paused entry exists, swallowing failures

- **Category:** flow · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:126-134 (resumeSync no-active branch), routes.ts:21-24
- **Problem:** When resumeSync is called for a slug with no activeSyncs entry, it fire-and-forgets void this.startSync({slug}).catch(warn) (manager.ts:130-132). The IPC handler (routes.ts:21-24) returns void synchronously, so the renderer's 'Resume' click can trigger a brand-new full sync whose failure is only logged in main, never surfaced to the UI. A user expecting to resume a paused download instead silently starts (and possibly fails) a fresh one.
- **Why it matters:** Resume and start are conflated on a path the renderer can't observe. If the fresh sync throws (OP_IN_FLIGHT from a racing op, NO_CLIENT_FOLDER), the only signal is a main-process warn; the UI shows nothing. This conflicts with the IPC error-surfacing model where operation outcomes should reach the renderer.
- **Proposed solution:** Either make resumeSync surface a result the renderer can see (so 'nothing to resume' is explicit), or have the renderer call startSync for the cold-start case. At minimum emit a status/error event on the broadcaster so the fresh-sync failure reaches the UI instead of only the log.
- **Touches packages:** No
- **Tests needed:** unit: resume with no active entry whose startSync rejects emits an error event to the broadcaster
- **Guideline:** architecture.md — IPC error model / operation outcomes surfaced to renderer

<a id="ll-043"></a>
#### LL-043 · downloadEntry recomputes sha256 over the full stream every run with no Range/partial-file resume

- **Category:** performance · **Priority:** P3 · **Effort:** large · **Change risk:** high · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/download.ts:108-205, syncState.ts:60-70 (resetTaskForResume), runner.ts:99-110
- **Problem:** downloadEntry always writes ${dest}.tmp from byte 0 with no HTTP Range/resume — a paused-then-resumed large file is fully re-downloaded and re-hashed (resetTaskForResume zeroes bytesDownloaded, syncState.ts:65). The .tmp from a prior interrupted run is unconditionally rm'd (download.ts:122). For multi-hundred-MB assets over a flaky link this is wasteful.
- **Why it matters:** Pause/resume is a first-class feature, yet resume re-downloads in-progress files from scratch. Range-resume would make pause genuinely cheap. The sha256 must be computed over what is written, but re-downloading the whole file to re-hash a partial is avoidable.
- **Proposed solution:** Support HTTP Range resume: keep the .tmp, stat its size, request Range: bytes=<size>- when the server advertises Accept-Ranges, seed the hash by reading the existing partial, and append. Fall back to full re-download when Range isn't honored. Pairs naturally with the PauseController change.
- **Touches packages:** No
- **Tests needed:** integration: pause after partial bytes, resume issues a Range request and final sha256 matches; server-without-Range falls back to full download

### Minecraft install / launch / repair / uninstall flow

<a id="ll-044"></a>
#### LL-044 · Repair progress adapter re-implements kit's createInstallProgressTracker by hand

- **Category:** dependency-extraction · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/progressAdapter.ts:104-225 (createRepairProgressAdapter, createThrottledProgressEmitter, progressStageForDownloadCategory/VerifyCategory/Aspect)
- **Problem:** The install path uses the kit's createInstallProgressTracker (progressAdapter.ts:52-67, createPlannedProgressAdapter), but the repair path (createRepairProgressAdapter, lines 169-225) hand-rolls a parallel ~120-line state machine: a 100ms throttle (createThrottledProgressEmitter), manual stage transitions on DOWNLOAD/VERIFY events, and three bespoke category->stage maps. The kit's d.ts for InstallProgressTracker (line 2848-2864) states onEvent can be wired into 'install.run / repair.run' alike, duplicating aggregation/throttling/percent logic the kit owns.
- **Why it matters:** Two divergent progress code paths means stage-mapping and percent math drift between install and repair (visible: repair emits stagePercent===overallPercent from a single file's bytes at progressAdapter.ts:134-139, while planned install emits a true overall percent from the tracker's ProgressSnapshot). It is ~120 lines of untested-edge logic that should not exist in the launcher.
- **Proposed solution:** Feed the repair flow through createInstallProgressTracker and subscribe to its ProgressSnapshot like createPlannedProgressAdapter does, deleting createThrottledProgressEmitter and the manual stage maps. The blocker is that repair.all is a verify+repair pass with no upfront InstallPlan, so the tracker (which takes Pick<InstallPlan,'actions'>, d.ts:2884) cannot be constructed from it — request a kit tracker variant that accepts the verify+repair (repair.all) event stream without an upfront plan. Keep a thin slug->emitSnapshot bridge.
- **Touches packages:** Yes — minecraft-kit. createInstallProgressTracker currently requires Pick<InstallPlan,'actions'> (d.ts:2884) which repair.all does not produce, so add a tracker constructor/overload in minecraft-kit that aggregates a verify+repair event stream without an upfront plan, then rebuild dist and copy into loontail-launcher/node_modules. If a repair.run plan IS available at the call site, no kit change is needed and this is pure launcher deletion.
- **Tests needed:** unit: repair progress adapter emits monotonic overallPercent across runtime->minecraft->loader stages from a recorded kit event sequence; parity test that install and repair adapters map the same DownloadCategory to the same ProgressStage.
- **Guideline:** docs/architecture.md 8.3 (lean on kit contracts; do not re-implement kit-owned logic); CLAUDE.md dependency-extraction directive (replace duplication with existing export)

<a id="ll-045"></a>
#### LL-045 · Manual launch preflight file-walk duplicates kit.verify.targetReady

- **Category:** dependency-extraction · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Launch flow
- **Area:** src/main/services/minecraft/launch.ts:97-146 (requireLaunchFile, verifyLaunchPreflight)
- **Problem:** verifyLaunchPreflight hand-walks java path, resolveLaunchVersion, versionJson, versionJar, and every classpath entry with fs.access (lines 109-146). The kit exports kit.verify.targetReady.run(target) -> TargetReadinessResult { isReady, issues } (d.ts 2528-2534, 3665-3666) that aggregates every launch-critical aspect for the target, with each issue tagged kind: VerificationKind (runtime/minecraft/forge/fabric, d.ts 2516-2518).
- **Why it matters:** The bespoke walk only checks a fixed file list and cannot know loader-specific launch-critical files the kit tracks; it can pass preflight on a subtly-broken Forge/Fabric install that targetReady would flag. It also duplicates resolveLaunchVersion error handling the kit encapsulates.
- **Proposed solution:** Replace verifyLaunchPreflight with env.kit.verify.targetReady.run(ctx.target, { signal }); on !isReady, map readiness.issues to a LaunchPreflightError with NOT_INSTALLED (or RUNTIME_ERROR when an issue's kind === VerificationKinds.RUNTIME), preserving the current 'stay INSTALLED + offer repair' behaviour.
- **Touches packages:** No. None — kit.verify.targetReady already exists and is exported (d.ts 3665). Pure launcher refactor.
- **Tests needed:** unit: launch preflight surfaces readiness issues as repairable LaunchPreflightError and keeps status INSTALLED (extend launch.test.ts, mocking kit.verify.targetReady.run); add a Forge case proving loader-aware coverage.
- **Guideline:** docs/architecture.md 8.3; CLAUDE.md dependency-extraction directive

<a id="ll-046"></a>
#### LL-046 · Forge processor healing reaches into kit-internal action shapes (InstallActionKinds, RunForgeProcessorAction.outputs) and re-hashes by hand

- **Category:** dependency-extraction · **Priority:** P1 · **Effort:** large · **Change risk:** high · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:45-187 (processorActionsFrom, processorOutputsOk, brokenProcessorIndices, repairMissingForgeProcessorOutputs); also rememberForgeProcessorActions cache
- **Problem:** This 188-line module reaches deep into kit internals: filters plan.actions by InstallActionKinds.RUN_FORGE_PROCESSOR (lines 48-51), reads RunForgeProcessorAction.outputs/index (92, 105), re-implements streaming SHA-1 (sha1OfFile, 64-76) to decide which processors to re-run, then synthesizes a focused InstallPlan ({...plan, totalActions, totalBytes}, 168-173). The kit owns the Forge install/processor pipeline and exports planForgeRepair (d.ts 4342), repairAll, and processor events.
- **Why it matters:** The launcher duplicates integrity hashing and plan reconstruction the kit already does internally, so a kit change to processor output verification silently breaks the launcher. It is the single most kit-coupled file in the area and the hashing/plan-surgery is kit-owned domain logic.
- **Proposed solution:** Push processor-output healing into the kit as a first-class repair surface (planForgeRepair already targets 'the Forge processors that produce the final installation' per d.ts 4324). Have the launcher call kit.repair.forge / repairAll and delete forgeProcessorHealing.ts. If a focused 'only re-run broken processors' mode is missing upstream, add it there rather than reconstructing plans in the launcher.
- **Touches packages:** Yes — minecraft-kit. Add/extend a Forge processor-output repair in minecraft-kit (verify processor outputs by their declared SHA-1 and re-run only broken ones, reusing the existing install runner), exposed via kit.repair.forge or kit.repair.all; rebuild dist and copy into loontail-launcher/node_modules. Then delete launcher forgeProcessorHealing.ts and its cache.
- **Tests needed:** integration: repair of a Forge install with a corrupted processor output (e.g. <mc>-srg.jar) re-runs only that processor and reports INSTALLED; unit in kit for the broken-output detection.
- **Guideline:** docs/architecture.md 8.3 (kit-internal contract coupling); CLAUDE.md dependency-extraction directive (extract generic launcher logic INTO the package)
- **Verification note:** Real and accurately described; all cited lines verified. Adjusted only the 'architecture doc explicitly lists this exact coupling (InstallActionKinds)' framing: architecture.md 8.3 (lines 285-289) lists InstallActionKinds, RepairFromErrorSupportedCodes, EventTypes as the acknowledged couplings but does NOT name RunForgeProcessorAction or the hand-rolled hashing/plan-surgery — those are beyond the doc's acknowledged surface, which strengthens (not weakens) the finding. The well-commented rationale (lines 110-114, 153-160) shows this is a deliberate workaround for a genuine kit gap (verify.forge does not track processor outputs), so the kit-side fix is the right resolution. effortClass=large and risk=high are appropriate.

<a id="ll-047"></a>
#### LL-047 · Kit coupling surface is unbounded — no adapter narrows kit-internal contracts behind services/kit.ts

- **Category:** architecture · **Priority:** P1 · **Effort:** large · **Change risk:** medium · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/kit.ts:1-9 (createKit only); coupling spread across launch.ts:3-22, forgeProcessorHealing.ts:4-13, progressAdapter.ts:1-12, repairWorkflow.ts:1-7, installManifest.ts:13/45 (createRequire of kit package.json)
- **Problem:** services/kit.ts is only a 9-line factory (new MinecraftKit). Every minecraft module imports kit types and value-constants directly: EventTypes, InstallActionKinds, DownloadCategories, VerifyFileCategories, VerificationKinds, RunForgeProcessorAction, ProgressListener, RepairAllReport, targetPaths, resolveLaunchVersion, toOnlineAuth, asAzureClientId, etc. architecture.md 8.3 names this accepted-but-deliberate coupling but provides no adapter boundary, so the surface is as wide as the kit's public+semi-internal API.
- **Why it matters:** A kit version bump can break a dozen launcher files at once with no single choke point; it makes the launcher hard to test without faking the full MinecraftKit shape (managerLaunch.test.ts casts `{ targets: { resolve } } as unknown as MinecraftKit`, line 120-124). The doc acknowledges the coupling but the codebase has not narrowed it.
- **Proposed solution:** Grow services/kit.ts into a thin adapter exposing only the operations the launcher needs (plan/install/repair/verify-ready/compose/launch) returning launcher-domain shapes (MinecraftProgressEvent, a readiness result, an install summary), so InstallActionKinds/EventTypes/RunForgeProcessorAction live in one place. Migrate modules to depend on the adapter, not on '@loontail/minecraft-kit' value imports.
- **Touches packages:** No. None to the package itself; purely a launcher-side adapter. (Pairs naturally with the progress-tracker and targetReady findings, which move logic INTO the adapter.)
- **Tests needed:** unit: adapter maps kit events->MinecraftProgressEvent and kit errors->MinecraftErrorCode; existing manager/launch tests then fake the adapter instead of the whole kit.
- **Guideline:** docs/architecture.md 8.3 (single choke point for kit coupling) and 'IPC contract single source of truth' spirit applied to the kit boundary
- **Verification note:** Confirmed the substance: kit.ts is a 9-line factory, and value-constant imports are spread across launch.ts, forgeProcessorHealing.ts, progressAdapter.ts, repairWorkflow.ts, errors.ts, context.ts, install.ts. Adjusted the managerLaunch.test.ts citation: the cast is `{ targets: { resolve: vi.fn() } } as unknown as MinecraftKit` (lines 120-124), not `{} as unknown as MinecraftKit` as worded; repairWorkflow.test.ts uses `{} as MinecraftKit` (line 78). Substance unchanged — both confirm tests must fake the whole kit shape. Note architecture.md 8.3 frames the coupling as intentional for a single-team 0.x kit, so this is a 'narrow the acknowledged surface' improvement, not a guideline violation in the strict sense; priority P1 is defensible but borderline P2 given the doc sanctions the coupling.

<a id="ll-048"></a>
#### LL-048 · Uninstall operation is uncancellable and unguarded against in-flight reads despite holding a delete lock

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Error / recovery flow
- **Area:** src/main/services/minecraft/uninstall.ts:22-59 (runUninstall); ops.ts:27 (UninstallOp has no abort); manager.ts:172-186 (cancel — no UNINSTALL branch); manager.ts:276-289 (cancelAll — excludes UNINSTALL)
- **Problem:** UninstallOp = { kind } has no AbortController (ops.ts:27), cancel() (manager.ts:172-186) has no branch for UNINSTALL, and cancelAll() (manager.ts:281-285) only cancels INSTALL/REPAIR/LAUNCH_STARTING. So a recursive fs.rm of a large client folder (uninstall.ts:34) cannot be interrupted; the user is stuck on UNINSTALLING until rm completes or fails. The delete lock (CLIENT_FOLDER+RUNTIME_COMPONENT+BUNDLE_MANIFEST) is acquired correctly but the operation offers no escape hatch.
- **Why it matters:** On a slow disk or partially file-locked tree the UI shows UNINSTALLING with no Stop affordance, and cancelAll() at shutdown cannot abort it, potentially delaying app exit. Reliability/UX gap in a destructive flow.
- **Proposed solution:** Give UninstallOp an AbortController; pass its signal to a cancellable delete (chunked/iterative rm checking signal between entries, or at least abort the second best-effort pass at uninstall.ts:43-47). Add an UNINSTALL branch to cancel() and include it in cancelAll(). At minimum, document why it is intentionally non-cancellable if that is the decision.
- **Touches packages:** No
- **Tests needed:** unit: cancel during uninstall sets the signal and stops further deletion; cancelAll aborts a pending uninstall op.
- **Guideline:** docs/code-guideline.md (cancellation/AbortSignal end-to-end; try/finally cleanup)

<a id="ll-049"></a>
#### LL-049 · Post-install bundle hook runs after the write-lock is released, leaving a brief pre-bundle-lock window

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/minecraft/manager.ts:128-152 (startInstall .then/.finally) and 316-336 (finishRepair); install.ts:134 (runInstall deletes op in finally)
- **Problem:** startInstall does runInstall(...).then(async () => { lock.release(); emit INSTALLED; await this.launchHook(slug); }).finally(() => lock.release()). The minecraft write lock (CLIENT_FOLDER+RUNTIME_COMPONENT) is released BEFORE awaiting launchHook (the bundle sync), and runInstall already deletes the op in its own finally (install.ts:134). So between INSTALLED emission and the bundle hook acquiring ITS lock, the slug shows no in-flight minecraft op and the CLIENT_FOLDER lock is briefly free. finishRepair (316-336) has the same shape: lock released before the post-repair bundle hook.
- **Why it matters:** The launcher and bundle managers share one operationLocks instance, and the bundle hook (syncForLaunch->runSync) DOES acquire a BUNDLE-domain lock on CLIENT_FOLDER (bundle/manager.ts:231) — so once acquired, a concurrent repair/uninstall/install is correctly blocked. The real gap is the narrow TOCTOU window between minecraft lock.release() and the bundle lock acquire (several awaits: tryGetClient, resolveClientFolder), during which a concurrent minecraft write op could slip in. For bundle-less clients runSync returns before locking (bundle/manager.ts:219-222) but performs no writes, so no race.
- **Proposed solution:** Hold the minecraft lock until the post-install/post-repair bundle hook has acquired its own bundle lock (or simply move lock.release() into a finally that runs after the hook awaits), so there is no unlocked CLIENT_FOLDER window. The double lock.release() (.then + .finally) is also redundant and should be a single release.
- **Touches packages:** No
- **Tests needed:** integration: a repair request issued in the window between INSTALLED and the bundle hook acquiring its lock is rejected with OP_IN_FLIGHT instead of interleaving folder writes.
- **Guideline:** docs/code-guideline.md (try/finally cleanup; do not drop a guard mid-operation); docs/architecture.md (operation-lock invariants)
- **Verification note:** Adjusted: the original claimed a full race where 'a user-triggered repair/uninstall can start and race the bundle writer on the same files'. That is overstated — both managers share the SAME createClientOperationLocks() instance (index.ts:95,104-105), and runSync acquires a BUNDLE-domain lock on CLIENT_FOLDER (bundle/manager.ts:231, resources at 38-39), so once the bundle lock is held, cross-domain minecraft writes are correctly blocked. The genuine residual problem is the narrow pre-acquire TOCTOU window between the minecraft lock.release() and the bundle lock acquire (awaits at bundle/manager.ts:214,224). Severity reduced accordingly but kept P2 because the double lock.release() and unlocked-window are still a real correctness/clarity gap. Solution reframed to 'hand off without releasing the window' rather than 'the bundle writer races unprotected'.

<a id="ll-050"></a>
#### LL-050 · requireIdle + lock acquire is a two-step TOCTOU window; startLaunch acquires no lock

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** IPC flow
- **Area:** src/main/services/minecraft/manager.ts:116-123, 188-200, 211-225, 227-266 (requireIdle then acquireWriteLock); startLaunch (227) does requireIdle but acquires NO operation lock for the launch itself
- **Problem:** Each write entrypoint calls requireIdle(slug) (checks the ops map) and then separately acquireWriteLock (operationLocks). These are two non-atomic steps over two data structures. startInstall/startRepair/uninstall set their op only AFTER awaits (buildContext at 119/196/229), widening the window where requireIdle has passed but no op/lock is set yet. startLaunch (227) acquires NO operation lock at all for the launch — it relies on requireIdle plus a late BundleSyncingOp insertion (243) and the bundle hook's own lock; the actual game launch (runLaunch) holds no CLIENT_FOLDER lock.
- **Why it matters:** Main-process IPC handlers are async and interleave at await points; the ops map and the lock can disagree about who owns the slug. The shared operationLocks DOES catch a second concurrent write op (acquire returns 'blocked'), so the worst case is mitigated for install/repair/uninstall — but two calls that both pass requireIdle before either acquires could both run buildContext before one is rejected. Launch holding no lock means a launch and a bundle/install on the same folder are guarded only by the late ops-map check.
- **Proposed solution:** Make idle-check + claim atomic: treat operationLocks.acquire as the single source of truth (acquire the lock synchronously before the first await, and have requireIdle derive from it). Give startLaunch a read/launch lock so it participates in the same mutual exclusion as install/repair/uninstall.
- **Touches packages:** No
- **Tests needed:** unit: two concurrent startInstall(slug) calls — exactly one proceeds, the other rejects OP_IN_FLIGHT; startLaunch is rejected while an install lock is held.
- **Guideline:** docs/architecture.md (services lifecycle / operation-lock invariants); docs/code-guideline.md (validate at boundaries)
- **Verification note:** Real but slightly overstated, so adjusted. Verified: startInstall (118), startRepair (190), uninstall (213) all acquire the lock synchronously BEFORE the first await (buildContext is awaited after acquireWriteLock in startInstall/uninstall) — so for those, the lock IS the early synchronous claim and the window the finding describes is mostly closed already. startRepair acquires the lock (190) before awaiting buildContext (196), good. requireIdle (291-298) is a separate ops-map check that can momentarily disagree with the lock, but the lock catches the real double-acquire. The genuinely valid half is startLaunch (227-266): it does requireIdle then awaits buildContext (229) with NO lock acquire for the launch, acquiring only the bundle hook's lock indirectly — runLaunch holds no CLIENT_FOLDER lock. Kept P2; reframed to emphasize the startLaunch-no-lock gap as the concrete problem.

<a id="ll-051"></a>
#### LL-051 · verifyAndRepairBase returns RepairAllReport but runRepair discards it, then re-resolves/re-plans

- **Category:** performance · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/repairWorkflow.ts:78-99 (verifyAndRepairBase returns RepairAllReport); repair.ts:40 (return value ignored); repairWorkflow.ts:111-114 (launchVersionResolvable re-resolves); forgeProcessorHealing.ts:138 (re-plans via kit.install.plan)
- **Problem:** verifyAndRepairBase runs kit.repair.all and returns the full RepairAllReport (verifications, repairs map, bytesDownloaded), but runRepair (repair.ts:40) calls it without assigning the result. Then ensureLaunchable independently calls resolveLaunchVersion again (repairWorkflow.ts:111-114) and healForgeProcessors independently re-runs kit.install.plan (forgeProcessorHealing.ts:138). So the repair workflow performs sequential verify/plan/resolve passes over the same target, much of which the first repair.all already computed.
- **Why it matters:** Redundant disk/CPU work on every manual repair (re-planning a Forge install, re-resolving the launch version) and lost diagnostic signal — the RepairAllReport that would tell whether anything was actually broken is thrown away, so the workflow cannot short-circuit.
- **Proposed solution:** Thread the RepairAllReport from verifyAndRepairBase through runRepair into ensureLaunchable/healForgeProcessors so they can skip work the report already proves done (e.g. if the loader aspect verified clean and version JSON was written, skip the focused re-plan / ensureLaunchable). At minimum, return and log repaired-bytes/aspect counts for observability.
- **Touches packages:** No
- **Tests needed:** unit: a clean install repaired returns early without re-planning the install (assert kit.install.plan not called when the report shows nothing broken and the launch version resolvable).

<a id="ll-052"></a>
#### LL-052 · launch.ts (383 lines) mixes auth resolution, JVM-arg building, preflight, process supervision, and console wiring

- **Category:** architecture · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Launch flow
- **Area:** src/main/services/minecraft/launch.ts:1-383 — resolveLaunchAuth (183-226), buildYggdrasil*Arg/sanitize (78-95), verifyLaunchPreflight (109-146), runLaunch event switch + supervision (228-377), endLaunch (148-171)
- **Problem:** A single file owns five distinct concerns. runLaunch alone spans ~150 lines (228-377) with a deeply nested onEvent switch (291-322), four separate startupSignal.aborted checks (263,269,274,324,350), console-hub side effects interleaved with status emission, and a triple-.catch exited-promise supervision chain (339-348). resolveLaunchAuth embeds Yggdrasil placeholder-client-id and HTTP-agent sanitation logic.
- **Why it matters:** The file is hard to test in isolation — launch.test.ts must stub electron, consoleHub, store, config, logger, windows (lines 47-70+) just to exercise one path — and hard to change safely; the repeated abort checks and triple-catch are a smell of conflated responsibilities.
- **Proposed solution:** Split into launchAuth.ts (resolveLaunchAuth + JVM-arg builders), launchPreflight.ts (verify, ideally collapsing into kit.verify.targetReady per the related finding), and launchProcess.ts (runLaunch supervision + endLaunch + console wiring). Factor the five startupSignal.aborted guards into a single helper. Keep runLaunch as an orchestrator under ~120 lines.
- **Touches packages:** No
- **Tests needed:** unit: launchAuth resolves mojang/yggdrasil/offline shapes; existing supervision tests move to launchProcess. No behaviour change intended.
- **Guideline:** CLAUDE.md (keep files under 500 lines — borderline; single-responsibility); docs/code-guideline.md (no nested control where a discriminated-union handler would do)
- **Verification note:** Confirmed the five concerns and the testability burden (launch.test.ts mocks electron/config/consoleHub/logger/store/windows). Adjusted two specifics: the file is 383 lines (not 382), and there are FIVE startupSignal.aborted checks (lines 263,269,274,324,350) not four. The finding says 'four' — corrected to five in area/solution. Substance unchanged. CLAUDE.md's 500-line limit is not breached, so that part of the guidelineViolation is aspirational; the single-responsibility concern is the real driver. Priority P2 is fair.

<a id="ll-053"></a>
#### LL-053 · endLaunch always emits INSTALLED on game exit and blindly deletes the op without ownership check

- **Category:** flow · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Launch flow
- **Area:** src/main/services/minecraft/launch.ts:148-171 (endLaunch) and 339-348 (session.exited handler)
- **Problem:** endLaunch unconditionally emits status INSTALLED after the game process exits (line 170) and deletes the op (line 149) without checking whether env.ops.get(slug) still references this launch's LaunchOp. Because the game session is long-lived and the manager intentionally leaves launches alone at shutdown, by the time the process exits the slug's true on-disk state could differ, and a foreign op could be clobbered.
- **Why it matters:** Launch holds no operation lock (see TOCTOU finding), so if any new op were established for the slug during a running game, endLaunch's blind ops.delete(slug) and INSTALLED emission could clobber it. Even absent a race, emitting INSTALLED without re-deriving presence can mislabel a folder the user deleted out-of-band during play.
- **Proposed solution:** In endLaunch, only delete the op if env.ops.get(slug) is the expected LaunchOp, and derive the post-exit status from resolveClientInstallPresence (as readinessPolicy and repairWorkflow.emitReadinessStatus do) instead of hard-coding INSTALLED.
- **Touches packages:** No
- **Tests needed:** unit: endLaunch emits NOT_INSTALLED when the folder was removed during play; endLaunch does not delete a foreign op.
- **Guideline:** docs/code-guideline.md (do not assume state; derive it)
- **Verification note:** Confirmed: endLaunch (148-171) does env.ops.delete(slug) (149) and emits InstallStatuses.INSTALLED (170) unconditionally, with no ops.get ownership check, and the presence-derivation pattern it should follow exists in readinessPolicy.resolveClientInstallPresence (readinessPolicy.ts:20-29) and repairWorkflow.emitReadinessStatus (52-64). Adjusted effortClass from the original 'quick' — it remains quick for the ownership guard, but deriving status via resolveClientInstallPresence adds an async read on a hot exit path, nudging toward quick/medium; kept 'quick' as the guard is the load-bearing fix. Real, low-severity correctness hardening.

<a id="ll-054"></a>
#### LL-054 · installManifest re-implements assertNever and kit-version discovery instead of using kit exports

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/minecraft/installManifest.ts:13,37-50 (createRequire + parsePackageVersion + local assertNever)
- **Problem:** installManifest defines its own assertNever (lines 48-50) although the kit exports assertNever with an identical (value: never) => never signature (d.ts:764). It also derives MINECRAFT_KIT_VERSION via createRequire('@loontail/minecraft-kit/package.json') (lines 13,45) and a bespoke parsePackageVersion (37-43) to stamp manifests, reaching into the package's package.json at runtime.
- **Why it matters:** assertNever duplication contradicts the codebase rule to use the kit's exhaustiveness helper; the createRequire-of-package.json is a fragile way to learn the kit version and couples the manifest format to a runtime require that can break under bundling/asar if the path is not externalized.
- **Proposed solution:** Import assertNever from '@loontail/minecraft-kit'. For the version stamp, prefer a kit-exported version constant if one exists, or pin it through build-time config rather than runtime createRequire; if runtime require must stay, centralize it in one infra helper.
- **Touches packages:** Yes — minecraft-kit. Optionally export a KIT_VERSION/version constant from minecraft-kit so consumers need not require package.json; rebuild dist + copy. assertNever needs no kit change (already exported, d.ts:764).
- **Tests needed:** unit: existing installManifest tests still pass; add one asserting exhaustiveness via the kit assertNever for an unknown loader.
- **Guideline:** docs/code-guideline.md (discriminated unions + assertNever from the shared source); CLAUDE.md dependency-extraction

<a id="ll-055"></a>
#### LL-055 · Hand-rolled SHA-1 hashing in forge healing duplicates integrity validation the kit owns

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:64-98 (sha1OfFile, fileMissing, processorOutputsOk)
- **Problem:** sha1OfFile (64-76) streams a file through node:crypto and compares to action.outputs hashes, and processorOutputsOk (91-98) walks declared outputs. This is integrity-verification logic the kit performs internally for every install/verify action (INTEGRITY_HASH_MISMATCH path) and is conceptually the same shape as buffer validation the loontail packages centralize (e.g. validatePngBuffer in yggdrasil-core).
- **Why it matters:** Integrity checking is core domain logic that should live once, in the package that owns the install pipeline. Re-implementing streaming SHA-1 in the launcher risks subtle divergence (encoding, large-file streaming, error swallowing returning null at line 73-75) from the kit's authoritative check.
- **Proposed solution:** When forge processor healing moves into the kit (see the dedicated finding), this hashing disappears with it. If any file-integrity need remains launcher-side, request a kit-exported verifyFileSha1/checkIntegrity helper rather than re-rolling crypto.
- **Touches packages:** Yes — minecraft-kit. Covered by the forge-processor healing extraction; the kit already hashes internally, so exposing/relying on it removes this launcher code. Rebuild dist + copy if a new helper is exported.
- **Tests needed:** covered by the forge processor repair integration test.
- **Guideline:** CLAUDE.md dependency-extraction (PNG/integrity validation lives in core, not re-implemented in launcher)

<a id="ll-056"></a>
#### LL-056 · Kit-error -> launcher-code mapping is incomplete and silently collapses unknown failures to KIT_ERROR

- **Category:** error-handling · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/services/minecraft/errors.ts:14-35 (KIT_CODE_TO_LAUNCHER_CODE, classifyError)
- **Problem:** KIT_CODE_TO_LAUNCHER_CODE maps only 11 kit codes; everything else falls through to MinecraftErrorCodes.KIT_ERROR (line 32). The kit exports a much larger MinecraftKitErrorCodes set (and isErrorCode), but the launcher has no compile-time guarantee that newly added kit codes get a deliberate mapping — they silently become the generic KIT_ERROR, losing the renderer's ability to offer a targeted action (e.g. a disk-space or permission code becoming a vague 'kit error').
- **Why it matters:** Renderer toasts/repair offers branch on code (architecture.md 9: the UI decides on code, not message). Collapsing the long tail to KIT_ERROR degrades UX for exactly the failures most worth distinguishing, and there is no test or exhaustiveness check to catch a kit code that should map to NETWORK/INTEGRITY/RUNTIME.
- **Proposed solution:** Add the remaining repair-relevant kit codes (disk/permission/integrity variants) to the map, and add a unit test that iterates MinecraftKitErrorCodes asserting each maps to something other than the generic fallback OR is explicitly acknowledged as intentionally generic. Consider keying the renderer's repair offer off RepairFromErrorSupportedCodes so 'repairable' is sourced from the kit.
- **Touches packages:** No
- **Tests needed:** unit: every MinecraftKitErrorCode classifies to an intended MinecraftErrorCode (snapshot/allowlist test) so new kit codes force a deliberate mapping decision.
- **Guideline:** docs/architecture.md 9 (UI decides on code, not message); docs/code-guideline.md (named error codes; exhaustiveness)

<a id="ll-057"></a>
#### LL-057 · Forge processor action cache is an unbounded module-global Map with no live eviction caller

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:18,53-62 (forgeProcessorActionsCache, rememberForgeProcessorActions, clearForgeProcessorActionCache)
- **Problem:** forgeProcessorActionsCache (line 18) is a process-lifetime module-level Map keyed by JSON.stringify([directory, version, fullVersion, installerUrl]) that is only ever cleared by the exported clearForgeProcessorActionCache (60-62) — and a repo grep finds NO caller of it in src/. Each distinct Forge target install/repair adds an entry holding the full RunForgeProcessorAction[] for the process lifetime.
- **Why it matters:** Module-global mutable state that grows unbounded across the app session is a small memory leak and makes the module non-deterministic in tests (state bleeds between cases unless manually cleared). It also sidesteps the kit's own caching (createMemoryCache) that the rest of the system relies on, and contradicts kit.ts's own warning to never use module singletons.
- **Proposed solution:** Move this cache onto the manager/kit-adapter instance (so its lifetime is the service's and tests get a fresh one), or use the kit's createMemoryCache with a bound. Ensure clearForgeProcessorActionCache (or instance disposal) is actually wired into service dispose(). Once forge healing moves into the kit, the cache moves with it.
- **Touches packages:** No
- **Tests needed:** unit: cache does not leak between manager instances; bounded growth under repeated installs of distinct targets.
- **Guideline:** docs/architecture.md (services lifecycle; avoid module singletons — kit.ts comment itself warns 'never import a module singleton')

<a id="ll-058"></a>
#### LL-058 · No tests cover bundleHealing.verifyAndRepairExceptBundle or the repair->ensureLaunchable fallback path

- **Category:** testing · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/bundleHealing.ts:65-102 (verifyAndRepairExceptBundle, createBundleRepairIssueFilter); repairWorkflow.ts:122-134 (ensureLaunchable full-install fallback)
- **Problem:** There are tests for repairWorkflow finalization, forgeProcessorHealing, launch, progress adapter, status, readiness, uninstall, install, context, installManifest, and errors — but there is NO bundleHealing test file (verified: tests/main/services/minecraft/ has no bundle* file), so createBundleRepairIssueFilter / verifyAndRepairExceptBundle (the bundle-owned-issue filter + path normalization via toBundleKey) have no direct coverage. ensureLaunchable's fallback IS partially tested (repairWorkflow.test.ts:155-198 covers trigger/skip), so that half of the original claim is inaccurate.
- **Why it matters:** createBundleRepairIssueFilter decides which files a repair is allowed to overwrite; a regression there could clobber bundle-owned files (data loss) or fail to repair vanilla files (broken launch). The backslash->forward-slash normalization in toBundleKey (bundleHealing.ts:27-28) is exactly the kind of cross-platform branch that silently regresses.
- **Proposed solution:** Add unit tests for verifyAndRepairExceptBundle: it ignores bundle-owned issue paths and repairs only the rest, returning correct ignoredByBundle/repaired counts; path normalization (backslash vs forward-slash) round-trips via toBundleKey. The ensureLaunchable fallback is already covered by repairWorkflow.test.ts; no new test needed there.
- **Touches packages:** No
- **Tests needed:** unit (bundleHealing filter + counts, path normalization). ensureLaunchable fallback already covered.
- **Guideline:** docs/code-guideline.md (tests = pure domain + ipc routes + zod; cover ownership/integrity-critical branches)
- **Verification note:** Adjusted: the bundleHealing gap is real (no bundle* test file exists in tests/main/services/minecraft/, confirmed by directory listing — verifyAndRepairExceptBundle, createBundleRepairIssueFilter, toBundleKey are uncovered). BUT the second half of the original claim is wrong: ensureLaunchable's fallback IS tested — repairWorkflow.test.ts:155-198 has 'runs a full install when the launch version JSON is missing' and 'skips the install when the launch version resolves'. Corrected the area/problem/testsNeeded to drop the ensureLaunchable coverage claim and focus on bundleHealing, which is the genuinely untested ownership-critical surface. Kept P2 because the bundle-owned-file filter is a data-loss-adjacent branch.

<a id="ll-059"></a>
#### LL-059 · buildContext persists settings (persistClientOverride) as a side effect during the launch read path

- **Category:** architecture · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Profile / version flow
- **Area:** src/main/services/minecraft/context.ts:46-80 (drops stale loader override 48-52, fresh loaderOverride 60-62, stale runtime ref 72-80) invoked from manager.startLaunch:229 and startRepair/startInstall
- **Problem:** buildContext is called on every install/repair/launch and persists settings mid-resolve: it drops a stale loader override (48-52), persists a freshly-chosen loaderOverride (60-62), and clears a stale runtime ref (72-80) via persistClientOverride. So a launch — conceptually read-only until the process spawns — mutates persisted client settings as a side effect of building its context, and startLaunch holds no operation lock when it does so (manager.ts:229).
- **Why it matters:** Hidden writes in a context-builder make the function impure and surprising; combined with startLaunch holding no lock, these settings writes can race a concurrent settings mutation from another flow, and they fire even on launches that ultimately abort in preflight. Mixing read-resolution with persistence violates separation of concerns.
- **Proposed solution:** Have buildContext return the needed cleanups as data (e.g. { staleLoaderOverride, staleRuntimeRef }) and let the calling write-locked operation apply them, or gate persistence behind 'this op owns a write lock'. At minimum, do not persist on the launch read path.
- **Touches packages:** No
- **Tests needed:** unit: buildContext on a launch path does not call persistClientOverride; stale-override cleanup is applied only by install/repair under lock.
- **Guideline:** docs/architecture.md (persistence boundaries; services lifecycle); docs/code-guideline.md (no hidden side effects)

### Auth / session / refresh flow

<a id="ll-060"></a>
#### LL-060 · Successful token refresh demoted to forced logout when the trailing safeStorage write throws

- **Category:** error-handling · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/verify.ts:60,70; src/main/infra/store.ts:295-307
- **Problem:** verifySession() persists a freshly rotated session via setStoredAuth(result.session) after a successful validate/refresh. setStoredAuth (store.ts:300-306) wraps writeAuthSecret + store.set in a try/catch that, on ANY failure (transient safeStorage hiccup, disk error), calls clearStoredAuth() and re-throws. That throw propagates up through verifySession -> fetchCurrentUser -> the authMe IPC handler, so a user whose token was just successfully refreshed is both wiped from disk and reported as logged out to the renderer.
- **Why it matters:** Directly violates the code-guideline rule 'do NOT demote a successful op to failure on a trailing bookkeeping error.' A network refresh succeeded; a local persistence glitch should at most log a warning, not log the user out and destroy their valid session.
- **Proposed solution:** Wrap the post-refresh setStoredAuth in try/catch inside verifySession (both yggdrasil and mojang branches). On failure: logger.warn and still return the enriched account built from result.session (the in-memory session is valid for this run). Do NOT clearStoredAuth on a bookkeeping failure during verify. Optionally make setStoredAuth not clear on metadata-only failure when the secret already wrote.
- **Touches packages:** No
- **Tests needed:** unit: verify.ts test where verifySession returns ok with a rotated session but setStoredAuth throws — assert it returns the account (not null) and does not clear stored auth.
- **Guideline:** code-guideline.md — 'do NOT demote a successful op to failure on a trailing bookkeeping error' / try-finally cleanup

<a id="ll-061"></a>
#### LL-061 · Concurrent authMe calls have no in-flight de-duplication; overlapping Yggdrasil refreshes can rotate over each other

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/verify.ts:44-72; src/main/services/auth/yggdrasilAuth.ts:80-114; src/renderer/features/auth/hooks.ts:41-48
- **Problem:** fetchCurrentUser/verifySession has no single-flight guard. The renderer's useCurrentUser query (hooks.ts:41-48) plus the launch path's getStoredAccount and window-refocus refetches can trigger overlapping authMe invocations. Each independently reads the stored session, may call client.refresh (which rotates the Yggdrasil access/client token pair, invalidating the previous one), then setStoredAuth. Two concurrent refreshes mean the second rotation can invalidate the token the first just persisted; last-writer-wins ordering can store a token the server already superseded, intermittently forcing a real logout on the next verify.
- **Why it matters:** Yggdrasil refresh rotates tokens; the old pair becomes invalid. Without a single-flight guard, mount + focus + launch can race. This is the classic token-refresh race called out in the focus checklist. Note: the renderer useQuery already de-dupes its OWN concurrent fetches, so the realistic race is renderer-query vs launch-path getStoredAccount, or two windows — narrower than 'any overlap', but still unguarded at the service layer.
- **Proposed solution:** Add single-flight de-duplication for verifySession in the auth service: cache the in-flight Promise (module-level 'refreshInFlight') and have concurrent callers await the same result; clear it in finally. Note getStoredAccount (auth.ts:53) is synchronous and does NOT refresh, so the main remaining overlap is two authMe-driving refreshes; still worth serializing.
- **Touches packages:** No
- **Tests needed:** unit: fire two verifySession() calls concurrently against a client whose refresh resolves once; assert client.refresh is invoked exactly once and both callers receive the same rotated session.
- **Verification note:** Real: no single-flight guard exists in verify.ts or yggdrasilAuth.ts. Adjusted priority P1->P2 and softened the framing: TanStack useQuery already de-dupes concurrent fetches of the same key, and getStoredAccount (the launch-path reader, auth.ts:53-56) is synchronous and never calls refresh — so the 'mount + focus + launch' triple-race is overstated. The genuine window is two distinct authMe drivers (e.g. multi-window or a manual invalidate during an in-flight verify). Missing de-dup is still a real, worth-fixing gap.

<a id="ll-062"></a>
#### LL-062 · Yggdrasil validate transient/HTTP errors are swallowed as 'offline', skipping the refresh that could rotate a near-expiry token

- **Category:** error-handling · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/yggdrasilAuth.ts:80-114 (validate catch at :87-91)
- **Problem:** In verifySession, the validate() call's catch (yggdrasilAuth.ts:87-91) treats EVERY non-network error as 'offline' (line 90 warns then returns offline). The happy path only proceeds to refresh when validate RESOLVES false (line 86 returns ok on true, otherwise falls through). So a validate that THROWS an HTTP_ERROR (5xx, 400, 403, invalid-response) short-circuits to 'offline' and never attempts the refresh that could rotate a near-expiry token. Meanwhile a validate that returns false ALWAYS falls through to refresh even on a definitively-bad token.
- **Why it matters:** The branching conflates 'server reachable but token rejected' with 'server unreachable'. A 403 thrown by validate (token rejected) is mislabeled offline, so the session is kept stale instead of being refreshed or expired correctly; intermittent 5xx noise keeps a dead session alive as 'offline'.
- **Proposed solution:** Mirror the refresh-side classification: on validate throw, treat isHttpStatus(error, 403) as token-invalid (fall through to refresh), isNetworkFailure as offline, and other HTTP/invalid-response as warn+offline. Keep the explicit 403->refresh->expired chain so expired tokens are detected deterministically.
- **Touches packages:** No
- **Tests needed:** unit (currently missing entirely): yggdrasilAuth.verifySession covering validate=true->ok, validate=false->refresh ok (rotated), refresh 403->expired, validate/refresh network->offline, validate throws 5xx.

<a id="ll-063"></a>
#### LL-063 · Account (username + skin/cape URLs) persisted to renderer localStorage for 7 days and used to gate signed-in UI before main re-verifies

- **Category:** flow · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/renderer/shared/lib/queryPersister.ts:13-16,28-35; src/shared/constants/queryKeys.ts:2-3,29-31; src/renderer/app/App.tsx:56-80
- **Problem:** The TanStack persister dehydrates every successful query except the 'app' and 'servers' roots (queryPersister.ts:13-16). The 'auth' root (QUERY_KEYS.auth.me) is therefore written to window.localStorage (key loontail-query-cache-v1) and rehydrated for up to QUERY_PERSIST_MAX_AGE_MS (7 days). App.tsx:59-80 gates the authenticated shell on this 'user' value (isAuthenticated = !isAuthPending && user != null) before main re-verifies, so a stale persisted account renders the signed-in shell on launch even if main has already cleared the session (expired token, or safeStorage cleared on Linux basic_text). The account object (username, skin/cape URLs) also sits in plaintext localStorage.
- **Why it matters:** The persisted account is a UI-trust source that can diverge from main's authoritative session. On startup the renderer can show authenticated UI from cache before authMe resolves; if main has already cleared the session, the user briefly sees a logged-in shell for an account that no longer exists. Storing profile data in localStorage also widens the renderer's data surface.
- **Proposed solution:** Add QUERY_KEY_ROOTS.auth to VOLATILE_QUERY_ROOTS so 'me' is always refetched on launch and never persisted, OR keep the persisted value but treat isAuthPending as the gate (do not render authenticated UI from persisted cache until authMe confirms). Excluding the root is the smaller, safer change.
- **Touches packages:** No
- **Tests needed:** unit: queryPersister shouldDehydrateQuery returns false for queryKey ['auth','me'].
- **Guideline:** architecture.md §6 Renderer state — 'Async state from main / network → TanStack Query' is authoritative; persisted cache should not gate auth UI

<a id="ll-064"></a>
#### LL-064 · Kit error-code string literals hard-coded instead of MinecraftKitErrorCodes constants

- **Category:** dependency-extraction · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/mojangAuth.ts:165,202,203; src/main/services/auth/routes.ts:24
- **Problem:** isErrorCode(error, 'AUTH_CANCELLED') (mojangAuth.ts:165, routes.ts:24), isErrorCode(error, 'AUTH_REFRESH_FAILED') (mojangAuth.ts:202), and isErrorCode(error, 'AUTH_MINECRAFT_FAILED') (mojangAuth.ts:203) pass raw string literals. The kit exports MinecraftKitErrorCodes ({AUTH_CANCELLED, AUTH_REFRESH_FAILED, AUTH_MINECRAFT_FAILED, ...}) as a typed const object. The literals are unvalidated against the kit's union — a typo or upstream rename compiles fine and silently never matches, so a cancelled sign-in would be logged as a failure and an expired refresh misclassified as offline.
- **Why it matters:** Violates the no-magic-literals guideline (error codes must be named consts) and forfeits the compile-time safety the kit deliberately exports. A renamed kit code would break the cancel/expired classification with zero compiler signal.
- **Proposed solution:** Import MinecraftKitErrorCodes from @loontail/minecraft-kit and use isErrorCode(error, MinecraftKitErrorCodes.AUTH_CANCELLED) etc. in mojangAuth.ts and routes.ts.
- **Touches packages:** No
- **Tests needed:** none (covered by existing mojangAuth verify tests once constants are used).
- **Guideline:** code-guideline.md — 'no magic literals (error codes are named consts)'

<a id="ll-065"></a>
#### LL-065 · Unsafe context cast in mojangAuth bypasses the typed MinecraftKitErrorContext.httpStatus field

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/mojangAuth.ts:204
- **Problem:** verifyMojangSession narrows the 401 case with `(error as { context?: { httpStatus?: number } }).context?.httpStatus` (mojangAuth.ts:204). The kit exports MinecraftKitErrorContext with a typed `readonly httpStatus?: number` (d.ts:855), and isErrorCode(error, 'AUTH_MINECRAFT_FAILED') at line 203 has already narrowed `error` to `MinecraftKitError & { code: ... }` whose `.context` is `Readonly<MinecraftKitErrorContext>` (d.ts:883). The structural cast is therefore both unnecessary and unsafe — it would silently accept an unrelated shape.
- **Why it matters:** Violates the no-any/no-unsafe-cast posture of the code guideline and discards the type safety the kit provides. If the kit moved httpStatus, this cast would keep compiling and read undefined.
- **Proposed solution:** After isErrorCode(error, MinecraftKitErrorCodes.AUTH_MINECRAFT_FAILED) the narrowed error already has error.context.httpStatus typed; read error.context?.httpStatus directly with no cast.
- **Touches packages:** No
- **Tests needed:** none (existing mojangAuth 401->expired test at mojangAuth.test.ts:117-123 covers behavior).
- **Guideline:** code-guideline.md — strict TS, no unsafe casts / no any

<a id="ll-066"></a>
#### LL-066 · Two parallel login-error taxonomies (LoginErrorCode vs shared IpcError ERROR_CODES) with a dead/duplicate mapping table

- **Category:** error-handling · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/contracts/auth.ts:111-121; src/main/services/auth/yggdrasilAuth.ts:28-33; src/main/services/auth/routes.ts:22-27; src/renderer/features/auth/hooks.ts:15-31; src/shared/constants/errorCodes.ts:6-7,17-18
- **Problem:** Auth login uniquely returns a LoginResult discriminated union carrying its own LOGIN_ERROR_CODE enum (auth.ts:111-121), while the rest of the app uses the architecture-doc IpcError {code,message} model with ERROR_CODES. The shared ERROR_CODES defines AuthNetworkError and AuthInvalidCredentials (errorCodes.ts:6-7,17-18), but the auth routes never emit them — they emit LoginErrorCode instead (routes.ts, login()/signIn()). The renderer keeps an IPC_LOGIN_ERROR_CODES table (hooks.ts:15-25) mapping every ERROR_CODE to a LoginErrorCode just in case an IpcError leaks through. AuthNetworkError/AuthInvalidCredentials are effectively dead constants on the emit side.
- **Why it matters:** Two error vocabularies for the same flow increase surface area and confuse maintainers about which path errors take. The architecture doc (§9) names IpcError {code} as the single cross-bridge error model; the bespoke LoginResult sidesteps it, and the unused ERROR_CODES entries are a maintenance trap.
- **Proposed solution:** Pick one model. Either (a) drop AuthNetworkError/AuthInvalidCredentials from ERROR_CODES and document LoginResult as the deliberate exception for the login flow, or (b) fold login errors into the IpcError model and delete the renderer's IPC_LOGIN_ERROR_CODES bridge. Keep the returned-result style only where the UI needs field-level error rendering.
- **Touches packages:** No
- **Tests needed:** unit: ipc-route test asserting authLogin/authMojangSignIn never throw IpcError for known failures (always return LoginResult) once the model is settled.
- **Guideline:** architecture.md §9 Error model — IpcError {code} is the single cross-bridge error model

<a id="ll-067"></a>
#### LL-067 · isNetworkFailure duplicates the package's isYggdrasilClientErrorCode helper

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/yggdrasilAuth.ts:25-26
- **Problem:** isNetworkFailure(error) (yggdrasilAuth.ts:25-26) re-implements `error instanceof YggdrasilClientError && error.code === YggdrasilClientErrorCodes.NETWORK`. yggdrasil-client already exports isYggdrasilClientErrorCode(value, code) which is exactly this narrowing (d.ts:89). The local isHttpStatus (yggdrasilAuth.ts:20-23) additionally checks context.status, so it is a legitimate local helper — only the network check is a duplicate.
- **Why it matters:** The package provides the type guard precisely to avoid consumers hand-rolling instanceof+code checks; using the export keeps the narrowing correct if the error class internals change.
- **Proposed solution:** Replace isNetworkFailure with isYggdrasilClientErrorCode(error, YggdrasilClientErrorCodes.NETWORK) imported from @loontail/yggdrasil-client. Keep the local isHttpStatus since it inspects context.status, which the package guard does not.
- **Touches packages:** No
- **Tests needed:** none.

<a id="ll-068"></a>
#### LL-068 · getStoredAuth performs a write (legacy-secret migration) as a side effect of a read on the legacy-session path

- **Category:** architecture · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Auth / session flow
- **Area:** src/main/infra/store.ts:262-289 (migrateLegacyAuthSession at :247-260, invoked from getStoredAuth:266)
- **Problem:** getStoredAuth() is a pure-looking getter but, when the raw store value matches the legacy plaintext AuthSession shape (store.ts:265), calls migrateLegacyAuthSession -> setStoredAuth (writeAuthSecret + store.set) mid-read (:266,249). getStoredAuth is called from the launch path (launch.ts:184), skin uploads (skin.ts:21), and every verifySession. On that legacy path a safeStorage failure triggers clearStoredAuth and silently logs the user out at, e.g., launch time. The dedicated migrateStoredAuthSecrets() runs once at auth init (index.ts:19), so the in-getter migration is redundant for the normal path.
- **Why it matters:** Read-with-write side effects make the function non-idempotent and couple unrelated flows (launch, skin) to a one-time migration that can fail and force a logout outside the auth service. Harder to reason about and to test. Scope is narrower than implied: a normal (post-migration) session is stored as metadata-only and FAILS AuthSessionSchema at :265, so it skips migration entirely — the write fires only for genuinely-legacy plaintext sessions, and only until the first successful migration.
- **Proposed solution:** Keep getStoredAuth read-only: when raw matches the legacy plaintext shape, return it parsed but defer migration to the explicit migrateStoredAuthSecrets() already invoked in auth init(). At minimum, ensure a migration failure during getStoredAuth does not clear the session unless the secret is genuinely unreadable.
- **Touches packages:** No
- **Tests needed:** unit (store.test.ts) asserting getStoredAuth on a legacy plaintext session returns the session without forcing a write, and a safeStorage write failure during migration does not null the session on the read path. (Note: store.test.ts:146-196 already covers the happy migration; the failure-path assertion is the gap.)
- **Verification note:** Real but overstated. Verified the in-getter migration at store.ts:265-266 and the clear-on-failure at :257. However the original 'on every launch/skin/verify path' framing is inaccurate: a normal session is persisted as StoredAuthMetadata (metadata only, no accessToken), which fails AuthSessionSchema.safeParse at :265 and skips migration — so the write only triggers for genuinely-legacy plaintext sessions and only once. store.test.ts:146-196 already tests the happy migration path; only the write-FAILURE-on-read assertion is missing. Lowered emphasis and corrected scope/lines accordingly; kept as a valid P3 architecture/idempotency observation.

<a id="ll-069"></a>
#### LL-069 · yggdrasilAuth.verifySession/signIn (token-rotation logic) and verify.ts have no unit coverage

- **Category:** testing · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** tests/main/services/auth/yggdrasilAuth.test.ts (only covers signOut); src/main/services/auth/yggdrasilAuth.ts:51-114; src/main/services/auth/verify.ts:44-72
- **Problem:** yggdrasilAuth.test.ts exercises only signOut. signIn's error mapping (403->InvalidCredentials, 429->RateLimited, NETWORK->NetworkError, else Unknown via loginErrorFromError, yggdrasilAuth.ts:28-33,51-74) and verifySession's validate->refresh->expired/offline state machine (:80-114) — the most failure-prone, race-prone logic in the area — are completely untested. verify.ts (the provider-agnostic dispatcher with expired/offline/setStoredAuth branching) is also untested directly: auth.test.ts mocks verifySession (auth.test.ts:45-48) rather than exercising it.
- **Why it matters:** These functions decide whether a user stays logged in, gets logged out, or keeps a stale session offline. Regressions here are exactly the silent-logout / token-corruption class of bugs (findings #1 and #3). The code-guideline names pure-domain + zod as test targets, and this is pure provider logic behind an injected client.
- **Proposed solution:** Add yggdrasilAuth tests for signIn (each LoginErrorCode mapping) and verifySession (validate-true ok, validate-false->refresh-ok rotated, refresh-403->expired, network->offline, validate-throws-5xx for finding #3). Add verify.test.ts covering the yggdrasil and mojang expired/offline/ok branches including the setStoredAuth-throws case from finding #1.
- **Touches packages:** No
- **Tests needed:** unit: yggdrasilAuth.signIn (4 error mappings + ok), yggdrasilAuth.verifySession (5 branches), verify.verifySession (dispatch + persistence-failure).
- **Guideline:** code-guideline.md — tests = pure domain + ipc routes + zod
- **Verification note:** Adjusted: the original wrongly claimed mojangAuth is untested. mojangAuth.test.ts DOES cover verifyMojangSession (ok at :109-115, 401->expired at :117-123, opaque->offline at :125-131) and sign-in abort/URL-allowlist paths (:69-105). The genuine gaps are (a) yggdrasilAuth.verifySession + signIn (test file only covers signOut — verified) and (b) verify.ts (auth.test.ts mocks verifySession at :45-48, so the dispatcher's own expired/offline/setStoredAuth branching is untested). Rescoped title/area/problem to those real gaps; removed the incorrect mojangAuth claim.

<a id="ll-070"></a>
#### LL-070 · mojangAuth.ts mixes URL-allowlist, OAuth orchestration, session projection, and verify in one module — split the pure helpers for testability

- **Category:** architecture · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/mojangAuth.ts:1-213
- **Problem:** One 213-line module owns: the Microsoft authorize-URL allowlist (parseUrl/isMicrosoftAuthorizeUrl/openMicrosoftAuthorizeUrl :88-127), kit-session->launcher-session projection (fromKitSession/withRefreshedProfile :46-86), the AbortController-guarded browser sign-in (:146-174), cancel (:177-180), and verify/refresh (:188-210). The URL-validation and session-projection helpers are pure and security-relevant (the allowlist is the shell.openExternal gate) but are reachable today only through the factory closure that holds activeController and the kit instance, making targeted tests awkward (the existing test drives the whole run()).
- **Why it matters:** The URL-validation and session-projection helpers are pure and independently testable, and the allowlist guards a shell.openExternal call. Extracting them lets them be unit-tested directly instead of via the full sign-in flow.
- **Proposed solution:** Extract the Microsoft URL allowlist (parseUrl/isMicrosoftAuthorizeUrl) and the session projection (fromKitSession/withRefreshedProfile) into small sibling modules (e.g. mojangAuthUrl.ts, mojangSession.ts) and unit-test them directly. Leave createMojangAuth as the thin orchestrator over the injected kit + openExternal.
- **Touches packages:** No
- **Tests needed:** unit: isMicrosoftAuthorizeUrl (https-only, host/path allowlist, reject http/other hosts); fromKitSession projection shape.
- **Verification note:** Real (the listed helpers are indeed all in one closure-bound module, verified mojangAuth.ts:46-210) but the original cited 'CLAUDE.md — under 500 lines' which is misapplied: the file is 213 lines, well under 500, so that rule is not violated. Cleared the guidelineViolation and reframed as a pure-testability/altitude P3, not a line-limit breach. Note the URL-allowlist behavior is already indirectly tested via signInWithMojang (mojangAuth.test.ts:89-105), so the win is direct/cheaper tests, not zero coverage.

<a id="ll-071"></a>
#### LL-071 · Yggdrasil session-construction logic duplicated between signIn and refresh

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/contracts/auth.ts:63-83; src/main/services/auth/yggdrasilAuth.ts:57-65,98-106
- **Problem:** yggdrasilAuth builds the next YggdrasilSession with identical undashUuid normalization in two places (signIn :57-65 and refresh :98-106), inviting copy-paste divergence. Separately, shared/contracts/auth.ts declares its own YggdrasilProfileSchema/YggdrasilSessionSchema while yggdrasil-core exports YggdrasilSessionSchema/GameProfileSchema and the undashed-hex refinement (isUuidUndashed, already imported in auth.ts:7,64). The launcher's session is a deliberately narrower storage shape so full 1:1 reuse is not possible, but the profile-id normalization concept is re-expressed.
- **Why it matters:** Two identical session-construction blocks risk drifting; partial duplication of the core session/profile vocabulary risks divergence if the Yggdrasil profile shape changes upstream.
- **Proposed solution:** Factor a single sessionFromIssued(issued) helper in yggdrasilAuth used by both signIn and refresh. Keep the narrow launcher schema but continue reusing yggdrasil-core's isUuidUndashed; optionally derive the profile schema from core's GameProfileSchema.pick to stay aligned.
- **Touches packages:** No
- **Tests needed:** unit: sessionFromIssued normalizes a dashed selectedProfile.id to undashed lowercase for both signIn and refresh.
- **Verification note:** Confirmed the duplicated session-construction blocks at yggdrasilAuth.ts:57-65 and :98-106 (identical undashUuid + provider/token/profile shape) and the local schema re-declaration in auth.ts:63-83 reusing core's isUuidUndashed. Changed affectsYgg true->false: the recommended fix (a local sessionFromIssued helper + continuing to reuse isUuidUndashed) is entirely launcher-side and needs no package change or dist rebuild. The original's affectsYgg=true rested on a speculative 'maybe hoist a stored-session shape into core', which is optional and not the actual recommendation; cleared packageWhat accordingly.

<a id="ll-072"></a>
#### LL-072 · Cancelled Mojang sign-in is mapped to LOGIN_ERROR_CODE.Unknown, relying on renderer cancelledRef timing to suppress a spurious error

- **Category:** flow · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/routes.ts:22-27,43-51; src/renderer/features/auth/hooks.ts:96,107-123
- **Problem:** When the user cancels, the kit throws AUTH_CANCELLED; routes.ts mojangFailureCode maps it to LOGIN_ERROR_CODE.Unknown (routes.ts:24, with a comment acknowledging this). The IPC layer returns {ok:false, error:'UNKNOWN'} and the renderer suppresses it only because cancelledRef.current is true at that moment (hooks.ts:115-117). If the cancel races (cancelMojangLogin fires but the result resolves before cancelledRef flips, or a non-user abort occurs), the user sees a generic 'Unknown' error for a normal cancellation.
- **Why it matters:** The cancel signal is conflated with a real failure across the IPC boundary, and correctness depends on renderer-side timing of a ref rather than an explicit cancelled outcome. Brittle and surfaces a confusing error on edge-case cancellations.
- **Proposed solution:** Model cancellation explicitly: add LOGIN_ERROR_CODE.Cancelled (or an {ok:false, cancelled:true} variant) returned from the authMojangSignIn handler when isErrorCode(error, MinecraftKitErrorCodes.AUTH_CANCELLED), and have the renderer treat it as a no-op without relying on cancelledRef.
- **Touches packages:** No
- **Tests needed:** unit: authMojangSignIn handler returns the cancelled outcome (not Unknown) when signInWithMojang rejects with AUTH_CANCELLED.

<a id="ll-073"></a>
#### LL-073 · No bounded retry/backoff on transient auth network failures; single attempt then offline/error

- **Category:** flow · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/yggdrasilAuth.ts:80-114 (validate/refresh); src/main/services/auth/mojangAuth.ts:188-210 (refresh/profile.read)
- **Problem:** Both providers make a single network attempt for validate/refresh/profile.read. A transient blip (DNS hiccup, 502 from a restarting Yggdrasil server) on startup verify immediately yields 'offline' (keeping a possibly-stale session) or, for login, surfaces NetworkError. There is no short bounded retry/backoff for the idempotent verify calls.
- **Why it matters:** Startup re-validation is the most common moment for a transient failure (server cold start, network not yet up after resume). A single attempt makes the launcher unnecessarily pessimistic and can keep users in offline/stale state across a recoverable blip.
- **Proposed solution:** Add a small bounded retry (e.g. 2 attempts, short backoff) around the idempotent verify calls (validate, refresh, profile.read) for network-class errors only — not for 403/credential failures. First check whether YggdrasilClient/MinecraftKit already expose retry options and prefer configuring the client.
- **Touches packages:** No. If retry belongs at the HTTP layer it could be added as a YggdrasilClientOptions / kit fetch option (rebuild + copy dist) rather than per-call in the launcher; otherwise a launcher-side retry helper suffices with no package change.
- **Tests needed:** unit: verifySession retries once on a network error then succeeds; does not retry on 403.

<a id="ll-074"></a>
#### LL-074 · verifyMojangSession refreshes on a local clock and has no fallback when refresh fails transiently but the access token is still valid

- **Category:** error-handling · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/auth/mojangAuth.ts:188-209
- **Problem:** needsRefresh is Date.now() > session.expiresAt - 60_000 using the local system clock (mojangAuth.ts:189-190). If the user's clock is skewed forward, every verify forces a refresh; if the kit's refresh then fails for any non-AUTH_REFRESH_FAILED reason (transient AUTH_MINECRAFT/network), the catch returns 'offline' (:207-208) and the still-valid access token is never exercised via profile.read. Conversely a skewed-back clock can let an actually-expired token take the profile.read path.
- **Why it matters:** Relying solely on a wall-clock comparison plus a single refresh attempt makes session validity sensitive to clock skew and to transient refresh failures, producing avoidable offline states for users whose access token is in fact still good.
- **Proposed solution:** On needsRefresh, attempt refresh but on a non-AUTH_REFRESH_FAILED / non-401 error fall back to a profile.read with the current accessToken before concluding offline/expired; only AUTH_REFRESH_FAILED (or AUTH_MINECRAFT_FAILED 401) should mean expired. Optionally tighten the safety window so a small skew doesn't force constant refreshes.
- **Touches packages:** No
- **Tests needed:** unit: needsRefresh true + refresh throws transient -> falls back to profile.read ok (not offline); refresh throws AUTH_REFRESH_FAILED -> expired.

### Renderer architecture, features & UI-guideline compliance

<a id="ll-075"></a>
#### LL-075 · PlayButton.tsx (343L) bundles the whole install/launch/repair UI state machine with rendering and five mutations

- **Category:** architecture · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Launch flow
- **Area:** src/renderer/features/clients/components/PlayButton.tsx:123-343 (and selector 45-121)
- **Problem:** The PlayButton component is 343 lines. Beyond the pure `selectPlayButtonAction` selector (good), the component body (123-343) wires five mutation hooks (install/launch/cancel/stop/startBundle), derives loader-choice logic (persistedLoader/needsLoaderChoice/beginInstall/startOrPickLoader 139-159), localizes two error families (198, 308), and renders 12 distinct action branches. The orchestration concern (which action + the imperative handlers) is interleaved with the JSX for every branch.
- **Why it matters:** ui-guideline §8 caps components at ~200 lines / one responsibility, and §8 says 'No business logic in components.' At 343 lines this is the largest renderer component and the hardest to test — the install/loader-choice decisions can only be exercised through full React render, whereas the selector beside it is already unit-testable in isolation.
- **Proposed solution:** Extract the imperative orchestration into a `usePlayButton(client)` hook in features/clients (returns `{ action, handlers: { play, stop, cancel, install, retryBundle, updateBundle }, loaderModalState, errorText }`). PlayButton then becomes a thin switch over `action` rendering ActionButton variants. The loader-choice logic (rawPersistedLoader/isLoaderAvailable/needsLoaderChoice) moves into the hook so it is unit-testable without rendering.
- **Touches packages:** No
- **Tests needed:** unit tests for the extracted usePlayButton hook (action selection already covered by selectPlayButtonAction); component snapshot per action branch
- **Guideline:** ui-guideline.md §8 Component authorship rules (~200 line cap, no business logic in components)

<a id="ll-076"></a>
#### LL-076 · Lucide icons sized via the `size` prop instead of Tailwind `size-N` classes across ~25 call sites

- **Category:** UI · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/PlayButton.tsx:208,221,233,241,254,262,270,281,289,301,319,336; ClientOverview.tsx:140; install/ProgressControls.tsx:24,29,34; install/InstallStepper.tsx:9,10,11; install/ProgressBody.tsx:37 (Pause size={9}); shared/ui/Toast/ToastItem.tsx:143,166,175; console/ConsoleCrashBanner.tsx:20
- **Problem:** Icons are sized with the numeric SVG `size` prop (e.g. `<Play size={16} />`, `<Pause size={9} />`) in dozens of places. The rest of the codebase (FolderInfoBlock.tsx:84,112 size-5/size-3.5; ConsoleHeader.tsx:21; ConsoleToolbar.tsx; ConsoleLogBody.tsx:107; UpdaterBadge.tsx) correctly uses `className="size-4"` / `size-5`. Both conventions are live simultaneously.
- **Why it matters:** ui-guideline §6 explicitly: 'Icon size is set via Tailwind (size-4, size-5), not via the size prop on the SVG, so it composes with the design system.' The numeric props also introduce off-scale values (9, 10, 12, 14, 16, 18) that don't map to any Tailwind step, fragmenting the icon scale.
- **Proposed solution:** Replace `size={16}` with `className="size-4"`, `size={12}` with `className="size-3"`, etc., merging into existing className via cn() where one is already present. Add a Biome/grep guard in CI to prevent regression.
- **Touches packages:** No
- **Tests needed:** none (visual); a grep-based lint guard is the durable fix
- **Guideline:** ui-guideline.md §6 Icons (size via Tailwind, not the size prop)
- **Verification note:** Real and pervasive, but the cited line set was incomplete/imprecise and the 'correct convention' examples were wrong. Corrections: (1) ClientOverview gear icon is at line 140 (correct). (2) ProgressControls also has size={12} at line 29 (Pause), not only 24/34 — added. (3) InstallStepper has size={12} at 9 and 11 AND size={10} at line 10 — added. (4) ProgressBody Pause size={9} is at line 37, not unlabeled. (5) ToastItem has size={18} at 143 plus size={14} at 166/175 — added 143. (6) The original 'correct examples' cited App.tsx:50 and ClientSettingsModal.tsx:126 — ClientSettingsModal:126 is an X icon WITH size-4 (correct), retained; replaced unverifiable App.tsx ref with FolderInfoBlock/ConsoleHeader/UpdaterBadge which I verified use size-N classes. Core §6 violation stands.

<a id="ll-077"></a>
#### LL-077 · Arbitrary `text-[Npx]` font sizes bypass the defined typography tokens (--text-caption/eyebrow/microlabel)

- **Category:** UI · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/install/ActionButton.tsx:12 (text-[14px]); install/ProgressBody.tsx:35 (text-[13px]),47 (text-[14px]); ServersInfo.tsx:76 (text-[13px]); console/ConsoleLogBody.tsx:44 (text-[12.5px]),85 (text-[10.5px]),88 (text-[9.5px]); console/ConsoleHeader.tsx:42 (text-[9.5px]); console/ConsoleToolbar.tsx:67 (text-[10.5px]); features/updater/UpdaterBadge.tsx:62 (text-[9px]); features/app-bar/components/AppBar.tsx:24 (text-[9px])
- **Problem:** index.css declares the typographic scale as tokens (`--text-eyebrow: 11px`, `--text-caption: 12px`, `--text-microlabel: 10px`, lines 63-65, used as `text-eyebrow`/`text-caption`/`text-microlabel`). Yet many components hardcode one-off sizes — `text-[13px]`, `text-[14px]`, `text-[12.5px]`, `text-[10.5px]`, `text-[9.5px]`, `text-[9px]` — that don't correspond to any token or the Tailwind scale.
- **Why it matters:** ui-guideline §5 (typography) and §2 (spacing/scale: 'Do not introduce arbitrary [7px]-style values except in genuinely one-off layout cases'). The same component file even mixes both (ProgressBody uses `text-microlabel` AND `text-[13px]`), so the scale is no longer a single source of truth and visual hierarchy drifts.
- **Proposed solution:** Map the arbitrary sizes onto existing tokens (13px/14px → introduce/promote a `--text-body`/`--text-label` token if genuinely needed, otherwise use `text-sm`/`text-caption`). For the console (a dense log surface) add a dedicated `--text-console` token documented in ui-guideline rather than three ad-hoc px values.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** ui-guideline.md §5 Typography / §2 Styling (no arbitrary scale values)

<a id="ll-078"></a>
#### LL-078 · `rounded-xl` / `rounded-2xl` used where only sm/md/lg radius tokens are allowed

- **Category:** UI · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/ServersInfo.tsx:22,42,62 (rounded-xl); install/InstallProgress.tsx:29 (rounded-2xl); shared/ui/Toast/ToastItem.tsx:141 (rounded-xl)
- **Problem:** The radius system is exactly the tokens declared in index.css (62-65): `--radius-xs` (2px), `--radius-sm` (0.5rem), `--radius-md` (0.875rem), `--radius-lg` (1.25rem) plus `rounded-full`. There is no `--radius-xl`/`--radius-2xl`. But server cards use `rounded-xl`, the install progress card uses `rounded-2xl`, and the toast uses `rounded-xl` — Tailwind defaults (0.75rem / 1rem) that are NOT project tokens.
- **Why it matters:** ui-guideline §4: 'Do not introduce arbitrary radius values. If a new scale step is needed, add a fourth token and document it here.' Card/list-group surfaces are specified to use `rounded-md`. Using off-token radii means cards visually disagree with SettingsGroup/FolderInfoBlock (which correctly use rounded-md).
- **Proposed solution:** Change card surfaces (ServersInfo rows, InstallProgress panel) to `rounded-md` per §4's 'cards, section containers, list groups, modal panels' rule. If the toast genuinely needs a larger radius, add and document a token rather than reaching for the Tailwind default.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** ui-guideline.md §4 Border radius (only sm/md/lg tokens; no arbitrary radii)

<a id="ll-079"></a>
#### LL-079 · Raw `rgba(255,255,255,0.10)` color literal inside an inline `style` box-shadow

- **Category:** UI · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/ClientOverview.tsx:134-137
- **Problem:** The settings gear button sets `style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 6px 18px -8px var(--color-glow-overlay-md)' }}`. This hardcodes a raw `rgba()` white literal AND uses an inline style for a non-computed value. The second half already correctly references the `--color-glow-overlay-md` token, so the pattern for doing it right is right there.
- **Why it matters:** ui-guideline §3/§9 forbid raw color literals (rgb/rgba/hsl/hex) in components — all colors must come from palette tokens — and §9 forbids inline `style` for anything that could be a Tailwind class (only computed values like progress width are allowed). The codebase already expresses glow shadows as `shadow-[0_0_Npx_var(--color-glow-*)]` Tailwind arbitrary properties (ServersInfo.tsx:71, ClientOverview.tsx:88/92), so the idiom exists.
- **Proposed solution:** `rgba(255,255,255,0.10)` is byte-for-byte the existing `--color-edge` token (`hsl(0 0% 100% / 0.1)`, index.css:43). Express the whole shadow as a Tailwind class: `shadow-[inset_0_1px_0_var(--color-edge),0_6px_18px_-8px_var(--color-glow-overlay-md)]`, dropping the inline style entirely.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** ui-guideline.md §3 Color palette / §9 (no raw rgba; no inline style for non-computed values)
- **Verification note:** Confirmed at ClientOverview.tsx:134-137 exactly as quoted. But the solution named the wrong token: it suggested adding `--color-glow-glass`, which already exists at 0.4 alpha — too opaque. The literal rgba(255,255,255,0.10) equals the EXISTING `--color-edge` token (hsl 0 0% 100% / 0.1, index.css line 43). Corrected the solution to reuse `--color-edge`; no new token needed. Violation and quoted code accurate.

<a id="ll-080"></a>
#### LL-080 · Two divergent `formatBytes` implementations produce inconsistent size formatting

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/renderer/features/settings/components/FolderInfoBlock.tsx:9-17 vs src/renderer/features/clients/components/install/progressFormat.ts:1-11
- **Problem:** FolderInfoBlock defines its own `formatBytes` that only ever emits GB (2 decimals) or MB (0 decimals) — e.g. 500 bytes renders as '0 MB'. progressFormat.ts defines a different `formatBytes` over the full B/KB/MB/GB/TB scale with variable precision. The two are used in sibling features for the same conceptual job (human-readable byte size) and disagree on output.
- **Why it matters:** Duplicated, drifting logic. A user sees disk usage formatted one way in client settings and download size formatted another way during install. Byte formatting is pure, generic, and trivially unit-testable — it should live once in shared/lib.
- **Proposed solution:** Promote progressFormat.ts's full-scale `formatBytes`/`formatSpeed` to `src/renderer/shared/lib/formatBytes.ts`, delete FolderInfoBlock's local copy, and have both call sites import it. Keep one implementation, add unit tests for the boundary cases (0, <1KB, ≥1TB).
- **Touches packages:** No. minecraft-kit exposes byte progress via createInstallProgressTracker but not a formatter; keep formatting in the launcher shared lib. No dist rebuild needed.
- **Tests needed:** unit tests for the consolidated formatBytes (0/sub-KB/GB/TB boundaries)
- **Guideline:** code-guideline.md (DRY / no magic literals — duplicated unit tables)

<a id="ll-081"></a>
#### LL-081 · Three parallel error-code→i18n-key lookup tables with identical shape and no shared helper

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/renderer/features/bundle/errorCopy.ts:4-20; src/renderer/features/minecraft/errorCopy.ts:4-24; src/renderer/features/auth/components/LoginForm.tsx:9-15 (ERROR_COPY_KEYS)
- **Problem:** Three independent implementations of the same pattern: a `Record<SomeErrorCode, string>` keyed by an as-const codes object, plus a `localizeX(code, message, t) => t(key, { message })`. bundle/errorCopy and minecraft/errorCopy are structurally identical apart from the codes enum and key prefix; LoginForm inlines the Record but resolves the key directly in JSX.
- **Why it matters:** code-guideline favors a single source of truth and discriminated-union exhaustiveness. The repeated boilerplate means every new error family re-derives the same localize function. The `Record<Code, string>` does enforce key exhaustiveness (good), but the localize wrapper is copy-pasted.
- **Proposed solution:** Add `src/renderer/shared/lib/localizeError.ts` exporting `makeErrorLocalizer<Code extends string>(keyByCode: Record<Code, string>) => (code, message, t) => t(keyByCode[code], { message })`. Each feature keeps only its `keyByCode` map and calls the factory. LoginForm's inline ERROR_COPY_KEYS can use the same factory.
- **Touches packages:** No
- **Tests needed:** unit test for makeErrorLocalizer (key resolution + message interpolation)
- **Guideline:** code-guideline.md (DRY / single source of truth)
- **Verification note:** Real: bundle/errorCopy.ts:4-20 and minecraft/errorCopy.ts:4-24 are near-identical Record+localize pairs; LoginForm.tsx:9-15 is the inline third. But the original claim of 'effectively four, counting notifications relay' is overstated — I checked minecraft/events.ts:60 and bundle/events.ts: they CALL the existing localizeMinecraftError/localizeBundleError, they do not re-implement the table. So it is three implementations, not four. Title and count corrected; DRY finding otherwise stands.

<a id="ll-082"></a>
#### LL-082 · errorCopy localizers interpolate a raw upstream `message` into a localized template

- **Category:** error-handling · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/renderer/features/bundle/errorCopy.ts:19-20; src/renderer/features/minecraft/errorCopy.ts:20-24; consumed at PlayButton.tsx:198,308
- **Problem:** Both localizers do `t(KEY_BY_CODE[code], { message })`, splicing the IpcError.message string straight into a translated string. That message originates in the main process / minecraft-kit and is English (and may be a raw exception string). So a non-English user gets a localized shell wrapping an English (or stack-ish) fragment, and the displayed text quality depends on whatever the main process happened to put in `message`.
- **Why it matters:** architecture.md error model defines IpcError{code,message,details}; the `code` is the localization key and is reliable, but `message` is developer-facing detail, not user copy. Mixing it into user-visible localized text undermines the i18n boundary and can leak internal phrasing into the UI.
- **Proposed solution:** Make the localized templates self-contained per code (the keys already exist) and reserve `{message}` for a collapsible 'details' affordance or a title= tooltip, not the primary alert text. At minimum, gate message interpolation behind the UNKNOWN/KIT_ERROR codes where no specific copy exists.
- **Touches packages:** No
- **Tests needed:** unit tests asserting known codes render code-specific copy without raw message; UNKNOWN falls back to message
- **Guideline:** architecture.md Error model (code is the contract; message is detail, not user copy)

<a id="ll-083"></a>
#### LL-083 · FolderInfoBlock has 14 props and embeds byte formatting + disk-ratio math (logic in a component)

- **Category:** UI · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Profile / version flow
- **Area:** src/renderer/features/settings/components/FolderInfoBlock.tsx:19-34 (14-prop type), 9-17 (formatBytes), 65-73 (ratio math), 14/16 (hardcoded 'GB'/'MB' units)
- **Problem:** FolderInfoBlockProps declares 14 props (folder, folderSize, folderSizeLoading, pathLoading, heading, description, path, onOpen, onChange, openLabel, changeLabel, showDiskUsage, overridden, disabled). The component also computes diskUsedRatio/folderRatio/clampedFolderRatio/restUsedRatio inline (68-73) and carries a private formatBytes (11-17) with hardcoded 'GB'/'MB' unit strings that are not localized.
- **Why it matters:** ui-guideline §8 caps props at ~8 and forbids business logic in components. 14 props is 'prop soup'; the bar-ratio arithmetic and byte formatting are pure logic that belongs in a hook/util and should be unit-tested. The hardcoded GB/MB units also escape i18n (the rest of the file localizes via t()).
- **Proposed solution:** Group the open/change action props into an `actions` object and the loading flags into a `loading` object to cut the prop count; extract the ratio math + formatBytes into a `useDiskUsageBars(folder, folderSize)` hook (reusing the consolidated shared formatBytes from the duplication finding). Move 'GB'/'MB' to locale strings if they must localize.
- **Touches packages:** No
- **Tests needed:** unit tests for the extracted useDiskUsageBars (clamping behaviour at 72-73 is the tricky bit)
- **Guideline:** ui-guideline.md §8 (≤~8 props, no business logic in components)

<a id="ll-084"></a>
#### LL-084 · ActionButton concatenates Tailwind class strings with `+` instead of composing via cn()

- **Category:** UI · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/install/ActionButton.tsx:11-21
- **Problem:** VARIANT_CLASSES builds each variant by string `+` concatenation across multiple lines (e.g. `'h-12 ... ' + 'shadow-... ' + 'hover:...'`). The codebase's convention (and shadcn's) is to pass class fragments as separate arguments to cn(), which the same file already does at the call site (28-34).
- **Why it matters:** ui-guideline §2: 'Use clsx/tailwind-merge (cn()) for conditional classes. Never concatenate class strings by hand.' Hand-concatenation is error-prone (missing trailing spaces silently merge two classes) and bypasses tailwind-merge conflict resolution within the variant string.
- **Proposed solution:** Store each variant as an array and spread the fragments through cn() at the call site (`cn(base, ...VARIANT_CLASSES[variant], className)`), or write each variant as one well-formatted string literal.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** ui-guideline.md §2 Styling (never concatenate class strings by hand)

<a id="ll-085"></a>
#### LL-085 · Renderer re-implements PNG/texture normalization via canvas but skips the dimension/PNG validation yggdrasil-core already exports

- **Category:** dependency-extraction · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Auth / session flow
- **Area:** src/renderer/features/skin/texture.ts:1-32 (normalizeTextureToPng); features/skin/hooks.ts:92,98 (call sites in saveAll)
- **Problem:** texture.ts hand-rolls image decode → canvas → toBlob('image/png') → ArrayBuffer to coerce a user-picked file to PNG, with bespoke Error throws ('Failed to decode texture image', 'PNG encoding failed'). yggdrasil-core already exports validatePngBuffer/assertPngBuffer and SKIN_VALID_DIMENSIONS/CAPE_VALID_DIMENSIONS (verified in dist d.ts lines 779-795), and project memory records 'PNG validation lives in core — do not re-implement in launcher.' The canvas path re-encodes ANY decodable image (jpg/webp) to PNG without validating skin/cape dimensions before upload.
- **Why it matters:** Duplicates validation the shared package owns, and skips the dimension checks core provides — a wrong-sized skin gets uploaded and rejected (or mis-rendered) downstream. Per the package contract, skin/cape PNG validity is core's responsibility.
- **Proposed solution:** After the canvas normalization (legitimately renderer-only because it needs DOM/canvas), run the resulting buffer through `assertPngBuffer(buffer, kind)` against SKIN_VALID_DIMENSIONS/CAPE_VALID_DIMENSIONS from @loontail/yggdrasil-core before calling uploadSkin, surfacing the typed YggdrasilCoreError to the user. Keep the canvas step; add core validation around it. Pass the SkinKind through to pick the right dimension set.
- **Touches packages:** Yes — yggdrasil. No package change required — consume existing exports (validatePngBuffer/assertPngBuffer, SKIN_VALID_DIMENSIONS, CAPE_VALID_DIMENSIONS, YggdrasilCoreError), confirmed present in node_modules/@loontail/yggdrasil-core/dist/index.d.ts:779-795. A 'normalize arbitrary image → valid skin PNG' helper cannot live in core (needs DOM canvas); keep it renderer-side. No dist rebuild needed.
- **Tests needed:** unit tests for the validation wrapper (valid skin passes; wrong dimensions/non-PNG rejected with typed error)
- **Guideline:** Project package contract (PNG/skin validation lives in @loontail/yggdrasil-core; do not re-implement in launcher)

<a id="ll-086"></a>
#### LL-086 · ClientSettingsModal (208L) acts as an orchestrator with eight hooks and seven async handlers in the component body

- **Category:** architecture · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Profile / version flow
- **Area:** src/renderer/features/clients/components/ClientSettingsModal.tsx:34-103
- **Problem:** The modal wires ~10 query/mutation hooks, derives currentRuntime/hasAnyOverride/loaderOverridden, and defines six async handlers (handleRamSave/handleToggleConsole/handleToggleFullscreen/handleResetAll/handleChangeFolder/handleOpenFolder) plus the uninstall flow before rendering. It already delegates the actual UI to sub-section components, but the controller logic lives in the component at 208 lines.
- **Why it matters:** ui-guideline §8 (~200 line cap, no business logic in components). The handlers and derived state are pure controller logic that would be more testable in a `useClientSettings(client)` hook, mirroring the existing useInstallProgress composite-hook pattern in the same feature.
- **Proposed solution:** Extract a `useClientSettings(slug)` hook returning the resolved state, the override flags, and the bound handlers; the modal becomes a layout that consumes it. This also makes the RAM pending-state reset effect (58-60) testable in isolation.
- **Touches packages:** No
- **Tests needed:** unit tests for the extracted hook (override detection, RAM save gating, reset)
- **Guideline:** ui-guideline.md §8 Component authorship (line cap, logic-free components)
- **Verification note:** Confirmed: file is 208 lines; lines 38-51 wire ~10 hooks (useLauncherSettings, useResolveFor, useRamRange, useDiskSpace, useFolderSize, useSetClientOverride, useClearClientOverrides, useChooseClientFolder, useClientStatus, useRepairClient, useUninstallClient — more than the stated 8). Handlers handleRamSave/handleToggleConsole/handleToggleFullscreen/handleResetAll/handleChangeFolder/handleOpenFolder are at 66-93 — six explicit handlers, not seven (the seventh 'uninstall flow' is inline at 188-191). Corrected wording to ~10 hooks / six handlers + uninstall flow; the RAM reset effect is at 58-60. §8 finding stands.

<a id="ll-087"></a>
#### LL-087 · ProgressBody uses dir="rtl" + <bdi> as a CSS hack to truncate file paths from the left

- **Category:** UI · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/renderer/features/clients/components/install/ProgressBody.tsx:71-78
- **Problem:** The current-file row sets `dir="rtl"` with `text-left` and wraps the path in `<bdi>` purely to make `truncate` ellipsize the START of the path (so the filename stays visible). This repurposes bidirectional-text semantics for a visual truncation effect, which is fragile (RTL flips punctuation/segment order in edge cases) and non-obvious; no explanatory comment is present.
- **Why it matters:** It is a non-declarative styling hack masquerading as i18n direction. For an app that ships an actual RTL-affecting locale later, this becomes a latent bug; and it reads as accidental to the next maintainer.
- **Proposed solution:** Replace with a left-truncation approach that doesn't abuse direction: a CSS span with explicit `unicode-bidi: plaintext`, or compute a middle/left-elided path string in JS (last N segments) so the DOM stays LTR and the title= tooltip keeps the full path.
- **Touches packages:** No
- **Tests needed:** unit test for a path-eliding helper if introduced
- **Guideline:** ui-guideline.md §9 (no styling hacks that should be a real class/util); declarative-UI principle

<a id="ll-088"></a>
#### LL-088 · ClientsPage selects the default active client in a useEffect instead of deriving it during render

- **Category:** flow · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/ClientsPage.tsx:14-23
- **Problem:** An effect watches `clients`/`activeClientId` and, when the stored active id no longer exists, calls setActiveClientId(first.id). The activeClient is then derived as `clients.find(...) ?? null` (line 23). This produces a render with activeClient=null (no overview) before the effect runs and commits the new id, causing a transient empty frame and an extra render whenever the client list loads or changes.
- **Why it matters:** architecture.md renderer state-zone guidance favors deriving from server state (TanStack Query result) over effect-driven store writes. The 'pick a valid default' decision is pure and can be computed inline, avoiding the empty intermediate render and the store round-trip.
- **Proposed solution:** Derive the effective active client during render: `const activeClient = clients.find(c => c.id === activeClientId) ?? clients[0] ?? null;` and only write the persisted activeClientId lazily (e.g. on user selection, or in an effect that just syncs persistence, not UI). This removes the blank-frame and the dependency churn.
- **Touches packages:** No
- **Tests needed:** none (or a small render test asserting overview shows on first paint with a stale stored id)
- **Guideline:** architecture.md renderer state zones (derive from query state; avoid effect-driven UI defaults)

<a id="ll-089"></a>
#### LL-089 · Repeated bordered-card surface pattern is copy-pasted instead of using a shared Card/Surface primitive

- **Category:** UI · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/ServersInfo.tsx:22,42,62; settings/components/FolderInfoBlock.tsx:81,110; shared/ui/SettingsGroup.tsx:36; ClientOverview.tsx:100,107 (chips); install/InstallProgress.tsx:29
- **Problem:** The 'rounded border bg-surface/card + padding + backdrop-blur' card shell is re-declared with slightly different class strings in many places (`rounded-md border border-border bg-card p-4`, `rounded-xl border border-edge bg-surface px-4 py-3 backdrop-blur-sm`, `rounded-2xl border border-edge bg-surface p-5 backdrop-blur-md`). There is a SettingsGroup primitive for the settings surface but nothing for the glass/surface cards in the clients feature, so each reinvents the shell (and picks divergent radii/tokens — see the radius finding).
- **Why it matters:** Reuse gap: the divergence is exactly why the rounded-xl/2xl and surface-token inconsistencies crept in. A single primitive would centralize the radius/border/blur decision and make the radius-token violation un-reintroducible.
- **Proposed solution:** Add a small `Surface`/`Card` primitive in shared/ui (variant: 'card' | 'glass') encoding the canonical `rounded-md border border-(border|edge) bg-(card|surface) backdrop-blur` shell, and refactor ServersInfo rows, InstallProgress, and FolderInfoBlock's inner panels to use it. Scope: low — it is a wrapper, not behavior.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** ui-guideline.md §1/§8 (compose shared primitives; don't re-declare surface shells per feature)

### Error model, logging, status & operation-map integrity

<a id="ll-090"></a>
#### LL-090 · IpcError JSON.stringify drops `message` for every thrown Error subclass (SkinError/ManagerError/BundleError)

- **Category:** error-handling · **Priority:** P0 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/main/ipc/router.ts:49-64 (normalizeError + wrapForTransport); src/main/services/skin/errors.ts:3-11; src/main/services/minecraft/errors.ts:4-12; src/main/services/bundle/errors.ts:3-11
- **Problem:** normalizeError() treats any value with `code`+`message` in scope as an IpcError and returns it unchanged: `return error as IpcError`. SkinError, ManagerError and BundleError all extend Error and satisfy that `in` check (message is inherited via the prototype). wrapForTransport then does `JSON.stringify(ipcError)`. But `Error.prototype.message` is a NON-enumerable own property in V8, so JSON.stringify of an Error subclass serializes only the enumerable own props (`code`, `name`) and OMITS `message`. The preload's tryUnwrapIpcError then parses `{code, name}`, isIpcError() fails because `typeof candidate.message !== 'string'`, returns null, and the raw `Error("...[object Object]...")` surfaces in the renderer instead of a structured error. The router unit test at tests/main/ipc/router.test.ts:120 only throws a PLAIN object (`{code, message}`) which DOES stringify fully, so it never catches this — the Error-subclass path is untested.
- **Why it matters:** Skin upload failures (SkinError) thrown to mediaUploadSkin, and OP_IN_FLIGHT/NO_ACCOUNT (ManagerError) / OP_IN_FLIGHT/NO_CLIENT_FOLDER (BundleError) thrown synchronously from minecraft.install/launch/repair and bundle.start routes all lose their message and code over IPC. The user sees an opaque '[object Object]' rejection instead of a real reason.
- **Proposed solution:** In normalizeError, when the value is an Error instance with a `code`, build a fresh plain object `{ code, message: error.message, ...(devDetails) }` rather than casting the Error. Better: route every domain error through a single toIpcError(error) that maps domain codes into ERROR_CODES and copies message explicitly. Add a router test that throws an actual `class X extends Error` and asserts the rehydrated message.
- **Touches packages:** No
- **Tests needed:** unit: router.test.ts case throwing a real Error subclass (SkinError-like) asserting tryUnwrapIpcError().message is preserved; ipc-route test for mediaUploadSkin rejecting with a structured SkinError.
- **Guideline:** code-guideline §9 (IpcError serialized to a safe {code,message,details}); architecture.md error model

<a id="ll-091"></a>
#### LL-091 · Domain error codes (MinecraftErrorCodes/BundleErrorCodes) thrown to IPC are rejected by isIpcError — disjoint code namespaces

- **Category:** error-handling · **Priority:** P0 · **Effort:** medium · **Change risk:** medium · **Flow:** IPC flow
- **Area:** src/shared/ipc/errors.ts:9-17 (isIpcError); src/shared/constants/errorCodes.ts:1-22; src/main/services/minecraft/manager.ts:291-314 (requireIdle/acquireWriteLock throw ManagerError); src/main/services/bundle/manager.ts:206-231 (runSync throws BundleError)
- **Problem:** isIpcError() validates `code` against `Object.values(ERROR_CODES)`. ERROR_CODES contains only UNKNOWN/IPC_*/AUTH_*/SETTINGS_*/SKIN_*. But ManagerError carries MinecraftErrorCodes values ('opInFlight','noAccount',...) and BundleError carries BundleErrorCodes values ('opInFlight','noClientFolder',...). These are thrown synchronously from minecraft.install/launch/repair/uninstall and bundle.start IPC routes. Even after the message-serialization bug above is fixed, isIpcError still returns false because the domain code is not in the IpcError registry, so the preload refuses to rehydrate it. The renderer mutation rejects with a raw opaque Error and the carefully-built renderer code tables (errorCopy.ts, REPAIRABLE_ERROR_CODES) never run for the throw-path (they only run for the EVENT path).
- **Why it matters:** There are two parallel, non-overlapping error-code spaces crossing the same boundary. The async event channel uses domain codes; the sync reject channel uses ERROR_CODES; nothing bridges them. OP_IN_FLIGHT (a very common user race: double-click Play) is delivered as garbage to the renderer.
- **Proposed solution:** Introduce one toIpcError(error) translation in the router that maps ManagerError/BundleError/SkinError codes into a unified IpcError code (either widen ERROR_CODES to include the domain codes, or map domain→IpcError). Make isIpcError tolerant: validate that code is a non-empty string and trust the sentinel envelope (the payload already came from our own main process), instead of gating on a closed registry that main can outgrow.
- **Touches packages:** No
- **Tests needed:** ipc-route tests: minecraft.install rejecting with OP_IN_FLIGHT and bundle.start rejecting with NO_CLIENT_FOLDER, asserting the renderer receives a structured {code,message}; unit test for the new toIpcError mapping table.
- **Guideline:** code-guideline §6.4 (error codes shared between main and renderer must be centralized/consistent); §9 error model single shape

<a id="ll-092"></a>
#### LL-092 · No unified toIpcError(): five parallel error models and ad-hoc per-call translation

- **Category:** architecture · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** IPC flow
- **Area:** src/main/ipc/router.ts:49-57; src/main/services/minecraft/errors.ts:14-35 (KIT_CODE_TO_LAUNCHER_CODE); src/main/services/bundle/errors.ts:13-17; src/main/services/skin/errors.ts; src/main/services/auth/yggdrasilAuth.ts:28-33 + routes.ts:22-27 (two more bespoke mappers)
- **Problem:** Error translation is scattered: minecraft/errors.ts maps MinecraftKitError→MinecraftErrorCode; bundle/errors.ts classifies BundleError; yggdrasilAuth.ts maps YggdrasilClientError→LoginErrorCode; auth/routes.ts maps kit/TypeError→LoginErrorCode; router.ts has its own normalizeError. Each is a separate hand-written table with overlapping concerns (ABORTED, NETWORK appear in 3 of them). There is no single boundary function that takes an arbitrary thrown value and produces the IpcError that crosses the wire. This is the root cause of the two P0 bugs above and makes adding a code an N-place edit.
- **Why it matters:** Maintainability and reliability: a new kit error code or a new domain code requires touching multiple disjoint mappers, and it is easy (as shown) to leave one path broken. The guidelines call for a single error shape across the boundary.
- **Proposed solution:** Add src/main/ipc/toIpcError.ts: a single function that recognizes ManagerError/BundleError/SkinError/MinecraftKitError/YggdrasilClientError and IpcError-shaped plain objects, returns a normalized {code,message,details}. Call it from the router catch and delete the inline normalizeError special-casing. Keep the renderer-facing localization tables (errorCopy) but feed them from one code space.
- **Touches packages:** No
- **Tests needed:** unit: toIpcError table covering each error class (kit error, ygg client error, ManagerError, BundleError, SkinError, plain IpcError, bare Error, non-Error) with strong toEqual assertions.
- **Guideline:** architecture.md (IPC contract single source of truth; error model); code-guideline §9

<a id="ll-093"></a>
#### LL-093 · Dead error codes AUTH_NETWORK_ERROR / AUTH_INVALID_CREDENTIALS are never produced

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/constants/errorCodes.ts:6-7,17-18; consumed only at src/renderer/features/auth/hooks.ts:20-21 and tests/renderer/features/auth/hooks.test.ts
- **Problem:** ERROR_CODES.AuthNetworkError and AuthInvalidCredentials are mapped in the renderer's IPC_LOGIN_ERROR_CODES table, but a repo-wide search finds NO main-process producer. The actual auth flow returns a discriminated LoginResult ({ok:false, error: LoginErrorCode}) from yggdrasilAuth.ts/auth routes.ts — it never throws an IpcError with these codes. So loginErrorCodeFromRejection's branches for these two codes are unreachable except via the test that fabricates them.
- **Why it matters:** Dead contract surface. code-guideline §1 forbids dead code ('if something might come in handy later, delete it'). It also misleads readers into thinking login surfaces structured network/credential IpcErrors when it actually uses the LoginResult union.
- **Proposed solution:** Remove AUTH_NETWORK_ERROR/AUTH_INVALID_CREDENTIALS from ERROR_CODES (and the ErrorCode union) and their dead branches in renderer/features/auth/hooks.ts; drop the fabricated-code tests. Login network/credential signalling already lives correctly in LoginErrorCode.
- **Touches packages:** No
- **Tests needed:** none (remove the two fabricated-code cases in hooks.test.ts).
- **Guideline:** code-guideline §1 (no dead code), §13 (no contracts for the future)

<a id="ll-094"></a>
#### LL-094 · IPC router logs EVERY handler failure at logger.error, including expected/recoverable ones

- **Category:** error-handling · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/main/ipc/router.ts:80-84
- **Problem:** The router catch does `logger.error(`Channel ${channel} failed`, ipcError)` unconditionally for all thrown values, including IPC_UNTRUSTED_SENDER (a security probe, not a user-initiated failure), IPC_INVALID_ARGS (a validation reject), and OP_IN_FLIGHT (a benign double-click race that the UI immediately recovers from by re-reading status). Per code-guideline §9, logger.error is reserved for 'an operation the user initiated failed and was NOT recovered'; recovered/expected conditions are warn.
- **Why it matters:** Floods the on-disk error log with non-actionable noise (every untrusted-frame probe, every fast double-click), degrading the 'log must be sufficient for diagnosis' goal by burying real failures.
- **Proposed solution:** Classify before logging: untrusted-sender and invalid-args → warn (or debug for untrusted-sender); OP_IN_FLIGHT and ABORTED → warn/debug; genuine handler crashes (IPC_HANDLER_FAILED/UNKNOWN) → error. A small severity map keyed by IpcError code keeps it declarative.
- **Touches packages:** No
- **Tests needed:** unit: router.test.ts asserting logger.warn (not error) for untrusted-sender and OP_IN_FLIGHT, logger.error for IPC_HANDLER_FAILED.
- **Guideline:** code-guideline §9 (log-level rules: error only for unrecovered user-initiated failures; recovered → warn)

<a id="ll-095"></a>
#### LL-095 · Updater inFlight flag can stick true if download starts but never completes or errors

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/services/updater/index.ts:34,37-62,88-106
- **Problem:** inFlight is set true on 'checking-for-update' and cleared only on 'update-not-available', 'update-downloaded', or 'error'. On 'update-available' it stays true (intentional, to keep the 'downloading…' UI). But Squirrel's autoUpdater has no progress/timeout guarantee: if the background .nupkg download stalls or the network drops without emitting an 'error' event, inFlight never clears, and the updaterCheck handler permanently short-circuits ('skipped (already in flight)'). There is no terminal timeout and no way to re-arm a check.
- **Why it matters:** Operation-map sticking in a non-terminal state — the exact failure class flagged for this area. The user can never trigger another update check for the rest of the session.
- **Proposed solution:** Arm an unref'd watchdog timer when entering CHECKING/AVAILABLE; on expiry, reset inFlight=false and broadcast ERROR (or NOT_AVAILABLE) so the UI re-enables the check. Clear the timer on every terminal transition.
- **Touches packages:** No
- **Tests needed:** unit: drive the event handlers and assert inFlight resets after the watchdog fires; assert updaterCheck re-runs after a stuck check.

<a id="ll-096"></a>
#### LL-096 · Skin Yggdrasil upload logs error then rethrows — surfaced failure logged twice and via wrong helper

- **Category:** error-handling · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/services/skin/skin.ts:103-106 (logger.error + throwUploadError); compounded by router.ts:82 logging again
- **Problem:** uploadSkinYggdrasil catches the upload failure, calls logger.error('Yggdrasil texture upload failed', {kind, error}) and then throwUploadError(...) which throws a SkinError that propagates up through the IPC route. The router catch then logs the same failure a SECOND time at error (router.ts:82). So one user-visible skin upload failure produces two error log lines. The same pattern exists in uploadSkinMojang (skin.ts:153). By contrast clearSkin (skin.ts:192,206) correctly logs at warn because those failures are swallowed/recovered. The upload error here is genuinely user-visible, so error level is correct — but the double log is not.
- **Why it matters:** Duplicate error entries for a single failure muddy diagnosis and inflate the bounded 5MB log. The service shouldn't both log-as-final AND rethrow-to-a-layer-that-also-logs.
- **Proposed solution:** Pick one owner of the error log. Since the router already logs every rejected handler at error, the service should log at debug/warn (context-only) for the rethrow path, or not log at all and let the router own it. Keep the contextual `{kind}` by attaching it as IpcError.details instead of a second log line.
- **Touches packages:** No
- **Tests needed:** none (covered by manual review); optionally an ipc-route test asserting a single error log.
- **Guideline:** code-guideline §9 (log discipline — avoid double error logging)

<a id="ll-097"></a>
#### LL-097 · SkinError reuses the IpcError ERROR_CODES space while Minecraft/Bundle invent their own — inconsistent code modeling

- **Category:** architecture · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** IPC flow
- **Area:** src/main/services/skin/errors.ts:1-11 (SkinError code: ErrorCode); vs src/main/services/minecraft/errors.ts:4-12 (ManagerError code: MinecraftErrorCode); vs src/main/services/bundle/errors.ts:3-11 (BundleError code: BundleErrorCode)
- **Problem:** SkinError is typed with the shared ERROR_CODES ErrorCode union (SKIN_UPLOAD_FAILED/SKIN_NOT_AUTHENTICATED live in errorCodes.ts), so it round-trips through isIpcError correctly. But Minecraft and Bundle errors use their own domain code enums in contracts/*.ts that are NOT in ERROR_CODES. Three sibling services model 'the code I throw' three different ways. This inconsistency is the structural reason the P0 namespace bug exists for two of them but not the third.
- **Why it matters:** code-guideline §6.2 'Pick one style per category (statuses, codes, channels) and stay consistent.' The skin pattern (codes in the shared ERROR_CODES registry) is the one that actually works across IPC; the other two diverge.
- **Proposed solution:** Decide one convention: either (a) all IPC-thrown error codes live in the shared ERROR_CODES registry (add minecraft/bundle throw-path codes there), or (b) the unified toIpcError maps every domain code into ERROR_CODES at the boundary. Document which codes are 'event-only' (delivered via *.error events) vs 'throwable over IPC'.
- **Touches packages:** No
- **Tests needed:** unit: assert every code a service can THROW (not just emit) is representable as an IpcError after toIpcError.
- **Guideline:** code-guideline §6.2 (one style per category), §6.4 (centralize cross-layer error codes)

<a id="ll-098"></a>
#### LL-098 · isIpcError gates on a closed ERROR_CODES registry, so any new IpcError code from main is silently dropped at the preload

- **Category:** IPC · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/shared/ipc/errors.ts:9-37 (isIpcError used by tryUnwrapIpcError); src/preload/index.ts:23-28
- **Problem:** tryUnwrapIpcError only rehydrates the payload if isIpcError passes, and isIpcError requires `Object.values(ERROR_CODES).includes(code)`. The envelope is already authenticated by the IPC_ERROR_SENTINEL (it came from our own main router). Gating additionally on a hard-coded enum means: the moment main throws a code not yet added to the renderer's ERROR_CODES copy (e.g. a freshly added code, or a domain code per the P0 finding), the structured error is discarded and a raw '[object Object]' Error reaches the renderer. The registry check is doing double duty as both validation and an allowlist, and failing closed in the wrong direction.
- **Why it matters:** Brittle boundary: every code addition is a two-file lockstep change or the renderer silently degrades. The sentinel already proves provenance; the extra enum gate adds fragility without security benefit.
- **Proposed solution:** Relax isIpcError (in the unwrap path) to require `typeof code === 'string' && code.length > 0 && typeof message === 'string'` and drop the registry membership check there. Keep the registry as the renderer's localization key space, but don't let an unknown code cause total loss of the structured payload — fall back to a generic localized message keyed by an UNKNOWN bucket.
- **Touches packages:** No
- **Tests needed:** unit: tryUnwrapIpcError rehydrates a payload whose code is NOT in ERROR_CODES (asserts code+message preserved).
- **Guideline:** architecture.md (IPC error model robustness); code-guideline §9

<a id="ll-099"></a>
#### LL-099 · bundle getInstallState swallows real failures as 'up-to-date', and tryGetClient masks not-found vs transient errors

- **Category:** error-handling · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:194-201 (drift check catch), 351-357 (tryGetClient catch-all)
- **Problem:** getInstallState's drift check catches ANY fetchRemoteManifest failure and assumes signatureMatches=true ('assume up-to-date'). That is correct for offline/transient network, but it also swallows a genuine MANIFEST_INVALID/404 (bundle removed upstream) as 'up to date', so the UI shows Play with stale files and no update affordance. Separately, tryGetClient (line 351) catches everything and returns null, conflating 'client genuinely not found' with 'transient clients-API error' — runSync then throws UNKNOWN 'Client not found' for what may be a network blip.
- **Why it matters:** Partial-failure handling that hides a contract-level failure (bundle gone) behind the offline-tolerance path. Reduces diagnosability and can leave the user on a silently-broken bundle.
- **Proposed solution:** Distinguish abort/network (warn, assume match) from a definitive 4xx/invalid-manifest (surface signatureMatches=false or a soft error event). For tryGetClient, only swallow a definitive not-found; rethrow/translate transient errors so runSync reports NETWORK rather than UNKNOWN 'not found'.
- **Touches packages:** No
- **Tests needed:** unit: getInstallState with (a) network abort → signatureMatches true, (b) HTTP 404/invalid manifest → not treated as up-to-date; runSync test where clients API throws transiently.
- **Guideline:** code-guideline §9 (warn for recovered, but don't mask a non-recovered contract failure as success)

<a id="ll-100"></a>
#### LL-100 · startInstall releases the operation lock twice (in .then and .finally) — confusing redundancy around launchHook

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/minecraft/manager.ts:128-151; idempotency at src/main/services/clientOperationLocks.ts:138-148
- **Problem:** runInstall(...).then() calls lock.release() at line 130 (before awaiting launchHook), and .finally() calls lock.release() again at line 150. The lease is idempotent (clientOperationLocks.ts:139 guards with `if (released) return`), so it's not a leak — but the double release obscures intent: the lock is dropped BEFORE the post-install bundle sync runs, meaning the bundle service must re-acquire its own lock during launchHook. A reader cannot tell from this code whether the early release is deliberate (it is — to let bundle acquire) or a bug. The redundant .finally release is pure noise.
- **Why it matters:** Readability/correctness clarity in a concurrency-sensitive path. code-guideline §10 wants the non-obvious 'why' documented and no redundant code. Right now the intent (release-before-bundle-sync) is undocumented and the second release is dead.
- **Proposed solution:** Release exactly once, right after the INSTALLED emit and before launchHook, with a one-line comment explaining the bundle service acquires its own lock. Remove the .finally release (or invert: keep only the finally and drop the .then release, but then document that bundle sync runs while holding the minecraft lock).
- **Touches packages:** No
- **Tests needed:** unit: assert lock.release called once on the success+launchHook path and once on the failure path.
- **Guideline:** code-guideline §1 (no dead/redundant code), §10 (document non-obvious why)
- **Verification note:** Confirmed the double release: manager.ts:130 (.then, before launchHook) and :150 (.finally). Idempotency guard verified — but the file is src/main/services/clientOperationLocks.ts (NOT minecraft/clientOperationLocks.ts as the finding's area implied) at line 139 `if (released) return`. Corrected the area to the actual path. Note the early release at 130 is on the success branch only; the .catch (146-148) branch reaches .finally without a prior release, so the .finally release is NOT fully dead — it is the sole release on the failure branch. The .then release IS redundant with .finally on the success path. Adjusted wording accordingly; the readability concern stands. P3 accurate.

<a id="ll-101"></a>
#### LL-101 · errorMessage() is duplicated verbatim across minecraft and bundle error modules

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/minecraft/errors.ts:37-38 and src/main/services/bundle/errors.ts:19-20 (identical `error instanceof Error ? error.message : String(error)`); near-duplicate inline at src/main/services/skin/skin.ts:29
- **Problem:** The same errorMessage helper is defined twice verbatim in minecraft and bundle error modules, and a third near-identical inline variant lives in skin.ts:29 (`error instanceof Error ? error.message : 'Unknown error'`). Three private copies drift independently and none handles the kit/ygg structured-error message extraction (e.g. responseBody) that skin.ts had to re-implement inline as extractMojangMessage (skin.ts:37-57).
- **Why it matters:** Small duplication today, but it is the seam where structured-error message extraction keeps getting re-invented (skin extractMojangMessage). Centralizing message extraction reduces the surface that the P0 serialization fix must touch.
- **Proposed solution:** Hoist a single errorMessage (and optionally a structured-error message extractor) into one shared main/infra module and have skin/minecraft/bundle import it. This is a launcher-internal dedupe — the kit does NOT currently export an errorMessage helper, so no package change is required unless you decide to push a generic structured-error extractor upstream.
- **Touches packages:** No. Launcher-internal dedupe only; no package change. (Verified: @loontail/minecraft-kit dist/index.d.ts does NOT export `errorMessage`, so the original claim that the kit 'exports errorMessage-style helpers' is inaccurate.)
- **Tests needed:** unit: errorMessage over Error, plain string, object, null/undefined.
- **Guideline:** code-guideline §3.7 (extract when used in 2+ places); dependency-extraction (do not re-implement what the package exports)
- **Verification note:** Verified the verbatim duplication: minecraft/errors.ts:37-38 and bundle/errors.ts:19-20 are byte-identical. skin.ts:29 is a near-duplicate (`: 'Unknown error'` instead of `: String(error)`). BUT grep of node_modules/@loontail/minecraft-kit/dist/index.d.ts found NO `errorMessage` export, so the finding's affectsKit:true and the claim the kit 'exports errorMessage-style helpers' are wrong. Corrected affectsKit→false and packageWhat to launcher-internal dedupe only. The duplication itself is real. P3 accurate.

<a id="ll-102"></a>
#### LL-102 · Install/launch failure events collapse unmapped kit codes to KIT_ERROR, losing the failure class the renderer needs

- **Category:** error-handling · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/services/minecraft/errors.ts:14-35 (KIT_CODE_TO_LAUNCHER_CODE partial map + classifyError); src/main/services/minecraft/install.ts:86-89; src/main/services/minecraft/launch.ts:153,367 (emitError on the EVENT channel)
- **Problem:** KIT_CODE_TO_LAUNCHER_CODE is a Partial map covering ~10 kit codes; classifyError collapses every other MinecraftKitErrorCode to KIT_ERROR. install/launch failures are delivered to the renderer via the EVENT channel (env.emitError → MinecraftErrorEvent {slug,code,message}), which carries only the launcher code + a message string — the original kit code is lost for the renderer, so its errorCopy table cannot distinguish unmapped kit failure classes (they all render as 'kitError').
- **Why it matters:** Reduces the renderer's ability to localize/branch on the specific failure class for kit errors the map doesn't list. The message string still differs, so it is a UX/diagnosability nicety, not a data-loss bug.
- **Proposed solution:** Either expand KIT_CODE_TO_LAUNCHER_CODE coverage, or include the original kit code in the MinecraftErrorEvent payload (e.g. an optional kitCode field) so the renderer can branch on it. Keep the full error object in the log (already done).
- **Touches packages:** No
- **Tests needed:** unit: classifyError over each mapped kit code returns the mapped launcher code; an unmapped kit code returns KIT_ERROR (and, if the payload is extended, carries the original kitCode).
- **Verification note:** REWRITTEN — the original finding (P2) conflated two channels and made a false claim. It said 'in production it is dropped entirely... structured IpcError.details is empty in prod' via router.devDetailsFor. But install/launch failures are NOT thrown through the router — they are emitted via env.emitError on the EVENT channel (install.ts:89, launch.ts:153/367). The LOG at install.ts:88 logs the FULL error object (with kit code/context) regardless of dev/prod, so the 'prod log loses context' claim is FALSE. router.devDetailsFor (router.ts:36-47, dev-only kit context) applies only to the throw path, which for install/launch isn't used. The genuine residual issue is narrower and milder: classifyError (errors.ts:32) maps unmapped kit codes to KIT_ERROR, and the EVENT payload carries only that launcher code, so the renderer cannot distinguish unmapped kit failure classes. Downgraded P2→P3, corrected area/problem/solution, removed the false §9 prod-log violation.

<a id="ll-103"></a>
#### LL-103 · Renderer PlayButton status switch uses a default fallthrough instead of assertNever exhaustiveness

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/PlayButton.tsx:101-121 (selectPlayButtonAction switch has default fallthrough)
- **Problem:** selectPlayButtonAction closes its switch with `default: return PlayButtonActions.INSTALL` instead of assertNever(status). InstallStatus is a discriminated union; the switch explicitly handles UNKNOWN/REPAIRING/UNINSTALLING/LAUNCHING/RUNNING/INSTALLED/UNVERIFIED/ERROR, with INSTALLING handled before the switch (line 91) and NOT_INSTALLED intentionally falling to default→INSTALL. A newly added InstallStatus would silently map to INSTALL (treating an in-progress/error state as 'ready to download') and compile clean.
- **Why it matters:** code-guideline §1 requires closing every discriminated-union switch with assertNever so the compiler errors when a variant is added. Here a new InstallStatus would compile and mis-render as Download.
- **Proposed solution:** Add an explicit `case InstallStatuses.NOT_INSTALLED: return PlayButtonActions.INSTALL;` branch and replace the `default` arm with `default: return assertNever(status)` (the kit exports assertNever). This makes a future status a compile error.
- **Touches packages:** No
- **Tests needed:** extend tests/renderer/features/clients/playButtonState.test.ts to assert each InstallStatus maps to a distinct action (so an added status without a branch fails to compile / fails the test).
- **Guideline:** code-guideline §1 (always close switch on a discriminated union with assertNever)
- **Verification note:** Confirmed PlayButton.tsx:118-119 `default: return PlayButtonActions.INSTALL`. The InstallStatus union (minecraft.ts:9-20) has 10 members; the switch handles 8 explicitly, INSTALLING is short-circuited at line 91, and NOT_INSTALLED genuinely relies on default. So an assertNever default cannot be added without first adding an explicit NOT_INSTALLED case — refined the solution to say so. Dropped the second cited area (errorCopy.ts Record maps) since those are already exhaustive-by-construction Records and not part of the actual violation; this finding is solely about the PlayButton switch. P2 accurate.

<a id="ll-104"></a>
#### LL-104 · Skin upload mutation has no code-aware error handling or localization (no localizeSkinError)

- **Category:** error-handling · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/renderer/features/skin/hooks.ts:19-30 (useUploadSkin), 32-43 (useClearSkin); producer src/main/services/skin/skin.ts:170-178
- **Problem:** uploadSkin throws SkinError with codes SKIN_UPLOAD_FAILED / SKIN_NOT_AUTHENTICATED and human messages (including the extracted Mojang reason from extractMojangMessage). But useUploadSkin's mutation has no onError and no localization of the IpcError code — the message bubbles up raw (and, due to the #1 serialization bug, may be lost entirely). There is no skin equivalent of localizeMinecraftError/localizeBundleError (confirmed: those two exist, localizeSkinError does not), so a banned-skin reason or 'not authenticated' is shown (at best) as the raw English service string, bypassing i18n.
- **Why it matters:** Inconsistent with the Minecraft/Bundle error surfaces which are fully localized by code. The careful extractMojangMessage work in main is only half-delivered because the renderer never maps the code.
- **Proposed solution:** Add a localizeSkinError(code,message,t) mirroring the other features, and an onError on the upload/clear mutations that toasts it. After the #1 fix lands, the SkinError code+message will actually arrive to be localized.
- **Touches packages:** No
- **Tests needed:** unit: localizeSkinError code→key table covers both skin codes; mutation onError surfaces the toast.
- **Guideline:** code-guideline §9 (consistent error surfacing); §15 (English-only artifacts — user strings must go through i18n)

<a id="ll-105"></a>
#### LL-105 · notifier.send swallows all send failures with an empty catch and no log

- **Category:** error-handling · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/main/infra/notifier.ts:13-21
- **Problem:** send() wraps webContents.send in try/catch with an empty body and a comment ('renderer torn down between checks — drop the push'). That is the right call for the teardown race, but it also silently swallows ANY send failure (serialization error in the payload, an unexpected throw), so a malformed NotificationPayload would vanish with zero trace. notifier is the sink for uncaughtException/unhandledRejection (index.ts:49,54), making a silent drop here the worst place to lose a signal.
- **Why it matters:** code-guideline §9 wants recovered failures logged at warn, not dropped. A truly silent catch on the crash-notification path can hide the very crashes it exists to report.
- **Proposed solution:** Keep swallowing the destroyed-window race (cheap guard already does that), but log at debug/warn inside the catch with the channel name so an unexpected send failure is at least traceable. Optionally narrow the catch to the known 'Object has been destroyed' case.
- **Touches packages:** No
- **Tests needed:** none (small); optionally unit assert a warn is logged when send throws a non-teardown error.
- **Guideline:** code-guideline §9 (recovered failures → warn, not silent), §1 (no swallowing without why)

### Performance, async, fs efficiency, cancellation & races

<a id="ll-106"></a>
#### LL-106 · Bundle download promise never settles when signal is already aborted

- **Category:** flow · **Priority:** P0 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/download.ts:54-83 (requestOnce)
- **Problem:** In requestOnce, req is added to currentRequests at line 54, then onAbort is defined (55-57), then the early-abort branch (58-64) calls onAbort() (which does req.destroy(error)) and `return`s at line 61. The req.on('error') / req.on('timeout') / req.on('close') handlers that reject() and delete from currentRequests are only registered at lines 65-81, AFTER the early return. On the pre-aborted path none of them are attached, so the destroy error is unobserved, the response callback (line 50) never fires, and the Promise<IncomingMessage> can never settle. The 60s request timeout is also never wired (its handler is below the return too), so there is no safety net. A worker can reach this state via a real race: runDownloadWorker passes its `while (!task.cancelled && !task.paused)` check (runner.ts:94), shift()s an entry, and then cancelSync/pauseSync calls task.abort.abort() before the worker enters requestOnce — at which point options.signal.aborted is true on entry.
- **Why it matters:** The hung await wedges Promise.all in runDownloadPhase (runner.ts:130), so runSyncPhases never returns, executePreparedSync's try never completes, its finally (manager.ts:323-327) never runs, and the operation lock + activeSyncs slot are never released — permanently blocking that slug for the session. cancelSync destroying the req (manager.ts:154-156) does NOT help because the promise still has no error/close listener to settle it.
- **Proposed solution:** In the `if (options.signal.aborted)` branch, settle explicitly: options.currentRequests.delete(req); req.destroy(); reject(new BundleError(BundleErrorCodes.ABORTED, 'Download aborted')); return;. Cleaner: move the error/timeout/close listener registration ABOVE the abort check so any destroy is always observed. Add a unit test that calls downloadEntry/requestOnce with a pre-aborted AbortSignal and asserts it rejects ABORTED and leaves currentRequests empty.
- **Touches packages:** No
- **Tests needed:** unit: downloadEntry with pre-aborted signal rejects ABORTED and does not hang; unit: currentRequests is emptied after a pre-aborted reject.
- **Guideline:** docs/code-guideline.md — try/finally for cleanup / always-settle expectation (a promise that can never settle defeats the lock-release finally)

<a id="ll-107"></a>
#### LL-107 · getInstallState re-fetches remote manifest with no in-flight dedup or short-TTL cache

- **Category:** performance · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:194-201 (getInstallState drift check); src/main/services/bundle/routes.ts:31-34 (bundleCheckStatus handler)
- **Problem:** bundleCheckStatus → getInstallState performs a network fetchRemoteManifest(client.bundleSlug) on every call to compute signatureMatches, plus loadLocalManifest reads+JSON.parses the sidecar each time. There is no dedup of concurrent same-slug calls and no caching, so a status-heavy screen (mount + focus + client switch + per-card) fires several near-simultaneous IPC calls that each trigger an independent HTTP round-trip and full schema parse.
- **Why it matters:** Redundant network + JSON+Zod parse on a UI-driven hot path. Each fetchRemoteManifest call reads the body, JSON.parses, and runs RemoteManifestSchema.safeParse over the whole manifest (api.ts:73-89) — but the drift check only needs the hash.
- **Proposed solution:** Add an in-flight Map<slug, Promise<RemoteManifestFetchResult>> (mirroring mediaCache.ts:43 inFlight) or a small TTL cache (5-10s) keyed by bundleSlug so concurrent/rapid status checks share one fetch. Keep the offline-tolerant catch behaviour (manager.ts:198-200).
- **Touches packages:** No
- **Tests needed:** unit: two concurrent getInstallState calls for the same slug invoke fetchRemoteManifest once.
- **Verification note:** Real: confirmed no dedup/TTL on fetchRemoteManifest anywhere (grep shows only the two manager.ts call sites, neither memoized). Corrected the cited line range from 170-202 to the actual drift-check block 194-201. The auditor's aside that 'fetchRemoteManifest's callers elsewhere already de-dupe' is inaccurate — there is no existing dedup — but the core gap is genuine. mediaCache.ts:43 is a valid pattern to mirror.

<a id="ll-108"></a>
#### LL-108 · getFolderSize walks the entire client tree (tens of thousands of stats) on every IPC call

- **Category:** performance · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/main/infra/system.ts:97-141 (walkDirectorySize/getFolderSize); invoked via src/main/services/system/routes.ts:41 from src/renderer/features/settings/hooks.ts:116-129 (useFolderSize)
- **Problem:** getFolderSize does a full recursive readdir+stat walk of the client folder. A Minecraft install holds tens of thousands of files (assets/objects); the comment at system.ts:68 acknowledges this. The renderer caches with FOLDER_SIZE_STALE_TIME_MS and a debounce, but every cache-miss (client switch, settings open) re-walks the whole tree from scratch — no main-side memoization and no incremental/cached size. WALK_CONCURRENCY=16 caps libuv pressure but total stat count is O(files).
- **Why it matters:** Opening System/Storage settings or switching clients triggers a multi-second fs storm competing with active install/launch fs work on the same libuv thread pool. The size is approximately knowable from the bundle local manifest (sum of files[].size) and the target install manifest.
- **Proposed solution:** Add a main-side cache keyed by path with a TTL (30-60s) so repeated IPC calls within a session reuse the last walk. Better: derive approximate size from the local bundle manifest + kit's install manifest when present, falling back to the walk only when no manifest exists.
- **Touches packages:** No
- **Tests needed:** unit: getFolderSize second call within TTL does not re-walk (mock readdir/stat call counts).

<a id="ll-109"></a>
#### LL-109 · buildPlan does fully sequential await-in-loop disk checks with no parallelism cap

- **Category:** performance · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/plan.ts:73-131 (buildPlan main loop), 36-43 (hashFile), 45-52 (exists)
- **Problem:** buildPlan iterates remoteEntries with a for…of and awaits exists()/hashFile() one entry at a time. In force/repair mode every file falls through to the disk-hash fast path (lines 120-130) and is hashed strictly serially (hashFile streams the whole file), so planning a 10k-file bundle is a single-threaded chain of thousands of awaited fs ops. Unlike system.ts (createLimiter at WALK_CONCURRENCY) there is no bounded parallelism here.
- **Why it matters:** Serial planning is the dominant cost of a Repair/force sync; a bounded-concurrency limiter (8-16) overlaps the access/hash work across libuv threads, dropping planning time near-linearly.
- **Proposed solution:** Extract the createLimiter helper from system.ts:73-95 to a shared util and map remoteEntries through a bounded-concurrency classifier instead of the serial for-loop; collect results then push into toDownload/toUpdate/toSkip deterministically. Do NOT change the force-mode rehash semantics (see verifier note).
- **Touches packages:** No
- **Tests needed:** unit: buildPlan classification unchanged vs current for a fixture set; integration: planning a large fixture overlaps fs (limiter active count <= cap).
- **Verification note:** Serial-loop perf claim is real (plan.ts:73 for…of with awaited exists/hashFile, no limiter). But the auditor's secondary 'skip rehashing when local sha matches in force mode' suggestion is WRONG and removed from the solution: force mode is explicitly documented (plan.ts:7-11, 'ignore local manifest fast-path, re-hash everything ... trust observed state, not cached state') — short-circuiting on the cached sha defeats Repair's entire purpose. Kept the parallelization (behaviour-preserving) and dropped the semantics change. Priority P2 appropriate.

<a id="ll-110"></a>
#### LL-110 · Sliding speed window can read a near-zero elapsed and report a transiently inflated KB/s

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/runner.ts:67-91 (maybeEmit speed calc), 113-117 (runDownloadPhase window init)
- **Problem:** maybeEmit computes speed = speedWindowBytes/elapsed*1000 (guarded by elapsed>0) and only AFTER computing resets the window when elapsed > SPEED_WINDOW_MS (lines 75-78). Right after a window roll, the next emit computes the rate over a partial sub-window (the bytes since the reset over a short elapsed), so the KB/s readout can jump between the full-window average and a higher/lower partial-window value at each roll boundary.
- **Why it matters:** User-visible: the KB/s readout can step at window-roll boundaries. Minor polish on the progress UI.
- **Proposed solution:** Guard with a minimum-elapsed floor (carry the previous speed when elapsed < some MIN_MS) and/or reset the window before computing the next interval's rate, or use an EWMA over recent onChunk deltas with the existing 1s window as the smoothing horizon.
- **Touches packages:** No
- **Tests needed:** unit: maybeEmit with a tiny elapsed and a large byte chunk does not emit an out-of-range speedBytesPerSec.
- **Verification note:** Real but overstated. The very first forced emit (runDownloadPhase:115-117) has speedWindowBytes=0 so speed=0, not inflated. In steady state the 100ms throttle (maybeEmit:68) means elapsed is bounded ~100-1000ms, so the deviation is a bounded partial-window artifact (roughly 2-10x at a roll boundary), not the 'wildly inflated / implausible' values the auditor described. Softened the problem/why wording; kept P3.

<a id="ll-111"></a>
#### LL-111 · cancelAll uses a fixed 250ms sleep as a shutdown grace window instead of joining real cleanup

- **Category:** flow · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Error / recovery flow
- **Area:** src/main/services/bundle/manager.ts:448-454 (cancelAll)
- **Problem:** cancelAll cancels every active sync then unconditionally awaits setTimeout(graceMs=250) to let the runners' finally blocks (tmp cleanup, manifest writes) land. This is a guess: if a saveLocalManifest write or tmp rm takes >250ms (slow disk / antivirus on Windows — exactly the case download.ts:173-178/195-199 call out) the app can quit mid-write; if everything finished in 5ms the shutdown still blocks the full 250ms. There is no actual await of the in-flight task promises.
- **Why it matters:** On shutdown this can leak a half-written/tmp manifest (saveLocalManifest does writeFile-then-rename; killed between them leaks the tmp) or skip tmp cleanup, while also adding fixed latency to every quit. Cooperative cancel has no deterministic join point.
- **Proposed solution:** Track each active sync's terminal promise (the executePreparedSync chain) on ActiveSync and have cancelAll await Promise.allSettled([...inflight]) raced against a bounded timeout, instead of a blind sleep — joining the real cleanup and returning as soon as it is done.
- **Touches packages:** No
- **Tests needed:** unit: cancelAll resolves only after each active sync's cleanup promise settles (or after the timeout), not on a fixed delay.
- **Guideline:** docs/code-guideline.md — try/finally cleanup / do not let a blind sleep truncate the bookkeeping write

<a id="ll-112"></a>
#### LL-112 · forgeProcessor output verification hashes every output strictly serially

- **Category:** performance · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:91-98 (processorOutputsOk), 100-108 (brokenProcessorIndices), 64-85 (sha1OfFile/fileMissing)
- **Problem:** processorOutputsOk loops Object.entries(action.outputs) awaiting fileMissing(stat) then sha1OfFile (full stream read) one output at a time, and brokenProcessorIndices loops every processor serially. Forge processor outputs include multi-MB jars (srg/extra/client). On every repair preflight — including the cached-clean fast path (lines 128-136) — this rehashes all outputs sequentially with no concurrency cap, blocking the repair on a serial hash chain.
- **Why it matters:** Repair latency: a clean Forge install still pays a full serial sha1 sweep of all processor outputs before declaring them clean. Bounded-parallel hashing overlaps the disk+CPU work across the libuv pool.
- **Proposed solution:** Run per-output and per-processor checks with a bounded-concurrency limiter (reuse the shared createLimiter from system.ts), short-circuiting a processor as broken on first mismatch. Optionally cache last-good (path,mtime,size)→sha1 to skip rehashing unchanged outputs across repeated repair attempts in a session.
- **Touches packages:** Yes — minecraft-kit. If the kit gains a public 'verify forge processor outputs' helper this module could move upstream (kit.verify.forge skips generated processor outputs by design — file header at forgeProcessorHealing.ts:110-113). Extracting a processor-output verifier into @loontail/minecraft-kit would require adding the API and rebuilding+copying dist into the launcher node_modules. Not required for the perf fix, which stays launcher-side.
- **Tests needed:** unit: brokenProcessorIndices returns the same set as today for a fixture; perf: hashing runs with bounded concurrency.

<a id="ll-113"></a>
#### LL-113 · Forge-processor verification re-runs kit.install.plan to recover output actions on cache miss

- **Category:** performance · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:138-142 (cache miss → kit.install.plan); src/main/services/minecraft/repairWorkflow.ts:132 (ensureLaunchable → kit.install.plan); src/main/services/minecraft/repair.ts:41-48
- **Problem:** forgeProcessorActionsCache is an in-memory module Map (line 18) cleared on every process start. On the first repair after restart it has no entry, so repairMissingForgeProcessorOutputs calls the full kit.install.plan(target) (138) purely to extract RunForgeProcessor actions. Separately, ensureLaunchable also calls kit.install.plan (repairWorkflow.ts:132). In a single runRepair flow (repair.ts:40-48), healForgeProcessors and ensureLaunchable each call install.plan independently, so for a Forge target with broken processors and an unresolvable launch version the plan is computed twice.
- **Why it matters:** A repair after relaunch can pay two full install-plan computations even though both consumers need the same plan for the same target. install.plan resolves the whole install graph and is not cheap.
- **Proposed solution:** Thread a single InstallPlan through runRepair (compute once, pass to both healForgeProcessors and ensureLaunchable) instead of each step calling kit.install.plan independently. Optionally persist the processor action list in the .loontail sidecar so cold-start repairs skip re-planning.
- **Touches packages:** No
- **Tests needed:** unit: a single runRepair invocation computes kit.install.plan at most once when both healForgeProcessors and ensureLaunchable need it.
- **Verification note:** Confirmed two independent install.plan calls per repair (forgeProcessorHealing.ts:138 + repairWorkflow.ts:132, both reached in repair.ts:40-48). Corrected the cited line (126-144 → 138-142 for the plan call). The auditor's 'two or three times per repair' is an overstatement — verifyAndRepairBase calls kit.repair.all (which plans internally but is not a launcher-visible install.plan), so the launcher makes at most 2 install.plan calls in this flow, not 3; adjusted the wording to 'twice'.

<a id="ll-114"></a>
#### LL-114 · Media protocol reads the whole cached file into a Buffer and serves it non-streamed

- **Category:** performance · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/main/services/media/protocol.ts:21-39 (registerMediaProtocol handler); src/main/services/media/mediaCache.ts:75-91 (fetchCachedMedia readBuffer)
- **Problem:** On every cache:// request fetchCachedMedia does readBuffer (full readFile into memory, mediaCache.ts:77) and the protocol handler wraps cached.body (a Buffer) in a Response cast to ReadableStream (protocol.ts:32). Large images (or many concurrent <img> loads in a grid) each load the entire file into a Buffer in main, then hand a Buffer to Electron's Response. There is no streaming (createReadStream), and on the disk-hit path the mime is re-guessed from the URL extension (mediaCache.ts:79 guessMimeFromUrl) rather than stored.
- **Why it matters:** Memory churn under image-heavy screens (screenshot/cape grids): N full-file Buffers resident simultaneously in the main process. Streaming a file handle into Response keeps memory flat and lets Electron backpressure.
- **Proposed solution:** Return a streamed Response backed by fs.createReadStream of the cache file (resolve the file path in mediaCache and expose it), falling back to fetch-and-store only on miss. Persist the content-type alongside the body (sidecar or filename suffix) so the disk-hit path serves the true mime instead of guessMimeFromUrl.
- **Touches packages:** No
- **Tests needed:** unit: cache hit returns a streamed body and the stored mime; integration: many concurrent media requests do not load all bodies into memory at once.

<a id="ll-115"></a>
#### LL-115 · Remote manifest is flattened/iterated multiple times per sync (plan + persist)

- **Category:** performance · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/plan.ts:64 (flattenEntries) + 65-67 (bundleOwnedRelativePaths map); src/main/services/bundle/manifestSnapshot.ts:4-14 (flattenRemote); src/main/services/bundle/manager.ts:277 (buildPlan) + 337 (flattenRemote in persist)
- **Problem:** For a single sync the remote manifest is walked to flat form multiple times: buildPlan calls flattenEntries (plan.ts:64) and separately builds bundleOwnedRelativePaths by mapping the same entries (65-67); then persistLocalManifest calls flattenRemote (manager.ts:337 → manifestSnapshot.ts) which re-walks Object.values(manifest) to build the files map. normalizePathForSet runs a regex replace on every path on each pass.
- **Why it matters:** Redundant O(files) traversals + per-path regex on the sync hot path. The plan already computes the same key set (bundleOwnedRelativePaths); persist could reuse a single flattened representation instead of re-walking the nested manifest.
- **Proposed solution:** Compute one flattened {path, sha256, size} list/Map once when the remote manifest is loaded in executePreparedSync and pass it to both buildPlan and persistLocalManifest. Cache the normalized key on the flattened entry to avoid re-running the regex.
- **Touches packages:** No
- **Tests needed:** unit: persisted local manifest files map equals current output for the same remote (refactor is behaviour-preserving).
- **Verification note:** Real micro-redundancy: plan.ts iterates the flattened array twice (flattenEntries + the .map for bundleOwnedRelativePaths) and manifestSnapshot.flattenRemote re-walks the nested manifest at persist time. Corrected the cited buildPlan line (280 → 277). 'Three separate times' is loosely true (two array iterations in buildPlan + one nested re-walk in persist). P3 is correct — genuinely minor; only worth doing as part of other plan.ts work.

<a id="ll-116"></a>
#### LL-116 · saveLocalManifest / saveTargetInstallManifest rename-over-existing lacks the pre-remove download.ts uses

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manifestRepo.ts:34-45 (saveLocalManifest); src/main/services/minecraft/installManifest.ts:110-119 (saveTargetInstallManifest); compare download.ts:189-193
- **Problem:** saveLocalManifest writes tmp then fs.rename(tmp, target) (manifestRepo.ts:44). download.ts:189-193 explicitly documents that on Windows fs.rename fails when the destination exists and therefore removes the destination first. saveLocalManifest and saveTargetInstallManifest (installManifest.ts:118) do NOT pre-remove, so a rename-over-existing can throw on Windows. In persistLocalManifest the throw is caught and only warns (manager.ts:344-348), so the practical effect is a successful sync that silently fails to persist its manifest — meaning the NEXT sync re-downloads/rehashes everything because the local-manifest fast-path is stale.
- **Why it matters:** Lost manifest persistence turns every subsequent sync into a full re-plan/re-hash (the exact redundant recomputation this area targets), and is platform-specific (Windows is the primary target). The codebase already applies the fix inconsistently in download.ts.
- **Proposed solution:** Apply the same idempotent pre-remove: await fs.rm(target, { force: true }) before fs.rename(tmp, target) in saveLocalManifest and saveTargetInstallManifest. Note rename-over-existing usually succeeds on modern Node 20/Windows, so confirm with a Windows test before assuming it is currently broken — but closing the inconsistency with download.ts's documented behaviour is worthwhile.
- **Touches packages:** No
- **Tests needed:** unit (Windows-aware): saveLocalManifest overwrites an existing manifest without throwing; integration: a second sync after a successful first uses the skip fast-path (no re-download).

<a id="ll-117"></a>
#### LL-117 · Manifest fetch reads+validates the whole body for the drift check that only needs the hash; no size cap

- **Category:** performance · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/api.ts:73-93 (fetchRemoteManifest: response.text → JSON.parse → RemoteManifestSchema.safeParse → sha256(rawText))
- **Problem:** fetchRemoteManifest reads the full body as text (line 73), JSON.parses it, runs RemoteManifestSchema.safeParse over the entire decoded object (83), then hashes the raw text (92) — multiple full passes over a manifest that can be large for a big modpack, with no upper size guard before parsing/validating. For the getInstallState drift check (manager.ts:196-197) only manifestHash is compared, so the full schema validation is wasted there. There is no max-bytes limit before allocation/validation on a network-controlled payload.
- **Why it matters:** For the drift/status path the full Zod validation is unnecessary work, and there is no defensive cap on body size before allocation/parse of a network payload.
- **Proposed solution:** Split the API: a lightweight fetch that returns only manifestHash (hash the raw text without safeParse) for the drift/status path, and the full validated fetch only when a sync actually needs entries. Add a max-content-length guard (reject manifests over a sane cap) before JSON.parse. Keep validation on the sync path.
- **Touches packages:** No
- **Tests needed:** unit: drift-only fetch computes hash without invoking full schema parse; unit: oversized manifest body is rejected before parse.
- **Guideline:** docs/code-guideline.md — Validate input at system boundaries (no size bound on a network payload before allocation/parse)
- **Verification note:** Confirmed the full read+JSON.parse+safeParse+hash in api.ts:73-93 with no size cap, and that the drift check (manager.ts:196-197) only uses manifestHash. Removed the spurious src/main/infra/http.ts:109-118 citation: fetchRemoteManifest uses httpRequest (api.ts:46), NOT httpGet, so the http.ts schema.parse path is unrelated to this manifest fetch. The 'reads body twice' phrasing was also wrong — response.text() is called once (line 73); reworded. Net finding is valid as a P3 + a legitimate input-validation guideline note for the missing size cap.

<a id="ll-118"></a>
#### LL-118 · resolveClientFolder allocates the full resolved settings object just to read one field

- **Category:** performance · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Profile / version flow
- **Area:** src/main/services/bundle/manager.ts:359-362 (resolveClientFolder); src/main/services/minecraft/context.ts:37-79 (buildContext); src/shared/domain/settingsResolution.ts:9-46
- **Problem:** resolveClientSettings rebuilds the full ResolvedClientSettings object (including the diff sub-object, settingsResolution.ts:39-44) on every call. resolveClientFolder (manager.ts:359-362) calls it purely to read storage.clientFolder. In one sync/launch flow it is invoked several times: runSync→resolveClientFolder, getInstallState→resolveClientFolder, and buildContext (context.ts:38) resolves once plus a second time after clearStaleClientRuntimeRef (context.ts:79). Each call re-reads getSettings() and recomputes RAM/folder/console/fullscreen + the diff.
- **Why it matters:** Cheap per call but called repeatedly per operation and per status poll; resolveClientFolder allocates the entire resolved object plus diff only to read one string. Repeated allocation under rapid client switching adds up.
- **Proposed solution:** Add a narrow helper resolveClientFolderFor(settings, slug) that computes only the folder (joinClientFolder / override) without the full object + diff, and have resolveClientFolder/getInstallState use it. buildContext already guards the re-resolve on identity (context.ts:77) — keep that.
- **Touches packages:** No
- **Tests needed:** unit: resolveClientFolderFor returns the same string as resolveClientSettings(...).storage.clientFolder across override/default cases.

<a id="ll-119"></a>
#### LL-119 · currentRequests Set can leak entries on the abort-before-listeners path

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/download.ts:54-83 (requestOnce add/delete lifecycle); 87-103 (followRedirects loops requestOnce per hop)
- **Problem:** requestOnce adds req to currentRequests at line 54 and removes it only in the error (66) and close (79) handlers. On the pre-aborted early return (58-61, same root cause as the P0) the req is never deleted from the Set. followRedirects calls requestOnce per hop; the per-hop request is normally deleted on its close, but the Set is the authority cancelSync uses to destroy in-flight sockets, so a stale never-deleted handle pollutes that tracking.
- **Why it matters:** Defensive hygiene for synchronous cancel: currentRequests must reflect truly in-flight requests. Combined with the P0 early-return, an entry can be retained forever.
- **Proposed solution:** Ensure delete-from-Set happens on every exit path — register error/close before any early return AND delete in the abort branch. Fixing the P0 abort path covers the worst case.
- **Touches packages:** No
- **Tests needed:** unit: after a redirect chain completes and after a pre-aborted call, currentRequests is empty.
- **Verification note:** The pre-aborted-leak half is real and is the same root cause as the P0 (download.ts:59-61 returns before any delete path). The 'redirect chains accumulate one entry per hop' half is weaker: in the happy redirect path each hop's req is res.resume()'d and deleted on its own close handler, so the Set does not durably grow per hop. Trimmed the redirect-accumulation framing; kept the genuine pre-abort leak. Largely subsumed by fixing the P0, hence P3.

### Testability & test coverage gaps

<a id="ll-120"></a>
#### LL-120 · updater fsm untested

- **Category:** testing · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** renderer/features/updater/events.ts:38-118
- **Problem:** toastFor/triggerAutoCheck dedup+wasUserInitiated none exported/tested
- **Why it matters:** silent toast spam on poll
- **Proposed solution:** extract pure module; unit-test matrix
- **Touches packages:** No
- **Tests needed:** unit
- **Guideline:** code-guideline.md tests

<a id="ll-121"></a>
#### LL-121 · verifySession untested

- **Category:** testing · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** main/services/auth/verify.ts:44-72
- **Problem:** 6 branches; auth.test.ts:45-48 mocks verify away
- **Why it matters:** spurious logout/unsaved rotated token
- **Proposed solution:** verify.test.ts fakes; per-branch toEqual
- **Touches packages:** No
- **Tests needed:** unit
- **Guideline:** code-guideline.md tests

<a id="ll-122"></a>
#### LL-122 · auth refresh untested

- **Category:** testing · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** main/services/auth/mojangAuth.ts:188-210;yggdrasilAuth.ts:80-114
- **Problem:** no needsRefresh/AUTH_REFRESH_FAILED; yggdrasil only signOut
- **Why it matters:** most security/UX-sensitive auth path
- **Proposed solution:** 60s session; yggdrasil 6 branches
- **Touches packages:** No
- **Tests needed:** unit
- **Guideline:** code-guideline.md tests

<a id="ll-123"></a>
#### LL-123 · MIGRATIONS gap-throw untested

- **Category:** testing · **Priority:** P1 · **Effort:** medium · **Change risk:** medium · **Flow:** Cross-cutting (no single flow)
- **Area:** main/infra/store.ts:105-131
- **Problem:** v=1 MIGRATIONS={}; stored-0 throws at load; tests write CURRENT
- **Why it matters:** crash on first launch after upgrade is P0-class
- **Proposed solution:** test schemaVersion 0/absent + fake step
- **Touches packages:** No
- **Tests needed:** unit
- **Guideline:** architecture.md persistence

<a id="ll-124"></a>
#### LL-124 · IPC arg-validation contract test

- **Category:** testing · **Priority:** P2 · **Effort:** large · **Change risk:** medium · **Flow:** IPC flow
- **Area:** shared/ipc/contract.ts:39-90
- **Problem:** type-only; nothing stops a new channel shipping unvalidated
- **Why it matters:** regression-prevention at untrusted boundary
- **Proposed solution:** registry + test iterating IPC_CHANNELS
- **Touches packages:** No
- **Tests needed:** integration
- **Guideline:** architecture.md IPC single source of truth
- **Verification note:** claim FALSE: uploadSkin skin/routes.ts:8-11 validates; app/media no-arg; all payload channels validate; P0 to P2

### Duplication vs minecraft-kit / yggdrasil — extract or reuse

<a id="ll-125"></a>
#### LL-125 · Re-implemented SHA-1/SHA-256 file hashing instead of a shared kit/core utility

- **Category:** dependency-extraction · **Priority:** P2 · **Effort:** medium · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:64-76 (sha1OfFile), src/main/services/bundle/plan.ts:36-43 (hashFile sha256), src/main/services/bundle/download.ts:127-159 (inline createHash('sha256'))
- **Problem:** Three separate hand-rolled streaming-hash helpers exist: forgeProcessorHealing.ts hashes files with sha1 (returns null on error), bundle/plan.ts hashFile hashes with sha256 (rejects on error), and bundle/download.ts inlines createHash('sha256') in the download write stream. Each wires data/end/error events and handles errors differently. The kit already computes exactly these hashes internally for its integrity:verified / integrity:mismatch events (kit d.ts ~2693-2701 shows algorithm: 'sha1' | 'sha256') but exports NO reusable hashFile helper (confirmed: grep of the kit index.d.ts for hashFile/hashesMatch/computeHash returns nothing).
- **Why it matters:** Three copies of a security-sensitive integrity primitive drift independently (different error handling, no shared test surface) and the kit's own verified hashing logic is the canonical implementation. A single exported helper would give one tested code path for file integrity across launcher and kit.
- **Proposed solution:** Add and export a hashFile(path, algorithm: 'sha1' | 'sha256'): Promise<string> (and/or hashesMatch) from minecraft-kit, used internally by its verifier. Replace forgeProcessorHealing.ts sha1OfFile, bundle/plan.ts hashFile, and the inline hash in bundle/download.ts with the exported helper. Keep the per-call error semantics (return null vs throw) at the launcher call site.
- **Touches packages:** Yes — minecraft-kit. minecraft-kit: export hashFile/hashesMatch from index (thin wrapper over the existing internal integrity hashing). Run npm run build in e:/workspace/elixir/minecraft-kit, copy dist into launcher node_modules (or npm install), bump the pinned 0.8.13 deliberately.
- **Tests needed:** unit: hashFile returns known sha1/sha256 for a fixture buffer; mismatch path. Existing forge/bundle tests must still pass.

<a id="ll-126"></a>
#### LL-126 · Forge-processor output healing is generic kit logic re-implemented in the launcher

- **Category:** dependency-extraction · **Priority:** P1 · **Effort:** large · **Change risk:** high · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:1-187 (whole file), src/main/services/minecraft/repairWorkflow.ts:136-154 (healForgeProcessors)
- **Problem:** forgeProcessorHealing.ts re-derives an install plan (kit.install.plan), filters RunForgeProcessorAction outputs (InstallActionKinds.RUN_FORGE_PROCESSOR), sha1-checks each declared output in action.outputs, and re-runs a focused plan keeping only broken processors (by action.index) plus their classpath deps. This is pure kit-domain knowledge (Forge install_profile processor graph, which generated outputs verify.forge does NOT track). The launcher's own comment at forgeProcessorHealing.ts:110-113 states 'kit.verify.forge only inspects libraries declared in the Forge version JSON, so processor outputs slip through'. The kit exposes repair.forge, repair.all, repair.fromError with a FORGE_PROCESSOR_FAILED supported code (kit d.ts:4384) but no 'verify processor outputs and re-run the missing ones', so the launcher reverse-engineers it against kit-internal action shapes.
- **Why it matters:** This is the single largest body of kit-domain logic living in the launcher. It couples the launcher to internal kit action shapes (InstallActionKinds.RUN_FORGE_PROCESSOR, action.outputs, action.index). Any kit change to the Forge processor model silently breaks the launcher. It belongs upstream next to kit.verify.forge / kit.repair.forge so verify.forge can become complete and the launcher just calls repair.all.
- **Proposed solution:** Push processor-output verification into the kit: extend kit.verify.forge (or kit.repair.forge.plan) to include RunForgeProcessor outputs in its issue set, so kit.repair.all already heals them. Then delete forgeProcessorHealing.ts and the healForgeProcessors step in repairWorkflow.ts/repair.ts, leaving runRepair to call only verifyAndRepairBase + ensureLaunchable. Keep the forgeProcessorActionsCache only if the kit cannot match its perf.
- **Touches packages:** Yes — minecraft-kit. minecraft-kit: verify.forge must additionally verify declared processor outputs (sha1 from action.outputs) and repair.forge/repair.all must re-run broken processors. Rebuild dist (npm run build in minecraft-kit), reinstall into launcher node_modules, bump kit pin. Behavioural kit change — gate behind kit tests before adopting.
- **Tests needed:** kit: integration test that a Forge target with a deleted processor output is flagged by verify.forge and fixed by repair.all. launcher: existing repair workflow tests assert healForgeProcessors removal causes no regression.
- **Verification note:** Real and the largest extraction opportunity in the area. Verified the whole file reverse-engineers RUN_FORGE_PROCESSOR actions, outputs, and index; the launcher's own comment (lines 110-113) confirms verify.forge does not cover generated outputs. Corrected the repairWorkflow.ts citation: the original said ':122-154 (ensureLaunchable + healForgeProcessors)' but ensureLaunchable (122-134) is a SEPARATE concern (this finding is about healForgeProcessors, 136-154); ensureLaunchable belongs to finding #3. The kit DOES already emit a 'forge:processor-output-verified' event during install (kit d.ts:2718), evidence it can verify outputs internally — strengthens the 'lift into verify.forge' solution. Kept P1/high-risk/large; this is a behavioural kit change touching the most fragile repair path.

<a id="ll-127"></a>
#### LL-127 · ensureLaunchable full-replan ignores kit.repair.fromError / planRepairFromError

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/repairWorkflow.ts:122-134 (ensureLaunchable), :111-114 (launchVersionResolvable swallows the error), src/main/services/minecraft/repair.ts:45-48
- **Problem:** ensureLaunchable falls back to a full kit.install.plan + run when resolveLaunchVersion still fails after repair.all + healForgeProcessors. The kit exposes kit.repair.fromError(input)/planRepairFromError which derive a focused plan from a typed MinecraftKitError (supported codes incl FORGE_PROCESSOR_FAILED, INTEGRITY_*, NETWORK_*; kit d.ts:4378-4416) with 'no full verify sweep'. ensureLaunchable does the heavyweight full re-plan instead.
- **Why it matters:** A full install plan re-hashes the entire target on the last-resort path. The kit's fromError path is purpose-built to rebuild exactly the missing artefacts from the error context — but only for the six RepairFromErrorSupportedCodes.
- **Proposed solution:** This requires first capturing the original error. launchVersionResolvable (lines 111-114) currently does resolveLaunchVersion().then(true).catch(false) — it discards the error entirely. To use repair.fromError, thread the captured error into ensureLaunchable and only call fromError when its code is in RepairFromErrorSupportedCodes, falling back to install.plan otherwise. Given resolveLaunchVersion failures are missing-version-JSON resolution errors (not INTEGRITY_/FORGE_PROCESSOR_/NETWORK_ codes), they are unlikely to be supported codes, so the realistic win is small — verify the actual error code resolveLaunchVersion throws before investing.
- **Touches packages:** No
- **Tests needed:** unit: ensureLaunchable prefers repair.fromError for a FORGE_PROCESSOR_FAILED-style error and only full-replans for unsupported codes (mock kit.repair.fromError / kit.install.plan).
- **Verification note:** Downgraded P2→P3 and tempered the claim. Verified: ensureLaunchable (122-134) full-replans, and launchVersionResolvable (111-114) catches and DISCARDS the resolveLaunchVersion error, so today there is no MinecraftKitError to hand to fromError — the solution's 'requires threading the error' caveat is correct but understated. Crucially, ensureLaunchable's documented purpose (lines 116-121) is rebuilding a MISSING loader version JSON; resolveLaunchVersion throwing for a missing JSON is not one of the six RepairFromErrorSupportedCodes (INTEGRITY_HASH/SIZE_MISMATCH, FILESYSTEM_WRITE_ERROR, NETWORK_HTTP_ERROR, NETWORK_TIMEOUT, FORGE_PROCESSOR_FAILED), so fromError would throw INVALID_INPUT and the launcher would full-replan anyway. The optimization rarely fires on this path — real but marginal, hence P3.

<a id="ll-128"></a>
#### LL-128 · skin.ts passes launcher SkinKinds literal into core validatePngBuffer without using core's SkinAssetKinds

- **Category:** dependency-extraction · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/skin/skin.ts:171 (validatePngBuffer(payload.buffer, payload.type)), src/shared/contracts/skin.ts:3-9 (SkinKinds duplicates core SkinAssetKinds)
- **Problem:** shared/contracts/skin.ts declares SkinKinds = { SKIN: 'skin', CAPE: 'cape' }, a byte-for-byte duplicate of yggdrasil-core's SkinAssetKinds = { SKIN: 'skin', CAPE: 'cape' } (core d.ts:781-784). skin.ts:171 calls validatePngBuffer(payload.buffer, payload.type) where payload.type is the launcher's SkinKind, while validatePngBuffer's declared signature is (buffer, kind: SkinAssetKind) (core d.ts:794). It type-checks today only because the two string-literal unions happen to be structurally identical.
- **Why it matters:** An undeclared literal coupling: if core ever renames or re-values SkinAssetKinds, the launcher compiles fine but validatePngBuffer rejects every upload at runtime. Reusing core's SkinAssetKinds makes the dependency explicit and compiler-enforced, and removes a duplicated constant.
- **Proposed solution:** Re-export core's SkinAssetKinds/SkinAssetKind as the launcher's skin kind in shared/contracts/skin.ts (or import SkinAssetKinds directly where the IPC zod schema is built), and type payload.type as SkinAssetKind so validatePngBuffer's input is the same nominal type. No package change needed. Note SkinKinds is also consumed by skin.ts:73/93/137 (readTextureUrl / upload branch) so the re-export must preserve the same value object.
- **Touches packages:** No
- **Tests needed:** zod: UploadSkinPayloadSchema still parses 'skin'/'cape'; type-level assertion that payload.type satisfies SkinAssetKind.
- **Guideline:** docs/code-guideline.md — no magic literals / single source of truth for named consts
- **Verification note:** Confirmed the exact duplication (core d.ts:781-784 SkinAssetKinds = {SKIN:'skin',CAPE:'cape'}) and validatePngBuffer's declared input type SkinAssetKind (core d.ts:794). Upgraded P3→P2: this is a genuine source-of-truth duplication of a constant that the launcher already depends on core for (validatePngBuffer), and it maps to the code-guideline 'no magic literals / named-const single source' rule — added that guidelineViolation. effortClass quick/low risk is correct. Added note that SkinKinds is used in several skin.ts branches so a re-export (not deletion) is the safe move.

<a id="ll-129"></a>
#### LL-129 · Yggdrasil skin upload re-implements AUTO variant detection that belongs in ygg-client.uploadSkin

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/skin/skin.ts:93-99 (manual detectSkinVariant then client.uploadSkin), compare Mojang path skin.ts:143-151 (variant: 'AUTO')
- **Problem:** For the Yggdrasil path the launcher manually calls detectSkinVariant(new Uint8Array(payload.buffer)) (kit import) and passes the resolved concrete SkinVariant to YggdrasilClient.uploadSkin, whose signature accepts only variant?: SkinVariant (client d.ts:39-43). For the Mojang path it instead delegates detection to the kit via variant: 'AUTO' (kit's SkinVariantInput accepts 'AUTO', kit d.ts:479-497, 521). So the launcher carries detection wiring for one provider but not the other, splitting one concern (CLASSIC vs SLIM from PNG bytes) across launcher and package, and forces a kit import into the ygg path purely for detection.
- **Why it matters:** Variant auto-detection from PNG pixels is generic upload orchestration. ygg-client.uploadSkin should accept an 'AUTO' input (mirroring kit's SkinVariantInputs.AUTO) and run detection internally, so the launcher does not need to import detectSkinVariant from the kit just to feed the ygg client. Consolidates skin-upload orchestration in the client where uploadSkin/uploadCape already live.
- **Proposed solution:** Extend YggdrasilClient.uploadSkin to accept variant?: 'AUTO' | SkinVariant and perform PNG-based detection internally (move detection into yggdrasil-core so both kit and client can share it, or have the client depend on kit's detectSkinVariant). Then skin.ts uploadSkinYggdrasil calls client.uploadSkin({ accessToken, file, variant: 'AUTO' }) and drops the detectSkinVariant import.
- **Touches packages:** Yes — yggdrasil. yggdrasil-client: uploadSkin gains an AUTO variant that auto-detects (needs a detect helper in yggdrasil-core or a dep on kit's detectSkinVariant). Rebuild dist (npm run build in loontail-yggdrasil), reinstall into launcher node_modules, bump the ^0.0.6 pins. Optionally move detectSkinVariant logic down into yggdrasil-core so both kit and client share it.
- **Tests needed:** ygg-client unit: uploadSkin with variant 'AUTO' sends the detected model; launcher skin.test covers the simplified call.

<a id="ll-130"></a>
#### LL-130 · shared/contracts/auth.ts re-declares Yggdrasil session/profile shapes that ygg-core already exports

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/contracts/auth.ts:63-83 (YggdrasilProfileSchema/YggdrasilSessionSchema), src/main/services/auth/yggdrasilAuth.ts:53-65, 93-106 (builds session from issued.selectedProfile.id/.name with no runtime validation)
- **Problem:** The launcher's YggdrasilSessionSchema/YggdrasilProfileSchema redefine accessToken/clientToken/selectedProfile fields that ygg-core ships as YggdrasilSessionSchema and GameProfileSchema (core d.ts:375, 439; GameProfile/YggdrasilSession types at 913-927 where YggdrasilSession.selectedProfile: GameProfile). The launcher's version is intentionally reshaped for persisted storage (flat profile.uuid undashed, provider literal, drops availableProfiles/user). yggdrasilAuth.ts:53-65 builds the stored session by reading client.authenticate()'s issued.selectedProfile.id/.name purely structurally — the wire response is validated nowhere on the launcher side.
- **Why it matters:** The launcher trusts client.authenticate()'s YggdrasilSession output structurally without runtime validation, then reshapes it. ygg-core's GameProfileSchema/YggdrasilSessionSchema are the single source of truth for that wire shape. Reusing them (in ygg-client or at the launcher boundary) would validate the server response once and keep the launcher's storage schema a thin projection rather than an independent re-spelling.
- **Proposed solution:** Keep the launcher's persisted YggdrasilSessionSchema (storage shape) but build it from ygg-core's validated types: have ygg-client validate authenticate()/refresh() responses against YggdrasilSessionSchema (ideally inside the client), and have yggdrasilAuth.ts construct the stored session from the resulting GameProfile. Document the projection. Do not re-declare wire profile fields the launcher never persists.
- **Touches packages:** No
- **Tests needed:** zod: round-trip a ygg-core GameProfile through the launcher's session projection; assert undashUuid + name mapping.

<a id="ll-131"></a>
#### LL-131 · MojangProfileSkinSchema duplicates kit's MojangProfileSkin shape by hand

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/contracts/auth.ts:21-29 (MojangProfileSkinSchema), :52-56 (MojangProfileSchema) vs kit MojangProfileSkin (kit d.ts:189-194) and MinecraftProfile (kit d.ts:210-214)
- **Problem:** MojangProfileSkinSchema is a hand-written Zod mirror of kit's MojangProfileSkin (id/state/url/variant; note the kit type does NOT have textureKey — the launcher schema adds an optional textureKey field the kit type lacks), annotated with z.ZodType<MojangProfileSkin>, and MojangProfileSchema re-spells kit's MinecraftProfile (uuid/username/skins; kit d.ts:210-214). The comment at auth.ts:21-22 explicitly acknowledges 'Mirror of kit's MojangProfileSkin shape'. If the kit adds/renames a skin field, this schema silently diverges (z.ZodType only checks assignability of the inferred type, not field completeness).
- **Why it matters:** The kit owns the canonical Mojang profile shape; the launcher only re-spells it because the kit ships no Zod schema for it (kit avoids bundling zod into the renderer). The duplication is a maintenance liability flagged even in its own comment. The cleanest fix is for the kit to export Zod schemas for its persisted profile/session types.
- **Proposed solution:** Option A (preferred): minecraft-kit exports MojangProfileSkinSchema/MinecraftProfileSchema (zod) from a /schemas subpath so shared/ can import them without dragging yauzl/stream into the renderer. Option B (no package change): add a compile-time exhaustiveness assertion (satisfies) so a kit field change fails the launcher build instead of silently diverging.
- **Touches packages:** Yes — minecraft-kit. minecraft-kit (Option A): add a zod-only schemas entrypoint exporting MojangProfileSkinSchema/MinecraftProfileSchema with no runtime side effects. Rebuild dist, reinstall, bump pin. If renderer-bundle bloat is a concern, ship schemas in a separate export the main process imports only.
- **Tests needed:** zod: schema accepts a real kit MinecraftProfile fixture and rejects a missing-field variant.
- **Verification note:** Confirmed the duplication and the self-acknowledging comment (auth.ts:21-22). Corrected the area line for the schema to 21-29 (the comment is 21-22, the schema 23-29). Important correction the auditor missed: the launcher schema adds an optional textureKey field that kit's MojangProfileSkin type (kit d.ts:189-194) does NOT declare — the z.ZodType<MojangProfileSkin> annotation allows the extra optional field. The kit profile type is MinecraftProfile (210-214), correctly named in the finding's solution. Real but genuinely low-value (z.ZodType already gives partial compile-time protection of the inferred shape), so P3 stands.

<a id="ll-132"></a>
#### LL-132 · Bundle-path normalization for set membership duplicated across bundleHealing and bundle/plan

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/bundleHealing.ts:27-28 (toBundleKey: path.relative + replace backslash) vs src/main/services/bundle/plan.ts:65-67 / normalizePathForSet in bundle/paths.ts:47
- **Problem:** bundleHealing.ts toBundleKey(clientFolder, absPath) = path.relative(...).replace(/\\/g, '/') maps disk paths into the bundle manifest's forward-slash key space, while bundle/plan.ts uses normalizePathForSet (paths.ts:47, p.replace(/\\/g, '/')) for the same forward-slash normalization. The two normalizers must agree exactly for the bundle-owned-path filter (createBundleRepairIssueFilter) to match the manifest keys, yet they are defined independently in different modules.
- **Why it matters:** If the two normalizations ever diverge (case-folding, leading-slash handling), the bundle repair filter fails to recognise bundle-owned files and re-downloads files the bundle deliberately overrides, or vice-versa — a correctness bug in the repair/heal path. A single shared normalizer removes that risk.
- **Proposed solution:** Reuse bundle/paths.ts normalizePathForSet inside bundleHealing.ts toBundleKey (path.relative then normalizePathForSet), so both the plan diff and the repair filter share one normalization. Launcher-internal dedupe (no package), but it directly protects the bundle-overlay repair invariant.
- **Touches packages:** No
- **Tests needed:** unit: toBundleKey and the bundle/plan key for the same relative path produce identical strings across mixed-separator inputs.

<a id="ll-133"></a>
#### LL-133 · Mojang upload error-body extraction is generic and could move to the kit error model

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/main/services/skin/skin.ts:33-65 (extractMojangMessage / throwMojangUploadError)
- **Problem:** extractMojangMessage reads isMinecraftKitError(error).context.responseBody (accessible via MinecraftKitErrorContext's [key: string]: unknown index signature; kit d.ts:848-860), JSON-parses it, and pulls errorMessage / details.status to turn a raw Mojang profile-mutation error into a human string. This is knowledge of the Mojang Services error envelope ({ errorMessage, details: { status } }) — a domain the kit owns (it produced responseBody).
- **Why it matters:** The launcher is parsing an upstream API's error JSON that the kit already received and wrapped. If Mojang changes the envelope, the kit is the right place to adapt once for all consumers. Keeping it in the launcher means every kit consumer re-parses the same body differently.
- **Proposed solution:** Add a kit helper (e.g. mojangErrorMessage(error: MinecraftKitError): string | null) or include a parsed humanMessage on the kit error context for profile-mutation failures. Launcher then calls it instead of hand-parsing responseBody. Low priority because it is small and isolated.
- **Touches packages:** Yes — minecraft-kit. minecraft-kit: expose a mojangErrorMessage(error) helper (or parsed field on the error context for AUTH/profile errors). Rebuild dist, reinstall, bump pin.
- **Tests needed:** kit unit: mojangErrorMessage extracts errorMessage then details.status then null for non-JSON bodies (port the existing launcher cases).

<a id="ll-134"></a>
#### LL-134 · bundleHealing verifyAndRepairExceptBundle hand-rolls the kit verify->plan->run sequence

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/bundleHealing.ts:65-102 (verifyAndRepairExceptBundle) vs src/main/services/minecraft/repairWorkflow.ts:78-99 (verifyAndRepairBase uses kit.repair.all)
- **Problem:** Two parallel repair orchestrations exist over the same kit primitives. verifyAndRepairBase delegates to kit.repair.all with shouldRepairIssue (RepairAllOptions.shouldRepairIssue; kit d.ts:3438-3439). verifyAndRepairExceptBundle instead manually sequences kit.verify.minecraft.run, counts issues, builds kit.repair.minecraft.plan({ from, shouldRepairIssue }) (RepairAspect.plan with RepairPlanOptions; kit d.ts:3421-3424, 3456), then kit.repair.minecraft.run — re-implementing the verify->plan->run dance that kit.repair.all already encapsulates.
- **Why it matters:** Two different orchestrations of the same kit verify/repair primitives can diverge (issue counting, which aspects run, progress semantics). Consolidating the bundle heal lets the kit own the sequencing and keeps both paths consistent.
- **Proposed solution:** Where the bundle heal only needs the minecraft slice, call kit.repair.all(target, { shouldRepairIssue }) and read report.repairs.get(VerificationKinds.MINECRAFT) for the repaired count (mirroring verifyAndRepairBase). The one wrinkle: verifyAndRepairExceptBundle also returns ignoredByBundle (count of bundle-owned issues), which repair.all does not surface — so a thin verify-then-count step (or a kit report that exposes filtered-out issue counts) is still needed. Otherwise the bespoke plan/run can collapse into repair.all.
- **Touches packages:** No
- **Tests needed:** unit: verifyAndRepairExceptBundle returns the same ignoredByBundle/repaired counts via the consolidated path for a fixture with bundle-owned and vanilla issues.
- **Verification note:** Confirmed both orchestrations exist and use the same shouldRepairIssue filter (createBundleRepairIssueFilter): verifyAndRepairBase via kit.repair.all (repairWorkflow.ts:87-91), verifyAndRepairExceptBundle via manual verify.minecraft.run -> repair.minecraft.plan({from,shouldRepairIssue}) -> repair.minecraft.run (bundleHealing.ts:72-95). Verified the kit API shapes (RepairAllOptions.shouldRepairIssue at 3438, RepairAspect.plan/RepairPlanOptions at 3421/3456). Adjusted the solution: verifyAndRepairExceptBundle deliberately returns ignoredByBundle (bundle-owned issue count) which repair.all does NOT expose, so a full collapse onto repair.all loses that metric — the manual verify is partly there to count ignored issues, not pure duplication. The duplication is real but the two paths intentionally differ in what they report, so the consolidation is less clean than billed; P3/medium stands.

### Shared layer: contracts, constants, domain quality

<a id="ll-135"></a>
#### LL-135 · BundleSlug brand never defined — bundle slugs flow as raw string

- **Category:** code · **Priority:** P1 · **Effort:** medium · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/shared/contracts/ids.ts:5-7 (only ClientSlug/ClientId/UserId branded); src/shared/contracts/client.ts:37,72 (bundleSlug: z.union([z.string(),z.null()]).optional / string|null|undefined); src/shared/contracts/bundle.ts:107 (LocalManifest.bundleSlug: string); src/main/services/bundle/api.ts:39 fetchRemoteManifest(slug: string); src/main/services/bundle/manager.ts:196,218,243
- **Problem:** The code-guideline §1 gives `type BundleSlug = string & { readonly __brand: 'BundleSlug' }` as THE canonical example of a branded domain id, yet ids.ts only brands ClientSlug/ClientId/UserId. `bundleSlug` is a plain `string` in the Client type, in LocalManifest, in API_ROUTES.bundleRegistry.manifest(slug: string), and across the whole bundle service. Because both a client slug and a bundle slug are bare strings, nothing stops passing a ClientSlug where a bundle slug is expected (or vice-versa) — exactly the bug brands exist to prevent. This is sharpened by bundle events (BundleStatusEvent/BundleProgressEvent/BundleErrorEvent) being keyed by ClientSlugSchema, so two different slug concepts coexist untyped.
- **Why it matters:** A launcher keys settings, folders, IPC, and manifests by slug; conflating the client slug and the bundle-registry slug silently mis-targets a download or a settings key. The guideline explicitly mandates this brand.
- **Proposed solution:** Add `export type BundleSlug = Brand<string,'BundleSlug'>` plus `asBundleSlug` and `BundleSlugSchema` to ids.ts. Type Client.bundleSlug, LocalManifest.bundleSlug, API_ROUTES.bundleRegistry.manifest, and the bundle service signatures as BundleSlug. Brand at the boundary in coerceBundleSlug (clientsApi.ts:55).
- **Touches packages:** No
- **Tests needed:** unit: ids round-trip + a tsc compile-fence test that a ClientSlug is not assignable to a BundleSlug parameter.
- **Guideline:** code-guideline.md §1 TypeScript (branded types for domain identifiers — BundleSlug is the cited example)

<a id="ll-136"></a>
#### LL-136 · Status/code enums list every member twice (as const + parallel z.enum) — silent drift

- **Category:** code · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/shared/contracts/bundle.ts:7-39 (BundleSyncStatuses then BundleSyncStatusSchema re-lists all 13), bundle.ts:51-81 (BundleErrorCodes then BundleErrorCodeSchema re-lists all 12); src/shared/contracts/minecraft.ts:9-35 (InstallStatuses + InstallStatusSchema, 10 each), minecraft.ts:37-51 (ProgressStages + ProgressStageSchema), minecraft.ts:53-85 (MinecraftErrorCodes + MinecraftErrorCodeSchema, 13 each)
- **Problem:** Each status/code set is declared once as an `as const` object and then its values are typed out a SECOND time by hand inside a `z.enum([...])`. There is no compile-time link between the two lists: adding BundleSyncStatuses.FOO does not force adding it to BundleSyncStatusSchema, so the schema will silently reject a value the union accepts (or vice-versa). This is a runtime-validation hole, not just verbosity — an event carrying a newly-added status would fail Zod parse at the IPC boundary.
- **Why it matters:** Single-source-of-truth is the whole point of §6.2. Hand-mirrored enum lists are a classic drift bug: the type compiles, the validator silently diverges, and a valid event gets dropped or an invalid one slips through depending on direction.
- **Proposed solution:** Derive the schema from the const object: `z.enum(Object.values(BundleSyncStatuses) as [BundleSyncStatus, ...BundleSyncStatus[]])`, or add a tiny shared helper `enumFromConst(obj)`. Apply to all five pairs. This makes the const the single source and deletes ~60 lines of mirrored literals.
- **Touches packages:** No
- **Tests needed:** unit: for each pair, assert the schema's options set equals Object.values(const). One parameterized test covers all five.
- **Guideline:** code-guideline.md §6.2 (as-const objects as single source) and §5 (schemas are the single source of truth for external shapes)

<a id="ll-137"></a>
#### LL-137 · StrapiList<T> hand-written type duplicates StrapiListSchema

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** IPC flow
- **Area:** src/shared/contracts/strapi.ts:43-66 (StrapiListSchema factory at 43-54, then StrapiList<T> type literally re-typed at 56-66)
- **Problem:** StrapiListSchema(itemSchema) already defines the {data, meta:{pagination:{page,pageSize,pageCount,total}}} shape, but immediately below it the same structure is written a second time as a standalone generic `type StrapiList<T>`. The two can drift — e.g. adding `meta.pagination.start` to the schema would not update the type, and consumers (contract.ts:65 `StrapiList<Client>`, clients.ts, renderer api.ts) would type-check against the stale shape while runtime data carries the new field.
- **Why it matters:** §5 mandates contracts/ be the single source of truth with types inferred from schemas. A generic z.infer over a factory is awkward, which is presumably why it was hand-typed — but the duplication is exactly the drift §5 warns against.
- **Proposed solution:** Express the type via the schema factory's return: `type StrapiList<T> = z.infer<ReturnType<typeof StrapiListSchema<z.ZodType<T>>>>`, or split the pagination/meta into its own schema+inferred type and reference it from both. Either way one structure, not two.
- **Touches packages:** No
- **Tests needed:** none (compile-time); existing schemas.test.ts covers parse.
- **Guideline:** code-guideline.md §5 (types inferred from schema, single source of truth)

<a id="ll-138"></a>
#### LL-138 · Client renderer type is a hand-maintained near-copy of inferred ClientResponse

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Profile / version flow
- **Area:** src/shared/contracts/client.ts:20-48 (ClientResponseSchema → ClientResponse) vs 54-81 (Client typed out field-by-field); normalizeClient in src/main/services/clients/clientsApi.ts:61-86 spreads ClientResponse into Client
- **Problem:** Client repeats ~20 fields that already exist on the inferred ClientResponse (id, documentId, createdAt, updatedAt, publishedAt, title, available, servers, screenshots, background, poster, titleImage, keywords) and only genuinely changes a handful (slug→ClientSlug, versions→string, description→string, id→ClientId). Adding a field to the Strapi schema requires editing two places; forgetting the second leaves normalizeClient's `...client` spread carrying an untyped field. The fields that DO differ are the only ones worth stating.
- **Why it matters:** Maintainability + drift: a wire-schema field added in one place but not the derived view type is a latent bug, and the duplication obscures which fields are actually transformed vs passed through.
- **Proposed solution:** Define Client as `Omit<ClientResponse, 'id'|'slug'|'minecraftVersion'|'forgeVersion'|'fabricVersion'|'runtimeVersion'|'description'|'shortDescription'|'bundleSlug'> & { id: ClientId; slug: ClientSlug; minecraftVersion: string; ... }`. Only the transformed fields are spelled out; the rest track ClientResponse automatically.
- **Touches packages:** No
- **Tests needed:** none (compile-time).
- **Guideline:** code-guideline.md §5 (single source of truth) / §1 (no dead/duplicated declarations)

<a id="ll-139"></a>
#### LL-139 · ErrorCode union is hand-maintained alongside ERROR_CODES const

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Error / recovery flow
- **Area:** src/shared/constants/errorCodes.ts:1-22 (type ErrorCode union of 9 strings at 1-10, ERROR_CODES const re-listing the same 9 at 12-22 with `satisfies Record<string, ErrorCode>`)
- **Problem:** The literal union ErrorCode and the ERROR_CODES const list the same nine codes. `satisfies Record<string,ErrorCode>` only checks the const conforms to the union, not that the union is complete — adding a member to ERROR_CODES without adding it to the union still fails (the new value isn't assignable to ErrorCode, surfacing as a confusing error on the const), and adding to the union without the const leaves a code with no runtime constant. isIpcError (ipc/errors.ts:15) relies on Object.values(ERROR_CODES) for runtime membership, so the const is the real runtime source — the union should be derived from it.
- **Why it matters:** Two parallel lists of the cross-process error vocabulary drift; the IPC error model is exactly the kind of layer contract §6.4 says to centralize once.
- **Proposed solution:** Make the const primary and derive the type: `export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]` (drop the `satisfies`, delete the hand-written union).
- **Touches packages:** No
- **Tests needed:** none (compile-time); isIpcError already exercised in router.test.ts.
- **Guideline:** code-guideline.md §6.2 (as-const objects, derived union types over hand-written ones)

<a id="ll-140"></a>
#### LL-140 · Fragmented error model: bundle/minecraft/login codes disconnected from IpcError.code

- **Category:** error-handling · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Error / recovery flow
- **Area:** src/shared/constants/errorCodes.ts ErrorCode (UPPER_SNAKE: AUTH_NETWORK_ERROR…) used by IpcError; src/shared/contracts/bundle.ts:51-64 BundleErrorCodes (camelCase: downloadFailed…); src/shared/contracts/minecraft.ts:53-67 MinecraftErrorCodes (camelCase: networkError…); src/shared/contracts/auth.ts:111-117 LOGIN_ERROR_CODE (UPPER_SNAKE NETWORK_ERROR…); src/shared/ipc/errors.ts:3-7 IpcError{code: ErrorCode}
- **Problem:** There are FOUR independent, stylistically inconsistent error-code vocabularies (errorCodes.ErrorCode UPPER_SNAKE, BundleErrorCodes camelCase, MinecraftErrorCodes camelCase, LOGIN_ERROR_CODE UPPER_SNAKE). IpcError.code is the shared cross-process model, but the highest-traffic flows — bundle sync, minecraft install/launch, and login — define their OWN code sets that are NEVER unified with ErrorCode. They travel as separate event/result payloads (BundleErrorEvent/MinecraftErrorEvent/LoginResult) rather than as IpcError. The renderer must maintain parallel localization maps and the docs' promise of a single {code,message,details} error contract is only partly true. The casing split (UPPER_SNAKE vs camelCase) means 'network error' appears as AUTH_NETWORK_ERROR, networkError, and NETWORK_ERROR.
- **Why it matters:** A unified error model is the point of the IpcError contract; multiple vocabularies make error handling, logging, and i18n inconsistent and force per-flow special-casing in the renderer.
- **Proposed solution:** Decide one casing convention and document the layering: keep flow-specific event codes if they carry richer UI semantics, but make them a documented subset/extension of the IpcError model and align casing (UPPER_SNAKE per ERROR_CODES). At minimum, add a doc note in code-guideline §9 explaining the two tiers (IPC-handler IpcError vs domain event codes) so the split is intentional rather than accidental.
- **Touches packages:** No
- **Tests needed:** unit: assert renderer error-copy maps are exhaustive over each code set (no missing key).
- **Guideline:** code-guideline.md §6.2 (pick one style per category and stay consistent) / architecture.md error model (single IpcError contract)
- **Verification note:** Confirmed and strengthened: it is FOUR vocabularies, not three — auth.ts:111-117 LOGIN_ERROR_CODE (UPPER_SNAKE: NETWORK_ERROR/INVALID_CREDENTIALS/RATE_LIMITED…) is a fourth parallel set used by LoginResult, and 'network error' actually appears in three casings (AUTH_NETWORK_ERROR, networkError, NETWORK_ERROR). Added auth.ts to the area and updated title/problem. §6.2 line 336 ('pick one style per category and stay consistent') is the on-point guideline. Solution (document the two-tier model + align casing) is the right pragmatic call — full unification is not warranted since the domain codes carry richer UI semantics. Adjusted to widen scope.

<a id="ll-141"></a>
#### LL-141 · RAM_DEFAULT_FALLBACK_MB is dead — declared and re-exported, never consumed

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/shared/constants/settings.ts:3 (RAM_DEFAULT_FALLBACK_MB = 4096); re-exported src/shared/constants/index.ts:5; grep shows zero consumers outside the declaration/re-export (system.ts only uses RAM_MIN_MB/RAM_STEP_MB; computeDefaultRamMb derives from the range)
- **Problem:** RAM_DEFAULT_FALLBACK_MB = 4096 is exported through the barrel but has no consumer anywhere in src/. The actual default-RAM logic (main/infra/system.ts computeDefaultRamMb) derives from the computed range, not this constant. It is dead code that looks load-bearing because it sits next to the live RAM_MIN_MB/RAM_STEP_MB.
- **Why it matters:** §1 'No dead code … delete it, git remembers.' A leftover named constant invites a future author to wire it in inconsistently with the real default logic.
- **Proposed solution:** Delete RAM_DEFAULT_FALLBACK_MB from settings.ts and the index.ts re-export. If a literal default IS wanted, route it through computeDefaultRamMb instead.
- **Touches packages:** No
- **Tests needed:** none.
- **Guideline:** code-guideline.md §1 (No dead code)

<a id="ll-142"></a>
#### LL-142 · Pure domain units resolveLoader and accountFromSession have no tests

- **Category:** testing · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** Launch flow
- **Area:** src/shared/domain/loader.ts:13-33 (isLoaderAvailable, resolveLoader — discriminated 'resolved'/'ambiguous' union); src/shared/contracts/account.ts:18-36 (accountFromSession — provider branching). No test file references resolveLoader or accountFromSession (grep across tests/ returns nothing); only settings.test.ts and schemas.test.ts cover shared.
- **Problem:** resolveLoader is non-trivial precedence logic (honour valid override → forge+fabric ambiguous → forge → fabric → vanilla) that directly gates which loader is launched; a regression silently launches the wrong loader or wrongly reports ambiguity. accountFromSession maps each session provider to the renderer Account and decides the active Mojang skin. Both are exactly the 'pure logic' §11.1 names as the default test target, yet neither is covered. The settings family IS thoroughly tested — these two pure units are the gap.
- **Why it matters:** §11.1 explicitly lists shared/domain pure logic as the primary unit-test target; launch correctness depends on resolveLoader, and account UI on accountFromSession. Untested precedence logic is high-risk for a flow that picks what to run.
- **Proposed solution:** Add tests/shared/domain/loader.test.ts covering: valid override kept, override dropped when its version field is absent (forge override but no forgeVersion), forge+fabric→ambiguous, single-loader resolution, vanilla fallback. Add accountFromSession cases: yggdrasil (skin/cape/email null, username from profile.name), mojang with/without an ACTIVE skin.
- **Touches packages:** No
- **Tests needed:** unit: loader.test.ts (5+ resolveLoader cases incl. ambiguous + override-invalidation), account.test.ts (yggdrasil + mojang active/no-active-skin).
- **Guideline:** code-guideline.md §11.1 (shared/domain pure logic must be unit-tested)

<a id="ll-143"></a>
#### LL-143 · API_ROUTES.clients.list embeds populate field names as ad-hoc literals

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Profile / version flow
- **Area:** src/shared/constants/apiRoutes.ts:5-16 (six 'populate[<field>]=true' strings hand-built inline)
- **Problem:** The clients.list route builder hardcodes six Strapi relation names ('screenshots','background','poster','titleImage','keywords','servers') as raw query-string fragments. These field names are a contract with both the Strapi schema and the ClientResponseSchema (client.ts:39-45) — they must stay in lockstep. Today they live in two unrelated places: the populate list here and the schema fields in client.ts. Adding a relation to the Client schema but forgetting the populate (or vice-versa) yields silently missing media at runtime.
- **Why it matters:** Magic literals carrying contract meaning (§6.1) and a split source of truth between schema and query — a maintenance trap that surfaces only as missing images at runtime.
- **Proposed solution:** Derive the populate fields from a single named array of relation keys (e.g. CLIENT_POPULATE = ['screenshots',...] as const) co-located with — or asserted against — the media/relation fields of ClientResponseSchema, and map(.join('&')) it inside the builder.
- **Touches packages:** No
- **Tests needed:** unit: assert clients.list() contains a populate fragment for every relation key, and that the key set matches the schema's media/relation fields.
- **Guideline:** code-guideline.md §6.1 (no magic literals carrying contract meaning) / §6.3 (centralized routes)

<a id="ll-144"></a>
#### LL-144 · UploadSkinPayloadSchema accepts an unbounded ArrayBuffer at the IPC boundary

- **Category:** IPC · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/contracts/skin.ts:13-18 (buffer: z.custom<ArrayBuffer>(v => v instanceof ArrayBuffer)); validated payload reaches main/services/skin/skin.ts:171 where validatePngBuffer runs only AFTER the IPC handler accepted it
- **Problem:** The skin-upload IPC schema only checks the buffer is an ArrayBuffer — no maximum size. The renderer can hand main an arbitrarily large buffer that is fully marshalled across IPC and buffered in the main process before validatePngBuffer (yggdrasil-core) ever inspects it. §5 says validate at the boundary; a multi-hundred-MB ArrayBuffer is a trivially-triggerable memory-pressure vector and the PNG validator only catches it post-transfer. The package also exports SKIN_VALID_DIMENSIONS/CAPE_VALID_DIMENSIONS, so the legal byte ceiling is known.
- **Why it matters:** An unbounded buffer crossing IPC is a resource-exhaustion risk; the boundary schema should fail fast before the transfer/allocation, per §5.
- **Proposed solution:** Add a byteLength bound to the schema, e.g. z.custom<ArrayBuffer>(v => v instanceof ArrayBuffer && v.byteLength <= MAX_SKIN_BYTES) with MAX_SKIN_BYTES a named constant sized from the known max PNG dimensions. Keep validatePngBuffer for content correctness.
- **Touches packages:** No
- **Tests needed:** unit: UploadSkinPayloadSchema rejects an over-cap buffer, accepts an in-cap one (schemas.test.ts).
- **Guideline:** code-guideline.md §5 (validate at external/IPC boundary, fail fast) / §4 (IPC args zod-validated on entry)

<a id="ll-145"></a>
#### LL-145 · Account is a flat type while its source AuthSession is discriminated

- **Category:** code · **Priority:** P3 · **Effort:** medium · **Change risk:** low · **Flow:** Auth / session flow
- **Area:** src/shared/contracts/account.ts:10-16 (Account{provider: AuthProvider; email/skin/cape: T|null}) derived from discriminated AuthSession (auth.ts:97-102)
- **Problem:** AuthSession is a clean provider-discriminated union, but accountFromSession flattens it into an Account whose `provider` is a non-discriminating field and whose email/skin/cape are always-present nullables. This loses the invariant the union encodes: for a yggdrasil session skin/cape/email are ALWAYS null at construction (account.ts:21-25 hardcodes them), whereas for mojang skin may be present and cape is never set. Consumers can't tell 'null because this provider never supplies it' from 'null because enrichment hasn't run yet' — a real distinction the enrichment path (auth verify.ts) depends on.
- **Why it matters:** §1 prefers discriminated unions over flag/optional soups; here the loss of the provider discriminant pushes ambiguity downstream into the renderer.
- **Proposed solution:** Either keep Account as a discriminated union (`{provider:'yggdrasil'; ...} | {provider:'mojang'; ...}`) so impossible states (mojang cape) are unrepresentable, or document explicitly that null means 'not yet enriched' and that yggdrasil fields are filled only post-enrichment. The union is the cleaner fit since AuthSession already is one.
- **Touches packages:** No
- **Tests needed:** unit: accountFromSession per-provider (covered by the account test proposed above).
- **Guideline:** code-guideline.md §1 (discriminated unions over boolean/optional flag soups)

<a id="ll-146"></a>
#### LL-146 · setClientOverride: five near-identical default-equality compaction blocks

- **Category:** code · **Priority:** P3 · **Effort:** medium · **Change risk:** medium · **Flow:** Profile / version flow
- **Area:** src/shared/domain/settingsOverrides.ts:31-84 (setClientOverride): four hand-written if-blocks at 45-74 deleting a field when it equals the global default, then compactOverride at 15-29
- **Problem:** setClientOverride repeats the same 'if override field === global default, delete it' shape four times (memory.allocatedRamMb, storage.clientFolder, launch.console, launch.fullscreen), each a slightly different copy. The folder branch uses joinClientFolder, the others compare scalars, but the structure is duplicated and easy to get subtly wrong (e.g. the loader/runtime fields are NOT compacted against any default — possibly intentional, but the asymmetry is undocumented). The function is the most complex unit in the domain and is the riskiest to extend (adding a new overridable field means another bespoke block).
- **Why it matters:** Maintainability/testability: the repeated compaction logic is where a 'stale override that equals default never gets cleaned' bug would hide; a data-driven form makes the default-equality rule one place and one test.
- **Proposed solution:** Drive compaction from a small descriptor list mapping each overridable leaf to its default extractor, then loop. Keep the function's public behaviour identical (the existing settings.test.ts cases lock it). Document why loader/runtime are exempt from default-equality compaction.
- **Touches packages:** No
- **Tests needed:** existing settings.test.ts setClientOverride cases must stay green; add a case for a newly-added field if introduced.
- **Guideline:** code-guideline.md §3.7 (extract when independently testable / repeated)

<a id="ll-147"></a>
#### LL-147 · Two parallel validators for LauncherSettings: Zod schema vs hand-rolled normalizer

- **Category:** architecture · **Priority:** P2 · **Effort:** medium · **Change risk:** medium · **Flow:** Profile / version flow
- **Area:** src/shared/contracts/settings.ts (LauncherSettingsSchema/ClientSettingsOverrideSchema — full Zod) vs src/shared/domain/settingsNormalization.ts:10-99 (normalizeRuntimeRef, normalizeLoaderChoice, normalizeClientOverride, normalizeLauncherSettings — hand-rolled typeof guards over the SAME shapes); both run together in store.ts:316-317
- **Problem:** There are two full validators for LauncherSettings: the Zod schema in contracts/settings.ts and a parallel hand-written typeof-guard normalizer in domain/settingsNormalization.ts. The hand-rolled one re-derives the legal shape (LOADER_VALUES set, typeof checks per field, slug !== 'undefined'/'null' filtering) that the Zod schema already encodes. §5 says 'inside the validated boundary, trust the types' — but normalization re-implements validation. getStoredLauncherSettings (store.ts:316-317) even runs BOTH: LauncherSettingsSchema.safeParse then normalizeLauncherSettings on the already-parsed data. Drift risk is concrete: ClientSettingsOverrideSchema and normalizeClientOverride must agree field-for-field, and they're maintained independently.
- **Why it matters:** Two validators for one shape is the canonical single-source-of-truth violation; on a store-migration path (store.ts:127 and setStoredLauncherSettings:323, where normalize also runs) a divergence means persisted data is accepted by one and silently dropped by the other.
- **Proposed solution:** Implement normalizeLauncherSettings as a Zod-driven coerce: run the schema's safeParse and on partial failure fall back per-section to defaults, rather than re-deriving every typeof guard. Where Zod can't express 'drop unknown slug keys', keep that thin bit but base field validation on the schema. Collapses ~90 lines and removes the dual source.
- **Touches packages:** No
- **Tests needed:** the existing normalizeLauncherSettings cases in settings.test.ts must stay green; add a migration case proving schema and normalizer accept the same legal blob.
- **Guideline:** code-guideline.md §5 (single source of truth for shape; don't re-validate inside the boundary) / §6 (contracts are the source)

<a id="ll-148"></a>
#### LL-148 · joinClientFolder re-implements platform path joining in shared/

- **Category:** dependency-extraction · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Profile / version flow
- **Area:** src/shared/domain/settingsDefaults.ts:11-15 (joinClientFolder hand-checks trailing '/' or backslash and inserts a '/' separator)
- **Problem:** joinClientFolder hand-rolls a slash/backslash-aware path join in the platform-agnostic shared layer because shared cannot import node:path. It picks '/' as the separator regardless of OS, then derives clientFolder used downstream as a real filesystem path. This is generic path logic; at minimum it should be a single well-tested helper rather than inline separator detection that silently normalizes Windows paths to forward slashes. The kit-extraction angle is weaker: the kit does NOT currently export a path-join helper, so 'move it into the kit' is a speculative new export, not a swap for an existing one.
- **Why it matters:** Path assembly that feeds a real install folder is generic infrastructure; a half-correct join in shared (forward-slash on Windows) risks subtle path mismatches versus how main/kit later resolves the folder.
- **Proposed solution:** Primary, low-risk action: keep joinClientFolder in shared but harden it and add tests for backslash + drive-letter + mixed-separator inputs (settings.test.ts already covers two cases). Only if a path-join/normalize helper is genuinely wanted across main should it be added to the kit and called from the main side where the folder is consumed — that is the speculative, optional path.
- **Touches packages:** No. Optional/speculative only: the kit currently exports no path-join/normalize helper (verified against the kit d.ts API surface), so this would be a NEW export, not a reuse of an existing one. If pursued, rebuild kit dist and copy into launcher node_modules. Recommended action requires no package change.
- **Tests needed:** unit: joinClientFolder with backslash, drive-letter, and mixed-separator inputs (settings.test.ts).
- **Verification note:** Verified joinClientFolder (settingsDefaults.ts:11-15): it returns '' on empty, else appends '/'+slug unless clientsFolder already ends in / or backslash — so a Windows 'C:\\games' input becomes 'C:\\games/survival' (mixed separators), which is the latent issue. settings.test.ts:24-39 covers empty, missing-sep, trailing-/, trailing-backslash but NOT the mixed-separator case the function actually mishandles. The function is real and under-tested. Downgraded affectsKit true→false and reframed: the stated dependency-extraction premise ('the kit should own this') is speculative — the kit exports no such helper today, so this is not a 'replace duplication with an existing export'. The genuine, actionable core is harden+test in shared (P3/quick). Cleared affectsKit and packageWhat accordingly; effortClass quick. Adjusted.

### Meaningless-comment census + comment guideline reinforcement

<a id="ll-149"></a>
#### LL-149 · Section-divider banner comments in bundle/manager.ts (exact §10-forbidden pattern)

- **Category:** code · **Priority:** P2 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/manager.ts:89, :204, :465
- **Problem:** Line 89: `// Public API ---------------------------------------------------------------`; line 204: `// Internal -----------------------------------------------------------------`; line 465: `// Plan helpers — exported only for tests.` The first two are textbook section-divider banners that convey nothing the code does not (the `private` keyword and class layout already mark the boundary).
- **Why it matters:** code-guideline §10 says comments default to none and must convey a non-obvious 'why'. A '----' banner is pure visual decoration restating structure already visible from member modifiers. This is the single clearest §10 violation in the codebase and a bad precedent other files could copy.
- **Proposed solution:** Delete the line 89 and line 204 banner comments outright. Keep line 465 (`// Plan helpers — exported only for tests.`) — it conveys non-obvious intent (why these helpers are exported at all). Do not introduce any replacement divider.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (default none; do not describe what the code does; no decorative dividers)

<a id="ll-150"></a>
#### LL-150 · Struct field-label restate comments in bundle/runner.ts

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/bundle/runner.ts:35, :39, :44 (type SyncTask block, lines 25-47)
- **Problem:** Line 35: `// Throughput accounting for the renderer's KB/s readout.` above `bytesDownloaded`/`speedWindowStart`/`speedWindowBytes`; line 39: `// Per-file progress counters.` above `processedFiles`/`totalFiles`; line 44: `// Pending work queues — runner shifts from these as workers pull tasks.` above `pendingDownloads`/`pendingDeletes`. These label self-describing fields whose names already state the same thing.
- **Why it matters:** §10 forbids describing what the code does. `processedFiles`/`totalFiles` are self-evident progress counters; `pendingDownloads`/`pendingDeletes` are self-evidently pending queues. The labels add lines without adding a 'why'. NOTE: lines 30 (`currentRequests` synchronous-cancellation note) and 32 (`// Cooperative pause/cancel flags. Workers check between file boundaries.`) MUST STAY — they encode the non-obvious cooperative-abort invariant.
- **Proposed solution:** Remove the three pure-label comments at lines 35, 39, 44. Preserve lines 30 and 32. If the throughput grouping is genuinely non-obvious, fold any real 'why' into the cooperative-abort note rather than restating field purpose.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (do not describe what the code does)

<a id="ll-151"></a>
#### LL-151 · One-line restate comments in minecraft install/uninstall and infra/system

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Download / install flow
- **Area:** src/main/services/minecraft/install.ts:93; src/main/infra/system.ts:117; src/main/services/bundle/api.ts:96
- **Problem:** install.ts:93: `// Plan + tracker + run.` directly above `const tryInstall = async (...)` whose body is literally plan → tracker → run — pure restatement of the function body. system.ts:117: `// skip unreadable file` inside an empty `catch {}` that obviously skips. bundle/api.ts:96: `// Re-export so callers can instanceof without importing from infra.` borders on restate but encodes a real reason (avoid an infra import) so is a KEEP-or-trim judgement.
- **Why it matters:** §10: 'Do not describe what the code does — that is visible from the code.' `// Plan + tracker + run` and `// skip unreadable file` add zero information beyond the adjacent code. They are the kind of low-value restate the cleanup pass should strip.
- **Proposed solution:** Delete install.ts:93 and system.ts:117. Keep bundle/api.ts:96 (the 'avoid importing from infra' rationale is non-obvious). Generally: an empty catch that swallows is self-evident; only comment it when WHY swallowing is safe is non-obvious (as runner.ts:155/192 correctly do).
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (do not describe what the code does)

<a id="ll-152"></a>
#### LL-152 · installSteps.ts mixes a few what-restate lines into otherwise excellent why-comments

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/features/clients/components/install/installSteps.ts:107-108, :130, :160-161; :33
- **Problem:** Line 107-108: `// Apply per-stage progress fields to a step, skipping undefined to respect exactOptionalPropertyTypes.` — first clause restates `applyProgress`, only the second clause is a real why. Line 130: `// Mark every step strictly before current (in render order) as DONE.` restates the helper name/body. Line 160-161: `// Build the step-flow view ... Returns null when nothing is in progress — the card collapses immediately.` restates the function name but the null→collapse note is real. Line 33: `// 0..100, only meaningful when state is ACTIVE or PAUSED.` is borderline (the range is a real constraint).
- **Why it matters:** §10. This file is mostly exemplary (the mixed-scale bytes note at 146-150, the indeterminate-shimmer note at 35-37, the stage-bytes recovery note are all strong KEEPs), but a few lines restate the function name. The cleanup should trim the restating clauses while preserving the embedded 'why' (e.g. keep 'skipping undefined to respect exactOptionalPropertyTypes', drop 'Apply per-stage progress fields to a step').
- **Proposed solution:** Trim line 107-108 to just the exactOptionalPropertyTypes rationale. Delete line 130. Trim line 160-161 to keep only the 'returns null → card collapses immediately' behavioral note and drop the 'Build the step-flow view' restatement. Keep line 33. Leave all other comments in this file.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (do not describe what the code does)

<a id="ll-153"></a>
#### LL-153 · Prop-documentation comments that restate the prop name (CopyButton, SettingsGroup)

- **Category:** UI · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Renderer / UI flow
- **Area:** src/renderer/shared/ui/CopyButton.tsx:48; src/renderer/shared/ui/SettingsGroup.tsx:8-21 (partial)
- **Problem:** CopyButton.tsx:48: `// The exact text written to the clipboard on click.` above a prop named `text` — restates the name. The neighbouring prop comments (variant 50-52, children/success-icon override 54-55, copyLabel/aria-label default 57-58) document genuinely non-obvious defaults and lean KEEP. SettingsGroup.tsx:8-21 similarly documents conditional-render rules ('Only shown when there is a header (i.e. when title is set OR rightSlot itself is non-null)') which is a real invariant, mixed with className-default descriptions that border on what-restate.
- **Why it matters:** §10 discourages obvious-getter/self-explanatory documentation; per-prop docstrings on a prop whose name already says it ('text') are the noise the rule targets. But these files are close to the line: the default-value and conditional-render notes are legitimately non-obvious, so this is a trim, not a purge.
- **Proposed solution:** Delete CopyButton.tsx:48 (the `text` prop is self-explanatory). Keep the variant/override/aria-label comments. In SettingsGroup keep the conditional-render invariant ('Only shown when...') and the className-default notes only where the default value itself is non-obvious; drop any that merely name the prop. When in doubt for a UI primitive, prefer KEEP — defaults are real contract.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (multi-line docstrings unnecessary; self-explanatory props)

<a id="ll-154"></a>
#### LL-154 · Field-label comments in bundleHealing.ts and plan.ts result types (mostly KEEP, a few trim)

- **Category:** code · **Priority:** P3 · **Effort:** quick · **Change risk:** low · **Flow:** Repair flow
- **Area:** src/main/services/minecraft/bundleHealing.ts:15-16, :18, :20-22; src/main/services/bundle/plan.ts:18-20, :21
- **Problem:** bundleHealing.ts:15-16: `// Files the bundle currently owns — never repaired even if kit verify flags them as wrong-sha1 (the bundle deliberately overrides vanilla).` and :20-22: `// True when the underlying verify call ran successfully (regardless of whether a repair was needed).` plan.ts:21: `// Sum of toDownload + toUpdate sizes (for the progress bar denominator).` These label result-struct fields; the ownership note and verify-vs-repair nuance encode real non-obvious semantics and KEEP, but plan.ts:21 edges into restate of an obvious sum.
- **Why it matters:** §10. The bundle-ownership note (bundleHealing.ts:15-16) and the verify-vs-repair nuance (20-22) are genuine non-obvious semantics and KEEP. plan.ts:21 ('Sum of toDownload + toUpdate sizes') restates an obvious total; only the '(for the progress bar denominator)' consumer note carries weight. This is a judgement-heavy cluster — flagged so the automated pass treats it as TRIM-with-care, not bulk-delete.
- **Proposed solution:** Keep bundleHealing.ts:15-16, :18 and :20-22 (real semantics, including the ownership-boundary contrast at :18). Trim plan.ts:21 to drop the arithmetic restatement, keeping only '(for the progress bar denominator)' so the consumer stays documented; do not fully delete. Do not touch plan.ts:8-10 (force/repair-mode rationale) or :18-20 (healer ignore-set rationale) — those are strong KEEPs.
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (do not describe what the code does)
- **Verification note:** Real but line numbers needed correction. The auditor's original `bundleHealing.ts:18, :20-21` and `plan.ts:18-19, :21` are off by a line in the multi-line comments: verified bundleHealing ownership note spans :15-16, repaired note is :18, verifyCompleted note spans :20-22; plan.ts healer ignore-set note spans :18-20 and the bytesTotal note is :21. Substantively accurate — the only genuine trim is plan.ts:21 ('Sum of toDownload + toUpdate sizes...'); everything else is correctly KEEP. Adjusted the area/line fields and clarified that plan.ts:21 should be trimmed (keep consumer note) not deleted.

<a id="ll-155"></a>
#### LL-155 · Representative KEEP set — non-obvious 'why' comments the cleanup must NOT strip

- **Category:** docs · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** src/main/services/bundle/manager.ts:119-120,152-153,158-159,444-447; src/main/services/minecraft/launch.ts:40-46,61-68; src/main/infra/store.ts:103-104,119-120,231-234; src/main/services/system/routes.ts:57-60; src/renderer/shared/lib/queryClient.ts:26-27,33-36; src/renderer/console/hooks/useConsoleStream.ts:121-122; src/main/config.ts:1-6; src/main/index.ts:1-6; src/renderer/shared/lib/queryPersister.ts:10-12
- **Problem:** These comments encode invariants, workarounds, and platform caveats that are invisible from the code and would cause real bugs if a future edit ignored them: cooperative pause/cancel abort rationale (manager.ts:119-120,152-153,158-159,444-447), the zero-GUID Azure-id placeholder + Cloudflare-blocks-bare-Java-UA workaround (launch.ts:40-46), the kit-launch-is-offline-so-reclassify-as-repairable reasoning (launch.ts:61-68), the schema-migration gap-in-chain abort (store.ts:119-120) and legacy-session drop (store.ts:231-234), clipboard-via-main-because-permission-handler-denies-navigator (system/routes.ts:57-60), MutationCache-vs-defaultOptions fires-for-every-mutation (queryClient.ts:33-36), queueMicrotask-not-RAF-because-occluded-windows (useConsoleStream.ts:121-122), Vite-only-substitutes-literal-process.env-accesses (config.ts:1-6), Squirrel-startup-must-run-first (index.ts:1-6), and app-version-must-be-volatile-because-Squirrel-swaps-binary (queryPersister.ts:10-12).
- **Why it matters:** The user's request is to remove MEANINGLESS comments, not all comments. These are the opposite: they are the highest-value documentation in the repo. An automated regex sweep keyed on '// ' would destroy them. This finding exists to bound the cleanup so it strips noise without stripping institutional knowledge.
- **Proposed solution:** Explicitly exclude these files/line ranges (and the analogous 'why' comments throughout main/services/* and main/infra/*) from any automated comment-deletion pass. The cleanup whitelist should target only: '----' / '====' banner lines, comments whose text is a paraphrase of the immediately following identifier, and empty-catch 'skip X' labels. Everything that names a platform quirk, a race, an abort/cleanup invariant, or a wire-shape coercion stays.
- **Touches packages:** No
- **Tests needed:** none

<a id="ll-156"></a>
#### LL-156 · Reinforce code-guideline §10 + strip meaningless comments repo-wide

- **Category:** docs · **Priority:** P1 · **Effort:** quick · **Change risk:** low · **Flow:** Cross-cutting (no single flow)
- **Area:** docs/code-guideline.md §10 Comments (lines 442-451); applies to all of src/**/*.{ts,tsx}
- **Problem:** §10 (docs/code-guideline.md lines 442-451) currently states the principle ('default no comments', 'only non-obvious why', 'no what', 'no ticket/author refs', 'no multi-line docstrings') but gives no REMOVE/KEEP exemplars and does not explicitly name the two patterns that still slipped into the codebase: section-divider banners (bundle/manager.ts:89,204) and prop/field-label restate comments. The rule is correct but under-specified for an automated enforcement pass.
- **Why it matters:** The user wants the rule reinforced so future code does not reintroduce the noise. A rule with concrete forbidden-pattern examples and a short KEEP list is enforceable by review and by a lint/cleanup script; the current abstract phrasing is not. The repo is already 95%+ compliant, so the doc change plus a one-time strip of ~10 lines locks in the standard.
- **Proposed solution:** Add to §10: (1) an explicit FORBIDDEN list — 'section-divider banners (// ---- X ----, // ==== X ====, // Public API, // Internal); comments that paraphrase the next identifier (// loop over files, // set status to ready, // Plan + tracker + run); per-prop/per-field docstrings that restate the name; empty-catch labels like // skip X (comment only WHY swallowing is safe); task/author/ticket refs (already covered)'. (2) a KEEP list with one real example each — 'platform quirk (Cloudflare blocks bare Java UA), race/abort invariant (cooperative pause/cancel), wire-shape coercion (exactOptionalPropertyTypes / Strapi null→empty), non-obvious default value, migration gap guard'. (3) one rule of thumb: 'If deleting the comment loses information a careful reader could not recover from the code in 10 seconds, keep it; otherwise delete it.' Then run the strip described in the other findings (manager.ts banners, runner.ts field labels, install.ts:93, system.ts:117, CopyButton.tsx:48, installSteps trims).
- **Touches packages:** No
- **Tests needed:** none
- **Guideline:** code-guideline.md §10 Comments (rule present but lacks enforceable examples)
- **Verification note:** Real and accurate, but the area path had a typo: it read 'src/docs/code-guideline.md §10 Comments (lines 442-451)' — the actual path is docs/code-guideline.md (no src/ prefix). Verified §10 spans exactly lines 442-451 (## 10. Comments at 442; the five bullets at 444-451) and contains precisely the five principles the finding describes, with no REMOVE/KEEP exemplars. Corrected the area field; the proposed FORBIDDEN/KEEP additions and the one-time strip plan are sound and consistent with findings 1-6.

## 5. Tasks grouped by flow

### Auth / session flow (26)

- [LL-060](#ll-060) — Successful token refresh demoted to forced logout when the trailing safeStorage write throws
- [LL-061](#ll-061) — Concurrent authMe calls have no in-flight de-duplication; overlapping Yggdrasil refreshes can rotate over each other
- [LL-062](#ll-062) — Yggdrasil validate transient/HTTP errors are swallowed as 'offline', skipping the refresh that could rotate a near-expiry token
- [LL-063](#ll-063) — Account (username + skin/cape URLs) persisted to renderer localStorage for 7 days and used to gate signed-in UI before main re-verifies
- [LL-064](#ll-064) — Kit error-code string literals hard-coded instead of MinecraftKitErrorCodes constants
- [LL-065](#ll-065) — Unsafe context cast in mojangAuth bypasses the typed MinecraftKitErrorContext.httpStatus field
- [LL-066](#ll-066) — Two parallel login-error taxonomies (LoginErrorCode vs shared IpcError ERROR_CODES) with a dead/duplicate mapping table
- [LL-067](#ll-067) — isNetworkFailure duplicates the package's isYggdrasilClientErrorCode helper
- [LL-068](#ll-068) — getStoredAuth performs a write (legacy-secret migration) as a side effect of a read on the legacy-session path
- [LL-069](#ll-069) — yggdrasilAuth.verifySession/signIn (token-rotation logic) and verify.ts have no unit coverage
- [LL-070](#ll-070) — mojangAuth.ts mixes URL-allowlist, OAuth orchestration, session projection, and verify in one module — split the pure helpers for testability
- [LL-071](#ll-071) — Yggdrasil session-construction logic duplicated between signIn and refresh
- [LL-072](#ll-072) — Cancelled Mojang sign-in is mapped to LOGIN_ERROR_CODE.Unknown, relying on renderer cancelledRef timing to suppress a spurious error
- [LL-073](#ll-073) — No bounded retry/backoff on transient auth network failures; single attempt then offline/error
- [LL-074](#ll-074) — verifyMojangSession refreshes on a local clock and has no fallback when refresh fails transiently but the access token is still valid
- [LL-085](#ll-085) — Renderer re-implements PNG/texture normalization via canvas but skips the dimension/PNG validation yggdrasil-core already exports
- [LL-093](#ll-093) — Dead error codes AUTH_NETWORK_ERROR / AUTH_INVALID_CREDENTIALS are never produced
- [LL-121](#ll-121) — verifySession untested
- [LL-122](#ll-122) — auth refresh untested
- [LL-128](#ll-128) — skin.ts passes launcher SkinKinds literal into core validatePngBuffer without using core's SkinAssetKinds
- [LL-129](#ll-129) — Yggdrasil skin upload re-implements AUTO variant detection that belongs in ygg-client.uploadSkin
- [LL-130](#ll-130) — shared/contracts/auth.ts re-declares Yggdrasil session/profile shapes that ygg-core already exports
- [LL-131](#ll-131) — MojangProfileSkinSchema duplicates kit's MojangProfileSkin shape by hand
- [LL-133](#ll-133) — Mojang upload error-body extraction is generic and could move to the kit error model
- [LL-144](#ll-144) — UploadSkinPayloadSchema accepts an unbounded ArrayBuffer at the IPC boundary
- [LL-145](#ll-145) — Account is a flat type while its source AuthSession is discriminated

### Download / install flow (29)

- [LL-028](#ll-028) — Write lock can leak on synchronous throw between acquireWriteLock and executePreparedSync
- [LL-029](#ll-029) — Download phase has no per-file retry — one transient 5xx aborts the whole sync
- [LL-030](#ll-030) — Resume never refreshes the remote manifest or its hash — persists a possibly stale signature
- [LL-031](#ll-031) — BundleManager mixes 6+ responsibilities — extract AwaiterRegistry, PauseTimer, ProgressEventFactory, SyncRegistry
- [LL-032](#ll-032) — activeSyncs and activeLocks are two parallel Maps mutated in lock-step by hand
- [LL-034](#ll-034) — getInstallState fabricates signatureMatches:true and installed:false while a sync is active
- [LL-035](#ll-035) — Hand-rolled sha256 streaming duplicated 3x; minecraft-kit centralizes file integrity
- [LL-036](#ll-036) — Cooperative pause re-implemented with boolean flags + AbortController abuse instead of kit's PauseController
- [LL-037](#ll-037) — Progress throttling + speed-window logic hand-rolled in two places; kit ships createInstallProgressTracker
- [LL-038](#ll-038) — In-flight downloads continue after the first worker error before abort propagates
- [LL-041](#ll-041) — cleanEmptyDirs invoked per-deleted-file — redundant syscalls and repeated warns on a locked dir
- [LL-042](#ll-042) — resumeSync silently spawns a fresh sync when no paused entry exists, swallowing failures
- [LL-043](#ll-043) — downloadEntry recomputes sha256 over the full stream every run with no Range/partial-file resume
- [LL-049](#ll-049) — Post-install bundle hook runs after the write-lock is released, leaving a brief pre-bundle-lock window
- [LL-087](#ll-087) — ProgressBody uses dir="rtl" + <bdi> as a CSS hack to truncate file paths from the left
- [LL-099](#ll-099) — bundle getInstallState swallows real failures as 'up-to-date', and tryGetClient masks not-found vs transient errors
- [LL-100](#ll-100) — startInstall releases the operation lock twice (in .then and .finally) — confusing redundancy around launchHook
- [LL-106](#ll-106) — Bundle download promise never settles when signal is already aborted
- [LL-107](#ll-107) — getInstallState re-fetches remote manifest with no in-flight dedup or short-TTL cache
- [LL-109](#ll-109) — buildPlan does fully sequential await-in-loop disk checks with no parallelism cap
- [LL-110](#ll-110) — Sliding speed window can read a near-zero elapsed and report a transiently inflated KB/s
- [LL-115](#ll-115) — Remote manifest is flattened/iterated multiple times per sync (plan + persist)
- [LL-116](#ll-116) — saveLocalManifest / saveTargetInstallManifest rename-over-existing lacks the pre-remove download.ts uses
- [LL-117](#ll-117) — Manifest fetch reads+validates the whole body for the drift check that only needs the hash; no size cap
- [LL-119](#ll-119) — currentRequests Set can leak entries on the abort-before-listeners path
- [LL-135](#ll-135) — BundleSlug brand never defined — bundle slugs flow as raw string
- [LL-149](#ll-149) — Section-divider banner comments in bundle/manager.ts (exact §10-forbidden pattern)
- [LL-150](#ll-150) — Struct field-label restate comments in bundle/runner.ts
- [LL-151](#ll-151) — One-line restate comments in minecraft install/uninstall and infra/system

### Repair flow (15)

- [LL-003](#ll-003) — Bundle and Minecraft services have a module-level circular dependency
- [LL-044](#ll-044) — Repair progress adapter re-implements kit's createInstallProgressTracker by hand
- [LL-046](#ll-046) — Forge processor healing reaches into kit-internal action shapes (InstallActionKinds, RunForgeProcessorAction.outputs) and re-hashes by hand
- [LL-051](#ll-051) — verifyAndRepairBase returns RepairAllReport but runRepair discards it, then re-resolves/re-plans
- [LL-055](#ll-055) — Hand-rolled SHA-1 hashing in forge healing duplicates integrity validation the kit owns
- [LL-057](#ll-057) — Forge processor action cache is an unbounded module-global Map with no live eviction caller
- [LL-058](#ll-058) — No tests cover bundleHealing.verifyAndRepairExceptBundle or the repair->ensureLaunchable fallback path
- [LL-112](#ll-112) — forgeProcessor output verification hashes every output strictly serially
- [LL-113](#ll-113) — Forge-processor verification re-runs kit.install.plan to recover output actions on cache miss
- [LL-125](#ll-125) — Re-implemented SHA-1/SHA-256 file hashing instead of a shared kit/core utility
- [LL-126](#ll-126) — Forge-processor output healing is generic kit logic re-implemented in the launcher
- [LL-127](#ll-127) — ensureLaunchable full-replan ignores kit.repair.fromError / planRepairFromError
- [LL-132](#ll-132) — Bundle-path normalization for set membership duplicated across bundleHealing and bundle/plan
- [LL-134](#ll-134) — bundleHealing verifyAndRepairExceptBundle hand-rolls the kit verify->plan->run sequence
- [LL-154](#ll-154) — Field-label comments in bundleHealing.ts and plan.ts result types (mostly KEEP, a few trim)

### Launch flow (6)

- [LL-008](#ll-008) — minecraft dispose does not await in-flight teardown while bundle dispose does — asymmetric cancellation in the Promise.allSettled drain
- [LL-045](#ll-045) — Manual launch preflight file-walk duplicates kit.verify.targetReady
- [LL-052](#ll-052) — launch.ts (383 lines) mixes auth resolution, JVM-arg building, preflight, process supervision, and console wiring
- [LL-053](#ll-053) — endLaunch always emits INSTALLED on game exit and blindly deletes the op without ownership check
- [LL-075](#ll-075) — PlayButton.tsx (343L) bundles the whole install/launch/repair UI state machine with rendering and five mutations
- [LL-142](#ll-142) — Pure domain units resolveLoader and accountFromSession have no tests

### Profile / version flow (10)

- [LL-011](#ll-011) — buildContext writes persisted settings as a side effect during a read-shaped 'build context' call
- [LL-059](#ll-059) — buildContext persists settings (persistClientOverride) as a side effect during the launch read path
- [LL-083](#ll-083) — FolderInfoBlock has 14 props and embeds byte formatting + disk-ratio math (logic in a component)
- [LL-086](#ll-086) — ClientSettingsModal (208L) acts as an orchestrator with eight hooks and seven async handlers in the component body
- [LL-118](#ll-118) — resolveClientFolder allocates the full resolved settings object just to read one field
- [LL-138](#ll-138) — Client renderer type is a hand-maintained near-copy of inferred ClientResponse
- [LL-143](#ll-143) — API_ROUTES.clients.list embeds populate field names as ad-hoc literals
- [LL-146](#ll-146) — setClientOverride: five near-identical default-equality compaction blocks
- [LL-147](#ll-147) — Two parallel validators for LauncherSettings: Zod schema vs hand-rolled normalizer
- [LL-148](#ll-148) — joinClientFolder re-implements platform path joining in shared/

### Error / recovery flow (21)

- [LL-004](#ll-004) — Shared operation-lock registry is defaulted to a fresh instance in four places — silent loss of cross-domain mutual exclusion
- [LL-015](#ll-015) — normalizeError leaks non-ERROR_CODES error shapes (incl. MinecraftKitError) across the bridge
- [LL-020](#ll-020) — parseIpcArgs throws a bare IpcError object, relying on router's duck-typed normalizeError to forward it
- [LL-021](#ll-021) — Renderer cannot recover IpcError details cleanly — details are packed into Error.message before rehydration
- [LL-026](#ll-026) — errorCodes registry duplicates the union and the const object by hand, allowing silent drift
- [LL-027](#ll-027) — Launcher re-implements an error-code registry + isErrorCode model already exported by the kit/ygg packages
- [LL-039](#ll-039) — completePreparedSync persists manifest then emits terminal status — persist failure invisible beyond a warn
- [LL-040](#ll-040) — Unused/duplicated error codes and test-only exports leak into the contract and manager
- [LL-048](#ll-048) — Uninstall operation is uncancellable and unguarded against in-flight reads despite holding a delete lock
- [LL-056](#ll-056) — Kit-error -> launcher-code mapping is incomplete and silently collapses unknown failures to KIT_ERROR
- [LL-081](#ll-081) — Three parallel error-code→i18n-key lookup tables with identical shape and no shared helper
- [LL-082](#ll-082) — errorCopy localizers interpolate a raw upstream `message` into a localized template
- [LL-095](#ll-095) — Updater inFlight flag can stick true if download starts but never completes or errors
- [LL-096](#ll-096) — Skin Yggdrasil upload logs error then rethrows — surfaced failure logged twice and via wrong helper
- [LL-102](#ll-102) — Install/launch failure events collapse unmapped kit codes to KIT_ERROR, losing the failure class the renderer needs
- [LL-104](#ll-104) — Skin upload mutation has no code-aware error handling or localization (no localizeSkinError)
- [LL-105](#ll-105) — notifier.send swallows all send failures with an empty catch and no log
- [LL-111](#ll-111) — cancelAll uses a fixed 250ms sleep as a shutdown grace window instead of joining real cleanup
- [LL-120](#ll-120) — updater fsm untested
- [LL-139](#ll-139) — ErrorCode union is hand-maintained alongside ERROR_CODES const
- [LL-140](#ll-140) — Fragmented error model: bundle/minecraft/login codes disconnected from IpcError.code

### Renderer / UI flow (13)

- [LL-033](#ll-033) — BundleSyncStatus is flag-soup string union driving control flow, not a discriminated union
- [LL-076](#ll-076) — Lucide icons sized via the `size` prop instead of Tailwind `size-N` classes across ~25 call sites
- [LL-077](#ll-077) — Arbitrary `text-[Npx]` font sizes bypass the defined typography tokens (--text-caption/eyebrow/microlabel)
- [LL-078](#ll-078) — `rounded-xl` / `rounded-2xl` used where only sm/md/lg radius tokens are allowed
- [LL-079](#ll-079) — Raw `rgba(255,255,255,0.10)` color literal inside an inline `style` box-shadow
- [LL-084](#ll-084) — ActionButton concatenates Tailwind class strings with `+` instead of composing via cn()
- [LL-088](#ll-088) — ClientsPage selects the default active client in a useEffect instead of deriving it during render
- [LL-089](#ll-089) — Repeated bordered-card surface pattern is copy-pasted instead of using a shared Card/Surface primitive
- [LL-103](#ll-103) — Renderer PlayButton status switch uses a default fallthrough instead of assertNever exhaustiveness
- [LL-108](#ll-108) — getFolderSize walks the entire client tree (tens of thousands of stats) on every IPC call
- [LL-114](#ll-114) — Media protocol reads the whole cached file into a Buffer and serves it non-streamed
- [LL-152](#ll-152) — installSteps.ts mixes a few what-restate lines into otherwise excellent why-comments
- [LL-153](#ll-153) — Prop-documentation comments that restate the prop name (CopyButton, SettingsGroup)

### IPC flow (17)

- [LL-007](#ll-007) — Per-service event broadcasters duplicate the same window.isDestroyed()+webContents.send boilerplate
- [LL-016](#ll-016) — Console window gets full IPC privilege via trusted-sender check despite being sandbox:false
- [LL-017](#ll-017) — Router validates args by cast only — Zod parsing is opt-in per handler, not enforced by the contract
- [LL-018](#ll-018) — No compile-time coverage guard between IPC_EVENTS values and IpcEventPayloads keys
- [LL-019](#ll-019) — Server→client events use raw webContents.send with no shared typed emit helper — payload/name pairing unchecked
- [LL-022](#ll-022) — Renderer-side events are not validated against their Zod schemas despite schemas existing
- [LL-025](#ll-025) — isDestroyed() guard duplicated across every broadcaster method instead of a single send wrapper
- [LL-050](#ll-050) — requireIdle + lock acquire is a two-step TOCTOU window; startLaunch acquires no lock
- [LL-090](#ll-090) — IpcError JSON.stringify drops `message` for every thrown Error subclass (SkinError/ManagerError/BundleError)
- [LL-091](#ll-091) — Domain error codes (MinecraftErrorCodes/BundleErrorCodes) thrown to IPC are rejected by isIpcError — disjoint code namespaces
- [LL-092](#ll-092) — No unified toIpcError(): five parallel error models and ad-hoc per-call translation
- [LL-094](#ll-094) — IPC router logs EVERY handler failure at logger.error, including expected/recoverable ones
- [LL-097](#ll-097) — SkinError reuses the IpcError ERROR_CODES space while Minecraft/Bundle invent their own — inconsistent code modeling
- [LL-098](#ll-098) — isIpcError gates on a closed ERROR_CODES registry, so any new IpcError code from main is silently dropped at the preload
- [LL-124](#ll-124) — IPC arg-validation contract test
- [LL-136](#ll-136) — Status/code enums list every member twice (as const + parallel z.enum) — silent drift
- [LL-137](#ll-137) — StrapiList<T> hand-written type duplicates StrapiListSchema

### Cross-cutting (no single flow) (19)

- [LL-001](#ll-001) — Shell-redirect junk files litter repo root and minecraft-kit root; .gitignore does not guard them
- [LL-002](#ll-002) — Layer boundaries are not lint-enforced; architecture doc overstates enforcement
- [LL-005](#ll-005) — Infrastructure modules kit.ts and clientOperationLocks.ts sit loose under services/ instead of infra/
- [LL-006](#ll-006) — Architecture doc is significantly out of date: bundle service undocumented, non-existent launch service still described
- [LL-009](#ll-009) — tsconfig.test.json is not a project reference, so `tsc -b` skips it; tests typechecked by a separate appended invocation
- [LL-010](#ll-010) — System route open-path allowed-roots computation is security-relevant domain logic living in routes.ts
- [LL-012](#ll-012) — Most services hand-duplicate an identical Service type and empty no-op dispose; no shared Service interface exists
- [LL-013](#ll-013) — Console and updater services place IPC route registration and listener wiring inline in index.ts instead of a routes.ts
- [LL-014](#ll-014) — bootstrap and several services deep-import settings/settings.ts internals instead of the service barrel
- [LL-023](#ll-023) — media.* channels are split across two service modules, obscuring channel ownership
- [LL-024](#ll-024) — Architecture doc's IPC contract example and updater section are stale vs the real contract
- [LL-047](#ll-047) — Kit coupling surface is unbounded — no adapter narrows kit-internal contracts behind services/kit.ts
- [LL-054](#ll-054) — installManifest re-implements assertNever and kit-version discovery instead of using kit exports
- [LL-080](#ll-080) — Two divergent `formatBytes` implementations produce inconsistent size formatting
- [LL-101](#ll-101) — errorMessage() is duplicated verbatim across minecraft and bundle error modules
- [LL-123](#ll-123) — MIGRATIONS gap-throw untested
- [LL-141](#ll-141) — RAM_DEFAULT_FALLBACK_MB is dead — declared and re-exported, never consumed
- [LL-155](#ll-155) — Representative KEEP set — non-obvious 'why' comments the cleanup must NOT strip
- [LL-156](#ll-156) — Reinforce code-guideline §10 + strip meaningless comments repo-wide

## 6. Tasks grouped by effort & risk

### 6.1 Quick wins — near-zero risk, do almost anytime (effort=quick, risk=low)

- [LL-001](#ll-001) — Shell-redirect junk files litter repo root and minecraft-kit root; .gitignore does not guard them
- [LL-004](#ll-004) — Shared operation-lock registry is defaulted to a fresh instance in four places — silent loss of cross-domain mutual exclusion
- [LL-005](#ll-005) — Infrastructure modules kit.ts and clientOperationLocks.ts sit loose under services/ instead of infra/
- [LL-006](#ll-006) — Architecture doc is significantly out of date: bundle service undocumented, non-existent launch service still described
- [LL-007](#ll-007) — Per-service event broadcasters duplicate the same window.isDestroyed()+webContents.send boilerplate
- [LL-009](#ll-009) — tsconfig.test.json is not a project reference, so `tsc -b` skips it; tests typechecked by a separate appended invocation
- [LL-010](#ll-010) — System route open-path allowed-roots computation is security-relevant domain logic living in routes.ts
- [LL-012](#ll-012) — Most services hand-duplicate an identical Service type and empty no-op dispose; no shared Service interface exists
- [LL-014](#ll-014) — bootstrap and several services deep-import settings/settings.ts internals instead of the service barrel
- [LL-018](#ll-018) — No compile-time coverage guard between IPC_EVENTS values and IpcEventPayloads keys
- [LL-020](#ll-020) — parseIpcArgs throws a bare IpcError object, relying on router's duck-typed normalizeError to forward it
- [LL-021](#ll-021) — Renderer cannot recover IpcError details cleanly — details are packed into Error.message before rehydration
- [LL-024](#ll-024) — Architecture doc's IPC contract example and updater section are stale vs the real contract
- [LL-025](#ll-025) — isDestroyed() guard duplicated across every broadcaster method instead of a single send wrapper
- [LL-026](#ll-026) — errorCodes registry duplicates the union and the const object by hand, allowing silent drift
- [LL-039](#ll-039) — completePreparedSync persists manifest then emits terminal status — persist failure invisible beyond a warn
- [LL-040](#ll-040) — Unused/duplicated error codes and test-only exports leak into the contract and manager
- [LL-041](#ll-041) — cleanEmptyDirs invoked per-deleted-file — redundant syscalls and repeated warns on a locked dir
- [LL-042](#ll-042) — resumeSync silently spawns a fresh sync when no paused entry exists, swallowing failures
- [LL-053](#ll-053) — endLaunch always emits INSTALLED on game exit and blindly deletes the op without ownership check
- [LL-054](#ll-054) — installManifest re-implements assertNever and kit-version discovery instead of using kit exports
- [LL-056](#ll-056) — Kit-error -> launcher-code mapping is incomplete and silently collapses unknown failures to KIT_ERROR
- [LL-057](#ll-057) — Forge processor action cache is an unbounded module-global Map with no live eviction caller
- [LL-063](#ll-063) — Account (username + skin/cape URLs) persisted to renderer localStorage for 7 days and used to gate signed-in UI before main re-verifies
- [LL-064](#ll-064) — Kit error-code string literals hard-coded instead of MinecraftKitErrorCodes constants
- [LL-065](#ll-065) — Unsafe context cast in mojangAuth bypasses the typed MinecraftKitErrorContext.httpStatus field
- [LL-067](#ll-067) — isNetworkFailure duplicates the package's isYggdrasilClientErrorCode helper
- [LL-071](#ll-071) — Yggdrasil session-construction logic duplicated between signIn and refresh
- [LL-076](#ll-076) — Lucide icons sized via the `size` prop instead of Tailwind `size-N` classes across ~25 call sites
- [LL-077](#ll-077) — Arbitrary `text-[Npx]` font sizes bypass the defined typography tokens (--text-caption/eyebrow/microlabel)
- [LL-078](#ll-078) — `rounded-xl` / `rounded-2xl` used where only sm/md/lg radius tokens are allowed
- [LL-079](#ll-079) — Raw `rgba(255,255,255,0.10)` color literal inside an inline `style` box-shadow
- [LL-080](#ll-080) — Two divergent `formatBytes` implementations produce inconsistent size formatting
- [LL-081](#ll-081) — Three parallel error-code→i18n-key lookup tables with identical shape and no shared helper
- [LL-082](#ll-082) — errorCopy localizers interpolate a raw upstream `message` into a localized template
- [LL-084](#ll-084) — ActionButton concatenates Tailwind class strings with `+` instead of composing via cn()
- [LL-087](#ll-087) — ProgressBody uses dir="rtl" + <bdi> as a CSS hack to truncate file paths from the left
- [LL-088](#ll-088) — ClientsPage selects the default active client in a useEffect instead of deriving it during render
- [LL-090](#ll-090) — IpcError JSON.stringify drops `message` for every thrown Error subclass (SkinError/ManagerError/BundleError)
- [LL-093](#ll-093) — Dead error codes AUTH_NETWORK_ERROR / AUTH_INVALID_CREDENTIALS are never produced
- [LL-094](#ll-094) — IPC router logs EVERY handler failure at logger.error, including expected/recoverable ones
- [LL-096](#ll-096) — Skin Yggdrasil upload logs error then rethrows — surfaced failure logged twice and via wrong helper
- [LL-098](#ll-098) — isIpcError gates on a closed ERROR_CODES registry, so any new IpcError code from main is silently dropped at the preload
- [LL-100](#ll-100) — startInstall releases the operation lock twice (in .then and .finally) — confusing redundancy around launchHook
- [LL-101](#ll-101) — errorMessage() is duplicated verbatim across minecraft and bundle error modules
- [LL-102](#ll-102) — Install/launch failure events collapse unmapped kit codes to KIT_ERROR, losing the failure class the renderer needs
- [LL-103](#ll-103) — Renderer PlayButton status switch uses a default fallthrough instead of assertNever exhaustiveness
- [LL-104](#ll-104) — Skin upload mutation has no code-aware error handling or localization (no localizeSkinError)
- [LL-105](#ll-105) — notifier.send swallows all send failures with an empty catch and no log
- [LL-106](#ll-106) — Bundle download promise never settles when signal is already aborted
- [LL-110](#ll-110) — Sliding speed window can read a near-zero elapsed and report a transiently inflated KB/s
- [LL-116](#ll-116) — saveLocalManifest / saveTargetInstallManifest rename-over-existing lacks the pre-remove download.ts uses
- [LL-118](#ll-118) — resolveClientFolder allocates the full resolved settings object just to read one field
- [LL-119](#ll-119) — currentRequests Set can leak entries on the abort-before-listeners path
- [LL-122](#ll-122) — auth refresh untested
- [LL-128](#ll-128) — skin.ts passes launcher SkinKinds literal into core validatePngBuffer without using core's SkinAssetKinds
- [LL-130](#ll-130) — shared/contracts/auth.ts re-declares Yggdrasil session/profile shapes that ygg-core already exports
- [LL-132](#ll-132) — Bundle-path normalization for set membership duplicated across bundleHealing and bundle/plan
- [LL-136](#ll-136) — Status/code enums list every member twice (as const + parallel z.enum) — silent drift
- [LL-137](#ll-137) — StrapiList<T> hand-written type duplicates StrapiListSchema
- [LL-138](#ll-138) — Client renderer type is a hand-maintained near-copy of inferred ClientResponse
- [LL-139](#ll-139) — ErrorCode union is hand-maintained alongside ERROR_CODES const
- [LL-141](#ll-141) — RAM_DEFAULT_FALLBACK_MB is dead — declared and re-exported, never consumed
- [LL-142](#ll-142) — Pure domain units resolveLoader and accountFromSession have no tests
- [LL-143](#ll-143) — API_ROUTES.clients.list embeds populate field names as ad-hoc literals
- [LL-144](#ll-144) — UploadSkinPayloadSchema accepts an unbounded ArrayBuffer at the IPC boundary
- [LL-148](#ll-148) — joinClientFolder re-implements platform path joining in shared/
- [LL-149](#ll-149) — Section-divider banner comments in bundle/manager.ts (exact §10-forbidden pattern)
- [LL-150](#ll-150) — Struct field-label restate comments in bundle/runner.ts
- [LL-151](#ll-151) — One-line restate comments in minecraft install/uninstall and infra/system
- [LL-152](#ll-152) — installSteps.ts mixes a few what-restate lines into otherwise excellent why-comments
- [LL-153](#ll-153) — Prop-documentation comments that restate the prop name (CopyButton, SettingsGroup)
- [LL-154](#ll-154) — Field-label comments in bundleHealing.ts and plan.ts result types (mostly KEEP, a few trim)
- [LL-155](#ll-155) — Representative KEEP set — non-obvious 'why' comments the cleanup must NOT strip
- [LL-156](#ll-156) — Reinforce code-guideline §10 + strip meaningless comments repo-wide

### 6.2 Medium refactors — require tests before/after (effort=medium)

- [LL-002](#ll-002) — Layer boundaries are not lint-enforced; architecture doc overstates enforcement
- [LL-003](#ll-003) — Bundle and Minecraft services have a module-level circular dependency
- [LL-008](#ll-008) — minecraft dispose does not await in-flight teardown while bundle dispose does — asymmetric cancellation in the Promise.allSettled drain
- [LL-011](#ll-011) — buildContext writes persisted settings as a side effect during a read-shaped 'build context' call
- [LL-013](#ll-013) — Console and updater services place IPC route registration and listener wiring inline in index.ts instead of a routes.ts
- [LL-015](#ll-015) — normalizeError leaks non-ERROR_CODES error shapes (incl. MinecraftKitError) across the bridge
- [LL-016](#ll-016) — Console window gets full IPC privilege via trusted-sender check despite being sandbox:false
- [LL-019](#ll-019) — Server→client events use raw webContents.send with no shared typed emit helper — payload/name pairing unchecked
- [LL-022](#ll-022) — Renderer-side events are not validated against their Zod schemas despite schemas existing
- [LL-023](#ll-023) — media.* channels are split across two service modules, obscuring channel ownership
- [LL-027](#ll-027) — Launcher re-implements an error-code registry + isErrorCode model already exported by the kit/ygg packages
- [LL-028](#ll-028) — Write lock can leak on synchronous throw between acquireWriteLock and executePreparedSync
- [LL-029](#ll-029) — Download phase has no per-file retry — one transient 5xx aborts the whole sync
- [LL-030](#ll-030) — Resume never refreshes the remote manifest or its hash — persists a possibly stale signature
- [LL-032](#ll-032) — activeSyncs and activeLocks are two parallel Maps mutated in lock-step by hand
- [LL-034](#ll-034) — getInstallState fabricates signatureMatches:true and installed:false while a sync is active
- [LL-035](#ll-035) — Hand-rolled sha256 streaming duplicated 3x; minecraft-kit centralizes file integrity
- [LL-037](#ll-037) — Progress throttling + speed-window logic hand-rolled in two places; kit ships createInstallProgressTracker
- [LL-038](#ll-038) — In-flight downloads continue after the first worker error before abort propagates
- [LL-044](#ll-044) — Repair progress adapter re-implements kit's createInstallProgressTracker by hand
- [LL-045](#ll-045) — Manual launch preflight file-walk duplicates kit.verify.targetReady
- [LL-048](#ll-048) — Uninstall operation is uncancellable and unguarded against in-flight reads despite holding a delete lock
- [LL-049](#ll-049) — Post-install bundle hook runs after the write-lock is released, leaving a brief pre-bundle-lock window
- [LL-050](#ll-050) — requireIdle + lock acquire is a two-step TOCTOU window; startLaunch acquires no lock
- [LL-051](#ll-051) — verifyAndRepairBase returns RepairAllReport but runRepair discards it, then re-resolves/re-plans
- [LL-052](#ll-052) — launch.ts (383 lines) mixes auth resolution, JVM-arg building, preflight, process supervision, and console wiring
- [LL-055](#ll-055) — Hand-rolled SHA-1 hashing in forge healing duplicates integrity validation the kit owns
- [LL-058](#ll-058) — No tests cover bundleHealing.verifyAndRepairExceptBundle or the repair->ensureLaunchable fallback path
- [LL-059](#ll-059) — buildContext persists settings (persistClientOverride) as a side effect during the launch read path
- [LL-060](#ll-060) — Successful token refresh demoted to forced logout when the trailing safeStorage write throws
- [LL-061](#ll-061) — Concurrent authMe calls have no in-flight de-duplication; overlapping Yggdrasil refreshes can rotate over each other
- [LL-062](#ll-062) — Yggdrasil validate transient/HTTP errors are swallowed as 'offline', skipping the refresh that could rotate a near-expiry token
- [LL-066](#ll-066) — Two parallel login-error taxonomies (LoginErrorCode vs shared IpcError ERROR_CODES) with a dead/duplicate mapping table
- [LL-068](#ll-068) — getStoredAuth performs a write (legacy-secret migration) as a side effect of a read on the legacy-session path
- [LL-069](#ll-069) — yggdrasilAuth.verifySession/signIn (token-rotation logic) and verify.ts have no unit coverage
- [LL-070](#ll-070) — mojangAuth.ts mixes URL-allowlist, OAuth orchestration, session projection, and verify in one module — split the pure helpers for testability
- [LL-072](#ll-072) — Cancelled Mojang sign-in is mapped to LOGIN_ERROR_CODE.Unknown, relying on renderer cancelledRef timing to suppress a spurious error
- [LL-073](#ll-073) — No bounded retry/backoff on transient auth network failures; single attempt then offline/error
- [LL-074](#ll-074) — verifyMojangSession refreshes on a local clock and has no fallback when refresh fails transiently but the access token is still valid
- [LL-075](#ll-075) — PlayButton.tsx (343L) bundles the whole install/launch/repair UI state machine with rendering and five mutations
- [LL-083](#ll-083) — FolderInfoBlock has 14 props and embeds byte formatting + disk-ratio math (logic in a component)
- [LL-085](#ll-085) — Renderer re-implements PNG/texture normalization via canvas but skips the dimension/PNG validation yggdrasil-core already exports
- [LL-086](#ll-086) — ClientSettingsModal (208L) acts as an orchestrator with eight hooks and seven async handlers in the component body
- [LL-089](#ll-089) — Repeated bordered-card surface pattern is copy-pasted instead of using a shared Card/Surface primitive
- [LL-091](#ll-091) — Domain error codes (MinecraftErrorCodes/BundleErrorCodes) thrown to IPC are rejected by isIpcError — disjoint code namespaces
- [LL-092](#ll-092) — No unified toIpcError(): five parallel error models and ad-hoc per-call translation
- [LL-095](#ll-095) — Updater inFlight flag can stick true if download starts but never completes or errors
- [LL-097](#ll-097) — SkinError reuses the IpcError ERROR_CODES space while Minecraft/Bundle invent their own — inconsistent code modeling
- [LL-099](#ll-099) — bundle getInstallState swallows real failures as 'up-to-date', and tryGetClient masks not-found vs transient errors
- [LL-107](#ll-107) — getInstallState re-fetches remote manifest with no in-flight dedup or short-TTL cache
- [LL-108](#ll-108) — getFolderSize walks the entire client tree (tens of thousands of stats) on every IPC call
- [LL-109](#ll-109) — buildPlan does fully sequential await-in-loop disk checks with no parallelism cap
- [LL-111](#ll-111) — cancelAll uses a fixed 250ms sleep as a shutdown grace window instead of joining real cleanup
- [LL-112](#ll-112) — forgeProcessor output verification hashes every output strictly serially
- [LL-113](#ll-113) — Forge-processor verification re-runs kit.install.plan to recover output actions on cache miss
- [LL-114](#ll-114) — Media protocol reads the whole cached file into a Buffer and serves it non-streamed
- [LL-115](#ll-115) — Remote manifest is flattened/iterated multiple times per sync (plan + persist)
- [LL-117](#ll-117) — Manifest fetch reads+validates the whole body for the drift check that only needs the hash; no size cap
- [LL-120](#ll-120) — updater fsm untested
- [LL-121](#ll-121) — verifySession untested
- [LL-123](#ll-123) — MIGRATIONS gap-throw untested
- [LL-125](#ll-125) — Re-implemented SHA-1/SHA-256 file hashing instead of a shared kit/core utility
- [LL-127](#ll-127) — ensureLaunchable full-replan ignores kit.repair.fromError / planRepairFromError
- [LL-129](#ll-129) — Yggdrasil skin upload re-implements AUTO variant detection that belongs in ygg-client.uploadSkin
- [LL-131](#ll-131) — MojangProfileSkinSchema duplicates kit's MojangProfileSkin shape by hand
- [LL-133](#ll-133) — Mojang upload error-body extraction is generic and could move to the kit error model
- [LL-134](#ll-134) — bundleHealing verifyAndRepairExceptBundle hand-rolls the kit verify->plan->run sequence
- [LL-135](#ll-135) — BundleSlug brand never defined — bundle slugs flow as raw string
- [LL-140](#ll-140) — Fragmented error model: bundle/minecraft/login codes disconnected from IpcError.code
- [LL-145](#ll-145) — Account is a flat type while its source AuthSession is discriminated
- [LL-146](#ll-146) — setClientOverride: five near-identical default-equality compaction blocks
- [LL-147](#ll-147) — Two parallel validators for LauncherSettings: Zod schema vs hand-rolled normalizer

### 6.3 Large architectural changes — stage carefully (effort=large)

- [LL-017](#ll-017) — Router validates args by cast only — Zod parsing is opt-in per handler, not enforced by the contract
- [LL-031](#ll-031) — BundleManager mixes 6+ responsibilities — extract AwaiterRegistry, PauseTimer, ProgressEventFactory, SyncRegistry
- [LL-033](#ll-033) — BundleSyncStatus is flag-soup string union driving control flow, not a discriminated union
- [LL-036](#ll-036) — Cooperative pause re-implemented with boolean flags + AbortController abuse instead of kit's PauseController
- [LL-043](#ll-043) — downloadEntry recomputes sha256 over the full stream every run with no Range/partial-file resume
- [LL-046](#ll-046) — Forge processor healing reaches into kit-internal action shapes (InstallActionKinds, RunForgeProcessorAction.outputs) and re-hashes by hand
- [LL-047](#ll-047) — Kit coupling surface is unbounded — no adapter narrows kit-internal contracts behind services/kit.ts
- [LL-124](#ll-124) — IPC arg-validation contract test
- [LL-126](#ll-126) — Forge-processor output healing is generic kit logic re-implemented in the launcher

## 7. Package boundary work

### 7.1 Extract launcher logic INTO a package (then rebuild dist + reinstall into launcher `node_modules`, bump the pinned version)

- [LL-001](#ll-001) — Shell-redirect junk files litter repo root and minecraft-kit root; .gitignore does not guard them
- [LL-035](#ll-035) — Hand-rolled sha256 streaming duplicated 3x; minecraft-kit centralizes file integrity
- [LL-044](#ll-044) — Repair progress adapter re-implements kit's createInstallProgressTracker by hand
- [LL-046](#ll-046) — Forge processor healing reaches into kit-internal action shapes (InstallActionKinds, RunForgeProcessorAction.outputs) and re-hashes by hand
- [LL-054](#ll-054) — installManifest re-implements assertNever and kit-version discovery instead of using kit exports
- [LL-055](#ll-055) — Hand-rolled SHA-1 hashing in forge healing duplicates integrity validation the kit owns
- [LL-085](#ll-085) — Renderer re-implements PNG/texture normalization via canvas but skips the dimension/PNG validation yggdrasil-core already exports
- [LL-112](#ll-112) — forgeProcessor output verification hashes every output strictly serially
- [LL-125](#ll-125) — Re-implemented SHA-1/SHA-256 file hashing instead of a shared kit/core utility
- [LL-126](#ll-126) — Forge-processor output healing is generic kit logic re-implemented in the launcher
- [LL-129](#ll-129) — Yggdrasil skin upload re-implements AUTO variant detection that belongs in ygg-client.uploadSkin
- [LL-131](#ll-131) — MojangProfileSkinSchema duplicates kit's MojangProfileSkin shape by hand
- [LL-133](#ll-133) — Mojang upload error-body extraction is generic and could move to the kit error model

### 7.2 Replace duplication by reusing existing package exports (no package change)

- [LL-027](#ll-027) — Launcher re-implements an error-code registry + isErrorCode model already exported by the kit/ygg packages
- [LL-035](#ll-035) — Hand-rolled sha256 streaming duplicated 3x; minecraft-kit centralizes file integrity
- [LL-036](#ll-036) — Cooperative pause re-implemented with boolean flags + AbortController abuse instead of kit's PauseController
- [LL-037](#ll-037) — Progress throttling + speed-window logic hand-rolled in two places; kit ships createInstallProgressTracker
- [LL-044](#ll-044) — Repair progress adapter re-implements kit's createInstallProgressTracker by hand
- [LL-045](#ll-045) — Manual launch preflight file-walk duplicates kit.verify.targetReady
- [LL-054](#ll-054) — installManifest re-implements assertNever and kit-version discovery instead of using kit exports
- [LL-064](#ll-064) — Kit error-code string literals hard-coded instead of MinecraftKitErrorCodes constants
- [LL-067](#ll-067) — isNetworkFailure duplicates the package's isYggdrasilClientErrorCode helper
- [LL-071](#ll-071) — Yggdrasil session-construction logic duplicated between signIn and refresh
- [LL-085](#ll-085) — Renderer re-implements PNG/texture normalization via canvas but skips the dimension/PNG validation yggdrasil-core already exports
- [LL-101](#ll-101) — errorMessage() is duplicated verbatim across minecraft and bundle error modules
- [LL-127](#ll-127) — ensureLaunchable full-replan ignores kit.repair.fromError / planRepairFromError
- [LL-128](#ll-128) — skin.ts passes launcher SkinKinds literal into core validatePngBuffer without using core's SkinAssetKinds
- [LL-130](#ll-130) — shared/contracts/auth.ts re-declares Yggdrasil session/profile shapes that ygg-core already exports
- [LL-132](#ll-132) — Bundle-path normalization for set membership duplicated across bundleHealing and bundle/plan
- [LL-134](#ll-134) — bundleHealing verifyAndRepairExceptBundle hand-rolls the kit verify->plan->run sequence
- [LL-148](#ll-148) — joinClientFolder re-implements platform path joining in shared/

### 7.3 All tasks touching `minecraft-kit`

- [LL-001](#ll-001) — Shell-redirect junk files litter repo root and minecraft-kit root; .gitignore does not guard them
- [LL-029](#ll-029) — Download phase has no per-file retry — one transient 5xx aborts the whole sync
- [LL-035](#ll-035) — Hand-rolled sha256 streaming duplicated 3x; minecraft-kit centralizes file integrity
- [LL-044](#ll-044) — Repair progress adapter re-implements kit's createInstallProgressTracker by hand
- [LL-046](#ll-046) — Forge processor healing reaches into kit-internal action shapes (InstallActionKinds, RunForgeProcessorAction.outputs) and re-hashes by hand
- [LL-054](#ll-054) — installManifest re-implements assertNever and kit-version discovery instead of using kit exports
- [LL-055](#ll-055) — Hand-rolled SHA-1 hashing in forge healing duplicates integrity validation the kit owns
- [LL-112](#ll-112) — forgeProcessor output verification hashes every output strictly serially
- [LL-125](#ll-125) — Re-implemented SHA-1/SHA-256 file hashing instead of a shared kit/core utility
- [LL-126](#ll-126) — Forge-processor output healing is generic kit logic re-implemented in the launcher
- [LL-131](#ll-131) — MojangProfileSkinSchema duplicates kit's MojangProfileSkin shape by hand
- [LL-133](#ll-133) — Mojang upload error-body extraction is generic and could move to the kit error model

### 7.4 All tasks touching `yggdrasil` (`-core` / `-client`)

- [LL-085](#ll-085) — Renderer re-implements PNG/texture normalization via canvas but skips the dimension/PNG validation yggdrasil-core already exports
- [LL-129](#ll-129) — Yggdrasil skin upload re-implements AUTO variant detection that belongs in ygg-client.uploadSkin

## 8. Documentation updates

- [LL-006](#ll-006) — Architecture doc is significantly out of date: bundle service undocumented, non-existent launch service still described
- [LL-024](#ll-024) — Architecture doc's IPC contract example and updater section are stale vs the real contract
- [LL-155](#ll-155) — Representative KEEP set — non-obvious 'why' comments the cleanup must NOT strip
- [LL-156](#ll-156) — Reinforce code-guideline §10 + strip meaningless comments repo-wide

## 9. Appendix — candidate findings rejected on verification

These were proposed by an auditor but **rejected** when checked against the code, recorded here for transparency:

- **No HTTP keep-alive agent for 16 concurrent bundle download workers** (Performance, async, fs efficiency, cancellation & races) — REJECTED. Electron ^38.8.6 bundles Node 20.19.5 (verified via package.json + process.versions). Since Node 19, the default global http.globalAgent/https.globalAgent have keepAlive:true, so connections are already pooled and reused across the worker pool — the premise of fresh TCP/TLS per file is false. The worker pool already caps concurrent sockets at 16 (runDownloadPhase concurrency), so there is no unbounded socket churn either. Downgraded P1→P3 and effort large→quick to reflect that the only residual is cosmetic explicit-agent tuning.
- **Planned-install progress tracker emits unthrottled IPC** (Performance, async, fs efficiency, cancellation & races) — REJECTED. The kit's createInstallProgressTracker ALREADY throttles. Per the public d.ts (node_modules/@loontail/minecraft-kit/dist/index.d.ts:2843-2846, 2872): ProgressTrackerOptions.throttleMs 'Defaults to 100ms' and the tracker 'Aggregate[s] ProgressEvents ... into throttled UI snapshots'. createPlannedProgressAdapter passes no options, so it gets the 100ms default. tracker.subscribe's listener (emitSnapshot) therefore fires only once per throttled snapshot — identical to the repair path's createThrottledProgressEmitter 100ms policy. emitSnapshot is NOT called per DOWNLOAD_PROGRESS event. The premise that the install path is unthrottled is false.
