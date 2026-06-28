# Audit triage — CC group B (cross-cutting code quality)

Scope: CC-28..CC-48 (group B subset). Read-only triage as of 2026-06-06.
Conventions enforced: English; minimal comments (`// why` only); TS `private`; aggressive dead-code removal; biome-only.

## Verdict table

| ID | Verdict | Note |
|----|---------|------|
| CC-28 | OPEN | dead ternary still present, CopyButton.tsx:107,109 |
| CC-29 | OPEN | inline `['system','defaultInstallFolder']` key, SetupPage.tsx:28 |
| CC-30 | OPEN | `staleTime:0/gcTime:0` magic pair, SetupPage.tsx:30-31 (couples with CC-29) |
| CC-31 | OPEN | restating comments in useInstallProgress.ts:18-23 + installSteps.ts:58 |
| CC-32 | OPEN | inline display derivation in ServersInfo.tsx:51-104 |
| CC-33 | OPEN | sequential `stat()` loop, cache.ts:80-91 |
| CC-36 | OPEN | `MINECRAFT_KIT_VERSION` module-load constant, not injectable, installManifest.ts:46-47 |
| CC-37 | OPEN (partial) | `persistClientOverride` side-effects still in buildContext, context.ts:51,78 |
| CC-38 | OPEN | vitest.config.ts has no coverage config |
| CC-39 | ALREADY-RESOLVED | extracted to `@main/infra/throttledEmitter`, both files consume it; test exists |
| CC-41 | OPEN | `cachedFetch` still a launcher-local impl, cache.ts:141-162 (kit-dependent) |
| CC-42 | ALREADY-RESOLVED | `emitErrorEvent` no longer exists anywhere in src/ |
| CC-43 | OPEN (minor) | one banner `// --- Loontail in-game network agent ---` launch.ts:97; rest already clean |
| CC-44 | OBSOLETE/OPEN-LITE | import works (`VerifyFileCategories`), `verify`-`statuses` naming concern stale; only a contract test remains optional |
| CC-45 | ALREADY-RESOLVED | logger.ts:29-30 is now a 2-line `//` comment, not JSDoc |
| CC-46 | ALREADY-RESOLVED | cache.ts JSDoc blocks gone; only `// why` comments at 105,127-128 remain |
| CC-47 | OPEN | 14-line `/** AuthMode */` JSDoc still in http.ts:8-22 |
| CC-48 | OPEN | one-liner `/** … */` JSDoc on resolveLoader still in loader.ts:19 |

OPEN: 11 (CC-28,29,30,31,32,33,36,37,38,41,43,47,48 — 13 incl. minor/lite) 
ALREADY-RESOLVED: 4 (CC-39,42,45,46) 
OBSOLETE: ~1 (CC-44 core concern)

## Detailed findings (OPEN)

### CC-28 — CopyButton dead ternary
- File: `src/renderer/shared/ui/CopyButton.tsx:107,109`
- Both branches of `variant === 'icon' ? 'size-3.5' : 'size-3.5'` are identical.
- Fix: replace each ternary with the literal `'size-3.5'` (or a `const ICON_SIZE = 'size-3.5'`).
- Risk: trivial. Effort: trivial. Packages: none. New test: no.

### CC-29 — SetupPage inline query key
- File: `src/renderer/features/setup/components/SetupPage.tsx:28`; constant home `src/shared/constants/queryKeys.ts`.
- `QUERY_KEYS.system` already has ramRange/diskSpace/folderSize but no `defaultInstallFolder`.
- Fix: add `defaultInstallFolder: ['system', 'defaultInstallFolder'] as const` to `QUERY_KEYS.system`; use it in SetupPage.
- Risk: low (cache-key change but no existing consumer to break). Effort: trivial. Packages: none. New test: no.

### CC-30 — NEVER_CACHE named constant
- File: `src/renderer/features/setup/components/SetupPage.tsx:30-31`; new constant in `src/renderer/shared/lib/queryClient.ts`.
- `staleTime:0, gcTime:0` magic pair with prose comment (lines 24-26).
- Fix: `export const NEVER_CACHE = { staleTime: 0, gcTime: 0 } as const` in queryClient.ts; spread it; move the why-comment to the constant.
- Risk: trivial. Effort: trivial. Packages: none. New test: no.
- CLUSTER NOTE: CC-29 + CC-30 touch the SAME file (SetupPage.tsx) — do together.

### CC-31 — restating comments
- Files: `useInstallProgress.ts:18-23` (delete first 2 sentences "Single composite hook…"/"Memoizes…"; keep the `hasLoader` derivation note 21-23), `installSteps.ts:58-61` (trim "Stages map to user-facing steps." restatement, keep the finalize-folding invariant).
- Note: installSteps.ts:101 `// Skip undefined to respect exactOptionalPropertyTypes.` is a genuine why — KEEP.
- Risk: trivial. Effort: trivial. Packages: none. New test: no.

### CC-32 — extract resolveServerDisplayEntry
- File: `src/renderer/features/clients/components/ServersInfo.tsx:51-104`.
- Inline derivations: `displayName = server.name ?? status.motd?.clean[0] ?? server.address` (54), `hasPlayerCount` (56), className branches.
- Fix: extract pure `resolveServerDisplayEntry(server, status) => { displayName, online, playerText? }`; optionally a `ServerRow` subcomponent.
- Risk: low. Effort: small. Packages: none. New test: YES — unit on the displayName fallback chain (name > motd[0] > address).

### CC-33 — parallelize stat() loop
- File: `src/main/infra/cache.ts:80-91` (`listNamespaceFiles`); callers `getNamespaceSize:97`, `enforceSizeBound:109`.
- Replace the for-of sequential `await stat()` with `Promise.all(entries.filter(isFile).map(...))`, keeping per-entry ENOENT skip (map to `null`, filter out).
- Risk: low (preserve ENOENT-skip + non-file skip semantics). Effort: small. Packages: none. New test: optional (mock fs concurrency); current cache tests cover behavior.

### CC-36 — inject MINECRAFT_KIT_VERSION
- File: `src/main/services/minecraft/installManifest.ts:46-47,65,151`.
- Module-load `requirePackage('@loontail/minecraft-kit/package.json')` → `MINECRAFT_KIT_VERSION`; consumed by `createTargetInstallManifest` (84) and `targetInstallManifestMatches` (162).
- Fix: add optional `kitVersion: string = MINECRAFT_KIT_VERSION` param to both functions so tests pass a fixed string. Keep module constant as default.
- Risk: low. Effort: small. Packages: none. New test: YES — match/no-match on kitVersion without reading installed kit.
- Test exists: `tests/main/services/minecraft/installManifest.test.ts` (would be extended).

### CC-37 — buildContext write side-effects (PARTIAL)
- File: `src/main/services/minecraft/context.ts:51,78`.
- `persistClientOverride(slug, { loader: undefined })` (51) and `{ runtime: undefined }` (78) mutate settings during context build. Line 78 already captures the returned settings; line 51 is fire-and-forget.
- Fix per backlog: return `{ ctx, settingPatches }` and let `manager.ts` apply. Caller is `manager.ts` (verify all callers before changing signature).
- Risk: MEDIUM (changes a widely-called signature; behavioral ordering of persistence). Effort: medium. Packages: none. New test: YES — stale loader/runtime produce patches without mocking settings store.

### CC-38 — vitest coverage gate
- File: `vitest.config.ts` (currently only `resolve.alias` + `test.include`).
- Fix: add `test.coverage` v8 provider with thresholds for `src/main/services/**` + `src/shared/**`, exclude renderer/preload.
- Risk: low (CI may need `@vitest/coverage-v8` dependency). Effort: small. Packages: dev-dep `@vitest/coverage-v8` likely needed → refresh lockfile. New test: no.
- NOTE: this is the only task that may add a dependency (verify `@vitest/coverage-v8` present; if not, `npm install --package-lock-only`).

### CC-41 — cachedFetch vs kit createPersistentMetadataCache
- File: `src/main/infra/cache.ts:141-162`.
- Backlog itself flags this as conditional on kit API (`createPersistentMetadataCache` needing a configurable `cacheDir`). The launcher-specific `readBuffer/writeBuffer` media helpers must stay.
- Risk: MEDIUM (cross-package; semantics of 5xx-offline fallback must be preserved). Effort: medium-large; gated on kit capability. Packages: minecraft-kit (may need `cacheDir` param + version bump). New test: YES — offline-fallback / 4xx-rethrow / no-snapshot-rethrow.
- RECOMMEND: defer / separate from the comment-cleanup cluster; needs kit investigation. Lowest-priority OPEN here.

### CC-43 — junk comments in minecraft/bundle service files (MINOR)
- Most of the named files are already clean. Remaining concrete junk: `src/main/services/minecraft/launch.ts:97` banner `// --- Loontail in-game network agent --------`.
- KEEP (confirmed genuine): `download.ts:59-62` race/cleanup comment; `launch.ts:45-47` Cloudflare UA; `installManifest.ts:125-127` best-effort sidecar.
- Fix: delete the single banner line at launch.ts:97 (optionally inline the section content with no banner).
- Risk: trivial. Effort: trivial. Packages: none. New test: no.

### CC-47 — AuthMode JSDoc → inline comments
- File: `src/main/infra/http.ts:8-22`.
- 14-line `/** Authorization mode … */` over a 2-member union. Valuable invariant ("Yggdrasil access token is NOT a valid bearer for the API content endpoints") must survive.
- Fix: delete the docblock; add a short `//` above the `'none'` semantics keeping that invariant.
- Risk: trivial. Effort: trivial. Packages: none. New test: no.

### CC-48 — resolveLoader one-liner JSDoc
- File: `src/shared/domain/loader.ts:19`.
- Delete `/** Honours the user's override … */`. KEEP the `isLoaderAvailable` why-comment at lines 10-12.
- Risk: trivial. Effort: trivial. Packages: none. New test: no.

## ALREADY-RESOLVED (evidence)

- **CC-39**: `progressAdapter.ts:13` and `healProgress.ts:2` both `import { createThrottledEmitter } from '@main/infra/throttledEmitter'`; shared impl at `src/main/infra/throttledEmitter.ts`; test `tests/main/infra/throttledEmitter.test.ts` exists. Fully done.
- **CC-42**: `emitErrorEvent` returns zero hits across `src/`. `ManagerEnv` (env.ts:19-34) only has `emitError`. Done.
- **CC-45**: `logger.ts:29-30` is a 2-line `//` comment, not a `/** */` block. Done.
- **CC-46**: `cache.ts` has no JSDoc; `enforceSizeBound` (105) and the offline classifier (127-128) carry only short `// why` comments. Done.

## OBSOLETE / DOWNGRADED

- **CC-44**: import `VerifyFileCategories` resolves and is used in an exhaustive switch (progressAdapter.ts:88-102, no default → compile-time exhaustiveness already guards rename). The `VerifyFileStatuses` vs `VerifyFileCategories` naming worry is stale doc drift. At most: add a one-line contract test asserting `typeof VerifyFileCategories === 'object'`. Effort trivial; low value. Treat as OBSOLETE for the refactor, OPTIONAL test.

## Clusters (disjoint file sets)

### CLUSTER comment-cleanup [Low] — pure deletions, no behavior change
- IDs: CC-31, CC-43, CC-47, CC-48 (+ CC-28 dead-code deletion fits here)
- Files (disjoint): useInstallProgress.ts, installSteps.ts, launch.ts, http.ts, loader.ts, CopyButton.tsx
- Effort: trivial (single pass). No tests, no packages.

### CLUSTER setup-query-constants [Low]
- IDs: CC-29, CC-30
- Files: SetupPage.tsx (SHARED HOT FILE — both edit it), queryKeys.ts, queryClient.ts
- Effort: trivial. Do as one edit to SetupPage.

### CLUSTER renderer-selectors [Low]
- IDs: CC-32
- Files: ServersInfo.tsx (+ optional sibling lib)
- Effort: small. New unit test.

### CLUSTER cache-perf [Low]
- IDs: CC-33
- Files: cache.ts (SHARED HOT FILE with CC-41)
- Effort: small. Behavior-preserving.

### CLUSTER manifest-testability [Low/Med]
- IDs: CC-36, CC-37
- Files: installManifest.ts (CC-36), context.ts + manager.ts (CC-37) — disjoint
- Effort: small (CC-36) / medium (CC-37). New tests both.

### CLUSTER ci-coverage [Low]
- IDs: CC-38
- Files: vitest.config.ts (+ possible package.json/lockfile for `@vitest/coverage-v8`)
- Effort: small. ONLY task that may touch a package/lockfile.

### CLUSTER kit-cache-dedup [Medium] — DEFER
- IDs: CC-41
- Files: cache.ts (SHARED HOT FILE with CC-33 — sequence: do CC-33 first, then CC-41)
- Cross-package (minecraft-kit). Gated on kit `cacheDir` support. New tests.

## Shared hot files
- `SetupPage.tsx` — CC-29, CC-30 (do together)
- `cache.ts` — CC-33, CC-41 (CC-33 first; CC-41 deferred/cross-package)
- `installManifest.ts` — CC-36 only (CC-35/CC-40 already DONE)
