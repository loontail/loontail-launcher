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
                     │ HTTPS (Zod-validated)        │ child_process
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

`ServiceContext` carries the main window reference, the logger factory,
and the persistent store. Bootstrap in `main/index.ts` wires services
in a specific order:

```
logger → store → settings → bundle → launch → updater
```

A service registers its IPC routes inside `init`. Cross-service calls
go through direct imports (not IPC); the router is a renderer→main edge,
not a main-internal bus.

Planned services (initial set):

- `settings` — load/save `launcherSettings`, resolve per-client overrides.
- `bundle` — manifest fetch, diff, download, verify, atomic apply,
  pause/resume/cancel.
- `launch` — start the Minecraft process with resolved settings.
- `updater` — auto-update the launcher (electron-updater).

## 6. Renderer state

Three explicit zones, no overlap.

- **Async state from main / network** → TanStack Query. Each feature's
  `hooks.ts` declares its query keys and mutation hooks; nothing else
  in the feature touches `window.api` directly.
- **Local UI state of a feature** → `useState` / `useReducer` inside
  components.
- **Global UI state** (active modal, selected client, current view) →
  Zustand stores, one per semantic area, in `renderer/shared/lib/stores/`.

There is no global app store. There is no Redux.

## 7. Persistence

- `electron-store` in `userData/` holds `launcherSettings`
  (`memory`, `storage`, `launch`, per-client overrides).
- Bundle files: `{installPath}/{bundleSlug}/`.
- Local sync manifest (last successful sync): `{installPath}/.cache/manifests/{bundleSlug}.json`.
- Logs: `userData/logs/` (rotated by `electron-log`).
- No SQLite or Drizzle until a real need appears (history, search,
  large structured data).

All file paths are produced by `main/infra/fs.ts` helpers that resolve
against `app.getPath('userData')` or explicit override folders. No
relative paths anywhere in services.

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
