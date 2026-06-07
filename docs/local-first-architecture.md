# Local-first build architecture

> Status: in progress. This document is the source of truth for the migration of
> Loontail Launcher from a remote-CMS-build-centric launcher into a **local-first
> Minecraft instance manager** that still surfaces official, Strapi-curated builds
> as one source in a unified catalog.

## Goal

Today the launcher only knows one kind of build: an **official** build defined in
Strapi and fetched over HTTP. Every install/launch/repair operation re-fetches the
Strapi client list and resolves the build from it (`getClient(slug)` inside
`buildContext`). That makes the CMS the de-facto source of truth for the whole app.

The new model has **two first-class build kinds** behind one catalog:

1. **Local user builds** — created by the user inside the launcher, isolated on
   disk, described by a local manifest, fully functional with the CMS unreachable.
2. **Official Loontail builds** — still authored in Strapi/CMS, now exposed as one
   *source* feeding a unified catalog rather than the launcher's foundation.

Both are projected into a single `CatalogItem` discriminated union that the UI and
the install/launch pipeline speak. The kit (`@loontail/minecraft-kit`) is reused
verbatim; it is already stateless and path-parameterized, so it needs no changes.

## Key insight: it is a generalization, not a rewrite

The launcher already has an instance-folder model. Every build lives in an isolated
folder under `LauncherSettings.storage.clientsFolder`, with a hidden `.loontail`
sidecar holding the install manifest and bundle manifest, and shares an immutable
Java runtime cache (`app.userData/runtimes/{component}`). The entire machinery
(minecraft manager, operation locks, per-build settings overrides, bundle manifests,
target resolution) is keyed on a single identity string (`ClientSlug` today).

The migration therefore:

- generalizes the identity from `ClientSlug` to a source-namespaced **`CatalogKey`**
  (`official:<slug>` | `local:<instanceId>`) for settings/ops/status routing;
- generalizes the single Strapi build source into a **catalog aggregator** over
  multiple `CatalogSource`s;
- adds a **local instance source** (registry + per-instance manifest) as the new
  primary source;
- re-points `buildContext` from `getClient(slug)` to `catalog.resolve(ref)`.

The kit `Target.id` stays the *source-native* key (the `slug` for official, the
`InstanceId` for local) so existing official install manifests keep matching — no
on-disk migration of installed official builds.

## Domain model (`src/shared/contracts`)

```
CatalogItem
  | { kind: 'official'; key: CatalogKey; ref: {source:'official'; slug};  spec; presentation; raw: Client }
  | { kind: 'local';    key: CatalogKey; ref: {source:'local'; id};       spec; presentation; manifest: InstanceManifest }

BuildSpec            // exactly what the kit bridge consumes
  minecraftVersion, forgeVersion?, fabricVersion?, runtimeVersion?, bundleSlug?

CatalogPresentation  // what the UI binds to (title, descriptions, media, servers, timestamps)

CatalogKey = `official:${ClientSlug}` | `local:${InstanceId}`   (branded)
CatalogRef = {source:'official'; slug} | {source:'local'; id}
InstanceId = Brand<string,'InstanceId'>   (UUID, == local folder name)
```

`Client` (Strapi wire-normalized) and the kit `Target` are unchanged. `BuildSpec`
is the structural shape both build kinds expose to the kit bridge.

## Storage model

```
<clientsFolder>/
  official/<ClientSlug>/        # new official installs (legacy flat <clientsFolder>/<slug> still honored)
    .loontail/{manifest.json,bundle.json}
    versions/ libraries/ assets/ mods/ config/ ...
  local/<InstanceId>/
    instance.json               # InstanceManifest — source of truth for this build
    .loontail/{manifest.json,bundle.json}
    icon.png  screenshots/      # optional user media, served via the existing media protocol
    versions/ libraries/ assets/ mods/ config/ saves/ resourcepacks/ shaders/
```

- **Per-instance manifest** (`instance.json`) is authoritative. A **local registry
  index** in electron-store (`STORE_KEY_INSTANCE_REGISTRY`) lists `{id,name,dir,updatedAt}`
  for fast catalog listing; it is rebuildable by scanning `local/*/instance.json`
  when missing or corrupt (self-heal).
- Shared immutable runtime cache is untouched.
- All writes use the existing atomic `.tmp`+rename pattern (Windows-safe);
  canonicalization uses `fs.realpathSync.native` (CI runs on a Windows 8.3 short-path runner).

### Resilience

| Failure | Behavior |
| --- | --- |
| Malformed `instance.json` | item shown as `local` with `available:false` + invalid-manifest badge; deletable, never silently dropped |
| Missing `.loontail/manifest.json` | readiness policy reports NOT_INSTALLED/UNVERIFIED (unchanged) |
| Corrupt registry index | safeParse fails → rebuild by scanning instance manifests, log warn |
| Manually deleted folder | listing skips it; registry entry pruned on next sweep |
| CMS unreachable | official source returns `[]` + `degraded`; local builds always list |

## Catalog service (`src/main/services/catalog`)

```
CatalogSource { id; listItems(opts?); getItem(ref) }
  StrapiCatalogSource  -> wraps existing getClients/getClient, maps Client -> CatalogItem('official')
  LocalCatalogSource   -> reads registry + instance manifests, maps -> CatalogItem('local')  [PRIMARY]

CatalogService
  list(locale?)  -> Promise.allSettled over sources; local-first ordering; per-source {ok} status
  resolve(ref)   -> dispatch to the named source's getItem (local never touches network)
```

`buildContext` calls `catalog.resolve(ref)` instead of `getClient(slug)`. The Strapi
source's rejection is always swallowed by the aggregator so a CMS outage never blanks
local builds.

## Identity strategy (opaque id, not a full re-key)

`ClientSlug` is a `Brand<string>` used purely as an opaque identity key by the
op/lock/status/IPC machinery — only `buildContext`, the local source, and the
bundle launch hook interpret it semantically. A full re-key of all ~250
`ClientSlug` sites to `CatalogKey` was rejected as too large/risky. Instead:

- A local build's identity is its **UUID `InstanceId`**, which flows through the
  existing slug-typed channels transparently. UUIDs never collide with human
  slugs, so official and local builds coexist in the one flat keyspace
  (`settings.clients[id]`, the op map, locks) with no migration.
- `buildContext` resolves the opaque id via `catalog.resolveBuildByOpaqueId(id)`,
  which tries the **local source first** (network-free) and falls through to the
  official (Strapi) source — so a local build resolves with the CMS unreachable.
- The launch/install/repair bundle hook is skipped when
  `ctx.item.kind === 'local'` (local builds carry no managed overlay; loose mods
  in `mods/` load natively), which keeps the bundle service Strapi-only and
  unchanged.

`CatalogKey` (`official:<slug>` | `local:<uuid>`) is retained for the
catalog/UI layer (display, dedup) but is **not** the operational key. The
`LauncherSettings.clients` map is unchanged (it now also holds local UUIDs as
keys); a cosmetic rename to `builds` is deferred and optional. Local builds use
the default folder `<clientsFolder>/<id>`, isolated and consistent with official
builds; the `official/` `local/` subdir split was dropped as unnecessary.

## Kit integration

No kit changes. The only Strapi-aware bridge, `clientToTargetInput` (`minecraft/target.ts`),
generalizes to `buildSpecToTargetInput({ targetId, spec, clientFolder, runtimeRoot, loader })`.
Create-flow version pickers use the already-exported read-only APIs
(`kit.versions.minecraft/fabric/forge/runtime`).

## IPC surface

- add `catalog.list` → `{ items: CatalogItem[]; sources: SourceStatus[] }`
- add `builds.create | builds.update | builds.delete | builds.list`
- add `builds.listMinecraftVersions | builds.listLoaderVersions`
- key `minecraft.*` status/ops by `CatalogKey` (slug kept optional on events during transition)
- `clients.list` kept until the renderer fully reads `catalog.list`, then removed
  (the compile-time `IpcContract` coverage guard enforces clean removal).

## UI

Evolve, do not replace, the existing shell (`App.tsx` auth→setup→view gates) and
design system.

HOME is a **tile-grid catalog** (`BuildsHomePage`), not an expanded layout:

- Two sections — **My Builds** (local, with a `CreateBuildTile` first) and
  **Official** — each a responsive `BuildGrid`
  (`grid-cols-[repeat(auto-fill,minmax(200px,1fr))]`). A degraded-CMS banner shows in
  the Official section only; local builds always render. Skeleton / empty states handled.
- `BuildTile` is **icon-centric** (no banner/background art on tiles): the build's
  `poster` is shown as a **centered, uncropped icon** (`BuildIcon`: `object-contain`
  over a deterministic gradient + initial fallback), with source + status badges pinned
  top (single-line, `whitespace-nowrap` so a long status like "Not installed" never wraps
  or overlaps) and the title + chips centered beneath. Chips use the **one canonical
  `BuildChip`** (same size everywhere); tiles show MC version + **loader name only** (the
  full loader version lives in the modal) so chips never wrap/jump in size. The wide
  `background` art is used **only** in the detail modal. (Asset roles: `poster` = small
  icon, `background` = modal hero art, `titleImage` = logo.)
- The official detail **modal** restores the original `ClientOverview` look: large
  `titleImage`/`text-…-5xl` title, version chip + **keyword chips** (official) over the
  fixed background hero, short description, Play + open-folder + manage, then screenshots,
  servers, about, metadata — all scrolling over the fixed backdrop.

Clicking a tile opens `BuildDetailModal` — a near-fullscreen **immersive** modal (`Modal`
primitive, `w/h = calc(100vw/vh − 4rem)` with side margins; X top-right; Esc / click-outside
close; focus trap + scroll lock reused). The modal owns a **fixed full-bleed backdrop**
(the wide `background` art, or a generated gradient for builds without it) + dual scrim;
**all content scrolls over it** in a single `overflow-y-auto` pane — the transparent
`BuildHero` reveals the art, then an opaque `bg-overlay/92` content panel slides up:

- `BuildHero` (content only): badges + status, `titleImage` logo or `<h1>`, MC/loader chips,
  short description, then the action row — `PlayButton` (install/update/launch/retry,
  source-agnostic via `operationalId`), Open-folder (when installed), and a Manage button →
  `ClientSettingsModal`. Deleting a local build threads `onBuildDeleted` up to close the modal.
- Content panel: `BuildGallery` (screenshots), `ServersInfo`, `BuildAbout` (sanitized
  markdown), `BuildMetadata`.

The pure view-model (`buildView.ts`: `tileCoverSlot`/`heroBackdropSlot`/`primaryLoader`/
`fallbackHue`/…) and status mapping (`buildStatus.ts`: `describeBuildStatus`) are kept out of
the components and unit-tested directly.

**Create build** is a modal wizard (name → MC version → loader + loader version), not a
top-level view. Settings/repair/uninstall/delete reuse `ClientSettingsModal` (nested);
local builds get a Delete action (distinct from Uninstall). View-model lives in
`catalog/buildView.ts` (`primaryLoader`/`loaderVersionFor`/`hasArtwork`/`fallbackHue`),
identity in `catalog/buildIdentity.ts` (`operationalId`) — kept out of the components.

## Implementation phases

Each phase keeps `npm run verify` (lint + typecheck + test + build) green and never
breaks official builds.

0. **Domain groundwork** — `DONE`. Additive contracts (`catalog.ts`, `instance.ts`, ids).
1. **Catalog aggregator over official only** — `DONE`. `catalog.list` IPC; CMS-down stops blanking.
2. **Route buildContext through the catalog** — `DONE`. `buildSpecToTargetInput`; `Context.item`.
3. **Local instance source (read/launch path)** — `DONE`. registry + repo + reconcile + localSource;
   opaque-id resolution; launch-hook skip for local builds.
4. **Create / edit / delete local builds** — `DONE`. `builds.create/update/delete` +
   `builds.listMinecraftVersions`/`listLoaderVersions` IPC; `instances/create.ts` pins the
   loader version via `kit.versions.*`. Renderer create-build modal still pending in Phase 5.
5. **Unified UI + official detail polish** — `DONE`. New `renderer/features/catalog/` (api/hooks/
   store/`operationalId`); Home reads `catalog.list` with My Builds / Official sections, source
   chips, a degraded-CMS banner, and a `+ Create build` modal (kit-backed version pickers).
   `PlayButton`/`ClientOverview`/`ClientSettingsModal`/`ClientListCard`/`ClientsNavigation` and the
   loader/media pieces consume `CatalogItem`, keyed by `operationalId(item)`. `BuildMedia` keeps
   official's Strapi media pipeline and renders local media URLs. Local builds get a Delete action;
   dead `useClientsList`/renderer `getClients`/clients `store.ts` removed.
   - Optional follow-up: the `clients.list` IPC channel is now unused by the renderer but still
     registered (the catalog's Strapi source uses the main-side `getClients`, not the IPC route).
     Removing the channel + `registerClientsRoutes` is a low-risk cleanup deferred to avoid churn
     in the IPC coverage guard.
6. **(future) Embedded bundle / mod ecosystem seam** — mods/resourcepacks/shaders overlays.

## Locked decisions

1. Local identity = UUID `InstanceId`; `name` is display-only and editable.
2. "Save as Local" (clone official) is out of v1; `InstanceManifest` reserves an
   optional `origin` for it.
3. Local builds default to `bundle.source: 'none'` — loose mods in `mods/` load
   natively via Fabric/Forge; managed overlays are the Phase 6 seam.
4. A local build may reference a remote bundle later (`bundle.source: 'remote'`),
   opt-in, not v1 UI.
5. Create flow = modal wizard.
6. Delete and Uninstall are distinct for local builds.
7. Loader/runtime versions are pinned at create time; "check for updates" is future.
8. `clients.list` is removed only after the renderer migrates to `catalog.list`.
9. Settings migration is silent and lossless; new users start with an empty My Builds.
10. Offline-username auth is deferred (auth surface unchanged in v1).
