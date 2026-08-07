# Open work — @loontail/minecraft-launcher

What is left from the 2026-05/06 audit sweep, and nothing else.

The sweep itself is finished: of its 286 tasks, 241 shipped and 1 (a
code-guideline §10 rewrite) has since been done in place. The full ledger —
every task's Problem / Why / Solution / Tests, plus the per-session logs and the
per-prefix triage notes that lived in `docs/audit-plan/` — is in git at
`28d9a36a`. Recover it with:

```bash
git show 28d9a36a:docs/audit-backlog.md
git show 28d9a36a:docs/audit-plan/REP.md   # AUTH, CC-A/B, DLI-A/B, IPC-PRF, LAU, REP, UI-A/B
```

Nothing below is scheduled. Two items need a decision from the maintainer; the
rest are known, accepted, and mostly blocked on something outside this repo.
Before picking any of them up, re-check it against the current tree — several
entries in the original 44 have already been fixed incidentally.

---

## 1. Needs a maintainer decision

### 1.1 Release pipeline ordering

`.github/workflows/release.yml` triggers on **every** push to `main`: it
patch-bumps the version and pushes the tag *before* the Windows `verify` job runs
on it. A Windows-only failure therefore leaves a version bump and an
artifact-less tag on `main`. PR CI already runs `verify` on Linux, so the
residual gap is Windows-only failures plus direct pushes.

Two independent choices, either or both:

- Reorder so Windows `verify` gates bump + tag + publish (verify on the pushed
  commit, publish-build on the bump commit — accept the two-commit split).
- Switch to intent-gated releases (tag push or `workflow_dispatch`) instead of
  auto-release on every `main` push.

This means moving tag creation and reworking the `RELEASE_TOKEN` bypass plus the
loop guard, so it is a maintainer decision rather than a mechanical task.

### 1.2 Launch-chained pause semantics

A Pause on a launch-chained bundle sync currently holds the launch in
`LAUNCHING` for up to 5 minutes (the paused-sync idle expiry).

The proposed alternative — reject the `forLaunch` awaiters on pause, drop the
build back to `INSTALLED`, leave the sync resumable — is a **behaviour flip**,
not a bug fix. It deliberately breaks the pinned test
`tests/main/services/bundle/managerPauseCleanup.test.ts` → "keeps syncForLaunch
pending across pause and resolves after resume completes", and it needs a
matching renderer change (while `PAUSED` the card would show PLAY, not
PROGRESS). Decide which semantics is wanted; whichever wins, the pinned test
encodes it.

Related: `BundleManager` does not settle a `forLaunch` awaiter when a sync is
paused *inside* the heal phase, which can hang `syncForLaunch` indefinitely. Any
decision here should cover that path too.

## 2. Blocked on a package release

Each of these is a "stop re-implementing what the package already does" item.
None can land in this repo alone: they need an API added to
`@loontail/minecraft-kit` or the Yggdrasil packages, a release, a dist sync and a
lockfile refresh.

- **Bundle downloads should use the kit's `FetchHttpClient`.**
  `bundle/download.ts` hand-rolls `node:http`/`https` with its own redirect
  following, timeouts and streaming. It also has no injection point, which is
  why the download layer is only testable against real sockets or mocked Node
  internals.
- **`absolutizeTextureUrl`** in `auth/yggdrasilClient.ts` is a workaround for a
  server misconfiguration; it belongs in `yggdrasil-client`/`-core`.
- **`YGGDRASIL_PLACEHOLDER_CLIENT_ID`** (a zero GUID) should be a branded
  constant exported from `yggdrasil-client`.
- **`resolveAuthlibInjectorJar`** in `minecraft/launch.ts` re-implements path
  logic that `yggdrasil-client` should own.
- **`sanitizeHttpAgentToken` + the hand-built user-agent** in `minecraft/
  launch.ts` should come from a shared constant; the regex is currently covered
  only through an integration test.
- **Forge processor verification**: `minecraft/forgeProcessorHealing.ts`
  hand-rolls a SHA-1 file hasher and its own output verification. Both belong in
  the kit as a supported repair sub-plan, exposing its hash/verify infra.
- **`infra/cache.ts` `cachedFetch`** duplicates the kit's
  `createPersistentMetadataCache`.
- **`shared/contracts/settings.ts`** imports a runtime (not type-only) symbol
  from the kit; downgrading it needs a kit change.
- **A branded undashed-UUID type** for `YggdrasilSession.profile.uuid`, so the
  dashed/undashed invariant is compile-time enforced.

## 3. Needs design

- **`ProgressStages` is shadowed**: the kit exports one and
  `shared/contracts/minecraft.ts` declares a local copy. Unifying them means
  deciding whether a kit enum may cross into the renderer-visible contract
  surface.
- **`queryPersister` serialises the whole TanStack Query cache synchronously**
  into `localStorage`. The fix is an async IndexedDB persister — a driver
  rewrite, not a tweak.
- **`Context.resolved` is typed `ReturnType<typeof resolveClientSettings>`**,
  exposing all resolved settings where a narrow field set would do. Narrowing it
  conflicts with the `ResolvedClientSettings` shape used elsewhere; pick one.

## 4. Known and accepted (no action planned)

Recorded so nobody re-raises them as findings.

- **`getInstallState` fetches the remote manifest on every call** (no TTL) while
  resume reuses a manifest cached up to 5 minutes. Inconsistent, deliberate:
  Play must never be gated on connectivity.
- **`buildPlan` does sequential per-file `exists` + hash I/O** and ignores the
  abort signal, so force-mode re-hashing of a large bundle is slow and
  uncancellable.
- **`bundle/api.ts` and `bundle/plan.ts` each hash files their own way**; the two
  should share one helper.
- **`runSyncPhases` drains the pending-download queue in a mutable loop** with a
  single `firstError`, so concurrent failures collapse into one.
- **The pause path is a two-phase stop** (abort signal destroys the in-flight
  request; the cooperative `paused` flag stops the next one) and the resumed
  `AbortController` is replaced without unhooking the old one's listeners.
  Correct today, but it rests on event-loop ordering — read `runner.ts` before
  adding a retry there.
- **`BundleEventsListener` reads store state via `getState()` inside an effect.**
  Raised as a bug; it is not — that is the intended Zustand pattern for an
  event-to-store bridge.
- **`bundle/healer.ts` builds kit operation options with conditional spreads**
  rather than optional fields, because the kit's `VerifyOperationOptions` reject
  an explicit `undefined` under `exactOptionalPropertyTypes`.
- **`IpcError.code` is a plain `string`**, not a union of the codes registry. The
  call site that motivated narrowing it is gone.
- **No coverage threshold.** `vitest.config.ts` now configures a `v8` reporter
  over `src/main/services/**` and `src/shared/**`, but nothing fails on a drop;
  gating it is a policy choice, not a config gap.
- **No workflow-level integration test** for install → launch end to end.
