# Architecture — @loontail/minecraft-launcher

High-level architectural map of the launcher. Code-style rules live in
[`code-guideline.md`](./code-guideline.md); UI / design-system rules live in
[`ui-guideline.md`](./ui-guideline.md). This document focuses on **what
goes where and why**.

---

## 1. Overview

The launcher is an **Electron desktop application** that downloads and
launches Minecraft clients ("bundles") served by a remote **Strapi**
backend. It exposes a single UI window (renderer), runs all OS and network
work in the main process, and ships dark-only.

Core responsibilities:

- Discover available clients via Strapi.
- Download, verify, and update client bundles from the bundle registry.
- Persist per-launcher and per-client settings.
- Launch Minecraft with the right arguments and JVM options.
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
│  └─────────────┘                 │  Query + Zustand + shadcn│  │
│        ▲                         └──────────────────────────┘  │
│        │ typed IPC (channels + events)                         │
│        ▼                                                       │
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
                     │ HTTP(S) (Zod-validated)      │ child_process
                     ▼                              ▼
              ┌──────────────┐               ┌─────────────┐
              │    Strapi    │               │  Minecraft  │
              │   backend    │               │   client    │
              └──────────────┘               └─────────────┘
```

**Hard rules** (enforced by linter and tsconfig paths):

- `renderer` never imports from `main`.
- `main` never imports from `renderer`.
- `shared` is platform-agnostic — no Node, DOM, Electron, or React imports.

## 3. Modules

### 3.1 `shared/`

Platform-agnostic code reachable from both processes.

- `shared/contracts/` — types and Zod schemas for external data shapes
  (Strapi responses, bundle manifests, error codes).
- `shared/ipc/` — IPC contract: a single `IpcContract` map
  (`channel → { args, result }`) and an `IpcEvents` map for server→client
  events.
- `shared/domain/` — pure logic that has no I/O dependencies. Functions
  like `resolveClientSettings`, `diffManifests`, `compareSha`. Trivially
  unit-testable.
- `shared/constants/` — cross-layer constants: IPC channel names,
  app-wide limits (`MIN_RAM_MB`, `MAX_RAM_MB`), API route builders,
  store key names, error code enums.

### 3.2 `main/`

Node-side. Owns fs, network, OS, and child processes. The only place
business logic that touches the outside world is allowed to live.

- `main/index.ts` — bootstrap. Creates the main window, wires services
  in the required order, registers IPC routes.
- `main/ipc/` — typed IPC router. Wraps `ipcMain.handle` with
  Zod validation of arguments and sender-frame checks.
- `main/services/<name>/` — one folder per domain capability:
  - `index.ts` — public API of the service: `init(ctx)`, `dispose()`.
  - `<name>.ts` — core logic.
  - `routes.ts` — IPC routes (thin wrappers over the core).
- `main/infra/` — low-level integrations:
  - `fs.ts` — file system helpers.
  - `http.ts` — fetch wrapper with Zod-validated responses.
  - `store.ts` — `electron-store` wrapper for persisted settings.
  - `logger.ts` — `electron-log` configuration and scoping.
- `main/windows/` — `BrowserWindow` creation, menus, tray.

### 3.3 `preload/`

Thin bridge. Only proxies IPC and exposes a typed `window.api`.

- `preload/index.ts` — `contextBridge.exposeInMainWorld('api', …)` that
  takes the `IpcContract` from `shared/ipc/` and produces a typed
  `invoke(channel, args)` / `on(event, callback)` API.
- No business logic.
- No raw `ipcRenderer` or `electron` exposed to the renderer.

### 3.4 `renderer/`

UI process. Knows nothing about Node, fs, or sockets — only about
`window.api`.

- `renderer/app/` — router, root layout, top-level providers
  (`QueryClient`, theme bootstrap, error boundary).
- `renderer/features/<name>/` — feature folders. Each owns:
  - `api.ts` — wrappers over `window.api.<feature>.*`.
  - `hooks.ts` — feature-specific hooks (`useBundleStatus`, etc.) backed
    by TanStack Query.
  - `components/` — UI of the feature.
  - `index.ts` — the only file other parts of the app may import from.
- `renderer/shared/ui/` — generic UI primitives owned by the project
  (shadcn components, icon wrappers, layout helpers).
- `renderer/shared/lib/` — non-UI helpers used across features
  (formatters, small hooks, type guards).

## 4. IPC contract

Single source of truth: `shared/ipc/contract.ts`.

```ts
export type IpcContract = {
  'bundle.start':       { args: { slug: BundleSlug }; result: void };
  'bundle.cancel':      { args: { slug: BundleSlug }; result: void };
  'bundle.status':      { args: { slug: BundleSlug }; result: BundleStatus };
  'settings.get':       { args: void;                  result: LauncherSettings };
  'settings.setClient': { args: ClientOverridePatch;   result: LauncherSettings };
  // …
};

export type IpcEvents = {
  'bundle.progress':    BundleProgress;
  'bundle.reset':       { slug: BundleSlug };
  // …
};
```

Preload exposes `window.api.invoke<K>(channel, args)` and
`window.api.on<E>(event, cb)`, both fully typed from the contract.

Main side: a tiny router (~100 LOC) wraps `ipcMain.handle`, validates
arguments through the Zod schema co-located with the channel, validates
the sender frame, and dispatches to the service.

## 5. Services in main

Each domain capability is a service with an explicit lifecycle.

```ts
type Service = {
  init(ctx: ServiceContext): Promise<void>;
  dispose(): Promise<void>;
};
```

Services receive their dependencies (router, mainWindow) directly at
construction time. Bootstrap in `main/index.ts` wires them in init order:

```
app → auth → system → settings → skin → clients → servers → media →
minecraft → console → updater
```

Disposal runs in reverse on `before-quit` via `Promise.allSettled` so a
slow consumer doesn't block the rest.

A service registers its IPC routes inside `init`. Cross-service calls
go through direct imports (not IPC); the router is a renderer→main edge,
not a main-internal bus.

Currently shipping services:

- `app` — version info.
- `auth` — Yggdrasil credential login plus Mojang/Microsoft browser sign-in.
  Account metadata is persisted in `electron-store`; bearer and refresh
  tokens are stored through Electron `safeStorage`.
- `system` — RAM range, disk space, folder pick, OS path open.
- `settings` — `launcherSettings` CRUD + per-client overrides.
- `skin` — uploads / clears Minecraft skin & cape via skins-registry.
- `clients` — Strapi `/api/clients` with on-disk snapshot fallback + in-flight dedup.
- `servers` — Minecraft SLP ping for server status.
- `media` — `cache://` protocol handler backed by disk-cached image fetches.
- `minecraft` — wraps `@loontail/minecraft-kit` for install / launch / repair /
  uninstall, broadcasts progress / status / error events.
- `console` — game console window pub/sub; log4j XMLLayout parser.
- `updater` — `electron-updater` wrapper; `updater.check` IPC + `updater.status`
  events (`checking`/`available`/`downloading`/`ready`/`error`).

## 6. Renderer state

Three explicit zones, no overlap.

- **Async state from main / network** → TanStack Query. Each feature's
  `hooks.ts` declares its query keys and mutation hooks; nothing else
  in the feature touches `window.api` directly.
- **Local UI state of a feature** → `useState` / `useReducer` inside
  components.
- **Cross-feature UI state** (navigation, generic value stores) → Zustand
  stores in `renderer/shared/lib/stores/`. Today: `navigation.ts`,
  `createValueStore.ts`.
- **Feature-scoped runtime state mirroring main-process events** (install
  progress, bundle status, updater state) → Zustand store next to the
  feature's `events.ts`, at `features/<name>/store.ts`. Today: `bundle`,
  `minecraft`, `clients`, `updater`. The store consumes the feature's
  IPC events and exposes selectors to the feature's components.

There is no global app store. There is no Redux.

## 7. Persistence

- `electron-store` in `userData/` holds:
  - `auth` — non-secret account metadata or `null`: provider, username/profile
    data, UUID/XUID, client id, token expiry, and skin/cape URLs when provided
    by the upstream profile.
  - `launcherSettings` — `memory`, `storage`, `launch`, per-client overrides keyed by `ClientSlug`.
  - `schemaVersion` — integer; bumped on incompatible schema changes. Each
    bump adds a step to the `MIGRATIONS` map in `main/infra/store.ts`; an
    out-of-band stored version aborts startup with a typed error.
- Auth token material is not stored in plaintext `electron-store`. Yggdrasil
  `accessToken`/`clientToken` and Mojang `accessToken`/`refreshToken` are
  encrypted with Electron `safeStorage` into `userData/auth-session.bin`.
  `safeStorage` uses Windows DPAPI and macOS Keychain. On Linux the launcher
  accepts only libsecret or KWallet backends; `basic_text` and unavailable
  encryption clear the local session and require sign-in instead of falling
  back to plaintext storage.
- Client install directories: `{clientsFolder}/{slug}/` (the user-configured
  folder, or its per-client override). `clientsFolder` lives under
  `app.getPath('userData')` by default.
- Cached media (Strapi-served images, prewarmed skin/cape uploads):
  `userData/cache/media/<sha1>` (registered as the `cache://` protocol).
- Java runtimes: `userData/runtimes/<component>/`.
- Logs: `userData/logs/` (rotated by `electron-log`, 5 MB per file with
  one archived `*.old.log`, so on-disk log size stays around 10 MB).
- No SQLite or Drizzle until a real need appears (history, search,
  large structured data).

All file paths are produced by `main/infra/{system,cache}.ts` helpers that
resolve against `app.getPath('userData')` or the user's explicit override
folder. No relative paths in services.

At startup, `bootstrap/sweepOrphans.ts` fetches the current client list and
drops `launcherSettings.clients` entries whose slug is no longer in Strapi.
Best-effort: when Strapi is unreachable the sweep skips silently.

## 8. External integrations

### 8.1 Strapi backend

- Source of truth for clients, bundles, and bundle manifests.
- Accessed only from `main/infra/http.ts`.
- Every response is validated by a Zod schema declared in
  `shared/contracts/`.
- Route paths are not built ad-hoc — they come from
  `shared/constants/apiRoutes.ts` (`API_ROUTES.bundle.manifest(slug)` etc).
- API base URL comes from env at build time, not hard-coded.

### 8.2 Minecraft process

- Launched via `child_process.spawn` from `main/services/launch/`.
- Arguments and JVM flags are built from resolved settings (RAM, console,
  fullscreen, install dir).
- The process is supervised: stdout/stderr piped to scoped logger,
  exit code reported back to renderer via an event.

### 8.3 `@loontail/minecraft-kit`

- Pinned to an exact version in `package.json` (no caret). The kit is
  owned by the same team, but the launcher reaches into kit-internal
  contracts (`InstallActionKinds`, `RepairFromErrorSupportedCodes`,
  `EventTypes`), so version bumps are deliberate PRs — not implicit
  through semver-flavoured ranges on a `0.x` line.

## 9. Error model

- IPC errors cross the bridge as structured `IpcError` objects
  (`{ code, message, details? }`). Never raw stack traces.
- `code` is a constant from `shared/constants/errorCodes.ts`. The UI
  decides what to show based on `code`, not on `message` text.
- Unexpected exceptions in main are caught (`uncaughtException`,
  `unhandledRejection`) and logged at error level. The app does not
  fail silently.

## 10. Build and packaging

- **Build**: `electron-vite` produces three bundles (main, preload,
  renderer) with shared `tsconfig.base.json` and per-target tsconfigs.
- **Packaging / auto-update**: `electron-builder` + `electron-updater`.
  Releases go to GitHub Releases (or S3-compatible storage). Signing is
  set up before the first public build (Windows Authenticode, macOS
  notarization).
- **Electron Fuses** are flipped at build time: `runAsNode: false`,
  `enableNodeOptionsEnvironmentVariable: false`,
  `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true`,
  `enableEmbeddedAsarIntegrityValidation: true`.

## 11. Testing surface

- Unit (Vitest):
  - `shared/domain/` — pure logic.
  - IPC routes with a mocked service.
  - Zod schemas (round-trip, negative cases).
- No end-to-end tests. Smoke flows verified manually before release.
- No component-level UI tests unless a component contains non-trivial
  UI logic (a signal to extract a hook).

## 12. Project tree

```
minecraft-launcher/
├─ src/
│  ├─ shared/
│  │  ├─ contracts/        # types + Zod schemas for external data
│  │  ├─ ipc/              # IPC contract (channels + event types)
│  │  ├─ domain/           # pure logic
│  │  └─ constants/        # cross-layer constants (apiRoutes, errorCodes, …)
│  ├─ main/
│  │  ├─ index.ts          # bootstrap
│  │  ├─ ipc/              # typed router
│  │  ├─ services/<name>/  # domain services (settings, bundle, launch, updater)
│  │  ├─ infra/            # fs, http, store, logger
│  │  └─ windows/
│  ├─ preload/
│  │  └─ index.ts          # window.api via contextBridge
│  └─ renderer/
│     ├─ app/              # router, layout, providers
│     ├─ features/<name>/  # feature folders with public API via index.ts
│     └─ shared/
│        ├─ ui/            # shadcn primitives, icons, layout
│        └─ lib/           # non-UI helpers, stores, type guards
├─ tests/
│  └─ unit/
├─ docs/
│  ├─ architecture.md
│  ├─ code-guideline.md
│  └─ ui-guideline.md
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ biome.json
├─ tsconfig.base.json
├─ tsconfig.main.json
├─ tsconfig.preload.json
├─ tsconfig.renderer.json
└─ package.json
```
