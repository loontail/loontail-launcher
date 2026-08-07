# Architecture — @loontail/minecraft-launcher

High-level architectural map of the launcher. Code-style rules live in
[`code-guideline.md`](./code-guideline.md); UI / design-system rules live in
[`ui-guideline.md`](./ui-guideline.md). This document focuses on **what
goes where and why**.

No line numbers appear in this file on purpose: a `file:line` anchor rots on the
next unrelated edit to the target file, silently. Anchors are `file` + a
backticked symbol name, which stays greppable.

---

## 1. Overview

The launcher is an **Electron desktop application** that downloads and
launches Minecraft clients ("builds") — either official ones served by the
Loontail Rust API, or local builds the user creates. It exposes one UI window
plus an optional game-console window, runs all OS and network work in the main
process, and ships dark-only.

Core responsibilities:

- Aggregate a catalog of official + local builds.
- Install, verify, repair and update builds via `@loontail/minecraft-kit`.
- Keep a modpack overlay ("bundle") in sync on top of an installed build.
- Persist launcher settings and per-build overrides.
- Launch Minecraft with the right arguments, JVM options and account.
- Auto-update the launcher itself.

Non-goals (by design):

- No web/browser deployment.
- No Minecraft mod management UI.
- No multi-account orchestration.
- No light theme or theme switching.

## 2. Process model

```
┌────────────────────────────────────────────────────────────────┐
│                       Electron application                     │
│                                                                │
│  ┌─────────────┐  contextBridge  ┌──────────────────────────┐  │
│  │   preload   │ ──────────────► │        renderer          │  │
│  │  (sandbox)  │   window.api    │  React 19 + TanStack     │  │
│  └─────────────┘                 │  Query + Zustand         │  │
│        ▲                         │  + own Tailwind v4 UI kit│  │
│        │ typed IPC (channels + events)                      │  │
│        ▼                         └──────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                         main                           │    │
│  │   Node runtime · OS · fs · http · child processes      │    │
│  │   ┌───────────────┐  ┌──────────────┐  ┌────────────┐  │    │
│  │   │   services    │  │     ipc      │  │   infra    │  │    │
│  │   │  (domain)     │  │  (router)    │  │ fs/http/db │  │    │
│  │   └───────────────┘  └──────────────┘  └────────────┘  │    │
│  └────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
                     ▲                              ▲
                     │ HTTP(S) (Zod-validated)      │ kit Spawner
                     ▼                              ▼
              ┌──────────────┐               ┌─────────────┐
              │   Loontail   │               │  Minecraft  │
              │     API      │               │   client    │
              └──────────────┘               └─────────────┘
```

A second renderer entry (`console.html`) runs the game-console window as its own
React root. It is the only window with `sandbox: false` (a documented
contextBridge-push workaround) and is confined to a deny-by-default four-channel
IPC allowlist.

**Hard rules:**

- `renderer` never imports from `main`.
- `main` never imports from `renderer`.
- `shared` is platform-agnostic — no Node, DOM, Electron, or React imports.

These are conventions plus tsconfig path separation; there is no Biome rule
enforcing them today (see code-guideline §3).

## 3. Modules

### 3.1 `shared/`

Platform-agnostic code reachable from both processes.

- `shared/contracts/` — types and Zod schemas for external data shapes
  (API responses, bundle manifests, branded ids, error codes).
- `shared/ipc/` — IPC contract: a single `IpcContract` map
  (`channel → { args, result }`) and an `IpcEventPayloads` map for
  main→renderer events, plus `channels.ts` name registries with compile-time
  two-way coverage guards.
- `shared/domain/` — pure logic that has no I/O dependencies:
  `resolveClientSettings` and the rest of the settings
  resolve/override/normalize/migrate family, `resolveLoader`, `selectRecent`.
  Trivially unit-testable.
- `shared/constants/` — cross-layer constants: app-wide limits, API route
  builders, store key names, error code enums, progress throttle.
- `shared/lib/` — tiny process-agnostic helpers (`limiter`, `speedWindow`).
- `shared/yggdrasil/` — UUID/PNG/error helpers mirrored from the Yggdrasil
  packages so the renderer can use them without a Node dependency.

### 3.2 `main/`

Node-side. Owns fs, network, OS, and child processes. The only place
business logic that touches the outside world is allowed to live.

- `main/index.ts` — the single composition root. Squirrel guard,
  single-instance lock, privileged `cache://` scheme, explicit constructor DI,
  ordered service init, `before-quit` drain.
- `main/ipc/` — typed IPC router. Wraps `ipcMain.handle` with Zod validation of
  arguments (`parseArgs`), sender-frame pinning (`trustedSender`) and structured
  error transport (`toIpcError`).
- `main/services/<name>/` — one folder per domain capability:
  - `<name>.ts` — core logic.
  - `routes.ts` — IPC routes (thin wrappers over the core).
  - `index.ts` — present only for a capability that owns state or teardown, and
    then it exports the `{ init, dispose }` service (see §5).
  Two folders under `services/` are neither: `clients/` (an API-fetch module used
  by catalog and bundle) and `yggdrasil/` (a shared gateway).
- `main/infra/` — low-level integrations:
  - `http.ts` — API-bound fetch wrapper with Zod-validated responses.
  - `store.ts` — persistence facade (validation, auth secret split,
    settings migrations) over the SQLite layer in `infra/db/`.
  - `db/` — `better-sqlite3` connection, schema, repositories, and the
    one-time import from the legacy `electron-store` layout.
  - `consoleHub.ts` + `log4jStream.ts` + `consoleBuffer.ts` — game log
    ingestion, parsing and the bounded ring buffer.
  - `cache.ts`, `atomicFile.ts`, `throttledEmitter.ts`, `broadcaster.ts`,
    `originPolicy.ts`, `session.ts`, `system.ts`, `logger.ts`, `notifier.ts`.
- `main/windows/` — `BrowserWindow` creation and navigation hardening
  (`mainWindow`, `consoleWindow`, `secureWindow`, `rendererLocations`).

### 3.3 `preload/`

Thin bridge. Only proxies IPC and exposes a typed `window.api`.

- `preload/index.ts` — `contextBridge.exposeInMainWorld('api', …)` that
  takes the `IpcContract` from `shared/ipc/` and produces a typed
  `invoke(channel, args)` / `on(event, callback)` API.
- No business logic.
- No raw `ipcRenderer` or `electron` exposed to the renderer.

### 3.4 `renderer/`

UI process. Knows nothing about Node, fs, or sockets — only about
`window.api`. It never imports `@loontail/minecraft-kit` (grep-verified).

- `renderer/app/` — router, root layout, top-level providers
  (`QueryClient` + persister, error boundary).
- `renderer/features/<name>/` — feature folders. Each owns:
  - `api.ts` — wrappers over `window.api.<feature>.*`.
  - `hooks.ts` — feature-specific hooks backed by TanStack Query.
  - `components/` — UI of the feature.
  - `index.ts` — the only file other parts of the app may import from.
- `renderer/shared/ui/` — the project's own UI primitives (`Button`, `Modal`,
  `Tabs`, `Switch`, `Slider`, …). Hand-written and hand-owned; there is no
  component library underneath (see ui-guideline §1).
- `renderer/shared/lib/` — non-UI helpers used across features
  (formatters, small hooks, Zustand store factories, query persister).

## 4. IPC contract

Single source of truth: `src/shared/ipc/contract.ts` — an `IpcContract` map of
invoke channels (`channel → { args, result }`) and an `IpcEventPayloads` map of
main→renderer events. Read the file; it is short, exhaustive and typed, and any
excerpt copied into this document would drift.

`src/shared/ipc/channels.ts` holds the runtime name registries and compile-time
guards that fail the build if a channel exists in one place and not the other.
`tests/main/ipc/contractCoverage.test.ts` asserts at runtime that every declared
channel has a registered handler.

Preload exposes `window.api.invoke<K>(channel, args)` and
`window.api.on<E>(event, cb)`, both fully typed from the contract.

Main side: a small router wraps `ipcMain.handle`, checks the sender frame against
a per-window allowlist, dispatches to the service, and converts thrown errors
into a structured `IpcError` carried over a sentinel-tagged message that preload
rehydrates. Argument validation is **per-route**: each `routes.ts` calls
`parseIpcArgs` with the channel's Zod schema. The router's handler type does not
enforce that call — adding a route means remembering it.

## 5. Main-process capabilities

`main/index.ts` wires two kinds of capability, and the distinction is the point:

**Stateless route registration** — a plain function call, no lifecycle, no
teardown, no ordering constraint. Used by every capability that owns no state
and needs no disposal: `app` (version + notification channel), `system` (RAM
range, disk space, folder pick, OS path open, clipboard), `settings`
(`launcherSettings` CRUD + per-build overrides), `servers` (SLP ping), `history`
(last-played read facade), `media` (`cache://` protocol + routes). Do not give
one of these an `init`/`dispose` shell just for symmetry.

**Lifecycle services** — only modules that own state or need teardown:

```ts
type LauncherService = {
  init(): Promise<void>;
  dispose(): Promise<void>;
};
```

They receive their dependencies (router, window getter, kit, locks,
cross-service ports) at construction time. `main/index.ts` holds one ordered
`services` array; init walks it in order, and the `before-quit` drain disposes
concurrently because teardown is independent.

Init order (the array in `main/index.ts` is authoritative):

```
auth → skin → localBuilds → catalog → minecraft → bundle → console → updater
```

The order matters in three places: `auth` first, because it registers the
session-auth port that `infra/http.ts` needs before any API call;
`localBuilds` before `catalog`, because the aggregator composes the local
source; and `minecraft` before `bundle`, because the bundle service installs its
launch hook onto the already-constructed minecraft manager.

- `auth` — Yggdrasil credential login plus Mojang/Microsoft browser sign-in.
  Account metadata is persisted in the SQLite store; bearer and refresh
  tokens are encrypted with Electron `safeStorage` and held as a BLOB in the
  same database.
- `skin` — uploads / clears Minecraft skin & cape via the skins registry.
- `localBuilds` — user-created builds: `instance.json` manifests, the SQLite
  registry index, startup reconcile, and the local catalog source.
- `catalog` — aggregates the official API source and the local source into one
  list with per-source health flags.
- `minecraft` — wraps `@loontail/minecraft-kit` for install / launch / repair /
  uninstall; owns the per-build operation state machine and broadcasts
  progress / status / error events.
- `bundle` — modpack overlay sync (plan → download → delete → heal) with
  pause/resume/cancel and launch-blocking `syncForLaunch`.
- `console` — game console window pub/sub over `infra/consoleHub`.
- `updater` — Squirrel.Windows `autoUpdater` wrapper; `updater.check` IPC +
  `updater.status` events.

Routes are registered inside `init` for a lifecycle service, and at the call
site for a stateless one. Cross-capability calls go through injected ports or
direct module imports — never IPC; the router is a renderer→main edge, not a
main-internal bus.

`clientOperationLocks` is neither: it is constructed at the root and shared by
minecraft and bundle, arbitrating cross-domain folder writes through
CLIENT_FOLDER / RUNTIME_COMPONENT / BUNDLE_MANIFEST write leases.

## 6. Renderer state

Explicit zones, no overlap.

- **Async state from main / network** → TanStack Query. Each feature's
  `hooks.ts` declares its query keys and mutation hooks; nothing else
  in the feature touches `window.api` directly.
- **Local UI state of a feature** → `useState` / `useReducer` inside
  components.
- **Cross-feature UI state** (navigation, generic value stores) → Zustand
  stores in `renderer/shared/lib/stores/`: `navigation.ts`,
  `createValueStore.ts`, `createLiveStatusStore.ts`.
- **Feature-scoped runtime state mirroring main-process events** (install
  progress, bundle status, updater state) → a Zustand store next to the
  feature's `events.ts`, at `features/<name>/store.ts`. Today: `bundle`,
  `minecraft`, `updater`. The store consumes the feature's IPC events and
  exposes selectors to the feature's components.

There is no global app store. There is no Redux.

## 7. Build identity

One key type spans both kinds of build:

- `CatalogKey` = `official:<slug>` | `local:<localBuildId>`. It is **the**
  operational key: every `minecraft.*`, `bundle.*` and settings-override
  channel is typed on it, settings overrides and operation locks are keyed on
  it, and `last_played` rows use it.
- `CatalogRef` (`{ source, id }`) is the parsed form; `parseCatalogKey` is the
  only way to get from one to the other.
- A build's own `Target.id` stays **source-native** (the official slug, or the
  local build's UUID) so official install manifests keep matching what the API
  and the kit expect. Do not derive it from the `CatalogKey`.

An earlier design punned local UUIDs through a `ClientSlug` brand with
`as unknown as` casts. That is gone; do not reintroduce a cast to smuggle one
keyspace through another.

## 8. Persistence

- A single **SQLite** database (`better-sqlite3`) at `userData/launcher.db`
  holds all launcher state, accessed only through the `main/infra/store.ts`
  facade. Tables:
  - `settings` — singleton row: `allocated_ram_mb`, `clients_folder`,
    `launch_console`, `launch_fullscreen`.
  - `client_overrides` — one row per build (`slug` = the `CatalogKey`) holding
    the override patch as JSON.
  - `auth_account` — singleton row: non-secret account `metadata` (provider,
    username/profile, UUID/XUID, client id, token expiry) plus the encrypted
    secret `BLOB`. Absent row ⇒ signed out.
  - `instances` — the local-build registry index (one row per build). It is a
    rebuildable index; each build's `instance.json` on disk is authoritative
    and the startup reconcile pass self-heals the table from it.
  - `last_played` — `CatalogKey → epoch ms` rows.
  - `meta` — scalar metadata, including `schemaVersion`.
- `schemaVersion` is bumped on incompatible `LauncherSettings` changes. Each
  bump adds a step to the `MIGRATIONS` map in `main/infra/store.ts`; an
  out-of-band stored version aborts startup with a typed error. The physical
  table layout has its own version via SQLite `PRAGMA user_version`
  (`infra/db/schema.ts`).
- New persisted state adds a repository under `infra/db/` and a facade function
  in `infra/store.ts` — not a second storage technology.
- Auth token material is never stored in plaintext. Yggdrasil
  `accessToken`/`clientToken` and Mojang `accessToken`/`refreshToken` are
  encrypted with Electron `safeStorage` and kept as the `auth_account.secret`
  BLOB. `safeStorage` uses Windows DPAPI and macOS Keychain. On Linux the
  launcher accepts only libsecret or KWallet backends; `basic_text` and
  unavailable encryption clear the local session and require sign-in instead
  of falling back to plaintext storage.
- On first launch after upgrading from the legacy `electron-store` layout,
  `infra/db/legacyImport.ts` imports `launcher.json` (and the encrypted
  `auth-session.bin`) into the database once, then renames the old files aside
  with an `.imported` suffix. That importer is the only remaining reason the
  name `electron-store` appears in the tree.
- Build install directories: `{clientsFolder}/{slug-or-uuid}/` (the
  user-configured folder, or its per-build override). `clientsFolder` lives
  under `app.getPath('userData')` by default.
- Cached media (API-served images, prewarmed skin/cape uploads):
  `userData/cache/media/<sha1>` (registered as the `cache://` protocol).
- Java runtimes: `userData/runtimes/<component>/`.
- Logs: `userData/logs/` (rotated by `electron-log`, 5 MB per file with
  one archived `*.old.log`, so on-disk log size stays around 10 MB).
- Binary blobs (cached media, Java runtimes, build files) stay on disk as
  files — only structured launcher state lives in SQLite.

All file paths are produced by `main/infra/{system,cache}.ts` helpers that
resolve against `app.getPath('userData')` or the user's explicit override
folder. No relative paths in services.

At startup, `bootstrap/sweepOrphans.ts` prunes override rows whose build no
longer exists, building the keep-set from the official client list **plus** the
local build registry — an official-only keep-set would delete every local
build's override. It is best-effort in two ways: a failed fetch skips silently,
and an empty list is treated as an unhealthy backend rather than "every official
build was deleted".

## 9. External integrations

### 9.1 API backend

- Source of truth for official builds, bundles, and bundle manifests.
- Accessed from `main/infra/http.ts`, which binds the API base URL and attaches
  the live session bearer through a registered `SessionAuthPort` (so infra never
  imports the auth service).
- Every response is validated by a Zod schema declared in
  `shared/contracts/`.
- Route paths are not built ad-hoc — they come from
  `shared/constants/apiRoutes.ts`.
- API base URL comes from env at build time, not hard-coded.
- The bundle download path deliberately does **not** use `infra/http.ts`: it
  needs raw streaming with its own redirect/origin/HTTPS policy
  (`bundle/download.ts`, `bundle/urlPolicy.ts`).

### 9.2 Minecraft process

- The launcher never calls `child_process` itself. `kit.launch.compose` builds
  the command and the kit's `Spawner` starts the JVM; `main/services/minecraft/
  launch.ts` supplies JVM args, env vars and the account.
- Arguments and JVM flags are built from resolved settings (RAM, console,
  fullscreen, install dir) plus the auth mode (Mojang passthrough,
  authlib-injector for Yggdrasil, or offline).
- The process is supervised: stdout/stderr are fanned into `infra/consoleHub`
  (log4j XMLLayout parsed into structured lines), and exit / crash is reported
  back to the renderer as a status event.

### 9.3 `@loontail/minecraft-kit`

- Pinned to an exact version in `package.json` (no caret). The kit is
  owned by the same team, but the launcher reaches into kit-internal
  contracts (`InstallActionKinds`, `RepairFromErrorSupportedCodes`,
  `EventTypes`), so version bumps are deliberate PRs — not implicit
  through semver-flavoured ranges on a `0.x` line.
- Kit types are mirrored into `shared/contracts/` behind `satisfies` pins and
  compile-time shape guards, precisely so kit runtime never reaches the
  renderer.

## 10. Error model

- IPC errors cross the bridge as structured `IpcError` objects
  (`{ code, message, details? }`). Never raw stack traces.
- `code` is a constant from `shared/constants/errorCodes.ts`. The UI
  decides what to show based on `code`, not on `message` text.
- Kit failures are reclassified at the service edge into launcher codes, so the
  renderer can offer Repair / Retry on the codes that support it.
- Unexpected exceptions in main are caught (`uncaughtException`,
  `unhandledRejection`) and logged at error level. The app does not
  fail silently.

## 11. Build and packaging

- **Build**: `electron-vite` produces three bundles (main, preload,
  renderer) with shared `tsconfig.base.json` and per-target tsconfigs.
- **Packaging**: `electron-builder`. Releases go to GitHub Releases.
- **Auto-update**: Electron's built-in Squirrel.Windows `autoUpdater` against
  `update.electronjs.org` — **not** `electron-updater`, which is not a
  dependency.
- **No build-time API token.** An earlier build inlined an `API_TOKEN` through
  Vite's `define()`, which baked it into the shipped main bundle inside the
  installer's asar, extractable by anyone. CI greps `src/` and
  `electron.vite.config.ts` to keep it out; do not reintroduce a secret that
  is inlined at build time.
- **Electron Fuses** are flipped at build time: `runAsNode: false`,
  `enableNodeOptionsEnvironmentVariable: false`,
  `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true`,
  `enableEmbeddedAsarIntegrityValidation: true`.

## 12. Testing surface

Tests live under `tests/`, mirroring `src/`:

```
tests/
├─ main/       # services, infra, ipc, bootstrap
├─ renderer/   # feature selectors and pure view logic
├─ shared/     # domain, contracts, ipc guards
├─ helpers/    # shared fakes and fixtures
└─ setup/      # vitest setup
```

- **Vitest**, `tests/**/*.test.{ts,tsx}`. Pure-logic tests (`shared/domain/`,
  renderer selectors, decision functions) are the default and run in
  milliseconds; tests that touch fs or a real database are kept few and
  explicit. `v8` coverage is configured over `src/main/services/**` and
  `src/shared/**`, without a threshold gate.
- IPC routes are tested with a mocked service — argument validation and routing.
- Zod schemas are tested round-trip and negative.
- No end-to-end tests. Smoke flows verified manually before release; the
  Playwright/Electron harness in `scripts/screenshot.mjs` is a manual visual
  tool, not a gate.
- No component-level UI tests unless a component contains non-trivial UI logic
  (which is itself a signal to extract a hook).

## 13. Dependency direction

Row depends on column. "kit" = `@loontail/minecraft-kit`.

| Subsystem | Depends on | Notes |
|---|---|---|
| lifecycle (`main/index.ts`, `bootstrap/`, `windows/`) | every service factory, infra, ipc, config, shared/domain | Composition root; creates the one kit instance (`services/kit.ts`) but never calls kit APIs itself |
| ipc-contracts (`shared/ipc`, `shared/contracts`, `main/ipc`, preload) | zod, kit (types only, `satisfies`-pinned mirrors), electron | Consumed by every `routes.ts` and the whole renderer |
| infra | electron, better-sqlite3, config (`http.ts`/`session.ts` — a layering inversion), shared constants/contracts/domain | Consumed by every service and bootstrap |
| minecraft | **kit (dominant)**, settings, clientOperationLocks, auth (`getStoredAuth`), infra, yggdrasil, config | Holds **no** static bundle or catalog import: the launch hook, the bundle seams (`resolveBundleRepairFilter`, `clearLocalManifest`) and the build resolver all arrive through injection (`minecraft/env.ts`) |
| bundle | clients (`getClient`), settings, clientOperationLocks, infra, config, kit | Also holds **no** static minecraft import: `healer.ts` takes an injected `resolveContext` from the minecraft manager. Owns a raw node http/https stack in `download.ts`, separate from `infra/http` |
| catalog / localBuilds / clients | kit (versions list/resolve only), settings, infra store/cache/http, shared/domain | Catalog itself never touches the kit |
| auth / skin | kit (OAuth/refresh/profile), yggdrasil, infra store, config, media/`mediaCache` (module import) | Consumed by minecraft launch through an injected account provider |
| app / settings / system / servers / history / media / console / updater | infra, shared/domain settings, electron `autoUpdater`/`protocol`/`dialog` | `settings/settings.ts` is module-imported by minecraft, bundle, localBuilds, system and bootstrap — the one shared module facade |
| renderer features | `window.api`, catalog + settings features, shared contracts/domain/constants, zustand, react-query | No kit anywhere in the renderer |
| renderer shared (app root, ui kit, lib, console window, i18n) | `window.api`, shared, react-query + persister, zustand, i18next | Imports nothing from `features/` — clean layering |

**minecraft ⇄ bundle is fully decoupled** and must stay that way. Neither
directory contains a static import of the other (grep-verified). Everything
crosses through the composition root:

- minecraft ← bundle: `attachLaunchHook`, plus `resolveBundleRepairFilter` and
  `clearLocalManifest` passed into `createMinecraftService` and held in
  `minecraft/env.ts`.
- bundle ← minecraft: `{ resolveContext }` passed into `createBundleService`,
  which `bundle/healer.ts` uses to resolve the heal target.

If you need a new edge between these two, add a port at the root. Do not add the
import back — the cycle it recreates took two refactor passes to remove.

Remaining couplings, listed so nobody mistakes them for the intended shape:

1. **infra → config** — `infra/http.ts`, `infra/session.ts` and
   `infra/originPolicy.ts` bind generic infra to the API backend.
2. **skin → auth** (type-only: `AuthSessionPort`, `YggdrasilGateway` — the
   gateway lives under `services/auth/` but is really shared infra) and
   **skin → media** (a real value import of `mediaCache`).
3. **everything → `settings/settings.ts`** as a module import. It is a stateless
   facade over the store, not a stateful singleton; `localBuilds/create.ts`,
   `minecraft/context.ts` and `bundle/manager.ts` take an injectable
   `getSettings` with the module function as the production default.

## 14. Invariants worth preserving

Things that are load-bearing and easy to break by accident.

**Composition & DI.** One composition root with explicit constructor injection;
exactly one process-wide `MinecraftKit` shared by auth/skin/localBuilds/
minecraft/bundle so metadata caches are shared. The bundle→launch integration is
correctly inverted via a hook injected at the root — extend that pattern, do not
regress to direct imports.

**IPC discipline.** One declarative contract map with two-way compile-time
coverage guards plus a runtime coverage test; error transport solved exactly once
(`toIpcError` → sentinel → preload rehydration) with path-leak prevention for
errno errors; per-window trusted-sender pinning, with the unsandboxed console
window confined to a four-channel allowlist; Zod validation at every route
boundary.

**Offline-first.** Durable sidecar install manifests make open-time status fully
offline (no network, no hashing). `cachedFetch` disk snapshots keep the catalog
alive without the official source, and per-source health flags degrade the UI
instead of blanking it. Bundle `getInstallState` deliberately reports
`signatureMatches: true` on network failure so connectivity never gates Play.

**Security guards.** Path-traversal rejection before every destructive fs op
(`resolveSafeEntryPath`, `isUnderClientsRoot` — explicitly the only barrier
before a recursive `rm`); the bundle redirect/origin/HTTPS download policy; the
Microsoft authorize-URL allowlist before `shell.openExternal`; the `cache://`
SSRF guard; CSP/session hardening with deny-all permissions; navigation guards
and per-entry URL allowlists on both windows; auth tokens split into
safeStorage-encrypted blobs with plaintext metadata.

**Deliberate tradeoffs, already documented in code.** Console window
`sandbox: false` + `backgroundThrottling: false` with compensating controls;
`queueMicrotask` instead of RAF in the console stream (occluded-window
throttling) plus a 1 s reconcile poll; the bundle-owned-path repair filter in
both directions (repair never reverts bundle files, heal never re-downloads
them); rm-then-rename "atomic-ish" writes as a Windows workaround; the two-tier
migration split (physical DB layout vs logical settings shape).

**Operational conventions.** Progress emission is throttled at 100 ms on every
progress path; broadcasters re-resolve the live `BrowserWindow` per send so
macOS window recreation is safe; status seeding is deduped and
concurrency-capped with live-events-win semantics; the `before-quit` drain
cancels in-flight operations before disposal and closes the database last — so
no synchronous teardown may issue a store write.
