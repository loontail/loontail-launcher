The verifications confirm the findings. The DUP-1 verifier note is correct (runner uses a different accumulator algorithm, not the rolling-window). Note `operationalId` is 6 files, not ~24 — I'll adjust that. I have enough to produce the final plan.

---

# FINAL DEEP-AUDIT & GLOBAL-REFACTOR PLAN — loontail-launcher (Electron)

Repo: `e:/workspace/elixir/loontail-launcher` — single repo, shared build graph (`tsc -b` + `vitest`). Backend provider: `loontail-minecraft-network-service` (Rust/Axum), post-refactor (builds+bundle merge, native catalog contract, Yggdrasil auth, token hashing).

> ID NOTE: the raw findings contain **collisions** (two `API-1`, two `DEAD-1`, etc.) from separate audit passes. I have **re-namespaced** every item below to a unique ID (`SEC-*`, `SYNC-*`, `BUG-*`, `DEAD-*`, `SIMP-*`) so waves are unambiguous. The original IDs are shown in parentheses.

---

## 1. SECURITY + API-DRIFT SUMMARY (must-fix first)

### Security — P1 (fix immediately, then the P2 hardening)
- **SEC-1 (SSRF-1) — Media-cache protocol is an SSRF + bearer-exfil primitive.** `src/main/services/media/protocol.ts` + `mediaCache.ts` validate only the URL scheme, then `fetch` with `sessionAuthHeader()` attached **unconditionally** and `redirect:'follow'`. A renderer-supplied media URL (`cache://media/<encoded>`) can target `127.0.0.1` / `169.254.169.254` (SSRF the CSP-bound renderer can't reach) **and leaks the universal API bearer** to any host. **VERIFIED.**
- **SEC-2 (TOKEN-1) — API bearer passed to the game JVM as `-D` system property, and logged to disk.** `src/main/services/minecraft/launch.ts:124-131` appends `-Dloontail.network.serviceToken=<getStoredSessionToken()>`; command line is world-readable per-user (`Win32_Process`, `/proc/pid/cmdline`) and the full command is written via `env.logger.info` at `launch.ts:363-364`. That token is the **same** bearer used for catalog/bundle/textures/network. **VERIFIED.**

### Security — P2 (same threat class, defense-in-depth)
- **SEC-3 (REDIR-1)** — bundle manifest **initial** entry URL is scheme-validated but not host-pinned; bearer attaches to whatever host the manifest names (`download.ts` / `urlPolicy.ts`).
- **SEC-4 (CSP-1)** — renderer CSP `img-src` allows open `https` (image-beacon exfil channel) (`infra/session.ts`).
- **SEC-5 (SANDBOX-1)** — console window runs `sandbox:false` (documented workaround); render console output as text only, keep allowlist tight, prefer a pull model.
- **SEC-INFO (INFO-1)** — POSITIVE baseline of verified defenses; **no action**, record as regression invariants.

### API-drift vs current backend contract — all P2, all non-breaking today
- **SYNC-1 (API-1 sync)** — launcher `ClientResponseSchema` omits the new inlined `bundle` summary object (`{slug,version,status,filesCount,manifestUrl}`). Zod strips it; launcher still drives off top-level `bundleSlug`. Optional: surface it to skip a manifest round-trip.
- **SYNC-2 (API-2 sync)** — bundled `@loontail/yggdrasil-client` built with bare `apiRoot` carries `authserver/sessionserver/bulkProfiles` paths that would 404 against the backend (only `/api/yggdrasil/*` is mounted). **Latent only** — launcher uses this instance for textures exclusively. Narrow the type / comment.
- **SYNC-3 (API-3 sync)** — stale comments referencing retired Strapi/CMS `publicUrl`/`server.url` plugin contract in `bundle/api.ts`, `manager.ts`, `verify.ts`. Doc-only.

> **Contract-touch caution:** SYNC-1/2/3 are the only items that interact with the live backend contract. They are **read-side tolerant** today — verify against the running backend before changing schemas, but none are blocking.

---

## 2. CONFIRMED, DE-DUPED FIX LIST (by theme)

### (A) API-SYNC
| ID | Title | File(s) | Concrete change | Why |
|---|---|---|---|---|
| **SYNC-1** (API-1) | Consume inlined `bundle` summary | `src/shared/contracts/client.ts`, `src/main/services/.../clientsApi.ts`, `normalizeClient` | OPTIONAL: add optional `bundle:{slug,version:nullable,status,filesCount,manifestUrl}` to `ClientResponseSchema` + surface in `normalizeClient`. **Recommendation: DEFER** unless you want to skip the manifest round-trip; current `bundleSlug` flow is intentional. | Server already sends bundle status/manifestUrl; unused on the wire. |
| **SYNC-2** (API-2) | Textures-only Yggdrasil client | `src/main/services/auth/yggdrasilClient.ts` | Narrow the exposed type to texture methods only (it already only surfaces `texturesClient`+`fetchTextures`), or add a `// why` comment that this bare-apiRoot instance must not call authserver/profile methods. | Prevents a future caller silently hitting a 404 path. |
| **SYNC-3** (API-3) | Kill stale Strapi/CMS comments | `src/main/services/bundle/api.ts:17-26`, `manager.ts`, `verify.ts:18` | Rewrite the `publicUrl`/`server.url`/"CMS"/"plugin" comments to describe the native Rust `bundle-registry` contract. | Comments describe a retired system; misleads maintainers. |

### (B) DEAD-CODE REMOVAL — all confirmed
| ID | Title | File(s) | Concrete change | Why |
|---|---|---|---|---|
| **DEAD-1** (DEAD-1) | Dead renderer register slice | `src/renderer/features/auth/hooks.ts:87-109,38-44,16`, `auth/api.ts:7-8` | Remove `useRegister`, `registerWithRejectionResult`, `register` api fn, unused `RegisterPayload`/`register` imports. **Keep main-side `auth.register` + contract** (separate decision — touches `contractCoverage.test.ts`). | Self-contained dead renderer vertical; no signup UI. |
| **DEAD-2** (DEAD-2) | Dead renderer update-build slice | `src/renderer/features/catalog/hooks.ts:62`, `catalog/index.ts:9`, `catalog/api.ts:18-19` | Remove `useUpdateBuild`, its barrel re-export, `updateBuild` api fn. Keep main-side `builds.update`. | No edit-build modal; zero consumers. |
| **DEAD-3** (DEAD-3) | Orphan install-manifest match pair | `src/main/services/minecraft/installManifest.ts:166-178,180-186`; `installManifest.test.ts`; `managerInstall/managerLaunch/managerStatus` tests | Remove `hasCurrentTargetInstallManifest` + `targetInstallManifestMatches`, their direct test, and the `hasCurrentTargetInstallManifest: vi.fn()` mock entries. | `readinessPolicy` defers target-match to Play; pair is unwired. |
| **DEAD-4** (DEAD-4) | Stale `_internals` test seam + dead type re-export | `src/main/services/bundle/manager.ts:613-615` | Delete `_internals` const + comment + `export type { ActiveSync, SyncPlan }`. Keep `import { flattenRemote }` (line 37, used at 453). | No test imports them; misleading "exported only for tests" comment. |
| **DEAD-5** (DEAD-5) | Dead branded-id helpers | `src/shared/contracts/ids.ts:19,29-32,34-37` + barrel | Remove `asUserId`, `ClientIdSchema`, `UserIdSchema`, `UserId` brand (unless kept as doc) + `contracts/index.ts` entries. | Leftover scaffolding for a never-used user-id keyspace. |
| **DEAD-6** (DEAD-6) | Unused `SLUG_REQUIRED_MSG` | `src/main/ipc/parseArgs.ts:6` | Delete line 6. | Superseded by `KEY_REQUIRED_MSG` after CatalogKey migration. |
| **DEAD-7** (DEAD-7) | 11 dead `z.infer` type aliases | `auth.ts:73,82`; `bundle.ts:79`; `client.ts:10`; `instance.ts:23,36,45,54`; `settings.ts:32`; `updater.ts:9`; `constants/errorCodes.ts:9` + barrels | Remove the 11 alias declarations + their `contracts/index.ts` / `constants/index.ts` entries. Keep the underlying schemas. | Inferred-type aliases nothing consumes. |
| **DEAD-8** (DEAD-8) | Test-only contract helpers | `src/shared/contracts/catalog.ts:24,118` + barrel + `catalog.test.ts` | Remove `catalogKeyFor` + `isLocal` + barrel entries + their test assertions. | Production uses `asCatalogKey`/`parseCatalogKey` + inline `source` checks. |
| **DEAD-9** (DEAD-9) | Test-only `clampMonotonicPercent` | `src/renderer/features/clients/components/install/progressFormat.ts:57` + `progressFormat.test.ts` | Remove fn + its test block. | Not re-exported, not on any live progress path. |
| **DEAD-10** (DEAD-1 cpx) | Test seams in production modules | `src/main/services/bundle/syncState.ts:157-190` (`seedActiveSync`/`noopLease`), `minecraft/ops.ts:103-107` (`seedOp`) | Move to a `*.testkit.ts` / `tests/helpers` module. **If SIMP-3/SIMP-4 land first, these collapse to one-line `map.set(...)` in the tests and can be deleted outright** — sequence after those. | Test seams shipped in production source. |

### (C) SIMPLIFICATION / REFACTOR — confirmed
| ID | Title | File(s) | Concrete change | Why |
|---|---|---|---|---|
| **SIMP-1** (CPX-1) | Collapse SyncTask `paused/cancelled` compat views + dual result shape | `src/main/services/bundle/syncState.ts:42-86,118-127`, `runner.ts:27-80,248-264`, `manager.ts:385-407` | Read `task.phase` directly; drop `paused`/`cancelled` accessor pair and the derived `SyncPhasesResult.paused/cancelled` fields (keep `outcome`). **Preserve the invariant: cancel overrides pause, cancel is terminal.** **Must update tests** (`managerResumeCleanup`, `runner`, `managerPauseCleanup` assert on setters/fields). NOT zero-touch. | Stale W5-T5 transitional scaffolding; two views over one `phase`. |
| **SIMP-2** (CPX-2) | Dedupe 3× BUNDLE_SYNCING op block | `src/main/services/minecraft/manager.ts:211-231,363-388,463-481` | Extract `private async runBundleSyncPhase(slug, hook, {onFailure?})` claiming the op, awaiting hook, applying shared abort/log/cleanup. | ~60→~25 lines; centralizes abort-vs-error decoding. |
| **SIMP-3** (API-1 cpx) | Delete `OpRegistry` Map-wrapper | `src/main/services/minecraft/ops.ts:71-101`, `manager.ts:91-101`, `env.ts:22` | Use `Map<CatalogKey,Op>` directly; drop `.map` getter; replace `seedOp` with `map.set`. Multi-file test touch (`managerStatus/managerCancel/managerReadinessIntegration`, `makeManager` helpers). | 1:1 forwarder whose backing Map is already leaked + mutated directly — zero added value. |
| **SIMP-4** (API-2 cpx) | Delete `SyncStateStore` Map-wrapper | `src/main/services/bundle/syncState.ts:129-155`, `manager.ts:108,140,…` | Replace with `Map<CatalogKey,ActiveSync>` default `new Map()`; call sites are Map-native. | No-value 1:1 Map wrapper. |
| **SIMP-5** (CPX-3) | Unify `tryGetClient`/`fetchClient` + sync-target preamble | `src/main/services/bundle/manager.ts:201-231,265-311,467-507` | Add `resolveSyncTarget(key): {client,bundleSlug,clientFolder}|<reason>` with error policy as a param (swallow vs classify). | Cuts duplicated preamble in a 615-line god-class. |
| **SIMP-6** (DUP-1) | Extract ONE rolling-speed window | `src/main/services/minecraft/progressAdapter.ts:38-96`, `src/renderer/features/clients/components/install/useByteSpeed.ts` + `progressFormat.rollingSpeed` | Extract `createSpeedWindow(windowMs)` for the **two** near-identical 4s rolling-window impls. **DO NOT fold in `runner.ts maybeEmit`** — verifier confirmed it's a different accumulator algorithm (1s window, no prune/backward-reset). Cross-process: helper must live in a shared, dependency-free module. | Two line-for-line dup'd samplers. |
| **SIMP-7** (DUP-2) | `writeJsonAtomic` + `readJsonValidated` infra | `src/main/infra/atomicFile.ts`, `bundle/manifestRepo.ts:27-42`, `instances/instanceRepo.ts:33-48`, `minecraft/installManifest.ts` | Add the two helpers; route all three save/load paths through them (instanceRepo fully reimplements the dance and doesn't even call `atomicReplace`). | Atomic-write + read-validate boilerplate triplicated. |
| **SIMP-8** (DUP-3) | Merge `seedAuthRow`/`writeAuthRow` | `src/main/infra/db/repos.ts:108-123` | Delete `seedAuthRow`; widen `writeAuthRow` to `secret: Buffer\|null`; update the `legacyImport` caller. **DB/store file — extra care.** | Byte-identical INSERT…ON CONFLICT. |
| **SIMP-9** (DUP-4) | Factor bundle/minecraft broadcaster + store | `renderer/features/{minecraft,bundle}/store.ts`, `events.ts`; `main/services/{minecraft,bundle}/broadcast.ts` | (1) `makeBroadcaster(getWindow,{status,progress,error})`; (2) `createRuntimeStore({default,terminalStatuses,clearErrorStatuses,clearProgressFields})`. **Leave the two event listeners separate** (side-effects/invalidations diverge). | Mechanically identical broadcaster/store shapes. |
| **SIMP-10** (DUP-5) | Shared `useSlugMutation` | `renderer/features/minecraft/hooks.ts:15-62`, `bundle/hooks.ts:11-52` | Add `makeSlugMutationHook(meta)` / `useSlugMutation(fn,meta)` in `shared/lib`; instantiate per feature (keep per-feature localizer). | Verbatim helper + meta wiring duplicated. |
| **SIMP-11** (DUP-6) | Layer `createStatusSeeder` on `createLimiter` | `src/main/infra/concurrency.ts:7-29`, `src/renderer/shared/lib/statusSeeder.ts:15-61` | Have `createStatusSeeder` use `createLimiter(maxConcurrency)` for the pool; keep its per-slug dedup map on top. | Hand-rolled concurrency pool duplicates the shared primitive. |
| **SIMP-12** (API-3 cpx) | Inline `operationalId` | `src/renderer/features/catalog/buildIdentity.ts:8` + **6** consumer files (not 24) | Inline to `item.key`; keep concept as a JSDoc on `CatalogItem.key` or a type alias. **LOW priority** — count is small. | Single-property passthrough fn. |
| **SIMP-13** (API-4 cpx) | `createValueStore` — DEFER | `src/renderer/shared/lib/stores/createValueStore.ts` + 2 consumers | **Recommendation: KEEP**; at most drop the `as ValueStoreHook<T>` cast by typing `create`'s generic. Borderline, low value. | Factor is small; 2 trivial consumers. |
| **SIMP-14** (API-5 cpx) | `writeClipboardText` — verify-then-decide | `src/main/infra/clipboard.ts` | If exactly one caller, inline `clipboard.writeText` + move rationale comment; if mocked for testability, KEEP. Verify caller count first. LOW priority. | One-line forwarder. |

### (D) BUGS / RACES
| ID | Title | File(s) | Concrete change | Why |
|---|---|---|---|---|
| **BUG-1** (AUTH-1) | Concurrent session refresh has no de-dup; clobbers single-use rotation | `src/main/infra/http.ts:92-107`, `services/auth/index.ts:26-37`, `services/auth/verify.ts:54-73` | Memoize in-flight refresh (`let refreshing: Promise<string\|null>\|null`, return it if pending, clear in finally); re-read current token before refreshing and retry with the new token if it changed; share one refresh path between `http.ts` and `verifySession`. | Parallel session requests each refresh the same revoked token → spurious re-login / store clobber. **P1.** |
| **BUG-2** (RACE-1) | Pause during launch-time sync freezes Play up to 5 min | `src/main/services/bundle/manager.ts:119-153,396-407`, `bundle/routes.ts:14-17` | **needs-judgement — see recommendation below.** | Park-and-wait `launchWait` never settles on pause. |
| **BUG-3** (AUTH-2) | `getStoredAuth` destroys session on transient secure-storage failure | `src/main/infra/store.ts:323-357` | Distinguish "storage unavailable" (transient → return null, keep row) from "blob present but invalid" (delete). Tag `assertSecureStorageAvailable` errors as non-destructive. Same for `migrateLegacyAuthSession`. | A keyring/DBus hiccup forces full re-login. |
| **BUG-4** (PATH-1) | Windows path-case gap can delete remote-owned bundle files | `src/main/services/bundle/paths.ts:46-47`, `plan.ts:104-147`, `manifestSnapshot.ts` | Add `toComparisonKey(p)` that lowercases (Windows) for **set-membership + local-manifest lookup only**; keep original-cased path for fs ops. | Casing drift → still-owned file queued for deletion + heal-thrash. |
| **BUG-5** (RACE-2) | Cancel after heal emits COMPLETED instead of CANCELLED | `src/main/services/bundle/manager.ts:367-384` | Post-heal guard: `if (task.cancelled) throw new BundleError(ABORTED,…); if (task.paused) return;`. | forLaunch cancel would resolve (launch proceeds) instead of rejecting. Narrow window, mostly cosmetic. |
| **BUG-6** (ERR-1) | Hash-mismatch finish-path bypasses shared `fail()` | `src/main/services/bundle/download.ts:169-186` | Route hash mismatch through `fail()` for shared settled/cleanup/teardown. | Correct today; future-regression hardening. LOW. |
| **BUG-7** (RACE-3) | `cancelAll` 250ms drain can truncate slow cleanup on quit | `src/main/services/bundle/manager.ts:592-610`, `index.ts:192-209` | Document that no store/DB writes may run in a sync's `finally`; optionally await bundle drain unconditionally on shutdown (unref timers). | Defensible today; durability note. LOW. |
| **BUG-8** (DB-1) | WAL closed without checkpoint on quit | `src/main/infra/db/connection.ts:18-43`, `index.ts:200` | Add `db.pragma('wal_checkpoint(TRUNCATE)')` before `close()`. **DB/store file — extra care.** | Clean-shutdown durability; recovers on next open anyway. LOW. |

### (E) SECURITY
| ID | Title | File(s) | Concrete change | Why |
|---|---|---|---|---|
| **SEC-1** (SSRF-1) | Host-allowlist + conditional bearer on media cache | `src/main/services/media/protocol.ts:11-51`, `mediaCache.ts:70-90` | Allowlist decoded URL host to `mainConfig.apiUrl` origin (+ explicit CDN); attach `sessionAuthHeader()` **only** for the trusted API origin; `redirect:'manual'` + re-validate `Location` origin. | SSRF + bearer exfil. **P1.** |
| **SEC-2** (TOKEN-1) | Token out-of-band to JVM + redact from log | `src/main/services/minecraft/launch.ts:124-131,364` | Pass token via env var / 0600 file / loopback handshake instead of `-D`; at minimum redact `serviceToken` from the launch command log line. | Bearer readable in process list + on disk. **P1.** |
| **SEC-3** (REDIR-1) | Host-pin bundle asset URLs | `src/main/services/bundle/download.ts:34-117`, `urlPolicy.ts:37-76` | Require initial asset host == API origin (or asset-CDN allowlist) in `resolveBundleManifestEntryUrl`/`validateBundleAssetDownloadUrl`; conditional bearer. | Manifest-gated SSRF / bearer attach. |
| **SEC-4** (CSP-1) | Tighten `img-src` | `src/main/infra/session.ts:6-16` | Replace open `https` with self/data/blob/cache + explicit API+CDN origins; route remote images through the hardened cache proxy. Keep `style-src 'unsafe-inline'` (react-aria). | Image-beacon exfil channel. |
| **SEC-5** (SANDBOX-1) | Harden console window | `src/main/windows/consoleWindow.ts:26-37`, `trustedSender.ts:46-57` | Prefer `sandbox:true` + pull model (`webContents.send`); if `false` stays, keep allowlist tight and render all console output as text (never `dangerouslySetInnerHTML`/unsanitized markdown). | Larger blast radius for renderer RCE on attacker-influenced stdout. |
| **SEC-INFO** (INFO-1) | Record verified defenses as invariants | (see finding) | No change. Treat as regression checklist for window/preload/IPC/secret-store reviews. | Prevent regressions. |

### (F) ARCHITECTURE / DESIGN / A11Y
No standalone a11y findings surfaced in this pass. Architecture wins are the simplification cluster (SIMP-3/4/5 god-class decomposition of `BundleManager`, SIMP-9/10/11 cross-feature factoring). Treat `BundleManager` (615 lines) decomposition (SIMP-5) as the highest architecture lever; the rest are localized.

### DROPPED / DOWNGRADED
- **DUP-1 runner third impl** — verifier false-positive on scope: `runner.ts maybeEmit` is a 1s accumulator, NOT a 4s rolling window. SIMP-6 limited to the two genuine dups.
- **SIMP-13 (createValueStore)**, **SIMP-14 (clipboard)** — defer / keep (low value, may be net-negative).
- **SYNC-1** — defer unless a concrete consumer (skip manifest round-trip / show bundle status) is wanted.

---

## 3. EXECUTION WAVES (disjoint file sets; one agent per wave-lane)

Conflict rule: agents editing overlapping files serialize. Within a wave, **lanes are file-disjoint** and parallelizable; waves are sequenced where they share files. `manager.ts` (both `bundle/` and `minecraft/`) is the central hotspot — its edits are **serialized across waves**, never parallel.

### WAVE 0 — Security P1 (highest priority, mostly disjoint)
- **0a:** SEC-1 (`media/protocol.ts`, `media/mediaCache.ts`) + SEC-4 (`infra/session.ts`).
- **0b:** SEC-2 (`minecraft/launch.ts`).
- **0c:** SEC-3 (`bundle/download.ts`, `bundle/urlPolicy.ts`) — ⚠️ touches `download.ts`; if BUG-6 runs, sequence them (same file).
- **0d:** SEC-5 (`windows/consoleWindow.ts`, `trustedSender.ts`, console renderer).
> ⚠️ Backend-contract / network surface — verify SEC-1/SEC-3 host-allowlist against the live backend's actual asset/CDN origins before merging.

### WAVE 1 — Pure dead-code (file-disjoint, zero behavior change, fast)
- **1a (shared contracts):** DEAD-5, DEAD-7, DEAD-8 (`shared/contracts/*` + barrels). Single agent — they share `contracts/index.ts`.
- **1b (renderer):** DEAD-1 (`auth/*`), DEAD-2 (`catalog/*`), DEAD-9 (`clients/.../progressFormat.ts`). Disjoint feature dirs.
- **1c (main, minecraft):** DEAD-3 (`minecraft/installManifest.ts` + its tests/mocks), DEAD-6 (`ipc/parseArgs.ts`).
- **1d (main, bundle):** DEAD-4 (`bundle/manager.ts:613-615` only — surgical; **must finish before any Wave-3 `bundle/manager.ts` edit**).

### WAVE 2 — Bugs/races (independent files; high value)
- **2a (auth):** BUG-1 + BUG-3 (`infra/http.ts`, `services/auth/index.ts`, `auth/verify.ts`, `infra/store.ts`). Single agent (shared refresh path).
- **2b (db):** SIMP-8 + BUG-8 (`infra/db/repos.ts`, `infra/db/connection.ts`, `index.ts`). ⚠️ **better-sqlite3 store/migration — extra care; ensure NODE-ABI build for tests.**
- **2c (bundle paths):** BUG-4 (`bundle/paths.ts`, `bundle/plan.ts`, `bundle/manifestSnapshot.ts`). ⚠️ **manifest/bundle path logic — extra care; do not weaken `resolveSafeEntryPath`.**
- **2d (bundle download):** BUG-6 (`bundle/download.ts`) — sequence after Wave-0c (same file).

### WAVE 3 — Bundle simplification + the pause/cancel bug cluster (SERIAL within `bundle/manager.ts`)
All of SIMP-1, SIMP-4, SIMP-5, BUG-2, BUG-5, DEAD-10(bundle half), SYNC-3 touch `bundle/manager.ts`/`syncState.ts`/`runner.ts`. **One agent, sequential**, ordered:
1. SIMP-4 (delete `SyncStateStore` → `Map`).
2. SIMP-1 (collapse `paused/cancelled` views — update tests; preserve cancel>pause terminal invariant).
3. BUG-5 (post-heal cancel guard), **BUG-2** (see recommendation), SYNC-3 comment fixes.
4. SIMP-5 (`resolveSyncTarget` decomposition).
5. DEAD-10 bundle (`seedActiveSync`/`noopLease` → testkit or inline `map.set`).
> ⚠️ `bundle/manager.ts` also referenced by SIMP-7/SIMP-9 — keep those in separate waves/files.

### WAVE 4 — Minecraft-manager simplification (SERIAL within `minecraft/manager.ts`)
- SIMP-3 (delete `OpRegistry` → `Map`, `ops.ts`/`env.ts`/`manager.ts` + tests), then SIMP-2 (`runBundleSyncPhase` extraction), then DEAD-10 minecraft (`seedOp`). One agent, sequential.

### WAVE 5 — Cross-cutting infra/renderer factoring (file-disjoint lanes)
- **5a:** SIMP-7 (`infra/atomicFile.ts` + `manifestRepo.ts` + `instanceRepo.ts` + `installManifest.ts`). ⚠️ manifest writers — atomic-write semantics must be preserved.
- **5b:** SIMP-6 (new shared `createSpeedWindow` module + `progressAdapter.ts` + `useByteSpeed.ts`).
- **5c:** SIMP-11 (`infra/concurrency.ts` consumed by `renderer/.../statusSeeder.ts`).
- **5d:** SIMP-9 + SIMP-10 (renderer `minecraft`/`bundle` store/broadcaster/hooks + new `shared/lib` factories) + SIMP-12 (`operationalId` inline). Single agent (overlapping `shared/lib` + renderer features).

### WAVE 6 — API-sync + low-priority cleanup (optional / decision-gated)
- SYNC-2 (`auth/yggdrasilClient.ts`), SYNC-1 (deferred unless wanted), SIMP-13/SIMP-14 (verify-then-decide), BUG-7 doc note.

---

## 4. PER-WAVE VERIFICATION

Run from `e:/workspace/elixir/loontail-launcher` after **every** wave (and after each serial step inside Waves 3/4):

```
npm run rebuild        # FIRST after any fresh checkout: builds better-sqlite3 for the NODE abi used by vitest
npm run typecheck      # tsc -b --noEmit  +  tsc --noEmit -p tsconfig.test.json
npm run lint           # biome check .
npm test               # vitest run  (REQUIRES better-sqlite3 @ NODE abi)
npm run build          # electron-vite build
```

**Dual-ABI gotcha (critical):**
- `npm run rebuild` builds better-sqlite3 for the **Electron** ABI (needed for `npm run dev` / `electron-builder` packaging).
- `npm test` (vitest) runs under plain **Node** and needs the **Node** ABI. After a `rebuild` (Electron ABI), tests will fail to load better-sqlite3 until the Node-ABI build is restored. Per repo memory: rebuild for dev/package, use the node-ABI build for tests. **If a wave touches `infra/db/*` (Wave 2b, SIMP-8, BUG-8), verify the binding loads under both ABIs before declaring done.**

**Extra-care gates (run the full quintet, don't skip):**
- Backend-contract waves (Wave 0 SEC-1/SEC-3 host allowlists; Wave 6 SYNC-*): **manually verify against the running backend** that allowlisted origins match real asset/CDN/manifest hosts.
- IPC-contract touch (DEAD-1/DEAD-2 if main-side handlers are later retired): re-run `contractCoverage.test.ts`; update `channels.ts` + contract if you remove a channel.
- better-sqlite3 store/migration (Wave 2b): dual-ABI check above.
- Manifest/bundle path waves (Wave 2c BUG-4, Wave 3, Wave 5a): confirm `resolveSafeEntryPath` traversal protection and SHA-256 verification still pass their tests.

**Recommendations on judgement calls:**
- **BUG-2 (pause-during-launch):** Do **NOT** apply the raw "cancelSync on forLaunch pause" fix — it breaks the intentional, test-asserted park-and-resume design (`managerPauseCleanup.test.ts:438`). **Recommended:** make the Pause **button** unavailable (disabled) for a `forLaunch` sync in the renderer (`ProgressControls`/`installSteps.ts`) so the user can only Resume/Cancel during a Play-time sync. This removes the only path to the freeze without changing the (tested) backend park semantics. Defer the deeper backend change unless product wants pause-during-launch killed entirely.
- **SIMP-1:** valid and worth doing, but **not zero-touch** — budget for updating `managerResumeCleanup`/`runner`/`managerPauseCleanup` tests and preserving the cancel-overrides-pause / cancel-is-terminal invariant.
- **SIMP-6:** scope to the two 4s rolling-window impls only; leave `runner.ts` accumulator alone.

**Key file paths (absolute) for the hottest items:**
- `e:/workspace/elixir/loontail-launcher/src/main/services/bundle/manager.ts` (Wave 3 serial hotspot)
- `e:/workspace/elixir/loontail-launcher/src/main/services/minecraft/manager.ts` (Wave 4 serial hotspot)
- `e:/workspace/elixir/loontail-launcher/src/main/services/media/protocol.ts` + `mediaCache.ts` (SEC-1, P1)
- `e:/workspace/elixir/loontail-launcher/src/main/services/minecraft/launch.ts` (SEC-2, P1)
- `e:/workspace/elixir/loontail-launcher/src/main/infra/http.ts` + `services/auth/{index,verify}.ts` (BUG-1, P1)
- `e:/workspace/elixir/loontail-launcher/src/main/infra/db/{repos,connection}.ts` (dual-ABI care)