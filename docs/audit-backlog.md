# Engineering Audit Backlog — @loontail/minecraft-launcher

> Generated 2026-05-30 from a 12-auditor parallel audit of `src/**`, cross-checked against
> `docs/architecture.md`, `docs/code-guideline.md`, `docs/ui-guideline.md`, and the public APIs
> of `@loontail/minecraft-kit` and `loontail-yggdrasil`. **286 tasks.** This is a staged backlog —
> not a single rewrite. Each task carries Category, Priority, Area, Problem, Why, Solution,
> Affected packages, Tests, Risk.

## 1. State of the project (executive summary)

1. **Solid foundation.** Layer separation is real and enforced: `shared/` has no Node/DOM/Electron/React imports, `renderer` never imports `main`, `preload` is a thin typed IPC proxy. The IPC contract is single-source-of-truth with a compile-time coverage guard, Zod validation at the boundary, and per-channel sender-frame checks.
2. **Service convention is consistent.** `main/services/<name>/` reliably follows the `index.ts` (init/dispose) + `<name>.ts` (core) + `routes.ts` (thin) split; bootstrap wires services in a deliberate order.
3. **Good `minecraft-kit` / `yggdrasil` delegation.** Install/launch/repair go through `MinecraftKit`; UUID normalisation, PNG validation and authlib-injector come from the packages. Reuse is mostly correct — but several spots still re-implement what the packages already export.
4. **The biggest systemic smell is duplication of small primitives.** A throttled-progress emitter is implemented three times (`progressAdapter.ts`, `healProgress.ts`, `runner.ts`); `persistTargetInstallManifest` is copy-pasted between `install.ts` and `repairWorkflow.ts`; `errorMessage` exists in two `errors.ts`; `assertNever` is re-implemented despite a kit export; `SIDECAR_DIR=.loontail` and `isBundleBusy` are each defined twice.
5. **A handful of real reliability defects.** A double `lock.release()` in `startInstall` (success branch + finally) can release a lease twice; the operation lock in `BundleManager.runSync` is acquired without a guarding `try/finally`; the router casts `rawArgs` past Zod for every no-arg channel; a progress-flush timer can fire after `dispose`.
6. **Module-global mutable state leaks across the process and across tests.** `forgeProcessorActionsCache` grows unbounded with no eviction and is never reset; the renderer bundle-store status-seed queue is module-level mutable state.
7. **Boundary erosion in the repair/heal path.** `bundleHealing.ts` (bundle service) reaches into `minecraft/context.ts` and re-calls `buildContext`, adding a second Strapi + target-resolve round-trip inside a heal pass that already holds a target.
8. **External data is not always Zod-guarded.** `LocalManifest` is deserialised with runtime casts instead of a schema, contradicting the validate-at-boundaries rule.
9. **Error model is good but lossy at the kit edge.** `KIT_CODE_TO_LAUNCHER_CODE` collapses many distinct kit failures into one opaque `KIT_ERROR`; two declared error codes are never thrown; `emitErrorEvent` is wired but never called (dead surface).
10. **Renderer is clean but has UI-guideline drift.** Scattered magic pixel values, two inline `rgba()` literals, non-token `rounded-xl`/`rounded-2xl`, and a couple of duplicated UI patterns (pending-RAM) violate the palette/radius/token rules.
11. **Comment discipline is largely good.** No banner walls or dead code; the residual pollution is multi-line JSDoc on ~6 files that restate signatures. Guideline §10 gets a sharper, explicit JSDoc call-out in this pass.

### Distribution

| | Count |
|---|---|
| **Total tasks** | 286 |
| P0 / P1 / P2 / P3 | 3 / 69 / 148 / 66 |
| Risk Low / Medium / High | 182 / 97 / 7 |

Per category: Code (87), Error handling (46), Architecture (38), Docs (31), Dependency extraction (21), Performance (17), Testing (16), Flow (13), UI (10), IPC (6), тестирование (1).

## 2. Backlog grouped by flow

### Auth / session flow (31)

#### AUTH-01 — store.ts runs purgeLegacyAuth() and runMigrations() as module-level side-effects at import time

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/infra/store.ts:147 (runMigrations), 261 (purgeLegacyAuth)
- **Problem:** `purgeLegacyAuth()` and `runMigrations()` are called unconditionally at module load (lines 261, 147). These functions read from and write to the electron-store. Any file that imports from store.ts — directly or transitively — triggers store I/O at import time. This makes unit testing any consumer of `getStoredAuth` / `getStoredLauncherSettings` impossible without mocking the electron-store module globally.
- **Why it matters:** Import-time side effects are anti-patterns for testability. The migration logic should be explicitly invoked (it already is, from `authService.init()` via `migrateStoredAuthSecrets`). The `purgeLegacyAuth()` side-effect in particular can destroy data at import time with no caller awareness.
- **Proposed solution:** Move `purgeLegacyAuth()` and `runMigrations()` calls into an exported `initStore()` function that is called explicitly from `main/index.ts` before any service is created. This makes the store module purely functional at import time.
- **Affects packages:** нет
- **Tests:** Unit test for getStoredAuth: import the module without calling initStore(), assert no store I/O occurs. Unit test for runMigrations: call it explicitly with a mock store and assert expected migration steps fire.

#### AUTH-02 — yggdrasilClient.ts exports a module-level mutable singleton `cached` — same testability problem as consoleHub

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/services/auth/yggdrasilClient.ts:4-18
- **Problem:** `let cached: YggdrasilClient | null = null` at line 4 is a mutable module-level singleton. `getYggdrasilClient()` returns the same instance across all callers. Auth service, skin service, and verify paths all share one client. Tests cannot inject a fake YggdrasilClient without mocking the module. The pattern contradicts how kit is handled (created by `createKit()` and passed through service factories).
- **Why it matters:** Inconsistent with the DI approach used for MinecraftKit. Specifically stated in kit.ts comment: 'never import a module singleton, so tests can swap in a fake kit per service'. The same rationale applies to YggdrasilClient.
- **Proposed solution:** Create `YggdrasilClient` once in `createAuthService()` and pass it to `createYggdrasilAuth`, `createSkinService`, and `enrichYggdrasilAccount` as a constructor/factory parameter, exactly like `kit` is passed. Remove the `getYggdrasilClient` singleton function.
- **Affects packages:** нет
- **Tests:** Unit test for createYggdrasilAuth that injects a mock YggdrasilClient without any module-level stub.

#### AUTH-03 — MojangProfileSkinSchema in shared/contracts/auth.ts duplicates the kit's MojangProfileSkin type — comment acknowledges this but the duplication is never verified

- **Category:** Dependency extraction · **Priority:** P3 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/shared/contracts/auth.ts:23-29
- **Problem:** `MojangProfileSkinSchema` at line 23 is a local re-definition of `MojangProfileSkin` from the kit. The comment 'Mirror of kit's MojangProfileSkin shape' acknowledges this. There is no compile-time assertion that the two types remain in sync. If the kit changes its skin shape (adds a field, changes a union), the stored-session Zod schema silently accepts the old shape, potentially persisting stale data.
- **Why it matters:** Structural drift risk. The kit's MojangProfileSkin is the canonical source; any divergence causes silent parse failures or data loss on upgrade.
- **Proposed solution:** Add a compile-time structural compatibility assertion: `type _AssertSkinShape = z.infer<typeof MojangProfileSkinSchema> extends MojangProfileSkin ? true : never`. This catches divergence at tsc without adding a runtime dependency on kit in the renderer bundle. Alternatively, if the kit exports a Zod schema for MojangProfileSkin, use it directly with a type-only import guard.
- **Affects packages:** нет
- **Tests:** tsc --noEmit catches shape mismatch between MojangProfileSkinSchema and MojangProfileSkin at compile time.

#### AUTH-04 — Mojang sign-in route skips skin enrichment, returning null skin on first login

- **Status:** DONE — 2026-05-31 · commit 9491241
- **Category:** Flow · **Priority:** P1 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/routes.ts:43-51
- **Problem:** The `authMojangSignIn` handler at line 46-47 calls `setStoredAuth(session)` then immediately returns `{ ok: true, user: accountFromSession(session) }`. `accountFromSession` for a Mojang session reads the active skin URL from `session.profile.skins`, which is populated by the kit on login. However the Yggdrasil login path (auth.ts:18) wraps the result through `enrichYggdrasilAccount`. There is no parallel enrichment for the Mojang path — and no cape is ever set, since `accountFromSession` hardcodes `cape: null` for Mojang (account.ts:34). This is only cosmetically inconsistent today (Mojang cape is not supported), but the asymmetry means the two paths diverge silently.
- **Why it matters:** A future Mojang cape API addition (or a refactor of `accountFromSession`) will expose the gap with no compile-time guard. The inconsistency also makes unit-testing the two login paths hard because the expected shape differs for non-obvious reasons.
- **Proposed solution:** Document the asymmetry explicitly: add a comment in the Mojang route explaining why no enrichment step is needed (kit embeds the active skin in the session; cape is not available from Microsoft). Extract a `buildLoginResult(session: AuthSession): Promise<LoginResult>` helper in auth.ts that routes correctly by provider, and use it from both the Yggdrasil and Mojang handlers so the divergence is a single, visible branch.
- **Affects packages:** нет
- **Tests:** Unit: mock `signInWithMojang` returning a session with a known active skin; assert the returned `user.skin` matches the active skin URL. Regression: sign-in → `fetchCurrentUser` roundtrip should yield the same `Account` shape regardless of provider.

#### AUTH-05 — `verifySession` fires `enrichYggdrasilAccount` (network call) on the 'offline' branch, defeating offline fallback

- **Status:** DONE — 2026-05-31 · commit 9cd6715
- **Category:** Flow · **Priority:** P1 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/verify.ts:57-61
- **Problem:** When `yggdrasilAuth.verifySession` returns `{ kind: 'offline' }` (lines 57-58), the code calls `enrichYggdrasilAccount(session, accountFromSession(session))`, which internally calls `fetchTextures` — a network request to the same unreachable server. If the server is down `fetchTextures` throws or times out, and `enrichYggdrasilAccount` catches it (verify.ts:31-33) and returns the bare fallback. The offline path therefore always makes a redundant network attempt before returning the cached account, adding latency on every app start when the server is unavailable.
- **Why it matters:** Offline fallback should be instant — zero network traffic. The current code adds a speculative `GET /api/yggdrasil/textures/:uuid` call on every offline startup, degrading UX and hiding the real 'server is down' condition under a slower-than-expected launch.
- **Proposed solution:** In the 'offline' branch, return `accountFromSession(session)` directly without calling `enrichYggdrasilAccount`. The skin/cape from the previous successful verify is already persisted in the `Account` cached by TanStack Query in the renderer; attempting to re-fetch while offline adds nothing. Keep enrichment only for the 'ok' (token refreshed) branch.
- **Affects packages:** нет
- **Tests:** Unit: mock `yggdrasilAuth.verifySession` returning `{ kind: 'offline' }`; assert `fetchTextures` is never called and the returned account equals `accountFromSession(storedSession)`.

#### AUTH-06 — `withRefreshedProfile` exported from mojangAuth.ts is consumed by skin.ts, creating a cross-service dependency

- **Category:** Architecture · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/mojangAuth.ts:76-86, src/main/services/skin/skin.ts:10
- **Problem:** `skin.ts` imports `withRefreshedProfile` from `@main/services/auth/mojangAuth`. The skin service is a sibling service and should not reach into another service's internals. The guideline states cross-service communication should go via direct import of a public service API, not by importing internal helper functions from another service's module.
- **Why it matters:** This creates a tight coupling between the skin and auth service implementations. Any refactor of `mojangAuth.ts` (e.g. moving it, splitting it) breaks the skin service. It also exposes an auth-internal concept (the `MinecraftProfile`→`MojangSession` mapping) to an unrelated domain.
- **Proposed solution:** Move `withRefreshedProfile` to `src/main/services/auth/index.ts` or a new `src/main/services/auth/session.ts` helper file and export it as part of the auth service's public surface. Alternatively, expose a `refreshMojangProfile(session, profile): MojangSession` function from the auth service's public index, letting skin.ts call that without knowing about the internal session shape.
- **Affects packages:** нет
- **Tests:** No new tests required; existing integration tests for skin upload cover the behaviour.

#### AUTH-07 — `skin.ts` calls `getStoredAuth`/`setStoredAuth` directly, bypassing the auth service boundary

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/skin/skin.ts:9, :158, :204
- **Problem:** `createSkinHandlers` (skin.ts) imports and calls `getStoredAuth` and `setStoredAuth` from `@main/infra/store` directly — the same low-level store layer that the auth service wraps. The skin service therefore manages stored session state (persisting refreshed Mojang profiles after skin upload/reset), which is auth service's responsibility. On lines 158 and 204, after a Mojang skin mutation the skin service writes the updated session via `setStoredAuth(withRefreshedProfile(...))`, maintaining auth invariants outside the auth module.
- **Why it matters:** If the auth storage layer changes (e.g. adding encryption, changing the secret split), the skin service silently breaks. Distributed session-write responsibilities make race conditions possible (e.g. a concurrent `verifySession` call overwriting a freshly uploaded skin's session).
- **Proposed solution:** Add an `updateMojangProfile(profile: MinecraftProfile): void` method to the auth service (or to the public auth surface). The skin service calls this after a successful Mojang mutation instead of writing the store directly. The auth service is then the single writer of session state.
- **Affects packages:** нет
- **Tests:** Unit: mock the new auth service method; assert skin upload calls it with the correct profile after Mojang success. Assert `setStoredAuth` is never called from within skin.ts.

#### AUTH-08 — Unsafe `as { context?: { httpStatus?: number } }` cast in `verifyMojangSession` bypasses type safety

- **Category:** Code · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/mojangAuth.ts:204
- **Problem:** Line 204: `const httpStatus = (error as { context?: { httpStatus?: number } }).context?.httpStatus;` uses a structural cast on an `unknown`-typed error after `isErrorCode` has returned true. `isErrorCode` only validates the error code string; it does not narrow the `context` property type. The cast bypasses the type system — if the kit changes the context shape, this silently reads `undefined` and the 401 branch is never taken, leaving an expired Mojang session as `'offline'` instead of `'expired'`.
- **Why it matters:** Silent behavioural regression risk when the minecraft-kit updates. The user's expired Mojang session would not be cleared, causing repeated failed launch attempts.
- **Proposed solution:** Write a narrow type guard: `const isMinecraftFailedWithStatus = (e: unknown, status: number): boolean => isMinecraftKitError(e) && e.code === 'AUTH_MINECRAFT_FAILED' && (e.context as { httpStatus?: number })?.httpStatus === status;` (using `isMinecraftKitError` which does narrow to `MinecraftKitError` with a typed `context`). Or check `isMinecraftKitError(error)` first and access `error.context` via the kit's own type.
- **Affects packages:** нет
- **Tests:** Unit: feed `verifyMojangSession` a mock `MinecraftKitError` with code `AUTH_MINECRAFT_FAILED` and `context.httpStatus: 401`; assert result is `{ kind: 'expired' }`.

#### AUTH-09 — `clearSkin` in skin.ts swallows the Yggdrasil delete error silently, then continues cache invalidation as if deletion succeeded

- **Status:** DONE — 2026-05-31 · commit 16cb5c6
- **Category:** Error handling · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/skin/skin.ts:186-196
- **Problem:** Lines 186-196: the `try/catch` around `client.deleteSkin` and `client.deleteCape` logs a warn but does not return or rethrow. The code then falls through to `invalidateMediaCache(before.skin.url)` / `invalidateMediaCache(before.cape.url)`. If the server rejects the delete (403, 429, network error), the cache is invalidated for a texture that was never actually deleted — the skin is still live on the server but the launcher's media cache is purged. On the next render the user sees the default texture despite having a live skin.
- **Why it matters:** Cache invalidation on failed delete produces a stale-looking UI with no error feedback to the user.
- **Proposed solution:** Track whether the server-side delete succeeded. Invalidate the cache only when `client.deleteSkin/deleteCape` did not throw. If deletion fails, rethrow as a `SkinError` with `ERROR_CODES.SkinUploadFailed` (or add a new `SkinClearFailed` code) so the UI surfaces a toast. The 'snapshot before delete' pattern is correct; the 'always invalidate after' pattern is not.
- **Affects packages:** нет
- **Tests:** Unit: mock `client.deleteSkin` throwing; assert `invalidateMediaCache` is not called and a `SkinError` is thrown.

#### AUTH-10 — `AUTH_CANCELLED` is mapped to `LOGIN_ERROR_CODE.Unknown` in routes.ts, but the renderer has a `cancelledRef` guard for this case — the mapping is misleading

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/routes.ts:24
- **Problem:** Line 24: `if (isErrorCode(error, 'AUTH_CANCELLED')) return LOGIN_ERROR_CODE.Unknown;`. The comment on lines 19-21 correctly notes the renderer's `cancelledRef` suppresses the cancel-error display. But the handler still turns the cancel into an `{ ok: false, error: 'UNKNOWN' }` result, and the comment says the renderer 'already suppresses' it. This is fragile: if `cancelledRef.current` is false at the moment the response arrives (e.g. the user clicked cancel then immediately clicked sign-in again), the error IS displayed — and the displayed text will be the generic 'Unknown error' copy, not 'Sign-in was cancelled'.
- **Why it matters:** Race condition: rapid cancel-then-retry can flash a spurious 'Unknown error' banner instead of the appropriate message or no message.
- **Proposed solution:** Add `LOGIN_ERROR_CODE.Cancelled` to the shared enum. Return it from `mojangFailureCode` for `AUTH_CANCELLED`. In the renderer's `useMojangLogin`, treat `Cancelled` the same as the `cancelledRef` guard (suppress the toast). This removes the implicit coupling between main-side error mapping and renderer-side ref state.
- **Affects packages:** нет
- **Tests:** Unit: fire `signInWithMojang` then cancel mid-flight; assert the returned `LoginResult.error` is `Cancelled`, and the renderer hook does not set `errorCode` state.

#### AUTH-11 — `absolutizeTextureUrl` in yggdrasilClient.ts works around a server misconfiguration that belongs in the yggdrasil-client package

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/yggdrasilClient.ts:26-39
- **Problem:** Lines 26-39: `absolutizeTextureUrl` detects relative URLs returned by `GET /api/yggdrasil/textures/:uuid` and absolutises them against `mainConfig.apiUrl`. The `YggdrasilClient.getTextures` call is supposed to return fully-qualified URLs per the Yggdrasil spec. The workaround is tied to `mainConfig` (a launcher-specific import) inside a module that is otherwise a pure wrapper around `YggdrasilClient`. This leaks launcher config awareness into a layer that should be config-agnostic.
- **Why it matters:** Any caller of `getYggdrasilClient().getTextures()` that bypasses `fetchTextures` (e.g. skin.ts:185 `client.getTextures(...)`) gets raw potentially-relative URLs, causing silent breakage in media caching or rendering.
- **Proposed solution:** Either: (a) fix the server to always return absolute URLs (preferred, zero code change); or (b) add a `baseUrl` option to `YggdrasilClient` in the yggdrasil-client package that resolves relative URLs before returning — requires edit package src, build, copy dist. As a short-term mitigation, replace all direct `client.getTextures()` calls in skin.ts with the `fetchTextures` wrapper to ensure consistent absolutisation. Note the inconsistency at skin.ts:185 which calls `client.getTextures` directly instead of `fetchTextures`.
- **Affects packages:** loontail-yggdrasil: add `baseUrl` option to `YggdrasilClient` that absolutises response URLs; build + copy dist into node_modules or republish
- **Tests:** Unit: mock `getTextures` returning a relative URL; assert `fetchTextures` returns an absolute URL. Assert skin.ts:185 path also resolves absolute URLs.

#### AUTH-12 — skin.ts calls `client.getTextures` directly at line 185, bypassing the `fetchTextures` absolutisation wrapper

- **Status:** DONE — 2026-05-31 · commit 16cb5c6
- **Category:** Code · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/skin/skin.ts:185
- **Problem:** Line 185: `const before = await client.getTextures(session.profile.uuid).catch(() => null)`. All other texture lookups in the codebase use `fetchTextures` from yggdrasilClient.ts which applies `absolutizeTextureUrl`. This direct call will receive raw potentially-relative URLs from the server, causing `invalidateMediaCache(before.skin.url)` to attempt cache invalidation with a relative key — a no-op since the cache stores absolute URLs.
- **Why it matters:** Cache entries for old textures are never invalidated after `clearSkin`, leading to stale images lingering in the media cache until TTL.
- **Proposed solution:** Replace `client.getTextures(session.profile.uuid)` with `fetchTextures(session.profile.uuid)` at skin.ts:185. Remove the `getYggdrasilClient` import from skin.ts and route all YggdrasilClient access through `fetchTextures` / `getYggdrasilClient().uploadSkin` etc.
- **Affects packages:** нет
- **Tests:** Unit: mock `getTextures` returning relative URL; assert `invalidateMediaCache` receives the absolutised URL.

#### AUTH-13 — Magic number `60_000` (token expiry safety window) is an unexplained inline literal in `verifyMojangSession`

- **Status:** DONE — 2026-05-31 · commit 8c4a375 (resolved with AUTH-19)
- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/mojangAuth.ts:189
- **Problem:** Line 189: `const safetyWindowMs = 60_000;` is a local constant defined inline with no explanation of why 60 seconds was chosen. Per code guidelines, domain numbers should be extracted and named. The choice of 60 seconds is also arguably too small for a network roundtrip-heavy token refresh path (the kit does MSAL refresh + profile read), but this is a design smell not a P0 bug.
- **Why it matters:** Readers cannot distinguish 'one minute' from 'one minute because clock skew is typically <30 s and this gives 2x margin' — the invariant is invisible. If the value needs changing, there is no symbol to search for.
- **Proposed solution:** Extract to a module-level named constant: `const MOJANG_TOKEN_REFRESH_LEAD_MS = 60_000;` with a comment explaining the clock-skew rationale.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-14 — `migrateStoredAuthSecrets` is a misleadingly named no-op wrapper in store.ts, exported and called at init time

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/infra/store.ts:307-309, src/main/services/auth/index.ts:19
- **Problem:** Lines 307-309 of store.ts: `export const migrateStoredAuthSecrets = (): void => { getStoredAuth(); };`. This function is a side-effect wrapper — calling `getStoredAuth()` triggers the legacy migration path (line 282: `AuthSessionSchema.safeParse` on the raw object detects old sessions stored without the metadata split and re-writes them). The export name implies it is migration-specific, but internally it is just a guarded `getStoredAuth`. The auth service calls it from `init()` (index.ts:19).
- **Why it matters:** The naming misleads: future developers may replace `getStoredAuth()` with a different call inside `migrateStoredAuthSecrets`, not realising the migration already happened as a side-effect of `getStoredAuth` itself. The migration logic is buried inside a general read function rather than being explicit.
- **Proposed solution:** Rename the function to `runAuthStoreMigrationIfNeeded()` and add a comment in `getStoredAuth` noting the migration side-effect. Long-term: extract migration into a dedicated path that runs unconditionally at startup, so `getStoredAuth` is a pure read.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-15 — `MojangProfileSkinSchema` is a hand-rolled mirror of a kit type, creating a drift risk

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/shared/contracts/auth.ts:21-29
- **Problem:** Lines 21-29: `MojangProfileSkinSchema` reproduces the shape of `MojangProfileSkin` from minecraft-kit using a `z.ZodType<MojangProfileSkin>` cast. The comment says it is 'kept here so the persisted-store Zod schema can validate it without pulling kit's runtime into shared/'. If the kit adds or renames a field on `MojangProfileSkin`, the schema silently fails to validate the new field (Zod's `object()` strips unknown keys by default), meaning the persisted session may lose fields silently on re-validation.
- **Why it matters:** Silent data loss on session rehydration when the kit's skin shape evolves. Also, the `z.ZodType<T>` cast pattern disables Zod's exhaustiveness check — fields can be added to the type without being added to the schema.
- **Proposed solution:** Either: (a) export a `MojangProfileSkinSchema` from minecraft-kit (requires package change + rebuild); or (b) add a `.passthrough()` to the schema and use `.strip()` only at the point of persisting to avoid unexpected field loss. At minimum, add a compile-time shape check using `satisfies` to catch future kit type changes.
- **Affects packages:** minecraft-kit: export `MojangProfileSkinSchema` from the kit's public surface; build + copy dist
- **Tests:** Unit: parse a session with an extra skin field; assert it is not silently dropped on rehydration.

#### AUTH-16 — `validatePngBuffer` called with `payload.type` which is typed as `SkinKind` ('skin'|'cape'), but yggdrasil-core's signature may expect a different enum — the coupling is implicit

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/skin/skin.ts:171
- **Problem:** Line 171: `validatePngBuffer(payload.buffer, payload.type)` passes the launcher's `SkinKind` ('skin'|'cape') directly to the yggdrasil-core function. The public API of `validatePngBuffer` accepts a `TextureKind` from yggdrasil-core. These two string unions happen to be identical today, but they are defined independently with no compile-time constraint linking them. If yggdrasil-core renames or extends `TextureKind`, the call silently breaks at runtime.
- **Why it matters:** Silent runtime drift: a TypeScript type error would catch a mismatch at compile time, but only if the types are properly related. Currently they are structurally coincident, not explicitly linked.
- **Proposed solution:** Import `TextureKinds` from `@loontail/yggdrasil-core` and assert at compile time that `SkinKind` is assignable to `TextureKind`: `type _check = SkinKind extends TextureKind ? true : never; const _: _check = true;`. Or cast explicitly at the call site with a comment explaining the two unions are intentionally the same.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-17 — Yggdrasil `verifySession` returns `'offline'` on any non-network, non-403 failure from `validate`, hiding server errors

- **Category:** Error handling · **Priority:** P2 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/yggdrasilAuth.ts:87-91
- **Problem:** Lines 87-91: the `catch` block after `client.validate` handles `isNetworkFailure` correctly but then has a `logger.warn` + `return { kind: 'offline' }` for all other errors. This means a 500 Internal Server Error, a malformed response, or a TLS handshake failure is treated as 'offline' (keep the cached session) rather than as 'unknown server error'. The comment says '`offline` keeps the cached copy' which is correct for genuine network partitions but wrong for server-side failures.
- **Why it matters:** A server that consistently returns 500 will never expire the local session — the launcher silently uses a potentially invalid token on every start, and launch will fail with a cryptic game-side auth error rather than a user-friendly 'cannot reach server' prompt.
- **Proposed solution:** Introduce a `{ kind: 'error' }` variant in `VerifyYggdrasilResult`, or at minimum treat `'offline'` as the broader 'cannot determine validity' state and document it as such. Distinguish 'network partition' from 'server error' in logging so the warn message is actionable.
- **Affects packages:** нет
- **Tests:** Unit: mock `client.validate` throwing a non-network, non-403 error (e.g. 500); assert the log level is `warn` and the result kind is observable.

#### AUTH-18 — `uploadSkinYggdrasil` fetches textures twice (before and after upload) without using the `fetchTextures` absolutisation wrapper on the post-upload fetch

- **Status:** DONE — 2026-05-31 · commit 07405d6
- **Category:** Code · **Priority:** P1 · **Risk:** Medium · _(auditor: auth-session-flow)_
- **Area:** src/main/services/skin/skin.ts:89,108
- **Problem:** Lines 89 and 108 both call `fetchTextures` (the wrapper). This is correct. However the `clearSkin` path at line 185 calls `client.getTextures` (the raw client) for the pre-delete snapshot. This inconsistency means URL absolutisation is applied on the upload path but not on the clear path, as noted in a separate task. Additionally, the two `fetchTextures` calls in `uploadSkinYggdrasil` introduce a TOCTOU window: if the server is slow to propagate the new texture, `updatedTextures` at line 108 may return the old URL, causing `prewarmMediaCache` to cache the old texture under the new URL or throw 'Server accepted the upload but did not return a URL'.
- **Why it matters:** Race condition between server-side CDN propagation and the immediate re-fetch can cause the skin upload to appear failed ('Server accepted the upload but did not return an URL') even when it succeeded.
- **Proposed solution:** After upload, add a short retry loop (1-2 retries, 200ms apart) before declaring 'no URL returned'. Add a comment explaining the CDN propagation race. Consider returning the URL from the upload endpoint itself if the server supports it, eliminating the re-fetch entirely.
- **Affects packages:** нет
- **Tests:** Unit: mock `fetchTextures` returning null on first call post-upload, then returning a URL on second call; assert the function retries and succeeds.

#### AUTH-19 — Extract inline `safetyWindowMs = 60_000` magic literal in mojangAuth.ts to a named constant

- **Status:** DONE — 2026-05-31 · commit 8c4a375
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/auth/mojangAuth.ts (L189-190)
- **Problem:** `const safetyWindowMs = 60_000;` is declared inline inside `verifyMojangSession` (L189) with no module-level name. The value 60 000 ms has domain significance (token refresh safety window before expiry) but is indistinguishable from other 60-second timeouts (e.g. `BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS = 60_000` in constants/bundle.ts).
- **Why it matters:** Magic numbers buried in function bodies are opaque to reviewers. The refresh window interacts with the token expiry field stored by the kit; a wrong value here causes silent session invalidity at launch.
- **Proposed solution:** Promote to `const MOJANG_TOKEN_REFRESH_SAFETY_WINDOW_MS = 60_000;` at module level in mojangAuth.ts with a brief comment linking to the Microsoft token expiry spec.
- **Affects packages:** нет
- **Tests:** Unit: verifyMojangSession returns 'ok' when token is unexpired and 'ok' (with refresh) when within the safety window.

#### AUTH-20 — Inline HTTP status codes 401/403 in mojangAuth.ts verifyMojangSession — extract to named constants

- **Status:** DONE — 2026-05-31 · commit 8c4a375
- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/auth/mojangAuth.ts (L204)
- **Problem:** The integer `401` appears inline in `verifyMojangSession` at L204 (`if (httpStatus === 401) return { kind: 'expired' }`) with no named constant. `HTTP_FORBIDDEN = 403` is named in yggdrasilAuth.ts but not shared here. The value 401 is magic in context.
- **Why it matters:** Code reviewers must recall that 401 = Unauthorized to understand the logic. If another HTTP status requires the same treatment it will be added as another magic number.
- **Proposed solution:** Define `const HTTP_UNAUTHORIZED = 401` at module level in mojangAuth.ts (or in a shared `src/main/constants/http.ts` alongside 403/429 from yggdrasilAuth.ts). Import and use in the guard.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-21 — HTTP status code constants (403, 429) in yggdrasilAuth.ts are not shared with mojangAuth.ts

- **Status:** DONE — 2026-05-31 · commit 8c4a375
- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/auth/yggdrasilAuth.ts (L15-16), src/main/services/auth/mojangAuth.ts (L204)
- **Problem:** `HTTP_FORBIDDEN = 403` and `HTTP_TOO_MANY_REQUESTS = 429` in yggdrasilAuth.ts are file-local. mojangAuth.ts hardcodes `401` inline. All three HTTP status codes belong to the auth error-classification domain and should be in a shared `src/main/constants/http.ts`.
- **Why it matters:** New auth-related error handling in any third module would need to redeclare these values, creating a pattern of scattered magic numbers.
- **Proposed solution:** Create `src/main/constants/http.ts` with `HTTP_OK = 200`, `HTTP_UNAUTHORIZED = 401`, `HTTP_FORBIDDEN = 403`, `HTTP_TOO_MANY_REQUESTS = 429`, etc. Import in both auth files.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-22 — Retire AUTH_NETWORK_ERROR and AUTH_INVALID_CREDENTIALS from ERROR_CODES — they are never thrown

- **Status:** DONE — 2026-05-31 · commit b51feb0
- **Category:** Error handling · **Priority:** P1 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/shared/constants/errorCodes.ts, src/renderer/features/auth/hooks.ts
- **Problem:** ERROR_CODES (errorCodes.ts lines 6-7) declares AuthNetworkError ('AUTH_NETWORK_ERROR') and AuthInvalidCredentials ('AUTH_INVALID_CREDENTIALS'). A grep over all of src/main shows zero usages — auth.login returns a discriminated LoginResult union ({ok,error}) instead of throwing coded errors through IPC. The renderer's IPC_LOGIN_ERROR_CODES map in hooks.ts lines 15-17 maps them to LoginErrorCode values, so those renderer branches are permanently dead.
- **Why it matters:** Dead entries in the shared error-code registry mislead future contributors who may believe IPC auth errors arrive as structured IpcErrors with these codes. The renderer mapping consuming them will never fire, making it impossible to test those branches.
- **Proposed solution:** Remove AuthNetworkError and AuthInvalidCredentials from ERROR_CODES. Remove the IPC_LOGIN_ERROR_CODES map and loginErrorCodeFromRejection's IpcError branch from hooks.ts (the fallback LoginError.Unknown already covers non-union IPC rejections). If future Yggdrasil routes need to throw coded IpcErrors for auth failures, re-add then with a real throw site.
- **Affects packages:** нет
- **Tests:** Unit test loginErrorCodeFromRejection: confirm a non-IpcError TypeError maps to NetworkError; a generic error maps to Unknown. Compile-time coverage via ErrorCode type exhaust check.

#### AUTH-23 — resolveLaunchAuth reads getStoredAuth() at call time — not injected, prevents pure unit-testing

- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/launch.ts:183-226
- **Problem:** resolveLaunchAuth() (line 183) calls getStoredAuth() directly from the module scope. It is a private function called from runLaunch(). Any test of launch auth mapping must mock '@main/infra/store' globally (as tests/main/services/minecraft/launch.test.ts does via vi.mock). This is workable but inflexible — you cannot test the auth resolution logic in isolation without setting up the full launch fixture.
- **Why it matters:** The auth-resolution logic (yggdrasil vs mojang vs offline decision tree, dashUuid call, buildAuthlibInjectorJvmArg composition) is non-trivial and currently tested only through the full runLaunch integration path. A direct unit test of resolveLaunchAuth would be simpler and faster.
- **Proposed solution:** Extract resolveLaunchAuth as a pure function that takes the AuthSession (or null) directly instead of calling getStoredAuth(). Pass the resolved auth from runLaunch's callsite. This makes the auth-mapping logic unit-testable without any mock setup.
- **Affects packages:** нет
- **Tests:** Unit tests: yggdrasil session → correct ONLINE auth shape + extraJvmArgs with authlib-injector; mojang session → toOnlineAuth output; null session → OFFLINE auth.

#### AUTH-24 — Extract `absolutizeTextureUrl` from yggdrasilClient.ts into yggdrasil-core or yggdrasil-client

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/auth/yggdrasilClient.ts
- **Problem:** Lines 26-30 define `absolutizeTextureUrl(url: string): string` which handles server-relative texture URLs by resolving them against `mainConfig.apiUrl`. The logic itself (is it http(s)? no → resolve) is generic URL normalisation that belongs in `yggdrasil-client` where `YggdrasilClient.getTextures` is defined, so callers do not need to know about this server quirk.
- **Why it matters:** Any other consumer of `YggdrasilClient.getTextures` (future services, tests) that forgets to call `absolutizeTextureUrl` will receive relative URLs and silently fail to load textures. The fix belongs at the point of production (the client method), not at every point of consumption.
- **Proposed solution:** Extend `YggdrasilClient.getTextures` in `yggdrasil-client` to accept an optional `baseUrl` parameter. When provided, it resolves relative texture URLs against it before returning. The launcher's `fetchTextures` wrapper then passes `mainConfig.apiUrl` and drops its local `absolutizeTextureUrl`. Alternatively, the server should return absolute URLs — but that is a Strapi-side change.
- **Affects packages:** loontail-yggdrasil: добавить параметр `baseUrl` в `YggdrasilClient.getTextures`; пересобрать yggdrasil-client, скопировать dist в node_modules launchers или опубликовать новую версию.
- **Tests:** Unit: `getTextures` with `baseUrl='https://example.com'` resolves `/textures/abc.png` to `https://example.com/textures/abc.png`. Absolute URLs pass through unchanged.

#### AUTH-25 — Replace `YGGDRASIL_PLACEHOLDER_CLIENT_ID` zero-GUID with a branded constant exported from yggdrasil-client

- **Category:** Dependency extraction · **Priority:** P3 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/launch.ts
- **Problem:** Line 44 defines `YGGDRASIL_PLACEHOLDER_CLIENT_ID = asAzureClientId('00000000-0000-0000-0000-000000000000')`. The zero-GUID is a domain-level constant for the Yggdrasil launch path — a placeholder that satisfies the kit's `OnlineAuth.clientId` shape without pointing at a real Microsoft app. This constant is semantically part of the Yggdrasil-kit contract and belongs alongside `buildAuthlibInjectorJvmArg` in `yggdrasil-client`.
- **Why it matters:** If a second consumer of this flow is added (e.g. a CLI launcher), it must rediscover and copy the same zero-GUID. Keeping it in yggdrasil-client makes the intent discoverable.
- **Proposed solution:** Export `YGGDRASIL_PLACEHOLDER_AZURE_CLIENT_ID` (already branded via `asAzureClientId`) from `@loontail/yggdrasil-client`. Remove the local definition in launch.ts and import from the package.
- **Affects packages:** loontail-yggdrasil: добавить экспорт `YGGDRASIL_PLACEHOLDER_AZURE_CLIENT_ID` в yggdrasil-client; пересобрать пакет и обновить dist.
- **Tests:** нет — compile-only change.

#### AUTH-26 — Remove JSDoc block on `withRefreshedProfile` in mojangAuth.ts — what-restating docstring

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/auth/mojangAuth.ts
- **Problem:** Lines 71-75: `/** Apply a fresh kit-provided profile snapshot to the stored session. Mojang profile.* mutations already return the updated profile, so the caller passes it in instead of triggering another GET. */` — the function name `withRefreshedProfile` and its signature (session + profile → MojangSession) already communicate the full intent. The docstring adds nothing a reader cannot extract in three seconds.
- **Why it matters:** Violates §10: 'Multi-line docstrings are unnecessary'. Accumulates comment debt that will diverge from the code over time.
- **Proposed solution:** Delete the three-line docblock above `withRefreshedProfile`. The invariant about 'profile.* mutations already return the updated profile' is the only non-obvious fact; if retained it should be a single inline `//` why-comment on the call site in `uploadSkinMojang`, not a docblock on the function.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-27 — Remove JSDoc blocks on `signInWithMojang`, `cancelMojangLogin`, `verifyMojangSession` inside `createMojangAuth` closure

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/auth/mojangAuth.ts
- **Problem:** Lines 139-145, 176, 182-187: Three JSDoc blocks inside a closure describe what the function names already say (`signInWithMojang` — runs OAuth; `cancelMojangLogin` — aborts in-flight flow; `verifyMojangSession` — validates session). The 'one in-flight flow at a time' invariant is already captured by the inline comment on `activeController` at line 133. `/** Aborts the in-flight signInWithMojang flow, if any. Idempotent. */` is the canonical 'what-restating' anti-pattern.
- **Why it matters:** §10 forbids docstrings that paraphrase identifiers. The closures cannot be picked up by IDE hover reliably (they are not exported types), so docstrings here serve no tooling purpose.
- **Proposed solution:** Delete all three JSDoc blocks. Retain the single-line comment at line 133 ('One in-flight sign-in at a time…') because it explains the race-guard rationale, not what the function does.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-28 — Collapse JSDoc on `getYggdrasilClient` to a single why-comment or remove entirely

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/auth/yggdrasilClient.ts
- **Problem:** Lines 6-12: `/** Shared singleton instance … Constructed lazily on first call … Reuse this everywhere so the authentication, skin upload, and profile-enrichment paths share the same fetch-side fixtures. */` — the function name and the `let cached` variable already show the lazy-singleton pattern. The note about 'share the same fetch-side fixtures' (for testability) is the only why; the rest restates the pattern.
- **Why it matters:** §10: multi-line docstrings are unnecessary; 'Reuse this everywhere' is an instruction, not a why. The singleton intent is visible from `let cached`.
- **Proposed solution:** Replace the 6-line JSDoc with a single `// Lazy singleton — all auth/skin/profile paths share one client instance.` above the function, or delete the block entirely since the pattern is self-evident.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-29 — Remove JSDoc on `fetchTextures` in yggdrasilClient.ts — wraps description of its name

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/auth/yggdrasilClient.ts
- **Problem:** Lines 31-34: `/** Wrap YggdrasilClient.getTextures so callers always receive absolute URLs. See absolutizeTextureUrl. */` — the function body already shows the wrapping with `absolutizeTextureUrl`, and the cross-reference adds nothing. The inline comment at lines 20-25 above `absolutizeTextureUrl` already explains the why (relative URLs from server config).
- **Why it matters:** §10: docstring paraphrases the next identifier and redirects to a comment that is 10 lines earlier — circular.
- **Proposed solution:** Delete the JSDoc block. The inline comment above `absolutizeTextureUrl` (lines 20-25) is the correct keeper; it explains the platform quirk.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-30 — Remove JSDoc on `enrichYggdrasilAccount` in verify.ts — bulk of it is what-restating

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/auth/verify.ts
- **Problem:** Lines 11-19: the JSDoc block contains genuine 'why' content (the skins-registry → yggdrasil-plugin migration context, and why `email` is null). However the opening sentence 'Best-effort enrichment of a Yggdrasil-backed Account with skin and cape URLs' restates the function name. The migration context and the email=null reason ARE worth keeping — they are the canonical platform-quirk explanation.
- **Why it matters:** §10 says one short line is enough; multi-line format that mixes what and why violates the rule. The what must go.
- **Proposed solution:** Replace the full JSDoc with two concise single-line `//` comments: (1) the migration context explaining why the texture endpoint changed, (2) why email stays null for Yggdrasil accounts. No docblock format.
- **Affects packages:** нет
- **Tests:** нет

#### AUTH-31 — Remove verifySession block-comment in verify.ts — partially a caller-reference

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/auth/verify.ts
- **Problem:** Lines 37-43: `// Provider-agnostic session check. Returns the active account on success, null if no session is stored or the server invalidated it, and the cached account if the network is unavailable (offline fallback). Each provider's verify helper distinguishes 'definitely expired' (403/401-equivalent) from 'couldn't reach the server' — only the former clears the stored session.` The first sentence restates the function signature and name. The second sentence about 'definitely expired vs. couldn't reach server' is a genuine architectural invariant.
- **Why it matters:** §10: the first sentence is a what-restatement of the return type union (`Account | null`). The expired/offline distinction is the genuine non-obvious invariant.
- **Proposed solution:** Replace the 7-line block with a single inline comment above the function: `// expired (server-confirmed invalid) clears stored auth; offline (network unavailable) keeps the cached session.`
- **Affects packages:** нет
- **Tests:** нет

### Download / install flow (82)

#### DLI-01 — forgeProcessorActionsCache is a process-global module-level mutable Map with no eviction

- **Category:** Code · **Priority:** P1 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:18, clearForgeProcessorActionCache:60
- **Problem:** `forgeProcessorActionsCache` is a module-level `Map<string, ...>` that accumulates an entry per (directory, mc-version, loader-version, installer-url) tuple every time an install plan is computed. It is never cleared in the normal lifecycle — `clearForgeProcessorActionCache` exists but is not called from MinecraftManager dispose or anywhere in the shipped flow. If a user installs and uninstalls many different Forge clients, the map grows unboundedly in memory for the process lifetime.
- **Why it matters:** Memory leak for long-running sessions with multiple Forge clients. Also makes the cache invisible to tests and unreliable — cached data from a previous test case persists across test runs unless manually cleared.
- **Proposed solution:** Move `forgeProcessorActionsCache` inside `MinecraftManager` (or into `ManagerEnv`) so it is scoped to the service lifecycle and is naturally cleared when the service is disposed. Alternatively cap the map size to e.g. 10 entries (LRU). Call `clearForgeProcessorActionCache` from `manager.cancelAll()` / dispose path.
- **Affects packages:** нет
- **Tests:** Unit test: install two different Forge targets, assert that the cache only grows to a bounded size. Integration test: verify that clearing the manager disposes the cache.

#### DLI-02 — MinecraftManager.startInstall has a double-release risk on the write lock when runInstall is fire-and-forget

- **Category:** Error handling · **Priority:** P1 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/manager.ts:127-151
- **Problem:** In `startInstall`, when `runInstall` succeeds and the optional `launchHook` also succeeds, `lock.release()` is called in the `.then()` callback (line 130). But if `runInstall` throws, the `.catch()` at line 144 calls nothing — only the `.finally()` at line 148 calls `lock.release()`. However if `runInstall` succeeds AND `.then()` calls `lock.release()` but the `launchHook` also throws, the `.finally()` at line 148 calls `lock.release()` again. `ClientOperationLease.release` is idempotent (has a `released` guard), so this is not a crash, but the `.then()` release at line 130 is redundant and confusing — it was likely written when the `launchHook` path was not yet present.
- **Why it matters:** The redundant `lock.release()` in `.then()` is misleading: a reader expects the single canonical release to be in `.finally()`. If `release()` ever gains non-idempotent behaviour (e.g. logging, metric recording), the double-call becomes a real bug.
- **Proposed solution:** Remove the `lock.release()` call from the `.then()` callback at line 130 and rely solely on the `.finally()` at line 148 for all cleanup. Verify the resulting control-flow with a table covering: install success + hook success, install success + hook throw, install throw.
- **Affects packages:** нет
- **Tests:** Unit test: mock runInstall to succeed and launchHook to throw; assert lock.release is called exactly once.

#### DLI-03 — BundleManager.activeLocks map is not cleaned up when sync pauses mid-flight — lock held indefinitely on long pauses

- **Category:** Error handling · **Priority:** P1 · **Risk:** High · _(auditor: arch-boundaries)_
- **Area:** src/main/services/bundle/manager.ts:372-378 (dropActiveSync), 319 (finally clause)
- **Problem:** `dropActiveSync` releases the lock and removes it from `activeLocks`. The `finally` of `executePreparedSync` calls `dropActiveSync` only when `!task.paused || task.cancelled`. When the task is paused (and not cancelled), `dropActiveSync` is NOT called, so the lock entry in `activeLocks` is retained — correct. However if the pause idle timer fires and calls `expirePausedSync`, it calls `dropActiveSync` directly. If for any reason `dropActiveSync` is called and the lock was already released (e.g. by a concurrent `cancelSync`), `lock.release()` is called twice (it is idempotent). The real risk is subtler: `resumeSync` → `continuePausedSync` → `executePreparedSync` → finally on cancel/complete calls `dropActiveSync`, but `activeLocks` may already have been cleared by `expirePausedSync` called from the timer, leaving the `activeLocks.get(slug)` returning `undefined` and the lock never being released via the second code path — the lock object is simply unreachable.
- **Why it matters:** Under concurrent timer expiry + manual resume + cancel the write-lock for a bundle slug can remain acquired permanently, blocking all future Minecraft and bundle operations for that slug until restart.
- **Proposed solution:** Centralise the release point: only `dropActiveSync` should call `lock.release()`. Guard against double-drop by checking `activeLocks.has(slug)` before releasing. Replace the separate `activeLocks` Map with an optional `lease` field on `ActiveSync` itself so the lock and the state are co-located and cleared atomically.
- **Affects packages:** нет
- **Tests:** Integration test: pause a sync, let the idle timer fire (with a small test timeout), then attempt a new sync and verify it is not blocked by a phantom lock.

#### DLI-04 — getClient() is called inside BundleManager.tryGetClient() and minecraft/bundleHealing.ts — cross-service coupling through direct function import, not through a passed dependency

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/services/bundle/manager.ts:346-350 (tryGetClient imports getClient from clients), src/main/services/minecraft/bundleHealing.ts:11 (imports buildContext which imports getClient)
- **Problem:** `BundleManager` imports `getClient` from `@main/services/clients` (line 9) and calls it in `tryGetClient`. `bundleHealing.ts` imports `buildContext` (which in turn imports `getClient` + `getSettings`). The guideline permits cross-service direct imports, but doing so inside manager/business-logic classes makes these classes impossible to unit-test without mocking out the entire clients cache layer. There is no consistent pattern: `MinecraftManager` receives its dependencies through `ManagerEnv`, while `BundleManager` reaches directly into `@main/services/clients`.
- **Why it matters:** Inconsistency: one manager uses DI (MinecraftManager via ManagerEnv), the other bypasses it (BundleManager). Direct imports couple bundle sync tests to the HTTP client cache. `bundleHealing.ts` calling `buildContext` causes a double-settings-read plus a client fetch purely to resolve the Minecraft install path — which is already known by the caller.
- **Proposed solution:** Add a `getClient: (slug: ClientSlug) => Promise<Client | null>` slot to `BundleManager` constructor options (analogous to how `MinecraftManager` gets kit/broadcaster). For `bundleHealing.ts`, pass `ctx: Context` (or just `clientFolder` and `target`) directly from the caller rather than re-building context inside the heal function.
- **Affects packages:** нет
- **Tests:** Unit test for BundleManager that injects a fake getClient returning null and asserts UNKNOWN error is thrown.

#### DLI-05 — LocalManifest parsing in manifestRepo.ts uses manual field checks instead of Zod — inconsistent with all other deserialization

- **Status:** DONE — 2026-05-31 · commit 123bca5
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/bundle/manifestRepo.ts:14-28
- **Problem:** `loadLocalManifest` manually checks `typeof candidate.bundleSlug !== 'string'` etc. (lines 14-24) instead of using a Zod schema. The `LocalManifest` type is defined in shared/contracts/bundle.ts without a schema; the remote manifest has `RemoteManifestSchema` which is used. Every other persistence boundary (store.ts, installManifest.ts) uses `safeParse`. The manual check also does not validate `files` object structure — a corrupt value for a single file entry passes silently.
- **Why it matters:** Inconsistency: a corrupt bundle manifest silently returns `null` without logging what field is wrong. A Zod schema would produce a structured error message. The `files` record is entirely unchecked — malformed entries can cause downstream null-dereferences in `buildPlan`.
- **Proposed solution:** Define `LocalManifestSchema` in shared/contracts/bundle.ts (matching the `LocalManifest` type, with `files` as `z.record(z.string(), z.object({ sha256: z.string(), size: z.number() }))`). Use `LocalManifestSchema.safeParse` in `loadLocalManifest` and log the Zod error on failure.
- **Affects packages:** нет
- **Tests:** Unit test: write a manifest with a missing `manifestHash` field, call loadLocalManifest, assert null is returned and a warn is logged.

#### DLI-06 — Bundle download uses raw Node http/https modules instead of the shared FetchHttpClient from minecraft-kit

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/services/bundle/download.ts:4-8, 31-89
- **Problem:** `download.ts` implements its own HTTP client using `node:http` and `node:https` modules directly with manual redirect following, timeout handling, abort-signal wiring, and `currentRequests` tracking for synchronous cancellation. `@loontail/minecraft-kit` already exports `FetchHttpClient` — however the kit's client may not expose the streaming + synchronous-cancellation pattern needed for bundle downloads. The bundle downloader is a substantial reimplementation (~200 lines) of HTTP behaviour.
- **Why it matters:** Maintenance burden: two HTTP implementations to keep in sync (infra/http.ts using fetch, and bundle/download.ts using raw streams). Bug surface: the manual redirect follower, abort wiring, and tmp-file cleanup are custom. If the kit's FetchHttpClient gains the needed capabilities, the duplication can be eliminated.
- **Proposed solution:** Audit whether `FetchHttpClient` from minecraft-kit supports streaming responses with per-chunk callbacks and synchronous request cancellation via `Set<ClientRequest>`. If it does (or can be extended), migrate bundle/download.ts to use it. If not, document the gap as a potential kit enhancement. Note: changing kit requires editing package src, rebuilding, and copying dist into node_modules (or republishing + bumping pinned version 0.8.13).
- **Affects packages:** minecraft-kit: FetchHttpClient — if extended to support streaming chunk callbacks and synchronous socket cancellation, bundle/download.ts can be simplified. Requires: edit kit src → build → copy dist or republish.
- **Tests:** Integration test: download a file through the bundle downloader, abort mid-flight, assert the tmp file is cleaned up.

#### DLI-07 — installManifest.ts duplicates package.json version reading via createRequire — fragile and not covered by kit's version tracking

- **Category:** Dependency extraction · **Priority:** P3 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/installManifest.ts:13,45-46
- **Problem:** `createRequire(import.meta.url)` is used at line 13 to `require('@loontail/minecraft-kit/package.json')` at line 45, then the version string is parsed manually. This bypasses the kit's own version constant. If the kit ever exposes a `MINECRAFT_KIT_VERSION` constant or a `kitVersion` export, this pattern becomes redundant. Additionally, `createRequire` in an ES module context is non-standard and may break under some bundler configurations.
- **Why it matters:** Fragile version extraction. If the kit package is bundled or relocated, the require path breaks. The version is used as part of the install manifest's invalidation key — a wrong value causes spurious re-installs.
- **Proposed solution:** Check whether `@loontail/minecraft-kit` exports a version constant. If not, read the kit version from the launcher's own package.json `dependencies` field (which electron-vite can inline via `define`) rather than requiring the dependency's package.json at runtime.
- **Affects packages:** minecraft-kit: if a MINECRAFT_KIT_VERSION string constant were exported from the kit's public API, installManifest.ts could import it directly. Requires: edit kit src → build → copy dist.
- **Tests:** нет

#### DLI-08 — Lock release not guarded by try/finally in executePreparedSync — lock leaks on continuePausedSync throw

- **Status:** DONE — 2026-05-31 · commit ce377ff
- **Category:** Error handling · **Priority:** P0 · **Risk:** High · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** acquireWriteLock (line 226) stores the lease in activeLocks, then executePreparedSync is called (line 234). dropActiveSync (line 372) releases the lock, but it is called only from catch (line 320) or from the finally block at line 318-322. When continuePausedSync calls executePreparedSync (line 253) and that call throws before reaching the catch, the finally at line 318-322 correctly runs — HOWEVER, if continuePausedSync itself throws (e.g. the re-plan via loadLocalManifest fails synchronously before executePreparedSync even starts), the outer resumeSync void-chain at line 137 swallows the error via .catch(warn), and dropActiveSync is never called. The active sync and lock remain in their maps forever, wedging the slug for the rest of the session.
- **Why it matters:** A paused-then-resumed sync that fails to load the local manifest (I/O error on the sidecar file) produces an undead activeSyncs + activeLocks entry. The slug cannot be re-synced until app restart. The operation lock also blocks any Minecraft launch for the same client.
- **Proposed solution:** Wrap continuePausedSync in a try/finally that calls dropActiveSync when the result is neither a clean-exit nor a legitimate paused state. Alternatively, move lock acquisition inside executePreparedSync so the finally in that function covers all exit paths including the resumed case.
- **Affects packages:** нет
- **Tests:** Unit test: spy on dropActiveSync; stub loadLocalManifest to reject; call resumeSync; assert dropActiveSync was called and activeSyncs does not contain the slug.

#### DLI-09 — Local manifest deserialised with hand-rolled structural check instead of Zod — silent data corruption risk

- **Status:** DONE — 2026-05-31 · commit 123bca5
- **Category:** Code · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manifestRepo.ts
- **Problem:** loadLocalManifest (lines 12-26) reads the sidecar JSON and validates it via a Partial<LocalManifest> cast plus four typeof guards. This misses the shape of individual file entries (Record<string, LocalManifestFile>), doesn't validate that sha256 and size are present and correctly typed inside files, and uses `as LocalManifest` at line 26 — a type lie that bypasses strict-null safety downstream in buildPlan. A corrupted or schema-drifted sidecar silently produces a LocalManifest where file entries may have undefined sha256 values, causing the hash fast-path in plan.ts (line 102) to produce false-positive skips.
- **Why it matters:** If a sidecar written by an older launcher version omits the size field, or if a user edits it, every entry in files looks valid but sha256 comparisons compare undefined === entry.sha256 — always false — so every file is re-downloaded, but worse: if the field is present but wrong type, TS won't catch it at runtime and the planner silently passes the wrong data to the diff.
- **Proposed solution:** Add a LocalManifestSchema (z.object) in shared/contracts/bundle.ts mirroring LocalManifest and its LocalManifestFile record shape. Use safeParse in loadLocalManifest and return null on failure, logging the Zod error.
- **Affects packages:** нет
- **Tests:** Unit tests for loadLocalManifest: valid JSON passes; missing bundleSlug returns null; files entry missing sha256 returns null; extra unknown keys pass (strip or passthrough).

#### DLI-10 — HEAL_PROGRESS_THROTTLE_MS is a magic literal duplicating the exported bundle constant

- **Status:** DONE — 2026-05-31 · commit c8cc5c2
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/healProgress.ts
- **Problem:** HEAL_PROGRESS_THROTTLE_MS is defined as 100 (line 6) inside healProgress.ts. BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS is also 100 and is already exported from src/main/constants/bundle.ts. The two throttle intervals should be consistent — the heal phase emits to the same renderer IPC channel as the download phase — but they are maintained separately.
- **Why it matters:** If the download throttle is later tuned (e.g. lowered to 50 ms for smoother progress), the heal phase will lag behind, producing visibly choppier animation during the healing sub-phase. The two files have no shared reference.
- **Proposed solution:** Import BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS from @main/constants/bundle and replace the magic literal in healProgress.ts. Remove the local constant.
- **Affects packages:** нет
- **Tests:** нет

#### DLI-11 — UP_TO_DATE path persists local manifest with an empty-object remoteManifest

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manager.ts, src/main/services/bundle/syncState.ts
- **Problem:** When totalFiles === 0 (line 280), executePreparedSync calls completePreparedSync with status UP_TO_DATE (line 281). completePreparedSync always calls persistLocalManifest (line 326). persistLocalManifest calls flattenRemote(active.remoteManifest) (line 332). active.remoteManifest is initialised to {} (syncState.ts line 53) and is only populated inside the loadRemoteManifest closure (manager.ts line 239). If the UP_TO_DATE branch is hit (zero files to process) but loadRemoteManifest populated the remote manifest correctly, the save is fine. However, if totalFiles === 0 because the plan found zero entries (all skipped), the remote manifest IS populated. The problem occurs only in a future regression where the UP_TO_DATE branch is reached before loadRemoteManifest runs — but the code currently allows that because remoteManifest starts empty and is assigned inside loadRemoteManifest which is awaited at line 269, just before the check. Currently safe, but the dependency is implicit and fragile.
- **Why it matters:** If loadRemoteManifest is ever refactored or conditionally short-circuited, persistLocalManifest would write a manifest with an empty files map, effectively forgetting all previously tracked files. The next sync would re-hash or re-download everything.
- **Proposed solution:** Assert that active.remoteManifest is non-empty before calling persistLocalManifest, or store the remote manifest on the task (not on active) immediately after the await at line 269, making the data flow explicit. Also add a guard in persistLocalManifest that logs a warning and skips the write if remoteManifest is empty.
- **Affects packages:** нет
- **Tests:** Unit: verify persistLocalManifest is NOT called when remoteManifest is empty; integration: UP_TO_DATE sync writes a valid non-empty manifest.

#### DLI-12 — resolveClientFolder returns an empty string on missing settings instead of throwing — defensive guard inconsistently applied

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** resolveClientFolder (line 354-357) returns an empty string when the settings have no clientFolder configured. Callers must null-check the result: runSync does (line 219-224), getInstallState does (line 182-183), and resetForUninstall does (line 455). But if a future callsite forgets the guard, an empty string is passed to resolveSafeEntryPath which will resolve paths relative to the process CWD — a path-traversal risk outside the intended client folder.
- **Why it matters:** A missing null-check could write or delete files in the launcher's working directory instead of the client folder. Even without a path-traversal, passing an empty string to loadLocalManifest produces a path like `.loontail/bundle.json` in the CWD — a silent stale-data bug.
- **Proposed solution:** Change resolveClientFolder to return string | null (or throw BundleError with NO_CLIENT_FOLDER directly). This makes the type-system enforce the guard at every callsite rather than relying on convention. Alternatively extract validateClientFolder that throws, and call that instead of the pattern `const folder = ...; if (!folder) throw`.
- **Affects packages:** нет
- **Tests:** Unit: missing settings → runSync throws BundleError(NO_CLIENT_FOLDER); resetForUninstall with missing settings is a no-op.

#### DLI-13 — flattenEntries and flattenRemote are parallel implementations of the same manifest-flattening logic

- **Status:** DONE — 2026-05-31 · commit 44a4bc8
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/plan.ts, src/main/services/bundle/manifestSnapshot.ts
- **Problem:** flattenEntries (plan.ts line 25-34) iterates RemoteManifest, skips dirs, and returns a list of RemoteManifestEntry. flattenRemote (manifestSnapshot.ts line 4-14) iterates the same structure, skips dirs, skips entries without sha256, and returns the files Record. Both skip isDir entries. They diverge only in their output shape and the sha256 filter in flattenRemote.
- **Why it matters:** If the RemoteManifest structure gains a new category or the isDir convention changes, two separate iteration functions must both be updated. The duplication obscures the canonical traversal contract.
- **Proposed solution:** Extract a shared flattenManifestEntries(manifest: RemoteManifest): RemoteManifestEntry[] from plan.ts's flattenEntries. Have flattenRemote consume it. Export from manifestSnapshot.ts or a new paths/manifest utility module if both callers need it.
- **Affects packages:** нет
- **Tests:** Existing unit tests for buildPlan and flattenRemote cover the logic; add a test that confirms flattenManifestEntries matches flattenRemote's source iteration.

#### DLI-14 — The bundle download layer re-implements HTTP streaming with node:http/https instead of reusing minecraft-kit's FetchHttpClient

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/download.ts
- **Problem:** download.ts (lines 31-89) implements its own HTTP request pipeline using node:http and node:https directly: it builds transport from the URL scheme, manages a `currentRequests` set for abort/socket-destroy, follows redirects manually (followRedirects, lines 93-109), and handles timeouts via req.on('timeout'). minecraft-kit exports FetchHttpClient — a fetch-based HTTP abstraction already used throughout the main process. The bundle download uses none of it.
- **Why it matters:** The custom node:http layer duplicates roughly 80 lines of HTTP plumbing that is already tested inside minecraft-kit. It also cannot benefit from any future caching, retry, or telemetry improvements made to FetchHttpClient. The currentRequests socket-destroy hack (manager.ts line 151-153) exists only because node:http requests expose destroy(); a fetch-based approach that respects AbortSignal would not need a parallel socket registry.
- **Proposed solution:** Evaluate whether FetchHttpClient from minecraft-kit can stream response bodies (check if it returns a ReadableStream / Response with .body). If yes, replace requestOnce + followRedirects with a single fetch call piped through the integrity hash. If the kit's client doesn't support streaming downloads, document the gap as a minecraft-kit enhancement (requires edit to package src, build, copy dist). Either way, remove the currentRequests Set from SyncTask once the AbortSignal path is sufficient.
- **Affects packages:** minecraft-kit: FetchHttpClient may need a streaming download method if it currently buffers entirely. Requires: edit package src → build → copy dist into launcher node_modules (or republish + bump pin).
- **Tests:** Integration test: downloadEntry with a mock HTTPS server; verify SHA-256 mismatch throws DOWNLOAD_INTEGRITY_FAILED; verify abort mid-stream throws ABORTED and leaves no tmp file.

#### DLI-15 — downloadEntry does not pipe the response into the write stream atomically — integrity hash is computed from response chunks but writeStream may receive corrupted data on Windows path issues

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/download.ts
- **Problem:** In downloadEntry (lines 132-193), the response is piped to writeStream (line 177) and the SHA-256 hash is computed in the response 'data' event (line 144). The 'finish' event on writeStream triggers the hash check (line 149). However, the 'data' event and the writeStream may advance independently: response.pipe() transfers data to the write stream, but if the write stream buffers and node flushes asynchronously, the 'finish' event fires only after all writes are flushed. This is safe for a well-behaved stream. However, if writeStream emits 'error' after 'finish' has already settled (possible on Windows when the OS defers flush errors), the settled flag prevents the reject call, and the rename step proceeds with a potentially incomplete file. The fail() guard at line 136 (settled check) protects against double-settle, but does not protect against a post-finish write error.
- **Why it matters:** On Windows with antivirus file-system hooks, writeStream 'error' can fire after 'finish' in edge cases. The code will rename the tmp file to the destination, then the caller proceeds with a file that may have a wrong tail, which the SHA-256 check at finish time already cleared — meaning the corrupted bytes are post-hash. The result: a silently bad file on disk with a green checksum.
- **Proposed solution:** Move the SHA-256 validation into the writeStream 'finish' handler only after calling writeStream.end() explicitly and awaiting the 'close' event (not 'finish') of the write stream, which fires after the OS flush. Alternatively use fs.promises.pipeline (Node 16+) which propagates errors from all stages and only resolves after full flush. This also removes the manual pipe + event coordination.
- **Affects packages:** нет
- **Tests:** Integration test on Windows: stub fs.createWriteStream to emit 'error' after 'finish'; verify the error is caught and the tmp file is removed.

#### DLI-16 — pauseSync sets task.abort.abort() before task.paused is checked by runDownloadWorker — race window between pause signal and worker exit

- **Category:** Flow · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manager.ts, src/main/services/bundle/runner.ts
- **Problem:** pauseSync (manager.ts line 111-120) sets task.paused = true (line 115) and then calls task.abort.abort() (line 118). runDownloadWorker checks !task.paused at the top of its while loop (runner.ts line 91). The abort signal causes the current download to reject with BundleError(ABORTED). The catch in runDownloadPhase (line 120-124) checks !firstError and then clears pendingDownloads (line 123). BUT: the error is rethrown (line 128-136) up to executePreparedSync's catch. In executePreparedSync catch (manager.ts line 306), the code checks task.paused (line 312) — if task.paused is true and the code is BundleError(ABORTED), it silently returns. This seems correct. However, if multiple workers are running (concurrency=16) and one worker drains pendingDownloads (line 123) while other workers haven't checked task.paused yet, they will see an empty queue (entry = undefined at shift, line 93) and exit normally. The firstError from the aborting worker is still stored, and the phase throws. The result is correct but the interaction relies on the JS event loop order — if the abort fires between the while-condition check and the entry.shift, it could be missed in a future refactor.
- **Why it matters:** The current implementation is correct under Node's cooperative concurrency, but the interplay between abort signal, the cooperative task.paused flag, and the firstError drain is non-obvious. A future developer adding a retry-on-transient-error path inside runDownloadWorker could break the invariant.
- **Proposed solution:** Add an explicit comment in runDownloadWorker that explains the two-phase stop mechanism (abort signal destroys the active HTTP request, task.paused prevents starting the next one). Consider replacing task.abort: AbortController with a dedicated PauseController from minecraft-kit to make pause semantics explicit and consistent with the install flow.
- **Affects packages:** minecraft-kit: PauseController is already exported; reuse it for pause/resume instead of the bespoke AbortController re-creation in resetTaskForResume.
- **Tests:** Integration: simulate pause arriving mid-download with multiple workers; assert no files are partially downloaded after resume; assert processedFiles is consistent.

#### DLI-17 — getInstallState makes a network request on every call — UI query may flood the manifest endpoint

- **Category:** Performance · **Priority:** P2 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** getInstallState (lines 167-199) calls fetchRemoteManifest (line 193) on every invocation to check for drift. The renderer calls this via bundleCheckStatus on every useBundleStatus mount (hooks.ts line 53). With MAX_STATUS_SEED_CONCURRENCY=3, up to three concurrent manifest fetches are allowed. But if the user opens a client list with 5+ clients, or if the component remounts frequently, this produces multiple uncached GET requests to the Strapi manifest endpoint.
- **Why it matters:** The manifest endpoint returns the full JSON (potentially hundreds of KB per bundle). Frequent status checks during navigation or component remounting degrade startup latency and put unnecessary load on the server. There is no ETag/If-None-Match support and no client-side cache.
- **Proposed solution:** Cache the manifest hash per bundleSlug with a short TTL (e.g. 30 seconds) in memory, returning the cached result without a network call if the TTL has not expired. Alternatively, separate the drift check into a background periodic poll (e.g. every 5 minutes) and use the cached result in getInstallState. minecraft-kit exports createMemoryCache which could be used for this.
- **Affects packages:** minecraft-kit: createMemoryCache is available and could be reused without package changes.
- **Tests:** Unit: second call within TTL does not invoke fetchRemoteManifest; call after TTL expiry re-fetches.

#### DLI-18 — buildPlan makes sequential disk I/O (exists + hashFile) in a for loop — O(n) sequential awaits for large manifests

- **Category:** Performance · **Priority:** P2 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/plan.ts
- **Problem:** buildPlan (lines 57-155) iterates remoteEntries in a single for...of loop with sequential await calls to exists() (line 102, 107, 112) and hashFile() (line 121). For a bundle with 500 files, this is 500+ serial I/O operations. Each hashFile streams the file and computes SHA-256 serially.
- **Why it matters:** On a cold disk, sequential stat/read calls for 500 files can take 5-10 seconds. This blocks the PLANNING phase status, making the UI appear stuck on an indeterminate spinner. The minecraft-kit verifyMinecraft runs in parallel — the bundle planner should too.
- **Proposed solution:** Replace the sequential for loop with Promise.all over batched groups (e.g. using p-limit with concurrency 8) or a concurrent worker-pool pattern similar to runDownloadWorker. All exists/hashFile calls are independent per entry.
- **Affects packages:** нет
- **Tests:** Benchmark: buildPlan with 200-entry manifest; assert total wall time < 2s on SSD. Unit: confirm classification is identical between sequential and parallel versions.

#### DLI-19 — saveLocalManifest rename is not atomic on Windows when target already exists — intermediate state visible to concurrent readers

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manifestRepo.ts
- **Problem:** saveLocalManifest (lines 34-44) writes to a .tmp file and then renames it (line 43). On Windows, fs.rename when the destination exists throws EPERM if another process holds the file. The comment in download.ts (line 196) documents this pattern and suggests doing rm then rename. manifestRepo.ts does not do the rm step — it calls fs.rename directly (line 43) without first removing the existing manifest. On Windows, if the main process reads the manifest concurrently (loadLocalManifest during a checkStatus call), the file handle may block the rename and throw EPERM, losing the manifest write silently (the catch in persistLocalManifest in manager.ts line 340 only warns).
- **Why it matters:** A failed manifest write means the next launch will find a stale local manifest with old sha256 hashes. The planner will classify files with changed sha256 as needing update (correct) but files with matching sha256 as up-to-date — even if they were actually modified. The result is a silently stale bundle.
- **Proposed solution:** Mirror the pattern from download.ts (line 197-199): call fsp.rm(target, { force: true }) before fsp.rename(tmp, target) in saveLocalManifest. This is idempotent on ENOENT and avoids EPERM from a concurrent reader if the original file was not locked.
- **Affects packages:** нет
- **Tests:** Windows-specific integration test: concurrent loadLocalManifest + saveLocalManifest; assert the saved manifest is readable after the rename.

#### DLI-20 — AbortController is recreated on resume (resetTaskForResume) but the old controller's listeners are not cleaned up

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/syncState.ts, src/main/services/bundle/download.ts
- **Problem:** resetTaskForResume (syncState.ts line 60-70) assigns task.abort = new AbortController() (line 63). The old AbortController is discarded. However, download.ts registers an 'abort' event listener on the old signal (line 86): options.signal.addEventListener('abort', onAbort, { once: true }). If this listener is still registered on the old signal when the controller is replaced, the old signal is unreachable — but the onAbort closure holds a reference to req (the ClientRequest), preventing GC until the old signal is eventually collected. On a long session with many pause/resume cycles, this accumulates.
- **Why it matters:** Each pause/resume cycle that is mid-download at the time of pause leaves an orphaned onAbort closure on the old AbortSignal. With BUNDLE_DOWNLOAD_CONCURRENCY=16 workers per download and BUNDLE_PAUSED_SYNC_MAX_IDLE_MS=5 minutes, up to 16 closures per pause cycle can accumulate. On a slow connection with frequent user pauses, this is a minor but real memory leak.
- **Proposed solution:** Ensure all in-flight downloads have completed (or been destroyed) before resetTaskForResume replaces the controller. The current flow already calls task.abort.abort() in pauseSync (manager.ts line 118) which triggers onAbort via the { once: true } listener, which removes itself via req.on('close'). So by the time continuePausedSync is called, the listeners should be gone. Add an assertion (or debug log) that task.currentRequests.size === 0 at the start of resetTaskForResume to make this invariant explicit.
- **Affects packages:** нет
- **Tests:** Unit: verify currentRequests is empty before resetTaskForResume is called in the resume path.

#### DLI-21 — De-duplicate persistTargetInstallManifest — lives in both install.ts and repairWorkflow.ts

- **Status:** DONE — 2026-05-31 · commit 323ea57
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/install.ts:55-65, src/main/services/minecraft/repairWorkflow.ts:66-76
- **Problem:** Both files define an identical private async function persistTargetInstallManifest(env, slug, ctx) that calls saveCurrentTargetInstallManifest and swallows errors with a warn log. The implementations are line-for-line identical except for the log tag ('install' vs 'repair').
- **Why it matters:** Any change to the error-swallowing pattern or log message must be made in two places. This has already drifted slightly (log prefix differs). Violates the guideline against duplication.
- **Proposed solution:** Export a single persistTargetInstallManifest helper from installManifest.ts (which already owns saveCurrentTargetInstallManifest and the manifest file path logic) — or create a shared helper in a new minecraft/manifestHelpers.ts. Accept a logger + label parameter so install vs repair can be distinguished. Both callers import and call the shared function.
- **Affects packages:** нет
- **Tests:** Unit test: verify error is swallowed with a warn log and the function does not throw.

#### DLI-22 — Cancel of UninstallOp is silently ignored — cancel() has no branch for UNINSTALL

- **Status:** DONE — 2026-05-31 · commit a452fc0
- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/manager.ts:171-185, src/main/services/minecraft/ops.ts:27
- **Problem:** MinecraftManager.cancel() (manager.ts:171-185) handles INSTALL, REPAIR, BUNDLE_SYNCING, and LAUNCH_STARTING ops, but has no branch for OpKinds.UNINSTALL. UninstallOp (ops.ts:27) carries no abort controller — uninstall is currently uninterruptible by design — but cancel() silently does nothing if called during uninstall, which is consistent with that design choice. However, cancelAll() (manager.ts:275) also silently skips UNINSTALL. There is no logging or IPC notification when cancel is called on an in-progress uninstall.
- **Why it matters:** A user clicking Stop during uninstall gets no feedback. The manager silently ignores the cancel, leaving the UI potentially stuck on UNINSTALLING with no way to know the operation cannot be aborted. No comment explains the intentional non-cancellability.
- **Proposed solution:** Add a comment in cancel() explaining UninstallOp is not cancellable by design (atomic file removal). If a future AbortController is added to UninstallOp, the branch is already needed. Optionally emit a warn log when cancel() is called with an UNINSTALL op so the IPC layer can surface it as an OP_IN_FLIGHT error instead of a silent no-op.
- **Affects packages:** нет
- **Tests:** Unit test: call cancel() with an active UninstallOp — verify no exception and state remains UNINSTALLING.

#### DLI-23 — BundleSyncingOp abort not wired into BUNDLE_SYNCING cancelAll path

- **Status:** DONE — 2026-05-31 · commit a452fc0
- **Category:** Flow · **Priority:** P2 · **Risk:** Medium · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/manager.ts:275-288
- **Problem:** cancelAll() (manager.ts:275-288) iterates ops and calls cancel() for INSTALL, REPAIR, and LAUNCH_STARTING. It explicitly skips LAUNCH ops (by design — game session). But it also skips BUNDLE_SYNCING ops. If the app shuts down while a bundle sync is in progress (OpKinds.BUNDLE_SYNCING), the in-flight download is not aborted and the process may hang waiting for the network call to complete.
- **Why it matters:** App shutdown with an active bundle sync hangs the Node.js process waiting for the network fetch to resolve. Electron's quit sequence may be blocked for the entire TCP timeout.
- **Proposed solution:** Add OpKinds.BUNDLE_SYNCING to the cancelAll() abort set alongside INSTALL and REPAIR. The BundleSyncingOp already has an AbortController (ops.ts:33) and cancel() already handles it. cancelAll just needs to include the BUNDLE_SYNCING case.
- **Affects packages:** нет
- **Tests:** Unit test cancelAll: verify BUNDLE_SYNCING op's abort.abort() is called.

#### DLI-24 — download.ts implements its own HTTP client (http/https.request, redirect following, timeout) duplicating minecraft-kit's FetchHttpClient capability

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/bundle/download.ts (lines 31-109)
- **Problem:** The bundle download subsystem maintains its own low-level HTTP client: raw http/https.request calls, manual redirect following (followRedirects, BUNDLE_DOWNLOAD_MAX_REDIRECTS), manual timeout handling, and manual socket destruction for cancellation (currentRequests Set). minecraft-kit exports FetchHttpClient which wraps the Fetch API with redirect, retry, and signal support. The launcher also has @main/infra/http (httpRequest) for API calls.
- **Why it matters:** Two independent HTTP stacks in the same process means doubled maintenance surface. The bundle download client does not benefit from any centralised retry/backoff logic added to the kit's client. The currentRequests Set pattern for socket cancellation is a bespoke mechanism that could be replaced by AbortSignal (which the Fetch API supports natively). Guideline: do not re-implement what minecraft-kit provides.
- **Proposed solution:** Evaluate whether FetchHttpClient covers bundle download needs (streaming body, progress callbacks per-chunk, no-verify-TLS override). If yes, migrate downloadEntry to use it and remove download.ts's http/https.request stack. If streaming chunk callbacks are not supported by FetchHttpClient, file a kit enhancement (minecraft-kit: add streaming download with onChunk callback; build+copy-dist note applies). Until then, at minimum consolidate the timeout constant and redirect limit with the kit's defaults.
- **Affects packages:** minecraft-kit: consider exposing a streaming download helper with per-chunk callback; requires edit package src -> build -> copy dist into launcher node_modules or republish+bump pinned version
- **Tests:** Integration: downloadEntry handles redirect chains, timeout, abort signal, SHA-256 mismatch.

#### DLI-25 — manifestRepo.ts uses ad-hoc object casting instead of Zod schema validation for LocalManifest

- **Status:** DONE — 2026-05-31 · commit 123bca5
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/bundle/manifestRepo.ts (lines 12-26)
- **Problem:** loadLocalManifest casts parsed JSON to Partial<LocalManifest> (line 15) and then manually checks four top-level fields via typeof. This is a hand-rolled schema guard that misses nested structure (e.g. files entries being { sha256, size }). By contrast, installManifest.ts uses a Zod schema (TargetInstallManifestSchema) for the equivalent sidecar file. Inconsistent validation approach; a malformed files record would be returned as-is (passed as LocalManifest) even if individual file entries are wrong.
- **Why it matters:** A corrupted or tampered bundle manifest with valid top-level keys but corrupt files entries would be accepted and drive incorrect plan diffs. Guideline: validate input at system boundaries.
- **Proposed solution:** Define a Zod schema for LocalManifest (LocalManifestSchema) and call safeParse in loadLocalManifest, discarding and warning on failure, consistent with installManifest.ts.
- **Affects packages:** нет
- **Tests:** Unit: loadLocalManifest with a manifest where files entries have wrong types — must return null.

#### DLI-26 — runSyncPhases in bundle/runner.ts drains pendingDownloads queue in a mutable imperative loop with no structured concurrency; firstError swallowing hides multiple concurrent failures

- **Category:** Code · **Priority:** P2 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/bundle/runner.ts (lines 110-138)
- **Problem:** runDownloadPhase spawns N workers via a for loop and passes a shared firstError variable. Each worker catches and stores the first error, then sets pendingDownloads.length = 0 to signal other workers. Only firstError is re-thrown; all subsequent errors are silently swallowed (lines 118-124). If two workers fail simultaneously with different errors (e.g. one INTEGRITY, one NETWORK), only one code reaches the error classifier — the other is lost.
- **Why it matters:** Duplicate error types can mislead diagnostics. The pendingDownloads.length = 0 mutation is a side-channel stop mechanism that bypasses AbortSignal — it could interact poorly with pause/resume if a worker reads the array after it's been truncated.
- **Proposed solution:** Replace the shared mutable firstError with an AbortController that workers abort on first failure. Log secondary errors at debug level. After Promise.all, rethrow the primary error. The shared queue truncation can remain as an optimisation but should be gated on signal.aborted rather than the array mutation.
- **Affects packages:** нет
- **Tests:** Unit: two concurrent worker failures — only one error propagates; AbortSignal is aborted after first failure; remaining workers exit cleanly.

#### DLI-27 — Extract shared throttled-progress-emitter into a single reusable primitive

- **Status:** DONE — 2026-05-31 · commit c8cc5c2
- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/progressAdapter.ts (L121-167), src/main/services/bundle/healProgress.ts (L1-79), src/main/services/bundle/runner.ts (L58-88)
- **Problem:** Three separate throttled-progress implementations exist: `createThrottledProgressEmitter` in progressAdapter.ts (L121-167), the inline throttle in `createHealProgressListener` (healProgress.ts L22-49), and `maybeEmit` in runner.ts (L58-88). All three track `lastEmittedAt`, a `pendingFlush` timeout, and call `clearTimeout`/`setTimeout` with the same 100 ms interval. The HEAL_PROGRESS_THROTTLE_MS (100), PROGRESS_THROTTLE_MS (100), and BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS (100) are the same literal defined three times in three different files.
- **Why it matters:** Any change to throttle behaviour (interval, flush-on-dispose semantics, timer.unref) must be applied in three places. A missed site causes inconsistent UX (different services flush at different rates). Divergence has already appeared: runner.ts does not call `timer.unref()` but progressAdapter.ts does (L162).
- **Proposed solution:** Create `src/main/infra/throttledEmitter.ts` exporting `createThrottledEmitter<T>(intervalMs: number, emit: (value: T) => void)` with `push(value: T): void` and `dispose(): void`. Extract the single shared constant `PROGRESS_THROTTLE_MS` into `src/shared/constants/progress.ts`. Rewrite the three callsites to use this primitive.
- **Affects packages:** нет
- **Tests:** Unit: createThrottledEmitter — verify: (a) first push emits immediately, (b) second push within interval is deferred, (c) dispose cancels pending timeout, (d) timer.unref is called when available.

#### DLI-28 — Deduplicate `persistTargetInstallManifest` copied between install.ts and repairWorkflow.ts

- **Status:** DONE — 2026-05-31 · commit 323ea57
- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/install.ts (L55-65), src/main/services/minecraft/repairWorkflow.ts (L66-76)
- **Problem:** `persistTargetInstallManifest` is copy-pasted verbatim in both files (identical body: call `saveCurrentTargetInstallManifest`, log a warn on failure). The only difference is the log prefix ('install' vs 'repair').
- **Why it matters:** A bug fix or change to the persistence logic (e.g. adding a retry) requires editing two files. Divergence risk is high: the install path already omits the `kitVersion` guard the repair path added in a prior PR.
- **Proposed solution:** Move `persistTargetInstallManifest(env, slug, ctx)` into `installManifest.ts` (or a shared `targetManifest.ts` helper) with an optional `logPrefix` parameter. Import it in both callsites.
- **Affects packages:** нет
- **Tests:** Unit: verify warn-on-failure does not re-throw (guideline: do not demote a successful op); integration: install flow still writes manifest after a successful plan run.

#### DLI-29 — Add assertNever exhaustiveness to MinecraftManager.cancel() op-kind dispatch

- **Status:** DONE — 2026-05-31 · commit a452fc0
- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/manager.ts (L172-185)
- **Problem:** `cancel()` checks op kinds with a chain of `else if` branches (L174-184) but has no `else assertNever(op)` fallthrough. `OpKinds.UNINSTALL` (which has no abort controller) and any future op kinds are silently ignored — cancel is a no-op for them. The guidelines require discriminated-union + assertNever exhaustiveness.
- **Why it matters:** If a new OpKind is added (e.g. VERIFYING), cancel will silently do nothing, leaving the op stuck. The user sees no feedback and the lock is never released.
- **Proposed solution:** Import `assertNever` from `@loontail/minecraft-kit` (already available in the codebase). Restructure the dispatch as a switch statement with a `default: assertNever(op)` arm. For `UNINSTALL` (which genuinely has no abort), add an explicit empty branch with a comment.
- **Affects packages:** нет
- **Tests:** Unit: call cancel() for each OpKind and assert no exception; TypeScript compile check catches new Op variants at build time.

#### DLI-30 — Fix `resolveClientFolder` returning empty string `''` instead of `null` for missing folder

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/manager.ts (L354-357)
- **Problem:** `resolveClientFolder` (L354-357) returns `resolved.storage.clientFolder || ''`. The caller at L181 guards with `if (!clientFolder)` (falsy check) and at L355 uses `if (!clientFolder) return;`. However `resolveClientInstallPresence` in readinessPolicy.ts (L21) explicitly uses `=== null` after returning `null` for the same conceptual absence. The return type is inferred as `string`, hiding the nullable intent.
- **Why it matters:** Returning `''` instead of `null` makes the type misleading and forces every caller to use a falsy check rather than a typed null guard. If a caller passes `''` to a function expecting a real path, the fs call will silently target the current working directory.
- **Proposed solution:** Change return type to `string | null`, return `resolved.storage.clientFolder || null`, and update all three callsites to use `=== null` guards. Align with the `null` convention already used in readinessPolicy.ts.
- **Affects packages:** нет
- **Tests:** Unit: resolveClientFolder returns null when clientFolder setting is empty string.

#### DLI-31 — MinecraftManager.cancel() if/else chain is not type-safe — add assertNever for new OpKinds

- **Status:** DONE — 2026-05-31 · commit a452fc0
- **Category:** Architecture · **Priority:** P1 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/manager.ts (L172-185)
- **Problem:** The `cancel` method checks `op.kind` with four independent `else if` clauses but omits `UNINSTALL` and `LAUNCH`. When a new OpKind is added to ops.ts, the compiler does not flag a missing branch in cancel(). The existing `LAUNCH` op is silently skipped (correct, since kit owns the session), but this intent is not encoded in the type system.
- **Why it matters:** A developer adding a new abortable OpKind (e.g. VERIFYING) who misses updating cancel() leaves operations stuck with no way to stop them. The user sees a spinner with no cancel affordance.
- **Proposed solution:** Refactor cancel() to a switch statement. Add explicit `case OpKinds.UNINSTALL:` and `case OpKinds.LAUNCH:` with return/break and explanatory comments. Add `default: assertNever(op)` using the `assertNever` from minecraft-kit (already imported in the file).
- **Affects packages:** нет
- **Tests:** Unit: cancel called for each OpKind does not throw; TypeScript: adding a new variant to Op union causes a compile error in manager.ts.

#### DLI-32 — localManifest validation in manifestRepo.ts uses manual duck-typing instead of Zod schema

- **Status:** DONE — 2026-05-31 · commit 123bca5
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/manifestRepo.ts (L13-26)
- **Problem:** `loadLocalManifest` manually checks `typeof candidate.bundleSlug !== 'string'`, etc. (L16-22) instead of using a Zod schema. `LocalManifest` type is defined in shared/contracts/bundle.ts but no Zod schema for it exists there — only the type is exported. The manual check misses nested field validation (`files` values are not validated at all).
- **Why it matters:** A schema change to `LocalManifest` (adding a required field) is not automatically caught by the manual check — the manifest loads as valid with the field missing, causing a downstream null-ref or incorrect behavior. This violates the guideline 'Zod-validate args on entry'.
- **Proposed solution:** Add `LocalManifestSchema` to `src/shared/contracts/bundle.ts` (z.object({ bundleSlug: BundleSlugSchema, manifestHash: z.string(), syncedAt: z.string(), files: z.record(z.object({ sha256: z.string(), size: z.number() })) })). Use it in `loadLocalManifest` with `safeParse`. Remove the manual duck-type block.
- **Affects packages:** нет
- **Tests:** Unit: loadLocalManifest returns null for manifests missing required fields; parses valid manifest correctly.

#### DLI-33 — BundleManager.runSync double-checks OP_IN_FLIGHT at two levels (activeSyncs + operationLocks) with different error messages

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/manager.ts (L202-208, L365-369)
- **Problem:** `runSync` first checks `this.activeSyncs.has(slug)` (L202) and throws with message 'A bundle sync is already running for this client'. Then `acquireWriteLock` (L226) also throws if the resource is locked (L366-369) with message 'Another operation is already running for this client'. Both throw `BundleError(BundleErrorCodes.OP_IN_FLIGHT, ...)`. The first check is redundant — the lock already encodes the mutual exclusion.
- **Why it matters:** The two checks use different error messages for the same semantic situation (same code: OP_IN_FLIGHT). The renderer reading the code field cannot distinguish them; the human-readable message is inconsistent. The redundant check is also technically wrong: the activeSyncs map could be stale if a sync completed but the lock was not yet released.
- **Proposed solution:** Remove the early `activeSyncs.has` check in `runSync` (L202-207) and rely solely on `acquireWriteLock`. Unify the OP_IN_FLIGHT message to 'Another operation is already running for this client' in both managers.
- **Affects packages:** нет
- **Tests:** Unit: calling startSync twice for the same slug throws OP_IN_FLIGHT on the second call.

#### DLI-34 — BundleManager.resolveClientFolder should not call getSettings() on every invocation — settings should be injected

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/manager.ts (L354-357)
- **Problem:** `resolveClientFolder` calls `getSettings()` (a module-level singleton accessor) and `resolveClientSettings()` each time it is invoked. `BundleManager` is constructed without access to the settings service — it reaches into the module singleton directly. This breaks dependency-injection discipline and makes the class hard to unit-test without mocking the module singleton.
- **Why it matters:** Tests of BundleManager.startSync, pauseSync, etc. must mock the `getSettings` module import (a CommonJS/ESM mocking problem in Vitest) rather than inject a test double. The guideline says business logic should not be in IPC handlers and services should have explicit dependencies.
- **Proposed solution:** Inject a `getClientFolder: (slug: ClientSlug) => string | null` function into the BundleManager constructor (alongside broadcaster and healer). The wiring site in bundle/index.ts provides the real implementation. This removes the hidden getSettings() coupling.
- **Affects packages:** нет
- **Tests:** Unit: BundleManager.startSync with injected getClientFolder returning null throws NO_CLIENT_FOLDER without needing module mocks.

#### DLI-35 — BundleManager.startInstall post-install bundle sync: lock.release() called in both .then() and .finally() — double release risk

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/manager.ts (L127-150)
- **Problem:** In `MinecraftManager.startInstall` (L127-150) the operation chain calls `lock.release()` inside the `.then()` block (L128) and again inside `.finally()` (L149). `ClientOperationLease.release` is idempotent (`if (released) return`) so there is no crash, but the release in `.then()` was intentional (to unblock the bundle sync while the lock is still logically held); the `.finally()` call then releases an already-released lease. Worse, if the `launchHook` inside `.then()` throws, the `.catch(() => {})` block suppresses the error AND the `.finally()` runs, releasing the lock again — so the lock is released while the hook may still be mid-execution.
- **Why it matters:** This is a latent correctness bug: if bundle sync runs after Minecraft install completes (inside .then) but before lock.release() in .then, and throws, the finally branch releases a lock that was already conceptually freed. The intent is murky and the two-release pattern will confuse future maintainers.
- **Proposed solution:** Restructure to a single `try/finally` pattern. The bundle sync should run AFTER the lock is released (since it uses its own BUNDLE lock). Move `lock.release()` into a single `finally` block and remove the early release in `.then()`.
- **Affects packages:** нет
- **Tests:** Unit: lock is released exactly once regardless of whether launchHook throws; lock is released even if the install itself fails.

#### DLI-36 — assignNever exhaustiveness missing in cancel() dispatch for Op variants — mirrors MinecraftManager but in a different location

- **Status:** DONE — 2026-05-31 · commit a452fc0
- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/manager.ts (L276-287), same cancelAll()
- **Problem:** `cancelAll()` (L276-287) uses a manual `if (op.kind === OpKinds.INSTALL || op.kind === OpKinds.REPAIR || op.kind === OpKinds.LAUNCH_STARTING)` check without covering `BUNDLE_SYNCING` or `UNINSTALL`. `BUNDLE_SYNCING` has an abort controller and could reasonably be cancelled on shutdown. Comments say launch ops are excluded intentionally, but the exclusion of BUNDLE_SYNCING is not commented.
- **Why it matters:** A stuck BUNDLE_SYNCING op during app shutdown keeps a socket open until the process exits. If Electron's graceful-shutdown window is short, unfinished requests may be interrupted uncleanly.
- **Proposed solution:** Explicitly handle `BUNDLE_SYNCING` in cancelAll() (call its abort controller). Add a comment explaining why `LAUNCH` and `UNINSTALL` are excluded. Add `assertNever` for any future variant.
- **Affects packages:** нет
- **Tests:** Unit: cancelAll() aborts a BUNDLE_SYNCING op.

#### DLI-37 — Throttled-progress pattern in healProgress.ts duplicates dispose logic — `dispose` should flush pending rather than just cancel

- **Status:** DONE — 2026-05-31 · commit c8cc5c2
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/healProgress.ts (L34-38, L75-78)
- **Problem:** `dispose` in `createHealProgressListener` only calls `clearPendingFlush()` (cancel the timer without flushing). This means the last batch of VERIFY_FILE_CHECKED events before the healing phase ends may never be emitted — the pending timer is cancelled, leaving a stale progress count in the renderer until the next status event. Compare: `createThrottledProgressEmitter.dispose` in progressAdapter.ts also only cancels the timer (L166), same issue.
- **Why it matters:** The final progress emission before a phase transition is silently dropped. The renderer may display a stale file count (e.g. '3000/4000 verified' instead of '4000/4000') just before the COMPLETED status arrives.
- **Proposed solution:** Change `dispose` to call `flush()` first (emit pending), then cancel the timer. This ensures the final batch is always flushed before the phase ends. Apply to both `createThrottledProgressEmitter` and `createHealProgressListener`.
- **Affects packages:** нет
- **Tests:** Unit: dispose emits the current pending progress before returning.

#### DLI-38 — manifestRepo.loadLocalManifest casts parsed JSON with Partial<LocalManifest> — unsafe without runtime validation of nested files

- **Status:** DONE — 2026-05-31 · commit 123bca5
- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/manifestRepo.ts (L14-26)
- **Problem:** The manual validation at L16-22 casts to `Partial<LocalManifest>` and checks only top-level string fields. The `files` field is only checked to be an object (`typeof candidate.files !== 'object'`). If `files` contains entries without `sha256` or `size`, or with wrong types, those are silently accepted. The final cast `return candidate as LocalManifest` is a type lie.
- **Why it matters:** A corrupt or manually edited bundle.json with malformed file entries (e.g. `sha256: null`) will pass validation and be used to drive the sync plan, potentially skipping file re-downloads that should be triggered.
- **Proposed solution:** Use the `LocalManifestSchema` proposed in the 'Add LocalManifestSchema' task. `safeParse` will validate nested structure and return a typed result. Remove the manual Partial cast.
- **Affects packages:** нет
- **Tests:** Unit: loadLocalManifest returns null when files entries have wrong types.

#### DLI-39 — Fix double lock.release() in startInstall success path

- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/manager.ts lines 129 and 149
- **Problem:** In startInstall, lock.release() is called eagerly inside .then() at line 129 and again unconditionally inside .finally() at line 149. On the success path the lock is released twice. The underlying ClientOperationLease guards against double-release with a boolean flag (released = true), so it is not a data-integrity bug, but it exposes that the design intent is ambiguous: was .finally() added as a catch-all, or was .then() added to release early before the bundle hook?
- **Why it matters:** Unnecessary calls to release() on a lease whose owner assumed it was already gone are confusing and error-prone if the idempotency guard is ever removed or the lease implementation changes. The current pattern makes it look like two different authors owned the two halves without coordinating. On the error path, .catch() swallows and .finally() releases correctly — the only issue is the redundant release on success.
- **Proposed solution:** Remove lock.release() from inside .then() (line 129). The single .finally() at line 149 is the canonical cleanup point and fires on both success and error. Rewrite the .then() body to only contain emitStatus and the launchHook try/catch.
- **Affects packages:** нет
- **Tests:** Unit test for startInstall: verify lock.release is called exactly once after runInstall resolves (mock ClientOperationLease and spy on release).

#### DLI-40 — BundleManager.tryGetClient silently returns null for any error — masks UNKNOWN failures

- **Category:** Error handling · **Priority:** P2 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/bundle/manager.ts lines 346-351
- **Problem:** tryGetClient (lines 346-351) catches all errors and returns null. runSync (line 209) then throws BundleError(UNKNOWN, 'Client not found') when tryGetClient returns null. But UNKNOWN could also hide a network failure (getClient fetches from Strapi), a settings corruption, or an ENOENT. The thrown UNKNOWN BundleError collapses all these into a single undifferentiated code.
- **Why it matters:** If Strapi is offline when runSync is called, the renderer sees bundle.error with code=unknown rather than code=manifestFetchFailed or a network code. The user has no actionable feedback about whether to check their network or their configuration.
- **Proposed solution:** Separate the null-return path (client not found = slug has no record in Strapi) from the error path (fetch failed = network/server error). In tryGetClient, distinguish NotFoundError from network errors and propagate a typed BundleError(MANIFEST_FETCH_FAILED, ...) for the latter, reserving UNKNOWN for truly unexpected errors.
- **Affects packages:** нет
- **Tests:** Unit test runSync: when getClient throws a network error, assert the emitted bundle.error.code is MANIFEST_FETCH_FAILED not UNKNOWN.

#### DLI-41 — BundleManager.executePreparedSync logs bundle errors only at error level — ABORTED should be warn

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/bundle/manager.ts lines 305-320
- **Problem:** executePreparedSync's catch block (line 305-320) calls emitError then emitStatus(ERROR) for non-aborted failures. Cancellation and pause cases are handled separately without logging. However, there is no logger.warn/error call for non-aborted bundle errors in this path — the error is emitted to the renderer but never logged in the main-process file. Bundle download failures (DOWNLOAD_FAILED, HEAL_FAILED) would be invisible in the launcher log unless they surface through the router.
- **Why it matters:** When the bundle download fails silently (no logger.error call in the catch block), operators diagnosing the issue from the log file will see no record of the failure code or message. The guideline requires logger.error for unrecovered user-operation failures.
- **Proposed solution:** In executePreparedSync's catch block, before calling emitError, add logger.error('[${task.slug}] bundle sync failed (${code}) — ${errorMessage(err)}', err) for non-aborted, non-paused codes. Keep ABORTED+cancelled at logger.info (it is user-initiated) and omit logging for the pause short-circuit.
- **Affects packages:** нет
- **Tests:** Unit test executePreparedSync: when downloadEntry throws DOWNLOAD_FAILED, assert logger.error is called with the slug and code.

#### DLI-42 — startInstall acquires the write lock but does not hold it across the beginInstall op.set — race window

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/manager.ts lines 115-151
- **Problem:** startInstall calls requireIdle (line 116) and acquireWriteLock (line 117) before buildContext. However, ops.set(slug, op) happens inside beginInstall called on line 122, after buildContext resolves. Between acquireWriteLock and ops.set, the ops map is empty even though the lock is held. If another path inspects ops.get(slug) during this window (e.g. getStatus called from renderer polling), it will see no in-flight op and return resolveClientInstallPresence rather than the INSTALLING status.
- **Why it matters:** A brief UNVERIFIED or INSTALLED status flash is possible during the gap between lock acquisition and op registration. While cosmetically minor, it means getStatus can return the wrong status to the renderer if polled during buildContext resolution (which can take hundreds of ms waiting for Strapi and kit.targets.resolve).
- **Proposed solution:** Register a placeholder op (e.g. {kind: INSTALL, status: INSTALLING, ...}) in ops before starting buildContext, or move the lock.setCancel and ops.set into acquireWriteLock so the op and lock are always created atomically. Alternatively, emit INSTALLING status immediately after requireIdle before buildContext starts.
- **Affects packages:** нет
- **Tests:** Unit test getStatus during buildContext: mock buildContext to delay; assert getStatus returns INSTALLING from ops rather than resolveClientInstallPresence.

#### DLI-43 — resumeSync silently spawns a fresh sync when no active sync is found — no error surfaced to caller

- **Category:** Error handling · **Priority:** P2 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/bundle/manager.ts lines 123-130
- **Problem:** resumeSync (lines 123-130) checks for an active sync; if none is found it spawns a fresh startSync and swallows any failure with logger.warn. The IPC handler (bundle.resume route) calls manager.resumeSync() synchronously and returns void — if the fresh sync throws (e.g. NO_CLIENT_FOLDER), the error is only logged at warn, the renderer receives no rejection, and the UI cannot show an error state.
- **Why it matters:** A user clicking Resume when the paused sync has been garbage-collected (e.g. after the idle timeout already cancelled it) will silently trigger a new sync or silently fail. The renderer has no way to distinguish 'resume started' from 'resume silently failed'. The guideline requires errors to cross IPC as structured {code, message}.
- **Proposed solution:** Change resumeSync to be async. When no active sync is found, await startSync and let any rejection propagate to the IPC router where toIpcError will serialize it. The route handler should be made async to await the result.
- **Affects packages:** нет
- **Tests:** Unit test resumeSync with no active sync: mock startSync to throw BundleError(NO_CLIENT_FOLDER); assert the rejection propagates rather than being swallowed.

#### DLI-44 — saveTargetInstallManifest writes .tmp without a try/finally — stale .tmp left on error

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/installManifest.ts lines 110-119
- **Problem:** saveTargetInstallManifest (lines 110-119) writes to a .tmp file then renames it atomically. However, if fs.rename fails (Windows file-lock from antivirus, ENOSPC, etc.) the .tmp file is not removed. Unlike downloadEntry which has a .catch cleanup for the tmp file (download.ts line 178-184), installManifest has no cleanup path.
- **Why it matters:** A stale .loontail/manifest.json.tmp survives across launcher restarts. On the next saveTargetInstallManifest call a fresh write will overwrite it, but if the rename fails again the tmp accumulates. Consistent with the download.ts pattern, a failed atomic swap should clean up the temp artifact.
- **Proposed solution:** Wrap the writeFile+rename sequence in a try/catch that removes the tmp file on failure (matching the pattern in download.ts lines 197-210). Also add a defensive pre-write removal of any stale .tmp before writing.
- **Affects packages:** нет
- **Tests:** Unit test saveTargetInstallManifest: mock fs.rename to throw; assert fs.unlink is called on the tmp path.

#### DLI-45 — Split PlayButton multi-case render into focused sub-components

- **Category:** UI · **Priority:** P1 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/clients/components/PlayButton.tsx:123-343
- **Problem:** PlayButton.tsx is 343 lines with a single component function returning JSX from 11 branches (PROGRESS, BUNDLE_ERROR, BUNDLE_UPDATE, then an 8-case switch). Each branch mixes JSX layout with inline logic. The component consumes 9 props from 5 hooks. The guideline says split past ~200 lines or ~8 props.
- **Why it matters:** The component is difficult to read, reason about, and test. Adding a new action state requires editing the switch inside the 343-line file. The loaderModal variable is constructed at lines 161-170 and then conditionally rendered in three completely separate branches — an easy place to miss a render.
- **Proposed solution:** Keep PlayButton as the orchestration component (action selection + hook wiring, no JSX branches). Extract: (1) BundleErrorView, (2) BundleUpdateButton, (3) InstallButton, (4) ErrorRetryView as focused components in the same directory. Each receives only the props it needs. The loaderModal can be factored into the install-path components that actually need it.
- **Affects packages:** нет
- **Tests:** Unit: selectPlayButtonAction — all 11 branches with boundary inputs (hasProgress=true overrides everything, INSTALLING with hasDownloadBytes=false returns CHECKING, etc.).

#### DLI-46 — Double lock.release() in startInstall causes double-release of ClientOperationLease

- **Status:** DONE — 2026-05-31 · commit 89d9063
- **Category:** Error handling · **Priority:** P0 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** In startInstall (lines 127-151), lock.release() is called in the .then() success callback (line 129) AND unconditionally in the .finally() block (line 149). On the success path the lock is released twice. ClientOperationLease.release() (clientOperationLocks.ts line 139) has an idempotent guard, so no crash occurs, but the intent is clearly that only one release should fire. If a future maintainer removes the idempotency guard, or if the guard is relied on elsewhere to detect double-release bugs, this hidden double-call creates a silent invariant violation.
- **Why it matters:** A double-release is architecturally wrong: the lock's own guard masks what should be a detectable programming error. The code communicates conflicting ownership semantics to readers (who owns the release in the success path?). If the idempotency guard is ever relaxed this becomes a real resource leak or premature unlock.
- **Proposed solution:** Remove the lock.release() call from inside the .then() success branch (line 129). The .finally() block (line 149) already handles all paths. Alternatively, track whether the success path already released via a local boolean, but the simpler fix is to rely solely on .finally().
- **Affects packages:** нет
- **Tests:** Unit test for startInstall success path: assert lock.release() is called exactly once by inspecting a spy on the lease returned by acquireWriteLock.

#### DLI-47 — Sequential per-file I/O in buildPlan stalls bundle planning for large manifests

- **Category:** Performance · **Priority:** P1 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/plan.ts
- **Problem:** buildPlan (line 57+) iterates remoteEntries in a for-of loop and awaits exists() and hashFile() one at a time. For a bundle with 500 files the planner performs 500+ sequential fs.access / stream-hash calls with no concurrency. A force-mode repair of a large bundle can block the planning step for many seconds before the download phase begins, stalling the PLANNING status indefinitely from the user's view.
- **Why it matters:** Sequential I/O serialises all disk reads through the event loop rather than letting Node's libuv thread-pool saturate at optimal concurrency. On spinning-disk storage this means the seek penalty is paid 500 times sequentially rather than being amortised across concurrent reads.
- **Proposed solution:** Batch the per-entry checks with bounded concurrency (e.g. p-limit at concurrency 16 or a manual semaphore). Each entry's exists()/hashFile() decision is independent, so all checks can be issued in parallel. Collect results into arrays and then classify into toDownload/toUpdate/toSkip/toDelete after all promises settle. Keep the existing logic structure; only the scheduling changes.
- **Affects packages:** нет
- **Tests:** Integration test timing buildPlan against a mock fs with 200 entries: parallelised version should complete < 2× the single hash time, sequential version is 200×.

#### DLI-48 — Throttled progress emitter dispose() does not cancel a pending flush timer

- **Status:** DONE — 2026-05-31 · commit c8cc5c2
- **Category:** Error handling · **Priority:** P1 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/minecraft/progressAdapter.ts
- **Problem:** createThrottledProgressEmitter (line 121) returns a dispose that calls clearPendingFlush (line 147). However clearPendingFlush only clears the timer reference; the flush callback closes over env.broadcaster.progress and slug. If the adapter is disposed while a pending flush is alive (pendingFlush !== null) the timer will fire after the op map entry has been deleted and potentially after a new op has taken the slug. The dispose() function IS clearPendingFlush, so this is correct — but runWithProgressAdapter (line 227) only calls adapter.dispose() in its finally block, meaning a pending timer outstanding at the time the finally runs will still fire. The issue is that dispose aliases clearPendingFlush which IS the canceller, so this IS handled. However in createRepairProgressAdapter (line 169), dispose is emitter.dispose (line 222) — which is clearPendingFlush — but the adapter also calls emitter.emit() without ensuring a final flush before dispose. The last progress snapshot might never reach the renderer if the timer has not yet fired when dispose() is called.
- **Why it matters:** The last in-progress snapshot for repair could silently be dropped, leaving the renderer's progress bar frozen at some intermediate percentage. This is invisible during normal operation but breaks progress fidelity.
- **Proposed solution:** In createThrottledProgressEmitter, make dispose() flush synchronously first (call flush() if current is non-null and there is a pending timer), then cancel the timer. This ensures the last snapshot is always emitted before teardown.
- **Affects packages:** нет
- **Tests:** Unit test: emit progress, call dispose() before the throttle window expires, assert broadcaster.progress was called once with the final snapshot.

#### DLI-49 — buildPlan sequential exists() calls use fs.access for presence check — replace with stat to avoid double syscall in hash path

- **Category:** Performance · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/plan.ts
- **Problem:** The exists() helper (line 45) calls fs.access(), then for disk-hash verification hashFile() opens a read-stream on the same path (line 122). For every file in the 'unknown on disk' branch, the code does: access() → read-stream open — two distinct syscalls to the same inode. Additionally hashFile() (line 37) uses createReadStream with no highWaterMark, which defaults to 64 KB chunks; for files larger than several MB this creates many micro-callbacks.
- **Why it matters:** The double-syscall pattern wastes a stat/access call on every file that needs hashing. For large bundles with many files this is measurable overhead.
- **Proposed solution:** Replace the exists() + hashFile() pair with a single open() → read-loop → digest that handles ENOENT gracefully, eliminating the separate access() call. Also set highWaterMark on createReadStream to 256 KB to reduce per-chunk callback overhead.
- **Affects packages:** нет
- **Tests:** Unit tests for buildPlan: ENOENT case still routes to toDownload; existing hash-match still routes to toSkip.

#### DLI-50 — BundleManager.runSync has a TOCTOU gap between activeSyncs.has() check and activeSyncs.set()

- **Category:** Code · **Priority:** P1 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** runSync (line 201) checks this.activeSyncs.has(slug) at line 203 and then calls acquireWriteLock at line 226, but between those two lines there are async awaits: tryGetClient (line 209) and resolveClientFolder (line 219) read settings synchronously but getClient is awaited. A concurrent call that completes its own lock before this one's lock check is a race; however the more real risk is that activeSyncs.set() happens at line 231 only AFTER both the lock is acquired and the task and active objects are created. If acquireWriteLock() at line 226 throws (blocked), the code correctly does not add to activeSyncs. But the comment at line 203 says 'if activeSyncs.has' — yet the real guard against concurrent syncs is the ClientOperationLocks, not activeSyncs. The activeSyncs check is therefore a redundant, potentially stale guard that could give a misleading OP_IN_FLIGHT error if a previous sync's dropActiveSync runs between the two maps being consistent.
- **Why it matters:** The dual-guard (activeSyncs + operationLocks) creates two sources of truth for whether a sync is in flight. They can briefly diverge during pause/resume/cancel paths, making the error surface non-deterministic.
- **Proposed solution:** Remove the activeSyncs.has() pre-check at line 203 and rely solely on acquireWriteLock() as the single concurrency guard. The OP_IN_FLIGHT error from the lock is equivalent. Alternatively document explicitly why both checks are needed.
- **Affects packages:** нет
- **Tests:** Concurrent startSync calls for the same slug: only one should succeed; the second should get OP_IN_FLIGHT from the lock, not from the map check.

#### DLI-51 — pauseSync does not guard against pausing an already-paused sync, armPauseIdleTimer can be called twice

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** pauseSync (line 111) checks active.task.cancelled but not active.task.paused. A caller that invokes pauseSync twice will call abort.abort() on an already-aborted controller (harmless but wasteful), call emitStatus PAUSED twice (renderer gets duplicate events), and call armPauseIdleTimer twice (line 119 → 404), which calls clearPauseIdleTimer then sets a new timer — clearing the previous timer and starting a fresh idle countdown, effectively resetting the expiry window with each duplicate pause call.
- **Why it matters:** If the renderer sends two rapid pause IPC calls (e.g. debounce not in place, or a test), the idle timer is reset on the second call. The sync could stay paused indefinitely if pause is called in a tight loop.
- **Proposed solution:** Add `if (active.task.paused) return;` at the top of pauseSync, analogous to the cancel check that follows. This makes the method idempotent.
- **Affects packages:** нет
- **Tests:** Unit: calling pauseSync twice on the same active sync — armPauseIdleTimer should be called exactly once.

#### DLI-52 — expirePausedSync resets pauseIdleTimer to null before calling dropActiveSync, creating brief inconsistency

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** expirePausedSync (line 421) sets active.pauseIdleTimer = null (line 424) then calls dropActiveSync (line 429). Between those two lines the active object still exists in activeSyncs but has a null timer. If another concurrent expiry callback somehow fired (impossible with a single timer, but defensively) the guard `if (!active || !active.task.paused) return` would not catch it. More concretely, the manual null assignment is redundant because dropActiveSync removes the entry from activeSyncs anyway.
- **Why it matters:** The manual null assignment before dropActiveSync is dead code and adds confusion about ownership. Minor readability issue.
- **Proposed solution:** Remove the manual `active.pauseIdleTimer = null` line in expirePausedSync. The subsequent dropActiveSync call removes the active entry entirely, making the timer field irrelevant.
- **Affects packages:** нет
- **Tests:** нет

#### DLI-53 — getInstallState in BundleManager fetches remote manifest on every call, blocking the UI on network

- **Category:** Performance · **Priority:** P1 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** getInstallState (line 167) is called from the IPC handler to seed the renderer's bundle state on mount. When a local manifest exists (line 185), the method always calls fetchRemoteManifest (line 193) to compare hashes, even when a sync just completed moments ago. This is a blocking network call on every renderer mount/refresh that has no cache — if the CDN is slow or the network is flaky, the UI freezes waiting for a manifest hash comparison that could be skipped.
- **Why it matters:** The method's own comment says 'Best-effort drift check... if the network is down we don't want to gate the UI'. The implementation does gate the UI: the entire call awaits the fetch before returning. The try/catch swallows errors but the await is still present, causing a 5–30 second hang on poor connections.
- **Proposed solution:** Make the remote manifest check truly non-blocking: return {installed: true, signatureMatches: true} immediately from a local-manifest hit, and fire the drift check as a background operation that emits a separate IPC event (or updates a store) when it resolves. Alternatively cache the last known manifestHash in memory and skip the network call if a sync completed recently (within N seconds).
- **Affects packages:** нет
- **Tests:** Integration test: call getInstallState with a valid local manifest while the network fetch is stalled — result should return in < 100ms.

#### DLI-54 — SyncTask mutable plain-object state shared across async worker functions is not protected against mid-run plan reassignment

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/runner.ts, src/main/services/bundle/syncState.ts
- **Problem:** SyncTask (runner.ts line 26) is a plain mutable object. pendingDownloads and pendingDeletes are arrays shared between runDownloadWorker goroutines (via .shift()) and the cancel path (runner.ts line 123: `task.pendingDownloads.length = 0`). Additionally, resetTaskForResume in syncState.ts (line 60) mutates the task in-place including reassigning task.abort (line 63) while a worker may still be alive reading task.abort.signal in its inner await. Although in practice resume only runs after pause completes, the fact that the abort controller reference is reassigned on the same object that workers close over means a timing issue is possible if the pause signal propagation is asynchronous.
- **Why it matters:** Mutable shared state across concurrent async functions is a known source of race conditions. The assignment of task.abort during resumePausedSync in manager.ts (via resetTaskForResume) while workers hold a reference to the old abort signal could silently fail to cancel a worker on subsequent cancel().
- **Proposed solution:** Workers should capture the abort signal by value at the start of each download (const signal = task.abort.signal inside runDownloadWorker), not rely on task.abort changing. Alternatively make resetTaskForResume return a new SyncTask object rather than mutating in place, and update the ActiveSync reference atomically.
- **Affects packages:** нет
- **Tests:** Concurrent pause/resume/cancel stress test: verify all workers observe the correct abort signal after each reset.

#### DLI-55 — cancelAll in BundleManager uses a fixed sleep grace period instead of awaiting actual cleanup

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** cancelAll (line 443) calls cancelSync for each slug and then waits `graceMs` (default 250ms) with a raw setTimeout promise (line 447). This is a blind sleep: if cleanup takes longer than 250ms (e.g. slow disk on a manifest write), work is truncated. If cleanup takes 10ms, the 250ms is wasted. The comment says 'wait a short grace window so runner's finally blocks can land'.
- **Why it matters:** Blind sleeps are an anti-pattern: they are both a floor (truncate long cleanup) and a ceiling (waste time on fast cleanup). On shutdown, wasted time delays the process exit signal that Electron waits for.
- **Proposed solution:** Rather than a blind sleep, track active-sync completion via the awaiters mechanism already present: create an awaiter for each active sync in cancelAll and resolve it in dropActiveSync, then await Promise.allSettled on the awaiters with a timeout guard. This gives exact completion signalling.
- **Affects packages:** нет
- **Tests:** Shutdown integration test: cancelAll resolves promptly when all syncs finish quickly, and times out after maxMs when they don't.

#### DLI-56 — persistLocalManifest in BundleManager: saveLocalManifest failure after a successful sync swallows the error but does NOT preserve the installed status already emitted

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** completePreparedSync (line 325) calls persistLocalManifest (line 326) before emitting status (line 327). persistLocalManifest (line 331) wraps saveLocalManifest in a try/catch that only logs a warn. The status emission at line 327 (COMPLETED/UP_TO_DATE) then fires after the failed manifest write. On the next launch, getInstallState reads the local manifest (line 185) — which was not written — and returns {installed: false, signatureMatches: false}, forcing a full re-sync even though the files are correct on disk. The guideline explicitly says: 'Do NOT demote a successful op to failed on trailing bookkeeping failure'.
- **Why it matters:** A failed manifest write after a successful download causes the next sync to re-download all files unnecessarily (and emit signatureMatches: false to the UI). This contradicts the guideline and wastes bandwidth/time on next launch.
- **Proposed solution:** Emit the COMPLETED/UP_TO_DATE status FIRST (the download was successful), then attempt to persist the manifest. The warn log on failure already exists. The status should reflect the download outcome, not the bookkeeping outcome. Reorder the two calls in completePreparedSync.
- **Affects packages:** нет
- **Tests:** Unit test: mock saveLocalManifest to throw; assert that COMPLETED status was emitted and awaiters were resolved (not rejected).

#### DLI-57 — startInstall fire-and-forget void chain doesn't acquire the lock before the background operation completes

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** startInstall (line 115) acquires a lock, begins the install op synchronously, then fires runInstall as a void promise. The lock is held across the async runInstall execution (correct). However beginInstall (install.ts line 21) sets ops.set(slug, op) synchronously but the lock is only set with setCancel AFTER beginInstall returns (line 123: `lock.setCancel(...)`). Between the ops.set and the lock.setCancel there is a synchronous gap where the lock's cancel callback is null. If cancelAll() is called in that exact window, the lock entry has cancel: null and the running install will not receive an abort signal from cancelAll.
- **Why it matters:** The window is tiny (synchronous code path), but cancelAll can be triggered by the app quit handler at any time, including during startup. A missed cancel means the install keeps downloading after the app has been told to shut down.
- **Proposed solution:** Pass the cancel callback to the lock at acquire time via the ClientOperationDescriptor.cancel field, or call lock.setCancel immediately before ops.set in beginInstall. Ensure the abort controller is created before the lock is acquired so the cancel is wired atomically.
- **Affects packages:** нет
- **Tests:** Simulate cancelAll() firing between beginInstall and lock.setCancel: the install op's abort should have been called.

#### DLI-58 — runDownloadWorker catches errors and drains the queue, but does not abort the task's AbortController — sibling workers continue one more file

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/runner.ts
- **Problem:** In runDownloadPhase (line 110), when a worker throws, the catch block (line 121) sets firstError and truncates pendingDownloads to length 0. This causes other workers to exit on their next loop iteration (they .shift() undefined and return). However between the error and the next iteration, a sibling worker may have already called .shift() and begun downloading a new file. That download runs to completion (or timeout) before the phase finishes, wasting bandwidth and holding up Promise.all unnecessarily. task.abort.abort() is NOT called in the catch block.
- **Why it matters:** After a download failure, the other workers keep processing one more file each before they observe the drained queue. For BUNDLE_DOWNLOAD_CONCURRENCY=4 workers, up to 3 additional files are downloaded after the first failure, wasting bandwidth and extending the time before the error is surfaced.
- **Proposed solution:** In the runDownloadPhase catch block, also call task.abort.abort() to signal all in-flight downloads to terminate via their abort listeners. The abort signal is already wired in downloadEntry (download.ts line 55+), so this would cleanly cancel in-flight sockets.
- **Affects packages:** нет
- **Tests:** Test with 10 files and 4 workers where file 2 fails: assert that no more than 3 additional downloads begin after the failure (one per already-started worker), and that abort is called.

#### DLI-59 — plan.ts flattenEntries duplicates logic already present in manifestSnapshot.ts flattenRemote

- **Status:** DONE — 2026-05-31 · commit 44a4bc8
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/plan.ts, src/main/services/bundle/manifestSnapshot.ts
- **Problem:** plan.ts defines flattenEntries (line 25) which iterates RemoteManifest values, skips isDir entries, and collects RemoteManifestEntry objects. manifestSnapshot.ts defines flattenRemote (line 4) which does the same iteration, also skips isDir, but additionally filters out entries without sha256. Both functions loop Object.values(manifest) and filter entries — the manifest-walking pattern is duplicated.
- **Why it matters:** Duplicated manifest-walking logic means a change to the RemoteManifest shape (e.g. new entry fields, new skip criteria) must be applied in two places. One is in plan.ts (planning), one is in manifestSnapshot.ts (persistence). The two will diverge.
- **Proposed solution:** Extract a shared iterateRemoteFiles(manifest, filterFn?) helper in a new bundle/manifestUtils.ts file, and use it in both flattenEntries and flattenRemote. Both callers differ only in their filter predicate (plan: skip dirs; manifest: skip dirs AND skip missing sha256), which the helper can accept as an optional parameter.
- **Affects packages:** нет
- **Tests:** Unit tests for the shared helper; existing plan and manifestSnapshot tests continue to cover their callers.

#### DLI-60 — runSyncPhases post-pause check is duplicated with redundant early-return pattern

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/bundle/runner.ts
- **Problem:** runSyncPhases (line 212) checks `if (task.cancelled || task.paused)` twice: once after runDownloadPhase (line 214) and once after runDeletePhase (line 220). The second check's cancel branch throws, but the paused branch at line 221 returns the deleteResult even though delete was interrupted — this means a partial delete result is returned as if successful. The caller in executePreparedSync (manager.ts line 286) checks task.paused after runSyncPhases returns and short-circuits, so the partial result is ignored, but this creates a misleading return value.
- **Why it matters:** Returning a partial PhaseResult from runSyncPhases when paused mid-delete implies success to any caller that doesn't also check task.paused. The current caller does check, but a future caller might not, leading to incorrect state transitions.
- **Proposed solution:** Consolidate the pause/cancel checks: throw a dedicated PausedError or return a discriminated result type {kind: 'paused' | 'cancelled' | 'completed'; deletedAny: boolean} so callers cannot accidentally ignore the pause state.
- **Affects packages:** нет
- **Tests:** Unit test: pause during delete phase — assert caller receives a discriminated 'paused' result rather than a boolean.

#### DLI-61 — LocalManifest validation in manifestRepo.ts uses manual typeof checks instead of a Zod schema

- **Category:** Code · **Priority:** P1 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/bundle/manifestRepo.ts:14-25, src/shared/contracts/bundle.ts
- **Problem:** loadLocalManifest() validates the parsed JSON with four manual typeof checks (lines 17-21). There is no Zod schema for LocalManifest in shared/contracts/bundle.ts (the type is a plain TypeScript interface). This allows partial objects with malformed files map keys or wrong-typed LocalManifestFile entries to pass validation silently.
- **Why it matters:** A malformed files entry (e.g. missing sha256, wrong type) will not be caught at load time and will corrupt the plan diff logic in buildPlan (line 57-155 of plan.ts), causing incorrect toSkip/toUpdate decisions that are invisible until runtime.
- **Proposed solution:** Add a LocalManifestSchema using z.object() in shared/contracts/bundle.ts covering bundleSlug, manifestHash, syncedAt, and files (z.record of LocalManifestFileSchema). Replace the manual typeof guards in loadLocalManifest with LocalManifestSchema.safeParse().
- **Affects packages:** нет
- **Tests:** Unit tests: LocalManifestSchema round-trips valid blob; rejects missing bundleSlug, non-string manifestHash, non-object files, files entry with wrong type.

#### DLI-62 — BundleManager.executePreparedSync does not call finally{dropActiveSync} when paused mid-heal

- **Category:** Error handling · **Priority:** P1 · **Risk:** High · _(auditor: testability)_
- **Area:** src/main/services/bundle/manager.ts:259-323
- **Problem:** In executePreparedSync (lines 259-323), the finally block (lines 318-321) only calls dropActiveSync when !task.paused || task.cancelled. When the sync is paused inside the heal phase (lines 290-303), the code returns early from the try block at line 302 (if task.paused return) without reaching the finally that would clean up. However, unlike the pause-inside-download path where the runner exits after pause, the heal phase (verifyAndRepairExceptBundle) is not pause-aware — it runs to completion or throws. If the heal is aborted via the signal, it throws, the catch at line 305 evaluates code===ABORTED&&task.paused (line 311), and returns without calling rejectAwaiters for awaiting launch callers. The awaiter from createAwaiter (line 229) is never resolved or rejected in this code path, permanently hanging syncForLaunch.
- **Why it matters:** A syncForLaunch caller (MinecraftManager.startLaunch) awaits launchWait indefinitely. If a heal-phase abort coincides with task.paused===true, the awaiter is never settled, the launch flow freezes, and the op map entry is never cleaned up — the client stays in LAUNCHING state forever.
- **Proposed solution:** In the catch block, when code===ABORTED && task.paused is true, call rejectAwaiters(active, …) for any forLaunch waiters (or resolve them if treating a cancelled-during-heal as non-fatal). Add a finally guard that rejectAwaiters for forLaunch syncs whose awaiter was never settled.
- **Affects packages:** нет
- **Tests:** Integration test: start syncForLaunch, allow heal phase to start, cancel the sync via externalSignal, verify syncForLaunch rejects (not hangs).

#### DLI-63 — MinecraftManager.startInstall calls lock.release() twice on success — double-release of operation lease

- **Category:** Error handling · **Priority:** P1 · **Risk:** High · _(auditor: testability)_
- **Area:** src/main/services/minecraft/manager.ts:127-151
- **Problem:** In startInstall (lines 127-151), on the success path runInstall resolves: the .then() callback calls lock.release() at line 129, then the .finally() callback calls lock.release() at line 149 again. This means every successful install double-releases the ClientOperationLease.
- **Why it matters:** Depends on what ClientOperationLease.release() does on second call. If it mutates shared state (removes from locks map, decrements a counter), a double-release corrupts the lock table, potentially allowing two concurrent operations on the same client. Should be verified against clientOperationLocks implementation and covered by a test.
- **Proposed solution:** Remove the lock.release() from inside the .then() block (line 129), keeping only the .finally() guard. If the release must happen before the launchHook (to unblock uninstall), move the lock.release() to just before the launchHook call and remove from .finally(), or use a one-shot flag.
- **Affects packages:** нет
- **Tests:** Unit test: startInstall succeeds → lock.release called exactly once (spy on ClientOperationLease.release).

#### DLI-64 — No workflow/integration tests for full install→launch pipeline (MinecraftManager.startInstall followed by startLaunch)

- **Category:** Testing · **Priority:** P2 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/manager.ts, tests/main/services/minecraft/managerReadinessIntegration.test.ts
- **Problem:** managerReadinessIntegration.test.ts tests readiness transitions but mocks both runInstall and runLaunch. There is no test that exercises the install→INSTALLED status→launchHook→launch chain from startInstall, verifying that the bundle hook is awaited before launch proceeds, and that a bundle hook failure keeps the client INSTALLED (lines 135-143 of manager.ts).
- **Why it matters:** The launchHook wiring is an uncommented critical path — MinecraftManager.attachLaunchHook is called once at boot and integrates two services. If the hook is not awaited, if it throws non-fatally, or if the INSTALLED status is emitted before the hook completes, the UI shows incorrect state. These invariants are currently untested.
- **Proposed solution:** Add tests in managerReadinessIntegration.test.ts or a new managerInstall.test.ts: (1) install succeeds → launchHook called → emitStatus INSTALLED before hook; (2) launchHook throws → error logged, client stays INSTALLED; (3) install cancelled → launchHook not called.
- **Affects packages:** нет
- **Tests:** Workflow tests using mocked runInstall and a spy launchHook. Assert call order of emitStatus and launchHook. Assert launchHook failure does not change final status.

#### DLI-65 — buildPlan's force-mode re-hashing touches the filesystem inside an otherwise pure-ish function — no explicit test for the no-local-record-but-file-exists branch

- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/bundle/plan.ts:100-130
- **Problem:** The 'no local manifest record but file exists on disk → fall through to disk hash' branch (lines 106-116) is not covered by tests/main/services/bundle/plan.test.ts. This branch is entered when a file appears in the remote manifest, is NOT in the local manifest, but physically exists on disk — an edge case when a file is added to the bundle manifest after an incomplete prior sync.
- **Why it matters:** Without a test for this branch, a regression that accidentally routes this case to toDownload (skipping the hash check) would silently re-download files that are already correct on disk, causing unnecessary bandwidth usage.
- **Proposed solution:** Add a test: remote has file X, local manifest has NO record for X, X exists on disk with the correct hash → X goes to toSkip. Add another: same setup but file has wrong content → X goes to toUpdate.
- **Affects packages:** нет
- **Tests:** Two new test cases in buildPlan describe block.

#### DLI-66 — download.ts uses raw http/https Node modules with no injection point — untestable without real network or mocking Node internals

- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/bundle/download.ts:31-89
- **Problem:** requestOnce() (line 31) directly calls https.request() / http.request() from Node core. The existing tests/main/services/bundle/download.test.ts must set up real HTTP servers to test the download path. While this is thorough integration testing, it makes fast unit testing of edge cases (redirect loop, timeout, SHA mismatch, abort-during-stream) expensive.
- **Why it matters:** Tests for abort-during-streaming, the 3-redirect limit, or the Windows rename-after-rm path (lines 196-200) require careful HTTP server setup. The test file exists and covers some cases, but injecting a transport function would allow lightweight unit tests for these edge cases.
- **Proposed solution:** Extract the HTTP transport into a type alias (e.g. type HttpTransport = typeof https.request) and inject it as an optional parameter to downloadEntry (defaulting to the real Node transport). This is consistent with how minecraft-kit exposes FetchHttpClient for injection.
- **Affects packages:** нет
- **Tests:** Unit tests using a fake transport: redirect handling; timeout fires DOWNLOAD_FAILED; abort before response rejects with ABORTED; SHA mismatch rejects with DOWNLOAD_INTEGRITY_FAILED.

#### DLI-67 — Consolidate `isAnythingInstalled` usage: prefer the durable install manifest as the primary probe

- **Category:** Architecture · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/runtimeState.ts, install.ts, repairWorkflow.ts, readinessPolicy.ts, uninstall.ts
- **Problem:** `isAnythingInstalled` (runtimeState.ts lines 9-29) is a fragile heuristic: it walks `versions/*/name.json` on disk. It is called in four separate places (install.ts:47, repairWorkflow.ts:60, readinessPolicy.ts:25, uninstall.ts:48) as a fallback/gate. The durable install manifest (`installManifest.ts`) already gives a stronger, launcher-attributed signal that an install exists and matches the current target.
- **Why it matters:** A third-party install of Minecraft at the same path will produce a false INSTALLED status even though we have no manifest record. Conversely, the manifest-only check (`hasCurrentTargetInstallManifest`) is the correct source of truth post-install. The legacy scan adds I/O on every status seed at launcher open.
- **Proposed solution:** In `readinessPolicy.ts` (lines 23-28), drop the `isAnythingInstalled` branch entirely: if a manifest exists it's INSTALLED; if not and `versions/` exists it's UNVERIFIED; if neither it's NOT_INSTALLED — this is already the current logic, but the `isAnythingInstalled` call can be deferred to only when `manifest === null` (one fewer `stat` on the happy path). In repair/install finalize paths keep as fallback for the cancel/cleanup scenario only. Add a comment explaining the UNVERIFIED state.
- **Affects packages:** нет
- **Tests:** Unit: `resolveClientInstallPresence` with (manifest=present, versions=present), (manifest=null, versions=present), (manifest=null, versions=absent). Check `isAnythingInstalled` is not called when manifest is present.

#### DLI-68 — Stop shadowing `ProgressStages` from minecraft-kit with a local `ProgressStages` enum in shared/contracts

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/progressAdapter.ts, src/shared/contracts/minecraft.ts
- **Problem:** `ProgressStages` is exported from `@loontail/minecraft-kit` (listed in the KIT_API). `progressAdapter.ts` line 18 imports `ProgressStages` from `@shared/contracts/minecraft`. If the shared contract defines its own `ProgressStages` that mirrors the kit's, it is a duplicated domain enum. The mapping table `PROGRESS_STAGE_FOR_ASPECT` (line 22) and the `progressStageForDownloadCategory` function (lines 69-86) are translation layers between kit enums and launcher enums that may be unnecessary.
- **Why it matters:** Maintaining a parallel enum means any new progress stage added to the kit must also be added to the shared contract and the mapping tables, or the mapping returns `null` silently (line 86) causing the stage to be reported as PREPARE.
- **Proposed solution:** Audit `@shared/contracts/minecraft.ts`: if `ProgressStages` there is identical or a subset of the kit's `ProgressStages`, delete the local definition and import directly from `@loontail/minecraft-kit`. Update `progressAdapter.ts` and `healProgress.ts` accordingly. If the shared contract needs a renderer-safe subset, document why the subset differs.
- **Affects packages:** нет
- **Tests:** Compile-only check; no new runtime tests. Verify the IPC serialisation of `ProgressStage` values still round-trips correctly.

#### DLI-69 — Add `try/finally` to `persistLocalManifest` in BundleManager to ensure `dropActiveSync` is not skipped on error

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** `completePreparedSync` (lines 325-329) calls `persistLocalManifest` which internally catches and warns on error (lines 339-341), so the outer call does not throw. However, `emitStatus` (line 327) and `resolveAwaiters` (line 328) are only reached if `persistLocalManifest` resolves. If `saveLocalManifest` throws an uncaught error that is not wrapped (a future regression), `resolveAwaiters` would never fire, leaking the `forLaunch` promise awaiter and hanging the launch flow indefinitely.
- **Why it matters:** The anti-pattern is: a successful user operation (sync done) can be demoted to a hung state by a trailing bookkeeping failure. The guidelines explicitly prohibit this.
- **Proposed solution:** Move `resolveAwaiters` to a `finally` block: `try { await persistLocalManifest(...); } finally { this.emitStatus(...); this.resolveAwaiters(active); }`. Keep the manifest-write failure as a warn, not a rejection. Update comment to clarify the invariant.
- **Affects packages:** нет
- **Tests:** Unit: mock `saveLocalManifest` to throw; assert `resolveAwaiters` is still called and the forLaunch promise resolves.

#### DLI-70 — Eliminate `persistTargetInstallManifest` duplication between install.ts and repairWorkflow.ts

- **Status:** DONE — 2026-05-31 · commit 323ea57
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/install.ts, src/main/services/minecraft/repairWorkflow.ts
- **Problem:** `persistTargetInstallManifest` is defined identically in both `install.ts` (lines 55-65) and `repairWorkflow.ts` (lines 66-76): both call `saveCurrentTargetInstallManifest` and catch errors with a `logger.warn`. The only difference is the log prefix (`install:` vs `repair:`).
- **Why it matters:** Any change to the error handling (e.g. adding a retry, changing the log level) must be applied in two places.
- **Proposed solution:** Move the shared logic into `installManifest.ts` as `safelySaveCurrentTargetInstallManifest(clientFolder, target, logger, context): Promise<void>` where `context` is the log prefix string. Both install.ts and repairWorkflow.ts call this helper.
- **Affects packages:** нет
- **Tests:** Unit: mock `saveCurrentTargetInstallManifest` to throw; assert warn is logged and the promise resolves (does not rethrow).

#### DLI-71 — Replace `createRequire` + `requirePackage('@loontail/minecraft-kit/package.json')` with a compile-time constant

- **Category:** Code · **Priority:** P3 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/installManifest.ts
- **Problem:** Lines 13 and 45-46 use `createRequire(import.meta.url)` to load `@loontail/minecraft-kit/package.json` at runtime to extract the version string. This couples the runtime to the package.json resolution semantics of the bundler and is fragile in a packaged Electron app where `node_modules` is not present.
- **Why it matters:** In a packaged build, `requirePackage('@loontail/minecraft-kit/package.json')` may fail silently (the `parsePackageVersion` fallback returns `'unknown'`), causing every target install manifest to record `kitVersion: 'unknown'`. This breaks `targetInstallManifestMatches` (line 149) which compares `manifest.kitVersion === MINECRAFT_KIT_VERSION`, causing every existing install to be reported as stale after packaging.
- **Proposed solution:** Inject the kit version as a build-time constant via Vite's `define` plugin (e.g. `__MINECRAFT_KIT_VERSION__`). Read it from the package.json at Vite config time, not at runtime. Remove `createRequire` and the `requirePackage` call. Add a CI check that the constant is not `'unknown'` in the production bundle.
- **Affects packages:** нет
- **Tests:** Build-time: assert `__MINECRAFT_KIT_VERSION__` is a semver string in the compiled output. Unit: mock the constant; verify `targetInstallManifestMatches` returns false when kitVersion differs.

#### DLI-72 — Replace hand-rolled `sha256` hash in bundle/api.ts with a shared utility; unify with bundle/plan.ts `hashFile`

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/bundle/api.ts, src/main/services/bundle/plan.ts
- **Problem:** `api.ts` line 22 defines `sha256(input: string): string` using `createHash`. `plan.ts` lines 37-43 define `hashFile(absPath: string): Promise<string>` also using `createHash('sha256')`. These are two separate inline implementations of the same SHA-256 operation: one for strings, one for files.
- **Why it matters:** Minor: both are small and correct, but having two `createHash('sha256')` calls scattered across bundle-domain files increases the chance of a typo introducing `sha1` instead of `sha256` in a future edit.
- **Proposed solution:** Extract a `src/main/services/bundle/hash.ts` module exporting `sha256String(input: string): string` and `sha256File(path: string): Promise<string>`. Both `api.ts` and `plan.ts` import from it. The existing `download.ts` inline hash (lines 134-156) can also adopt `sha256File` once it's extracted.
- **Affects packages:** нет
- **Tests:** Unit: `sha256String` matches known test vector. `sha256File` returns same digest as `sha256String` on a small file's contents.

#### DLI-73 — Harden `loadLocalManifest` in bundle/manifestRepo.ts: replace duck-typed shape check with Zod parsing

- **Status:** DONE — 2026-05-31 · commit 123bca5
- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/bundle/manifestRepo.ts
- **Problem:** Lines 14-28 validate the local manifest with manual `typeof` checks (`typeof candidate.bundleSlug !== 'string'`, etc.) and cast with `candidate as LocalManifest`. This is the same pattern the guideline prohibits (no `any`, validate at system boundaries). `loadTargetInstallManifest` in installManifest.ts (lines 91-108) correctly uses `TargetInstallManifestSchema.safeParse`, but the bundle manifest does not.
- **Why it matters:** An unguarded field (e.g. `files` containing a `null` value for a key) passes the duck-type check and causes a downstream NPE when `Object.keys(manifest.files)` or `manifest.files[key].sha256` is accessed.
- **Proposed solution:** Define a `LocalManifestSchema` with Zod in `manifestRepo.ts` (or a sibling contracts file) and replace the manual checks with `LocalManifestSchema.safeParse`. Follow the same pattern as `TargetInstallManifestSchema.safeParse` in installManifest.ts.
- **Affects packages:** нет
- **Tests:** Unit: `loadLocalManifest` returns null for missing file, null for malformed JSON, null for correct shape but wrong field type, and the parsed object for a valid manifest.

#### DLI-74 — Model `BundleManager.activeLocks` entries as part of `ActiveSync` to prevent map-key desync

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** `BundleManager` maintains two parallel maps: `activeSyncs: Map<ClientSlug, ActiveSync>` and `activeLocks: Map<ClientSlug, ClientOperationLease>` (lines 79-80). Both are keyed by `ClientSlug` and must always be kept in sync. `dropActiveSync` (lines 372-378) deletes from both, but `cancelSync` (lines 142-165) conditionally calls `dropActiveSync` only when the sync was paused (`wasPaused` branch lines 156-163). If a new code path forgets to call `dropActiveSync`, the lock entry is leaked — the client is permanently locked.
- **Why it matters:** Parallel maps with the same key are a classic desync hazard. The lock leak prevents any future operation on the client until the launcher restarts.
- **Proposed solution:** Add `lock: ClientOperationLease` as a field in `ActiveSync`. Remove `activeLocks` entirely. All access to the lock goes through `active.lock`. `dropActiveSync` becomes: `active.lock.release(); this.activeSyncs.delete(slug)`. This makes it impossible to delete the sync without releasing the lock.
- **Affects packages:** нет
- **Tests:** Unit: after `cancelSync` on a paused sync, verify the lock is released and the slug is no longer in `activeSyncs`. Integration: start two sequential syncs for the same slug after the first is cancelled.

#### DLI-75 — Remove per-field label comments in `DownloadOptions` type and `SyncTask` type

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/bundle/download.ts, src/main/services/bundle/runner.ts
- **Problem:** download.ts lines 22-24: `// Set of in-flight requests for the task. The downloader registers/unregisters itself here so cancelSync can synchronously destroy every active socket.` — this is genuinely useful (explains the cancel protocol); keep it. runner.ts lines 30-42: several type field comments exist. Lines 31-32 (`// Set of in-flight HTTP requests for synchronous cancellation.`) and 33-34 (`// Cooperative pause/cancel flags. Workers check between file boundaries.`) are borderline — the first explains the cancel protocol (keep), the second restates the flag names (remove). Lines 107-108 in installSteps.ts: `// Skip undefined to respect exactOptionalPropertyTypes.` is a valid keep (wire-coercion guard).
- **Why it matters:** §10 explicitly forbids per-field label comments that restate the name. The cancel-protocol note is a 'why' (keep), 'Cooperative pause/cancel flags. Workers check between file boundaries.' partially restates the field names `paused`/`cancelled` — only the 'between file boundaries' clause is new information.
- **Proposed solution:** In runner.ts SyncTask type: reduce line 33-34 to `// Workers check between file boundaries, not mid-chunk.` (keeps only the non-obvious part). Delete `// Cooperative pause/cancel flags.` prefix. Leave the `currentRequests` comment unchanged.
- **Affects packages:** нет
- **Tests:** нет

#### DLI-76 — Remove step-narrating comment at manager.ts line 124 that paraphrases install sequence

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** Lines 123-125 in `startInstall` (inside the `void runInstall(...).then(...)` chain): `// Mark Minecraft itself as installed BEFORE the bundle phase. The UI listens for INSTALLED to switch the progress card from 'downloading minecraft' to 'syncing bundle' (which only renders on top of an installed client).` This is partially a why-comment (ordering dependency between emit and bundle hook) but the 'Mark Minecraft itself as installed BEFORE' opening clause restates what `emitStatus(INSTALLED)` does. Lines 139-141: `// Bundle failures surface via the bundle.error event channel; the Minecraft install itself is done, so we keep the INSTALLED state.` — this is a pure why-comment; keep it. Lines 133-134 in `startLaunch`: `// No pre-launch hash verification and no implicit reinstall here. The lenient launch preflight inside runLaunch decides launchability…` is a valid why-comment; keep it.
- **Why it matters:** §10: the 'Mark Minecraft itself as installed BEFORE' part is a what-restatement attached to a genuine why.
- **Proposed solution:** Trim the comment at lines 123-125 to remove the opening what-clause: `// INSTALLED emitted before the bundle phase — the UI uses this status to switch the progress card from Minecraft download to bundle sync.` Keep lines 139-141 unchanged.
- **Affects packages:** нет
- **Tests:** нет

#### DLI-77 — Remove comment 'Called on app shutdown…' above `cancelAll` and 'Called by MinecraftManager…' above `resetForUninstall` in BundleManager

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** Lines 439-442: `// Called on app shutdown to abort every active sync — cooperative pause/cancel doesn't stop the underlying sockets unless the runner sees the abort, so we also destroy current requests synchronously and wait a short grace window so the runner's finally blocks (tmp cleanup, manifest writes) can land.` — the 'cooperative pause/cancel doesn't stop sockets' clause is a genuine why (keep). Lines 451-453: `// Called by MinecraftManager.uninstall to wipe the local manifest sidecar file when the client folder isn't fully removed.` — 'Called by X' is the explicitly forbidden caller-reference pattern (§10). The why ('when the client folder isn't fully removed') is the only valuable clause.
- **Why it matters:** §10 forbids caller-reference comments ('used by X flow'). The shutdown comment mixes why-content with what-narration.
- **Proposed solution:** Lines 439-442: keep only `// Cooperative pause/cancel doesn't stop in-flight sockets; destroy them directly and allow a grace window for runner finally blocks.` Lines 451-453: replace with `// Clears the manifest sidecar when the client folder is kept (partial uninstall path).`
- **Affects packages:** нет
- **Tests:** нет

#### DLI-78 — Remove 'Plan + tracker + run' style narrating comment in install.ts

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/install.ts
- **Problem:** Line 122-123: `// No derivable equivalent for runtime path elsewhere in settings.` — This is actually a valid why-comment (explains why `persistRuntime` is called explicitly here). Keep it. However line 120 block: `env.logger.info(...)` followed immediately by `await tryInstall(...)` has no comment — correct. Check: the `handleInstallFailure` flow has no suspicious comment. This file is actually clean. The check completes with no removal needed here.
- **Why it matters:** N/A — this file is clean after inspection.
- **Proposed solution:** No action required in install.ts. The line 122-123 comment ('No derivable equivalent for runtime path elsewhere in settings.') is a valid non-obvious-default-value comment per §10 keep list.
- **Affects packages:** нет
- **Tests:** нет

#### DLI-79 — Remove step-narrating comments in `startInstall` `void runInstall().then()` chain in manager.ts

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** Lines 124-134 in `startInstall`: the chain has two comments. Comment A (lines 123-125): mostly a what-narration about status ordering (already partially flagged). Comment B (lines 138-141): `// Bundle failures surface via the bundle.error event channel; the Minecraft install itself is done, so we keep the INSTALLED state.` This is a valid why-comment — it explains why a caught bundle error does not change the install status. Keep B. Lines 126-128: `// runInstall handles errors internally (emits via handleInstallFailure) and rethrows for the launch path; in the fire-and-forget case we only need the final INSTALLED status on success.` The 'runInstall handles errors internally' part is a what-narration; the 'fire-and-forget case' is borderline useful context.
- **Why it matters:** §10: narrating what `void runInstall().then()` does is a what-restatement pattern.
- **Proposed solution:** Delete lines 126-128 (`// runInstall handles errors…`). Trim lines 123-125 as described in the companion task. Keep lines 138-141 unchanged.
- **Affects packages:** нет
- **Tests:** нет

#### DLI-80 — BundleManager lacks `dispose` path for `pauseIdleTimer` — timer may keep process alive on app shutdown

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: comments-cleanup)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** `armPauseIdleTimer` (line 404-412) sets a `setTimeout` and calls `.unref()` on it so the process can exit. However the `cancelAll` method (line 443-449) only calls `cancelSync` for each active slug — `cancelSync` calls `clearPauseIdleTimer` only when the sync is PAUSED (line 145-165). If a sync is in the PAUSED state and `cancelAll` is called at shutdown, `cancelSync` at line 146 clears the timer via `this.clearPauseIdleTimer(active)`. This path is correct. However `resetForUninstall` (line 453-457) and the index.ts `dispose` path should also ensure the `BundleManager.cancelAll` is awaited before the healer disposes. The `bundle/index.ts` should confirm `manager.cancelAll()` is called during service dispose.
- **Why it matters:** A paused bundle sync's `pauseIdleTimer` (even with `.unref()`) could interfere with the drain window in `index.ts`. More critically, if the timer fires during the grace window it will call `expirePausedSync` → `emitStatus` → `broadcaster.status` on a broadcaster that may already be torn down.
- **Proposed solution:** In `src/main/services/bundle/index.ts`, confirm that `dispose` calls `manager.cancelAll()` before disposing the broadcaster. Add a `cancelAll()` call to BundleService dispose that awaits the grace window. Review `src/main/index.ts` drain sequence to ensure bundle disposes before the broadcaster window closes.
- **Affects packages:** нет
- **Tests:** Unit test: BundleManager.cancelAll() when a paused sync has a live pauseIdleTimer; verify timer is cleared and emitStatus is not called after cancelAll.

#### DLI-81 — MinecraftManager.startInstall double-releases lock when `runInstall` chain has both `.then(lock.release)` and `.finally(lock.release)`

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** Lines 127-151 in `startInstall`: the `void runInstall(...).then(async () => { lock.release(); ... }).catch(() => {}).finally(() => { lock.release(); })` chain releases the lock in both `then` and `finally`. On success path: `then` runs (lock.release), then `finally` runs (lock.release again). The `ClientOperationLease.release()` is guarded with `if (released) return;` (clientOperationLocks.ts line 139) so it is idempotent. However the double-release call is still a latent bug if the guard is ever removed, and it is confusing to maintain. On cancellation path via `handleInstallFailure` the lock is released inside the error branch too (it is not — lock is released only in `then`/`finally`, not in `handleInstallFailure`). Actually tracing the flow: success → then(release) + finally(release); error → catch() + finally(release). So on error the lock IS released by `finally`. The `then(lock.release)` before the inner `if (this.launchHook)` block means: on success, release → run hook → on hook failure the lock is already gone. This is correct behavior. But the `finally` also releases the already-released lock. The issue is code clarity and the double-release pattern.
- **Why it matters:** Double-release is confusing to audit and fragile if the idempotency guard in `clientOperationLocks.ts` is ever changed. The lock should be released exactly once per path.
- **Proposed solution:** Remove `lock.release()` from the `then` callback (line 129). The `.finally(() => lock.release())` (line 148-150) covers all paths including success. Move the `launchHook` invocation to run AFTER `finally` by restructuring to `void runInstall(...).then(...).finally(lock.release).then(runLaunchHook).catch(logHookFail)` or use a `try/finally` pattern in an async IIFE.
- **Affects packages:** нет
- **Tests:** Unit test: verify lock is released exactly once after successful install and after cancelled install.

#### DLI-82 — BundleManager `activeLocks` map entry may leak if `acquireWriteLock` throws after `createActiveSync` adds to `activeSyncs`

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: comments-cleanup)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** In `runSync` (line 201-244): line 226 calls `acquireWriteLock(slug)` — if this throws (OP_IN_FLIGHT), the function throws before `activeSyncs.set(slug, active)` is called (line 231). However if `acquireWriteLock` succeeds and then `createActiveSync` throws (line 228), the lock has been acquired but `activeLocks` is not yet populated, so `dropActiveSync` (which releases the lock) cannot be called from the catch path. The current code does not have a `try/finally` around lines 226-244 in `runSync`. On `executePreparedSync` error (caught at line 305), `dropActiveSync` is called in the `finally` — which correctly releases the lock. The gap is specifically the window between `acquireWriteLock` (line 226) and `activeSyncs.set(slug, active)` (line 231) and `activeLocks.set(slug, lock)` (line 232). If anything between lines 226-232 throws, the lock is acquired but never in `activeLocks`, so `dropActiveSync` won't find it.
- **Why it matters:** In practice `createActiveSync` and `createSyncTask` are synchronous and unlikely to throw, but the lack of a try/finally around the setup block violates the 'wrap long-running operations in try/finally' rule from the guidelines and creates a silent lock leak if any of those constructors ever throw.
- **Proposed solution:** Wrap lines 226-244 in a `try { ... } catch (err) { lock.release(); throw err; }` block so the lock is always released if setup fails before `dropActiveSync` is wired.
- **Affects packages:** нет
- **Tests:** Unit test: mock createSyncTask to throw; verify lock is released.

### Repair / integrity flow (30)

#### REP-01 — MinecraftManager.cancel does not handle OpKinds.UNINSTALL — cancel on uninstall is silently ignored

- **Category:** Code · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/manager.ts:171-185, src/main/services/minecraft/ops.ts:6,27
- **Problem:** `cancel(slug)` checks `INSTALL`, `REPAIR`, `BUNDLE_SYNCING`, `LAUNCH_STARTING` but not `UNINSTALL`. The `UninstallOp` type (ops.ts:27) carries no abort controller, and `runUninstall` does not accept a signal — so cancellation is structurally impossible. However the omission from `cancel()` means a caller that invokes `manager.cancel(slug)` during an uninstall silently receives no-op, while `manager.cancelAll()` also skips UNINSTALL (only cancels INSTALL, REPAIR, LAUNCH_STARTING). The `clientOperationLocks.cancelAll()` order in main/index.ts also calls `clientOperationLocks.cancelAll()` before service dispose — the lock cancel callback set by `acquireWriteLock` + `lock.setCancel(() => this.cancel(slug))` will be invoked, again no-op for uninstall.
- **Why it matters:** An in-progress uninstall survives app shutdown cancellation. On fast Ctrl+Q → relaunch the partially-uninstalled folder may be left in an inconsistent state with the status showing UNINSTALLING until the next status poll.
- **Proposed solution:** Either (a) add a cancellation path to `runUninstall` using an `AbortController` (fs.rm does not accept signals on Node < 20 without a polyfill, but a flag check between the rm call and the status emission is sufficient) and add `UNINSTALL` to `cancelAll`, OR (b) explicitly document in a comment that uninstall is intentionally non-cancellable and remove `UNINSTALL` from `OP_TO_STATUS` so it does not produce a misleading UNINSTALLING status in `getStatus`.
- **Affects packages:** нет
- **Tests:** Unit test: start an uninstall, call cancel, assert status is still UNINSTALLING (not silently changed), and that a second startInstall throws OP_IN_FLIGHT while the op is in the map.

#### REP-02 — processAdapter.ts: repair progress adapter emits stagePercent=overallPercent always (both use the same percent) — no multi-stage aggregation for repair

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/progressAdapter.ts:130-141
- **Problem:** The throttled repair progress emitter (lines 130-141) computes `percent = totalBytes > 0 ? Math.min(100, bytesDownloaded / totalBytes * 100) : 0` and sets both `stagePercent` and `overallPercent` to the same value. The install adapter (via `createInstallProgressTracker`) correctly tracks stage vs overall. For repair, the UI sees an `overallPercent` that does not account for the multiple phases (verify → heal forge processors → ensureLaunchable → bundle sync).
- **Why it matters:** UI shows misleading overall progress during repair — it flatlines at 0 during verify (no bytes), spikes to 100 on download completion, then resets for the next phase. Users perceive repair as complete when it is not.
- **Proposed solution:** Track repair phases with a weight map (similar to install's phase weights). Emit a meaningful overallPercent that accounts for verify duration + download phases. At minimum, separate stagePercent (per-download-phase) from overallPercent (aggregate across all repair phases).
- **Affects packages:** нет
- **Tests:** Unit test: feed a sequence of verify + download events to the repair adapter, assert overallPercent increases monotonically.

#### REP-03 — runDeletePhase does not count ENOENT files in deletedAny — post-delete heal may be skipped when files were externally removed

- **Category:** Flow · **Priority:** P2 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/runner.ts
- **Problem:** In runDeletePhase (lines 164-210), when unlink throws ENOENT (line 188-193), the code increments completedDeletes and continues — but does NOT set deletedAny = true (line 184 is only set in the non-ENOENT branch). deletedAny is the signal that triggers the heal pass (manager.ts line 289). If all files in pendingDeletes were already externally removed (e.g. the user manually deleted them), deletedAny remains false, the heal is skipped, and the vanilla Minecraft files that the bundle was overriding are not restored.
- **Why it matters:** If a user deletes a bundle-owned file that replaced a vanilla file (e.g. a custom options.txt), and the next sync has that file in toDelete (manifest changed), ENOENT means no heal runs, so the vanilla version is never restored. The client is left in a potentially broken state until a manual repair.
- **Proposed solution:** Set deletedAny = true for ENOENT cases too — the file was supposed to be there and no longer is; the heal pass should verify and restore anything the bundle no longer owns. Alternatively, rename deletedAny to needsHeal and set it to true whenever toDelete is non-empty and the sync completes the delete phase without being paused/cancelled.
- **Affects packages:** нет
- **Tests:** Unit: runDeletePhase with all files pre-removed (ENOENT); assert deletedAny is true in the returned PhaseResult.

#### REP-04 — Module-level forgeProcessorActionsCache is never cleared on uninstall or client-folder change

- **Category:** Code · **Priority:** P1 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts
- **Problem:** forgeProcessorActionsCache (line 18) is a module-level Map that lives for the full process lifetime. clearForgeProcessorActionCache() (line 60) is exported but never called from uninstall.ts, manager.ts, or any lifecycle hook. After an uninstall-reinstall cycle (e.g. Forge version bumped in Strapi), the cache key stays the same (target.directory + versions) and the stale processor list from the previous install silently skips the fresh check, causing the up-to-date shortcut to fire against a clean, empty folder.
- **Why it matters:** A silent false-positive 'processor outputs clean' result after a fresh install means Forge processors are never re-run, leaving srg/extra/client jars absent and the game unlaunchable. The bug is timing-dependent and hard to reproduce in CI.
- **Proposed solution:** Either (a) clear the cache in runUninstall (uninstall.ts) and on any startInstall fresh=true path, or (b) scope the cache inside MinecraftManager (pass it through ManagerEnv) so it is naturally discarded when the manager is recreated. Option (b) also eliminates the hidden global state, which contradicts the 'no god-files/no hidden side effects' guideline. Export a clearForgeProcessorCacheFor(targetDir: string) function and call it from runUninstall's finally.
- **Affects packages:** нет
- **Tests:** Unit: call rememberForgeProcessorActions with a plan, run clearForgeProcessorCacheFor(targetDir), confirm a subsequent repairMissingForgeProcessorOutputs no longer finds cached entries and re-plans.

#### REP-05 — persistTargetInstallManifest is duplicated between install.ts and repairWorkflow.ts

- **Status:** DONE — 2026-05-31 · commit 323ea57
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/install.ts (lines 55-65), src/main/services/minecraft/repairWorkflow.ts (lines 66-76)
- **Problem:** Both files define an identically-shaped private function named persistTargetInstallManifest with the same signature, same try/catch, and same warn log format. The only difference is the log prefix ('install' vs 'repair'). Any future change to how the manifest is persisted must be applied in both places.
- **Why it matters:** Duplicated logic diverges silently. The log message prefix is a magic string that could easily get out of sync. Violates the guidelines' no-dead-code/no-repetition expectations.
- **Proposed solution:** Extract a shared persistTargetInstallManifest(env, slug, ctx, opLabel: string) into installManifest.ts (or a thin shared helper module) and import it in both install.ts and repairWorkflow.ts. The opLabel parameter ('install' | 'repair') controls the log prefix.
- **Affects packages:** нет
- **Tests:** Existing integration tests for install and repair paths cover the persist call; add a unit test asserting the helper logs the correct label.

#### REP-06 — bundleHealing.verifyAndRepairExceptBundle calls buildContext() which resolves the target via Strapi — unnecessary inside a heal pass that already has a target

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/bundleHealing.ts (line 71), src/main/services/bundle/healer.ts (lines 29-47)
- **Problem:** verifyAndRepairExceptBundle calls buildContext(kit, slug) at line 71 to obtain ctx.target and ctx.clientFolder. buildContext does: getClient(slug) → Strapi API call, resolveLoader, kit.targets.resolve → may hit network for manifest. This executes inside the HEALING phase of a bundle sync that already has a SyncTask with clientFolder. The Healer interface (healer.ts) accepts only (slug, bundleOwnedPaths, options) — callers have no way to pass the already-resolved target.
- **Why it matters:** A network call (Strapi + version manifest) during heal can fail independently of the heal work, causing a spurious HEAL_FAILED error when the vanilla files are perfectly fixable. It also violates the guideline that services should be called with context already resolved at call boundaries, not re-resolved mid-operation.
- **Proposed solution:** Change verifyAndRepairExceptBundle to accept (kit, target, clientFolder, bundleOwnedPaths, options?) directly. Update Healer.healAfterDeletes to accept Target and clientFolder as additional parameters. In BundleManager.executePreparedSync, resolve the target once (via buildContext or pass it from the task) and thread it through. Remove the buildContext import from bundleHealing.ts — that module must not import from context.ts (cross-service coupling).
- **Affects packages:** нет
- **Tests:** Integration: mock a Strapi outage during heal; confirm repair still proceeds and HEAL_FAILED is not emitted. Unit: bundleHealing.verifyAndRepairExceptBundle with injected target — no kit.targets call.

#### REP-07 — forgeProcessorHealing.ts re-implements SHA-1 file hashing with a streaming Promise wrapper already available in minecraft-kit internals

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts (lines 64-76, 78-85, 91-98)
- **Problem:** sha1OfFile and fileMissing are bespoke Node.js crypto/fs implementations for the purpose of verifying Forge processor outputs. minecraft-kit already tracks processor output hashes (RunForgeProcessorAction.outputs) and performs the same SHA-1 check internally when running a processor via kit.install.run. The launcher re-implements this check to decide which processors to skip — but does so with a subtly different pattern (streaming promise, swallows all errors to null).
- **Why it matters:** If the kit changes its SHA-1 computation logic (e.g. normalisation, streaming chunk size) the launcher's pre-check could produce a different result, causing unnecessary re-runs or missed repairs. Guideline: do not re-implement what the kit already provides.
- **Proposed solution:** Ask whether minecraft-kit can expose a verifyForgeProcessorOutputs(target) function returning the set of broken processor indices. If yes, file a kit issue and update to consume it once available (minecraft-kit: add verifyForgeProcessorOutputs to repair surface; build+copy-dist note applies). Until then, document the gap with a TODO comment citing the kit issue number, and consolidate sha1OfFile and fileMissing into a single shared hash-check helper to reduce footprint.
- **Affects packages:** minecraft-kit: add verifyForgeProcessorOutputs(target): Promise<Set<number>> to repair surface; requires edit package src -> build -> copy dist into launcher node_modules or republish+bump pinned version
- **Tests:** Unit: processorOutputsOk returns false when file missing; returns false when SHA-1 mismatches; returns true on match.

#### REP-08 — forgeProcessorHealing.ts mutates InstallPlan.totalBytes without summing all action byte contributions

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts (lines 165-173)
- **Problem:** focusedBytes (line 165) counts only DOWNLOAD_FILE actions in focusedActions. Other action kinds that may consume I/O (EXTRACT_ZIP, WRITE_FILE etc.) contribute 0 bytes to the denominator. The resulting focusedPlan.totalBytes is therefore an undercount, causing the progress bar for the focused repair plan to show > 100% download completion.
- **Why it matters:** Progress bar flicker or clamping issues at the renderer. The createInstallProgressTracker in the kit uses totalBytes as the denominator for stagePercent/overallPercent; an undercount makes it appear finished early.
- **Proposed solution:** Either include all byte-bearing action kinds in the focusedBytes sum, or simply carry forward plan.totalBytes unchanged (the kit's tracker will tolerate extra unaccounted bytes from skipped processors as those never fire events). Document the deliberate choice.
- **Affects packages:** нет
- **Tests:** Unit: buildFocusedPlan with mixed action types produces totalBytes >= focusedBytes-from-downloads-only.

#### REP-09 — emitReadinessStatus in repairWorkflow.ts re-reads disk twice (hasCurrentTargetInstallManifest + isAnythingInstalled) and is called in both cancellation and failure paths but never in success

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/repairWorkflow.ts (lines 52-64, 175, 185)
- **Problem:** emitReadinessStatus runs two fs operations (loadTargetInstallManifest then readdir of versions/) to decide between INSTALLED/NOT_INSTALLED/ERROR for post-cancel or post-failure status. hasCurrentTargetInstallManifest (line 59) internally calls loadTargetInstallManifest which already reads a file; the combined cost is 2 file reads on every cancel or failure. More importantly, the function name does not convey that it is a side-effecting status emitter — it reads like a query.
- **Why it matters:** Minor: slightly confusing name for a function that emits status as a side effect. readinessPolicy.resolveClientInstallPresence already provides equivalent offline presence detection logic; the two implementations can drift.
- **Proposed solution:** Rename to emitPostOpStatus. Reuse resolveClientInstallPresence (readinessPolicy.ts) to obtain the status, then emit it. This unifies both offline presence checks behind a single code path.
- **Affects packages:** нет
- **Tests:** Unit: finalizeRepairCancellation emits INSTALLED when manifest+versions present; emits NOT_INSTALLED otherwise.

#### REP-10 — bundleHealing.verifyAndRepairExceptBundle: wrong-layer import — minecraft service imports minecraft context from its own module to serve bundle service

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/bundleHealing.ts (line 10, line 71)
- **Problem:** bundleHealing.ts lives inside src/main/services/minecraft/ but is consumed exclusively by src/main/services/bundle/healer.ts. It imports buildContext from ./context — a function that couples this module to Strapi, kit.targets.resolve, and settings. The bundle service imports a file from minecraft/ (a sibling service domain), violating the guideline that cross-service coupling must go through direct import only when architecturally appropriate, and never when it creates circular dependencies or layer inversions. Here the import chain is: bundle/healer.ts → minecraft/bundleHealing.ts → minecraft/context.ts → services/clients → Strapi.
- **Why it matters:** The bundle service indirectly acquires a dependency on the minecraft context-building machinery. Any refactor of context.ts risks breaking bundle healing. It also makes bundleHealing.ts harder to unit-test in isolation.
- **Proposed solution:** Move bundleHealing.ts to src/main/services/bundle/ (rename bundleHealing → minecraftHeal or verifyAndRepair). Remove the buildContext import. Accept (kit, target, clientFolder, bundleOwnedPaths, options) as direct parameters (see task above). healer.ts then passes the already-resolved target from the sync context.
- **Affects packages:** нет
- **Tests:** Unit: verifyAndRepairExceptBundle receives injected target — no network, no Strapi.

#### REP-11 — repair.ts: progress adapter disposal relies solely on finally — but a thrown error before the finally causes the adapter to be disposed by finally without flushing the last progress event

- **Category:** Error handling · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/repair.ts (lines 26-61)
- **Problem:** createRepairProgressAdapter returns a MinecraftProgressAdapter with a dispose() that calls clearPendingFlush (it cancels the pending timer without flushing). If verifyAndRepairBase throws before any progress event fires the flush timer, the in-flight pending flush is cancelled by dispose() in the finally — no final progress event is sent to the renderer. This is a minor UX gap, not a correctness bug.
- **Why it matters:** Progress bar can remain at an intermediate percent after a failure because the pending flush is cancelled without emitting. Guideline: try/finally for cleanup of timers.
- **Proposed solution:** Change dispose() in createThrottledProgressEmitter (progressAdapter.ts) to flush synchronously before clearing the timer (i.e. call flush() unconditionally on dispose if current !== null). This aligns with the 'emit a final frame' pattern.
- **Affects packages:** нет
- **Tests:** Unit: dispose() after partial progress emits one final progress event.

#### REP-12 — manager.ts: cancel() uses a chain of else-if branches instead of a discriminated switch, and LAUNCH op kind is silently ignored

- **Status:** DONE — 2026-05-31 · commit a452fc0
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/manager.ts (lines 171-185)
- **Problem:** cancel() at line 171 uses four else-if branches over op.kind. The UNINSTALL and LAUNCH op kinds fall through silently — no abort, no op.session.abort. For UNINSTALL this is intentional (fs.rm is not abortable), but LAUNCH is not documented as intentionally unabortable here; stop() handles it separately. The pattern differs from the coding guideline ('discriminated unions + assertNever exhaustiveness'): adding a new OpKind does not produce a compile-time error if cancel() is not updated.
- **Why it matters:** A future OpKind addition (e.g. VERIFY) will silently not cancel. The lack of exhaustiveness check means the bug is invisible until runtime.
- **Proposed solution:** Refactor cancel() to a switch with an explicit default that either calls assertNever (if all kinds should be handled) or has a clearly-commented exhaustive list of intentionally-skipped kinds.
- **Affects packages:** нет
- **Tests:** Unit: cancel() called for each OpKind — verify the expected abort/no-op behaviour per kind.

#### REP-13 — manager.ts: startRepair does not emit REPAIRING status until after ops.set, allowing a race where getStatus() reads the old (absent) op between requireIdle and ops.set

- **Category:** Flow · **Priority:** P2 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/manager.ts (lines 187-207)
- **Problem:** startRepair calls requireIdle (line 190), acquires lock, calls await buildContext (line 195) — which is async and can take hundreds of ms — then ops.set and emitStatus (lines 196-199). During the buildContext await, requireIdle already passed (the slug is not in ops), but getStatus() returns the disk-based resolveClientInstallPresence result rather than REPAIRING. A second caller could also pass requireIdle and start a second repair.
- **Why it matters:** The second-caller race is partially guarded by the operationLocks system, but getStatus() returning INSTALLED during a buildContext-in-progress await can confuse the renderer (UI shows Play, user can click again).
- **Proposed solution:** Set ops immediately after requireIdle and before the buildContext await using a sentinel op (e.g. {kind: OpKinds.REPAIR, abort: new AbortController()}). Remove and re-set it only if buildContext throws. This matches the pattern already used in startInstall (beginInstall sets ops synchronously before any await).
- **Affects packages:** нет
- **Tests:** Integration: two concurrent startRepair calls for the same slug — second must throw OP_IN_FLIGHT synchronously.

#### REP-14 — bundleHealing.verifyAndRepairExceptBundle passes ctx.target from a freshly-resolved buildContext but the bundle runner already has a different (potentially stale) target resolution path

- **Category:** Flow · **Priority:** P2 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/bundleHealing.ts (lines 65-102), src/main/services/bundle/healer.ts
- **Problem:** buildContext at line 71 of bundleHealing.ts calls kit.targets.resolve, which may return a target with a different minecraftVersion or loader than what was resolved when the bundle sync started (if Strapi updated between sync-start and heal). The heal then calls kit.verify.minecraft.run on a target that may not match what was installed, causing spurious 'missing files' reports for files that belong to the old version.
- **Why it matters:** Version drift between the sync start and the heal phase could cause unnecessary downloads or false integrity failures during healing. The target should be consistent throughout a single sync session.
- **Proposed solution:** Pass the target resolved at sync-start time into verifyAndRepairExceptBundle, as described in the architecture task above. The SyncTask or ActiveSync should carry a resolved Target once buildContext is called at operation entry.
- **Affects packages:** нет
- **Tests:** Integration: simulate a Strapi version bump mid-sync; confirm heal uses the pre-bump target and does not report false missing files.

#### REP-15 — BundleManager.cancelAll uses a grace setTimeout for finally-block teardown but does not await the active syncs' own promises

- **Category:** Flow · **Priority:** P2 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/bundle/manager.ts (lines 443-449)
- **Problem:** cancelAll() cancels all syncs and then does await new Promise(resolve => setTimeout(resolve, graceMs)) — a blind 250 ms wait. It does not await the actual execution promises of the cancelled syncs, so the callers' finally blocks (which write manifests, release locks) may still be running after cancelAll resolves. On a slow disk this window could be insufficient.
- **Why it matters:** Guideline: try/finally for cleanup. If the main process exits immediately after cancelAll, in-progress manifest writes could be truncated. The partial manifest.json.tmp file would survive and be treated as a stale tmp on the next launch (benign for manifest.json, but misleading in logs).
- **Proposed solution:** Store each runSync execution promise in ActiveSync.promise (type: Promise<void>). cancelAll() awaits Promise.allSettled(promises) after aborting, with a race against a timeout. This provides a deterministic teardown guarantee rather than a blind sleep.
- **Affects packages:** нет
- **Tests:** Integration: cancelAll after a started sync — verify manifest tmp is not left on disk after cancelAll resolves.

#### REP-16 — progressAdapter.ts: AspectTaggedProgressEvent uses a type cast (event as AspectTaggedProgressEvent) to read an undocumented optional .aspect field not part of the public ProgressEvent type

- **Category:** Code · **Priority:** P2 · **Risk:** Medium · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/progressAdapter.ts (lines 36-39, 104-107)
- **Problem:** AspectTaggedProgressEvent (line 36) extends the public ProgressListener parameter type with an optional aspect?: VerificationKind field. This field is cast-read at line 105 from every repair event. It is not part of the published minecraft-kit EventTypes surface. The adapter relies on internal/undocumented event shape augmentation. If the kit stops emitting the aspect field (or renames it) the entire PROGRESS_STAGE_FOR_ASPECT map silently falls back to the download-category path — with no compiler error.
- **Why it matters:** Runtime coupling to an undocumented kit event field. A kit version bump could silently break all verify-phase progress stage detection, leaving the UI stuck on PREPARE.
- **Proposed solution:** File a minecraft-kit issue to expose aspect (or a typed VerificationKind) on VERIFY_FILE_CHECKED and DOWNLOAD_PROGRESS events as a documented field. Until then, add a runtime assertion (if (typeof (event as any).aspect !== 'string') return null) and log a debug message on the first miss, so regressions surface in dev logs. Mark the cast with a TODO comment citing the kit issue. (minecraft-kit: type-expose aspect field on verification progress events; build+copy-dist note applies.)
- **Affects packages:** minecraft-kit: expose typed aspect: VerificationKind on VERIFY_FILE_CHECKED and DOWNLOAD_PROGRESS events; requires edit package src -> build -> copy dist into launcher node_modules or republish+bump pinned version
- **Tests:** Unit: progressStageForAspect returns null when aspect field is absent; returns correct stage when present.

#### REP-17 — readinessPolicy.resolveClientInstallPresence and repairWorkflow.emitReadinessStatus duplicate the same two-check (manifest + isAnythingInstalled) offline presence logic

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/readinessPolicy.ts (lines 20-28), src/main/services/minecraft/repairWorkflow.ts (lines 52-64)
- **Problem:** readinessPolicy.resolveClientInstallPresence (uses loadTargetInstallManifest + isAnythingInstalled) and repairWorkflow.emitReadinessStatus (uses hasCurrentTargetInstallManifest + isAnythingInstalled) both decide installation presence from the same two on-disk signals. The readiness policy returns UNVERIFIED for a legacy install; the repair version collapses this to NOT_INSTALLED. These are two subtly different implementations of the same concept.
- **Why it matters:** If the 'what counts as installed' logic changes (e.g. adding a third marker file), both callsites must be updated. Guideline: single source of truth for domain logic.
- **Proposed solution:** Unify into resolveClientInstallPresence. In repairWorkflow.emitReadinessStatus, call resolveClientInstallPresence(slug) and map UNVERIFIED → notReadyStatus. This makes the post-repair status consistent with the boot-time status.
- **Affects packages:** нет
- **Tests:** Unit: emitReadinessStatus with UNVERIFIED case maps correctly to supplied notReadyStatus.

#### REP-18 — bundleHealing.verifyAndRepairExceptBundle calls buildContext internally — unnecessary second target resolution

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/bundleHealing.ts (L71), src/main/services/bundle/healer.ts (L30-47)
- **Problem:** `verifyAndRepairExceptBundle` (bundleHealing.ts L71) calls `buildContext(kit, slug)` which internally calls `kit.targets.resolve` (a network-capable round-trip to Strapi + kit target resolution). The caller `createHealer.healAfterDeletes` is itself called from `executePreparedSync` inside `BundleManager`, which already has the context resolved upstream (the repair path in repairWorkflow.ts already passes ctx explicitly). The bundle healer rebuilds context independently during a sync.
- **Why it matters:** Double target resolution adds latency and Strapi load during the HEALING phase of every bundle sync that deletes files. It also creates a TOCTOU risk: the context rebuilt during healing may resolve a different loader/version than the one used for the install if Strapi updates between the two calls.
- **Proposed solution:** Pass the pre-resolved `Context` (clientFolder + target) into `Healer.healAfterDeletes` instead of re-building it inside. Refactor `verifyAndRepairExceptBundle` to accept `(kit, ctx, bundleOwnedPaths, options)`. Update `BundleManager.executePreparedSync` to pass the context it already holds via the `active.task.clientFolder` and resolved target. The `Healer` type in healer.ts gains a `context` parameter.
- **Affects packages:** нет
- **Tests:** Integration: verify heal phase uses same minecraft version as install phase even when Strapi target changes mid-sync.

#### REP-19 — forgeProcessorActionsCache is a module-level mutable singleton — hidden shared state, not disposed on uninstall

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts (L18)
- **Problem:** `const forgeProcessorActionsCache = new Map<string, readonly RunForgeProcessorAction[]>()` at module level (L18) is a permanent, unscoped cache. `clearForgeProcessorActionCache()` exists (L61) but is never called from uninstall or from the test setup. If a client is uninstalled and reinstalled with a different Forge version, the old cached actions keyed by the prior target's full version may still be present. The cache key includes the target directory, installer URL, and minecraft version, but not the kit version — a kit upgrade could change processor semantics while the cache key stays the same.
- **Why it matters:** Stale processor actions surviving across installs can cause forge processor outputs to appear 'clean' when they are actually wrong for the new kit version, silently skipping re-execution and leaving a broken install.
- **Proposed solution:** Include `MINECRAFT_KIT_VERSION` in the cache key. Also call `clearForgeProcessorActionCache()` from `runUninstall` to evict the entry for the client folder being removed. Consider scoping the cache to the MinecraftKit instance lifetime rather than the module.
- **Affects packages:** нет
- **Tests:** Unit: cache key changes when kit version changes; cache cleared after uninstall.

#### REP-20 — bundleHealing.verifyAndRepairExceptBundle calls buildContext — network/settings side-effect in heal path

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/bundleHealing.ts line 71
- **Problem:** verifyAndRepairExceptBundle (bundleHealing.ts line 71) calls buildContext(kit, slug) internally. buildContext fetches the client from Strapi (getClient network call, context.ts line 32), resolves settings, and resolves the kit target (kit.targets.resolve, another potential network call). This means the bundle heal phase — triggered after every delete during a bundle sync — makes implicit network calls that are not visible to the BundleManager's abort signal.
- **Why it matters:** If Strapi is unreachable at heal time, buildContext throws with ManagerError(UNKNOWN). healer.ts catches all errors at line 36 and rethrows as BundleError(HEAL_FAILED). The signal passed to healAfterDeletes is not forwarded to buildContext. A user cancellation during healing may not abort these inner network calls, leaving the operation hung for the HTTP timeout duration.
- **Proposed solution:** Refactor verifyAndRepairExceptBundle to accept a pre-built Context (already resolved before the sync started and still valid for the heal pass) instead of calling buildContext internally. The BundleManager already runs the heal within executePreparedSync after a successful download phase where the target is fully known. Pass ctx from the caller or resolve it once at sync start and store on ActiveSync.
- **Affects packages:** нет
- **Tests:** Unit test verifyAndRepairExceptBundle: assert buildContext is NOT called; assert kit.verify.minecraft.run is called with the pre-built target.

#### REP-21 — forgeProcessorActionsCache is a module-level mutable Map — untestable global state

- **Category:** Code · **Priority:** P2 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts lines 18, 60-62
- **Problem:** forgeProcessorActionsCache (line 18) is a module-level Map that persists across repair calls in the same process lifetime. clearForgeProcessorActionCache (lines 60-62) is exported but never called from production code (only intended for tests). The cache is populated in rememberForgeProcessorActions (install.ts line 100) and consumed in repairMissingForgeProcessorOutputs. If a Forge version changes between install and repair without a restart, the stale cache can cause the repair to skip re-running processors.
- **Why it matters:** Module-level mutable state is difficult to test in isolation (tests must call clearForgeProcessorActionCache between cases), and the staleness risk means a version upgrade without a launcher restart could cause repair to report success when processor outputs are actually wrong for the new version.
- **Proposed solution:** Move the processor action cache into MinecraftManager (or a kit-scoped structure) as an instance field so it has a bounded lifetime, is reset when the manager is re-created, and does not require a module-level teardown in tests. Pass it to rememberForgeProcessorActions and repairMissingForgeProcessorOutputs as a parameter.
- **Affects packages:** нет
- **Tests:** Unit test repairMissingForgeProcessorOutputs: pass a fresh empty cache each call; assert it reads from/writes to the provided cache, not a module global.

#### REP-22 — bundleHealing.ts calls buildContext() directly, tying the bundle-heal seam to the full Minecraft context build

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/bundleHealing.ts:71, src/main/services/bundle/healer.ts
- **Problem:** verifyAndRepairExceptBundle() calls buildContext(kit, slug) at line 71 of bundleHealing.ts. buildContext() calls getClient() (Strapi network), getSettings() (disk), and kit.targets.resolve() (network/disk). This fuses the heal step with the full context-build side-effect chain, making the function impossible to unit-test without mocking 4+ modules. The healer (bundle service) also directly imports from the minecraft service layer, crossing the bundle↔minecraft boundary.
- **Why it matters:** Any unit test for verifyAndRepairExceptBundle must mock @main/services/minecraft/context (and transitively @main/services/clients, @main/services/settings/settings, electron, kit) instead of simply injecting a Target. This raises the mock surface and obscures what the function actually tests. The cross-service import also breaks the stated architecture (cross-service via direct import is permitted, but bundle→minecraft context is a tighter coupling than intended).
- **Proposed solution:** Change the signature of verifyAndRepairExceptBundle to accept (kit, target, clientFolder, bundleOwnedPaths, options) instead of (kit, slug, …). Let healer.ts (or BundleManager) be responsible for resolving context before calling the heal function, passing the already-resolved target and clientFolder. The heal step becomes a pure function of those inputs.
- **Affects packages:** нет
- **Tests:** Unit test verifyAndRepairExceptBundle with a fake Target and clientFolder — no module mocks required. Test the bundle-owned issue filter in isolation.

#### REP-23 — forgeProcessorActionsCache is a module-level singleton that leaks between test runs

- **Category:** Testing · **Priority:** P1 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts:18
- **Problem:** forgeProcessorActionsCache is declared as a module-level Map at line 18. clearForgeProcessorActionCache() exists but is never called from tests in tests/main/services/minecraft/forgeProcessorHealing.test.ts (nor in install.test.ts which exercises rememberForgeProcessorActions). If tests run in the same module scope and one test seeds the cache, subsequent tests observe stale cache state.
- **Why it matters:** Produces non-deterministic test ordering failures. A repair test that happens to run after an install test that called rememberForgeProcessorActions will find pre-populated cache entries and follow a different code path (cached branch vs. network branch) depending on order.
- **Proposed solution:** Call clearForgeProcessorActionCache() in beforeEach in forgeProcessorHealing.test.ts and install.test.ts. Alternatively, inject the cache map as a parameter to repairMissingForgeProcessorOutputs so the function is purely stateless and testable without the global.
- **Affects packages:** нет
- **Tests:** Existing forgeProcessorHealing tests should call clearForgeProcessorActionCache() in beforeEach. Add an explicit test that verifies the cache avoids re-planning when all processor outputs are already on disk (the cached-clean branch on lines 128-135).

#### REP-24 — No tests for repair→bundle-sync post-repair hook (MinecraftManager.finishRepair launchHook path)

- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/manager.ts:315-335
- **Problem:** finishRepair (lines 315-335) calls launchHook after a successful repair. There is no test verifying: (1) that the hook is only called when repaired===true; (2) that a hook failure logs a warn and does not propagate; (3) that the lock is released before the hook (line 318). The existing repair tests (repairWorkflow.test.ts, install.test.ts) test runRepair in isolation without the manager wrapping.
- **Why it matters:** The repaired===false guard (line 328) and the hook-failure swallow (line 333) are untested invariants. A regression that removes the guard would call the bundle hook after every cancellation/failure.
- **Proposed solution:** Add tests to managerReadinessIntegration.test.ts or a new managerRepair.test.ts: mock runRepair to return true or false, spy on launchHook, verify hook called only when true; verify hook error is not rethrown.
- **Affects packages:** нет
- **Tests:** Unit tests for MinecraftManager.startRepair covering the hook-call conditions.

#### REP-25 — Replace hand-rolled SHA-1 file hasher in forgeProcessorHealing.ts with kit's verify infrastructure

- **Category:** Dependency extraction · **Priority:** P1 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts
- **Problem:** Lines 64-76 implement `sha1OfFile` as a manual `createReadStream` + `crypto.createHash` pipeline, and lines 78-85 implement `fileMissing` via `stat`. Lines 91-98 (`processorOutputsOk`) then combine both to check processor outputs. This duplicates hashing logic that already exists inside minecraft-kit's verify/repair infrastructure.
- **Why it matters:** Any bug fix or optimisation (e.g. streaming hash vs. full read, error classification) must be applied in two places. The manual stream error handling (no `try/finally` to close the stream on abort) can also leak file descriptors if the AbortSignal fires mid-hash.
- **Proposed solution:** Replace `sha1OfFile` + `fileMissing` + `processorOutputsOk` with a direct call to `kit.verify.forge.run(target, { signal })` scoped to the specific processor output paths, or alternatively integrate into the existing `kit.repair.forge` flow. If kit does not expose per-file SHA-1 verification as a public API, extract the helper into minecraft-kit as `hashFileHex(algo, path): Promise<string|null>` so both the forge-processor check and any future callers share the implementation.
- **Affects packages:** minecraft-kit: если функции проверки SHA по одному файлу не экспортируются, нужно добавить `hashFileHex` в публичный API пакета; после изменения исходного кода — сборка пакета и замена dist в node_modules (или публикация новой версии + обновление pinned-версии 0.8.13).
- **Tests:** Unit: mock `fs.createReadStream`; check that `processorOutputsOk` returns false for missing file, false for hash mismatch, true for match. Integration: run the healing path against a real forge plan stub with one broken processor output.

#### REP-26 — Extract Forge processor output verification into minecraft-kit as a supported repair sub-plan

- **Category:** Dependency extraction · **Priority:** P1 · **Risk:** High · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts
- **Problem:** The entire module (188 lines) implements a hand-built Forge processor re-run loop: it reads the install plan, identifies actions of kind `RUN_FORGE_PROCESSOR`, hashes their declared outputs, filters to broken ones, and executes a focused sub-plan. This is parallel to what `kit.repair.forge` should cover but currently does not (the comment on line 113 explains why: `kit.verify.forge` only checks version.json libraries, not processor-generated files). The launcher therefore carries full knowledge of kit internals (`InstallActionKinds.RUN_FORGE_PROCESSOR`, `action.outputs`, `action.index`) that are implementation details of the kit.
- **Why it matters:** Any change to how the kit represents Forge processor actions (e.g. renaming `action.outputs` or `action.index`) silently breaks this file. The action-kind import (`InstallActionKinds`) is already at the boundary of what a consumer should inspect. This logic belongs in `kit.repair.forge` as a `repairProcessorOutputs` step.
- **Proposed solution:** File a feature request / PR to minecraft-kit to add `kit.repair.forge.repairProcessorOutputs(target, { signal, runPlan? })` that encapsulates the processor-output check and selective re-run. Once merged, build+copy dist and replace the entire `forgeProcessorHealing.ts` with a thin wrapper calling the kit API. In the interim, document the coupling with a `// depends on kit internals` comment and pin the kit version check in CI.
- **Affects packages:** minecraft-kit: добавить `repairProcessorOutputs` в `repair.forge`; после изменения — пересобрать пакет, скопировать dist в node_modules или опубликовать новую версию и обновить pinned-версию.
- **Tests:** Integration: mock `kit.install.plan` to return a plan with one broken processor action and one clean one; verify only the broken one is re-run. Unit: `brokenProcessorIndices` with all-ok outputs, one missing, one sha1-mismatch.

#### REP-27 — Fix module-level `forgeProcessorActionsCache` singleton in forgeProcessorHealing.ts: it survives across test runs and between kit re-initialisations

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts
- **Problem:** `forgeProcessorActionsCache` (line 18) is a module-level `Map` that is never cleared except via the exported `clearForgeProcessorActionCache()`. There is no caller of `clearForgeProcessorActionCache` visible in the service layer (only exported for tests). The cache is keyed by `(directory, minecraft.version, loader.fullVersion, installerUrl)` (lines 34-39), which is stable for a given install, but if the same process reinstalls a client at the same path with a different Forge version and the key changes, the old entry is never evicted.
- **Why it matters:** In long-running session (launcher stays open, user reinstalls), stale entries accumulate. More critically, a test that instantiates `MinecraftManager` twice without clearing the module cache will see phantom processor action lists from the previous test case.
- **Proposed solution:** Tie the cache lifetime to the `MinecraftKit` instance or the `MinecraftManager` lifecycle: inject it as a constructor parameter (`Map<string, readonly RunForgeProcessorAction[]>`) rather than using a module-level singleton. `clearForgeProcessorActionCache` becomes unnecessary. Alternatively, add a `WeakMap` keyed on the kit instance.
- **Affects packages:** нет
- **Tests:** Unit: call `rememberForgeProcessorActions` with plan A, then with plan B at the same key; verify cache holds only B. Integration: reinstall scenario does not use stale processor actions.

#### REP-28 — Export `createBundleRepairIssueFilter` from bundleHealing.ts only — remove duplicate inline closure in repairWorkflow.ts

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/repairWorkflow.ts, src/main/services/minecraft/bundleHealing.ts
- **Problem:** `repairWorkflow.ts` line 11 imports `createBundleRepairIssueFilter` from `bundleHealing.ts` (correct). `bundleHealing.ts` line 50-53 exports the filter factory (correct). No duplication here. However, `repairWorkflow.ts` `loadBundleOwnedPaths` (lines 41-47) re-reads the local manifest and constructs the bundle path set, while `bundleHealing.ts` `verifyAndRepairExceptBundle` also calls `buildContext` which re-reads the client (lines 71-72). The context is built twice for the bundle heal path: once in the caller (`repairWorkflow.ts` via `ctx`) and once inside `verifyAndRepairExceptBundle` (`buildContext(kit, slug)`).
- **Why it matters:** Two `getClient` calls for the same slug per repair operation. If client data changes between the two calls (unlikely but possible in tests with mocks), the two contexts diverge silently.
- **Proposed solution:** Refactor `verifyAndRepairExceptBundle` to accept a pre-resolved `ctx: Context` instead of calling `buildContext` internally. The caller in `bundleHealing.ts` already has the context. Remove the internal `buildContext` call in `verifyAndRepairExceptBundle`.
- **Affects packages:** нет
- **Tests:** Unit: call `verifyAndRepairExceptBundle` with a pre-built context mock; assert `getClient` is called exactly once per repair flow.

#### REP-29 — `forgeProcessorActionsCache` is a module-level Map with no eviction — grows unbounded across repairs

- **Category:** Performance · **Priority:** P2 · **Risk:** Medium · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/forgeProcessorHealing.ts
- **Problem:** Line 18: `const forgeProcessorActionsCache = new Map<string, readonly RunForgeProcessorAction[]>();` — this cache is keyed by a JSON string of [directory, mcVersion, forgeVersion, installerUrl] and is never evicted except via `clearForgeProcessorActionCache()`. In a long-running launcher session where users install and repair multiple clients across different Forge versions, entries accumulate. `clearForgeProcessorActionCache()` is exported but it is unclear when (if ever) it is called from outside the module.
- **Why it matters:** Each cache entry holds a `readonly RunForgeProcessorAction[]` which can be large (Forge plans have tens of processor actions with full classpath strings). Over many repair cycles this leaks memory. The cache is also not invalidated when a client is uninstalled.
- **Proposed solution:** Bound the cache with a max-size eviction (LRU or simple FIFO at 10 entries), or call `clearForgeProcessorActionCache()` from `MinecraftManager.uninstall`. Search callers — if `clearForgeProcessorActionCache` is never called in production, add a call in the uninstall flow and document the lifecycle.
- **Affects packages:** нет
- **Tests:** Unit test: fill cache beyond the bound, verify oldest entry is evicted.

#### REP-30 — `verifyAndRepairExceptBundle` in bundleHealing.ts calls `buildContext` internally, bypassing the caller's context

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/bundleHealing.ts
- **Problem:** Line 71: `const ctx = await buildContext(kit, slug);` — `verifyAndRepairExceptBundle` rebuilds the context from scratch instead of accepting a pre-built `Context` from the caller. The healer is called from `bundle/healer.ts` which does NOT have the minecraft Context already built; it only has the slug and kit. However `buildContext` is an async call that resolves the target from the Strapi API (via `getClient`) and resolves settings — it is not cheap. Since the heal path runs after a bundle delete, the context is re-fetched every time.
- **Why it matters:** Unnecessary re-fetch of client data from the network on every bundle heal cycle increases latency and creates a redundant call to `getClient`. If the client's config changes between the bundle sync completing and the heal starting, the two calls may return different target configurations.
- **Proposed solution:** Add a `ctx: Context` parameter to `verifyAndRepairExceptBundle` and remove the internal `buildContext` call. The healer entry point (bundle/healer.ts) should pass the context it builds, or the context should be passed down from the bundle manager.
- **Affects packages:** нет
- **Tests:** Integration test: heal after delete with a mocked context; verify buildContext is not called.

### Launch flow (33)

#### LAU-01 — getStoredAccount() imported directly into minecraft/routes.ts — cross-service coupling at route layer

- **Category:** Architecture · **Priority:** P1 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/routes.ts:3,49, src/main/services/auth/auth.ts:53
- **Problem:** routes.ts line 3 imports `getStoredAccount` from `@main/services/auth/auth` and calls it at line 49 inside the minecraft.launch handler. This is a direct cross-service import at the IPC routing layer. The guideline says cross-service communication goes through direct imports, which is technically done here, but the route layer is supposed to be a thin delegation to the manager; business logic (account lookup) must not live there.
- **Why it matters:** The launch route now has two responsibilities: parse IPC args and resolve the account. If account resolution logic changes (e.g. needs to be async or throw a typed error), the routes file must also change. It also makes the route untestable in isolation — tests must stub a module-level auth singleton.
- **Proposed solution:** Move the account resolution into `MinecraftManager.startLaunch`: the manager already receives the resolved account as a parameter (`account: Account | null`). Change `startLaunch` to call `getStoredAccount()` internally (or accept an account-provider callback injected at construction), so the route handler simply calls `await manager.startLaunch(slug)` with no account argument. This keeps the route layer thin and the manager self-contained.
- **Affects packages:** нет
- **Tests:** Unit test for MinecraftManager.startLaunch that injects a fake account provider and asserts NO_ACCOUNT is thrown when null is returned.

#### LAU-02 — consoleHub singleton imported as a module-level side-effect inside minecraft/launch.ts — breaks DI model

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/launch.ts (imports consoleHub, openConsoleWindow at module scope), src/main/infra/consoleHub.ts:230
- **Problem:** `launch.ts` imports `consoleHub` (a module singleton exported by `infra/consoleHub.ts`) and `openConsoleWindow` (from `windows/consoleWindow`) directly, bypassing the `ManagerEnv` dependency-injection contract used for every other side-effect (broadcaster, logger, ops, kit). `ManagerEnv` has no console-related slot. Tests that import `launch.ts` indirectly pull in the real `ConsoleHub` with its timer and window references.
- **Why it matters:** Violates the DI model established by ManagerEnv. Makes unit testing `runLaunch` impossible without a live ConsoleHub. Any future refactoring of ConsoleHub (e.g. making it constructable for multi-window support) must also touch launch.ts. Also causes a hidden circular path: minecraft → infra → (potentially) windows.
- **Proposed solution:** Add a `console` slot to `ManagerEnv` that exposes the subset of ConsoleHub methods used in launch.ts (`setActiveSession`, `emitState`, `recordSystem`, `recordMinecraft`, `hasWindow`, `flushPending`). Inject the real `consoleHub` singleton when `ManagerEnv` is constructed in `MinecraftManager`. Similarly, add an `openConsole: () => void` callback to `ManagerEnv`. Unit tests inject a no-op stub for both.
- **Affects packages:** нет
- **Tests:** Unit test for runLaunch that injects a spy console object and asserts the correct emitState/recordSystem calls are made without any real window creation.

#### LAU-03 — ConsoleHub is a module-level class instance singleton — untestable and violates DI conventions used elsewhere

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/infra/consoleHub.ts:230
- **Problem:** `export const consoleHub = new ConsoleHub()` at line 230 creates a process-global singleton. It is accessed via direct module import in `launch.ts`, `consoleWindow.ts`, `ipc/trustedSender.ts`, and `console/index.ts`. This is the only infrastructure singleton using this pattern — `kit`, `http`, `cache`, `store`, `logger` all use factory functions. The singleton cannot be reset between test cases, causing state leakage.
- **Why it matters:** Integration tests that exercise launch flows share the same buffer/timer state. A test that opens a console window leaves the sink attached for the next test. The `flushTimer` from one test fires into the next one's event loop.
- **Proposed solution:** Export a factory `createConsoleHub()` and change the module export to a lazily-created default instance. Pass the instance through service factories (or through ManagerEnv as described in the consoleHub/launch.ts DI task) so tests can inject a fresh instance per test run.
- **Affects packages:** нет
- **Tests:** Unit test: create two ConsoleHub instances independently, verify their buffers are isolated.

#### LAU-04 — IPC event channel names for 'minecraft.log' are broadcast unconditionally to all subscribers but only when consoleEnabled — inconsistent gate

- **Category:** IPC · **Priority:** P2 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/minecraft/launch.ts:311-316
- **Problem:** `consoleHub.recordMinecraft` is called for every stdout/stderr line unconditionally (line 312). The legacy `broadcaster.log` (IPC event `minecraft.log`) is emitted conditionally at line 315 only when `consoleEnabled`. The contract comment says '`minecraft.log` IPC event for external subscribers' but the IpcEventPayloads contract lists `minecraft.log` as a first-class event — there is no documentation that it is conditional on the console setting. A renderer subscriber to `minecraft.log` will silently receive no events when `consoleEnabled` is false.
- **Why it matters:** Undocumented conditional behaviour on a contract channel. Any future external subscriber to `minecraft.log` will not work unless the user has the console setting enabled.
- **Proposed solution:** Either (a) always emit `minecraft.log` regardless of `consoleEnabled` and document that `console.lines` is the preferred channel (since consoleHub already batches lines), or (b) remove `minecraft.log` from IpcEventPayloads and the preload's `on()` proxy since it is superseded by `console.lines`. Option (b) is a breaking API removal; option (a) is the safer fix.
- **Affects packages:** нет
- **Tests:** Integration test: launch with console=false, subscribe to minecraft.log, assert events are still received.

#### LAU-05 — consoleHub.flushPending() in ConsoleService.dispose sends lines to the window after router.dispose() has removed the console handlers

- **Category:** Error handling · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/index.ts:146-161 (drain order), src/main/services/console/index.ts:35
- **Problem:** In `drain()` (main/index.ts lines 146-161), `Promise.allSettled` disposes all services including `consoleService` (which calls `consoleHub.flushPending()`), then `router.dispose()` is called after the allSettled resolves. `flushPending` calls `sendToWindow` → `sink.send` which calls `window.webContents.send`. If the main window is already closed (app is quitting), `webContents.send` on a destroyed window throws. The `sink.send` method should check `isDestroyed()` but the ConsoleWindowSink may not do so.
- **Why it matters:** Potential unhandled exception on app quit when a game session was active just before quit. The exception could delay clean shutdown.
- **Proposed solution:** Check that ConsoleWindowSink.send guards against destroyed webContents (add `if (window.isDestroyed()) return` if missing). Alternatively, call `consoleService.dispose()` last in the drain sequence, after all other services, so no new lines are produced after the flush. Read src/main/infra/consoleWindowSink.ts to confirm the guard exists.
- **Affects packages:** нет
- **Tests:** Integration test: quit the app while a launch is in progress, assert no unhandled exception is thrown during drain.

#### LAU-06 — `getStoredAccount` in auth.ts reads the store directly and is used by the launch path, bypassing the auth service interface

- **Category:** Architecture · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/auth.ts:53-56, src/main/services/minecraft/routes.ts:3
- **Problem:** Lines 53-56: `getStoredAccount` calls `getStoredAuth()` and wraps it in `accountFromSession`. The minecraft routes (routes.ts:3) import this from `@main/services/auth/auth`, making the auth module's internal read visible outside the auth service. The launch path in manager.ts (line 229) calls `requireAccount(account)` after receiving the stored account, meaning the auth service leaks its store-reading responsibility into the minecraft service's coordination layer.
- **Why it matters:** If the auth service ever needs to add async logic to `getStoredAccount` (e.g. checking a lock, validating a token), the synchronous call site in the minecraft route would require refactoring. The current design also means the minecraft service depends on both the auth service public surface and the store layer.
- **Proposed solution:** Keep `getStoredAccount` as is for now (the launch path's constraint that it cannot await is genuine), but document the architectural reason clearly. Consider making `getStoredAccount` return `Account | null` from a cached in-memory reference that the auth service maintains, so the launch path reads from RAM rather than disk.
- **Affects packages:** нет
- **Tests:** нет

#### LAU-07 — No branded type for `YggdrasilSession.profile.uuid` (undashed), so the dashed/undashed invariant is not compile-time enforced

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/shared/contracts/auth.ts:63-67, src/main/services/auth/yggdrasilAuth.ts:64,103
- **Problem:** The `YggdrasilProfile.uuid` field is typed as `string` (via `z.string().refine(isUuidUndashed)`). Downstream code in launch.ts (line 210) must call `dashUuid(session.profile.uuid)` to convert it back to the dashed form expected by the kit's `asPlayerUuid`. There is no branded type preventing code from passing the undashed UUID directly to `asPlayerUuid` (which accepts `string`) without `dashUuid`. The Mojang path uses the kit's `PlayerUuid` brand for the dashed form, creating asymmetry.
- **Why it matters:** An accidental call to `asPlayerUuid(session.profile.uuid)` without `dashUuid` would pass TypeScript but break the Mojang authlib at runtime with a malformed UUID. The transform must be remembered at every launch-composition site.
- **Proposed solution:** Introduce a `UndashUuid` branded type in yggdrasil-core (or locally in shared/contracts/auth.ts) using the existing `isUuidUndashed` predicate. Apply it as the transform output of `YggdrasilProfileSchema.uuid`. The launch path then has a compile-time reminder that `dashUuid` is required before handing it to `asPlayerUuid`.
- **Affects packages:** loontail-yggdrasil: add branded `UndashUuid` type and corresponding `asUndashUuid` factory to yggdrasil-core exports; build + copy dist
- **Tests:** Type-level: assert `YggdrasilProfile.uuid` is not assignable to `PlayerUuid` without passing through `dashUuid`.

#### LAU-08 — cancelSync called from syncForLaunch's external abort handler may fire after the sync has already completed — double-cancel/drop risk

- **Category:** Flow · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** syncForLaunch (lines 96-109) registers onExternalAbort (line 100-102) on the externalSignal's 'abort' event with { once: true }. If the sync completes normally (dropActiveSync is called at line 320), the slug is removed from activeSyncs. If the external signal is then aborted (launch cancelled while sync was completing), cancelSync (line 142) is called, but activeSyncs.get(slug) returns undefined, so it returns early. This is safe. BUT the removeEventListener at line 107 runs in the finally block — if the sync already completed and the signal fires before finally executes (theoretically possible in a microtask scheduling edge case), the handler is still registered and cancelSync runs on an already-cleaned-up slug.
- **Why it matters:** The window is extremely small (between dropActiveSync and removeEventListener), but the { once: true } listener guarantees the handler fires at most once. cancelSync is already guarded for missing slug. The actual risk is negligible, but the code comment should document this ordering dependency to prevent regressions during refactors.
- **Proposed solution:** Move removeEventListener to the top of the finally block before dropActiveSync (or equivalently before any path that clears activeSyncs). Add a brief comment documenting why the removal must precede cleanup. Alternatively replace the event listener pattern with an AbortSignal.any([task.abort.signal, externalSignal]) composition.
- **Affects packages:** нет
- **Tests:** Unit: signal fires concurrently with sync completion; assert no double-cancel and no error thrown.

#### LAU-09 — Capture and surface process exit code from LaunchExit in crash banner

- **Category:** Flow · **Priority:** P1 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/launch.ts, src/shared/contracts/console.ts
- **Problem:** endLaunch (launch.ts:164) calls consoleHub.emitState with exitCode: null hardcoded on the success path. The kit's session.exited promise resolves to LaunchExit {code, signal, aborted}. The .then()/.catch() chain at launch.ts:339 does not receive the resolved value — both callbacks ignore it. On the crash path (.catch), the error is forwarded but its exit code is never extracted either. The crash banner (ConsoleCrashBanner.tsx:14) already renders exitCode when non-null, so the UI is ready but always shows nothing.
- **Why it matters:** Users and support staff see 'CRASHED' with no exit code in the banner. Non-zero exit codes (e.g. -1073741819 / 0xC0000005 = access violation, 1 = Java OOM, 137 = OOM kill) are the first triage signal for Minecraft crashes.
- **Proposed solution:** Change the session.exited chain to receive LaunchExit: .then((exit) => endLaunch(env, slug, undefined, exit)).catch((error) => endLaunch(env, slug, error)). Add an optional exit: LaunchExit parameter to endLaunch. On success path emit exitCode: exit.code ?? null. On crash path, extract the code from the MinecraftKitError context if available (kit wraps LAUNCH_PROCESS_FAILED with the exit code in its context) or use exit.code from the resolved value via a dual-path. Also add signal: string | null to ConsoleProcessState so the renderer can show signal kills (e.g. SIGKILL).
- **Affects packages:** нет
- **Tests:** Unit test endLaunch with a mock exit {code: 1, signal: null, aborted: false} and verify emitState receives exitCode: 1. Unit test with aborted: true verifies exitCode: null.

#### LAU-10 — Flush log4j parser buffers on process exit, not only on next session start

- **Category:** Flow · **Priority:** P1 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/infra/consoleHub.ts, src/main/services/minecraft/launch.ts
- **Problem:** Log4jStreamParser.flush() is only called inside ConsoleHub.setActiveSession() (consoleHub.ts:141). endLaunch (launch.ts:148-171) never calls flush. If the game process exits while the log4j stream buffer holds a partial or complete unparsed event (e.g. a final FATAL event split across the last two lines), that fragment is silently discarded until the next play session resets the parser. Particularly relevant for crash logs that end mid-event.
- **Why it matters:** The very last crash event — the one most useful for diagnosis — may be swallowed. FATAL-level log4j events containing the crash reason are never emitted to the console.
- **Proposed solution:** Add a flushLog4j() method to ConsoleHub (or expose log4j flush calls via existing recordMinecraft) that consoleHub calls internally when endLaunch triggers. Best implementation: call this.log4j.flush() for both streams inside endLaunch's equivalent in ConsoleHub. One approach: add a private flushLog4jBuffers(slug) helper mirroring the setActiveSession drain logic (consoleHub.ts:140-149) and call it from a new public endSession(slug) method. Call consoleHub.endSession(slug) in endLaunch before emitting EXITED/CRASHED state.
- **Affects packages:** нет
- **Tests:** Unit test: feed a partial log4j event to ConsoleHub.recordMinecraft, then call endSession — verify the event is parsed and ingested into the buffer before the EXITED state is emitted.

#### LAU-11 — Remove dead minecraft.log IPC channel — broadcaster.log is never consumed

- **Category:** Architecture · **Priority:** P1 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/launch.ts:313-315, src/main/services/minecraft/broadcast.ts:19-22, src/renderer/features/minecraft/events.ts:96, src/shared/contracts/minecraft.ts:78-83, src/shared/ipc/channels.ts
- **Problem:** launch.ts:313-315 conditionally calls env.broadcaster.log() to send the minecraft.log IPC event. events.ts:96 subscribes to IPC_EVENTS.minecraftLog with a no-op callback () => {}. The MinecraftLogEvent type and MinecraftLogEventSchema are defined in the contracts. consoleHub already receives all lines unconditionally via recordMinecraft(). The consoleEnabled guard (launch.ts:278,314) adds a per-event branch but the renderer ignores the event completely.
- **Why it matters:** Dead code: three layers (main broadcast, IPC channel definition, renderer subscriber) maintain a pipeline whose only consumer is an empty function. The consoleEnabled conditional logic in the hot onEvent path is meaningless overhead. It falsely implies an external subscriber exists.
- **Proposed solution:** Delete env.broadcaster.log(), the log method in Broadcaster, the minecraftLog channel from IPC channels, MinecraftLogEvent / MinecraftLogEventSchema from contracts, the offLog subscription in events.ts, and the consoleEnabled branch in launch.ts. Also delete consoleEnabled from LaunchOp in ops.ts:42 if it has no remaining uses. Audit all imports to remove newly dead symbols.
- **Affects packages:** нет
- **Tests:** нет (pure deletion — build + type-check suffice)

#### LAU-12 — runLaunch re-throws non-preflight errors after already emitting error state — double-handling at IPC boundary

- **Category:** Error handling · **Priority:** P2 · **Risk:** Medium · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/launch.ts:349-377, src/main/ipc/router.ts:79-82
- **Problem:** In the catch block at launch.ts:349, when the error is neither an abort nor a LaunchPreflightError, the code emits the error via env.emitError (line 367), sets INSTALLED status, records console state, then re-throws (line 373). The IPC router (router.ts:80) catches this re-thrown error, converts it with toIpcError, and logs it as an IPC handler failure at error level — but the renderer already received the error via the push event channel. The renderer will receive both the pushed error event AND an IPC rejection, potentially showing two toasts.
- **Why it matters:** Double error surfacing: one via the push channel (which builds the repair toast) and one via the IPC rejection (which the renderer also converts to a toast via useMutation.onError). Results in duplicate error toasts on non-preflight launch failures. Also the IPC-level logger emits an error-level log for an already-handled failure.
- **Proposed solution:** Do not re-throw from the generic launch failure catch path. The error has already been emitted via env.emitError and the status restored. Return instead of throw at line 373. If the caller (startLaunch in manager.ts) needs to distinguish, use the emitError channel. Remove the throw to eliminate the double-surface path.
- **Affects packages:** нет
- **Tests:** Integration test: trigger a non-preflight launch error, verify only one error event is emitted via broadcaster.error and the IPC channel resolves without rejection.

#### LAU-13 — verifyLaunchPreflight calls resolveLaunchVersion redundantly — compose already resolved it

- **Category:** Performance · **Priority:** P2 · **Risk:** Medium · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/launch.ts:109-146
- **Problem:** runLaunch calls env.kit.launch.compose() (launch.ts:252) which internally resolves the launch version from disk. Then verifyLaunchPreflight (launch.ts:109) calls resolveLaunchVersion(ctx.target) again at line 121 — a second redundant resolution to get the versionId for path checks. compose() already rejected with a kit error if the version JSON was missing, so the compose call already gates that file. The version-jar check at line 131 uses ctx.target.minecraft.version (the vanilla version) not the resolved versionId, which means for modloaders it checks the vanilla jar path even if a loader jar is the actual executable.
- **Why it matters:** Double disk I/O on the hot launch path. The version-jar check may verify the wrong file for Fabric/Forge installs (vanilla jar vs Forge-patched jar), producing false NOT_INSTALLED errors or silently passing when the patched jar is missing.
- **Proposed solution:** Pass the LaunchComposition from compose() into verifyLaunchPreflight. Remove the internal resolveLaunchVersion call — use composition.javaPath and composition.classpath. The version-jar check should use the first entry of composition.classpath (the main jar) or be dropped entirely since classpath is already fully verified by the classpath loop at line 143.
- **Affects packages:** нет
- **Tests:** Unit test verifyLaunchPreflight with a composition containing an empty classpath (should throw NOT_INSTALLED), and with all files present (should pass).

#### LAU-14 — consoleEnabled guard in op map is stale if the user changes console settings mid-run

- **Category:** Flow · **Priority:** P3 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/launch.ts:278-329, src/main/services/minecraft/ops.ts:39-43
- **Problem:** consoleEnabled is captured at the moment of launch (launch.ts:278) and stored in the LaunchOp (ops.ts:42). If the user later changes the console setting in preferences, the running LaunchOp still uses the snapshot value. Currently the setting only controls whether broadcaster.log() fires (which is the dead channel identified separately), so the practical impact is low — but the snapshot in the op is architecturally misleading.
- **Why it matters:** Once the dead broadcaster.log channel is removed, consoleEnabled becomes entirely unused and the field can be deleted from LaunchOp. Keeping it creates confusion about what it controls.
- **Proposed solution:** After removing broadcaster.log (per the dead-channel task), delete consoleEnabled from LaunchOp entirely. If per-launch console auto-open behavior is needed, gate openConsoleWindow on the setting at call time (the setting is read-only, not mutated mid-launch).
- **Affects packages:** нет
- **Tests:** нет

#### LAU-15 — guessLevel heuristic in consoleHub re-applies regex to every line of multi-line log4j events

- **Category:** Performance · **Priority:** P3 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/infra/consoleHub.ts:26-33, src/main/infra/consoleHub.ts:102-119
- **Problem:** For log4j events, ingestLog4jEvent (consoleHub.ts:102) correctly uses LEVEL_FROM_LOG4J to set forcedLevel. However, it calls ingest with forcedLevel, which skips guessLevel. For plain-text lines (chunk.kind === 'text'), ingest is called without forcedLevel, so guessLevel is applied with regex tests on every segment. guessLevel uses /\b(ERROR|SEVERE|FATAL)\b/.test() — allocates a regex match on each call. The regex is compiled inline in the function body rather than as a module-level constant.
- **Why it matters:** Three regex tests per text line on a hot path. For high-throughput mods (e.g. Forge with verbose debug logging), this adds up across thousands of lines per second.
- **Proposed solution:** Hoist all three regex patterns out of guessLevel into module-level constants (the ANSI pattern is already hoisted as ANSI_ESCAPE_PATTERN — apply the same pattern to the level-detection regexes).
- **Affects packages:** нет
- **Tests:** нет

#### LAU-16 — resolveAuthlibInjectorJar in launch.ts re-implements path logic that should come from yggdrasil-client

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/launch.ts:86-95
- **Problem:** resolveAuthlibInjectorJar() (launch.ts:86-95) constructs the path to the packaged authlib-injector jar manually using process.resourcesPath + 'authlib-injector' + 'authlib-injector-${AUTHLIB_INJECTOR_VERSION}.jar'. This re-implements path composition that should be the responsibility of the yggdrasil-client package — the same package that already exports resolveAuthlibInjectorJarPath() and AUTHLIB_INJECTOR_VERSION. The packaged path is a production concern that the launcher must own, but the filename template duplicates knowledge from the yggdrasil-client package.
- **Why it matters:** If the jar naming convention or version constant changes in yggdrasil-client, the launcher's packaged path construction silently becomes stale. The AUTHLIB_INJECTOR_VERSION import is used in the filename but the version is consumed from yggdrasil-client — the two must always agree.
- **Proposed solution:** Propose that yggdrasil-client export a getAuthlibInjectorJarName() function returning the filename (e.g. authlib-injector-${AUTHLIB_INJECTOR_VERSION}.jar). The launcher then constructs only the resource directory path and appends the canonical filename. This requires: edit yggdrasil-client src, build, copy dist into launcher node_modules (or republish + bump pinned version in package.json).
- **Affects packages:** loontail-yggdrasil: add getAuthlibInjectorJarName() export to yggdrasil-client; requires build + copy dist into launcher node_modules or republish
- **Tests:** нет

#### LAU-17 — verifyLaunchPreflight in launch.ts walks the entire classpath with sequential fs.access calls — O(N) serial I/O

- **Status:** DONE — 2026-05-31 · commit f7c223f
- **Category:** Performance · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/launch.ts (lines 138-145)
- **Problem:** The for...of loop at line 138 calls requireLaunchFile for each classpath entry sequentially. A Forge install can have 200+ classpath entries; sequential fs.access calls on a cold disk can add visible latency to the LAUNCHING phase.
- **Why it matters:** Noticeable launch delay on mechanical disks or network drives. Each awaited fs.access blocks the event loop until the kernel responds.
- **Proposed solution:** Parallelize with Promise.all(composition.classpath.map(f => requireLaunchFile(f, 'classpath file', ...)). Since the function throws on first error anyway, use a pattern that preserves early exit: Promise.any for first failure or Promise.all (all-or-nothing). Note that Promise.all on 200 paths may cause a spike of concurrent open() syscalls; consider batching at CONCURRENCY_LIMIT.
- **Affects packages:** нет
- **Tests:** Integration: time launch preflight on a Forge install with 200 classpath entries — parallel should be significantly faster.

#### LAU-18 — launch.ts verifyLaunchPreflight iterates all classpath entries sequentially with fs.access — O(n) blocking on large classpaths

- **Status:** DONE — 2026-05-31 · commit f7c223f
- **Category:** Performance · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/launch.ts (L136-145)
- **Problem:** `verifyLaunchPreflight` checks each classpath file with `await requireLaunchFile` in a sequential for-of loop (L143-145). A Forge install can have 50-150 classpath entries. Each `fs.access` call is sequential, adding 50-150 round-trips to the preflight before the game starts.
- **Why it matters:** Sequential fs.access across a large classpath adds visible latency to every launch (~50-500 ms on a cold disk depending on cache state), directly impacting player experience.
- **Proposed solution:** Run the classpath checks with `Promise.all` (or a concurrency limiter with limit=16 as used by system.ts walkDirectorySize). Use early-exit by wrapping in `Promise.race` with a sentinel that rejects on the first failure. Alternatively, verify only the first few entries and the last entry as sampling, since the kit already verified integrity during install.
- **Affects packages:** нет
- **Tests:** Unit: verifyLaunchPreflight fails fast on first missing classpath entry even when later entries exist.

#### LAU-19 — classifyError(error) called without signal in launch.ts endLaunch — aborted launches mis-classified

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/launch.ts line 153
- **Problem:** endLaunch (launch.ts line 153) calls classifyError(error) without passing a signal argument. classifyError's first check (errors.ts line 29) is signal?.aborted — if the game process is aborted by session.abort('user-stop'), the resulting error may carry AbortSignal's abort reason but classifyError will not detect it as ABORTED because no signal is passed. endLaunch has access to the session but not to an AbortSignal; however, the abort reason string is 'user-stop', which could be detected.
- **Why it matters:** A user-initiated game stop may log at error level (logger.error line 152) and emit a non-ABORTED code to the renderer, showing a false 'launch failed' toast when the user intentionally stopped the game. The router's RECOVERABLE_CODES includes ABORTED but not the mis-classified code, so it also logs at error level rather than warn.
- **Proposed solution:** In endLaunch, check whether the error message or cause matches the 'user-stop' abort reason before calling classifyError. If matched, treat as ABORTED: emit no error event, only emit INSTALLED status and record a clean exit in consoleHub. Alternatively, have kit's LaunchSession.exited reject with a structured LaunchAbortedError that endLaunch can instanceof-check before falling through to classifyError.
- **Affects packages:** нет
- **Tests:** Unit test endLaunch: when session.exited rejects with an error carrying reason 'user-stop', assert no emitError call is made and emitStatus is called with INSTALLED.

#### LAU-20 — consoleHub module-level singleton prevents testability and multiple window support

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/main/infra/consoleHub.ts
- **Problem:** consoleHub is exported as a pre-constructed singleton (line 230: `export const consoleHub = new ConsoleHub()`). The ConsoleHub class holds mutable state (buffer, flushTimer, activeSession, log4j parser) and is imported directly by launch.ts, consoleWindow setup, and routes. This makes unit-testing launch.ts impossible without full module mocking, and prevents a future architecture with multiple console windows (one per running client).
- **Why it matters:** Singleton services with mutable state that are imported rather than injected violate the guideline of 'no hidden side effects' and make modules hard to test in isolation. The guideline requires services to be injectable.
- **Proposed solution:** Export createConsoleHub() factory instead of the singleton. Construct one instance in the app entry point (index.ts) and inject it into MinecraftManager and launchWindow setup. The ConsoleHub class can remain private to the module.
- **Affects packages:** нет
- **Tests:** Unit tests for runLaunch can now inject a mock consoleHub without module-level mocking.

#### LAU-21 — verifyLaunchPreflight in launch.ts walks classpath files sequentially with await in a loop

- **Status:** DONE — 2026-05-31 · commit f7c223f
- **Category:** Performance · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/minecraft/launch.ts
- **Problem:** verifyLaunchPreflight (line 109) calls requireLaunchFile sequentially for javaPath (line 113), versionJson (line 127), versionJar (line 131), and then iterates composition.classpath (line 143) with a for-of loop and awaits each fs.access call in sequence. A Minecraft classpath can contain 40-100 library jars. The sequential stat/access checks for all classpath entries serialise through the event loop one at a time.
- **Why it matters:** For a cold launch on spinning disk, 80 sequential fs.access calls add latency before the game process spawns. On SSD the impact is lower but still unnecessary given the checks are fully independent.
- **Proposed solution:** Replace the sequential classpath loop with Promise.all() over the requireLaunchFile calls. Keep the three header checks sequential (they fail fast and establish preconditions for the classpath check), but fan out the classpath entries.
- **Affects packages:** нет
- **Tests:** Unit test for verifyLaunchPreflight with a 50-entry mock classpath: assert all access calls are issued concurrently (via spy counting simultaneous in-flight calls).

#### LAU-22 — isAnythingInstalled in runtimeState.ts does sequential fs.access in a loop — can short-circuit but not parallelise the 'any' check optimally

- **Category:** Performance · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/minecraft/runtimeState.ts
- **Problem:** isAnythingInstalled (line 9) reads the versions directory with readdir, then for each subdirectory entry it calls fs.access sequentially in a for-of loop (line 20). It returns true on the first match, which is efficient for the common case (installed, first dir matches), but in the not-installed or foreign-install case it walks every entry sequentially before returning false. For a client folder with many version subdirectories (e.g. from Forge/Fabric installs), this is fully sequential.
- **Why it matters:** The function is called in resolveClientInstallPresence (readinessPolicy.ts) at every getStatus() call when no op is in flight, meaning it runs on every launcher-open status poll. Sequential access to N version directories multiplies latency.
- **Proposed solution:** Use Promise.race() with Promise.all() to check all version-dir entries concurrently: map each entry to a fs.access promise and use Promise.any() to short-circuit on the first success, or await all rejections to return false.
- **Affects packages:** нет
- **Tests:** Unit test: directory with 10 entries where entry 5 matches — assert result is true and that earlier entries are not awaited before the race resolves.

#### LAU-23 — Context.resolved type is ReturnType<typeof resolveClientSettings> — exposes entire resolved settings instead of only needed fields

- **Category:** Architecture · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/services/minecraft/context.ts
- **Problem:** The Context type (line 17) includes `resolved: ReturnType<typeof resolveClientSettings>`. This exposes the full resolved settings object to every consumer of Context (install, launch, repair, repairWorkflow). Consumers use ctx.resolved.storage.clientFolder (could use ctx.clientFolder), ctx.resolved.memory.allocatedRamMb, ctx.resolved.launch.fullscreen, ctx.resolved.launch.console, and ctx.resolved.storage.clientsFolder. The full settings object is a wide interface; narrowing it to what Context actually needs reduces coupling.
- **Why it matters:** Exposing the full resolved settings through Context couples every downstream consumer to the settings domain model. Adding a new settings field may require auditing all Context consumers. The guideline discourages god-file patterns and prefers minimal surface area.
- **Proposed solution:** Replace `resolved: ReturnType<typeof resolveClientSettings>` in Context with a narrow inline type containing only the fields actually needed: `storage: { clientFolder: string; clientsFolder: string }; memory: { allocatedRamMb: number }; launch: { fullscreen: boolean; console: boolean }`. Populate it explicitly in buildContext.
- **Affects packages:** нет
- **Tests:** TypeScript compiler enforces the narrowing — no runtime tests needed.

#### LAU-24 — verifyLaunchPreflight issues N sequential fs.access calls; not abstracted for injection

- **Status:** DONE — 2026-05-31 · commit f7c223f
- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/launch.ts:109-146
- **Problem:** verifyLaunchPreflight() (lines 109-146) makes multiple sequential fs.access and resolveLaunchVersion calls directly, with no injection point. The function is tested in launch.test.ts via real tmp dirs (createLaunchFixture), which is correct for integration coverage. However, edge cases (empty classpath, resolveLaunchVersion rejection) require specific filesystem state that is awkward to arrange.
- **Why it matters:** The empty-classpath branch (line 137) is not tested in launch.test.ts. It's the only meaningful branch without a dedicated test. Because the function is not injectable, adding a test for it requires constructing a fixture with an empty classpath array inside a real composition object.
- **Proposed solution:** Add a test case for the empty-classpath branch: use createLaunchFixture but pass a composition with classpath: []. Alternatively, extract verifyLaunchPreflight as an exported function (currently private) and test it directly with a mock fs.access.
- **Affects packages:** нет
- **Tests:** Add test: compose returns composition with empty classpath → runLaunch emits NOT_INSTALLED error, stays INSTALLED.

#### LAU-25 — No test covers the cancel(slug) code path for BUNDLE_SYNCING and LAUNCH_STARTING OpKinds

- **Category:** Testing · **Priority:** P2 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/manager.ts:171-185
- **Problem:** MinecraftManager.cancel() handles four Op kinds (lines 173-184). Tests in managerStatus.test.ts and managerLaunch.test.ts cover the LAUNCH and INSTALL cancellation paths, but BUNDLE_SYNCING and LAUNCH_STARTING abort-controller signalling are not explicitly tested.
- **Why it matters:** The LAUNCH_STARTING abort is the cancellation path for the window between runLaunch composing and actually spawning the process. If the abort is not forwarded correctly, cancel() during startup has no effect, leaving the client frozen in LAUNCHING indefinitely.
- **Proposed solution:** Add unit tests for cancel() with a BUNDLE_SYNCING op (verify op.abort.abort() is called) and a LAUNCH_STARTING op (verify same). These tests can use the existing manager setup pattern from managerStatus.test.ts.
- **Affects packages:** нет
- **Tests:** Two unit tests in managerLaunch.test.ts or a new managerCancel.test.ts.

#### LAU-26 — sanitizeHttpAgentToken in launch.ts not directly tested — regex coverage only through integration test

- **Category:** Testing · **Priority:** P3 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/launch.ts:78-81
- **Problem:** sanitizeHttpAgentToken replaces non-alphanumeric characters and falls back to 'dev' for empty results. It's only exercised indirectly through the 'adds a launcher HTTP agent before authlib-injector' test in launch.test.ts with version '0.0.0-test'. Special character versions (e.g. a version string of only forbidden characters yielding 'dev') are untested.
- **Why it matters:** If the fallback path is broken, an empty or malformed HTTP agent string is passed as a JVM arg, which could cause the JVM to reject the arg or silently corrupt the agent header.
- **Proposed solution:** Export sanitizeHttpAgentToken (or test it via a named export), add two unit tests: a normal version string → expected output; a string of only disallowed characters → 'dev'.
- **Affects packages:** нет
- **Tests:** Unit tests for sanitizeHttpAgentToken.

#### LAU-27 — Replace `sanitizeHttpAgentToken` + hardcoded user-agent construction in launch.ts with a shared constant

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/launch.ts
- **Problem:** Lines 78-84 define `sanitizeHttpAgentToken` and `buildYggdrasilHttpAgentJvmArg`. The regex `/[^0-9A-Za-z.+_-]/g` is a magic literal. `YGGDRASIL_HTTP_AGENT_NAME = 'LoontailLauncher'` (line 47) is a hardcoded product name string that should be derived from a shared brand constant to avoid drift.
- **Why it matters:** If the launcher product name changes, it must be updated in this file manually. The sanitizer regex has no name explaining which spec it implements (RFC 7231 token syntax minus whitespace).
- **Proposed solution:** Extract `YGGDRASIL_HTTP_AGENT_NAME` to `src/shared/constants/brand.ts` (or alongside `APP_NAME`). Add a single-line comment on the regex citing RFC 7231 §3.3.1 token char class. Keep the function but remove the magic literal.
- **Affects packages:** нет
- **Tests:** Unit: `sanitizeHttpAgentToken` with spaces, unicode, empty string, already-valid string.

#### LAU-28 — Guard `verifyLaunchPreflight` classpath loop against empty-string entries

- **Status:** DONE — 2026-05-31 · commit f7c223f
- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/launch.ts
- **Problem:** Lines 137-145 iterate `composition.classpath` and call `requireLaunchFile` for every entry. If kit ever returns an empty string in the classpath (e.g. from a malformed version JSON), `fs.access('')` resolves to the CWD and returns success, silently masking a broken classpath entry.
- **Why it matters:** A malformed version JSON with an empty classpath entry would pass the preflight, and the game process would fail at JVM startup with a confusing error rather than a clear `NOT_INSTALLED` preflight failure.
- **Proposed solution:** Add a guard at the start of the loop: `if (!classpathFile) throw new LaunchPreflightError(MinecraftErrorCodes.NOT_INSTALLED, 'Classpath contains an empty entry')`. Also add a test that passes an empty-string entry and verifies the error code.
- **Affects packages:** нет
- **Tests:** Unit: mock `kit.launch.compose` to return a composition with `classpath: ['', '/valid/path']`; assert `LaunchPreflightError` with code `NOT_INSTALLED`.

#### LAU-29 — Fix `runLaunch` op-map leak when `startupSignal.aborted` fires after `env.ops.set(slug, startupOp)` but before the finally block checks

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/launch.ts
- **Problem:** The `finally` block (line 374) guards `if (env.ops.get(slug) === startupOp) env.ops.delete(slug)`. The race is: if `startupSignal` is aborted, the early-return path at lines 262-265, 269-271, or 276-278 calls `restoreInstalled()` and returns. The `finally` block then runs and deletes the op. However, between the last abort check (line 276) and `env.kit.launch.run(composition, ...)` (line 288), there is a synchronous code path that calls `env.ops.set(slug, { kind: OpKinds.LAUNCH, ... })` (line 329). If the signal fires during the `env.kit.launch.run` setup (e.g. the run call itself is synchronous before yielding), the LAUNCH op is set and the finally block deletes the `startupOp` — but the LAUNCH op (a different reference) is left in the map.
- **Why it matters:** A LAUNCH op entry left in the map after the session exits means `requireIdle` refuses any subsequent install/repair for that client until the launcher restarts.
- **Proposed solution:** After `env.ops.set(slug, { kind: OpKinds.LAUNCH, session, consoleEnabled })` (line 329), add a check: `if (startupSignal.aborted) { session.abort('user-stop'); env.ops.delete(slug); restoreInstalled(); return; }`. This is the same pattern already used in the three earlier abort checkpoints.
- **Affects packages:** нет
- **Tests:** Unit: inject a mock `kit.launch.run` that aborts the signal during setup; assert `env.ops` is empty after `runLaunch` returns.

#### LAU-30 — Remove 'Called once at boot…' caller-reference comment above `attachLaunchHook` in MinecraftManager

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** Lines 85-87: `// Called once at boot (after createBundleService) so launches dovetail through the bundle sync. Replacing a non-null hook is allowed and only happens in tests; in production it's set exactly once.` — the 'Called once at boot (after createBundleService)' clause is a caller-reference ('used by X'). The test-override note is also process documentation rather than a why.
- **Why it matters:** §10 explicitly forbids 'used by X flow' comments. Call-order notes belong in bootstrap comments, not on the method being called.
- **Proposed solution:** Replace with a single sentence explaining the invariant only: `// Set at most once in production; multiple sets are allowed only in tests.` Or delete entirely if the `LaunchHook` type and `attachLaunchHook` name are sufficient.
- **Affects packages:** нет
- **Tests:** нет

#### LAU-31 — Remove caller-reference comment on `syncForLaunch` in BundleManager

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/bundle/manager.ts
- **Problem:** Lines 92-95: `// Called by MinecraftManager.startLaunch after the install step. Awaits the sync to terminal status (completed/up-to-date) before letting launch proceed. No-op when the client has no bundleSlug. Errors propagate so the caller can abort launch.` — 'Called by MinecraftManager.startLaunch' is the forbidden caller-reference pattern. The no-op and error-propagation clauses are genuine non-obvious behaviors worth documenting.
- **Why it matters:** §10: the caller reference rots as soon as the call site moves.
- **Proposed solution:** Replace with: `// Awaits the sync to a terminal status before launch; resolves immediately when the client has no bundle. Errors propagate — the caller aborts launch on failure.`
- **Affects packages:** нет
- **Tests:** нет

#### LAU-32 — Trim comment on `toComposeFailure` in launch.ts — opening clause restates the function

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/launch.ts
- **Problem:** Lines 61-68: the comment block above `toComposeFailure` is 7 lines. The first sentence ('kit.launch.compose assembles the launch purely from on-disk files … it does not hit the network') is context that explains why a MinecraftKitError here means incomplete install rather than a transient failure — this is a genuine non-obvious why. However the function name `toComposeFailure` and its body already show the reclassification. The 'instead of surfacing a raw, non-repairable error' clause is the most valuable part.
- **Why it matters:** §10: the comment mixes valuable invariant explanation with what-narration ('Reclassify it as a repairable launch-preflight failure so the catch path keeps the client INSTALLED'). The repair-offer rationale is valuable; the narration of the code path is not.
- **Proposed solution:** Trim to 2-3 lines: `// compose reads only from disk — a MinecraftKitError here means incomplete install, not a network failure. Reclassify so the renderer offers Repair instead of a non-repairable error.` Remove 'Non-kit errors pass through to the generic launch-failure branch.' (visible from the code).
- **Affects packages:** нет
- **Tests:** нет

#### LAU-33 — Remove 'No pre-launch hash verification…' comment block in `startLaunch` in manager.ts

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/services/minecraft/manager.ts
- **Problem:** Lines 233-235: `// No pre-launch hash verification and no implicit reinstall here. The lenient launch preflight inside runLaunch decides launchability from the files actually on disk; if it fails, that path surfaces the error in the console and a repair offer rather than silently re-downloading.` This is a 3-line what-description of the launch preflight design. Lines 237-240: `// Chain the bundle sync before launch. The hook resolves immediately for clients without a bundleSlug, so this is free in the no-bundle path. Install a BundleSyncingOp so cancel(slug) can abort the download mid-flight — otherwise the launch flow keeps awaiting syncForLaunch long after the user clicked Stop.` — the last sentence about BundleSyncingOp is a genuine why (cancel-abort invariant). The first two sentences are what-narration.
- **Why it matters:** §10: what-narrations describing the design rather than a hidden invariant.
- **Proposed solution:** Delete lines 233-235. Trim lines 237-240 to just: `// BundleSyncingOp ensures cancel(slug) can abort the download mid-flight.`
- **Affects packages:** нет
- **Tests:** нет

### Profile / version flow (2)

#### PRF-01 — TargetInstallManifestSchema.targetId used for match but match also uses kitVersion — version bump invalidates all existing manifests silently

- **Category:** Flow · **Priority:** P2 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/installManifest.ts:138-149
- **Problem:** targetInstallManifestMatches (lines 138-149) checks manifest.kitVersion === MINECRAFT_KIT_VERSION. When the kit is bumped, every user's existing manifest fails to match, causing resolveClientInstallPresence to return INSTALLED→UNVERIFIED on the next open (because isAnythingInstalled still returns true but the manifest check fails). This is not documented as an intended behaviour, and there is no user-visible message explaining why the client suddenly shows as unverified.
- **Why it matters:** Silent state transitions from INSTALLED to UNVERIFIED (no manifest match) after a kit bump will cause the Play button to still appear, but the next launch will run verifyLaunchPreflight on a potentially incompatible install. Depending on what the kit bump changes, this may silently succeed or fail with a confusing error.
- **Proposed solution:** Document the intent (a comment explaining kitVersion invalidation is intentional to force a re-verify on kit changes). Alternatively, consider dropping kitVersion from the match criteria and only use it as informational metadata, relying on targetId + minecraft + loader + runtime for match. Add a test that pins the current match behaviour when kitVersion differs.
- **Affects packages:** нет
- **Tests:** Unit test: targetInstallManifestMatches returns false when only kitVersion differs. Document whether this is intentional (test description serves as living spec).

#### PRF-02 — No test for resolveClientInstallPresence returning UNVERIFIED (files present but no manifest)

- **Category:** Testing · **Priority:** P2 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/readinessPolicy.ts:20-29, tests/main/services/minecraft/readinessPolicy.test.ts
- **Problem:** resolveClientInstallPresence returns INSTALLED (manifest + files), NOT_INSTALLED (no files), or UNVERIFIED (files present but no manifest). The UNVERIFIED branch is the case for foreign or legacy installs. Looking at the existing readinessPolicy.test.ts — this specific three-way branch must be checked to ensure UNVERIFIED is returned when isAnythingInstalled=true and loadTargetInstallManifest=null.
- **Why it matters:** UNVERIFIED is the state that tells the UI 'we found an install folder but it was not created by us'. If this path regresses to INSTALLED, foreign installs will appear fully managed, leading to incorrect repair/uninstall behaviour.
- **Proposed solution:** Confirm the existing readinessPolicy.test.ts covers the UNVERIFIED branch (isAnythingInstalled=true, manifest=null → UNVERIFIED). If not, add that test case.
- **Affects packages:** нет
- **Tests:** Unit test: folder exists with version JSON but no .loontail/manifest.json → resolveClientInstallPresence returns UNVERIFIED.

### Error / recovery flow (7)

#### ERR-01 — NO_BUNDLE_SLUG error code is defined and mapped in errorCopy.ts but never actually thrown

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/shared/contracts/bundle.ts, src/renderer/features/bundle/errorCopy.ts, src/main/services/bundle/manager.ts
- **Problem:** BundleErrorCodes.NO_BUNDLE_SLUG is defined (shared/contracts/bundle.ts line 40), has a localization key in errorCopy.ts (line 5), but is never thrown anywhere in the service. The manager.ts runSync branch where client.bundleSlug is null emits BundleSyncStatuses.NO_BUNDLE and returns — not an error. The code that would logically use NO_BUNDLE_SLUG either does not exist or uses UNKNOWN.
- **Why it matters:** Dead code in the error code enum creates confusion about which codes are reachable. The localization file must maintain a translation for a code that is never surfaced, and the exhaustiveness check in errorCopy.ts forces the presence of the key even though it will never appear in a toast.
- **Proposed solution:** Either remove NO_BUNDLE_SLUG from BundleErrorCodes and errorCopy.ts (and update the KEY_BY_CODE Record), or throw BundleError(NO_BUNDLE_SLUG) in the branch where bundleSlug is null/undefined instead of the current NO_BUNDLE status path. The latter is architecturally cleaner for cases where a sync is explicitly started on a client without a bundle attached.
- **Affects packages:** нет
- **Tests:** Verify no production code path reaches the NO_BUNDLE_SLUG key; update errorCopy.ts tests accordingly.

#### ERR-02 — Deduplicate `errorMessage` helper defined in both bundle/errors.ts and minecraft/errors.ts

- **Status:** DONE — 2026-05-31 · commit dff71a3
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/errors.ts (L19-20), src/main/services/minecraft/errors.ts (L37-38)
- **Problem:** The one-liner `export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);` is duplicated word-for-word in two separate error modules. Eleven other files import it from one or the other.
- **Why it matters:** No semantic benefit from two copies; any change (e.g. adding cause-chain walking) must be applied twice. Callers that accidentally import from the wrong module get the same result but create confusing cross-service coupling.
- **Proposed solution:** Move `errorMessage` to `src/main/infra/errorMessage.ts` (or `src/shared/utils/errorMessage.ts` since it has no Node/DOM/Electron/React imports). Update all 11 callsites.
- **Affects packages:** нет
- **Tests:** No new tests needed (pure function already covered by callers); verify no import cycle introduced.

#### ERR-03 — Remove dead `emitErrorEvent` from ManagerEnv — it is never called

- **Status:** DONE — 2026-05-31 · commit 898a8f3
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/env.ts (L19), src/main/services/minecraft/manager.ts (L71)
- **Problem:** `ManagerEnv.emitErrorEvent` is declared in env.ts (L19) and wired in manager.ts constructor (L71), but grep across all service files shows it is never invoked from any module. `emitError(slug, code, message)` is used everywhere instead.
- **Why it matters:** Dead surface area: contributors reading ManagerEnv assume emitErrorEvent is meaningful and may use it in new code, creating two parallel error-emit paths. The dead wire in the constructor adds confusion with no benefit.
- **Proposed solution:** Remove `emitErrorEvent` from `ManagerEnv` (env.ts L19) and from the constructor assignment (manager.ts L71). Update the `Broadcaster` interface and any tests that reference it.
- **Affects packages:** нет
- **Tests:** TypeScript compile: removing the property surfaces any hidden usage the grep missed.

#### ERR-04 — Expand KIT_CODE_TO_LAUNCHER_CODE to cover all classifiable kit error codes

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/errors.ts lines 14-26
- **Problem:** KIT_CODE_TO_LAUNCHER_CODE maps only 10 out of the full MinecraftKitErrorCode set. Kit codes DISK_WRITE_FAILED, DISK_PERMISSION_DENIED, EXTRACT_FAILED, FORGE_PROCESSOR_FAILED, AUTH_MINECRAFT_FAILED, AUTH_REFRESH_FAILED, VERIFY_ABORTED, MANIFEST_PARSE_FAILED, and any future kit codes all fall through to MinecraftErrorCodes.KIT_ERROR — an opaque bucket that maps to the generic 'clients.error.kitError' i18n key in the renderer. Additionally, MANIFEST_NOT_FOUND is mapped to NETWORK_ERROR (line 18) even though a missing manifest is an integrity/corruption issue, not a transient network failure.
- **Why it matters:** KIT_ERROR as a fallback means disk-full, permission-denied, and forge-processor failures all show the same generic error toast. Users cannot distinguish a connectivity issue from a disk permission problem. The renderer should never have to inspect error.message to distinguish these, and the guideline explicitly requires UI to decide on code not message.
- **Proposed solution:** Add MinecraftErrorCodes.DISK_ERROR and MinecraftErrorCodes.FORGE_ERROR (or reuse INTEGRITY_ERROR/LAUNCH_FAILED as appropriate) to the MinecraftErrorCodes const in shared/contracts/minecraft.ts. Extend KIT_CODE_TO_LAUNCHER_CODE to map DISK_WRITE_FAILED → DISK_ERROR, DISK_PERMISSION_DENIED → DISK_ERROR, EXTRACT_FAILED → INTEGRITY_ERROR, FORGE_PROCESSOR_FAILED → FORGE_ERROR, AUTH_MINECRAFT_FAILED → LAUNCH_FAILED. Fix MANIFEST_NOT_FOUND to map to INTEGRITY_ERROR rather than NETWORK_ERROR. Add corresponding i18n keys and entries to errorCopy.ts KEY_BY_CODE (compiler will flag missing keys since the map uses Record<MinecraftErrorCode, string>).
- **Affects packages:** нет
- **Tests:** Unit tests for classifyError: table-driven tests for each new kit code mapping. Unit test KEY_BY_CODE completeness (TypeScript exhaustiveness via Record<MinecraftErrorCode,string> already enforces this at compile time after adding new codes).

#### ERR-05 — toIpcError maps all MinecraftKitErrors to IpcHandlerFailed — hides classified launcher codes

- **Category:** IPC · **Priority:** P1 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/ipc/toIpcError.ts lines 44-45, src/main/services/minecraft/errors.ts
- **Problem:** In toIpcError (line 44), any MinecraftKitError that escapes a handler is mapped to ERROR_CODES.IpcHandlerFailed regardless of its internal code. However, classifyError in minecraft/errors.ts already converts kit errors to domain MinecraftErrorCodes via KIT_CODE_TO_LAUNCHER_CODE. If a kit error escapes the service layer without being caught and reclassified into a ManagerError first (e.g. from buildContext or kit.targets.resolve), toIpcError collapses it to IpcHandlerFailed and the renderer shows a generic error with no actionable code.
- **Why it matters:** The IPC boundary eats all structured kit error information. If classifyError is not called before an error propagates out of a handler, the renderer sees IpcHandlerFailed and can only show a generic message. The router's RECOVERABLE_CODES set does not include IpcHandlerFailed, so all escaped kit errors log at error level even if they are recoverable (e.g. NETWORK_ABORTED).
- **Proposed solution:** Ensure classifyError is called at all handler exit points in minecraft routes (currently the routes in routes.ts delegate directly to manager methods; the manager's buildContext can throw ManagerError but if kit.targets.resolve throws a raw kit error it will propagate uncaught). Add a catch wrapper in routes.ts for minecraft.install/repair/launch that calls classifyError and rethrows a ManagerError so toIpcError sees a CodedError rather than a raw MinecraftKitError. Alternatively, wrap the kit.targets.resolve call inside buildContext in a try/catch and reclassify.
- **Affects packages:** нет
- **Tests:** Integration test: mock kit.targets.resolve to throw MinecraftKitError(NETWORK_TIMEOUT); assert that the IPC call rejects with code=networkError rather than IPC_HANDLER_FAILED.

#### ERR-06 — Fix LauncherSection handleClearCache: cache invalidation runs even when clearMediaCache fails, but QueryClient.removeQueries runs unconditionally before the IPC call succeeds

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/settings/components/sections/LauncherSection.tsx:48-61
- **Problem:** handleClearCache (lines 48-61) calls queryClient.removeQueries() first (line 49-53) then awaits clearMediaCache() inside a try/catch that swallows the error. The in-memory queries are invalidated regardless of whether the disk cache was cleared. The success toast fires unconditionally after both. But more critically: if clearMediaCache rejects, the user sees no feedback — the toast.success at line 60 still fires because it is after the try/catch block.
- **Why it matters:** The guideline says: do not demote a successful op on trailing bookkeeping failure — which this partially follows for the in-memory clear. But the toast.success fires unconditionally even when the IPC call failed, which is misleading. The user may believe the disk cache was cleared when it was not.
- **Proposed solution:** Move toast.success inside the try block (after await clearMediaCache()). Add a toast.warn or toast.error in the catch block: 'In-memory cache cleared; disk cache clear failed'. This correctly communicates partial success per the guideline.
- **Affects packages:** нет
- **Tests:** Unit: mock clearMediaCache to reject; assert toast.success not called; assert toast.warn called.

#### ERR-07 — MIGRATIONS object is empty while CURRENT_SCHEMA_VERSION = 1; any version-0 store file will crash module load

- **Status:** DONE — 2026-05-31 · commit 379096f
- **Category:** Error handling · **Priority:** P1 · **Risk:** High · _(auditor: testability)_
- **Area:** src/main/infra/store.ts:105, src/shared/constants/storeKeys.ts:8
- **Problem:** MIGRATIONS is defined as {} (empty record) at line 105 of store.ts while CURRENT_SCHEMA_VERSION is 1. If a user has a pre-existing store with schemaVersion=0 (any install before CURRENT_SCHEMA_VERSION was bumped to 1), runMigrations() at module load time calls applySettingsMigrations(settings, 0, 1, {}) which throws 'Missing schema migration step from version 0 to 1'. This crashes the Electron main process before any window opens. The existing test at line 365 of store.test.ts confirms this is a crash path.
- **Why it matters:** Any user who installed the launcher before the schema version was set to 1 will be permanently unable to open the launcher after updating — a silent data-integrity failure with no recovery path.
- **Proposed solution:** Either: (a) add a migration step 0→1 to MIGRATIONS (even if it's an identity function, documenting that version 0 settings are already compatible), or (b) keep CURRENT_SCHEMA_VERSION = 0 until a real migration is needed. Whichever is chosen, add a regression test that seeds schemaVersion=0 and verifies the module loads without throwing.
- **Affects packages:** нет
- **Tests:** Integration test: write storeFile with schemaVersion:0 and valid settings → loadStoreModule() resolves without throwing. Also pin that CURRENT_SCHEMA_VERSION matches the length of MIGRATIONS (or the highest key + 1).

### Renderer / UI flow (43)

#### UI-01 — `LoginForm.tsx` merges Yggdrasil and Mojang error state from two different hooks, creating ambiguous error display

- **Category:** UI · **Priority:** P2 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/renderer/features/auth/components/LoginForm.tsx:31
- **Problem:** Line 31: `const displayedError = errorCode ?? mojang.errorCode;` combines the error state from `useLogin` (Yggdrasil) and `useMojangLogin` (Microsoft) into a single display expression. If both have an error simultaneously (e.g. a network error from a previous Yggdrasil attempt followed by a browser-open failure), the Mojang error is silently dropped. Also, `clearError` (called before Mojang sign-in at line 107) only clears the Yggdrasil error — `mojang.errorCode` has no external `clearError` call in the Microsoft button handler.
- **Why it matters:** Stale error banners can persist from one flow while the user is attempting the other, confusing users about the cause of the error.
- **Proposed solution:** Clear Mojang error state when the Yggdrasil form is submitted (`onSubmit` should call `mojang.cancel()` to reset Mojang state). Clear the Yggdrasil error when the Microsoft button is clicked (the existing `clearError()` call is correct but `mojang.cancel()` should also reset `mojang.errorCode`). Add a `clearError` method to `useMojangLogin`'s return value.
- **Affects packages:** нет
- **Tests:** UI integration test: trigger a Yggdrasil network error, then click Microsoft sign-in; assert the Yggdrasil error banner disappears.

#### UI-02 — The `useCurrentUser` hook exposes `isPending` but not `isError`, so the renderer cannot distinguish 'loading' from 'auth server unreachable'

- **Category:** UI · **Priority:** P3 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/renderer/features/auth/hooks.ts:34-41
- **Problem:** Lines 34-41: `useCurrentUser` returns `{ user, isPending }`. If `fetchCurrentUser` (the `authMe` IPC call) throws (e.g. the main process is not initialised, or an IPC error occurs), TanStack Query's `query.data` is `undefined` and `query.isPending` is `false`, but `query.isError` is `true`. The caller cannot distinguish 'network check in flight' from 'network check failed — using cached data' from 'not signed in'.
- **Why it matters:** If the auth IPC call fails on startup, the launcher silently shows the login screen instead of an error state, with no feedback that the check failed vs. that the user is genuinely logged out.
- **Proposed solution:** Expose `isError: query.isError` and `error: query.error` from `useCurrentUser`. Update consumers to differentiate the error state from the null-user state.
- **Affects packages:** нет
- **Tests:** нет

#### UI-03 — isBundleBusy duplicated between store.ts and installSteps.ts — divergence risk

- **Status:** DONE — 2026-05-31 · commit 39a7d91
- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/renderer/features/bundle/store.ts, src/renderer/features/clients/components/install/installSteps.ts
- **Problem:** isBundleBusy is exported from store.ts (line 71) and re-defined privately in installSteps.ts (line 85) with identical logic. Both include PAUSED in the 'busy' set. If the set of busy statuses changes (e.g. a new VERIFYING status is added), only one copy gets updated.
- **Why it matters:** The private copy in installSteps.ts will silently diverge from the exported copy. Because it controls whether the progress card renders, a divergence means the UI either shows a stale card or hides a live one.
- **Proposed solution:** Delete the private isBundleBusy from installSteps.ts (line 85) and import it from @renderer/features/bundle/store (already exported via index.ts). The function signature is identical.
- **Affects packages:** нет
- **Tests:** No new tests required; existing snapshot/integration tests for selectInstallProgress exercise both paths.

#### UI-04 — Status-seed concurrency queue is module-level mutable state — leaks across test runs

- **Category:** тестирование · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/renderer/features/bundle/hooks.ts
- **Problem:** activeStatusSeedCount (line 11), statusSeedQueue (line 12), and statusSeedRequests (line 13) are module-level variables. They persist for the entire lifetime of the module, which means test runs that import this module share state across tests unless they explicitly reset it. The _internals pattern used for bundle manager doesn't exist here, so there is no official reset path.
- **Why it matters:** A test that triggers seedStatus and leaves a pending promise will corrupt the queue for the next test. In Jest, module-level state also means leaked timers/promises can cause flaky 'Cannot log after tests are done' errors.
- **Proposed solution:** Encapsulate the seed state in a factory (createStatusSeeder) that returns { seedStatus, resetForTesting }. Expose resetForTesting only in test environments (or use a module-level reset via a test hook). Alternatively, convert to a singleton class so the state is instance-scoped and resettable.
- **Affects packages:** нет
- **Tests:** Unit tests for useBundleStatus: verify a second call for the same slug returns the cached promise; verify reset clears the queue; verify MAX_STATUS_SEED_CONCURRENCY is respected.

#### UI-05 — BundleEventsListener reads store state inside useEffect with stale getState — pattern bypasses React's subscription guarantees

- **Category:** Architecture · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/renderer/features/bundle/events.ts
- **Problem:** BundleEventsListener (events.ts line 10-46) calls useBundleStore.getState().patch inside the useEffect (line 12). This bypasses Zustand's React subscription — if the store is replaced (e.g. by a hot-reload or test reset), the captured patch and reset references still point to the old store instance. More importantly, calling useBundleStore.getState() inside useEffect (rather than using subscribe) is the correct Zustand pattern for imperative event-driven updates, so this is acceptable — but the useEffect has an empty dependency array (line 44) meaning it never re-subscribes if the store instance changes.
- **Why it matters:** In normal operation this is fine. Under fast-refresh during development, if the store module is re-evaluated, the listener still holds a stale patch reference. More practically, IPC events that fire before the first render (rare but possible on very fast networks) may lose events because the listener is not yet registered.
- **Proposed solution:** Use window.api.on registrations outside the component lifecycle (module-level singletons) or ensure the IPC bridge registers its listeners in the Electron main process before any window is shown. Document the startup ordering assumption. Alternatively, buffer events in a module-level queue and flush when the React listener mounts.
- **Affects packages:** нет
- **Tests:** Integration: IPC event fired before BundleEventsListener mounts; assert store reflects the event after mount.

#### UI-06 — progressFormat.ts formatBytes uses Math.log(0) path — formatBytes(0) works by guard but formatBytes for very small numbers (<1) logs negative

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/renderer/features/clients/components/install/progressFormat.ts
- **Problem:** formatBytes (line 3-8) guards bytes <= 0 and returns '0 B'. However, for 0 < bytes < 1 (e.g. fractional bytes from a calculation), Math.log(bytes)/Math.log(1024) is negative, Math.floor gives a negative unit index, Math.min clamps it to 0 (the SIZE_UNITS[0] 'B' case) only because 0 is the lower bound of the min. The unit calculation gives `Math.min(negative, 4)` which is the negative number, and `SIZE_UNITS[negative]` is undefined — the result is `NaN B`.
- **Why it matters:** Fractional bytes can reach formatBytes from the installStageBytes calculation (installSteps.ts line 154): done = (clamp(stagePercent)/100) * stageTotal. If stageTotal is 1 and stagePercent is 0.5, done = 0.005 — a sub-integer value. NaN displayed as a byte count breaks the progress readout.
- **Proposed solution:** Add a guard: if bytes < 1 return '< 1 B' or return '0 B'. Alternatively use Math.floor(bytes) before the unit calculation. Add a test for formatBytes(0.5).
- **Affects packages:** нет
- **Tests:** Unit: formatBytes(0), formatBytes(0.5), formatBytes(1023), formatBytes(1024), formatBytes(1_073_741_824).

#### UI-07 — STEP_NUMBER in progressLabels.ts hardcodes step ordinals — diverges when steps array order changes or steps are conditionally excluded

- **Category:** Architecture · **Priority:** P2 · **Risk:** Low · _(auditor: download-install-flow)_
- **Area:** src/renderer/features/clients/components/install/progressLabels.ts, src/renderer/features/clients/components/install/InstallStepper.tsx
- **Problem:** STEP_NUMBER (progressLabels.ts lines 11-16) statically maps RUNTIME→1, MINECRAFT→2, LOADER→3, BUNDLE→4. InstallStepper.tsx uses STEP_NUMBER[step.key] (line 11) for the badge numeral. But buildSteps (installSteps.ts line 137-142) can omit LOADER and BUNDLE, so a client without a loader would have steps [RUNTIME, MINECRAFT, BUNDLE] numbered as [1, 2, 4] — skipping 3.
- **Why it matters:** The stepper badge shows '4' for the bundle step when there is no loader, even though it is the third visible step. This is confusing to users and technically wrong.
- **Proposed solution:** Replace STEP_NUMBER with a runtime index derived from the steps array position: pass the index from InstallStepper's map callback directly to StepBadge instead of looking up a static map. This makes the numeral always reflect the actual position in the rendered list.
- **Affects packages:** нет
- **Tests:** Snapshot/unit: no-loader client produces badges numbered 1, 2, 3; with-loader client produces 1, 2, 3, 4.

#### UI-08 — Magic hex literal #212121 in consoleWindow.ts duplicates mainWindow.ts — should use a shared design token

- **Category:** UI · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/windows/consoleWindow.ts:11, src/main/windows/mainWindow.ts:11
- **Problem:** Both window files define const BACKGROUND_COLOR = '#212121'. This is a raw hex literal that bypasses the Tailwind palette token system mandated by the UI guideline. The value must be kept in sync manually. The guideline explicitly prohibits hex/rgb/hsl literals in favor of palette tokens.
- **Why it matters:** A design token change requires editing two files. The value may diverge, producing visually inconsistent window backgrounds on load before the renderer paints. Violates UI guideline on hex literals.
- **Proposed solution:** Extract the shared value to a window-creation helper or a shared constant in src/main/windows/windowColors.ts (or similar). Alternatively, derive the value from the Tailwind CSS config token at build time. At minimum, define it once and import it in both window files.
- **Affects packages:** нет
- **Tests:** нет

#### UI-09 — BUFFER_LIMIT = 10000 is magic-numbered independently in consoleHub.ts and App.tsx

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/infra/consoleHub.ts:17, src/renderer/console/App.tsx:15
- **Problem:** Both files define BUFFER_LIMIT = 10000 as a local constant. They must be kept in sync manually. If main holds more lines than the renderer trims to (or vice versa), the renderer can request missing IDs that were already evicted, causing spurious seenIdsRef misses or redundant getInitial reconcile work.
- **Why it matters:** Skew between main-side and renderer-side limits would cause silent data loss: the renderer requests lines main has already evicted, or keeps lines the user never sees. A shared constant guarantees both sides always agree.
- **Proposed solution:** Extract CONSOLE_BUFFER_LIMIT to src/shared/constants/console.ts (or the existing QUERY_KEYS/constants file in shared). Both consoleHub.ts and App.tsx import from there.
- **Affects packages:** нет
- **Tests:** нет

#### UI-10 — useConsoleStream reconcile poll calls getInitial every second regardless of process state

- **Category:** Performance · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/renderer/console/hooks/useConsoleStream.ts:162-190
- **Problem:** The reconciliation interval (RECONCILE_INTERVAL_MS = 1000 ms) runs unconditionally for the lifetime of the console window, including when the process is IDLE, EXITED, or CRASHED — states where no new lines can arrive. The poll invokes getInitial over IPC every second, deserializes all metadata, and filters by seenIds even when there is nothing new.
- **Why it matters:** Continuous IPC round-trips when the console is idle (e.g. open between play sessions). Minimal but persistent CPU/IPC overhead for a background window that is open but not showing active output.
- **Proposed solution:** Pause the reconcile interval when state.status is one of IDLE, EXITED, or CRASHED. Resume it when status transitions back to LAUNCHING or RUNNING. Track this via a ref or a derived boolean from the stream state. Alternatively, extend the interval to 5 s for terminal states where drift-recovery latency matters less.
- **Affects packages:** нет
- **Tests:** Unit test: verify setInterval is cleared when status becomes EXITED and restarted when status transitions to LAUNCHING.

#### UI-11 — Highlight component in format.tsx re-runs full character-scan on every keystroke without memoization

- **Category:** Performance · **Priority:** P3 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/renderer/console/format.tsx:44-71, src/renderer/console/ConsoleLogBody.tsx:63-71
- **Problem:** The Highlight component performs a linear scan over every character of every visible line on every render. With 10 000 lines, OVERSCAN=16, and a visible window of ~30 rows, Highlight is called ~60 times per render. The component is not memoized (no React.memo). Every search keypress forces a full re-render of ConsoleLogBody (new searchQuery propagates), which calls Highlight on all visible rows.
- **Why it matters:** With long log lines (stack traces, JSON payloads), the character scan can be perceptible during rapid typing in the search box on low-end hardware.
- **Proposed solution:** Wrap Highlight in React.memo with a custom comparator on {message, query, active}. Since message and query are both strings and active is boolean, shallow equality is sufficient. Alternatively, memoize the highlighted result in useConsoleSearch using useMemo keyed on [searchQuery, line.id] for visible lines.
- **Affects packages:** нет
- **Tests:** нет

#### UI-12 — statusSeedQueue and statusSeedRequests are module-level mutable state in hooks.ts

- **Category:** Architecture · **Priority:** P3 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/renderer/features/minecraft/hooks.ts:13-46
- **Problem:** statusSeedQueue (line 14), statusSeedRequests (line 15), and activeStatusSeedCount (line 13) are module-level mutable variables in hooks.ts. They survive React unmount/remount cycles, test runs, and HMR reloads. If the component tree re-mounts (e.g. React strict mode double-mount), a seed request can be in the map while the component has already remounted, causing the stale check on line 59 to skip re-seeding.
- **Why it matters:** State leaks between test cases and between Strict Mode render cycles. The deduplication logic (statusSeedRequests map) can permanently block a re-seed if the first request resolves stale. Violates guideline against hidden side effects.
- **Proposed solution:** Move the seed queue state into a React context or a Zustand store slice so it is scoped to the React tree lifetime. Alternatively, accept the module-level cache but add a resetStatusSeedCache() export for tests and ensure the stale-check guard (useMinecraftStore.getState().entries[slug]) is sufficient to prevent clobbering live events (it is, but the documentation comment should say so).
- **Affects packages:** нет
- **Tests:** Unit test: mount two instances of useClientStatus for the same slug — verify only one IPC call is made, and after unmount/remount, a new seed is attempted.

#### UI-13 — ConsoleBuffer.trimOverflow only trims main lines array but pending may still reference trimmed lines

- **Category:** Error handling · **Priority:** P3 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/infra/consoleBuffer.ts:65-70
- **Problem:** trimOverflow (consoleBuffer.ts:65) removes overflow entries from this.lines but never touches this.pending. Lines that are appended then immediately overflowed remain in this.pending until consumePending(). consumePending() returns them and the renderer receives lines whose IDs have been evicted from the main buffer. The renderer's seenIdsRef correctly deduplicates, so no duplicate is shown, but the IDs in pending are no longer in the buffer if the window reconnects and calls getInitial.
- **Why it matters:** After a burst that causes overflow, consumePending() delivers IDs not present in getInitial's snapshot. The renderer's 1-second reconcile loop will not re-add them (they are in seenIds), but the initial reseed on window open will not include them. Effectively: lines arrive in the live channel but are missing from the backlog. Low-impact but confusing for crash investigations.
- **Proposed solution:** In trimOverflow, also trim this.pending to remove any entries whose id was dropped from this.lines. Since pending is a subset of recently-appended lines, trimming from the head of pending by the same count as the lines trim is sufficient. Alternatively, derive pending items as those with id > (lowest retained id).
- **Affects packages:** нет
- **Tests:** Unit test: append lines past the limit in one batch, verify consumePending returns only lines still present in getLines().

#### UI-14 — skin.ts uploadSkinMojang uses 'AUTO' cast to `const` — opaque workaround without comment

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/skin/skin.ts (L144)
- **Problem:** `const variant = 'AUTO' as const;` (L144) is used so TypeScript infers the literal type rather than `string`, allowing it to match the kit's `uploadSkin` variant parameter. The `as const` pattern here is a workaround for the kit's parameter typing, not a meaningful business choice.
- **Why it matters:** Per the comments guideline (§10): this is a wire-coercion invariant that deserves a `// why` comment explaining the kit requires a literal string type for the variant parameter, and that 'AUTO' means the kit will detect the variant (slim vs. classic) from the PNG itself.
- **Proposed solution:** Add a single-line `// kit requires literal type; 'AUTO' = detect variant from PNG dimensions` comment on or before L144.
- **Affects packages:** нет
- **Tests:** нет

#### UI-15 — consoleHub.ts: `ingest` uses multiple conditional spread expressions — extract to named object builder

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/infra/consoleHub.ts (L184-192)
- **Problem:** The `ingest` method (L184-192) builds `ConsoleLineInput` objects using four conditional spreads: `...(slug ? { slug } : {})`, `...(code ? (lineArgs ? { code, args: lineArgs } : { code }) : {})`. The nested ternary inside the `code` spread is a minor violation of the 'no nested ternaries' guideline.
- **Why it matters:** Nested ternary in an object literal is hard to read. A reviewer must mentally evaluate three conditions to understand what fields are present on each line object.
- **Proposed solution:** Extract a `buildLineInput(source, level, segment, slug?, code?, lineArgs?)` helper that assembles the object with explicit if-statements. The ingest method calls it per segment.
- **Affects packages:** нет
- **Tests:** Unit: buildLineInput with all optional fields present/absent produces the correct shape.

#### UI-16 — SkinError uses shared ERROR_CODES while bundle/minecraft errors use domain-local codes — inconsistent placement

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/main/services/skin/errors.ts, src/shared/constants/errorCodes.ts, src/shared/contracts/skin.ts
- **Problem:** BundleError codes live in src/shared/contracts/bundle.ts (BundleErrorCodes), MinecraftErrorCodes live in src/shared/contracts/minecraft.ts, but SkinError codes (SkinUploadFailed, SkinNotAuthenticated) are placed in src/shared/constants/errorCodes.ts alongside IPC infrastructure codes (IpcInvalidArgs, IpcUntrustedSender). This means the renderer has no code-keyed localization map for skin errors — skin error messages are surfaced by message text rather than by code (the mutation in useSkinEditor never inspects error.code).
- **Why it matters:** Violates the guideline that UI decides on code, not message. Skin errors currently surface whatever English string happens to be in error.message from the caught IpcError, and there is no type-safe i18n key map. If Mojang's errorMessage parsing in skin.ts changes or fails, the toast shows a raw string.
- **Proposed solution:** Move SkinUploadFailed and SkinNotAuthenticated out of errorCodes.ts and into a SkinErrorCodes const in src/shared/contracts/skin.ts (mirroring BundleErrorCodes/MinecraftErrorCodes). Update SkinError to use SkinErrorCode. Create src/renderer/features/skin/errorCopy.ts with a KEY_BY_CODE: Record<SkinErrorCode, string> map. Update the skin upload mutation's onError to localize by code. Remove the now-empty constants from errorCodes.ts.
- **Affects packages:** нет
- **Tests:** Unit test localizeSkinError: for each SkinErrorCode, assert a non-empty i18n key is returned. Unit test SkinError constructor: assert code is typed as SkinErrorCode.

#### UI-17 — ErrorBoundary logs raw component stack via console.error — stack traces reach renderer console

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/renderer/app/ErrorBoundary.tsx line 21
- **Problem:** ErrorBoundary.componentDidCatch (line 21) calls console.error('[renderer] uncaught error', error, info.componentStack). The biome-ignore comment acknowledges this as a last-resort logger. However, info.componentStack is a raw React component stack trace that can be many hundreds of characters long and exposes internal component names. In production this goes to electron-log via the console re-routing in initLogger, which persists it to disk.
- **Why it matters:** Component stack traces in the production log file bloat the log and expose internal React component tree structure. The guideline requires error=user op failed unrecovered, not framework-level diagnostics. A structured log entry (error type + message only) at logger.error level would be more appropriate.
- **Proposed solution:** Create a scopedLogger('renderer') in a shared renderer logger module and call it via an IPC channel (e.g. a fire-and-forget 'app.logRendererError' channel) so ErrorBoundary can forward the error to the main-process log at the correct level. Until an IPC log channel exists, limit the console.error to error.message and omit componentStack in production (check !app.isPackaged equivalent in renderer via window.__LOONTAIL_DEV__ or a preload-exposed flag).
- **Affects packages:** нет
- **Tests:** нет

#### UI-18 — Replace rgba(255,255,255,0.10) inline style in ClientOverview settings button with a CSS variable

- **Category:** UI · **Priority:** P1 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/clients/components/ClientOverview.tsx:134-137
- **Problem:** The settings gear button uses style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 6px 18px -8px var(--color-glow-overlay-md)' }}. The raw rgba literal is a guideline violation (no hex/rgb/hsl in class values or inline styles — only palette tokens). The CSS var half is already correct.
- **Why it matters:** Raw colour literals break the single-source-of-truth for theme tokens. If the glass colour scale changes, this value will drift.
- **Proposed solution:** Replace rgba(255,255,255,0.10) with the appropriate glass token, e.g. color-mix(in srgb, var(--color-glass) 10%, transparent) or define a --shadow-inset-highlight CSS variable in the global token sheet and reference it here. Remove the inline style and use a Tailwind shadow- utility if one can be defined in tailwind config for this exact shadow.
- **Affects packages:** нет
- **Tests:** нет

#### UI-19 — Replace rounded-xl and rounded-2xl usages with guideline-compliant radius tokens

- **Category:** UI · **Priority:** P1 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/shared/ui/Toast/ToastItem.tsx:141, src/renderer/features/clients/components/ServersInfo.tsx:22,42,62, src/renderer/features/clients/components/install/InstallProgress.tsx:29
- **Problem:** The UI guideline mandates radius tokens sm/md/lg only. ToastItem uses rounded-xl (line 141), InstallProgress uses rounded-2xl (line 29), and ServersInfo uses rounded-xl in three separate divs (lines 22, 42, 62). These are arbitrary Tailwind radius utilities outside the permitted token set.
- **Why it matters:** Radius consistency is a visual-identity invariant. Non-token radii will diverge from any future design-system radius update and create an inconsistent look across card surfaces.
- **Proposed solution:** Map rounded-xl → rounded-lg and rounded-2xl → rounded-lg (or whichever radius token is correct per design). If the design genuinely requires a larger radius than lg, add an xl token to the Tailwind theme config so it remains a named token, not a raw utility.
- **Affects packages:** нет
- **Tests:** нет

#### UI-20 — Replace magic pixel font sizes and widths with Tailwind or CSS tokens

- **Category:** UI · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/console/ConsoleLogBody.tsx:44,85,88, src/renderer/console/ConsoleToolbar.tsx:67, src/renderer/features/clients/components/install/ProgressBody.tsx:35,47, src/renderer/console/ConsoleHeader.tsx:42
- **Problem:** Multiple components use arbitrary bracket values: text-[12.5px], text-[10.5px], text-[9.5px], text-[13px], text-[14px], w-[88px], w-[44px], min-w-[52px]. The guideline says extract domain strings/numbers — magic literals are banned. These are repeated across console files with no shared constant.
- **Why it matters:** If the console font size changes, every one of these must be hunted individually. text-[10.5px] appears in at least two files (ConsoleLogBody, ConsoleToolbar) with no shared definition.
- **Proposed solution:** Define a console typography set in the Tailwind theme (e.g., text-console-body, text-console-meta, text-console-badge) and the column widths as named CSS custom properties (--console-time-width: 5.5rem, --console-source-width: 2.75rem). Replace all bracket occurrences with the named utilities. For ProgressBody font sizes, use text-sm / text-base variants or add similarly named tokens.
- **Affects packages:** нет
- **Tests:** нет

#### UI-21 — Give Switch component proper interactive role or remove aria-hidden, align with SettingsSwitchRow usage contract

- **Category:** UI · **Priority:** P1 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/shared/ui/Switch.tsx:8, src/renderer/shared/ui/SettingsRow.tsx:61-64
- **Problem:** Switch.tsx renders a <span aria-hidden> — it is intentionally invisible to assistive technology because SettingsSwitchRow wraps it in a <button role='switch' aria-checked>. However this tightly couples Switch to that one wrapper. The Switch prop set is {checked, disabled} with no onClick, which means it cannot ever be used as a standalone accessible control — anyone who drops <Switch> outside SettingsSwitchRow gets an inaccessible decorative blob. The component name 'Switch' implies it is an interactive affordance.
- **Why it matters:** A reusable shared/ui component that can only be used correctly in one specific parent is a fragile abstraction. If anyone adds <Switch> in a new context without reading the internals they silently introduce an accessibility failure.
- **Proposed solution:** Two options: (a) rename to ToggleIndicator or SwitchVisual to make the visual-only contract explicit, or (b) add an onChange prop to Switch and have it manage its own role='switch' aria-checked, removing the aria-hidden, so it can stand alone. Option (b) is better long-term; SettingsSwitchRow then delegates to Switch directly instead of reimplementing role/aria-checked on the button wrapper.
- **Affects packages:** нет
- **Tests:** Unit: render Switch with checked=true, assert role='switch' aria-checked='true' on the root element; keyboard: Space toggles.

#### UI-22 — Extract console virtual-list constants CONSOLE_ROW_HEIGHT and OVERSCAN into a shared constants file

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/console/ConsoleLogBody.tsx:10-11, src/renderer/console/App.tsx:36
- **Problem:** CONSOLE_ROW_HEIGHT is exported from ConsoleLogBody.tsx and imported back into App.tsx for scrollToRow calls. OVERSCAN is a module-level constant inside ConsoleLogBody. This cross-directional import (App.tsx imports a layout constant from ConsoleLogBody) is an inverted dependency: a leaf component is a constant-source for its ancestor.
- **Why it matters:** ConsoleLogBody should not be the source of truth for scroll constants consumed by its parent. If the height changes, the caller (App.tsx) must know to update too, but there is no type-level enforcement of that relationship.
- **Proposed solution:** Create src/renderer/console/constants.ts exporting CONSOLE_ROW_HEIGHT and OVERSCAN. Both ConsoleLogBody and App.tsx import from there. ConsoleLogBody no longer exports CONSOLE_ROW_HEIGHT.
- **Affects packages:** нет
- **Tests:** нет

#### UI-23 — Replace Slider's inline linear-gradient style with a CSS custom-property approach

- **Category:** UI · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/shared/ui/Slider.tsx:45-49
- **Problem:** Slider computes a dynamic track fill via style={{ background: `linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${progress}%, var(--color-muted) ${progress}%, var(--color-muted) 100%)` }}. While the colours use CSS variables (compliant), the progress percentage has to be injected as an inline style because CSS cannot compute it from an HTML attribute. This is acceptable but means the element has a style attribute that changes every render.
- **Why it matters:** The computed gradient is the only way to achieve this cross-browser without JS in a plain <input type='range'>. However the inline style triggers a style recalc on every slider move. A CSS custom property set via element.style.setProperty would achieve the same with a single paint-only property change on the ::-webkit-slider-runnable-track pseudo, which is more performant.
- **Proposed solution:** Set a single CSS variable --slider-progress via style={{ '--slider-progress': `${progress}%` } as CSSProperties} and reference it in a Tailwind CSS-first @layer rule on .slider-track or via the [style] attribute selector in the className. This reduces the inline style to a single custom property and moves the gradient declaration into CSS.
- **Affects packages:** нет
- **Tests:** нет

#### UI-24 — Validate PNG client-side before upload to avoid a round-trip IPC failure

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/skin/hooks.ts:89-101, src/renderer/features/skin/texture.ts
- **Problem:** useSkinEditor.saveAll() encodes the file via canvas (normalizeTextureToPng) and then calls upload.mutate which goes via IPC to main. The main-side uploadSkin (skin.ts:171) validates the PNG buffer with validatePngBuffer from @loontail/yggdrasil-core. If the validation fails the user only learns after a round-trip IPC call. The renderer already has the ArrayBuffer; it could validate before sending.
- **Why it matters:** Poor UX: a pixel-dimension or corruption error shows up as a mutation error after the network round-trip, not as an instant inline error on file pick. The yggdrasil-core validatePngBuffer is exported from that package and available to the renderer.
- **Proposed solution:** Import validatePngBuffer from @loontail/yggdrasil-core in useSkinEditor or a new validateTexture utility, call it on the ArrayBuffer after normalizeTextureToPng, and surface a localized error string via useState<string|null>(null) before attempting the IPC call. The main-side validation stays as the authoritative guard — this is a defence-in-depth fast-fail.
- **Affects packages:** loontail-yggdrasil: validatePngBuffer must be importable in a browser/renderer (DOM) context, not only Node. Verify the yggdrasil-core build target includes a browser-safe export; if not, a separate build target or conditional re-export is needed (build + copy-dist required).
- **Tests:** Unit: useSkinEditor saveAll with an ArrayBuffer that fails validatePngBuffer — mutation not called, error state set.

#### UI-25 — Harden ConsoleApp flashFeedback timer: use try/finally to ensure IDLE reset even on timeout error

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/console/App.tsx:42-45
- **Problem:** flashFeedback uses window.setTimeout to reset copy feedback to IDLE (line 44). There is no cleanup of this timer on unmount. If the ConsoleApp unmounts while a feedback timer is running (e.g., user closes console window during a copy operation), the setTimeout callback calls setter on an unmounted component.
- **Why it matters:** React 18 suppresses the 'setState on unmounted component' warning but the dangling timer wastes resources and can interfere with test teardown. The guideline says wrap long-running operations in try/finally so timers are always cleaned up.
- **Proposed solution:** Store the timer id in a useRef. In flashFeedback: if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = window.setTimeout(...). Add a useEffect cleanup: return () => { if (timerRef.current) clearTimeout(timerRef.current); }. Or extract into a useFlashFeedback hook matching the existing useCopyText pattern.
- **Affects packages:** нет
- **Tests:** нет

#### UI-26 — The Modal component leaks body overflow state if isOpen changes from true to false before cleanup runs

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/shared/ui/Modal.tsx:70-79
- **Problem:** The useEffect at line 47 writes document.body.style.overflow = 'hidden' and restores it via previousOverflow in the cleanup. However the if (!isOpen) return null guard on line 81 means the component unmounts immediately when isOpen becomes false. React's strict-mode double-invoke and concurrent-mode teardown may run cleanup in a different order than expected, but more critically: if two modals are open simultaneously and one closes, the restore restores to '' (empty) which also undoes the second modal's overflow lock.
- **Why it matters:** Stacking multiple modals or opening a modal inside a modal will corrupt the body overflow state. The pattern of saving/restoring overflow is inherently non-composable with multiple callers.
- **Proposed solution:** Use a ref-counted singleton outside React (e.g., a module-level counter that increments on mount / decrements on unmount, and only removes overflow:hidden when the counter reaches 0). Alternatively use a portal-based approach where the scroll lock lives at the app level, not per-modal.
- **Affects packages:** нет
- **Tests:** Integration: mount two modals, close one, assert body.style.overflow remains 'hidden'; close both, assert body.style.overflow is ''.

#### UI-27 — Make ConsoleLogBody virtualizer aware of dropped-count banner height to prevent row offset errors

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/console/ConsoleLogBody.tsx:32-37
- **Problem:** The virtual list (lines 32-37) computes startIndex purely from scroll.scrollTop / CONSOLE_ROW_HEIGHT. When droppedCount > 0, a sticky banner is rendered at the top (line 46-49) with unaccounted height. The sticky banner sits inside the scrollable container but uses position sticky, so it does not consume scroll space — however it covers the first visible row, making that row partially or fully obscured by the banner without the virtualizer knowing.
- **Why it matters:** With a large dropped-count banner visible, the first visible row in the virtual list is hidden behind the banner. Users scrolled to the top will see the second-from-top row first, with the topmost row clipped. The jump-to-bottom button offset calculation is also unaffected but the visual layout is off.
- **Proposed solution:** Measure the banner height (ResizeObserver or a fixed CSS variable) and add it as a top offset to the scroll container's effective viewport start. Alternatively, render the banner outside the virtual scroll container (before the scroll div) so its height is naturally excluded from scroll metrics.
- **Affects packages:** нет
- **Tests:** нет

#### UI-28 — Eliminate Slider's style attribute rendering on every value change by using a CSS custom property

- **Category:** Performance · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/shared/ui/Slider.tsx:44-48
- **Problem:** Every Slider value change re-renders the input and rebuilds a 100-character style string: background: linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) ${progress}%, var(--color-muted) ${progress}%, var(--color-muted) 100%). This is a string concatenation on every mousemove/change event, triggering a style recalculation on each render.
- **Why it matters:** The RAM slider in settings fires onChange for every pixel of drag. Each drag event rebuilds the gradient string and triggers a forced style recalc, which is avoidable. The guideline says no inline styles; also performance is a valid concern for real-time drag feedback.
- **Proposed solution:** Use style={{ '--progress': `${progress}%` } as React.CSSProperties} and define the gradient in a Tailwind @layer base or @layer components rule: input[type=range].slider { background: linear-gradient(to right, var(--color-primary) 0%, var(--color-primary) var(--progress), var(--color-muted) var(--progress), var(--color-muted) 100%); }. The single CSS variable change is handled by the style engine without React string rebuilding.
- **Affects packages:** нет
- **Tests:** нет

#### UI-29 — Give the SkinViewerCard fixed-size container proper aspect-ratio tokens instead of magic numbers

- **Category:** UI · **Priority:** P3 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/settings/components/sections/account/AccountSkinPreview.tsx:5-6, src/renderer/features/skin/components/SkinViewerCard.tsx:36
- **Problem:** VIEWER_WIDTH = 180 and VIEWER_HEIGHT = 220 are magic number constants in AccountSkinPreview.tsx (lines 5-6). They are passed as props to SkinViewerCard and applied as inline style={{ width, height }} (SkinViewerCard line 36). AccountSkinPreview also uses them in a Suspense fallback div via inline style.
- **Why it matters:** Hardcoded pixel dimensions in three places (AccountSkinPreview constant declaration, SkinViewerCard container style, and Suspense fallback). Any resize requires changes in two files. The guideline bans inline styles and magic literals.
- **Proposed solution:** Define --skin-viewer-width and --skin-viewer-height as CSS custom properties (or Tailwind theme tokens) and use them via className w-[var(--skin-viewer-width)] h-[var(--skin-viewer-height)] or named Tailwind utilities. SkinViewerCard should accept width/height as explicit canvas dimensions only (needed for the WebGL canvas), not for the wrapping div sizing.
- **Affects packages:** нет
- **Tests:** нет

#### UI-30 — Address missing error boundary around SkinViewer WebGL context failure

- **Category:** Error handling · **Priority:** P1 · **Risk:** High · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/skin/components/SkinViewer.tsx:29-41
- **Problem:** SkinViewer mounts skinview3d on a canvas. If the WebGL context is unavailable (headless environment, disabled GPU, OOBE scenario on setup) the SkinView3d constructor throws. There is no try/catch and no error boundary wrapping SkinViewerCard in AccountSkinPreview. The Suspense fallback only handles async loading, not imperative constructor errors.
- **Why it matters:** A crashed skin viewer will propagate the exception to the nearest error boundary (ErrorBoundary at app root). The entire settings section becomes unmounted, and the user loses access to all settings including the logout button — they can be stuck.
- **Proposed solution:** Wrap the SkinView3d constructor in try/catch in the useEffect (SkinViewer.tsx line 32). On failure, set a canvasError state and render a fallback div (e.g., the skin placeholder icon) instead of the canvas. This is localised and does not require a full error boundary.
- **Affects packages:** нет
- **Tests:** Unit: mock SkinView3d constructor to throw; assert fallback renders; assert console.warn is called.

#### UI-31 — Address useSkinEditor saveAll: concurrent skin+cape save can partially succeed with no rollback or per-item error

- **Category:** Error handling · **Priority:** P1 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/skin/hooks.ts:89-102
- **Problem:** saveAll() awaits skin upload, then cape upload sequentially (lines 90-101). If the skin upload succeeds but the cape upload fails, pendingUrl for skin is cleared (line 94) but the mutation error surfaces as a generic upload.mutate rejection with no differentiation. The user sees 'upload failed' without knowing which texture succeeded. There is no rollback — the skin is already committed to the server.
- **Why it matters:** The user uploaded both at once; partial success is confusing. More importantly, clearIfCurrent on line 94 only clears if the objectUrl hasn't changed since the save started — which is correct — but if the cape upload fails, the skin pending state is already cleared so the user cannot retry just the cape without re-picking the skin file too.
- **Proposed solution:** Run uploads in parallel via Promise.allSettled. Surface per-texture errors (e.g., toast.error with skin/cape context). Only clear a pending texture if its own upload settled as fulfilled. This matches the guideline's try/finally cleanup principle applied per-operation.
- **Affects packages:** нет
- **Tests:** Unit: mock uploadSkin to resolve, uploadCape to reject; assert skin pending cleared, cape pending not cleared, error toast called with cape context.

#### UI-32 — queryPersister uses synchronous localStorage serialisation for the entire TanStack Query cache

- **Category:** Performance · **Priority:** P2 · **Risk:** Medium · _(auditor: state-async-perf)_
- **Area:** src/renderer/shared/lib/queryPersister.ts
- **Problem:** createSyncStoragePersister (line 18) serialises the entire query cache to localStorage synchronously on every persist tick (throttled to 1 second). localStorage.setItem is a synchronous, blocking call on the main thread. For a large cache (many clients, settings, profile data), the serialised JSON can be tens to hundreds of KB. The 1-second throttle only prevents burst writes, not the blocking nature of each individual write.
- **Why it matters:** Synchronous localStorage writes on the renderer main thread block the JS event loop, causing frame drops or jank during active operations (downloads, installs) when the cache is dirtied frequently.
- **Proposed solution:** Switch to the async IndexedDB persister from @tanstack/query-idb-persister (available in TanStack Query v5 ecosystem), or use @tanstack/query-async-storage-persister with a custom async driver backed by IndexedDB or the Electron contextBridge's app.getPath('userData') via a dedicated IPC channel. This moves serialisation off the main thread.
- **Affects packages:** нет
- **Tests:** Performance test: under a simulated install (frequent cache updates), measure main-thread blocking time with sync vs async persister.

#### UI-33 — MinecraftEventsListener registers offLog for minecraftLog but the handler is a no-op — dead subscription

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/renderer/features/minecraft/events.ts
- **Problem:** Line 96 of events.ts registers a listener for IPC_EVENTS.minecraftLog with an empty arrow function `() => {}`. The subscription is never used — log lines go to the console window via consoleHub, not the renderer store. The cleanup function at line 98 correctly unregisters it, so there is no leak, but the subscription adds unnecessary IPC listener overhead for every log line that passes through the IPC bridge.
- **Why it matters:** Every minecraft.log IPC event (emitted for each stdout/stderr line when consoleEnabled is true) invokes this no-op callback unnecessarily, adding IPC deserialization overhead for zero benefit.
- **Proposed solution:** Remove the offLog subscription entirely (lines 96-97 and the `offLog()` in cleanup). If the minecraftLog event is needed in future, add it back then.
- **Affects packages:** нет
- **Tests:** нет

#### UI-34 — BundleEventsListener dependency array is empty but closes over mutable module-level state via useBundleStore.getState()

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/renderer/features/bundle/events.ts
- **Problem:** BundleEventsListener (line 10) uses useEffect with an empty dependency array (line 44). Inside, it calls useBundleStore.getState() (lines 12-13) to grab patch and reset. This is correct for Zustand stores (getState() returns stable references). However the minecraftStatus listener on line 34 captures reset by reference at mount time. If the store's reset reference were to change (unlikely in Zustand but not guaranteed across store reconstructions in tests), the listener would hold a stale reference. Document this assumption explicitly.
- **Why it matters:** Minor: the pattern is correct for production but creates a subtle gotcha in tests that reconstruct the Zustand store between test cases, causing the listener to call a stale reset function.
- **Proposed solution:** Add a comment explaining why getState() is used instead of a hook (stable reference, avoids re-subscription on every render). Alternatively call useBundleStore.getState().reset inside the IPC handler body to always dereference at call time.
- **Affects packages:** нет
- **Tests:** нет

#### UI-35 — Updater auto-check module-level mutable variables (lastAutoCheckAt, userInitiatedCheck, etc.) are not reset on HMR or renderer reload

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/renderer/features/updater/events.ts
- **Problem:** Lines 17-23 define module-level mutable variables: lastAutoCheckAt, userInitiatedCheck, lastToastedState, lastToastedErrorMessage. The comment on line 22 says these 'reset on page reload — exactly right'. However in Electron with Vite HMR (hot module reload during development), modules may be re-evaluated without a full page reload, resetting these variables mid-session. More importantly, because they are plain module-level variables, any future use of the UpdaterEventsListener in a different render context (e.g. a second BrowserWindow) will share the same variables, causing cross-context state pollution.
- **Why it matters:** Shared mutable module state across multiple renderer instances (or HMR cycles) can cause missed toasts, skipped update checks, or duplicate toasts. This is the kind of subtle bug that only appears in specific timing scenarios.
- **Proposed solution:** Move this state into a Zustand store slice or into a ref/closure scoped to the UpdaterEventsListener component. Since there is only ever one updater listener instance, a closure (useRef) is sufficient and avoids the module-level mutation entirely.
- **Affects packages:** нет
- **Tests:** нет

#### UI-36 — Remove JSDoc on `useSkinEditor` in renderer/features/skin/hooks.ts

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/features/skin/hooks.ts
- **Problem:** Lines 45-50: `/** Owns the skin/cape file pickers, the unsaved-preview state, and the upload/reset mutations. Returns ready-to-bind input props plus an action surface… */` — this restates the return shape visible in the type annotation five lines below. A React hook named `useSkinEditor` describes its domain unambiguously.
- **Why it matters:** §10: what-restating docstring on a component hook.
- **Proposed solution:** Delete the JSDoc block. The hook's return object structure is the contract; the docstring is a stale synopsis.
- **Affects packages:** нет
- **Tests:** нет

#### UI-37 — Remove comment 'Mount once at app root…' above `UpdaterEventsListener` in updater/events.ts

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/features/updater/events.ts
- **Problem:** Lines 103-104: `// Mount once at app root: feeds the global store and translates transitions into toasts. AppBar badge + LauncherSection both read from the store.` The phrase 'feeds the global store and translates transitions into toasts' is a what-restatement of the component body. The 'mount once at app root' is a usage instruction (caller reference). The related `UpdaterAutoCheck` component comment at line 121-122 is similar.
- **Why it matters:** §10: usage instructions and what-narrations are both forbidden patterns.
- **Proposed solution:** Delete both comments. If the 'mount exactly once' invariant is truly non-obvious, add a brief `// Must be a singleton — module state (lastToastedState) is shared.` comment instead.
- **Affects packages:** нет
- **Tests:** нет

#### UI-38 — Remove what-restating comments in PlayButton.tsx progress card and bundle-error sections

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/features/clients/components/PlayButton.tsx
- **Problem:** Lines 185-186: `// Progress card wins over the per-status switch below whenever an install or bundle sync is in flight. Selector returns null otherwise and the card collapses immediately — no transient success state.` Lines 195-196: `// Bundle error surface: render under the Play affordance so the user can retry without leaving the client page.` Both comments narrate what the immediately following `if` blocks do. The action selectors have enough context from the `action === PlayButtonActions.PROGRESS` condition.
- **Why it matters:** §10: what-restating inline comments on control-flow blocks.
- **Proposed solution:** Delete both comment blocks. The switch cases and if-conditions are self-explanatory with the `PlayButtonActions` constants.
- **Affects packages:** нет
- **Tests:** нет

#### UI-39 — Remove what-restating comment above the switch `case PlayButtonActions.STATUS_PENDING` in PlayButton.tsx

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/features/clients/components/PlayButton.tsx
- **Problem:** Lines 228-230: `// Initial status seed (and any later build-status check) renders a spinner rather than vanishing — the affordance stays put while we resolve state.` This explains the UX rationale for the spinner, which is marginally useful, but it describes what the case does ('renders a spinner') rather than why the behavior is non-obvious.
- **Why it matters:** §10: the case name `STATUS_PENDING` already communicates pending-state. The 'affordance stays put' note is visible from the `disabled` spinner JSX.
- **Proposed solution:** Delete the comment. The `STATUS_PENDING` constant name is sufficient.
- **Affects packages:** нет
- **Tests:** нет

#### UI-40 — Remove comment 'Coalesce progress emissions…' in useConsoleStream.ts — restates what throttle does

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/console/hooks/useConsoleStream.ts
- **Problem:** Line 94-95: `// Coalesce inbound push batches so a burst of stdout becomes one setLines.` This is a what-restatement of `flushPending` + `scheduleFlush`. The `queueMicrotask` comment at line 121-122 IS a genuine platform-quirk comment that must be kept. The reconciliation poll comment at line 161-162 ('Chromium can throttle occluded windows; catch any pushes the live channel missed.') is also a valid keep.
- **Why it matters:** §10: 'Coalesce… so a burst becomes one setLines' describes what the function does. The `useCallback` name and `pendingRef` usage already imply batching.
- **Proposed solution:** Delete the line 94-95 comment. Keep lines 121-122 (`queueMicrotask` rationale) and lines 161-162 (Chromium throttling note) unchanged.
- **Affects packages:** нет
- **Tests:** нет

#### UI-41 — Remove empty-catch comment `/* main may not be ready yet — live updates will catch us up */` in useConsoleStream.ts

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/console/hooks/useConsoleStream.ts
- **Problem:** Lines 84-86: `getInitial()…catch(() => { /* main may not be ready yet — live updates will catch us up */ });` — Per §10, empty-catch labels are only allowed when the reason for swallowing is non-obvious. In this case the reason IS partially non-obvious (main not ready on mount) so it is borderline. However the correct format per §10 is `// …` not a `/* */` inside the catch body, and 'live updates will catch us up' is the reconciliation-poll already described at line 161.
- **Why it matters:** §10: the preferred form for an empty-catch explanation is a brief `// why` line, not a block comment. This catch is the startup race case and the reason is non-obvious enough to warrant one line.
- **Proposed solution:** Replace `/* main may not be ready yet — live updates will catch us up */` with `// main may not be ready on mount; the reconcile poll catches up.` inside the catch block.
- **Affects packages:** нет
- **Tests:** нет

#### UI-42 — `FolderInfoBlock` component uses magic `1024 ** 3` and `1024 ** 2` numeric literals without named constants

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/features/settings/components/FolderInfoBlock.tsx
- **Problem:** Lines 9-16: `const BYTES_PER_GB = 1024 ** 3;` exists but `1024 ** 2` (MB) is used inline at line 16 without a `BYTES_PER_MB` constant. Minor inconsistency per §6.1.
- **Why it matters:** If the formatting is ever changed (e.g. add kibibyte range), the inline `1024 ** 2` is a magic literal that must be hunted down.
- **Proposed solution:** Add `const BYTES_PER_MB = 1024 ** 2;` alongside `BYTES_PER_GB` and replace the inline `1024 ** 2` with it.
- **Affects packages:** нет
- **Tests:** нет

#### UI-43 — `LAUNCHER_SETTINGS_STALE_TIME_MS` comment in settings/hooks.ts is an inline caller-reference

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/renderer/features/settings/hooks.ts
- **Problem:** Lines 22-24: `// Main-side mutations (e.g. persistRuntime after install) bypass the IPC mutation channel that calls setQueryData. Refetch periodically so the renderer eventually picks them up without a manual reload.` The comment names a specific internal function (`persistRuntime`) as a caller-reference example. This is borderline: 'persistRuntime' is used as an example, not as a unique identifier.
- **Why it matters:** §10 forbids references to 'current task / ticket / author'. A function name used as a cross-reference example is in a grey zone but naming a non-public internal function in a comment creates coupling.
- **Proposed solution:** Replace `e.g. persistRuntime after install` with a generic example: `e.g. runtime path stored after install`. This preserves the why without naming the internal function.
- **Affects packages:** нет
- **Tests:** нет

### IPC flow (9)

#### IPC-01 — Router passes rawArgs to handlers without guaranteed Zod validation

- **Status:** DONE — 2026-05-31 · commit 58f373e
- **Category:** IPC · **Priority:** P0 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/ipc/router.ts:77, src/main/services/auth/routes.ts, src/main/services/app/routes.ts, src/main/services/media/routes.ts, src/main/services/console/index.ts
- **Problem:** router.ts line 77 casts `rawArgs as IpcArgs<TChannel>` and passes it directly to the handler. Handlers that omit `parseIpcArgs` (e.g. `authMe`, `authLogout`, `authMojangCancel`, `settingsGet`, `mediaClearCache`, `mediaGetCacheSize`, `mediaClearSkin`, `consoleClear`, `consoleCopyAll`, `appGetVersion`, `systemGetRamRange`, `systemGetDefaultInstallFolder`) receive an unvalidated `unknown` value that TypeScript treats as the correct type. A malicious or buggy renderer can send arbitrary data without triggering IPC_INVALID_ARGS.
- **Why it matters:** The guideline requires Zod validation of args on entry for every channel. The cast silently bypasses the validation contract for all no-arg handlers. If any of those handlers ever changes to read from args, the missing validation becomes a live injection vector.
- **Proposed solution:** For channels whose IpcContract entry is `args: undefined`, add an explicit `z.undefined()` guard in the router itself when `args` is received: if `rawArgs !== undefined` throw `IpcUntrustedSender`. Alternatively, add a thin `assertUndefinedArgs` helper analogous to `parseIpcArgs` and call it in every no-arg route handler so the contract is enforced uniformly and intentionally at the route level rather than relying on the cast.
- **Affects packages:** нет
- **Tests:** Unit tests on the router: send a non-undefined payload to a no-arg channel and assert IPC_INVALID_ARGS is returned. Integration test: invoke 'auth.me' with a payload object from a mock renderer.

#### IPC-02 — CONSOLE_CHANNEL_PREFIX check in trustedSender.ts uses string prefix comparison — new console.* channels require no code change but are implicitly trusted to the console window

- **Category:** IPC · **Priority:** P2 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/main/ipc/trustedSender.ts:48-54, src/shared/ipc/channels.ts:55
- **Problem:** The console window is granted access to any channel whose name starts with `'console.'` (CONSOLE_CHANNEL_PREFIX). The compile-time coverage check in channels.ts ensures all console channels are in IpcContract, but if a new `console.adminAction` channel is added in the future, the console window (which is less sandboxed) automatically gains access to it without any explicit trust decision. The prefix-based grant is a blanket allowlist that grows silently.
- **Why it matters:** Security: future console channels are implicitly trusted without a reviewer noticing. The console window has weaker isolation (runs unsandboxed per the comment) and should have the smallest possible IPC surface.
- **Proposed solution:** Replace the prefix-based check with an explicit allowlist of console channels: `const CONSOLE_ALLOWED_CHANNELS = new Set([IPC_CHANNELS.consoleGetInitial, IPC_CHANNELS.consoleClear, IPC_CHANNELS.consoleCopyAll, IPC_CHANNELS.consoleCopyText])`. New console channels require an explicit addition. This is a small, reviewable set.
- **Affects packages:** нет
- **Tests:** Unit test: for each channel in IpcContract, assert that a console-window sender is allowed only the four expected channels and rejected for all others.

#### IPC-03 — bundleCheckStatus IPC handler makes a network call in the handler body — violates 'thin routes' guideline

- **Category:** IPC · **Priority:** P2 · **Risk:** Medium · _(auditor: download-install-flow)_
- **Area:** src/main/services/bundle/routes.ts, src/main/services/bundle/manager.ts
- **Problem:** The IPC handler for bundleCheckStatus (routes.ts line 31-34) delegates to manager.getInstallState which in turn calls fetchRemoteManifest (manager.ts line 193) — a network call that may take several seconds. The guideline requires IPC handlers to be thin (validate args, call service, return). A blocking network call inside an IPC handler ties up the handler's promise for as long as the network request takes, potentially causing renderer-side awaits to time out on slow connections.
- **Why it matters:** If the Strapi server is temporarily unreachable, the renderer's checkStatus IPC call will block for up to BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS (60 seconds) before the catch triggers. During this window, the renderer's useBundleStatus useEffect is blocked awaiting the promise, and the UI shows a stale UNKNOWN state.
- **Proposed solution:** Extract the drift check from getInstallState into a separate background method (e.g. scheduleManifestDriftCheck) that updates state asynchronously and notifies the renderer via IPC_EVENTS.bundleStatus when drift is detected. getInstallState should return only cached/local data synchronously. The routes.ts handler stays thin.
- **Affects packages:** нет
- **Tests:** Unit: getInstallState returns immediately from cache; integration: slow network does not block bundleCheckStatus response.

#### IPC-04 — SLUG_REQUIRED string literal duplicated in three separate route files

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/routes.ts (L9), src/main/services/bundle/routes.ts (L8), src/main/services/settings/routes.ts (L18)
- **Problem:** `const SLUG_REQUIRED = 'slug must be a non-empty string'` is defined identically as a module-level constant in all three route files. The string is passed as the error label to `parseIpcArgs`.
- **Why it matters:** Typo or message change must be applied in three files. Three separate constants with the same value adds noise.
- **Proposed solution:** Extract to `src/main/ipc/parseArgs.ts` or a `src/main/ipc/errorMessages.ts` as `export const SLUG_REQUIRED_MSG`. Import in the three callsites.
- **Affects packages:** нет
- **Tests:** нет — covered by existing IPC validation tests.

#### IPC-05 — IpcError.code is typed as string in shared/ipc/errors.ts — no compile-time narrowing from codes registry

- **Category:** IPC · **Priority:** P2 · **Risk:** Medium · _(auditor: error-logging-model)_
- **Area:** src/shared/ipc/errors.ts line 2, src/shared/constants/errorCodes.ts
- **Problem:** IpcError.code is typed as string (errors.ts line 2). The comment in isIpcError (lines 7-11) intentionally avoids narrowing to a closed set for forward-compatibility. However, this means that renderer call sites which switch/match on ipcError.code have no compile-time exhaustiveness guarantee. The renderer's IPC_LOGIN_ERROR_CODES map in auth/hooks.ts uses Partial<Record<string, LoginErrorCode>> rather than the domain code union, and a typo in a code string would silently map to undefined.
- **Why it matters:** The loose string type removes the safety net that discriminated unions would provide. Switches on ipcError.code in renderer features are unguarded — a refactored code constant or typo creates a silent fallthrough. This contradicts the guideline's requirement for discriminated unions + assertNever exhaustiveness.
- **Proposed solution:** Introduce a type alias IpcErrorCode = ErrorCode | MinecraftErrorCode | BundleErrorCode | SkinErrorCode (after task above moves skin codes to shared/contracts). Type IpcError.code as IpcErrorCode rather than string. Add an overloaded isIpcError(value, code: IpcErrorCode): boolean type guard for narrowing at call sites. The comment's concern about closed registry is addressed by making IpcErrorCode a union that spans all domain codes — adding a new domain code automatically expands the union.
- **Affects packages:** нет
- **Tests:** Compiler regression: renderer IPC_LOGIN_ERROR_CODES becomes Partial<Record<IpcErrorCode, LoginErrorCode>>; confirm tsc catches unknown string keys.

#### IPC-06 — No route-level tests for minecraft/bundle IPC routes (Zod validation and error mapping)

- **Category:** Testing · **Priority:** P1 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/routes.ts, src/main/services/bundle/routes.ts, tests/main/services/system/routes.test.ts (reference implementation)
- **Problem:** There are no tests for registerMinecraftRoutes or registerBundleRoutes analogous to the existing tests/main/services/system/routes.test.ts. The minecraft routes validate with InstallRequestSchema and ClientSlugSchema via parseIpcArgs; if these validations are wrong or the route wires the wrong schema, no test will catch it. The bundle routes similarly have no coverage for BundleStartRequestSchema validation on bundleStart.
- **Why it matters:** IPC args Zod validation is the primary defence against malformed renderer payloads. Without route tests, a regression (e.g. InstallRequestSchema changes shape, parseIpcArgs message changes, a route accidentally calls the wrong manager method) is only caught at runtime.
- **Proposed solution:** Create tests/main/services/minecraft/routes.test.ts and tests/main/services/bundle/routes.test.ts. Use the same createTestRouter pattern from system/routes.test.ts. Mock MinecraftManager and BundleManager. Test: (1) valid args reach the correct manager method with parsed values; (2) invalid args throw IpcInvalidArgs without calling the manager; (3) slug-only routes reject non-slug args.
- **Affects packages:** нет
- **Tests:** Unit tests for each route registration function, covering valid and invalid arg shapes for each channel.

#### IPC-07 — No route-level tests for settings routes — Zod validation of PatchLauncherSettings and SetClientOverridePayload

- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/settings/routes.ts
- **Problem:** settings.setLauncher accepts PatchLauncherSettingsSchema and settings.setClientOverride accepts SetClientOverridePayloadSchema. There are no tests verifying that malformed payloads are rejected before reaching the settings service, and that valid payloads reach the right service method.
- **Why it matters:** PatchLauncherSettingsSchema is .strict() (line 93-99 of settings.ts) which means any extra field causes a validation failure. If the renderer accidentally sends an extra field, the route silently rejects it with IpcInvalidArgs and the user sees no meaningful error. A route test would catch schema drift.
- **Proposed solution:** Create tests/main/services/settings/routes.test.ts. Mock @main/services/settings/settings. Test: valid PatchLauncherSettings reaches patchLauncherSettings; invalid extra field throws IpcInvalidArgs; SetClientOverridePayload parses slug+patch; malformed slug throws IpcInvalidArgs.
- **Affects packages:** нет
- **Tests:** Unit tests for registerSettingsRoutes covering each channel's validation boundary.

#### IPC-08 — PatchLauncherSettingsSchema is .strict() but settings routes test does not verify that extra fields are rejected

- **Category:** Testing · **Priority:** P3 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/shared/contracts/settings.ts:93-99
- **Problem:** PatchLauncherSettingsSchema uses .strict() (line 97), meaning any extra field causes a parse failure. There are no tests in shared/contracts/schemas.test.ts verifying this constraint. If the renderer accidentally sends an extra key (e.g. clients from a refactor), it will silently fail with IpcInvalidArgs.
- **Why it matters:** The strict constraint is a meaningful API boundary. If it regresses (e.g. .strict() is removed during a refactor), no test catches it.
- **Proposed solution:** Add two tests to shared/contracts/schemas.test.ts: PatchLauncherSettingsSchema accepts a valid partial patch; PatchLauncherSettingsSchema rejects an object with an extra field.
- **Affects packages:** нет
- **Tests:** Two test cases in schemas.test.ts.

#### IPC-09 — IpcContract type is not pinned by a compile-time test — channels can be added without corresponding route registration

- **Category:** Testing · **Priority:** P2 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/shared/ipc/contract.ts, src/main/services/*/routes.ts
- **Problem:** IpcContract defines 30+ channels as TypeScript types. There is no test verifying that every channel in IpcContract has a registered handler (via router.handle) in at least one routes.ts file. A new channel added to the contract without a route registration is a silent dead letter — the renderer call hangs forever.
- **Why it matters:** When a new IPC channel is added to IpcContract for a feature, it's easy to forget to register the handler. The TypeScript type system doesn't enforce route registration. Electron's ipcMain.handle just silently does nothing if the channel is unregistered.
- **Proposed solution:** Add a test that imports all route-registration functions with a recording router (similar to the createTestRouter pattern in system/routes.test.ts) and verifies that every key in IpcContract appears in the registered channels set. This provides a compile+runtime contract.
- **Affects packages:** нет
- **Tests:** Integration test: register all routes, verify every IpcContract channel key has a registered handler.

### Cross-cutting / code-wide (49)

#### CC-01 — patchLauncherSettings is a brittle field-by-field imperative merge requiring updates on every schema change

- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/settings/settings.ts:18-41
- **Problem:** `patchLauncherSettings` manually copies `memory`, `storage`, `launch` and then checks each leaf field with `if (patch.X !== undefined)`. Adding a new setting section or field to `LauncherSettings` requires also updating this merge function — otherwise the new field is silently dropped. The pattern already exists in a simpler, more maintainable form: `setClientOverride` delegates to the pure `setClientOverridePure` in shared/domain.
- **Why it matters:** High risk of settings silently not persisting when new fields are added. Brittle: the merge logic is not type-safe against `PatchLauncherSettings` evolution.
- **Proposed solution:** Replace the manual merge with a type-safe deep-patch utility in `shared/domain/settings` that applies a `Partial`-deep patch via structured spread, or use Zod's `.merge()`. The patch shape is already defined strictly by `PatchLauncherSettingsSchema.strict()`, so a simple two-level spread covers all current and future fields without per-field conditionals.
- **Affects packages:** нет
- **Tests:** Unit tests for patchLauncherSettings covering: partial patch of each section, no-op when section is omitted, round-trip through Zod schema after patch.

#### CC-02 — shared/contracts/settings.ts imports a runtime type from @loontail/minecraft-kit — risks renderer bundle bloat

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: arch-boundaries)_
- **Area:** src/shared/contracts/settings.ts:1,6
- **Problem:** Line 1: `import type { LoaderKind } from '@loontail/minecraft-kit'`. While it is a type-only import and does not pull in runtime code, the `LoaderChoices` const object on line 10 is defined `satisfies Record<string, LoaderKind>` which introduces a compile-time dependency on the kit. The guideline says shared must have no Electron/Node/React imports but does not enumerate kit as an allowed external. The kit's package.json `main` entry points to a Node-compiled bundle containing yauzl/fs/crypto — build tooling that incorrectly resolves the type import as a value import would include the entire kit in the renderer bundle.
- **Why it matters:** Potential renderer bundle contamination. Violates the spirit of the shared-layer contract (no external runtime dependencies). `LoaderKind` is a simple string union — it can be defined locally in shared/contracts with a `satisfies` check removed or replaced by a structural assertion.
- **Proposed solution:** Define `LoaderChoice` as a local string union in shared/contracts/settings.ts (`'vanilla' | 'forge' | 'fabric'`) without importing from the kit. Add a type-level assertion in main/ (not shared/) that `LoaderChoice extends LoaderKind` to catch kit divergence at compile time without polluting the shared layer.
- **Affects packages:** нет
- **Tests:** Build the renderer bundle and assert @loontail/minecraft-kit is not present in the renderer bundle entry. tsc --noEmit on shared/ with kit stripped from its tsconfig paths.

#### CC-03 — updater service registers IPC handlers inside init() but Squirrel event listeners must be removed on dispose — handler leak if init throws partway through

- **Category:** Error handling · **Priority:** P2 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/updater/index.ts:64-116
- **Problem:** `init()` registers autoUpdater event listeners (lines 70-74) and then registers IPC handlers (lines 83-106). If autoUpdater.setFeedURL throws after listener registration but before the IPC handlers are registered, the `registered` flag remains false and `dispose()` skips the `removeListener` calls — the event listeners are permanently attached to `autoUpdater` and will fire after the service is logically destroyed. Separately, IPC handlers registered via `router.handle` are tracked in the router's `registered` array and cleaned up by `router.dispose()`, but the service's own `dispose()` never calls into the router to remove its handlers, relying on global `router.dispose()` at the end of `drain()`.
- **Why it matters:** Squirrel event listener leak on partial init failure. For the broader pattern: if any service is individually re-initialized (e.g. during testing), its handlers survive.
- **Proposed solution:** Register Squirrel listeners inside a try/finally and set `registered=true` only after all registrations succeed. Decouple the router handler registration from the autoUpdater listener lifecycle — router cleanup is already handled globally by `router.dispose()` in drain(), which is correct.
- **Affects packages:** нет
- **Tests:** Unit test: mock autoUpdater.setFeedURL to throw, call init(), call dispose(), assert no listeners remain on the autoUpdater mock.

#### CC-04 — services with no real lifecycle (app, settings, clients, servers, system, skin, media) have empty async dispose bodies — inconsistency and misleading API

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: arch-boundaries)_
- **Area:** src/main/services/app/index.ts, src/main/services/settings/index.ts, src/main/services/clients/index.ts, src/main/services/servers/index.ts, src/main/services/system/index.ts, src/main/services/skin/index.ts, src/main/services/media/index.ts
- **Problem:** Seven services implement `dispose: async () => {}`. The method is a no-op that allocates a Promise on every call. The guideline says dispose should clean up timers/subscriptions. Having empty async dispose bodies makes it unclear whether the omission is intentional or an oversight when the service had resources.
- **Why it matters:** Minor: misleads future maintainers into thinking dispose does something. Empty async functions allocate microtask queue entries unnecessarily on every shutdown cycle.
- **Proposed solution:** For services with no cleanup to do, change the service type to omit `dispose` or make it synchronous `dispose: () => void` returning nothing. Alternatively, keep the type consistent but make the no-op body synchronous: `dispose: () => Promise.resolve()` — at least make the intent explicit with a comment confirming no cleanup is needed.
- **Affects packages:** нет
- **Tests:** нет

#### CC-05 — Comment-guideline violations: several 'what'-restating block comments should be removed

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/verify.ts:37-42, src/main/services/auth/auth.ts:47-52, src/main/services/auth/routes.ts:17-21
- **Problem:** verify.ts lines 37-42 restate the function's discriminated-union return value ('Returns the active account on success, null if no session … offline fallback') — this is already captured by the TypeScript signature and return type `Account | null`. auth.ts lines 47-52 explain what `getStoredAccount` does in prose that mirrors the code exactly. routes.ts lines 17-21 describe the `mojangFailureCode` function in detail that the code itself expresses. Per guideline §10, comments that restate 'what' the code does should be removed; only 'why' for non-obvious invariants should remain.
- **Why it matters:** Reduces comment noise, improves signal-to-noise ratio for 'why' comments that encode genuine invariants.
- **Proposed solution:** Remove the prose descriptions in verify.ts:37-42, auth.ts:47-52, routes.ts:17-21. Retain the one-liner note about `'offline' keeps the cached copy` in verify.ts as it encodes a design decision. The auth.ts comment about `username` being the only needed field for launch is a genuine 'why' — shorten to a single sentence.
- **Affects packages:** нет
- **Tests:** нет

#### CC-06 — JSDoc-style block comments on `fetchTextures` and `getYggdrasilClient` in yggdrasilClient.ts violate the no-decorative-comments guideline

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: auth-session-flow)_
- **Area:** src/main/services/auth/yggdrasilClient.ts:6-18,32-34
- **Problem:** Lines 6-18: the JSDoc block on `getYggdrasilClient` explains what a singleton is and why lazy construction is used — this restates what the code already shows. Lines 32-34: the JSDoc on `fetchTextures` says 'Wrap `getTextures` so callers always receive absolute URLs' — also a 'what' comment. Per guideline §10, these should be removed or reduced to a single 'why' note about the server URL quirk.
- **Why it matters:** Decorative JSDoc creates maintenance overhead (it goes stale) and provides no additional signal over the code itself.
- **Proposed solution:** Remove the JSDoc block on `getYggdrasilClient`. Reduce the `fetchTextures` JSDoc to an inline comment on the `absolutizeTextureUrl` call: `// Server may return relative URLs; absolutise against mainConfig.apiUrl.`
- **Affects packages:** нет
- **Tests:** нет

#### CC-07 — Local assertNever in installManifest.ts duplicates the minecraft-kit export

- **Status:** DONE — 2026-05-31 · commit 0fb03db
- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: launch-flow)_
- **Area:** src/main/services/minecraft/installManifest.ts:48-50
- **Problem:** installManifest.ts defines its own private assertNever function (lines 48-50). minecraft-kit exports assertNever as a public symbol from @loontail/minecraft-kit core exports. The local copy is functionally identical.
- **Why it matters:** Unnecessary duplication; the project can and should reuse the kit-exported version to stay consistent. Violates the dependency-extraction principle.
- **Proposed solution:** Import assertNever from '@loontail/minecraft-kit' and delete the local definition at lines 48-50.
- **Affects packages:** нет
- **Tests:** нет (build + type-check suffice)

#### CC-08 — Throttled-progress implementation is duplicated between progressAdapter.ts and healProgress.ts

- **Status:** DONE — 2026-05-31 · commit c8cc5c2
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/progressAdapter.ts (lines 109-167), src/main/services/bundle/healProgress.ts (lines 1-79)
- **Problem:** Both files implement the identical pending-flush throttle pattern: a let pendingFlush + lastEmittedAt + Date.now() + setTimeout + clearTimeout + unref() block. The logic is byte-for-byte equivalent except for the flush payload shape. PROGRESS_THROTTLE_MS (100 ms) and HEAL_PROGRESS_THROTTLE_MS (100 ms) are both 100 ms but defined in separate locations.
- **Why it matters:** Two independent throttle implementations will diverge over time. Bugs (e.g. the unref() guard already reads typeof pendingFlush.unref, implying it could be absent) must be fixed in two places. A shared primitive would also ease testing.
- **Proposed solution:** Extract createThrottledEmitter<T>(intervalMs: number, emit: (value: T) => void): { schedule: (value: T) => void; dispose: () => void } into a shared utility (src/main/infra/throttle.ts or src/main/utils/throttle.ts). Use it in both progressAdapter.ts and healProgress.ts. Move the 100 ms constant to a single shared location (e.g. main/constants/progress.ts).
- **Affects packages:** нет
- **Tests:** Unit: throttle emits immediately on first call, coalesces rapid calls, fires trailing flush after interval, clears timer on dispose.

#### CC-09 — installManifest.ts re-implements assertNever instead of importing from minecraft-kit or shared

- **Status:** DONE — 2026-05-31 · commit 0fb03db
- **Category:** Dependency extraction · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/installManifest.ts (lines 48-50)
- **Problem:** assertNever is a local private function at line 48. minecraft-kit exports assertNever from its core surface. The guidelines explicitly state: 'do not re-implement what minecraft-kit already provides'.
- **Why it matters:** Minor duplication, but every re-implementation of assertNever in a different file is a drift risk if the upstream signature changes.
- **Proposed solution:** Import assertNever from '@loontail/minecraft-kit' and delete the local copy.
- **Affects packages:** нет
- **Tests:** нет

#### CC-10 — healProgress.ts HEAL_PROGRESS_THROTTLE_MS magic literal not shared with minecraft-kit progress throttle constant

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/bundle/healProgress.ts (line 6)
- **Problem:** HEAL_PROGRESS_THROTTLE_MS = 100 is a file-local magic constant. progressAdapter.ts has PROGRESS_THROTTLE_MS = 100 (also local). bundle/runner.ts imports BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS from main/constants/bundle.ts (also 100). All three values are identical but defined in three places with three different names.
- **Why it matters:** Guideline: extract domain numbers. Three separate definitions of the same 100 ms throttle will diverge when someone only updates one.
- **Proposed solution:** Define PROGRESS_THROTTLE_MS = 100 once in src/main/constants/progress.ts (or reuse the existing bundle constants file), and reference it from all three throttle implementations.
- **Affects packages:** нет
- **Tests:** нет

#### CC-11 — errorMessage() is duplicated in both minecraft/errors.ts and bundle/errors.ts

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/errors.ts (line 37), src/main/services/bundle/errors.ts (line 19)
- **Problem:** Two identical one-line functions: export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error). Both are copy-paste identical. They are imported separately by their respective service files.
- **Why it matters:** Any change to error-to-string extraction (e.g. adding AggregateError.cause handling) must be applied in two places.
- **Proposed solution:** Extract errorMessage to a single shared utility in src/main/infra/errors.ts (or src/shared/utils/error.ts if it needs renderer access) and import from both services. Alternatively, expose it from @loontail/minecraft-kit's core surface where it likely already exists (the kit uses the same pattern internally).
- **Affects packages:** нет
- **Tests:** нет

#### CC-12 — manager.ts finishRepair is a private method typed with Awaited<ReturnType<typeof buildContext>> instead of the exported Context type

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/manager.ts (line 317)
- **Problem:** ctx: Awaited<ReturnType<typeof buildContext>> at line 317. buildContext returns Promise<Context>; Awaited<ReturnType<...>> equals Context. Using the inferred type instead of the named exported type breaks the explicit-return-types guideline for service boundaries and makes the parameter type opaque at a glance.
- **Why it matters:** Readability and future proofing — if buildContext's signature changes, the compile error appears in the wrong place.
- **Proposed solution:** Import Context from ./context and annotate the parameter as ctx: Context.
- **Affects packages:** нет
- **Tests:** нет

#### CC-13 — bundleHealing.ts: opOptions helper conditionally spreads signal and onEvent using ternary chains instead of clean optional-field syntax

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: repair-integrity-flow)_
- **Area:** src/main/services/minecraft/bundleHealing.ts (lines 43-48, 89-91, 93-94)
- **Problem:** opOptions (lines 43-48) manually constructs an object by conditionally spreading each optional field. The same conditional spread pattern is repeated inline at lines 89-91 and 93-94 for signal. Using { signal?: AbortSignal; onEvent?: ProgressListener } as a type and directly passing options (filtering undefined keys) is simpler and already idiomatic in the rest of the codebase. The opOptions function itself is not exported and its name does not convey intent.
- **Why it matters:** Verbose boilerplate. Violates 'no nested ternaries' (even though these are spread ternaries, they form the same nested evaluation pattern). Minor readability burden.
- **Proposed solution:** Remove opOptions. Pass { signal: options?.signal, onEvent: options?.onEvent } directly, leveraging that the kit ignores undefined optional fields. The kit types allow undefined for both signal and onEvent.
- **Affects packages:** нет
- **Tests:** нет

#### CC-14 — Share `SIDECAR_DIR = '.loontail'` constant duplicated in paths.ts and installManifest.ts

- **Status:** DONE — 2026-05-31 · commit 30dc0bf
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/bundle/paths.ts (L5), src/main/services/minecraft/installManifest.ts (L8)
- **Problem:** The string literal `'.loontail'` is defined as `const SIDECAR_DIR` in both files independently. Both files construct paths under the same directory but neither imports from the other.
- **Why it matters:** A rename of the sidecar directory (e.g. to `.loontail-launcher`) requires editing two files. Missing one file creates a path mismatch that silently loses the manifest on first read after the rename.
- **Proposed solution:** Extract to `src/shared/constants/paths.ts` (no Node/Electron imports required for a string constant) or to a `src/main/constants/sidecar.ts` if preferred. Import in both callsites.
- **Affects packages:** нет
- **Tests:** Integration: bundle manifest and install manifest both resolve to the same `.loontail/` subdirectory of clientFolder.

#### CC-15 — store.ts runs module-level side effects (runMigrations, purgeLegacyAuth) at import time — untestable and order-dependent

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: code-quality)_
- **Area:** src/main/infra/store.ts (L147, L261)
- **Problem:** `runMigrations()` (L147) and `purgeLegacyAuth()` (L261) are called at module level (top-level statements, not inside a function). Any test that imports store.ts will execute these side effects, requiring a live electron-store or a mock. Module-level side effects also make the initialization order fragile — if `app.getPath` is called before Electron's `app.ready`, it throws.
- **Why it matters:** Unit tests for `getStoredAuth`, `setStoredAuth`, and `applySettingsMigrations` cannot be isolated — they always trigger the migration pass. The `purgeLegacyAuth` call invokes `store.get` which reads from the real electron-store file, silently coupling tests to disk state.
- **Proposed solution:** Move `runMigrations()` and `purgeLegacyAuth()` into an exported `initStore()` function. Call `initStore()` from the app's main entry point (after `app.ready`). The `applySettingsMigrations` export (already testable) is unchanged.
- **Affects packages:** нет
- **Tests:** Unit: applySettingsMigrations in isolation without store side effects; integration: initStore() migrates correctly from schema version 0.

#### CC-16 — Context type uses `ReturnType<typeof resolveClientSettings>` instead of the exported `ResolvedClientSettings` type

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/context.ts (L18-23), src/main/services/minecraft/manager.ts (L317)
- **Problem:** `Context.resolved` is typed as `ReturnType<typeof resolveClientSettings>` (context.ts L22) rather than the explicit `ResolvedClientSettings` type already exported from `@shared/contracts/settings`. Similarly `manager.ts` L317 uses `Awaited<ReturnType<typeof buildContext>>` as a parameter type instead of the exported `Context` type.
- **Why it matters:** Using ReturnType prevents the type from being referenced by name in documentation, error messages, and IDE tooltips. The guideline requires explicit return types on public service boundaries. `Awaited<ReturnType<...>>` is particularly opaque for readers of manager.ts.
- **Proposed solution:** Change `context.ts` L22 to use `resolved: ResolvedClientSettings`. Change `manager.ts` L317 to accept `ctx: Context`. Both types are already importable.
- **Affects packages:** нет
- **Tests:** нет (TypeScript compile verifies the change).

#### CC-17 — assertNever is re-implemented locally in installManifest.ts — import from minecraft-kit instead

- **Status:** DONE — 2026-05-31 · commit 0fb03db
- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: code-quality)_
- **Area:** src/main/services/minecraft/installManifest.ts (L48-50)
- **Problem:** `const assertNever = (value: never): never => { throw new Error(...) }` is re-implemented locally (L48-50) even though `assertNever` is already exported from `@loontail/minecraft-kit` (listed in the provided public exports) and is used in the codebase (e.g. it could be imported from the kit).
- **Why it matters:** Guideline violation: 'Do not re-implement these'. Having a local copy means if the kit's assertNever gains extra context (e.g. object shape in the error message), the launcher's copy stays behind.
- **Proposed solution:** Remove the local `assertNever` (L48-50). Import `assertNever` from `@loontail/minecraft-kit` and use it in `loaderVersionFor` (L61).
- **Affects packages:** minecraft-kit: assertNever is listed in public exports under 'core' — no build/copy needed.
- **Tests:** TypeScript: compiler confirms the import resolves.

#### CC-18 — Remove dead emitErrorEvent from ManagerEnv — it is defined but never called

- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/env.ts, src/main/services/minecraft/manager.ts
- **Problem:** ManagerEnv (env.ts line 19) declares emitErrorEvent: (payload: MinecraftErrorEvent) => void and manager.ts line 71 wires it to broadcaster.error. However, no call site in install.ts, launch.ts, repair.ts, repairWorkflow.ts, or uninstall.ts ever invokes env.emitErrorEvent — all callers use env.emitError(slug, code, message) instead. The member is pure dead code.
- **Why it matters:** Dead public surface on the environment record misleads future authors into thinking there are two distinct emit paths. It also means emitError and emitErrorEvent have equivalent semantics duplicated in the type, making it unclear which to add new callers to.
- **Proposed solution:** Delete emitErrorEvent from the ManagerEnv type and from the env initializer in MinecraftManager constructor. Confirm no remaining references, then run the compiler to verify.
- **Affects packages:** нет
- **Tests:** Unit test for MinecraftManager constructor: assert the constructed env object does not expose emitErrorEvent (or simply rely on strict-TS compile check after removal).

#### CC-19 — Replace local assertNever in installManifest.ts with imported assertNever from minecraft-kit

- **Status:** DONE — 2026-05-31 · commit 0fb03db
- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/installManifest.ts lines 48-50
- **Problem:** installManifest.ts lines 48-50 define a private assertNever that throws 'Unhandled loader: ...' — identical in semantics to the assertNever exported from @loontail/minecraft-kit (listed in the public exports). The guideline forbids re-implementing logic already in the dependency.
- **Why it matters:** Code duplication and maintenance drift. If the kit's assertNever gains a structured payload or stack-trace enhancement, the local copy won't benefit. The guideline also requires import over re-implementation.
- **Proposed solution:** Import assertNever from '@loontail/minecraft-kit' and remove the local definition (lines 48-50). Use the imported assertNever in loaderVersionFor's default branch.
- **Affects packages:** нет
- **Tests:** Existing compiler exhaustiveness check on the Loaders switch is sufficient — no new tests needed.

#### CC-20 — bundleHealing logger scope 'bundle.heal' conflicts with healer logger scope 'bundle.healer' — confusing log attribution

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/bundleHealing.ts line 12, src/main/services/bundle/healer.ts line 8
- **Problem:** bundleHealing.ts uses scopedLogger('bundle.heal') (line 12) while healer.ts uses scopedLogger('bundle.healer') (line 8). Both files participate in the same healing flow but use slightly different scope names. bundleHealing is in src/main/services/minecraft/ (not bundle/), so its scope name is already misleading — it appears to belong to the bundle service but lives in the minecraft service.
- **Why it matters:** When reading logs, operators see interleaved 'bundle.heal' and 'bundle.healer' entries and cannot immediately tell which module produced which line. The guideline on scoped loggers implies consistent, meaningful scope names.
- **Proposed solution:** Rename bundleHealing.ts logger scope to 'minecraft.bundleHeal' to match its actual location under services/minecraft. Rename healer.ts logger scope to 'bundle.heal' (the shorter, canonical form for the bundle-side healer). Update any references in log-analysis tooling or documentation.
- **Affects packages:** нет
- **Tests:** нет

#### CC-21 — BundleManager.resolveClientFolder returns empty string falsy fallback — caller must remember to check

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/bundle/manager.ts lines 354-357
- **Problem:** resolveClientFolder (lines 354-357) returns resolved.storage.clientFolder || '' — returning an empty string when no folder is configured. Call sites must check for falsy/empty string themselves (e.g. manager.ts line 220 checks if (!clientFolder)). An empty string is not a valid path type and is semantically distinct from a configured-but-empty path.
- **Why it matters:** Returning a primitive-typed empty string from a function that should either return a configured path or signal absence forces all callers to re-implement the same falsy check. Returning null | string would be cleaner and the TypeScript compiler would enforce the null check at all call sites.
- **Proposed solution:** Change resolveClientFolder to return string | null (return resolved.storage.clientFolder || null). Update callers to handle null explicitly. This is a minor refactor that clarifies intent.
- **Affects packages:** нет
- **Tests:** нет

#### CC-22 — progressAdapter.ts uses magic number PROGRESS_THROTTLE_MS = 100 without a shared constant

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: error-logging-model)_
- **Area:** src/main/services/minecraft/progressAdapter.ts line 21
- **Problem:** PROGRESS_THROTTLE_MS = 100 is a file-local magic number. The bundle runner uses BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS imported from @main/constants/bundle for the same concept on the bundle side. Having separate unshared constants for the two throttles makes it impossible to tune them consistently from one place.
- **Why it matters:** Minor inconsistency — not a safety risk — but the guideline prohibits magic literals and requires domain numbers to be extracted. If the renderer targets 60fps updates and the throttle needs tuning, two files must be changed.
- **Proposed solution:** Move PROGRESS_THROTTLE_MS to src/main/constants/minecraft.ts (mirroring the bundle constants pattern). Import it in progressAdapter.ts. Consider consolidating with BUNDLE_DOWNLOAD_PROGRESS_THROTTLE_MS into a shared PROGRESS_EMIT_THROTTLE_MS constant if both services should use the same value.
- **Affects packages:** нет
- **Tests:** нет

#### CC-23 — Extract pending-RAM state pattern into a shared hook useRamPendingState

- **Category:** Code · **Priority:** P1 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/settings/components/sections/SystemSection.tsx, src/renderer/features/clients/components/ClientSettingsModal.tsx
- **Problem:** Lines 27-39 of SystemSection.tsx and lines 54-73 of ClientSettingsModal.tsx share identical logic: useState<number|null>(null) for pendingRam, a handleRamSave that checks pendingRam === null and calls a mutation, and a useEffect that resets pendingRam on isOpen/slug change. This is full duplication of a 3-state pattern (savedRam, pendingRam, isDirty).
- **Why it matters:** Any fix to the dirty-check or save sequence must be applied in two places. Both are already diverging: ClientSettingsModal resets inside useEffect on modal toggle; SystemSection does not reset on any trigger, so closing and reopening a settings tab can show a stale pending value.
- **Proposed solution:** Create src/renderer/features/settings/hooks/useRamPending.ts exporting useRamPending(savedRam: number, resetKey?: unknown). It owns pendingRam state, the useEffect reset, isDirty, and returns { ramValue, setRam, handleSave, isDirty }. Both callers replace their inline pattern with this hook.
- **Affects packages:** нет
- **Tests:** Unit: hook with renderHook — confirm isDirty false at init, true after setRam, false after handleSave resolves, resets to null when resetKey changes.

#### CC-24 — Move inline business logic out of ClientSettingsModal async handlers into the hooks layer

- **Category:** Architecture · **Priority:** P1 · **Risk:** Medium · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/clients/components/ClientSettingsModal.tsx:66-93
- **Problem:** handleRamSave (line 66), handleToggleConsole (75), handleToggleFullscreen (79), handleResetAll (83), handleChangeFolder (88) are all async functions defined inline inside the component body. They directly call mutation functions and coordinate local state changes. This is business logic in a React component, which the guideline forbids.
- **Why it matters:** Logic defined inline in the component body is not independently testable. The reset-on-save sequence (lines 67-72) is a candidate for regression if the save order changes. Inline async handlers also create a subtle risk of stale closures when pendingRam or slug change between render and the async operation completing.
- **Proposed solution:** Extract the coordination logic into a useClientSettingsActions(slug, { setClientOverride, clearClientOverrides, chooseClientFolder, setPendingRam }) hook co-located in the client-settings feature. The component becomes a pure wiring layer that passes actions down to sub-components.
- **Affects packages:** нет
- **Tests:** Unit: hook — call handleRamSave with no pending value, assert mutation not called; call with pending value, assert mutation called with correct slug and patch, assert setPendingRam(null) called after resolve.

#### CC-25 — Move disk-usage ratio computation out of FolderInfoBlock into a utility function

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/settings/components/FolderInfoBlock.tsx:66-73
- **Problem:** Lines 66-73 compute diskTotal, diskUsedBytes, diskUsedRatio, folderRatio, clampedFolderRatio, restUsedRatio — six derived numbers — directly in the component body before the return. This is presentation-layer domain logic (the guideline bans business logic in components).
- **Why it matters:** The clamping invariant on line 72 (folder pill cannot overshoot total-used segment) is a non-trivial rule. Tested separately it would be a one-liner; buried in the JSX tree it requires reading the full component to find it. The six-variable block makes the component harder to follow.
- **Proposed solution:** Extract computeDiskUsageRatios({ diskInfo, folderBytes }: ...) => { diskUsedRatio, folderRatio, clampedFolderRatio, restUsedRatio } into src/renderer/features/settings/lib/diskUsage.ts. Import and call it in FolderInfoBlock. Add a unit test for the clamp invariant.
- **Affects packages:** нет
- **Tests:** Unit: computeDiskUsageRatios — folder larger than used segment is clamped; zero diskTotal returns all zeros; undefined folderBytes returns folderRatio 0.

#### CC-26 — Replace FolderInfoBlock's internal formatBytes with a shared utility; deduplicate with LauncherSection formatCacheSize

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/settings/components/FolderInfoBlock.tsx:9-17, src/renderer/features/settings/components/sections/LauncherSection.tsx:21-25
- **Problem:** FolderInfoBlock.tsx defines formatBytes (lines 9-17) converting bytes to GB/MB. LauncherSection.tsx defines formatCacheSize (lines 21-25) converting bytes to MB/KB. Both are local private functions doing essentially the same conversion at different thresholds. Neither is exported or reusable.
- **Why it matters:** Two byte-formatting implementations for the same domain will produce inconsistent output for edge-case values (e.g., a 900 MB folder might display '900 MB' from one and '0.9 GB' from the other). Future callers will write a third.
- **Proposed solution:** Create src/renderer/shared/lib/formatBytes.ts with a single formatBytes(bytes: number, opts?: { forceUnit?: 'MB' | 'GB' }): string. Delete both local implementations and import the shared one. The LauncherSection variant (KB/MB) becomes formatBytes(bytes, { maxUnit: 'MB' }) or a separate formatCacheSize that delegates to it.
- **Affects packages:** нет
- **Tests:** Unit: formatBytes — 0, 512, 1023, 1024, 1024*1024-1, 1024*1024, 1024*1024*1024, undefined.

#### CC-27 — Remove void i18n.language subscription side-effect from LanguageSwitcher

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/settings/components/LanguageSwitcher.tsx:26
- **Problem:** Line 26: `void i18n.language;` — this is a no-op expression used only to make the component re-render when i18n.language changes. The intent is to subscribe to language changes, but the mechanism is undocumented and relies on a side effect of destructuring i18n from useTranslation. The comment says nothing. Any reader unfamiliar with react-i18next internals will not understand why this exists.
- **Why it matters:** Implicit subscription via discarded expression reads like a bug. Someone running a linter or code reviewer will delete it. If react-i18next internals change (e.g., if i18n becomes a stable singleton object), re-renders stop and LanguageSwitcher shows stale state.
- **Proposed solution:** Replace with useTranslation().i18n.language directly in a meaningful way: const { i18n } = useTranslation(); const currentLang = i18n.language; — and derive current from currentLang rather than calling getCurrentLanguage() which reads a module-level variable. This makes the re-render dependency explicit and removes the void expression.
- **Affects packages:** нет
- **Tests:** нет

#### CC-28 — Replace CopyButton's identical size class on both icon variants with a single expression

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/shared/ui/CopyButton.tsx:107-109
- **Problem:** Lines 107-109 have a ternary: Check className={variant === 'icon' ? 'size-3.5' : 'size-3.5'} — both branches return the identical string 'size-3.5'. The ternary is dead code but reads as if the sizes differ.
- **Why it matters:** Misleads readers into thinking there is a size distinction between variants. Whoever wrote this likely intended different sizes for icon vs inline but forgot to fill them in.
- **Proposed solution:** Replace the ternary with the single string 'size-3.5'. If different sizes are desired, implement them; if not, remove the dead conditional.
- **Affects packages:** нет
- **Tests:** нет

#### CC-29 — Remove implicit magic string 'system','defaultInstallFolder' query key in SetupPage; use QUERY_KEYS constant

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/setup/components/SetupPage.tsx:28-32
- **Problem:** SetupPage constructs a queryKey with inline array literals ['system', 'defaultInstallFolder'] (lines 28-32). The rest of the codebase uses QUERY_KEYS constants from @shared/constants. This one-off key is invisible to the cache invalidation patterns used elsewhere.
- **Why it matters:** If another component ever needs the default install folder it will invent a different key, leading to two separate cache entries. The guideline says extract domain strings — magic literals are banned.
- **Proposed solution:** Add QUERY_KEYS.system.defaultInstallFolder to the shared constants and use it in SetupPage.
- **Affects packages:** нет
- **Tests:** нет

#### CC-30 — Namespace SetupPage query outside QUERY_KEYS and staleTime:0/gcTime:0 pair should use a named constant

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/setup/components/SetupPage.tsx:27-32
- **Problem:** The defaultInstallFolder query uses staleTime: 0, gcTime: 0 with a prose comment explaining why. These values are magic numeric literals (0) with business meaning ('always refetch, never cache'). The comment is correct but the numbers have no named constant.
- **Why it matters:** A future developer might change the staleTime to a positive number and accidentally cache the default path, which would resurface a stale path from a previous build — precisely what the comment guards against. The guideline says extract domain strings/numbers.
- **Proposed solution:** Define NEVER_CACHE = { staleTime: 0, gcTime: 0 } as const in src/renderer/shared/lib/queryClient.ts or a queryOptions constants file and use spread: { queryKey: [...], queryFn: ..., ...NEVER_CACHE }. The comment moves to the constant definition.
- **Affects packages:** нет
- **Tests:** нет

#### CC-31 — Remove decorative section-divider comment in useInstallProgress; remove what-restating comments in installSteps.ts

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/clients/components/install/useInstallProgress.ts:16-19, src/renderer/features/clients/components/install/installSteps.ts:107
- **Problem:** useInstallProgress.ts lines 16-19 have a multi-line comment block starting 'Single composite hook so callers...' and ending '...same way the main-process install pipeline picks the loader.' The first sentence restates what the function signature already shows. installSteps.ts line 107 comment '// Skip undefined to respect exactOptionalPropertyTypes.' is a why-comment and should be kept; however lines 63-64 ('// Stages map to user-facing steps. With a loader...') partially restate what the code makes clear. Guidelines: delete what-restating comments; keep why-for-non-obvious.
- **Why it matters:** Comment noise inflates file size and trains readers to ignore comments, reducing the signal of genuine why-comments elsewhere.
- **Proposed solution:** In useInstallProgress.ts: delete the first two prose sentences of the block comment (which restate what the hook name conveys); keep only the non-obvious invariant about hasLoader derivation. In installSteps.ts line 63: trim to just the non-obvious part about finalize folding into the last step.
- **Affects packages:** нет
- **Tests:** нет

#### CC-32 — Move computeServerStatusDisplay logic out of ServersInfo render into a selector function

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: renderer-ui)_
- **Area:** src/renderer/features/clients/components/ServersInfo.tsx:51-104
- **Problem:** ServersInfo.tsx lines 51-104 contain a large map() block with inline conditionals: displayName resolution (line 54), hasPlayerCount derivation (line 56), and all className derivations. The 'not anyOnline' guard at line 40 returns early, but the primary branch still interleaves DOM construction with data transformation.
- **Why it matters:** Presentation logic (className computation, displayName fallback chain) is mixed with JSX structure. A separate selector function would allow unit testing the displayName fallback chain server.name ?? motd.clean[0] ?? server.address without rendering.
- **Proposed solution:** Extract resolveServerDisplayEntry(server, status) => { displayName, online, playerText } and place it as a pure function in the same file or a sibling lib module. ServersInfo maps entries using this function and passes the resolved values to a ServerRow subcomponent. This also brings ServersInfo.tsx under the 200-line guideline (it is currently 110 lines but would be cleaner).
- **Affects packages:** нет
- **Tests:** Unit: resolveServerDisplayEntry — name takes priority over motd; motd[0] used when name null; address fallback when both null.

#### CC-33 — cache.ts listNamespaceFiles calls stat() on each file sequentially in a for loop — parallelize with Promise.all

- **Category:** Performance · **Priority:** P2 · **Risk:** Low · _(auditor: state-async-perf)_
- **Area:** src/main/infra/cache.ts
- **Problem:** listNamespaceFiles (line 71) reads directory entries and then calls stat() on each file sequentially in a for-of loop (lines 81-89). For a namespace with many entries (e.g. HTTP cache after weeks of use), this serialises all stat calls through the event loop. listNamespaceFiles is called by both getNamespaceSize (line 95) and enforceSizeBound (line 111).
- **Why it matters:** Sequential stat calls in a loop are a classic Node.js anti-pattern. With 100 cache entries, the stats take 100× the single stat latency instead of near the single stat latency.
- **Proposed solution:** Replace the for-of loop with Promise.all over the entries array, mapping each entry to its stat promise (with ENOENT handling per entry). This fans out all stat calls and awaits them as a batch.
- **Affects packages:** нет
- **Tests:** Unit test with mock fs: 50 entries, assert stat is called concurrently (not sequentially) by checking interleaving via async timing or spy call ordering.

#### CC-34 — SIDECAR_DIR constant '.loontail' is duplicated in installManifest.ts and paths.ts

- **Status:** DONE — 2026-05-31 · commit 30dc0bf
- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/installManifest.ts:8, src/main/services/bundle/paths.ts:5
- **Problem:** Both installManifest.ts and paths.ts independently define const SIDECAR_DIR = '.loontail'. This is a magic string in two separate files; changing it in one would silently leave the other pointing at the old directory name.
- **Why it matters:** If the sidecar directory name ever changes, one of the two constants will be missed. Both are in main/ and used at runtime, so a mismatch would cause the bundle manifest and the install manifest to be written to different subdirectories.
- **Proposed solution:** Extract SIDECAR_DIR to a single shared constant, either in src/shared/constants/ or in a new src/main/constants/paths.ts, and import it in both installManifest.ts and paths.ts.
- **Affects packages:** нет
- **Tests:** No additional tests needed; the existing tests for loadLocalManifest and loadTargetInstallManifest exercise the path computation.

#### CC-35 — assertNever re-implemented locally in installManifest.ts; already exported from minecraft-kit

- **Status:** DONE — 2026-05-31 · commit 0fb03db
- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/installManifest.ts:48-50
- **Problem:** installManifest.ts defines its own assertNever (lines 48-50). The minecraft-kit package already exports assertNever from @loontail/minecraft-kit (per the public exports list in the task spec).
- **Why it matters:** Duplicates kit's utility; if the kit version is ever improved (e.g. better error message), the local copy stays behind.
- **Proposed solution:** Remove the local assertNever and import it from @loontail/minecraft-kit.
- **Affects packages:** нет
- **Tests:** нет

#### CC-36 — MINECRAFT_KIT_VERSION read at module load via createRequire; untestable without mocking module resolution

- **Category:** Testing · **Priority:** P2 · **Risk:** Low · _(auditor: testability)_
- **Area:** src/main/services/minecraft/installManifest.ts:45-46
- **Problem:** const minecraftKitPackage = requirePackage('@loontail/minecraft-kit/package.json') and MINECRAFT_KIT_VERSION = parsePackageVersion(minecraftKitPackage) execute at module load time (lines 45-46). targetInstallManifestMatches() compares manifest.kitVersion against MINECRAFT_KIT_VERSION (line 149). Tests that create TargetInstallManifest objects must match the real installed kit version to get a positive match, or else hasCurrentTargetInstallManifest always returns false.
- **Why it matters:** Tests in installManifest.test.ts must hardcode or compute the real kit version to exercise the 'manifest matches' path. If the kit is bumped, tests that check targetInstallManifestMatches silently change behaviour without a clear failure signal. This is a hidden coupling between test stability and the installed kit version.
- **Proposed solution:** Inject MINECRAFT_KIT_VERSION as a parameter to createTargetInstallManifest and targetInstallManifestMatches (defaulting to the module-level constant for production use). Tests can then pass a fixed string without needing to know the installed kit version.
- **Affects packages:** нет
- **Tests:** Unit tests for targetInstallManifestMatches: matching kitVersion returns true, different kitVersion returns false, without depending on the real installed kit version.

#### CC-37 — buildContext() calls persistClientOverride() as a side-effect during context construction

- **Category:** Architecture · **Priority:** P2 · **Risk:** Medium · _(auditor: testability)_
- **Area:** src/main/services/minecraft/context.ts:51, 78
- **Problem:** buildContext() persists a settings mutation (persistClientOverride) in two places: line 51 (dropping stale loader override) and line 78 (clearing stale runtime ref). Context construction is expected to be a read-heavy setup step; write side-effects make it non-idempotent and harder to test. Any test that calls buildContext must mock or account for setClientOverride side-effects.
- **Why it matters:** A test that calls buildContext to exercise another function (e.g. install or repair) must also mock @main/services/settings/settings to avoid actual disk writes. When the mock is incomplete, the real setClientOverride tries to read the real store — an implicit Electron dependency pulled in through context building.
- **Proposed solution:** Return the mutations from buildContext as a result field (e.g. { ctx, settingPatches }) and let the caller (manager.ts) apply them via persistClientOverride. This keeps context building read-only and makes the mutation explicit at the call site.
- **Affects packages:** нет
- **Tests:** Unit test buildContext: stale loader dropped → returned patch contains loader:undefined; stale runtime cleared → returned patch contains runtime:undefined. Both without mocking @main/services/settings/settings.

#### CC-38 — vitest.config.ts has no coverage configuration — no branch/line coverage gate for CI

- **Category:** Testing · **Priority:** P3 · **Risk:** Low · _(auditor: testability)_
- **Area:** vitest.config.ts
- **Problem:** The vitest configuration has no coverage provider, thresholds, or include/exclude patterns. Running 'vitest run' produces no coverage report. There is no CI gate on coverage regression.
- **Why it matters:** Without coverage thresholds, adding new code paths (e.g. the BundleManager heal-phase abort, the BUNDLE_SYNCING cancel path) without tests goes undetected. The test:watch / verify scripts do not fail on uncovered branches.
- **Proposed solution:** Add coverage configuration to vitest.config.ts: use the 'v8' provider, set per-file thresholds (e.g. statements: 80, branches: 70) for the src/main/services/** and src/shared/** directories, exclude src/renderer and src/preload from main-thread coverage.
- **Affects packages:** нет
- **Tests:** нет

#### CC-39 — Deduplicate the throttled-progress-emitter pattern shared by progressAdapter.ts and healProgress.ts

- **Category:** Code · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/progressAdapter.ts, src/main/services/bundle/healProgress.ts
- **Problem:** Both files independently implement the same throttle/debounce idiom: a `lastEmittedAt` timestamp, a `pendingFlush: NodeJS.Timeout | null`, a `clearPendingFlush` helper, a `setTimeout` / `clearTimeout` pair, and a `.unref()` guard (progressAdapter.ts line 162, healProgress.ts line 49). The only difference is the flush payload.
- **Why it matters:** Two copies mean two places to fix bugs (e.g. the missing `clearPendingFlush` on dispose in healProgress.ts line 78 only calls `clearPendingFlush` but the name in that file is the same – a subtle misread risk). Adding a new progress source requires copying the pattern a third time.
- **Proposed solution:** Extract `createThrottledEmitter<T>(intervalMs, flush: (latest: T) => void): { emit: (v: T) => void; dispose: () => void }` into a shared utility (e.g. `src/main/infra/throttle.ts`). Both `createThrottledProgressEmitter` (progressAdapter.ts lines 121-167) and `createHealProgressListener` (healProgress.ts) become thin wrappers over it.
- **Affects packages:** нет
- **Tests:** Unit: verify emit is throttled to ≥ intervalMs, that dispose cancels the pending timer, and that a final flush fires when emit is called after the interval.

#### CC-40 — Remove locally re-implemented `assertNever` in installManifest.ts; import from minecraft-kit

- **Status:** DONE — 2026-05-31 · commit 0fb03db
- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/installManifest.ts
- **Problem:** Lines 48-50 define a local `assertNever` function. `assertNever` is already exported from `@loontail/minecraft-kit` (listed in the KIT_API: `core: assertNever`).
- **Why it matters:** Violates the guideline 'launcher must NOT re-implement these'. Having two copies also means IDE type-narrowing might not recognise them as the same symbol in discriminated-union exhaustiveness checks.
- **Proposed solution:** Delete lines 48-50 and add `import { assertNever } from '@loontail/minecraft-kit'` to the existing import block at the top of the file.
- **Affects packages:** нет
- **Tests:** Compile-only: TypeScript exhaustiveness check on `target.loader` switch. No new runtime tests required.

#### CC-41 — Replace infra/cache.ts `cachedFetch` with minecraft-kit's `createPersistentMetadataCache`

- **Category:** Dependency extraction · **Priority:** P2 · **Risk:** Medium · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/infra/cache.ts
- **Problem:** `cachedFetch` (cache.ts lines 153-174) is a network-first JSON store with on-disk fallback, keyed by namespace + key, swallowing 5xx as an offline signal. This is semantically identical to what `createPersistentMetadataCache` from `@loontail/minecraft-kit` provides. The launcher builds and maintains its own disk-backed cache infrastructure (lines 10-67: `readBuffer`, `writeBuffer`, `safeKey`, `namespaceDir`) that largely duplicates kit internals.
- **Why it matters:** Two separate cache implementations increase the maintenance surface. Kit's cache is already used for the version manifests and runtime metadata; the launcher's cache is used for bundle manifests and media. Any correctness fix (atomic writes, corruption recovery) has to be applied twice.
- **Proposed solution:** Evaluate whether `createPersistentMetadataCache` accepts a user-supplied base directory (so the launcher can point it at `app.getPath('userData')/cache`). If yes, replace `cachedFetch` callers with kit's cache. If kit's cache does not expose a configurable path, file a request to add it. In the interim, keep the launcher's cache but remove the duplicated logic by extracting it into a single well-tested module. The raw `readBuffer`/`writeBuffer` helpers used for media caching are launcher-specific and should be kept.
- **Affects packages:** minecraft-kit: если `createPersistentMetadataCache` не поддерживает настраиваемую директорию — нужно добавить параметр `cacheDir` в публичный API, пересобрать пакет и обновить версию.
- **Tests:** Unit: `cachedFetch` falls back to disk on 5xx; rethrows on 4xx; rethrows when disk has no snapshot.

#### CC-42 — Remove `emitErrorEvent` from `ManagerEnv` – it is never called

- **Category:** Code · **Priority:** P3 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/env.ts, src/main/services/minecraft/manager.ts
- **Problem:** `ManagerEnv` (env.ts line 20) declares `emitErrorEvent: (payload: MinecraftErrorEvent) => void`. `MinecraftManager` wires it (manager.ts line 71) but no code in the minecraft service layer calls `env.emitErrorEvent`. `env.emitError` (line 18) is used instead for all error broadcasting.
- **Why it matters:** Dead code in a public-facing type interface misleads readers and forces every mock/stub of `ManagerEnv` to implement a method that does nothing.
- **Proposed solution:** Search all callers of `emitErrorEvent` in `src/main/services/minecraft/`. If confirmed dead, remove the field from `ManagerEnv` and the corresponding wiring in `MinecraftManager`.
- **Affects packages:** нет
- **Tests:** Compile-only; remove usages. TypeScript will error if anything actually called it.

#### CC-43 — Remove junk comments: section-divider banners and what-restating comments across minecraft service files

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/progressAdapter.ts, src/main/services/minecraft/launch.ts, src/main/services/minecraft/installManifest.ts, src/main/services/bundle/download.ts
- **Problem:** Several files contain comments that restate the code rather than explaining non-obvious invariants. Examples: progressAdapter.ts line 51 has no comment but the function `emitSnapshot` is self-evident; launch.ts lines 69-76 have an accurate comment but lines 86-95 (`resolveAuthlibInjectorJar`) have no non-obvious invariant being documented. Conversely, download.ts lines 56-62 (`// Register the settle/cleanup listeners before the abort check`) is a genuine race-condition comment that must be kept. installManifest.ts lines 48-50 inline `assertNever` has no comment explaining why a local copy exists.
- **Why it matters:** Per guidelines §10: 'default NO comments; only why for non-obvious invariants/workarounds/race-abort-cleanup/wire-coercion'. Section-divider banners and what-restating comments are explicitly prohibited.
- **Proposed solution:** Do a targeted pass on each file: keep comments that explain races (download.ts:56-62), schema-migration guards (installManifest.ts version literal), and platform quirks (launch.ts authlib-injector CF UA block). Delete comments that restate the function name or describe what the next line does. Do not do a blanket regex sweep — per-comment judgement as required.
- **Affects packages:** нет
- **Tests:** нет

#### CC-44 — Add `VerifyFileCategories` import guard: the enum is used but not re-exported via a stable path

- **Category:** Architecture · **Priority:** P2 · **Risk:** Low · _(auditor: kit-yggdrasil-extraction)_
- **Area:** src/main/services/minecraft/progressAdapter.ts
- **Problem:** Line 9 imports `VerifyFileCategories` from `@loontail/minecraft-kit`. This enum is listed in the KIT_API under `verify: VerifyFileStatuses` — the audit list uses the name `VerifyFileStatuses`, but the import uses `VerifyFileCategories`. If the kit's public export surface changes the name (it has already happened once — note the `VerifyFileStatuses` vs `VerifyFileCategories` discrepancy in the KIT_API description), the import silently becomes `undefined` at runtime if TypeScript's strict checks are bypassed.
- **Why it matters:** A kit API rename that is not breaking in the kit's own semver (e.g. it exports both old and new names) would still break the launcher at import resolution. The discrepancy between the task description (`VerifyFileStatuses`) and the actual import (`VerifyFileCategories`) suggests this has already shifted once.
- **Proposed solution:** Confirm the correct export name in the kit's current public index. If `VerifyFileCategories` is the correct name, add a comment noting it maps to the `VerifyFileStatuses` concept from the architecture docs. If the name differs, align. Add a contract test that imports `VerifyFileCategories` from `@loontail/minecraft-kit` and asserts it is an object.
- **Affects packages:** нет
- **Tests:** Contract test: `import { VerifyFileCategories } from '@loontail/minecraft-kit'; assert typeof VerifyFileCategories === 'object'`.

#### CC-45 — Remove JSDoc on `kitLogger` in logger.ts — the adapter pattern is self-documenting

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/infra/logger.ts
- **Problem:** Lines 29-33: `/** Adapt an electron-log scope to the kit's pluggable Logger interface so new MinecraftKit({ logger }) writes through the same sinks as the rest of the launcher (file + console). */` — the function name `kitLogger`, its return type `KitLogger`, and the call site in kit.ts already communicate the adapter intent.
- **Why it matters:** §10: the docstring is a what-restatement of function name plus parameter types.
- **Proposed solution:** Delete the JSDoc block. The function is straightforwardly a type-adapter and needs no comment.
- **Affects packages:** нет
- **Tests:** нет

#### CC-46 — Remove JSDoc blocks on `enforceSizeBound` and `cachedFetch` in cache.ts

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/infra/cache.ts
- **Problem:** Lines 105-110 (`enforceSizeBound`): 'Prune the oldest files in namespace (by mtime) until the total on-disk footprint is <= maxBytes. No-op when already under the bound…' — entirely describes what, not why. Lines 146-152 (`cachedFetch`): 'Network-first JSON cache with on-disk fallback. Online: call fetcher… Offline (network/5xx by default): return the last persisted JSON…' — again describes what; the function body is short enough that this adds no information.
- **Why it matters:** §10: multi-line docstrings are unnecessary. Both functions are short (<25 lines) and their names + parameters tell the story.
- **Proposed solution:** Delete both JSDoc blocks. The single inline comment at line 132 ('HTTP 4xx is a valid server response… pass it through. Anything else means the API is unreachable.') is the genuine why and should be kept.
- **Affects packages:** нет
- **Tests:** нет

#### CC-47 — Replace JSDoc on `AuthMode` type in http.ts with inline per-value comments

- **Category:** Docs · **Priority:** P2 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/main/infra/http.ts
- **Problem:** Lines 8-22: the `/** Authorization mode… */` docblock on the `AuthMode` type union contains genuine valuable why-content (the explanation of why the Yggdrasil access token is NOT valid for the Strapi API). However it uses multi-line JSDoc format for a two-member string union, which §10 says is unnecessary. The Cloudflare/UA note (lines 45-47 in launch.ts) is the reference pattern: a short inline `//` comment.
- **Why it matters:** §10: 'one short line above the function is enough'. The valuable distinction ('Yggdrasil access token is not a valid bearer for Strapi') should survive but as a short inline comment on the `'none'` branch, not a 14-line docblock.
- **Proposed solution:** Replace the 14-line JSDoc with two 1-2 line `//` comments: one above `'apiToken'` and one above `'none'`. The key invariant ('Yggdrasil token NOT valid for Strapi content API') must be kept.
- **Affects packages:** нет
- **Tests:** нет

#### CC-48 — Remove what-restating inline comment on `resolveLoader` in shared/domain/loader.ts

- **Category:** Docs · **Priority:** P3 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** src/shared/domain/loader.ts
- **Problem:** Line 19: `/** Honours the user's override when valid; otherwise derives the loader from set version fields. */` — this is a one-liner JSDoc. The function name `resolveLoader`, parameter `override`, and its three-branch body make this fully self-explanatory. The related comment on `isLoaderAvailable` at lines 10-12 ('An override is only meaningful when…') is a genuine why-comment that should stay.
- **Why it matters:** §10: even a one-liner JSDoc is a docstring that paraphrases the identifier.
- **Proposed solution:** Delete the JSDoc on `resolveLoader`. The inline comment above `isLoaderAvailable` (lines 10-12) is correct and should be kept.
- **Affects packages:** нет
- **Tests:** нет

#### CC-49 — Reinforce §10 in docs/code-guideline.md with concrete JSDoc ban and 10-second heuristic callout

- **Category:** Docs · **Priority:** P1 · **Risk:** Low · _(auditor: comments-cleanup)_
- **Area:** docs/code-guideline.md
- **Problem:** Section §10 ('Comments') is comprehensive but buries its actionable rules. Three gaps make it easy to miss in practice: (1) JSDoc blocks (`/** … */`) are not explicitly listed as a forbidden form — contributors may assume they are allowed as 'documentation'. (2) The 10-second rule appears at the end as a 'rule of thumb' rather than the primary decision gate. (3) The 'Strip decorative / what-restating comments whenever you touch a file' sentence appears after the keep/forbid lists, reducing its priority.
- **Why it matters:** The audit found ~10 JSDoc blocks across auth, infra, and renderer that violate §10 but are easy to justify as 'documentation' because the guideline doesn't explicitly forbid `/** */` syntax. Without an explicit ban, future contributors will add more.
- **Proposed solution:** In §10: (1) Add `/** … */` multi-line JSDoc blocks to the **Forbidden patterns** bullet list explicitly. (2) Move the 10-second heuristic to the top of §10 as the primary decision rule, before the keep/forbid lists. (3) Promote 'Strip decorative / what-restating comments whenever you touch a file' to a bold callout sentence earlier in the section. No other sections need changes.
- **Affects packages:** нет
- **Tests:** нет

## 3. Cross-cut views

### 3.1 Quick wins — Low risk, near-zero blast radius (182)

- `AUTH-03` MojangProfileSkinSchema in shared/contracts/auth.ts duplicates the kit's MojangProfileSkin type — comment acknowledges this but the duplication is never verified _(P3, Low)_
- `AUTH-04` Mojang sign-in route skips skin enrichment, returning null skin on first login _(P1, Low)_
- `AUTH-05` `verifySession` fires `enrichYggdrasilAccount` (network call) on the 'offline' branch, defeating offline fallback _(P1, Low)_
- `AUTH-06` `withRefreshedProfile` exported from mojangAuth.ts is consumed by skin.ts, creating a cross-service dependency _(P2, Low)_
- `AUTH-10` `AUTH_CANCELLED` is mapped to `LOGIN_ERROR_CODE.Unknown` in routes.ts, but the renderer has a `cancelledRef` guard for this case — the mapping is misleading _(P2, Low)_
- `AUTH-13` Magic number `60_000` (token expiry safety window) is an unexplained inline literal in `verifyMojangSession` _(P3, Low)_
- `AUTH-14` `migrateStoredAuthSecrets` is a misleadingly named no-op wrapper in store.ts, exported and called at init time _(P2, Low)_
- `AUTH-16` `validatePngBuffer` called with `payload.type` which is typed as `SkinKind` ('skin'|'cape'), but yggdrasil-core's signature may expect a different enum — the coupling is implicit _(P2, Low)_
- `AUTH-19` Extract inline `safetyWindowMs = 60_000` magic literal in mojangAuth.ts to a named constant _(P2, Low)_
- `AUTH-20` Inline HTTP status codes 401/403 in mojangAuth.ts verifyMojangSession — extract to named constants _(P3, Low)_
- `AUTH-21` HTTP status code constants (403, 429) in yggdrasilAuth.ts are not shared with mojangAuth.ts _(P3, Low)_
- `AUTH-22` Retire AUTH_NETWORK_ERROR and AUTH_INVALID_CREDENTIALS from ERROR_CODES — they are never thrown _(P1, Low)_
- `AUTH-23` resolveLaunchAuth reads getStoredAuth() at call time — not injected, prevents pure unit-testing _(P2, Low)_
- `AUTH-25` Replace `YGGDRASIL_PLACEHOLDER_CLIENT_ID` zero-GUID with a branded constant exported from yggdrasil-client _(P3, Low)_
- `AUTH-26` Remove JSDoc block on `withRefreshedProfile` in mojangAuth.ts — what-restating docstring _(P2, Low)_
- `AUTH-27` Remove JSDoc blocks on `signInWithMojang`, `cancelMojangLogin`, `verifyMojangSession` inside `createMojangAuth` closure _(P2, Low)_
- `AUTH-28` Collapse JSDoc on `getYggdrasilClient` to a single why-comment or remove entirely _(P3, Low)_
- `AUTH-29` Remove JSDoc on `fetchTextures` in yggdrasilClient.ts — wraps description of its name _(P3, Low)_
- `AUTH-30` Remove JSDoc on `enrichYggdrasilAccount` in verify.ts — bulk of it is what-restating _(P2, Low)_
- `AUTH-31` Remove verifySession block-comment in verify.ts — partially a caller-reference _(P2, Low)_
- `DLI-02` MinecraftManager.startInstall has a double-release risk on the write lock when runInstall is fire-and-forget _(P1, Low)_
- `DLI-05` LocalManifest parsing in manifestRepo.ts uses manual field checks instead of Zod — inconsistent with all other deserialization _(P2, Low)_
- `DLI-07` installManifest.ts duplicates package.json version reading via createRequire — fragile and not covered by kit's version tracking _(P3, Low)_
- `DLI-10` HEAL_PROGRESS_THROTTLE_MS is a magic literal duplicating the exported bundle constant _(P2, Low)_
- `DLI-13` flattenEntries and flattenRemote are parallel implementations of the same manifest-flattening logic _(P2, Low)_
- `DLI-20` AbortController is recreated on resume (resetTaskForResume) but the old controller's listeners are not cleaned up _(P2, Low)_
- `DLI-21` De-duplicate persistTargetInstallManifest — lives in both install.ts and repairWorkflow.ts _(P2, Low)_
- `DLI-22` Cancel of UninstallOp is silently ignored — cancel() has no branch for UNINSTALL _(P2, Low)_
- `DLI-25` manifestRepo.ts uses ad-hoc object casting instead of Zod schema validation for LocalManifest _(P2, Low)_
- `DLI-27` Extract shared throttled-progress-emitter into a single reusable primitive _(P1, Low)_
- `DLI-28` Deduplicate `persistTargetInstallManifest` copied between install.ts and repairWorkflow.ts _(P1, Low)_
- `DLI-29` Add assertNever exhaustiveness to MinecraftManager.cancel() op-kind dispatch _(P1, Low)_
- `DLI-30` Fix `resolveClientFolder` returning empty string `''` instead of `null` for missing folder _(P2, Low)_
- `DLI-31` MinecraftManager.cancel() if/else chain is not type-safe — add assertNever for new OpKinds _(P1, Low)_
- `DLI-32` localManifest validation in manifestRepo.ts uses manual duck-typing instead of Zod schema _(P2, Low)_
- `DLI-33` BundleManager.runSync double-checks OP_IN_FLIGHT at two levels (activeSyncs + operationLocks) with different error messages _(P2, Low)_
- `DLI-36` assignNever exhaustiveness missing in cancel() dispatch for Op variants — mirrors MinecraftManager but in a different location _(P1, Low)_
- `DLI-37` Throttled-progress pattern in healProgress.ts duplicates dispose logic — `dispose` should flush pending rather than just cancel _(P2, Low)_
- `DLI-38` manifestRepo.loadLocalManifest casts parsed JSON with Partial<LocalManifest> — unsafe without runtime validation of nested files _(P2, Low)_
- `DLI-39` Fix double lock.release() in startInstall success path _(P1, Low)_
- `DLI-41` BundleManager.executePreparedSync logs bundle errors only at error level — ABORTED should be warn _(P2, Low)_
- `DLI-44` saveTargetInstallManifest writes .tmp without a try/finally — stale .tmp left on error _(P2, Low)_
- `DLI-46` Double lock.release() in startInstall causes double-release of ClientOperationLease _(P0, Low)_
- `DLI-47` Sequential per-file I/O in buildPlan stalls bundle planning for large manifests _(P1, Low)_
- `DLI-48` Throttled progress emitter dispose() does not cancel a pending flush timer _(P1, Low)_
- `DLI-49` buildPlan sequential exists() calls use fs.access for presence check — replace with stat to avoid double syscall in hash path _(P2, Low)_
- `DLI-51` pauseSync does not guard against pausing an already-paused sync, armPauseIdleTimer can be called twice _(P2, Low)_
- `DLI-52` expirePausedSync resets pauseIdleTimer to null before calling dropActiveSync, creating brief inconsistency _(P3, Low)_
- `DLI-55` cancelAll in BundleManager uses a fixed sleep grace period instead of awaiting actual cleanup _(P2, Low)_
- `DLI-58` runDownloadWorker catches errors and drains the queue, but does not abort the task's AbortController — sibling workers continue one more file _(P2, Low)_
- `DLI-59` plan.ts flattenEntries duplicates logic already present in manifestSnapshot.ts flattenRemote _(P2, Low)_
- `DLI-60` runSyncPhases post-pause check is duplicated with redundant early-return pattern _(P3, Low)_
- `DLI-65` buildPlan's force-mode re-hashing touches the filesystem inside an otherwise pure-ish function — no explicit test for the no-local-record-but-file-exists branch _(P2, Low)_
- `DLI-66` download.ts uses raw http/https Node modules with no injection point — untestable without real network or mocking Node internals _(P2, Low)_
- `DLI-67` Consolidate `isAnythingInstalled` usage: prefer the durable install manifest as the primary probe _(P2, Low)_
- `DLI-70` Eliminate `persistTargetInstallManifest` duplication between install.ts and repairWorkflow.ts _(P2, Low)_
- `DLI-72` Replace hand-rolled `sha256` hash in bundle/api.ts with a shared utility; unify with bundle/plan.ts `hashFile` _(P3, Low)_
- `DLI-73` Harden `loadLocalManifest` in bundle/manifestRepo.ts: replace duck-typed shape check with Zod parsing _(P2, Low)_
- `DLI-75` Remove per-field label comments in `DownloadOptions` type and `SyncTask` type _(P2, Low)_
- `DLI-76` Remove step-narrating comment at manager.ts line 124 that paraphrases install sequence _(P2, Low)_
- `DLI-77` Remove comment 'Called on app shutdown…' above `cancelAll` and 'Called by MinecraftManager…' above `resetForUninstall` in BundleManager _(P2, Low)_
- `DLI-78` Remove 'Plan + tracker + run' style narrating comment in install.ts _(P3, Low)_
- `DLI-79` Remove step-narrating comments in `startInstall` `void runInstall().then()` chain in manager.ts _(P2, Low)_
- `REP-02` processAdapter.ts: repair progress adapter emits stagePercent=overallPercent always (both use the same percent) — no multi-stage aggregation for repair _(P3, Low)_
- `REP-05` persistTargetInstallManifest is duplicated between install.ts and repairWorkflow.ts _(P2, Low)_
- `REP-07` forgeProcessorHealing.ts re-implements SHA-1 file hashing with a streaming Promise wrapper already available in minecraft-kit internals _(P2, Low)_
- `REP-08` forgeProcessorHealing.ts mutates InstallPlan.totalBytes without summing all action byte contributions _(P2, Low)_
- `REP-09` emitReadinessStatus in repairWorkflow.ts re-reads disk twice (hasCurrentTargetInstallManifest + isAnythingInstalled) and is called in both cancellation and failure paths but never in success _(P3, Low)_
- `REP-11` repair.ts: progress adapter disposal relies solely on finally — but a thrown error before the finally causes the adapter to be disposed by finally without flushing the last progress event _(P3, Low)_
- `REP-12` manager.ts: cancel() uses a chain of else-if branches instead of a discriminated switch, and LAUNCH op kind is silently ignored _(P2, Low)_
- `REP-17` readinessPolicy.resolveClientInstallPresence and repairWorkflow.emitReadinessStatus duplicate the same two-check (manifest + isAnythingInstalled) offline presence logic _(P2, Low)_
- `REP-24` No tests for repair→bundle-sync post-repair hook (MinecraftManager.finishRepair launchHook path) _(P2, Low)_
- `REP-28` Export `createBundleRepairIssueFilter` from bundleHealing.ts only — remove duplicate inline closure in repairWorkflow.ts _(P3, Low)_
- `LAU-01` getStoredAccount() imported directly into minecraft/routes.ts — cross-service coupling at route layer _(P1, Low)_
- `LAU-04` IPC event channel names for 'minecraft.log' are broadcast unconditionally to all subscribers but only when consoleEnabled — inconsistent gate _(P2, Low)_
- `LAU-06` `getStoredAccount` in auth.ts reads the store directly and is used by the launch path, bypassing the auth service interface _(P2, Low)_
- `LAU-07` No branded type for `YggdrasilSession.profile.uuid` (undashed), so the dashed/undashed invariant is not compile-time enforced _(P2, Low)_
- `LAU-08` cancelSync called from syncForLaunch's external abort handler may fire after the sync has already completed — double-cancel/drop risk _(P2, Low)_
- `LAU-09` Capture and surface process exit code from LaunchExit in crash banner _(P1, Low)_
- `LAU-10` Flush log4j parser buffers on process exit, not only on next session start _(P1, Low)_
- `LAU-11` Remove dead minecraft.log IPC channel — broadcaster.log is never consumed _(P1, Low)_
- `LAU-14` consoleEnabled guard in op map is stale if the user changes console settings mid-run _(P3, Low)_
- `LAU-15` guessLevel heuristic in consoleHub re-applies regex to every line of multi-line log4j events _(P3, Low)_
- `LAU-16` resolveAuthlibInjectorJar in launch.ts re-implements path logic that should come from yggdrasil-client _(P2, Low)_
- `LAU-17` verifyLaunchPreflight in launch.ts walks the entire classpath with sequential fs.access calls — O(N) serial I/O _(P3, Low)_
- `LAU-18` launch.ts verifyLaunchPreflight iterates all classpath entries sequentially with fs.access — O(n) blocking on large classpaths _(P2, Low)_
- `LAU-21` verifyLaunchPreflight in launch.ts walks classpath files sequentially with await in a loop _(P2, Low)_
- `LAU-22` isAnythingInstalled in runtimeState.ts does sequential fs.access in a loop — can short-circuit but not parallelise the 'any' check optimally _(P3, Low)_
- `LAU-23` Context.resolved type is ReturnType<typeof resolveClientSettings> — exposes entire resolved settings instead of only needed fields _(P3, Low)_
- `LAU-24` verifyLaunchPreflight issues N sequential fs.access calls; not abstracted for injection _(P2, Low)_
- `LAU-26` sanitizeHttpAgentToken in launch.ts not directly tested — regex coverage only through integration test _(P3, Low)_
- `LAU-27` Replace `sanitizeHttpAgentToken` + hardcoded user-agent construction in launch.ts with a shared constant _(P3, Low)_
- `LAU-28` Guard `verifyLaunchPreflight` classpath loop against empty-string entries _(P2, Low)_
- `LAU-30` Remove 'Called once at boot…' caller-reference comment above `attachLaunchHook` in MinecraftManager _(P2, Low)_
- `LAU-31` Remove caller-reference comment on `syncForLaunch` in BundleManager _(P2, Low)_
- `LAU-32` Trim comment on `toComposeFailure` in launch.ts — opening clause restates the function _(P2, Low)_
- `LAU-33` Remove 'No pre-launch hash verification…' comment block in `startLaunch` in manager.ts _(P2, Low)_
- `ERR-01` NO_BUNDLE_SLUG error code is defined and mapped in errorCopy.ts but never actually thrown _(P3, Low)_
- `ERR-02` Deduplicate `errorMessage` helper defined in both bundle/errors.ts and minecraft/errors.ts _(P2, Low)_
- `ERR-03` Remove dead `emitErrorEvent` from ManagerEnv — it is never called _(P2, Low)_
- `UI-01` `LoginForm.tsx` merges Yggdrasil and Mojang error state from two different hooks, creating ambiguous error display _(P2, Low)_
- `UI-02` The `useCurrentUser` hook exposes `isPending` but not `isError`, so the renderer cannot distinguish 'loading' from 'auth server unreachable' _(P3, Low)_
- `UI-04` Status-seed concurrency queue is module-level mutable state — leaks across test runs _(P2, Low)_
- `UI-05` BundleEventsListener reads store state inside useEffect with stale getState — pattern bypasses React's subscription guarantees _(P2, Low)_
- `UI-06` progressFormat.ts formatBytes uses Math.log(0) path — formatBytes(0) works by guard but formatBytes for very small numbers (<1) logs negative _(P3, Low)_
- `UI-07` STEP_NUMBER in progressLabels.ts hardcodes step ordinals — diverges when steps array order changes or steps are conditionally excluded _(P2, Low)_
- `UI-08` Magic hex literal #212121 in consoleWindow.ts duplicates mainWindow.ts — should use a shared design token _(P2, Low)_
- `UI-09` BUFFER_LIMIT = 10000 is magic-numbered independently in consoleHub.ts and App.tsx _(P2, Low)_
- `UI-10` useConsoleStream reconcile poll calls getInitial every second regardless of process state _(P2, Low)_
- `UI-11` Highlight component in format.tsx re-runs full character-scan on every keystroke without memoization _(P3, Low)_
- `UI-12` statusSeedQueue and statusSeedRequests are module-level mutable state in hooks.ts _(P3, Low)_
- `UI-13` ConsoleBuffer.trimOverflow only trims main lines array but pending may still reference trimmed lines _(P3, Low)_
- `UI-14` skin.ts uploadSkinMojang uses 'AUTO' cast to `const` — opaque workaround without comment _(P3, Low)_
- `UI-15` consoleHub.ts: `ingest` uses multiple conditional spread expressions — extract to named object builder _(P3, Low)_
- `UI-17` ErrorBoundary logs raw component stack via console.error — stack traces reach renderer console _(P2, Low)_
- `UI-18` Replace rgba(255,255,255,0.10) inline style in ClientOverview settings button with a CSS variable _(P1, Low)_
- `UI-19` Replace rounded-xl and rounded-2xl usages with guideline-compliant radius tokens _(P1, Low)_
- `UI-20` Replace magic pixel font sizes and widths with Tailwind or CSS tokens _(P2, Low)_
- `UI-22` Extract console virtual-list constants CONSOLE_ROW_HEIGHT and OVERSCAN into a shared constants file _(P2, Low)_
- `UI-23` Replace Slider's inline linear-gradient style with a CSS custom-property approach _(P2, Low)_
- `UI-25` Harden ConsoleApp flashFeedback timer: use try/finally to ensure IDLE reset even on timeout error _(P2, Low)_
- `UI-27` Make ConsoleLogBody virtualizer aware of dropped-count banner height to prevent row offset errors _(P2, Low)_
- `UI-28` Eliminate Slider's style attribute rendering on every value change by using a CSS custom property _(P2, Low)_
- `UI-29` Give the SkinViewerCard fixed-size container proper aspect-ratio tokens instead of magic numbers _(P3, Low)_
- `UI-33` MinecraftEventsListener registers offLog for minecraftLog but the handler is a no-op — dead subscription _(P3, Low)_
- `UI-34` BundleEventsListener dependency array is empty but closes over mutable module-level state via useBundleStore.getState() _(P3, Low)_
- `UI-35` Updater auto-check module-level mutable variables (lastAutoCheckAt, userInitiatedCheck, etc.) are not reset on HMR or renderer reload _(P3, Low)_
- `UI-36` Remove JSDoc on `useSkinEditor` in renderer/features/skin/hooks.ts _(P3, Low)_
- `UI-37` Remove comment 'Mount once at app root…' above `UpdaterEventsListener` in updater/events.ts _(P3, Low)_
- `UI-38` Remove what-restating comments in PlayButton.tsx progress card and bundle-error sections _(P3, Low)_
- `UI-39` Remove what-restating comment above the switch `case PlayButtonActions.STATUS_PENDING` in PlayButton.tsx _(P3, Low)_
- `UI-40` Remove comment 'Coalesce progress emissions…' in useConsoleStream.ts — restates what throttle does _(P3, Low)_
- `UI-41` Remove empty-catch comment `/* main may not be ready yet — live updates will catch us up */` in useConsoleStream.ts _(P2, Low)_
- `UI-42` `FolderInfoBlock` component uses magic `1024 ** 3` and `1024 ** 2` numeric literals without named constants _(P3, Low)_
- `UI-43` `LAUNCHER_SETTINGS_STALE_TIME_MS` comment in settings/hooks.ts is an inline caller-reference _(P3, Low)_
- `IPC-04` SLUG_REQUIRED string literal duplicated in three separate route files _(P2, Low)_
- `IPC-07` No route-level tests for settings routes — Zod validation of PatchLauncherSettings and SetClientOverridePayload _(P2, Low)_
- `IPC-08` PatchLauncherSettingsSchema is .strict() but settings routes test does not verify that extra fields are rejected _(P3, Low)_
- `CC-01` patchLauncherSettings is a brittle field-by-field imperative merge requiring updates on every schema change _(P1, Low)_
- `CC-03` updater service registers IPC handlers inside init() but Squirrel event listeners must be removed on dispose — handler leak if init throws partway through _(P2, Low)_
- `CC-04` services with no real lifecycle (app, settings, clients, servers, system, skin, media) have empty async dispose bodies — inconsistency and misleading API _(P3, Low)_
- `CC-05` Comment-guideline violations: several 'what'-restating block comments should be removed _(P3, Low)_
- `CC-06` JSDoc-style block comments on `fetchTextures` and `getYggdrasilClient` in yggdrasilClient.ts violate the no-decorative-comments guideline _(P3, Low)_
- `CC-07` Local assertNever in installManifest.ts duplicates the minecraft-kit export _(P2, Low)_
- `CC-08` Throttled-progress implementation is duplicated between progressAdapter.ts and healProgress.ts _(P2, Low)_
- `CC-09` installManifest.ts re-implements assertNever instead of importing from minecraft-kit or shared _(P3, Low)_
- `CC-10` healProgress.ts HEAL_PROGRESS_THROTTLE_MS magic literal not shared with minecraft-kit progress throttle constant _(P3, Low)_
- `CC-11` errorMessage() is duplicated in both minecraft/errors.ts and bundle/errors.ts _(P3, Low)_
- `CC-12` manager.ts finishRepair is a private method typed with Awaited<ReturnType<typeof buildContext>> instead of the exported Context type _(P3, Low)_
- `CC-13` bundleHealing.ts: opOptions helper conditionally spreads signal and onEvent using ternary chains instead of clean optional-field syntax _(P3, Low)_
- `CC-14` Share `SIDECAR_DIR = '.loontail'` constant duplicated in paths.ts and installManifest.ts _(P2, Low)_
- `CC-16` Context type uses `ReturnType<typeof resolveClientSettings>` instead of the exported `ResolvedClientSettings` type _(P3, Low)_
- `CC-17` assertNever is re-implemented locally in installManifest.ts — import from minecraft-kit instead _(P3, Low)_
- `CC-18` Remove dead emitErrorEvent from ManagerEnv — it is defined but never called _(P1, Low)_
- `CC-19` Replace local assertNever in installManifest.ts with imported assertNever from minecraft-kit _(P2, Low)_
- `CC-20` bundleHealing logger scope 'bundle.heal' conflicts with healer logger scope 'bundle.healer' — confusing log attribution _(P3, Low)_
- `CC-21` BundleManager.resolveClientFolder returns empty string falsy fallback — caller must remember to check _(P3, Low)_
- `CC-22` progressAdapter.ts uses magic number PROGRESS_THROTTLE_MS = 100 without a shared constant _(P3, Low)_
- `CC-23` Extract pending-RAM state pattern into a shared hook useRamPendingState _(P1, Low)_
- `CC-25` Move disk-usage ratio computation out of FolderInfoBlock into a utility function _(P2, Low)_
- `CC-26` Replace FolderInfoBlock's internal formatBytes with a shared utility; deduplicate with LauncherSection formatCacheSize _(P2, Low)_
- `CC-27` Remove void i18n.language subscription side-effect from LanguageSwitcher _(P2, Low)_
- `CC-28` Replace CopyButton's identical size class on both icon variants with a single expression _(P3, Low)_
- `CC-29` Remove implicit magic string 'system','defaultInstallFolder' query key in SetupPage; use QUERY_KEYS constant _(P2, Low)_
- `CC-30` Namespace SetupPage query outside QUERY_KEYS and staleTime:0/gcTime:0 pair should use a named constant _(P3, Low)_
- `CC-31` Remove decorative section-divider comment in useInstallProgress; remove what-restating comments in installSteps.ts _(P3, Low)_
- `CC-32` Move computeServerStatusDisplay logic out of ServersInfo render into a selector function _(P3, Low)_
- `CC-33` cache.ts listNamespaceFiles calls stat() on each file sequentially in a for loop — parallelize with Promise.all _(P2, Low)_
- `CC-34` SIDECAR_DIR constant '.loontail' is duplicated in installManifest.ts and paths.ts _(P2, Low)_
- `CC-35` assertNever re-implemented locally in installManifest.ts; already exported from minecraft-kit _(P2, Low)_
- `CC-36` MINECRAFT_KIT_VERSION read at module load via createRequire; untestable without mocking module resolution _(P2, Low)_
- `CC-38` vitest.config.ts has no coverage configuration — no branch/line coverage gate for CI _(P3, Low)_
- `CC-39` Deduplicate the throttled-progress-emitter pattern shared by progressAdapter.ts and healProgress.ts _(P2, Low)_
- `CC-40` Remove locally re-implemented `assertNever` in installManifest.ts; import from minecraft-kit _(P2, Low)_
- `CC-42` Remove `emitErrorEvent` from `ManagerEnv` – it is never called _(P3, Low)_
- `CC-43` Remove junk comments: section-divider banners and what-restating comments across minecraft service files _(P3, Low)_
- `CC-44` Add `VerifyFileCategories` import guard: the enum is used but not re-exported via a stable path _(P2, Low)_
- `CC-45` Remove JSDoc on `kitLogger` in logger.ts — the adapter pattern is self-documenting _(P3, Low)_
- `CC-46` Remove JSDoc blocks on `enforceSizeBound` and `cachedFetch` in cache.ts _(P2, Low)_
- `CC-47` Replace JSDoc on `AuthMode` type in http.ts with inline per-value comments _(P2, Low)_
- `CC-48` Remove what-restating inline comment on `resolveLoader` in shared/domain/loader.ts _(P3, Low)_
- `CC-49` Reinforce §10 in docs/code-guideline.md with concrete JSDoc ban and 10-second heuristic callout _(P1, Low)_

### 3.2 Medium refactors — require tests first (97)

- `AUTH-01` store.ts runs purgeLegacyAuth() and runMigrations() as module-level side-effects at import time _(P2, Medium)_
- `AUTH-02` yggdrasilClient.ts exports a module-level mutable singleton `cached` — same testability problem as consoleHub _(P2, Medium)_
- `AUTH-07` `skin.ts` calls `getStoredAuth`/`setStoredAuth` directly, bypassing the auth service boundary _(P2, Medium)_
- `AUTH-08` Unsafe `as { context?: { httpStatus?: number } }` cast in `verifyMojangSession` bypasses type safety _(P2, Medium)_
- `AUTH-09` `clearSkin` in skin.ts swallows the Yggdrasil delete error silently, then continues cache invalidation as if deletion succeeded _(P2, Medium)_
- `AUTH-11` `absolutizeTextureUrl` in yggdrasilClient.ts works around a server misconfiguration that belongs in the yggdrasil-client package _(P2, Medium)_
- `AUTH-12` skin.ts calls `client.getTextures` directly at line 185, bypassing the `fetchTextures` absolutisation wrapper _(P2, Medium)_
- `AUTH-15` `MojangProfileSkinSchema` is a hand-rolled mirror of a kit type, creating a drift risk _(P2, Medium)_
- `AUTH-17` Yggdrasil `verifySession` returns `'offline'` on any non-network, non-403 failure from `validate`, hiding server errors _(P2, Medium)_
- `AUTH-18` `uploadSkinYggdrasil` fetches textures twice (before and after upload) without using the `fetchTextures` absolutisation wrapper on the post-upload fetch _(P1, Medium)_
- `AUTH-24` Extract `absolutizeTextureUrl` from yggdrasilClient.ts into yggdrasil-core or yggdrasil-client _(P2, Medium)_
- `DLI-01` forgeProcessorActionsCache is a process-global module-level mutable Map with no eviction _(P1, Medium)_
- `DLI-04` getClient() is called inside BundleManager.tryGetClient() and minecraft/bundleHealing.ts — cross-service coupling through direct function import, not through a passed dependency _(P2, Medium)_
- `DLI-06` Bundle download uses raw Node http/https modules instead of the shared FetchHttpClient from minecraft-kit _(P2, Medium)_
- `DLI-09` Local manifest deserialised with hand-rolled structural check instead of Zod — silent data corruption risk _(P1, Medium)_
- `DLI-11` UP_TO_DATE path persists local manifest with an empty-object remoteManifest _(P1, Medium)_
- `DLI-12` resolveClientFolder returns an empty string on missing settings instead of throwing — defensive guard inconsistently applied _(P1, Medium)_
- `DLI-14` The bundle download layer re-implements HTTP streaming with node:http/https instead of reusing minecraft-kit's FetchHttpClient _(P2, Medium)_
- `DLI-15` downloadEntry does not pipe the response into the write stream atomically — integrity hash is computed from response chunks but writeStream may receive corrupted data on Windows path issues _(P1, Medium)_
- `DLI-16` pauseSync sets task.abort.abort() before task.paused is checked by runDownloadWorker — race window between pause signal and worker exit _(P1, Medium)_
- `DLI-17` getInstallState makes a network request on every call — UI query may flood the manifest endpoint _(P2, Medium)_
- `DLI-18` buildPlan makes sequential disk I/O (exists + hashFile) in a for loop — O(n) sequential awaits for large manifests _(P2, Medium)_
- `DLI-19` saveLocalManifest rename is not atomic on Windows when target already exists — intermediate state visible to concurrent readers _(P1, Medium)_
- `DLI-23` BundleSyncingOp abort not wired into BUNDLE_SYNCING cancelAll path _(P2, Medium)_
- `DLI-24` download.ts implements its own HTTP client (http/https.request, redirect following, timeout) duplicating minecraft-kit's FetchHttpClient capability _(P2, Medium)_
- `DLI-26` runSyncPhases in bundle/runner.ts drains pendingDownloads queue in a mutable imperative loop with no structured concurrency; firstError swallowing hides multiple concurrent failures _(P2, Medium)_
- `DLI-34` BundleManager.resolveClientFolder should not call getSettings() on every invocation — settings should be injected _(P2, Medium)_
- `DLI-35` BundleManager.startInstall post-install bundle sync: lock.release() called in both .then() and .finally() — double release risk _(P1, Medium)_
- `DLI-40` BundleManager.tryGetClient silently returns null for any error — masks UNKNOWN failures _(P2, Medium)_
- `DLI-42` startInstall acquires the write lock but does not hold it across the beginInstall op.set — race window _(P2, Medium)_
- `DLI-43` resumeSync silently spawns a fresh sync when no active sync is found — no error surfaced to caller _(P2, Medium)_
- `DLI-45` Split PlayButton multi-case render into focused sub-components _(P1, Medium)_
- `DLI-50` BundleManager.runSync has a TOCTOU gap between activeSyncs.has() check and activeSyncs.set() _(P1, Medium)_
- `DLI-53` getInstallState in BundleManager fetches remote manifest on every call, blocking the UI on network _(P1, Medium)_
- `DLI-54` SyncTask mutable plain-object state shared across async worker functions is not protected against mid-run plan reassignment _(P2, Medium)_
- `DLI-56` persistLocalManifest in BundleManager: saveLocalManifest failure after a successful sync swallows the error but does NOT preserve the installed status already emitted _(P1, Medium)_
- `DLI-57` startInstall fire-and-forget void chain doesn't acquire the lock before the background operation completes _(P1, Medium)_
- `DLI-61` LocalManifest validation in manifestRepo.ts uses manual typeof checks instead of a Zod schema _(P1, Medium)_
- `DLI-64` No workflow/integration tests for full install→launch pipeline (MinecraftManager.startInstall followed by startLaunch) _(P2, Medium)_
- `DLI-68` Stop shadowing `ProgressStages` from minecraft-kit with a local `ProgressStages` enum in shared/contracts _(P2, Medium)_
- `DLI-69` Add `try/finally` to `persistLocalManifest` in BundleManager to ensure `dropActiveSync` is not skipped on error _(P1, Medium)_
- `DLI-71` Replace `createRequire` + `requirePackage('@loontail/minecraft-kit/package.json')` with a compile-time constant _(P3, Medium)_
- `DLI-74` Model `BundleManager.activeLocks` entries as part of `ActiveSync` to prevent map-key desync _(P2, Medium)_
- `DLI-80` BundleManager lacks `dispose` path for `pauseIdleTimer` — timer may keep process alive on app shutdown _(P1, Medium)_
- `DLI-81` MinecraftManager.startInstall double-releases lock when `runInstall` chain has both `.then(lock.release)` and `.finally(lock.release)` _(P1, Medium)_
- `DLI-82` BundleManager `activeLocks` map entry may leak if `acquireWriteLock` throws after `createActiveSync` adds to `activeSyncs` _(P1, Medium)_
- `REP-01` MinecraftManager.cancel does not handle OpKinds.UNINSTALL — cancel on uninstall is silently ignored _(P2, Medium)_
- `REP-03` runDeletePhase does not count ENOENT files in deletedAny — post-delete heal may be skipped when files were externally removed _(P2, Medium)_
- `REP-04` Module-level forgeProcessorActionsCache is never cleared on uninstall or client-folder change _(P1, Medium)_
- `REP-06` bundleHealing.verifyAndRepairExceptBundle calls buildContext() which resolves the target via Strapi — unnecessary inside a heal pass that already has a target _(P1, Medium)_
- `REP-10` bundleHealing.verifyAndRepairExceptBundle: wrong-layer import — minecraft service imports minecraft context from its own module to serve bundle service _(P1, Medium)_
- `REP-13` manager.ts: startRepair does not emit REPAIRING status until after ops.set, allowing a race where getStatus() reads the old (absent) op between requireIdle and ops.set _(P2, Medium)_
- `REP-14` bundleHealing.verifyAndRepairExceptBundle passes ctx.target from a freshly-resolved buildContext but the bundle runner already has a different (potentially stale) target resolution path _(P2, Medium)_
- `REP-15` BundleManager.cancelAll uses a grace setTimeout for finally-block teardown but does not await the active syncs' own promises _(P2, Medium)_
- `REP-16` progressAdapter.ts: AspectTaggedProgressEvent uses a type cast (event as AspectTaggedProgressEvent) to read an undocumented optional .aspect field not part of the public ProgressEvent type _(P2, Medium)_
- `REP-18` bundleHealing.verifyAndRepairExceptBundle calls buildContext internally — unnecessary second target resolution _(P1, Medium)_
- `REP-19` forgeProcessorActionsCache is a module-level mutable singleton — hidden shared state, not disposed on uninstall _(P2, Medium)_
- `REP-20` bundleHealing.verifyAndRepairExceptBundle calls buildContext — network/settings side-effect in heal path _(P1, Medium)_
- `REP-21` forgeProcessorActionsCache is a module-level mutable Map — untestable global state _(P2, Medium)_
- `REP-22` bundleHealing.ts calls buildContext() directly, tying the bundle-heal seam to the full Minecraft context build _(P1, Medium)_
- `REP-23` forgeProcessorActionsCache is a module-level singleton that leaks between test runs _(P1, Medium)_
- `REP-25` Replace hand-rolled SHA-1 file hasher in forgeProcessorHealing.ts with kit's verify infrastructure _(P1, Medium)_
- `REP-27` Fix module-level `forgeProcessorActionsCache` singleton in forgeProcessorHealing.ts: it survives across test runs and between kit re-initialisations _(P2, Medium)_
- `REP-29` `forgeProcessorActionsCache` is a module-level Map with no eviction — grows unbounded across repairs _(P2, Medium)_
- `REP-30` `verifyAndRepairExceptBundle` in bundleHealing.ts calls `buildContext` internally, bypassing the caller's context _(P2, Medium)_
- `LAU-02` consoleHub singleton imported as a module-level side-effect inside minecraft/launch.ts — breaks DI model _(P1, Medium)_
- `LAU-03` ConsoleHub is a module-level class instance singleton — untestable and violates DI conventions used elsewhere _(P2, Medium)_
- `LAU-05` consoleHub.flushPending() in ConsoleService.dispose sends lines to the window after router.dispose() has removed the console handlers _(P2, Medium)_
- `LAU-12` runLaunch re-throws non-preflight errors after already emitting error state — double-handling at IPC boundary _(P2, Medium)_
- `LAU-13` verifyLaunchPreflight calls resolveLaunchVersion redundantly — compose already resolved it _(P2, Medium)_
- `LAU-19` classifyError(error) called without signal in launch.ts endLaunch — aborted launches mis-classified _(P1, Medium)_
- `LAU-20` consoleHub module-level singleton prevents testability and multiple window support _(P2, Medium)_
- `LAU-25` No test covers the cancel(slug) code path for BUNDLE_SYNCING and LAUNCH_STARTING OpKinds _(P2, Medium)_
- `LAU-29` Fix `runLaunch` op-map leak when `startupSignal.aborted` fires after `env.ops.set(slug, startupOp)` but before the finally block checks _(P1, Medium)_
- `PRF-01` TargetInstallManifestSchema.targetId used for match but match also uses kitVersion — version bump invalidates all existing manifests silently _(P2, Medium)_
- `PRF-02` No test for resolveClientInstallPresence returning UNVERIFIED (files present but no manifest) _(P2, Medium)_
- `ERR-04` Expand KIT_CODE_TO_LAUNCHER_CODE to cover all classifiable kit error codes _(P1, Medium)_
- `ERR-05` toIpcError maps all MinecraftKitErrors to IpcHandlerFailed — hides classified launcher codes _(P1, Medium)_
- `ERR-06` Fix LauncherSection handleClearCache: cache invalidation runs even when clearMediaCache fails, but QueryClient.removeQueries runs unconditionally before the IPC call succeeds _(P1, Medium)_
- `UI-03` isBundleBusy duplicated between store.ts and installSteps.ts — divergence risk _(P1, Medium)_
- `UI-16` SkinError uses shared ERROR_CODES while bundle/minecraft errors use domain-local codes — inconsistent placement _(P2, Medium)_
- `UI-21` Give Switch component proper interactive role or remove aria-hidden, align with SettingsSwitchRow usage contract _(P1, Medium)_
- `UI-24` Validate PNG client-side before upload to avoid a round-trip IPC failure _(P2, Medium)_
- `UI-26` The Modal component leaks body overflow state if isOpen changes from true to false before cleanup runs _(P1, Medium)_
- `UI-31` Address useSkinEditor saveAll: concurrent skin+cape save can partially succeed with no rollback or per-item error _(P1, Medium)_
- `UI-32` queryPersister uses synchronous localStorage serialisation for the entire TanStack Query cache _(P2, Medium)_
- `IPC-01` Router passes rawArgs to handlers without guaranteed Zod validation _(P0, Medium)_
- `IPC-02` CONSOLE_CHANNEL_PREFIX check in trustedSender.ts uses string prefix comparison — new console.* channels require no code change but are implicitly trusted to the console window _(P2, Medium)_
- `IPC-03` bundleCheckStatus IPC handler makes a network call in the handler body — violates 'thin routes' guideline _(P2, Medium)_
- `IPC-05` IpcError.code is typed as string in shared/ipc/errors.ts — no compile-time narrowing from codes registry _(P2, Medium)_
- `IPC-06` No route-level tests for minecraft/bundle IPC routes (Zod validation and error mapping) _(P1, Medium)_
- `IPC-09` IpcContract type is not pinned by a compile-time test — channels can be added without corresponding route registration _(P2, Medium)_
- `CC-02` shared/contracts/settings.ts imports a runtime type from @loontail/minecraft-kit — risks renderer bundle bloat _(P1, Medium)_
- `CC-15` store.ts runs module-level side effects (runMigrations, purgeLegacyAuth) at import time — untestable and order-dependent _(P1, Medium)_
- `CC-24` Move inline business logic out of ClientSettingsModal async handlers into the hooks layer _(P1, Medium)_
- `CC-37` buildContext() calls persistClientOverride() as a side-effect during context construction _(P2, Medium)_
- `CC-41` Replace infra/cache.ts `cachedFetch` with minecraft-kit's `createPersistentMetadataCache` _(P2, Medium)_

### 3.3 Large architectural changes — handle carefully (7)

- `DLI-03` BundleManager.activeLocks map is not cleaned up when sync pauses mid-flight — lock held indefinitely on long pauses _(P1, High)_
- `DLI-08` Lock release not guarded by try/finally in executePreparedSync — lock leaks on continuePausedSync throw _(P0, High)_
- `DLI-62` BundleManager.executePreparedSync does not call finally{dropActiveSync} when paused mid-heal _(P1, High)_
- `DLI-63` MinecraftManager.startInstall calls lock.release() twice on success — double-release of operation lease _(P1, High)_
- `REP-26` Extract Forge processor output verification into minecraft-kit as a supported repair sub-plan _(P1, High)_
- `ERR-07` MIGRATIONS object is empty while CURRENT_SCHEMA_VERSION = 1; any version-0 store file will crash module load _(P1, High)_
- `UI-30` Address missing error boundary around SkinViewer WebGL context failure _(P1, High)_

### 3.4 Likely extraction INTO minecraft-kit / replace with its existing API (13)

- `AUTH-15` `MojangProfileSkinSchema` is a hand-rolled mirror of a kit type, creating a drift risk _(P2, Medium)_
- `DLI-06` Bundle download uses raw Node http/https modules instead of the shared FetchHttpClient from minecraft-kit _(P2, Medium)_
- `DLI-07` installManifest.ts duplicates package.json version reading via createRequire — fragile and not covered by kit's version tracking _(P3, Low)_
- `DLI-14` The bundle download layer re-implements HTTP streaming with node:http/https instead of reusing minecraft-kit's FetchHttpClient _(P2, Medium)_
- `DLI-16` pauseSync sets task.abort.abort() before task.paused is checked by runDownloadWorker — race window between pause signal and worker exit _(P1, Medium)_
- `DLI-17` getInstallState makes a network request on every call — UI query may flood the manifest endpoint _(P2, Medium)_
- `DLI-24` download.ts implements its own HTTP client (http/https.request, redirect following, timeout) duplicating minecraft-kit's FetchHttpClient capability _(P2, Medium)_
- `REP-07` forgeProcessorHealing.ts re-implements SHA-1 file hashing with a streaming Promise wrapper already available in minecraft-kit internals _(P2, Low)_
- `REP-16` progressAdapter.ts: AspectTaggedProgressEvent uses a type cast (event as AspectTaggedProgressEvent) to read an undocumented optional .aspect field not part of the public ProgressEvent type _(P2, Medium)_
- `REP-25` Replace hand-rolled SHA-1 file hasher in forgeProcessorHealing.ts with kit's verify infrastructure _(P1, Medium)_
- `REP-26` Extract Forge processor output verification into minecraft-kit as a supported repair sub-plan _(P1, High)_
- `CC-17` assertNever is re-implemented locally in installManifest.ts — import from minecraft-kit instead _(P3, Low)_
- `CC-41` Replace infra/cache.ts `cachedFetch` with minecraft-kit's `createPersistentMetadataCache` _(P2, Medium)_

### 3.5 Likely extraction INTO loontail-yggdrasil / replace with its existing API (6)

- `AUTH-11` `absolutizeTextureUrl` in yggdrasilClient.ts works around a server misconfiguration that belongs in the yggdrasil-client package _(P2, Medium)_
- `AUTH-24` Extract `absolutizeTextureUrl` from yggdrasilClient.ts into yggdrasil-core or yggdrasil-client _(P2, Medium)_
- `AUTH-25` Replace `YGGDRASIL_PLACEHOLDER_CLIENT_ID` zero-GUID with a branded constant exported from yggdrasil-client _(P3, Low)_
- `LAU-07` No branded type for `YggdrasilSession.profile.uuid` (undashed), so the dashed/undashed invariant is not compile-time enforced _(P2, Low)_
- `LAU-16` resolveAuthlibInjectorJar in launch.ts re-implements path logic that should come from yggdrasil-client _(P2, Low)_
- `UI-24` Validate PNG client-side before upload to avoid a round-trip IPC failure _(P2, Medium)_

### 3.6 Replace duplication with existing/shared functions (42)

- `AUTH-03` MojangProfileSkinSchema in shared/contracts/auth.ts duplicates the kit's MojangProfileSkin type — comment acknowledges this but the duplication is never verified _(P3, Low)_
- `AUTH-11` `absolutizeTextureUrl` in yggdrasilClient.ts works around a server misconfiguration that belongs in the yggdrasil-client package _(P2, Medium)_
- `AUTH-15` `MojangProfileSkinSchema` is a hand-rolled mirror of a kit type, creating a drift risk _(P2, Medium)_
- `AUTH-16` `validatePngBuffer` called with `payload.type` which is typed as `SkinKind` ('skin'|'cape'), but yggdrasil-core's signature may expect a different enum — the coupling is implicit _(P2, Low)_
- `AUTH-24` Extract `absolutizeTextureUrl` from yggdrasilClient.ts into yggdrasil-core or yggdrasil-client _(P2, Medium)_
- `AUTH-25` Replace `YGGDRASIL_PLACEHOLDER_CLIENT_ID` zero-GUID with a branded constant exported from yggdrasil-client _(P3, Low)_
- `DLI-03` BundleManager.activeLocks map is not cleaned up when sync pauses mid-flight — lock held indefinitely on long pauses _(P1, High)_
- `DLI-06` Bundle download uses raw Node http/https modules instead of the shared FetchHttpClient from minecraft-kit _(P2, Medium)_
- `DLI-07` installManifest.ts duplicates package.json version reading via createRequire — fragile and not covered by kit's version tracking _(P3, Low)_
- `DLI-14` The bundle download layer re-implements HTTP streaming with node:http/https instead of reusing minecraft-kit's FetchHttpClient _(P2, Medium)_
- `DLI-21` De-duplicate persistTargetInstallManifest — lives in both install.ts and repairWorkflow.ts _(P2, Low)_
- `DLI-24` download.ts implements its own HTTP client (http/https.request, redirect following, timeout) duplicating minecraft-kit's FetchHttpClient capability _(P2, Medium)_
- `DLI-28` Deduplicate `persistTargetInstallManifest` copied between install.ts and repairWorkflow.ts _(P1, Low)_
- `DLI-39` Fix double lock.release() in startInstall success path _(P1, Low)_
- `DLI-46` Double lock.release() in startInstall causes double-release of ClientOperationLease _(P0, Low)_
- `DLI-51` pauseSync does not guard against pausing an already-paused sync, armPauseIdleTimer can be called twice _(P2, Low)_
- `DLI-59` plan.ts flattenEntries duplicates logic already present in manifestSnapshot.ts flattenRemote _(P2, Low)_
- `DLI-60` runSyncPhases post-pause check is duplicated with redundant early-return pattern _(P3, Low)_
- `DLI-68` Stop shadowing `ProgressStages` from minecraft-kit with a local `ProgressStages` enum in shared/contracts _(P2, Medium)_
- `DLI-70` Eliminate `persistTargetInstallManifest` duplication between install.ts and repairWorkflow.ts _(P2, Low)_
- `REP-05` persistTargetInstallManifest is duplicated between install.ts and repairWorkflow.ts _(P2, Low)_
- `REP-07` forgeProcessorHealing.ts re-implements SHA-1 file hashing with a streaming Promise wrapper already available in minecraft-kit internals _(P2, Low)_
- `REP-25` Replace hand-rolled SHA-1 file hasher in forgeProcessorHealing.ts with kit's verify infrastructure _(P1, Medium)_
- `REP-26` Extract Forge processor output verification into minecraft-kit as a supported repair sub-plan _(P1, High)_
- `REP-28` Export `createBundleRepairIssueFilter` from bundleHealing.ts only — remove duplicate inline closure in repairWorkflow.ts _(P3, Low)_
- `LAU-16` resolveAuthlibInjectorJar in launch.ts re-implements path logic that should come from yggdrasil-client _(P2, Low)_
- `ERR-02` Deduplicate `errorMessage` helper defined in both bundle/errors.ts and minecraft/errors.ts _(P2, Low)_
- `UI-03` isBundleBusy duplicated between store.ts and installSteps.ts — divergence risk _(P1, Medium)_
- `UI-13` ConsoleBuffer.trimOverflow only trims main lines array but pending may still reference trimmed lines _(P3, Low)_
- `IPC-04` SLUG_REQUIRED string literal duplicated in three separate route files _(P2, Low)_
- `CC-07` Local assertNever in installManifest.ts duplicates the minecraft-kit export _(P2, Low)_
- `CC-08` Throttled-progress implementation is duplicated between progressAdapter.ts and healProgress.ts _(P2, Low)_
- `CC-09` installManifest.ts re-implements assertNever instead of importing from minecraft-kit or shared _(P3, Low)_
- `CC-10` healProgress.ts HEAL_PROGRESS_THROTTLE_MS magic literal not shared with minecraft-kit progress throttle constant _(P3, Low)_
- `CC-11` errorMessage() is duplicated in both minecraft/errors.ts and bundle/errors.ts _(P3, Low)_
- `CC-17` assertNever is re-implemented locally in installManifest.ts — import from minecraft-kit instead _(P3, Low)_
- `CC-19` Replace local assertNever in installManifest.ts with imported assertNever from minecraft-kit _(P2, Low)_
- `CC-23` Extract pending-RAM state pattern into a shared hook useRamPendingState _(P1, Low)_
- `CC-28` Replace CopyButton's identical size class on both icon variants with a single expression _(P3, Low)_
- `CC-35` assertNever re-implemented locally in installManifest.ts; already exported from minecraft-kit _(P2, Low)_
- `CC-40` Remove locally re-implemented `assertNever` in installManifest.ts; import from minecraft-kit _(P2, Low)_
- `CC-41` Replace infra/cache.ts `cachedFetch` with minecraft-kit's `createPersistentMetadataCache` _(P2, Medium)_

### 3.7 Documentation updates (31)

- `AUTH-26` Remove JSDoc block on `withRefreshedProfile` in mojangAuth.ts — what-restating docstring _(P2, Low)_
- `AUTH-27` Remove JSDoc blocks on `signInWithMojang`, `cancelMojangLogin`, `verifyMojangSession` inside `createMojangAuth` closure _(P2, Low)_
- `AUTH-28` Collapse JSDoc on `getYggdrasilClient` to a single why-comment or remove entirely _(P3, Low)_
- `AUTH-29` Remove JSDoc on `fetchTextures` in yggdrasilClient.ts — wraps description of its name _(P3, Low)_
- `AUTH-30` Remove JSDoc on `enrichYggdrasilAccount` in verify.ts — bulk of it is what-restating _(P2, Low)_
- `AUTH-31` Remove verifySession block-comment in verify.ts — partially a caller-reference _(P2, Low)_
- `DLI-75` Remove per-field label comments in `DownloadOptions` type and `SyncTask` type _(P2, Low)_
- `DLI-76` Remove step-narrating comment at manager.ts line 124 that paraphrases install sequence _(P2, Low)_
- `DLI-77` Remove comment 'Called on app shutdown…' above `cancelAll` and 'Called by MinecraftManager…' above `resetForUninstall` in BundleManager _(P2, Low)_
- `DLI-78` Remove 'Plan + tracker + run' style narrating comment in install.ts _(P3, Low)_
- `DLI-79` Remove step-narrating comments in `startInstall` `void runInstall().then()` chain in manager.ts _(P2, Low)_
- `LAU-30` Remove 'Called once at boot…' caller-reference comment above `attachLaunchHook` in MinecraftManager _(P2, Low)_
- `LAU-31` Remove caller-reference comment on `syncForLaunch` in BundleManager _(P2, Low)_
- `LAU-32` Trim comment on `toComposeFailure` in launch.ts — opening clause restates the function _(P2, Low)_
- `LAU-33` Remove 'No pre-launch hash verification…' comment block in `startLaunch` in manager.ts _(P2, Low)_
- `UI-36` Remove JSDoc on `useSkinEditor` in renderer/features/skin/hooks.ts _(P3, Low)_
- `UI-37` Remove comment 'Mount once at app root…' above `UpdaterEventsListener` in updater/events.ts _(P3, Low)_
- `UI-38` Remove what-restating comments in PlayButton.tsx progress card and bundle-error sections _(P3, Low)_
- `UI-39` Remove what-restating comment above the switch `case PlayButtonActions.STATUS_PENDING` in PlayButton.tsx _(P3, Low)_
- `UI-40` Remove comment 'Coalesce progress emissions…' in useConsoleStream.ts — restates what throttle does _(P3, Low)_
- `UI-41` Remove empty-catch comment `/* main may not be ready yet — live updates will catch us up */` in useConsoleStream.ts _(P2, Low)_
- `UI-43` `LAUNCHER_SETTINGS_STALE_TIME_MS` comment in settings/hooks.ts is an inline caller-reference _(P3, Low)_
- `CC-05` Comment-guideline violations: several 'what'-restating block comments should be removed _(P3, Low)_
- `CC-06` JSDoc-style block comments on `fetchTextures` and `getYggdrasilClient` in yggdrasilClient.ts violate the no-decorative-comments guideline _(P3, Low)_
- `CC-31` Remove decorative section-divider comment in useInstallProgress; remove what-restating comments in installSteps.ts _(P3, Low)_
- `CC-43` Remove junk comments: section-divider banners and what-restating comments across minecraft service files _(P3, Low)_
- `CC-45` Remove JSDoc on `kitLogger` in logger.ts — the adapter pattern is self-documenting _(P3, Low)_
- `CC-46` Remove JSDoc blocks on `enforceSizeBound` and `cachedFetch` in cache.ts _(P2, Low)_
- `CC-47` Replace JSDoc on `AuthMode` type in http.ts with inline per-value comments _(P2, Low)_
- `CC-48` Remove what-restating inline comment on `resolveLoader` in shared/domain/loader.ts _(P3, Low)_
- `CC-49` Reinforce §10 in docs/code-guideline.md with concrete JSDoc ban and 10-second heuristic callout _(P1, Low)_

### 3.8 P0 — do first (3)

- `DLI-08` Lock release not guarded by try/finally in executePreparedSync — lock leaks on continuePausedSync throw _(P0, High)_
- `DLI-46` Double lock.release() in startInstall causes double-release of ClientOperationLease _(P0, Low)_
- `IPC-01` Router passes rawArgs to handlers without guaranteed Zod validation _(P0, Medium)_

### 3.9 Comment-pollution hotspots (files to clean per guideline §10)

- src/main/services/bundle/manager.ts — many inline comments explain complex pause/cancel/awaiter state machine that could instead be replaced with explicit state types; several comments restate what the code does rather than why
- src/main/services/minecraft/launch.ts — dense comment blocks around abort-signal checks and auth-mode dispatch; the YGGDRASIL_PLACEHOLDER_CLIENT_ID comment is a genuine invariant (keep), but the multi-line resolveLaunchAuth switch could be expressed more clearly with named discriminated returns
- src/main/infra/store.ts — extensive comments documenting migration strategy and legacy purge; several per-block 'what' comments (e.g. 'Apply the migration steps...') that restate the function name
- src/main/services/auth/verify.ts — lines 37-42 restate what the function returns (already expressed by TypeScript signature)
- src/main/services/auth/auth.ts — lines 47-52 prose-describes getStoredAccount behaviour visible in three lines of code
- src/main/services/auth/routes.ts — lines 17-21 describe mojangFailureCode logic that the code expresses directly
- src/main/services/auth/yggdrasilClient.ts — JSDoc blocks on getYggdrasilClient (lines 6-18) and fetchTextures (lines 32-34) are 'what'-restating; only the absoluteUrl server-quirk note is a genuine 'why'
- src/main/services/auth/mojangAuth.ts — lines 43-45 ('Project the kit's nested session…') restate what fromKitSession does; the comment about no second profile call is a genuine 'why' but should be one sentence, not three lines
- src/main/services/bundle/manager.ts — comment-heavy: lines 93-95 (syncForLaunch doc), 148-152 (cancel socket-destroy explanation) and 409-411 (unref explanation) are legitimate 'why' comments; however lines 460-462 (_internals export comment) adds no information beyond what the code says
- src/main/services/bundle/download.ts — lines 59-61 (LL-106 race comment) and 179-180 (Windows antivirus comment) are necessary; line 195-197 (Windows rename comment) is necessary; no section-divider banners detected
- src/main/services/bundle/runner.ts — lines 56-57 (throttle explanation) is a 'why' comment; line 140-141 (cleanEmptyDirs description) and 142 (client-root preservation) are necessary; line 189-190 (ENOENT already-gone comment) is a useful invariant note
- src/main/services/bundle/plan.ts — line 88-90 (no sha256 strategy explanation) is a legitimate 'why'; line 120 (disk-hash fast path label) restates what the code already shows — candidate for removal
- src/main/services/minecraft/launch.ts — 7 block comments in a 383-line file; several are section-divider banners describing what the code does rather than why (e.g. lines 61-68 restating the compose → preflight flow in prose that duplicates the code structure); the YGGDRASIL_PLACEHOLDER_CLIENT_ID comment at line 41 is a genuine 'why' and should be kept; lines 54-59 RUNTIME_REPAIR_KIT_CODES comment restates the set members rather than explaining the architectural decision
- src/main/services/minecraft/manager.ts — comments at lines 49, 86-87, 106-112, 234-238 are mostly what-restatements; the bundle-sync comment at line 49 and cancelAll comment at line 272 carry genuine 'why' rationale and should be kept; the rest describe the obvious flow
- src/main/services/minecraft/readinessPolicy.ts — the 12-line block comment at lines 10-18 is documentation-level prose about design decisions; it exceeds the 'why for non-obvious invariants' bar set by the guideline, but the trade-off decision it documents (defer target resolve to Play) is genuinely non-obvious; borderline acceptable but could be trimmed to 3-4 lines
- src/main/services/minecraft/forgeProcessorHealing.ts — dense legitimate why-comments are correct; the file is at the boundary of documented vs undocumented kit behaviour and comments are warranted. No meaningless pollution found.
- src/main/services/minecraft/bundleHealing.ts — comment on line 16 ('them as wrong-sha1') is a fragment dangling from an incomplete sentence (the HealOutcome field doc). Minor: rewrite to a complete sentence.
- src/main/services/minecraft/progressAdapter.ts — AspectTaggedProgressEvent block (lines 36-39) has no comment explaining why the aspect field is not in the public type. A why-comment is needed here per §10.
- src/main/services/bundle/runner.ts — the drain-queue comment on line 122 ('Drain queue so other workers exit promptly') is a legitimate why-comment. Clean.
- src/main/services/minecraft/manager.ts — inline comment on lines 132-135 (emit INSTALLED before bundle phase) is a legitimate invariant note. Clean.
- src/main/services/bundle/manager.ts — lines 92-109, 439-457: JSDoc-style block comments above public methods describe what (not why); the 'Called by MinecraftManager.startLaunch after the install step' comment at L94-96 and 'Called on app shutdown...' at L439-442 are meaningful architectural invariants and should be kept, but 'Called once at boot (after createBundleService)' in manager.ts L85-87 and 'Plan helpers — exported only for tests' at L460 lean toward what-stating
- src/main/services/minecraft/launch.ts — the file has several multi-line block comments that describe intended behaviour rather than non-obvious invariants; L64-76 (toComposeFailure rationale) and L178-182 (auth mode description) are genuinely non-obvious and should stay; L337-348 (trailing .catch guards) is borderline what-comment
- src/main/services/minecraft/repairWorkflow.ts — lines 107-114 (ensureLaunchable preamble) and L152-160 (focusedActions intent) contain valuable non-obvious invariants; L49-52 (emitReadinessStatus: 'Cheap presence check') is acceptable; L118-122 (last-resort bootstrap) is a genuine workaround comment worth keeping
- src/main/services/minecraft/manager.ts — startInstall has a multi-line block comment (lines 85-88) that is borderline explanatory but partly restates what the code does; the comment on lock.release() usage around lines 126-150 would no longer be needed after the double-release fix
- src/main/ipc/toIpcError.ts — the block comment lines 38-42 is good 'why' commentary but could be trimmed; the isIpcErrorShape check is an internal helper whose name closely restates what it does
- src/main/services/minecraft/bundleHealing.ts — lines 36-40 (opOptions helper) has a comment that largely restates the code; could be deleted per guideline §10
- src/main/services/bundle/manager.ts — lines 439-442 (cancelAll comment block) is a borderline 'what' comment describing the method body rather than a hidden invariant; the core reason (cooperative abort doesn't stop sockets) is the only sentence worth keeping
- src/renderer/features/clients/components/install/useInstallProgress.ts — JSDoc block (lines 16-19) restates the hook name and the loader derivation formula; only the derivation note is a genuine why.
- src/renderer/features/clients/components/install/installSteps.ts — multiple inline comments (lines 63-64, 88-91, 158-169) partially restate the logic immediately below them; only the 'stageBytes mixed-scale' comment (lines 144-148) and 'finalize fold' invariant are genuine why-comments worth keeping.
- src/renderer/console/hooks/useConsoleStream.ts — lines 94-95, 119-122, 161-163 contain section-prose comments that explain what the code clearly shows (e.g., 'Coalesce inbound push batches so a burst of stdout becomes one setLines' above a function named flushPending that does exactly that). The queueMicrotask comment (lines 121-122) IS a legitimate why (RAF paused for occluded windows) and must be kept.
- src/renderer/shared/ui/Toast/ToastItem.tsx — lines 76-78 ('Auto-close with hover-pause: remainingRef carries the leftover budget...') partially restate what the code shows. The 'Actionable toasts never auto-close' clause IS non-obvious and should stay.
- src/main/services/bundle/runner.ts — comment at line 56 ('Coalesce progress emissions...') restates what the constant name already says; the comment at line 141 ('Walk parent dirs upward...') is useful but could be tightened
- src/main/services/bundle/manager.ts — comment at line 95 ('Called by MinecraftManager.startLaunch after the install step') is a what-comment duplicating the method's call site, not a why-comment
- src/main/services/minecraft/launch.ts — comment block at line 43 explaining YGGDRASIL_PLACEHOLDER_CLIENT_ID is legitimately a 'why' comment and should be kept; comment at line 62 ('Kit error codes that point at...') restates the set name
- src/main/services/bundle/download.ts — comment at line 111 ('Stream the response into...') is a what-comment; the LL-106 invariant comment at line 59 is a legitimate 'why' and should be kept
- src/main/services/minecraft/manager.ts — comment on line 86 ('Replacing a non-null hook is allowed and only happens in tests') leaks test-coupling rationale into production code; guideline §10 requires deleting implementation-strategy comments that restate what the code does
- src/main/services/minecraft/launch.ts — lines 44-47 (YGGDRASIL_PLACEHOLDER_CLIENT_ID and YGGDRASIL_HTTP_AGENT_NAME) have legitimate 'why' comments for platform quirks (Cloudflare blocks bare Java UA, zero-GUID shape requirement); these are KEEPER comments per guideline §10
- src/main/services/bundle/manager.ts — lines 49-50 LaunchHook JSDoc block ('Optional hook the bundle service installs at boot; awaited after the implicit install step') is a what-restating comment; the type alias name LaunchHook already conveys intent; remove per guideline §10
- src/main/services/bundle/download.ts — line 59 ('Register the settle/cleanup listeners before the abort check. If the signal is already aborted on entry…LL-106') is a genuine race-abort invariant comment; KEEPER per guideline §10
- src/main/services/minecraft/repairWorkflow.ts — lines 48-52 (emitReadinessStatus comment 'Cheap presence check mirroring the status seed') restates what the code does; delete per guideline §10
- src/main/services/minecraft/progressAdapter.ts — the throttle logic and stage-mapping switch blocks are uncommented; the non-obvious `aspect`-tagged event workaround (line 36-38, 104-107) is the only place that deserves a comment but lacks one
- src/main/services/minecraft/launch.ts — lines 44-47 carry two legitimate 'why' comments (zero-GUID placeholder, Cloudflare UA block) but lines 78-84 have no comment explaining the RFC token-char sanitizer regex, and line 86-95 `resolveAuthlibInjectorJar` is uncommented despite the `app.isPackaged` branching being a non-obvious Electron packaging quirk
- src/main/services/minecraft/installManifest.ts — lines 48-50 define a local `assertNever` with no comment explaining why it is not imported from the kit; the comment on line 149 referencing `kitVersion` comparison is missing
- src/main/services/bundle/download.ts — lines 56-62 contain a correct and necessary race-condition comment (keep); lines 113-115 and 196-199 contain what-restating labels ('Atomic swap', 'Defensive: stale tmp') that partially qualify as non-obvious but could be tightened
- src/main/services/auth/mojangAuth.ts — three JSDoc blocks inside a closure (signInWithMojang, cancelMojangLogin, verifyMojangSession) plus one on the exported withRefreshedProfile; worst offender for §10 JSDoc violations
- src/main/infra/cache.ts — two JSDoc blocks (enforceSizeBound, cachedFetch) that describe what the functions do; lines 105-152
- src/main/services/auth/yggdrasilClient.ts — two JSDoc blocks on a six-line file; getYggdrasilClient and fetchTextures
- src/main/services/minecraft/manager.ts — multiple what-narrating and caller-reference inline comments scattered through startInstall and startLaunch; lines 85-240
- src/main/services/bundle/manager.ts — two caller-reference comments ('Called by…') plus what-narrating comments in cancelAll and syncForLaunch; lines 92-453
- src/main/infra/http.ts — 14-line JSDoc block on a two-member string union type (AuthMode); lines 8-22
- src/renderer/features/updater/events.ts — what-narrating component-mount comments above UpdaterEventsListener and UpdaterAutoCheck; lines 103-121
- src/renderer/features/skin/hooks.ts — JSDoc block on useSkinEditor hook that restates its return shape; lines 45-50

## 4. Status convention

Tasks carry no `**Status:**` line until they are worked. A task with **no** Status
line is available (treat as TODO); a task with `**Status:** DONE — <date> · commit <sha>`
is finished and must not be touched. `IN PROGRESS` / `BLOCKED — <reason>` mark partial
or blocked work. Pick the highest-priority available task (P0 → P1 → P2 → P3).

## Pending package release

_None._ No task this cycle changed `@loontail/minecraft-kit` or `loontail-yggdrasil`.

## Session log

### 2026-05-31 (session 3)

- **Done (20 task IDs across 6 commits, + 1 confirmed already-resolved):**
  - `ERR-02` (P2) — moved the duplicated `errorMessage` one-liner into
    `src/main/infra/errorMessage.ts`; all 9 callsites and the test now import the
    single copy · commit dff71a3
  - `DLI-13` + `DLI-59` (P2) — extracted `flattenRemoteEntries` into
    `bundle/manifestUtils.ts`; `plan.flattenEntries` and `manifestSnapshot.flattenRemote`
    share one manifest-walk · commit 44a4bc8
  - `CC-14` + `CC-34` (P2) — `SIDECAR_DIR` ('.loontail') now lives in
    `src/main/constants/paths.ts`; bundle `paths.ts` and minecraft
    `installManifest.ts` import it · commit 30dc0bf
  - `LAU-17` + `LAU-18` + `LAU-21` + `LAU-24` + `LAU-28` (P2/P3) —
    `verifyLaunchPreflight` fans the classpath fs.access checks out with
    `Promise.all` (fails fast), guards empty-string entries, and gained tests for
    the empty-classpath and empty-entry branches · commit f7c223f
  - `CC-07` + `CC-09` + `CC-17` + `CC-19` + `CC-35` + `CC-40` (P2/P3) — deleted
    the local `assertNever` in `installManifest.ts`; imported from
    `@loontail/minecraft-kit` · commit 0fb03db
  - `UI-03` (P1) — `installSteps.ts` reuses `isBundleBusy` from
    `@renderer/features/bundle/store` instead of a private copy · commit 39a7d91
  - `ERR-03` (P2) — removed the never-invoked `emitErrorEvent` from `ManagerEnv`
    (env.ts + manager.ts) and the dead mocks/assertions in 5 tests · commit 898a8f3
  - `CC-08` (P2) — already resolved by the session-2 `createThrottledEmitter`
    extraction: both `progressAdapter.ts` and `healProgress.ts` consume the shared
    emitter and the single `PROGRESS_THROTTLE_MS` · commit c8cc5c2 (no new work)
- **Packages built / pending publish:** none.
- **Blocked:** none.
- **Verification:** `npm run verify` — lint, typecheck, test (356 tests), build all green.
- **Notes:** `UI-03` had to import `isBundleBusy` from the `bundle/store` module
  directly rather than the `@renderer/features/bundle` barrel: the barrel re-exports
  `BundleEventsListener`, whose transitive `@renderer/i18n` import touches
  `localStorage` at module load and crashes the node-env `installSteps` test.
- **Suggested next batch:** the renderer state-leak quick-wins (`UI-04`
  status-seed queue, `UI-05` BundleEventsListener subscription), the
  `forgeProcessorActionsCache` unbounded-growth fix (summary item 6), and the
  remaining error-model tasks (`KIT_CODE_TO_LAUNCHER_CODE` lossy mapping).

### 2026-05-31 (session 2)

- **Done (23 task IDs across 6 commits):**
  - `AUTH-18` (P1) — `uploadSkinYggdrasil` retries the post-upload textures
    lookup (3×, 200 ms apart) so CDN propagation lag no longer fails an
    otherwise-successful upload · commit 07405d6
  - `AUTH-09` + `AUTH-12` (P2) — yggdrasil `clearSkin` now rethrows as a new
    `SkinClearFailed` code on server-delete failure and only invalidates the
    media cache on success; the pre-delete snapshot uses the absolutising
    `fetchTextures` wrapper · commit 16cb5c6
  - `DLI-22` + `DLI-23` + `DLI-29` + `DLI-31` + `DLI-36` + `REP-12` (P1/P2) —
    `MinecraftManager.cancel()`/`cancelAll()` are now exhaustive `switch`es with
    `assertNever`; uninstall-cancel warns, bundle sync is aborted on shutdown,
    launch stays kit-owned · commit a452fc0
  - `DLI-10` + `DLI-27` + `DLI-37` + `DLI-48` (P1/P2) — extracted
    `createThrottledEmitter` (`src/main/infra/throttledEmitter.ts`) that flushes
    the pending value on dispose; `progressAdapter` + `healProgress` use it and
    the throttle interval is the single `PROGRESS_THROTTLE_MS` constant · commit c8cc5c2
  - `DLI-05` + `DLI-09` + `DLI-25` + `DLI-32` + `DLI-38` + `DLI-73` (P1/P2) —
    `LocalManifest` now has a Zod schema (`LocalManifestSchema`) and
    `loadLocalManifest` validates nested file entries via `safeParse` · commit 123bca5
  - `DLI-21` + `DLI-28` + `DLI-70` + `REP-05` (P1/P2) — `persistTargetInstallManifest`
    moved into `installManifest.ts` with a `logPrefix` arg; install + repair share
    one copy · commit 323ea57
- **Packages built / pending publish:** none.
- **Blocked:** none.
- **Verification:** `npm run lint`, `npm run typecheck`, `npm test` (350 tests),
  `npm run build` all green.
- **Notes:** the AUTH JSDoc-cleanup tasks (`AUTH-26`/`27`/`28`/`29`/`30`/`31`) were
  inspected and found already satisfied — the auth/yggdrasil files now carry only
  plain `//` why-comments, no `/** */` blocks — so they were left unmarked rather
  than fabricating a no-op commit.
- **Suggested next batch:** the remaining manifest-flatten dedup (`DLI-13`/`DLI-59`),
  the `errorMessage`/`SIDECAR_DIR` dedup (`ERR-02`, plus the `.loontail` constant),
  then the launch preflight parallel-I/O quick-wins (`LAU-17`/`18`/`21`/`24`/`28`).

### 2026-05-31

- **Done (10 task IDs across 7 commits):**
  - `IPC-01` (P0) — `assertNoIpcArgs` helper rejects payloads on every no-arg
    channel; enforced across auth/app/settings/system/media/skin/console/updater
    routes · commit 58f373e
  - `DLI-46` (P0) — `startInstall` now releases the operation lock exactly once,
    before the bundle-sync hook, via a `try/finally` (the early release was
    intentional — the bundle sync shares the `CLIENT_FOLDER` lease) · commit 89d9063
  - `DLI-08` (P0) — `continuePausedSync` drops the active sync on a throw before
    planning so a failed resume can't wedge the slug for the session · commit ce377ff
  - `AUTH-22` (P1) — removed never-thrown `AUTH_NETWORK_ERROR` /
    `AUTH_INVALID_CREDENTIALS` codes and the dead renderer IPC map · commit b51feb0
  - `AUTH-05` (P1) — offline yggdrasil verify returns the cached account without a
    redundant texture fetch (mirrors the Mojang offline branch) · commit 9cd6715
  - `AUTH-04` (P1) — both login paths route through a single `buildLoginResult`
    helper; documents the Mojang-vs-Yggdrasil enrichment asymmetry · commit 9491241
  - `AUTH-21` + `AUTH-20` + `AUTH-19` + `AUTH-13` — new `src/main/constants/http.ts`
    (401/403/429); extracted the named `MOJANG_TOKEN_REFRESH_SAFETY_WINDOW_MS` · commit 8c4a375
- **Packages built / pending publish:** none.
- **Blocked:** none.
- **Verification:** `npm run lint`, `npm run typecheck`, `npm test` (332 tests) all green.
- **Notes:** the backlog as generated had no `**Status:**` lines and no §0 working
  agreement — added a Status convention section (above) and started marking DONE tasks.
- **Suggested next batch:** `DLI-09` (P1 — LocalManifest Zod schema), `AUTH-18` (P1 —
  post-upload texture re-fetch retry), then the remaining auth quick-wins
  (`AUTH-26`/`27`/`28`/`29` JSDoc cleanup, `AUTH-12` `fetchTextures` consistency).
