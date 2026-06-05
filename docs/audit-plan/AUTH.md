# AUTH audit-triage plan

Triage of the unmarked AUTH task group against current `src/**`. Read-only analysis; no code was changed.

Group: AUTH-10, 11, 17, 23, 24, 25, 26, 27, 28, 29, 30, 31.

## Classification summary

| ID | Verdict | Evidence (current code) |
|----|---------|--------------------------|
| AUTH-10 | OPEN | `src/main/services/auth/routes.ts:24` still maps `AUTH_CANCELLED → LOGIN_ERROR_CODE.Unknown`. No `Cancelled` value in `LOGIN_ERROR_CODE` (`src/shared/contracts/auth.ts:126-132`). Renderer `useMojangLogin` (`hooks.ts:88-117`) still relies on the `cancelledRef` guard. The fragile cancel-then-retry race described in the task is intact. |
| AUTH-11 | OPEN (partial) | The `skin.ts:185` direct-`getTextures` sub-issue is RESOLVED (AUTH-12 DONE; `skin.ts` has zero `getTextures(` calls, routes everything through the gateway). The core complaint — `absolutizeTextureUrl` coupled to `mainConfig` inside the otherwise config-agnostic wrapper — still stands at `yggdrasilClient.ts:23-26`. Same fix as AUTH-24. |
| AUTH-17 | OPEN | `yggdrasilAuth.ts:85-89`: the `validate` catch still does `if (isNetworkFailure) return offline; logger.warn(...); return { kind: 'offline' }`. A 500/TLS/malformed response is still squashed to `offline`. `VerifyYggdrasilResult` (L37-40) has no `error`/`unknown` variant. |
| AUTH-23 | OPEN | `launch.ts:264-265`: `resolveLaunchAuth(account)` calls `getStoredAuth()` internally. Not injected; only testable via the full `runLaunch` path + `vi.mock('@main/infra/store')`. |
| AUTH-24 | OPEN | Same as AUTH-11. `absolutizeTextureUrl` defined locally in `yggdrasilClient.ts:23-26`; belongs in `yggdrasil-client` (`YggdrasilClient.getTextures` baseUrl option). |
| AUTH-25 | OPEN | `launch.ts:44`: `YGGDRASIL_PLACEHOLDER_CLIENT_ID = asAzureClientId('00000000-…')` still defined locally; not exported from `yggdrasil-client`. |
| AUTH-26 | ALREADY-RESOLVED | `session.ts:5-6` (`withRefreshedProfile` moved here from `mojangAuth.ts`) now carries a 2-line `//` why-comment, not a JSDoc block. The "what-restating" docstring is gone. |
| AUTH-27 | ALREADY-RESOLVED | `mojangAuth.ts:111-183`: `signInWithMojang`, `cancelMojangLogin`, `verifyMojangSession` have NO JSDoc blocks. The single `activeController` race-guard why-comment (L115-117) is correctly retained. |
| AUTH-28 | ALREADY-RESOLVED | `yggdrasilClient.ts`: `getYggdrasilClient` singleton is gone entirely (replaced by injected `createYggdrasilClient`/`YggdrasilGateway`). The remaining comment (L6-8) is a why-comment about the gateway-not-singleton design. No offending JSDoc. |
| AUTH-29 | ALREADY-RESOLVED | `yggdrasilClient.ts:28`: `fetchTextures` has no JSDoc; the kept inline comment (L17-22) explains the relative-URL server quirk (the correct "keeper"). |
| AUTH-30 | ALREADY-RESOLVED | `verify.ts:11-13`: `enrichYggdrasilAccount` now has two concise `//` lines (migration context + email-null reason). The what-restating opener is gone. |
| AUTH-31 | ALREADY-RESOLVED | `verify.ts:32-38`: `verifySession` comment trimmed to the expired-vs-offline invariant; the signature-restating first sentence is gone. |

Counts: OPEN = 5 (AUTH-10, 11, 17, 23, 24, 25; note 11 & 24 are one fix → 5 distinct work items), ALREADY-RESOLVED = 6 (AUTH-26, 27, 28, 29, 30, 31), OBSOLETE = 0.

The entire JSDoc-cleanup sub-batch (AUTH-26–31) was already executed by a prior session that also restructured the auth module (gateway injection, `session.ts` extraction). No further work there.

## OPEN task detail

### AUTH-10 — distinct `Cancelled` login error code
- Files/symbols: `src/shared/contracts/auth.ts` (`LOGIN_ERROR_CODE`), `src/main/services/auth/routes.ts` (`mojangFailureCode`), `src/renderer/features/auth/hooks.ts` (`useMojangLogin`, `loginErrorCodeFromRejection`).
- Fix: add `Cancelled: 'CANCELLED'` to `LOGIN_ERROR_CODE`; return it from `mojangFailureCode` for `AUTH_CANCELLED`; in `useMojangLogin.signIn` treat `result.error === Cancelled` the same as the `cancelledRef` guard (suppress, no `setErrorCode`). Removes the implicit main↔renderer ref coupling.
- Risk Low · Effort small · Repo-only (no package).
- Test: extend `tests/renderer/features/auth/hooks.test.ts` — a `{ ok:false, error:'CANCELLED' }` result leaves `errorCode` null even when `cancelledRef` is false (cancel-then-retry race).

### AUTH-17 — surface Yggdrasil server errors instead of masking as offline
- Files/symbols: `src/main/services/auth/yggdrasilAuth.ts` (`VerifyYggdrasilResult`, `verifySession` catch on `validate`), downstream consumer `src/main/services/auth/verify.ts` (`verifySession` switch must handle the new variant).
- Fix: add `{ kind: 'error' }` (or broaden `offline` semantics) to `VerifyYggdrasilResult`; in the `validate` catch, return `error` for non-network, non-403 failures with an actionable `logger.warn`. In `verify.ts`, decide policy for `error` (recommend: keep cached session like offline but log distinctly, OR clear — needs a product call; default to offline-equivalent + distinct log to stay safe).
- Risk Med (touches the start-up session-validity decision tree) · Effort small.
- Repo-only.
- Test: extend `tests/main/services/auth/yggdrasilAuth.test.ts` — `validate` throws a 500 `YggdrasilClientError`; assert result kind is the new observable variant (not `ok`), and `verify.test.ts` for the propagation.

### AUTH-23 — make `resolveLaunchAuth` a pure, injectable function
- Files/symbols: `src/main/services/minecraft/launch.ts` (`resolveLaunchAuth`, `runLaunch` callsite L327).
- Fix: change signature to `resolveLaunchAuth(account: Account, session: AuthSession | null)`; move the `getStoredAuth()` read up into `runLaunch` and pass the result down. Export `resolveLaunchAuth` for direct unit testing.
- Risk Low · Effort small · Repo-only.
- Test: new `tests/main/services/minecraft/launch.test.ts` cases calling `resolveLaunchAuth` directly: yggdrasil session → ONLINE + authlib-injector `extraJvmArgs`; mojang session → `toOnlineAuth` shape; null → OFFLINE. No store mock needed.

### AUTH-11 + AUTH-24 — extract `absolutizeTextureUrl` into `yggdrasil-client` (ONE fix)
- Files/symbols: package `loontail-yggdrasil/.../yggdrasil-client` (`YggdrasilClient.getTextures` — add optional `baseUrl` that resolves relative texture URLs); launcher `src/main/services/auth/yggdrasilClient.ts` (drop local `absolutizeTextureUrl`, pass `mainConfig.apiUrl` as `baseUrl`, simplify `fetchTextures`).
- Fix: add `baseUrl` option to `getTextures` in the package; rebuild + copy dist into launcher `node_modules` (or republish + bump + `npm install --package-lock-only`); then delete the launcher-side absolutization.
- Risk Med (cross-repo build/dist sync; lockfile refresh required per repo convention) · Effort medium · **Touches package loontail-yggdrasil.**
- Test: package-side unit — `getTextures({ baseUrl })` resolves `/textures/abc.png` to absolute, passes absolute through unchanged. Launcher-side: `fetchTextures` returns absolute URLs given a relative-URL mock client.

### AUTH-25 — export `YGGDRASIL_PLACEHOLDER_AZURE_CLIENT_ID` from `yggdrasil-client`
- Files/symbols: package `yggdrasil-client` (new exported branded const next to `buildAuthlibInjectorJvmArg`); launcher `src/main/services/minecraft/launch.ts:44` (delete local `YGGDRASIL_PLACEHOLDER_CLIENT_ID`, import from package).
- Fix: export `YGGDRASIL_PLACEHOLDER_AZURE_CLIENT_ID = asAzureClientId('00000000-…')` from the package; rebuild + dist sync; import in launch.ts.
- Risk Low · Effort small (but compile/dist-sync overhead) · **Touches package loontail-yggdrasil.**
- Test: none (compile-only change), per task.

## Clusters (disjoint file sets for parallel work)

- **CLUSTER cancel-code** [Low] — IDs: AUTH-10. Files: `src/shared/contracts/auth.ts`, `src/main/services/auth/routes.ts`, `src/renderer/features/auth/hooks.ts`, `tests/renderer/features/auth/hooks.test.ts`. Effort small. Repo-only.
- **CLUSTER ygg-verify-error** [Med] — IDs: AUTH-17. Files: `src/main/services/auth/yggdrasilAuth.ts`, `src/main/services/auth/verify.ts`, `tests/main/services/auth/yggdrasilAuth.test.ts`, `tests/main/services/auth/verify.test.ts`. Effort small. Repo-only.
- **CLUSTER launch-auth-pure** [Low] — IDs: AUTH-23. Files: `src/main/services/minecraft/launch.ts`, `tests/main/services/minecraft/launch.test.ts`. Effort small. Repo-only.
- **CLUSTER ygg-client-package** [Med] — IDs: AUTH-11, AUTH-24, AUTH-25. Files: `loontail-yggdrasil` package (`yggdrasil-client` src + dist), `src/main/services/auth/yggdrasilClient.ts`, `src/main/services/minecraft/launch.ts`. Effort medium. **Cross-repo (package).**

### Cross-cluster shared files
- `src/main/services/minecraft/launch.ts` is touched by BOTH `launch-auth-pure` (AUTH-23) and `ygg-client-package` (AUTH-25). These are different regions (the `resolveLaunchAuth` body/signature vs. the L44 placeholder import), but they edit the same file — serialize them or merge into one launch.ts pass to avoid conflicts.
- All other clusters operate on disjoint file sets and may run in parallel.

## Notes
- Prior session already completed the comment-cleanup batch (AUTH-26–31) and the skin.ts absolutization fix (AUTH-12) — backlog headings for 26–31 should be marked DONE/RESOLVED on a future pass.
- AUTH-11 and AUTH-24 are duplicate descriptions of the same package extraction; implement once.
- Package changes (AUTH-11/24/25) require dist sync + lockfile refresh (`npm install --package-lock-only`) per repo convention, else CI `npm ci` fails.
- Respect conventions in fixes: English comments, `//` why-comments only, TS `private`, biome-only.
