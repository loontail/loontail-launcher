# Architecture Map — Loontail Launcher

Synthesized from 11 parallel subsystem readers (lifecycle, ipc-contracts, infra, minecraft-core,
bundle, catalog-instances-clients, auth-skin, app-services, renderer-clients, renderer-shell,
renderer-shared, tests-build). All anchors are `file:line` as observed at synthesis time
(2026-06-09); treat line numbers as approximate after edits.

---

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ RENDERER (Chromium, sandboxed; no Node, no @loontail/minecraft-kit — grep-verified)      │
│                                                                                          │
│  Main window (index.html)                            Console window (console.html)       │
│  ┌────────────────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ app/App.tsx — composition root + ErrorBoundary │  │ console/App.tsx — separate     │  │
│  │                                                │  │ React root (sandbox:false,     │  │
│  │ features/                                      │  │ documented workaround)         │  │
│  │   app-shell  home  settings  setup             │  │  useConsoleStream: ring buffer,│  │
│  │   auth  skin  updater  notifications  app      │  │  microtask flush, 1s reconcile │  │
│  │   catalog  clients  minecraft  bundle          │  │  poll, manual virtualization   │  │
│  │                                                │  │                                │  │
│  │ shared/                                        │  │  IPC: 4-channel allowlist only │  │
│  │   ui kit (Modal/Toast/RovingGroup/...)         │  │  (CONSOLE_TRUSTED_CHANNELS)    │  │
│  │   react-query + localStorage persister         │  └────────────────────────────────┘  │
│  │   zustand nav stack, toast bus, i18n (en/uk)   │                                      │
│  │   statusSeeder (bounded prefetch)              │                                      │
│  └────────────────────────────────────────────────┘                                      │
│                                                                                          │
│        window.api = { invoke, on, platform }   (src/preload/index.ts, 50 LOC)            │
└────────────────────────────────────────┬─────────────────────────────────────────────────┘
═══════════════════════════════ IPC BOUNDARY (typed) ═════════════════════════════════════
   src/shared/ipc/contract.ts   IpcContract: 56 invoke channels  + IpcEventPayloads: 11 events
   src/shared/ipc/channels.ts   name registries + compile-time two-way coverage guards
   src/shared/contracts/*       zod schemas, branded ids (ClientSlug, InstanceId, CatalogKey…)
   src/shared/domain/*          pure cross-process logic (settings resolve/override, loader,
                                recent selection) — imported by BOTH processes
   Error transport: toIpcError → sentinel-tagged Error.message → preload rehydration
═══════════════════════════════════════════════════════════════════════════════════════════
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS                                                                             │
│                                                                                          │
│  src/main/index.ts — single composition root: squirrel guard, single-instance lock,      │
│  privileged cache:// scheme, explicit constructor DI for ~17 collaborators,              │
│  serial service init ×15, before-quit drain (cancelAll → dispose ×15 → router → DB)      │
│                                                                                          │
│  ipc/   router (trust check + toIpcError + sentinel wrap)                                │
│         trustedSender (per-window URL/frame pinning; console = 4-channel allowlist)      │
│         parseArgs (zod validation helpers used by every routes.ts)                       │
│                                                                                          │
│  services/ (15, uniform createXService(router,…) ⇒ {init, dispose}):                     │
│   ┌─ housekeeping ──────────────────────────────┐ ┌─ identity ─────────────────────────┐ │
│   │ app  settings  system  media(cache://)      │ │ auth (Yggdrasil + Mojang OAuth)    │ │
│   │ console(hub adapter)  updater(Squirrel)     │ │ skin (upload/clear, cache prewarm) │ │
│   └─────────────────────────────────────────────┘ └────────────────────────────────────┘ │
│   ┌─ catalog ───────────────────────────────────┐ ┌─ operations ───────────────────────┐ │
│   │ clients(Strapi fetch + offline snapshot)    │ │ minecraft (install/repair/launch/  │ │
│   │ catalog (local+official aggregator)         │ │   uninstall; per-slug op machine)  │ │
│   │ instances (local builds, instance.json)     │ │ bundle (modpack overlay sync:     │ │
│   │ history (lastPlayed read facade)            │ │   plan → download → delete → heal) │ │
│   │ servers (raw TCP SLP ping)                  │ │ clientOperationLocks (shared       │ │
│   └─────────────────────────────────────────────┘ │   cross-domain write leases)       │ │
│                                                   └────────────────────────────────────┘ │
│   bundle ⇄ minecraft: launch hook injected at root (good) BUT healer imports             │
│   minecraft internals directly and repairWorkflow imports bundle/manifestRepo (cycle)    │
│                                                                                          │
│  infra/  store (better-sqlite3 launcher.db: settings/auth/instances/lastPlayed,          │
│          safeStorage-encrypted auth secret)   http (Strapi-bound fetch + zod)            │
│          cache (disk snapshots + LRU)   consoleHub + log4jStream + consoleBuffer         │
│          system  logger  notifier  session(CSP)  atomicFile  throttledEmitter  clipboard │
│                                                                                          │
│  windows/  mainWindow (sandboxed)  consoleWindow (sandbox:false, documented)             │
│            secureWindow (nav guards)  rendererLocations (dev/prod URL allowlists)        │
│                                                                                          │
│  config.ts — build-time-inlined env (API_URL/API_TOKEN/…); kit.ts — ONE MinecraftKit     │
└────────┬───────────────────┬─────────────────────┬───────────────────┬──────────────────┘
         │                   │                     │                   │
 @loontail/minecraft-kit   Strapi CMS        update.electronjs.org   Minecraft servers
 (targets/install/repair/  (clients, bundle- (Squirrel feed over     (raw TCP Server List
  launch/versions/MS auth) registry manifest, GitHub Releases)        Ping, SRV lookup)
 @loontail/yggdrasil-*     Yggdrasil plugin,
 (auth, textures, PNG)     media)
```

Key boundary facts:

- The renderer never imports the kit; kit knowledge leaks only as compensating UI logic
  (see concern D2).
- `shared/domain` is the only logic imported by both processes; `shared/contracts` is the
  only type surface crossing the bridge.
- All main→renderer pushes go through per-domain broadcasters that re-resolve the live
  `BrowserWindow` per send (survives macOS window recreation).
- Cross-domain folder writes are arbitrated by `clientOperationLocks`
  (CLIENT_FOLDER / RUNTIME_COMPONENT / BUNDLE_MANIFEST leases) shared by minecraft and bundle.

---

## 2. Core flows (end-to-end, across subsystem boundaries)

### 2a. Build creation (local instance)

1. `BuildsHomePage.tsx:107,119` opens `CreateBuildModal` (mounted only while open,
   `BuildsHomePage.tsx:172-178`).
2. Version pickers fetch lazily: `CreateBuildModal.tsx:57-59` →
   IPC `builds.listMinecraftVersions` / `builds.listLoaderVersions`
   (`instances/routes.ts:43-54`, args via `ListLoaderVersionsArgsSchema`,
   `shared/contracts/instance.ts:140-145`) → `create.ts:157-180` →
   `kit.versions.minecraft/fabric/forge.list` projected to renderer-safe options
   (kit Node-only types never cross the bridge, `instance.ts:126-128`).
3. Submit `CreateBuildModal.tsx:78-96` → `useCreateBuild` (`catalog/hooks.ts:54`) →
   IPC `builds.create`.
4. `instances/routes.ts:20-27` validates `CreateInstancePayloadSchema`
   (`shared/contracts/instance.ts:101-110`).
5. `createInstance` (`create.ts:74-110`): new UUID via `asInstanceId` (`create.ts:85`);
   `resolveInstanceDir` (`create.ts:40-47`) derives `clientsFolder/<uuid>` through
   `resolveClientSettings` (`shared/domain/settingsResolution.ts:21`,
   `settingsDefaults.ts:11-15`) — throws `InstanceError` if no install folder set.
   Note the `InstanceId → ClientSlug` cast at `create.ts:41` (concern T1).
6. `pinLoaderVersion` (`create.ts:53-72`): picker-supplied version trusted; otherwise
   `kit.versions.fabric.resolve` / `kit.versions.forge.resolve` over the network;
   vanilla → null.
7. `InstanceManifestSchema.parse` builds the manifest (`create.ts:90-105`; bundle defaults
   to `{source:'none'}`); `saveInstanceManifest` atomic write — mkdir, `.tmp`, rm, rename
   (`instanceRepo.ts:33-48`).
8. `upsertInstanceEntry` (`registry.ts:19-23`) → `store.setStoredInstanceRegistry`
   (SQLite; the registry is a rebuildable index, `instance.json` is authoritative —
   self-healed at startup by `reconcile.ts:27-61`).
9. Returns `manifestToCatalogItem` (`localSource.ts:22-57`) so the renderer gets the
   `LocalCatalogItem` immediately; `onSuccess` invalidates the catalog query root
   (`catalog/hooks.ts:44-52`); `onCreated` pushes the build detail route
   (`BuildsHomePage.tsx:176`).

### 2b. Download / install (official or local build)

1. PlayButton `INSTALL`/retry → `startOrPickLoader` (`PlayButton.tsx:176-183`); if the spec
   carries both forge+fabric and no valid persisted loader (`PlayButton.tsx:164-171`,
   validated with `isLoaderAvailable`) → `LoaderChoiceModal` (`LoaderChoiceModal.tsx:26-94`).
2. `useInstallClient` → IPC `minecraft.install` with `InstallRequest {slug, loader?}`
   (`minecraft/api.ts:9-10`, contract `shared/ipc/contract.ts:85-92`).
3. `minecraft/routes.ts:31` parses args; `withClassifiedKitError` reclassifies raw kit
   errors into coded `ManagerError`s (`routes.ts:14-23`) → `manager.startInstall`
   (`manager.ts:126`).
4. `requireIdle` (`manager.ts:339`) then `acquireWriteLock` on
   CLIENT_FOLDER + RUNTIME_COMPONENT (`manager.ts:348`). **Gap:** no op is registered until
   after `buildContext` resolves (concern A1).
5. `buildContext` (`context.ts:45`): `resolveBuildByOpaqueId` — local source first
   (network-free, `catalog.ts:89-93` → `localSource.ts:88-94`), official Strapi slug
   fallback (`strapiSource.ts:21-27` → `clients.ts:16-29` cachedFetch offline snapshot);
   settings + NO_CLIENT_FOLDER gate (`context.ts:71`); loader resolution with
   stale-override cleanup (`context.ts:78-94`); `kit.targets.resolve` (`context.ts:96`)
   via `buildSpecToTargetInput` (`target.ts`).
6. `beginInstall` registers the InstallOp (PauseController + AbortController) and emits
   `INSTALLING` (`install.ts:16-39`).
7. Background `runInstall` (`install.ts:100`): `kit.install.plan` (`install.ts:86`),
   `forgeProcessorCache.remember` (`install.ts:87`), `kit.install.run` under
   `createPlannedProgressAdapter` (`install.ts:91-97`, `progressAdapter.ts:48`) — progress
   throttled at `PROGRESS_THROTTLE_MS=100` (`shared/constants/progress.ts:4`) and pushed
   via `broadcast.ts:12-28`. Renderer: `minecraft/events.ts:77-91` patches the zustand
   store; `installSteps.ts:130-149` builds the stepper (reconstructing per-stage bytes —
   concern D2); `useByteSpeed.ts` computes speed/ETA renderer-side.
8. Success: persist runtime override + durable sidecar manifest
   (`install.ts:110-114`, rm-then-rename swap `installManifest.ts:118-121`); op deleted in
   `finally` (`install.ts:120`); lock released (`manager.ts:145`); `INSTALLED` emitted
   (`manager.ts:151`).
9. Official builds then run a best-effort bundle sync hook
   (`manager.ts:155-164` → `bundleService.manager.syncForLaunch`, wired at the composition
   root `index.ts:147-149`). **Gap:** no BUNDLE_SYNCING op is registered for this path
   (concern A3). Local builds skip the hook entirely (`manager.ts:104-106`).
10. Failure: `handleInstallFailure` (`install.ts:54`) — cancelled fresh install rm's the
    client folder if under the clients root (`install.ts:62-66`, guard
    `uninstall.ts:14-21`); otherwise `classifyError` (`errors.ts`) + `emitError`; status
    re-derived from `isAnythingInstalled` (`install.ts:41-52`). Renderer toasts repairable
    codes with an inline Repair action (`minecraft/events.ts:26-62`).

Open-time status (no network, no hashing): `minecraft.getStatus` → in-flight op via
`OP_TO_STATUS` (`ops.ts:45-52`) else `resolveClientInstallPresence`
(`readinessPolicy.ts:20`): sidecar manifest → INSTALLED; files without manifest →
UNVERIFIED (`runtimeState.ts:9-30`); else NOT_INSTALLED. First-mount seeding is deduped
and concurrency-capped by `statusSeeder` (`shared/lib/statusSeeder.ts:15-61`,
`minecraft/hooks.ts:16-34`); live events always win over seeds.

### 2c. Launch

1. PLAY → `useLaunchClient` → IPC `minecraft.launch` (`minecraft/api.ts:27-28`,
   `routes.ts:61`). Button shows CHECKING while the invoke is pending
   (`PlayButton.tsx:119-124,204`).
2. `manager.startLaunch` (`manager.ts:259`): `requireIdle`, then the LAUNCH_STARTING op is
   claimed synchronously **before** any await (`manager.ts:266-267`) — unlike startInstall.
3. `buildContext` (`manager.ts:272`, same resolution chain as 2b step 5) +
   `requireAccount` (`manager.ts:273`, `launch.ts:451`; account provider injected at
   `index.ts:142` from `auth/auth.ts:75-78`). **Gap:** abort issued during this window is
   silently dropped (concern A4).
4. Official builds: BUNDLE_SYNCING op + awaited bundle launch hook with abort signal
   (`manager.ts:281-303`) → `bundle/manager.syncForLaunch` (`bundle/manager.ts:100-118`,
   launch awaiters `manager.ts:449-463`) — the full flow 2d runs inline; hook failure
   restores INSTALLED and rethrows.
5. `runLaunch` (`launch.ts:286`): fresh startup op + `LAUNCHING` (`launch.ts:301-302`);
   `resolveLaunchAuth` picks Mojang passthrough / Yggdrasil (authlib-injector `-javaagent`
   + `http.agent` JVM args, `launch.ts:262-279`; jar from `@loontail/yggdrasil-client`,
   UUID dashed via `@loontail/yggdrasil-core`) / offline (`launch.ts:280-283`); the
   Loontail network agent `-javaagent` is attached only on Java ≥ 21 with the jar present
   (`launch.ts:108-130`). Session read directly from `getStoredAuth` (`launch.ts:304`) —
   bypasses AuthSessionPort (concern L8).
6. `kit.launch.compose` (`launch.ts:315`); compose errors reclassified to
   NOT_INSTALLED/RUNTIME_ERROR so the renderer offers Repair (`launch.ts:63-70`).
7. `verifyLaunchPreflight`: `fs.access` on the java exe and every classpath entry in
   parallel (`launch.ts:148-177`).
8. Console wiring: `consoleHub.setActiveSession` drains the previous session's partial
   log4j XML (`infra/consoleHub.ts:166-173`); `kit.launch.run` (`launch.ts:351`) fans
   LAUNCH_STARTED/EXITED/STDOUT/STDERR into the hub (`launch.ts:343-382`) →
   `Log4jStreamParser.feed` (`log4jStream.ts:61-126`) → `ConsoleBuffer` ring (10 000,
   `consoleBuffer.ts:31-84`) → 50 ms batched IPC push to the console window
   (`consoleHub.ts:247-255`, `consoleWindowSink.ts:26-34`). Console window renderer:
   `useConsoleStream.ts:94-134` (dedupe, microtask flush, 1 s reconcile poll).
9. Op swapped to LAUNCH holding the kit session (`launch.ts:388`); `session.exited` →
   `endLaunch` (`launch.ts:189`): op delete, `console.endSession` (flushes split crash
   events, `consoleHub.ts:180-195`), CRASHED (exit code from kit error,
   `launch.ts:182-187`) or EXITED, status back to INSTALLED. Stop = `session.abort`
   (`manager.ts:308-311`).
10. `recordPlayed(ctx.item.key)` stamps lastPlayed keyed by CatalogKey
    (`launch.ts:409` → `store.ts:409-411` → `repos.ts:165-170`); renderer invalidates the
    history query on RUNNING (`minecraft/events.ts:88-90`) which reorders the Home
    carousel (`useRecentBuilds.ts:19-31`, concern A17).

### 2d. Bundle update (overlay sync)

1. Detection: `useBundleStatus` seeds via IPC `bundle.checkStatus`
   (`bundle/hooks.ts:8-32`) → `manager.getInstallState` (`bundle/manager.ts:181-213`) —
   best-effort `fetchRemoteManifest` compares remote `manifestHash` against the persisted
   local hash; network failure reports `signatureMatches:true` so UI is never gated on
   connectivity (`manager.ts:203-212`).
2. Mismatch while game INSTALLED → PlayButton `BUNDLE_UPDATE`
   (`PlayButton.tsx:106-113`) → `useStartBundle` → IPC `bundle.start`
   (`bundle/api.ts:5-6`, `bundle/routes.ts:9-12`). The same `manager.startSync`
   (`manager.ts:93`) also runs launch-chained as `syncForLaunch` (`manager.ts:100-118`,
   external abort → `cancelSync`) and post-install/post-repair (flow 2b step 9).
3. `runSync` (`manager.ts:215`): `getClient` (`manager.ts:221`); no `bundleSlug` →
   NO_BUNDLE (`manager.ts:225-229`); `resolveClientFolder` from settings or
   NO_CLIENT_FOLDER (`manager.ts:231-237`); `acquireWriteLock` (shared
   `clientOperationLocks`, OP_IN_FLIGHT if held — `manager.ts:238,420-431`); ActiveSync
   registered (`manager.ts:244-246`, `syncState.ts:35-76`).
4. FETCHING_MANIFEST → `fetchRemoteManifest` (`api.ts:41-96`): authenticated `httpRequest`
   to the Strapi bundle-registry route (`shared/constants/apiRoutes.ts`), zod
   `RemoteManifestSchema`, URL absolutization against `mainConfig.apiUrl`, sha256 of the
   raw JSON as the drift signal; stored on the ActiveSync (`manager.ts:263-264`).
5. PLANNING → `loadLocalManifest` (`.loontail/bundle.json`, `manifestRepo.ts:10-25`) →
   `buildPlan` (`plan.ts:47-145`) diffs remote vs local + disk into
   toDownload/toUpdate/toDelete/toSkip + `bundleOwnedRelativePaths` + bytesTotal. Empty
   plan → UP_TO_DATE (`manager.ts:317-320`).
6. Download phase (`runner.ts:111-145`): min(16, queue) workers
   (`constants/bundle.ts:4`); each file `resolveSafeEntryPath` anti-traversal
   (`paths.ts:15-37`) then `downloadEntry` (`download.ts:116-212`) — raw node http/https
   with redirect/origin/HTTPS policy (`urlPolicy.ts:63-119`), stream-to-`.tmp` with sha256
   verify, `atomicReplace` (`infra/atomicFile.ts:9-23`), sockets registered for
   synchronous cancel. Progress throttled with a 1 s speed window (`runner.ts:59-89`) →
   `makeProgressEvent` (`manager.ts:52-70`) → `broadcast.ts:18-22` →
   renderer `bundle/events.ts` → shared progress card bundle step
   (`installSteps.ts:211-233`).
7. Delete phase (`runner.ts:171-218`) with empty-dir cleanup; if anything was deleted →
   HEAL: `healer.healAfterDeletes` (`manager.ts:326-337`, `healer.ts:48-73`) →
   `verifyAndRepairExceptBundle` (`minecraft/bundleHealing.ts:68-105`):
   `kit.verify.minecraft.run`, drop issues on bundle-owned paths,
   `kit.repair.minecraft.plan/run` for the rest; kit progress adapted by
   `healProgress.ts:19-68`. (This is the bidirectional coupling seam — concern L1.)
8. `completePreparedSync` (`manager.ts:341`) → `persistLocalManifest` writes the sidecar
   from `flattenRemote` (`manager.ts:375-388`, `manifestSnapshot.ts:5-12`); terminal
   status emitted + launch awaiters resolved in `finally` (`manager.ts:363-373`); lock
   released unless paused (`manager.ts:356-360,433-439`).
9. Renderer: COMPLETED/UP_TO_DATE force `installed`+`signatureMatches` true
   (`bundle/events.ts:14-21`, `bundle/store.ts:52-59`); errors patch store + toast and
   PlayButton shows BUNDLE_ERROR with retry (`PlayButton.tsx:216-228`). A minecraft
   NOT_INSTALLED resets the bundle entry (`bundle/events.ts:33-35`).
10. Pause/resume/cancel: pause aborts sockets and parks the ActiveSync with a 5-minute
    idle auto-cancel (`manager.ts:120-133,465-473`); resume re-plans from disk with the
    cached remote manifest (`manager.ts:275-294`, `syncState.ts:82-92` — concern A2);
    cancel destroys sockets synchronously (`manager.ts:156-179`); `cancelAll` on dispose
    races `whenDropped` against a 250 ms timer (`manager.ts:503-521`,
    `bundle/index.ts:30-32`).

The reverse repair path also respects bundle ownership: minecraft repair loads the local
bundle manifest and filters bundle-owned paths out of `kit.repair.all`
(`repairWorkflow.ts:38-44,68-74`).

### 2e. App update (Squirrel.Windows)

1. Triggers: `UpdaterAutoCheck` on mount, window focus, and a 30-minute interval with a
   5 s dedupe and busy-state skip (`updater/events.ts:125-137,39-54`); manual check from
   Settings sets the user-initiated flag (`LauncherSection.tsx:46-49`,
   `events.ts:27-29`). Both → IPC `updater.check`.
2. Handler (`updater/index.ts:94-113`): non-Squirrel (dev / non-Windows) replies
   NOT_AVAILABLE immediately (`isSquirrelEnabled`, `index.ts:23`); in-flight checks are
   skipped (`index.ts:100-103`); otherwise `autoUpdater.checkForUpdates()`.
3. Feed URL set at init:
   `https://update.electronjs.org/loontail/minecraft-launcher/<platform>-<arch>/<version>`
   (`updater/index.ts:72-74`).
4. Squirrel events drive state (`index.ts:42-67`): checking → CHECKING;
   update-available → AVAILABLE (with placeholder `version:''` — concern E9);
   update-downloaded → READY (+ releaseName); error → ERROR. Each `broadcast`
   (`index.ts:29-33`) sends `IPC_EVENTS.updaterStatus` to the live main window.
5. Renderer: `UpdaterEventsListener` (`updater/events.ts:108-123`) writes the event into a
   zustand value store and emits session-deduped toasts (`toastFor`,
   `events.ts:61-106`); `UpdaterBadge` renders in both TopNav and the pre-shell TitleBar
   (`UpdaterBadge.tsx:12-43`).
6. READY → badge/Restart button → IPC `updater.install` → `quitAndInstall`
   (`updater/index.ts:88-92`) → before-quit drain: cancel in-flight client ops, dispose
   all 15 services via `Promise.allSettled`, dispose router, `closeDatabase`
   (`src/main/index.ts:190-222`).
7. Supply side: every push to main patch-bumps + tags via PAT
   (`release.yml:89-101`), then windows-latest runs `npm run verify` and
   `electron-builder --publish always` (`release.yml:119-134`) — note bump happens before
   verify (concern S2). After relaunch the persisted react-query cache survives the
   upgrade (constant buster, `queryPersister.ts:27` — concern S7).

---

## 3. Dependency table

Direction: row depends on column content. "kit" = `@loontail/minecraft-kit`.

| Subsystem | Depends on | Notes |
|---|---|---|
| lifecycle (`src/main/index.ts`, bootstrap/, windows/) | every service factory, infra (logger/store/session/consoleHub/notifier), ipc (router/trustedSender), config, shared/domain | Composition root; creates the single kit instance (`services/kit.ts:8`) but never calls kit APIs itself |
| ipc-contracts (`shared/ipc`, `shared/contracts`, `main/ipc`, preload) | zod, kit (types only, `satisfies`-pinned mirrors), `@loontail/yggdrasil-core` (one runtime fn, `auth.ts:7,79`), electron | Consumed by all 15 routes.ts files and the whole renderer |
| infra | electron, better-sqlite3, config (http.ts/session.ts — layering inversion L2), shared/constants+contracts+domain, kit (Logger type only) | Consumed by every service and bootstrap |
| minecraft-core | **kit (dominant)**, catalog (`resolveBuildByOpaqueId`), settings, clientOperationLocks, **bundle/manifestRepo (cycle!)**, auth (`getStoredAuth` direct), infra, yggdrasil-client/core, config | Bundle launch hook arrives via injection (`index.ts:147`) |
| bundle | **minecraft (healer → bundleHealing + buildContext — cycle!)**, clients (`getClient`), settings, clientOperationLocks, infra (http/atomicFile/throttledEmitter), config, kit (types; calls go through minecraft/bundleHealing) | Own raw node:http/https stack in download.ts, separate from infra/http |
| catalog-instances-clients | kit (instances only: versions list/resolve), settings, infra store/cache/http, shared/domain | Catalog itself never touches the kit; module singleton `setActiveCatalog` consumed only by minecraft/context |
| auth-skin | kit (OAuth/refresh/profile), yggdrasil-client/core, infra store (safeStorage split), config, **media/mediaCache (module import — only non-injected cross-service dep)** | Consumed by minecraft launch (injected account provider + direct store read) |
| app-services (app/settings/system/media/console/updater) | infra (store/cache/system/clipboard/consoleHub), shared/domain settings, electron autoUpdater/protocol/dialog | **settings/settings.ts is module-imported by minecraft, bundle, instances, system, bootstrap** — the one singleton service |
| renderer-clients (clients/minecraft/bundle/setup features) | window.api, catalog + settings features, shared contracts/domain/constants, zustand, react-query | View layer over catalog's data layer; encodes kit progress quirks (D2) |
| renderer-shell (app-shell/home/settings/auth/skin/updater/notifications/app) | window.api, catalog + clients features, shared, skinview3d (lazy), `@loontail/yggdrasil-core` (PNG validation) | No kit anywhere in renderer (grep-verified) |
| renderer-shared (app root, ui kit, lib, console window, i18n) | window.api, shared/ipc+constants+contracts, react-query+persister, zustand, i18next | Imports nothing from features — clean layering |
| tests-build | kit (real instance in one integration test), yggdrasil-*, better-sqlite3 (real), vitest/biome/electron-vite/electron-builder, GitHub Actions | Mocks `electron` wholesale; everything funnels through `npm run verify` |

Cycles / inversions to resolve in refactor waves:

1. **minecraft ⇄ bundle** — `repairWorkflow.ts:9` imports `bundle/manifestRepo`;
   `bundle/healer.ts:4-5` imports `minecraft/bundleHealing` + `minecraft/context`; the
   launch direction is correctly inverted via the injected hook (`index.ts:147-148`).
2. **infra → config** — `infra/http.ts:1` and `infra/session.ts:1` bind generic infra to
   the Strapi backend.
3. **skin → auth** (YggdrasilGateway lives under `services/auth/` but is shared infra) and
   **skin → media** (module-function import).
4. **everything → settings/settings.ts** as a module singleton, unlike the otherwise
   uniform constructor DI.

---

## 4. Consolidated concerns register

Merged across readers; duplicates collapsed (origin readers noted where two+ flagged the
same issue). Severity = highest assigned by any reader, adjusted where cross-subsystem
context raises impact.

### 4.1 Layering & boundaries

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| L1 | **high** | Bidirectional minecraft ⇄ bundle coupling with asymmetric mechanisms: bundle healer imports minecraft internals directly while the launch direction uses root-injected hooks; "which paths does the bundle own" is split across both directions with no neutral owner; `bundleHealing.ts` lives in minecraft/ but exists solely for bundle. Flagged independently by both readers (each medium ⇒ raised). Clearest seam to extract: a bundle-ownership/heal port injected like the launch hook. | `repairWorkflow.ts:9,38-44`; `bundle/healer.ts:4-5`; `minecraft/bundleHealing.ts:68-105`; `manager.ts:97`; `index.ts:147-148` |
| L2 | medium | `infra/http.ts` is Strapi-specific app code in infra: hard-binds `mainConfig.apiUrl + API_PATH_PREFIX` and the static API token; first param named `url` is actually an API path; `httpGetBinary` already bypasses it. `session.ts` computes `new URL(mainConfig.apiUrl).origin` at import time (throws on import for malformed config). | `infra/http.ts:1,41-57,145-157`; `infra/session.ts:4` |
| L3 | medium | Inconsistent singleton vs DI conventions: `settings/settings.ts` reached by module import from minecraft/bundle/instances/system/bootstrap while everything else is constructor-injected; catalog installs a process-global `setActiveCatalog` at construction, never cleared on dispose; notifier is a module-global window holder while consoleHub is deliberately injected. One convention should win. | `system/routes.ts:12`; `catalog/index.ts:36-43`; `infra/notifier.ts:5`; `index.ts:109-112,184` |
| L4 | medium | AuthSessionPort "single owner of session reads/writes" invariant is not real — only skin uses it; auth internals and minecraft launch read/write the store directly. Widen and enforce, or drop the claim. | `auth/session.ts:19-26`; `auth/verify.ts:2`; `auth/routes.ts:54`; `minecraft/launch.ts:25,304` |
| L5 | medium | `systemApi` has no home: setup feature deep-imports `features/settings/systemApi` past the barrel (which exports only `openPath`); the system IPC surface straddles the settings feature. | `setup/components/SetupPage.tsx:9`; `settings/index.ts:24` |
| L6 | low | `src/main/constants/` is a low-cohesion grab-bag: bundle download tuning, SIDECAR_DIR, HTTP status codes all belong to their consuming subsystems. | `constants/bundle.ts`; `constants/paths.ts`; `constants/http.ts` |
| L7 | low | `yggdrasilClient.ts` (shared gateway) lives under `services/auth/`, forcing skin → auth imports; skin imports `mediaCache` as bare module functions — the only non-injected cross-service dependency, invisible at the factory signature. | `auth/yggdrasilClient.ts:14-37`; `skin/index.ts:4,13-18`; `skin/skin.ts:11-12` |
| L8 | low | Renderer-only (`queryKeys.ts`) and main-only (`progress.ts`) constants cohabit `shared/constants` behind one barrel, blurring the cross-process contract surface. | `shared/constants/index.ts` |
| L9 | low | History "service" is an anemic 3-line read facade; the domain is spread across infra/store (storage), minecraft (write call), and this shell. Consolidation candidate. | `history/history.ts:3`; `minecraft/launch.ts:409`; `store.ts:404-413` |
| L10 | low | Migration version registries live in three files with only a runtime gap-throw keeping them in sync (settings `CURRENT_SCHEMA_VERSION` vs `MIGRATIONS` vs DB layout version). | `shared/constants/storeKeys.ts:14`; `store.ts:110-129`; `db/schema.ts:7,51` |

### 4.2 Duplication

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| D1 | medium | Duplicate catalog surfaces kept mid-migration: `clients.list` AND `catalog.list` channels, parallel routes and QUERY_KEYS; `OfficialCatalogItem.raw` carries the whole Strapi Client "for legacy paths", doubling every catalog payload. The `clients.list` route has **zero renderer callers** (renderer uses `catalog.list`) — route, contract entry, and possibly the ClientsService shell are deletable. (ipc-contracts + catalog readers.) | `shared/ipc/contract.ts:72-73`; `shared/contracts/catalog.ts:86-88`; `clients/routes.ts:13-18`; `shared/constants/queryKeys.ts:8-13` |
| D2 | medium | Renderer reverse-engineers the kit progress contract in three places: stage-byte reconstruction (mixed-scale bytes), renderer-side rolling speed (no throughput signal from kit install events), and monotonic-percent latching (regressing percents). Normalizing progress once in the main process would delete ~100 lines of compensating view logic. | `installSteps.ts:137-149`; `useByteSpeed.ts:14-61`; `progressFormat.ts` |
| D3 | medium | Loader-ambiguity rule ("both Forge and Fabric ⇒ ask") encoded three ways: canonical `resolveLoader` in shared/domain, hand-rolled boolean in PlayButton, re-encoded `canSwitchLoader` in ClientLoaderSection. Will drift if NeoForge is added. | `shared/domain/loader.ts`; `PlayButton.tsx:164-171`; `ClientLoaderSection.tsx:82` |
| D4 | medium | Settings validation triplicated: zod schemas, the 103-line imperative `normalizeLauncherSettings` (its own comment admits it can emit a value failing the schema it feeds), and the override compaction/diff logic. A schema-driven normalizer (zod `.catch()`/`.default()`) collapses the first two. | `shared/contracts/settings.ts:22-67`; `settingsNormalization.ts:10-12,64-103`; `settingsOverrides.ts`; `settingsResolution.ts` |
| D5 | medium | Two parallel title-bar implementations: pre-shell `TitleBar` re-implements TopNav's AlphaTag/tooltip/badge cluster with subtly different classes; drift unchecked. | `TitleBar.tsx:27-37`; `TopNav.tsx:16-31` |
| D6 | medium | UI kit straddles two design-token vocabularies (Direction C tokens vs legacy shadcn tokens), sometimes within one file — unfinished palette migration; theming requires touching both. | `Button.tsx:13-20`; `Input.tsx:13`; `Tabs.tsx:19,35`; `SettingsGroup.tsx:36`; `Switch.tsx:44`; `CopyButton.tsx:63-69` |
| D7 | medium | Test scaffolding copy-paste: ~50-line hoisted mock blocks repeated across 5 BundleManager and 5 MinecraftManager test files; identical `createTestRouter`+`captureThrow` fakes in 6+ files (comments admit divergence from the real router); env-var seeding via `vi.hoisted` repeated ~15× because there is no vitest setupFiles (root cause: `@main/config` asserts env at import time). | `managerPauseCleanup.test.ts:10-217`; `managerLaunch.test.ts:18-148`; `bundle/routes.test.ts:18-33`; `vitest.config.ts` |
| D8 | low | Bundle progress event shape duplicated (`maybeEmit` hand-builds what `makeProgressEvent` defaults) and semantically overloaded during HEALING (stale download byte totals leak into heal events; `task.currentFile` is one slot shared by 16 workers). | `runner.ts:77-95`; `manager.ts:52-70`; `healProgress.ts:29-35` |
| D9 | low | Small duplications: two `formatBytes` impls (Settings vs install progress); byte-identical copyText handlers (deliberate trust-boundary split — share the impl); copied-flash feedback re-implemented in console; `errorMessage` helper re-implemented inside infra (`store.ts`, `legacyImport.ts`) despite `infra/errorMessage.ts`; two same-named `SectionLabel` components; hand-rolled concurrency limiter in `system.ts` vs bundle's worker pool; two/three enum idioms in shared/contracts. | `settings/lib/formatBytes.ts`; `progressFormat.ts:3`; `system/routes.ts:65-68`; `console/index.ts:37-40`; `console/App.tsx:22-58`; `store.ts:186-188`; `legacyImport.ts:28-30`; `BuildOverview.tsx:22-29`; `BuildSection.tsx:3-7`; `system.ts:72-94`; `contracts/console.ts:3-19`; `contracts/notification.ts:12-18` |

### 4.3 Error handling

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| E1 | **high** | `classifyBundleError` checks `signal.aborted` BEFORE `err instanceof BundleError`, but the runner deliberately aborts siblings on any worker failure — so every download-phase failure (DOWNLOAD_FAILED, DOWNLOAD_INTEGRITY_FAILED, UNSAFE_PATH) reaches the renderer as ABORTED, defeating the explicitly documented intent and any code-specific retry UX. Fix: swap the two checks. | `bundle/errors.ts:13-16`; `runner.ts:96,121-143`; `manager.ts:343` |
| E2 | medium | Split error transport for bundle sync: pre-flight failures reject the `bundle.start` invoke, in-flight failures are swallowed and surface only as broadcast events while the invoke resolves OK; renderer must handle two failure channels for one operation; `forLaunch` callers get rejection semantics, others fire-and-forget. | `bundle/manager.ts:138-141,232-237,342-355,427-430` |
| E3 | medium | Renderer pervasively discards `mutateAsync` promises (`void`, no `.catch`): a rejected invoke (e.g. OP_IN_FLIGHT thrown before any error event) is an unhandled rejection with zero user feedback. A shared safe-fire helper would close it consistently. | `PlayButton.tsx:220,233,253,278,287,296`; `ProgressControls.tsx:23-33`; `BuildSettingsTab.tsx:104,201,227` |
| E4 | medium | Non-critical bootstrap chores are fatal to startup: `seedLauncherSettings`'s `ensureDirectory(clientsFolder)` (unplugged drive) or any single peripheral service `init()` rejection kills the whole launcher with an error box; no per-service isolation or degraded mode. | `index.ts:153-170,227-231`; `seed.ts:20` |
| E5 | low | `wrapForTransport` JSON.stringify of the IpcError runs inside the catch; circular/BigInt details (kitContext, raw dev error) escape the router's own error handling and degrade to Electron's opaque rejection. | `router.ts:58-59`; `toIpcError.ts:39-40,65-71` |
| E6 | low | `DiskInfo` is all-optional with an in-band `error: boolean` instead of structured errors — `{}` is valid; inconsistent with house style (`LoginResult` discriminated union). | `shared/contracts/system.ts:3-9` |
| E7 | low | `setStoredAuth` failure surfaces asymmetrically: Mojang route catches into `LoginResult{ok:false}`, Yggdrasil route propagates as transport IpcError — two failure shapes for one root cause. | `auth/routes.ts:35-38` vs `52-58`; `store.ts:356-359` |
| E8 | low | SetupPage finish: `await` on the void-returning `mutate`, no failure surface — persistence errors silently dropped. | `SetupPage.tsx:20,47-50` |
| E9 | low | Updater AVAILABLE event carries placeholder `version:''` against a required-string contract; DOWNLOADING state is contract surface with no producer. | `updater/index.ts:50-54`; `contracts/updater.ts:18-20` |
| E10 | low | Broad `TypeError → NetworkError` heuristic in Mojang sign-in mapping masks programming bugs as connectivity problems. | `auth/routes.ts:25` |
| E11 | low | `clearSkin` partial failure (`Promise.all`) skips both cache invalidations and reports total failure while one slot was cleared server-side — `allSettled` + per-slot invalidation. | `skin.ts:241-251` |
| E12 | low | `endLaunch` failure path can double-report a clean exit as CRASHED (re-invokes endLaunch with the internal error, emits a second endSession). | `launch.ts:393-402` |

### 4.4 Async & races

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| A1 | **high** | `startInstall` leaves the slug unclaimed while `buildContext` awaits: requireIdle passes for a concurrent `startLaunch` (which acquires no ClientOperationLock, so the lock doesn't protect it either); both flows then `ops.set` over each other, breaking the one-op-per-slug invariant (cancel/pause target the wrong op; launch can spawn against a half-installed folder). startRepair and startLaunch both register their op before the await to close exactly this hole — startInstall does not. Cancel during install planning is also a silent no-op. | `manager.ts:126-133,219-222,259-267`; `install.ts:30`; `launch.ts:301` |
| A2 | **high** | Pause during manifest fetch + resume **deletes the entire installed bundle**: `ActiveSync.remoteManifest` starts as `{}` and is only assigned after a successful fetch; pause during FETCHING_MANIFEST parks the sync; resume re-plans against the empty manifest ⇒ `toDelete` = every local file, delete phase runs, heal runs, empty manifest persisted with hash ''. Destructive behavior reachable from plain pause/resume; guard `continuePausedSync` (refetch when remoteManifestHash empty). | `syncState.ts:68`; `manager.ts:263,275-294,349-351,375-388`; `plan.ts:125-132` |
| A3 | medium | Post-install / post-repair bundle sync runs with **no op registered**: not cancellable, `getStatus` reports idle while bytes download, and `cancelAll` at shutdown cannot abort it — contradicting cancelAll's own rationale that in-flight sockets block Electron quit. | `manager.ts:155-164,313-316,377-384` |
| A4 | medium | Cancel issued during `startLaunch`'s buildContext window is dropped: the LAUNCH_STARTING AbortController is aborted but never checked after the await; BUNDLE_SYNCING and runLaunch create fresh controllers — a Stop click while resolving the target launches the game anyway. | `manager.ts:266-272,283`; `launch.ts:292-295` |
| A5 | medium | `buildPlan` ignores the abort signal (force mode re-hashes the whole bundle uncancellably) and a cancel during planning can complete as UP_TO_DATE — a cancelled forLaunch sync can let the launch proceed instead of surfacing CANCELLED. | `plan.ts:26-33,47-145`; `manager.ts:309,317-320` |
| A6 | medium | Renderer load races serial service init: `createMainWindow()` starts loading before any `init()` registers IPC routes (registration happens inside init, awaited serially); a fast renderer (dev HMR) can invoke a channel whose handler registers later. Defer window load or register routes synchronously in factories. | `index.ts:106,153-167`; `services/app/index.ts:10-12`; `mainWindow.ts:75-80` |
| A7 | medium | Unserialized session-store writes: logout racing a slow `auth.me` resurrects the cleared session; a skin upload's `updateMojangProfile` persists a pre-rotation session capture wholesale, clobbering rotated tokens (forced re-login later). Also every `auth.me` re-encrypts and rewrites an unchanged session (needless safeStorage round-trip, low). | `verify.ts:44,65,79`; `auth.ts:62-63`; `session.ts:30-34`; `skin.ts:229`; `mojangAuth.ts:161-164` |
| A8 | medium | Instance mutations unserialized (no clientOperationLocks): update racing delete can resurrect the instance (save mkdirs the removed dir, upsert re-adds the registry row); the load→merge→save window in updateInstance is unguarded. | `instances/routes.ts:20-41`; `instanceRepo.ts:39`; `create.ts:122-138` |
| A9 | medium | Deleted instances resurrect via startup reconcile: registry entry removed first, then `fs.rm`; a Windows EBUSY leaves the surviving instance.json to be re-adopted by the next reconcile sweep — no tombstone, the rationale conflicts with rediscovery. | `create.ts:150-154`; `reconcile.ts:48-54` |
| A10 | medium | Updater `inFlight` flag can wedge permanently: no timeout, no manual reset; a Squirrel stall short-circuits all future checks until restart. | `updater/index.ts:39-62,100-103` |
| A11 | medium | `drain()` has no timeout — a hung dispose (child process ignoring kill) wedges quit forever and the DB never closes; bound with a watchdog race. | `index.ts:195-222` |
| A12 | medium | Settings migration writes are non-atomic (settings write then version stamp, separate statements; import-then-migrate has no overarching transaction) — currently benign (only migration is identity) but any future non-idempotent step double-applies on crash. | `store.ts:143-159,174-182` |
| A13 | medium | Home carousel selects by array index over a self-reordering list (lastPlayed refetch on focus + invalidation on RUNNING) — the featured hero silently swaps builds; key by CatalogKey. | `HomePage.tsx:37,52`; `useRecentBuilds.ts:17-24` |
| A14 | low | No operation lock held while the game runs: install/repair/uninstall lock, launch does not; other lock-domain writers cannot see the LAUNCH op. Make the asymmetry explicit. | `manager.ts:259-306` |
| A15 | low | `statusSeeder.reset()` corrupts concurrency accounting if fetches are in flight (activeCount goes negative) — test-only today, latent trap for logout teardown. | `statusSeeder.ts:40-43,55-59` |
| A16 | low | Inconsistent bundle freshness: `getInstallState` does a network round-trip per IPC call (no TTL) while resume reuses a manifest cached up to 5 minutes without revalidation; official build resolve refetches the entire clients list per launch and ignores locale. | `bundle/manager.ts:207,284`; `strapiSource.ts:21-27`; `clients.ts:13-14` |
| A17 | low | ENOENT deletes skip `processedFiles` so bundle progress can never reach 100% after pause→resume re-plans. | `runner.ts:195-201`; `manager.ts:315` |
| A18 | low | ConsoleHub batched flush loses ≤50 ms of lines on hard crash; lines ingested with no window attached and evicted past 10 000 are silently dropped (droppedCount only via getInitial); single timestamp per chunk discards log4j per-event timestamps. | `consoleHub.ts:132-150,260-265`; `consoleBuffer.ts:33-38,65-71`; `log4jStream.ts:24` |

### 4.5 God files / hotspots

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| G1 | medium | Hand-maintained triple service registry in the composition root: 15 constructions + 15 serial inits + 15 dispose entries must stay in sync across three lists; forgetting one silently leaks or skips routes. Collapse to one ordered `{init, dispose}` array. | `index.ts:121-151,153-167,195-211` |
| G2 | medium | `useConsoleStream` (211 LOC) concentrates five responsibilities (snapshot, push+microtask batching, pause buffering, ring trim, reconcile poll) behind four mutually-dependent refs — the subtlest async state in the renderer, with zero unit tests under tests/renderer/console/. | `useConsoleStream.ts` |
| G3 | low | `store.ts` (413 LOC) is a four-domain facade (auth crypto/migration ~180 lines, settings migrations, instance registry, lastPlayed) sharing only `getDb()` — the natural bloat point for persisted domains. | `store.ts:102-413` |
| G4 | low | `PlayButton.tsx` (337 LOC) is the renderer convergence point: pure state machine + loader orchestration + six render branches + error surface, importing from four features. Split action renderers from selection/orchestration. | `PlayButton.tsx:81-336` |
| G5 | low | `settings/hooks.ts` (168 LOC) mixes launcher CRUD, overrides, pickers, RAM, disk/folder queries, media cache across three api files, while a sibling `hooks/` dir holds `useRamPending` — `./hooks` and `./hooks/useRamPending` coexist. | `settings/hooks.ts:40-168` |

### 4.6 Dead code & stale docs

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| X1 | medium | `BundleManager.resetForUninstall` is dead code with a comment claiming MinecraftManager.uninstall calls it (zero callers repo-wide); an uninstall leaving residual files also leaves a stale `.loontail/bundle.json`. Wire it in or remove it. | `bundle/manager.ts:523-529`; `minecraft/uninstall.ts` |
| X2 | medium | Local remote-bundle path is schema-supported but unwired: `InstanceBundleRefSchema` 'remote' variant has no producer and the launch hook unconditionally skips ALL local builds; `InstanceOriginSchema` reserved; presentation icon/screenshots/servers projected but with no mutation path. Either latent feature with contradicting gate, or dead forward-looking surface. | `contracts/instance.ts:14-21,49-54,114-122`; `localSource.ts:34,43-52`; `minecraft/manager.ts:104-106` |
| X3 | low | Stale-comment cluster (misleading inputs to redesign): vestigial `InstallOp.fresh` flag + comments describing a removed implicit-install-on-launch flow; catalog singleton's claimed consumers wrong (bundle never imports it); auth verify comments contradict actual offline-skin behavior and the textures-token note; media dispose comment claims nothing to release while protocol.handle is never unhandled. | `minecraft/manager.ts:48-51`; `ops.ts:21-28`; `install.ts:67-69`; `catalog.ts:67-70`; `verify.ts:54-56`; `contracts/auth.ts:86-96`; `media/index.ts:17` |
| X4 | low | Renderer dead/over-exported code: `BuildSection` component unused (only SectionLabel imported); `tone`/TONE_BY_STATUS computed but unconsumed; `install/index.ts` barrel over-exports; `bundle/statusSeeder.ts` re-export alias used only by a test; `TopNav` barrel export unused. | `BuildSection.tsx:11-16`; `buildStatus.ts:3,22-33`; `install/index.ts`; `bundle/statusSeeder.ts:4-5`; `app-shell/index.ts:3` |
| X5 | low | `uninstall` clears the forge processor cache for **all** clients (no per-target eviction) and `clearTargetInstallManifest` on the success path is a guaranteed no-op (sidecar lives inside the removed folder). | `uninstall.ts:36-38,53`; `forgeProcessorHealing.ts:30-75`; `installManifest.ts:63-64` |

### 4.7 Type safety

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| T1 | **high** | ClientSlug brand erosion on the hottest channels: all `minecraft.*` / `bundle.*` channels type args as ClientSlug but local builds smuggle InstanceId UUIDs through them via `as unknown as ClientSlug` (renderer `operationalId`, main `create.ts`); `ClientSlugSchema` is just `z.string().min(1)` so validation can't distinguish keyspaces; settings overrides, op locks, bundle sync, and IPC events all key on the punned id. CatalogKey exists precisely for cross-kind keying but the IPC surface never adopted it. Central migration seam — retype these channels to CatalogKey/CatalogRef. (Flagged by ipc-contracts high + catalog medium.) | `shared/ipc/contract.ts:85-97`; `renderer/features/catalog/buildIdentity.ts:9-10`; `catalog.ts:84-93`; `create.ts:41`; `ids.ts:13-15,24-27` |
| T2 | medium | Router Handler signature claims validated args before validation happens (`rawArgs as IpcArgs<T>`): safety depends on each routes.ts remembering `parseIpcArgs`; the type system hides the obligation. Type handler input as `unknown` or bake per-channel schemas into `router.handle`. | `router.ts:15-18,77` |
| T3 | medium | Event push path type-checked only by convention: all event zod schemas are never executed (z.infer-only); sends are hand-paired `webContents.send(IPC_EVENTS.x, payload)` with no typed `emit<TEvent>` helper — a mismatched payload compiles fine. Either drop zod weight or add a typed emitter. | `contracts/minecraft.ts:58-85`; `contracts/bundle.ts:92-122`; `minecraft/broadcast.ts:12-28`; `infra/notifier.ts:18` |
| T4 | low | `updateInstance` builds the merged manifest with plain spreads and skips `InstanceManifestSchema` re-validation (create path parses) — future patch fields bypass manifest invariants. | `create.ts:90,127-135` |
| T5 | low | ServersInfo pairs request/response by array index — an implicit, unvalidated ordering contract over IPC; return keyed results. Related: server ping route has unbounded fan-out and IPv6-hostile `host:port` split. | `ServersInfo.tsx:52-55`; `servers.ts:18-23,76-79` |
| T6 | low | Bundle store forces `installed:true`/`signatureMatches:true` on NO_BUNDLE; harmless only because every consumer gates on `hasBundle` first — an implicit invariant a future consumer will break. | `bundle/store.ts:40-59`; `PlayButton.tsx:95-113`; `installSteps.ts:166` |

### 4.8 Lifecycle & windows

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| W1 | **high** | Lifecycle conflates "any window" with "the main window" once the console window exists: second-instance focuses `getAllWindows()[0]` (may focus the console); window-all-closed counts the console, so on Windows/Linux closing the main window with the console open leaves the app running with no UI path back (activate is macOS-only) and `getMainWindow()` returns a destroyed window to every injected consumer; macOS activate only recreates when zero windows exist, so a lingering console blocks recreation. | `index.ts:85-91,172-186`; `notifier.ts:15` |
| W2 | low | Console window runs `sandbox:false` (documented contextBridge-push workaround with compensating controls: contextIsolation, deny-all window.open, nav guards, 4-channel allowlist) — standing posture reduction; revisit when the Electron bug is fixed. | `consoleWindow.ts:26-36,52-55` |

### 4.9 Renderer state & UX correctness

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| U1 | medium | Nested modals: every open Modal registers its own window keydown listener; Escape closes both the stacked confirm and the underlying modal in one keypress, and both focus traps fight over Tab — despite the scroll-lock ref counting explicitly supporting nesting. Needs topmost-modal ownership. | `Modal.tsx:9-26,72-103` |
| U2 | medium | Settings staleness window papered over with 5-minute polling: main-side writes (e.g. runtime path stored after install) bypass the renderer cache; no settings-changed push event although the push pattern exists for updater/notifications. | `settings/hooks.ts:22-25` |
| U3 | medium | Module-level mutable singletons in updater/events.ts (`lastAutoCheckAt`, `userInitiatedCheck`): behavior depends on import-graph identity, breaks on double-mount, flag never cleared if a check stalls. | `updater/events.ts:17,21,27-29` |
| U4 | low | Login error state split across two hooks with manual cross-clearing and hard-coded display precedence — forgetting a clearError shows a stale error from the wrong flow; useMojangLogin's pending state is component-local while the flow is main-global (unmount fires cancel unconditionally). | `auth/hooks.ts:46,86-95`; `LoginForm.tsx:30,36,111` |
| U5 | low | Console window i18n: live language switch never reaches an open console (no storage event / IPC broadcast); console search matches raw `line.message` while coded lines render translated text and skip highlighting. | `i18n/index.ts:31-34`; `useConsoleSearch.ts:13`; `ConsoleLogBody.tsx:60-68` |
| U6 | low | TopNav h-12 height hard-coded across four files (pt-12/pt-14 compensations) with no shared constant; ineffective `handleClear` memoization in console/App (fresh stream object per render). | `TopNav.tsx:172`; `AppShell.tsx:74`; `HomeHero.tsx:39`; `console/App.tsx:40-42` |

### 4.10 Security, build & CI

| ID | Sev | Concern | Anchors |
|---|---|---|---|
| S1 | medium | `API_TOKEN` is baked into the distributed main bundle at build time (`define()`), shipped inside the published installer's asar — extractable by any user; also injected into PR builds. | `electron.vite.config.ts:14`; `release.yml:122,131`; `src/main/config.ts` |
| S2 | medium | Release pipeline bumps version and pushes the tag **before** verify runs on the tag: a Windows verify failure leaves a bump + artifact-less tag on main and version gaps; every non-release push to main auto-releases with no intent gating. | `release.yml:89-101,119-125` |
| S3 | medium | PR CI is Linux-only while the product ships Windows-first; platform-conditional code paths (8.3 short paths, drive-letter branches) are first verified post-merge on the release runner. | `ci.yml:10`; `release.yml:105`; `uninstall.test.ts:50-57` |
| S4 | medium | Coverage holes: zero tests for the preload bridge, bootstrap, window creation, infra/http, and the app/clients/console/history/media/servers/updater handlers (only registration counts); renderer testing is selectors + two static-markup snapshots; vitest include is `.ts` only so `.tsx` tests are impossible; no coverage instrumentation or thresholds anywhere; the screenshot harness is manual. | `vitest.config.ts:14`; `contractCoverage.test.ts` |
| S5 | low | `lint:i18n` and `lint:strapi` drift checks exist but are not in `verify` or CI; the i18n checker greps ALL src so any string coincidence marks a key used. | `package.json:29-30,35`; `lintI18n.mjs:93-99` |
| S6 | low | Inconsistent path hardening: `system.openPath` is allowlisted to launcher-owned roots but `getDiskSpace`/`getFolderSize` accept any renderer-supplied absolute path (probe existence/size of arbitrary dirs). | `system/routes.ts:20-46`; `infra/system.ts:177-208` |
| S7 | low | Cache freshness traps: `cache://` serves immutable-1-year with SHA-1-of-URL keys and no TTL (in-place asset changes frozen until full cache clear); react-query persist buster never changes across releases (old payload shapes rehydrate into new code); media body/mime sidecar written non-atomically and evicted independently (orphan sidecars). | `media/protocol.ts:47`; `mediaCache.ts:78-79`; `queryPersister.ts:27`; `infra/cache.ts:109-128` |
| S8 | low | Import-time side effects force test workarounds and fragile module evaluation: `@main/config` throws on import for missing env; `session.ts` parses apiUrl at import; PlayButton's import chain touches localStorage at module scope; tests build paths from `process.cwd()`. | `config.ts:7-22`; `session.ts:4`; `playButtonState.test.ts:3-13`; `trustedSender.test.ts:16` |
| S9 | **high** | White-box tests duplicate BundleManager/MinecraftManager private internals: `as unknown as` casts seed private `activeSyncs`/`ops`, a hand-copied `ActiveSyncShape` mirrors the private record across 3+ files — refactoring the sync state machine silently desynchronizes fixtures and tsc can't catch it. The pause/resume/cancel machine is only testable by poking privates: the manager needs an injectable sync-state seam **before** refactor waves touch it. | `managerPauseCleanup.test.ts:77-194`; `managerResumeCleanup.test.ts:60-116`; `managerCancel.test.ts:38-40`; `managerStatus.test.ts:137-138` |
| S10 | low | `writeSettings` full-table-rewrites all client_overrides per save and `replaceInstanceEntries` does the same for instances — O(all rows) per field change; a normalization bug can drop overrides wholesale. | `repos.ts:71-95,138-149` |

---

## 5. What is already good — do not break in refactor waves

**Composition & DI.** A single composition root with explicit constructor injection and no
module singletons (with the noted exceptions L3); exactly one process-wide MinecraftKit
shared by auth/skin/instances/minecraft/bundle so metadata caches are shared
(`services/kit.ts:8`, `index.ts:118`); the bundle→launch integration is correctly inverted
via a hook injected at the root (`index.ts:147-148`) — extend this pattern, don't regress
to direct imports.

**IPC discipline.** One declarative contract map with two-way compile-time coverage guards
(`channels.ts:75-110`) plus a runtime contract-coverage test
(`tests/main/ipc/contractCoverage.test.ts`); error transport solved exactly once
(toIpcError → sentinel → preload rehydration) with path-leak prevention for errno errors;
trusted-sender pinning per window with the unsandboxed console window confined to a
deny-by-default 4-channel allowlist; zod validation at every route boundary via
`parseIpcArgs`. Kit types are mirrored into shared/ with `satisfies` pins and compile-time
shape guards (`contracts/auth.ts:36-44`) precisely so kit runtime never reaches the
renderer — grep-verified zero kit imports in `src/renderer`.

**Offline-first design.** Durable sidecar install manifests make open-time status fully
offline (no network, no hashing — `readinessPolicy.ts`); `cachedFetch` disk snapshots keep
the catalog alive without the CMS; per-source health flags degrade the UI instead of
blanking it (`catalog.ts:50-53`); bundle `getInstallState` deliberately reports
`signatureMatches:true` on network failure so connectivity never gates Play.

**Security guards worth preserving.** Path traversal rejection before every destructive
fs op (`resolveSafeEntryPath`, `isUnderClientsRoot` — explicitly the only barrier before
recursive rm, with P0 tests); bundle redirect/origin/HTTPS download policy
(`urlPolicy.ts`); the Microsoft authorize-URL allowlist before `shell.openExternal`
(`mojangAuth.ts:88-109`); markdown sanitizer with protocol+host allowlists; `cache://`
SSRF guard; CSP/session hardening with deny-all permissions; navigation guards + per-entry
URL allowlists on both windows; auth tokens split into safeStorage-encrypted blobs with
plaintext metadata, migrated deterministically.

**Deliberate, documented tradeoffs.** Console window `sandbox:false` +
`backgroundThrottling:false` are documented workarounds with compensating controls;
`queueMicrotask` instead of RAF (occluded-window throttling) and the 1 s reconcile poll in
the console stream; the bundle-owned-path repair filter in both directions (repair never
reverts bundle files, heal never re-downloads them); rm-then-rename "atomic-ish" writes
documented as Windows workarounds; the two-tier migration system (physical DB layout vs
logical settings shape) is intentionally split; explicit init order
clients → instances → catalog so the aggregator can compose sources.

**Pure-logic extraction.** Cross-process business rules live in `shared/domain` (settings
normalization/overrides/resolution, loader resolution, recent selection) and renderer
decision logic is React-free and unit-tested (`selectPlayButtonAction`,
`selectInstallProgress`, `buildStatus`, toast `stackLayout`); the kit→launcher error-code
map is enumerated as a drift detector; Strapi/i18n drift checkers exist (gate them — S5 —
but keep them).

**Operational conventions.** Throttled progress emission (100 ms) is the standard on every
progress path; broadcasters re-resolve the live window per send (window-recreation safe);
status seeding is deduped and concurrency-capped with live-events-win semantics; the
before-quit drain cancels in-flight client operations before disposal and closes the DB
last.
