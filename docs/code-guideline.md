# Code Guideline — @loontail/minecraft-launcher

This document describes the rules the project's code must follow. It can be
extended as the project evolves; new rules should be added after discussion and
must include a short rationale (**Why**) so they can be revisited later.

- High-level structural decisions (process model, modules, IPC, services,
  external integrations) — see [`architecture.md`](./architecture.md).
- UI / design-system rules (the hand-owned UI kit, Tailwind v4 tokens,
  typography, icons, theming) — see [`ui-guideline.md`](./ui-guideline.md).

---

## 1. TypeScript

- `strict: true` everywhere, together with `noUncheckedIndexedAccess`,
  `noImplicitOverride`, and `exactOptionalPropertyTypes`.
- Do not use `any`. If unavoidable, add an inline comment explaining why.
- Prefer `unknown` + narrowing over `any`.
- All public service functions must have explicit return types. Internal
  helpers may rely on inference.
- **Do not annotate return types you can infer.** React components, simple
  helpers, and one-liners where the return type is obvious from the body
  should rely on inference — annotating `(): ReactElement => …` on every
  component adds noise without protecting any contract. Add an explicit
  annotation only when it actually buys something: a non-obvious union
  return, a public service boundary (see the previous rule), or a case
  where inference picks a wider type than intended. **Why:** the previous
  blanket rule produced wall-to-wall `: ReactElement` annotations that
  hurt readability and weren't catching real bugs.
- No one-letter variables or arguments, except for obvious cases (`x`, `y`,
  `i` in short loops).
- No dead code. If something "might come in handy later", delete it — git
  remembers.
- `TODO` comments without concrete context are forbidden. Format:
  `TODO(scope): what and why`.
- No floating promises — either `await`, attach `.catch`/`.then`, or use an
  explicit `void promise` with a comment explaining why the result is ignored.
- No god-files. Split by meaning, but do not invent abstractions for their own
  sake. Three similar lines beat a premature abstraction.
- Use `import type { … }` for type-only imports. Keeps the runtime bundle
  clean and makes intent explicit.
- Default to `type`. Use `interface` only when its specific features
  (declaration merging, `extends` from external libs) are required.
- Prefer simple, composable functions over classes. Introduce a class only
  when state and behavior are genuinely coupled and there is more than one
  instance.
- Use **branded types** for domain identifiers (`type BundleSlug = string &
  { readonly __brand: 'BundleSlug' }`) instead of raw `string`. Prevents
  accidentally passing a `clientId` where a `bundleSlug` is expected.
- **Always use arrow functions.** This applies to top-level exports,
  internal helpers, callbacks, and component definitions. Use a `function`
  declaration only when arrows cannot express the construct: generators
  (`function*`), or when `this`-binding from a non-arrow context is
  genuinely required (rare). Type predicates (`value is X`) work fine in
  arrow form.

  ```ts
  // good
  export const createService = (router: Router): Service => { … };
  export const App = () => { … };

  // bad
  export function createService(router: Router): Service { … }
  export function App(): ReactElement { … }
  ```

  The service keeps its explicit return type because it is a public
  boundary; the component drops it because inference is enough.
- Model variant state with **discriminated unions** — a literal `kind` /
  `status` / `type` field as the discriminator — not boolean flag soups.

  ```ts
  type BundleState =
    | { kind: 'idle' }
    | { kind: 'downloading'; progress: number }
    | { kind: 'ready';       installedAt: number }
    | { kind: 'error';       code: ErrorCode; message: string };
  ```

- Always close `switch` on a discriminated union with an **exhaustiveness
  check**:

  ```ts
  function assertNever(value: never): never {
    throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
  }

  switch (state.kind) {
    case 'idle':        return …;
    case 'downloading': return …;
    case 'ready':       return …;
    case 'error':       return …;
    default:            return assertNever(state);
  }
  ```

  Compiler errors when a new variant is added but the switch is not updated.

- **No nested ternaries.** Replace `a ? b : c ? d : e` with `if/else`, a
  small helper, or a lookup table. Enforced by Biome
  `lint/nursery/noNestedTernary`. **Why:** nested ternaries hide control
  flow behind punctuation and are awkward to step through in review and
  debugger. **How to apply:** if you reach for a second `?` inside a
  ternary, lift the whole expression into a named helper returning the
  branch value (string / `ReactNode` / etc.).

## 2. Naming

- Files — `camelCase` (`bundleManager.ts`, `resolveSettings.ts`).
- Folders — `kebab-case` or `lower-case`; style stays consistent within a
  directory.
- Do not use `*.util.ts`. Name files by meaning: `path.ts`, `fs.ts`,
  `settings.ts`, `manifest.ts`.
- Constants — `SCREAMING_SNAKE_CASE`.
- Types, interfaces, classes — `PascalCase`.
- Functions and variables — `camelCase`.
- React components — `PascalCase`; the file name matches the component
  (`BundleSync.tsx`).
- Boolean names use predicate prefixes: `isReady`, `hasError`, `shouldRetry`.
- Reuse existing domain vocabulary in names (`bundle`, `manifest`, `client`,
  `slug`). Do not invent synonyms (`package`, `descriptor`, `app`) for things
  that already have a name in the codebase.
- **No abbreviations of words.** Spell things out: `ActionButton` not
  `ActionBtn`, `ImageGallery` not `ImgGallery`, `userMessage` not `userMsg`,
  `deleteButton` not `delBtn`. This applies to file names, component names,
  variables, and functions.
- The only abbreviations permitted are universally recognized industry
  short forms: `id`, `url`, `uri`, `api`, `db`, `env`, `config`, `ctx`,
  `req`, `res`, `os`, `ui`, `ipc`, `dto`. If in doubt, write the full word.

## 3. Architecture

### 3.1 Layers and boundaries

- **`main`** — Node environment; OS, fs, network, child processes.
- **`preload`** — bridge via `contextBridge`. Only IPC proxying; no business
  logic.
- **`renderer`** — UI and UI logic. No access to Node APIs.
- **`shared`** — platform-agnostic: types, contracts, pure domain logic. No
  imports from Node, DOM, Electron, or React.

### 3.2 Hard import rules

- `renderer` must not import from `main`.
- `main` must not import from `renderer`.
- `shared` must not import from `main` or `renderer`.
- These are **convention only** today: `biome.json` has no
  `noRestrictedImports` and tsconfig path separation does not block a relative
  climb out of a layer. Nothing will fail your build — check it in review.
  Adding the rule is worth doing; until it exists, do not assume a violation
  would have been caught.

### 3.3 Where logic must not live

- Business logic must not live in React components. A component is for
  rendering and UI-local state.
- Business logic must not live in IPC handlers. A handler is a thin wrapper
  over a service.
- fs / network / Minecraft logic must not live in the renderer.

### 3.4 Services in main

Each domain capability lives in `main/services/<name>/`:

- `<name>.ts` — core logic.
- `routes.ts` — IPC routes of this capability (thin wrappers over the core).
- `index.ts` — **only if** the capability owns state or needs teardown; then it
  exports `{ init, dispose }` and goes into the ordered `services` array in
  `main/index.ts`. A capability with no state gets its routes registered
  directly at the call site — do not add a lifecycle shell for symmetry.
- Dependencies are passed at construction, in `main/index.ts`. No module-level
  service singletons and no DI container.

See architecture.md §5 for which capabilities are which, and why the init order
matters.

### 3.5 Feature folders in renderer

```
features/<feature-name>/
├─ api.ts          # wrappers over window.api.<feature>.*
├─ hooks.ts        # feature hooks
├─ components/     # UI of this feature
└─ index.ts        # feature's public API
```

- Inside the feature — anything goes; outward — only `index.ts`.
- Generic UI components live in `renderer/shared/ui/`.
- Do not create a global `components/` folder for everything.

### 3.6 Process security (Electron)

Aligned with the official Electron security checklist; non-negotiable.

**Web preferences (per `BrowserWindow`):**

- `nodeIntegration: false` and `contextIsolation: true` — no exceptions, ever.
- `sandbox: true` for any new window. There is exactly one standing exception:
  the console window runs `sandbox: false`, because contextBridge push batches
  (`console.lines`) are silently dropped in a sandboxed background
  `BrowserWindow`. That exception is only tolerable because two invariants hold
  — its IPC is scoped to `CONSOLE_TRUSTED_CHANNELS`, and it renders
  attacker-influenceable stdout/stderr as **text nodes only**. Read the comment
  in `windows/consoleWindow.ts` before touching either. Do not add a second
  exception.
- `webSecurity: true`, `allowRunningInsecureContent: false`,
  `experimentalFeatures: false`. Do not use `enableBlinkFeatures`.

**Preload and IPC:**

- In preload — only `contextBridge.exposeInMainWorld('api', …)` with a typed
  API. Never expose raw `ipcRenderer`, `electron`, `process`, or any Node
  module to the renderer.
- Every `ipcMain.handle` validates the **sender frame** before doing work:

  ```ts
  ipcMain.handle(channel, (event, args) => {
    if (!isTrustedFrame(event.senderFrame)) throw new IpcError(...);
    return service.run(args);
  });
  ```

  `isTrustedFrame` checks origin against the app's own renderer origin
  allowlist.

**Navigation and windows:**

- `setWindowOpenHandler` returns `{ action: 'deny' }` by default; explicit
  allowlist for any `'allow'`.
- `will-navigate` denies anything outside the app's own bundled resources.
- `will-attach-webview` denies attachment — `<webview>` is not used.

**External links and protocols:**

- External links only via `shell.openExternal` from main, and only after
  validating the URL against a scheme + host allowlist (e.g. `https:` and
  known domains). Never pass a renderer-supplied URL through unfiltered.
- Use custom protocols via `protocol.handle()` instead of `file://`.

**Remote content:**

- HTTPS / WSS for any non-loopback remote endpoint. Plain HTTP / WS is
  only acceptable for `localhost` / `127.0.0.1` in development.
- Define a restrictive CSP. `connect-src` is derived at runtime from
  `new URL(mainConfig.apiUrl).origin`, so dev and prod origins both work with no
  CSP edit. Dev additionally widens it to `ws: http: https:` for HMR — that
  widening must stay dev-only. `src/main/infra/session.ts` holds the live
  definitions.

**Permissions:**

- Set `ses.setPermissionRequestHandler` and deny everything by default;
  whitelist explicitly per host.

**Electron Fuses:**

- `runAsNode: false`
- `enableNodeOptionsEnvironmentVariable: false`
- `enableNodeCliInspectArguments: false`
- `enableCookieEncryption: true`
- `onlyLoadAppFromAsar: true`
- `enableEmbeddedAsarIntegrityValidation: true`

  Fuses are flipped at build time and close a class of post-install
  tampering attacks.

**Hygiene:**

- Keep Electron version current. Security patches are not optional;
  schedule version bumps.

### 3.7 When to extract a function

Extract a piece of code into a named function only if at least one is true:

- It is used in two or more places.
- It is independently unit-testable, while the surrounding code is not.
- The original block is genuinely hard to follow and a name makes it clearer.

A single short block used once and easy to read should stay inline.

## 4. IPC contract

- Single source of truth: `shared/ipc/contract.ts` — a map of
  `channel → { args, result }`.
- No raw `ipcRenderer.invoke('some-string', …)` calls in features. Only the
  typed `window.api` wrapper.
- Channel names follow `'<feature>.<action>'` (`'bundle.start'`,
  `'settings.get'`).
- Main→renderer events are described in a separate `IpcEventPayloads` map, and
  their names are registered in `shared/ipc/channels.ts` alongside the invoke
  channels, behind compile-time coverage guards.
- IPC arguments are validated by a Zod schema on entry to main — even when
  coming from the project's own renderer (the sandbox does not guarantee
  payload integrity).

## 5. Validation at external boundaries

- Every API / HTTP response goes through a Zod schema in `infra/http.ts`.
  On shape mismatch — fail fast with a clear error.
- IPC arguments are validated on entry to the router.
- Inside the validated boundary, trust the types — do not re-validate.
- `shared/contracts/` — Zod schemas and the types inferred from them. Single
  source of truth for the shape of "external" data.

## 6. Constants and contracts

### 6.1 No magic literals

Any string or number that carries **domain or contract meaning** must be a
named constant or an enum member. Comparisons, switch branches, IPC channel
names, status flags, route paths, store keys, error codes, event names —
all extracted.

```ts
// bad
if (status === 'ready') { ... }
fetch('/api/bundle-registry/builds/' + slug + '/manifest');

// good
if (status === BundleStatus.Ready) { ... }
fetch(API_ROUTES.bundleRegistry.manifest(slug));
```

**What does NOT count as a magic literal** (no extraction needed):

- Numeric initial values that have no domain meaning (`let count = 0`).
- Empty string defaults (`name ?? ''`).
- Format strings used only once locally for `console.log` / `throw`.
- Mathematical constants in pure formulas (`x / 2`, `Math.PI`).
- Test fixtures inside `*.test.ts`.

If a literal would be searched for, compared against in more than one place,
or might change as a product/contract decision — it is magic. Extract it.

### 6.2 Enums and const objects

- Prefer **`as const` objects** with derived union types over TS `enum`s.
  Avoids numeric-enum quirks, no runtime overhead, plays well with
  serialization.

  ```ts
  export const BUNDLE_STATUS = {
    Idle:        'idle',
    Downloading: 'downloading',
    Ready:       'ready',
    Error:       'error',
  } as const;

  export type BundleStatus = typeof BUNDLE_STATUS[keyof typeof BUNDLE_STATUS];
  ```

- `enum` is allowed when its specific features (reverse mapping, declaration
  merging) are actually needed. Otherwise stick with the `as const` form.
- Pick one style per category (statuses, codes, channels) and stay consistent
  within it.

### 6.3 API routes

- The **entire API tree is centralized** in `shared/constants/apiRoutes.ts`.
  No path strings or URL fragments built ad-hoc anywhere else in the code.
- Routes are exposed as a nested object of builder functions:

  ```ts
  export const API_ROUTES = {
    clients: {
      list: (params: { locale?: string } = {}) =>
        params.locale ? `/clients?locale=${params.locale}` : '/clients',
    },
    bundleRegistry: {
      manifest: (slug: BundleSlug) => `/bundle-registry/builds/${slug}/manifest`,
    },
  } as const;
  ```

- Builders return the path **without** the shared `API_PATH_PREFIX`;
  `httpRequest` prepends it. Do not bake `/api` into a builder.
- When the backend changes a path, exactly one file is edited.
- HTTP method and expected response schema (Zod) live next to the route
  builder, not at each call site, where appropriate.

### 6.4 What is centralized vs feature-local

Centralize only true **contracts between layers/processes**:

- IPC channel and event names.
- App-wide limits (`MIN_RAM_MB`, `MAX_RAM_MB`).
- API route builders.
- Store / persisted-state key names.
- Error codes shared between main and renderer.

Constants used inside a single feature live next to that feature. If a
constant has exactly one consumer, keep it there — but still as a named
constant, not an inline literal.

## 7. State management

- **Renderer-side async state** (data from main / network) — TanStack Query.
  No `useEffect + useState` for loading flows.
- **Local UI state of a feature** — `useState` / `useReducer`.
- **Global UI state** (theme, active window, modals) — Zustand stores, one per
  semantic area.
- Do not use Redux/MobX without a clear reason.

**React 19 specifics:**

- **No React Compiler is configured** — there is no Babel step and no compiler
  plugin, so nothing optimizes re-renders for you. Memoize by hand
  (`memo` / `useMemo` / `useCallback`), but only against a measured problem, not
  on principle.
- Use `useActionState` for form submission flows and `useOptimistic` for
  mutations that need instant UI feedback.
- Do **not** use `'use server'`, Server Actions, or React Server Components.
  They require a server runtime (Next.js / similar) that does not exist in
  an Electron renderer.

## 8. Persistence

- **All launcher state lives in one SQLite database**, `userData/launcher.db`,
  reached only through the `main/infra/store.ts` facade over `main/infra/db/`
  (`better-sqlite3`, no ORM — hand-written statements in `db/repos.ts`).
- New persisted state adds a repository in `infra/db/`, a facade function in
  `infra/store.ts`, and — if it changes the `LauncherSettings` shape — a step in
  the `MIGRATIONS` map. Do not introduce a second storage technology;
  `electron-store` and Drizzle are **not** dependencies. `electron-store`
  appears in the tree only as the legacy format `infra/db/legacyImport.ts` reads
  once on upgrade.
- Every store key is declared as a named constant in `shared/constants/`.
- User files (bundles, logs, cache) live only under `app.getPath('userData')`
  or explicit override folders. No relative paths.

## 9. Errors and logging

- Single logger via `electron-log` with rotation in `userData/logs/`.
- IPC errors are serialized to a safe shape:
  ```ts
  type IpcError = {
    code: string;       // 'BUNDLE_DOWNLOAD_FAILED', 'SETTINGS_INVALID', …
    message: string;    // human-readable message
    details?: unknown;  // optional; more in dev, minimal in prod
  };
  ```
- Never show a raw stack trace to the user. UI shows `code` + `message`.
- In dev, `details` may include stack traces and source inputs.
- In production, the log must be sufficient for diagnosis (what happened, with
  which arguments, in which service) — without secrets or PII.
- Each service creates a scoped logger when useful:
  `logger.scope('bundle')`.
- Unexpected exceptions in main are caught via
  `process.on('uncaughtException', …)` and logged; the app does not fail
  silently.
- **Log level rules** (enforced by review, no static check):
  - `logger.error` — an operation the user initiated **failed and was not
    recovered** (install crashed, launch failed, IPC handler threw). The user
    sees the failure surface in the UI.
  - `logger.warn` — a failure happened but the launcher **recovered**: stale
    cache served, default value used, retry-able remote error, optional cleanup
    skipped, schema migration fallback. Background sweeps that quietly skip
    also log at warn.
  - `logger.info` — lifecycle events (service init/dispose, schema migration
    applied, install/repair phase boundaries).
  - `logger.debug` — high-volume diagnostics gated behind `--verbose`. Default
    config drops them in production.
  - HTTP 4xx/5xx → `warn` (recoverable). Throwable inside an IPC handler →
    `error` (the renderer sees a popup).

## 10. Comments

- **The test (apply to every comment, existing or new):** if deleting it loses
  information a careful reader could **not** recover from the code in ~10
  seconds, keep it; otherwise delete it. This rule is the whole section — the
  lists below are just the common cases.
- Default — no comments. A well-named function explains itself. A file with
  zero comments is the expected norm, not a gap to fill.
- Write a comment only when the **why** is non-obvious: a hidden invariant, a
  workaround for a specific bug, behavior that would surprise a reader.
- Do not describe **what** the code does — that is visible from the code.
- **No JSDoc / `/** … */` blocks on functions, types, or props** unless the
  block carries a real **why** that the test above would keep. A docstring that
  restates the name, the parameters, or the return type (`@param slug the
  slug`, `Fetches the textures for the given profile.` above
  `fetchTextures(profile)`) is noise — delete it. We do not publish an API
  reference from these doc-comments, so they buy nothing. If a one-line **why**
  is warranted, write a plain `//` line above the symbol instead of a `/** */`
  block. **Why:** multi-line JSDoc is the most common surviving form of
  what-restating comment in this repo and reads as documentation while adding
  nothing.
- Do not reference the current task / ticket / author ("added for #123", "used
  by X flow") — it rots and clutters.
- Multi-line docstrings are unnecessary. If explanation is required, one short
  line above the function is enough.
- **Forbidden patterns** — delete on sight, never add:
  - Section-divider banners: `// ---- X ----`, `// ==== X ====`, `// Public API`,
    `// Internal`. The `private` keyword and file layout already mark structure.
  - Comments that paraphrase the next identifier: `// loop over files`,
    `// set status to ready`, `// Plan + tracker + run`, and per-field / per-prop
    labels that restate the name (`// the text to copy` above `text: string`).
  - Empty-catch labels like `// skip unreadable file` — an empty `catch {}` is
    self-evident. Comment a `catch` only when **why** swallowing is safe is
    non-obvious.
- **Keep** — these are the point of the rule, never strip them: platform quirks
  (e.g. "Cloudflare blocks a bare Java user-agent"), race / abort / cleanup
  invariants (cooperative pause/cancel), wire-shape coercions
  (`exactOptionalPropertyTypes`, API `null` → empty), non-obvious default
  values, schema-migration gap guards.
- **Rule of thumb:** if deleting the comment loses information a careful reader
  could not recover from the code in ~10 seconds, keep it; otherwise delete it.
- Strip decorative / what-restating comments whenever you touch a file — do not
  let them accumulate. A blanket regex sweep is **not** allowed: it would destroy
  the high-value "why" comments above. Removal is per-comment judgement.

## 11. Tests

### 11.1 Scope

- **Vitest** for unit tests:
  - `shared/domain/` — pure logic (`resolveClientSettings` and the rest of the
    settings resolve/override/normalize family, `resolveLoader`,
    `selectRecent`).
  - IPC routes with a mocked service — argument validation and routing.
  - Zod schemas — round-trip and negative cases.
- **No** end-to-end tests. Smoke scenarios are verified manually before
  release.
- No UI unit tests for components, unless a component contains non-trivial UI
  logic (which itself is a signal to extract that logic into a hook).
- Tests live under `tests/`, mirroring `src/`: `tests/{main,renderer,shared}`
  for the code under test, `tests/helpers/` for shared fakes and fixtures,
  `tests/setup/` for vitest setup. There are no co-located `*.test.ts` files
  and no `tests/unit/` — the vitest `include` is `tests/**/*.test.{ts,tsx}`, so
  a test placed anywhere else simply never runs.
- Separate pure-logic tests from tests that touch fs/network/process. The
  former should run in milliseconds and be the default; the latter run
  explicitly and are kept few.
- Prefer real implementations over heavy mocking. Mock the boundary, not
  every collaborator.

### 11.2 Quality rules

- Parameterize inputs. Never embed unexplained literals (`42`, `"foo"`)
  in assertions — name the value (`const EXPECTED_RAM_MB = 4096`).
- Each test must be able to fail from a real defect. If a test cannot fail
  for any plausible bug, delete it.
- Test name must match the assertion. "returns 0 for empty input" must
  actually assert `toEqual(0)` on empty input.
- Compare results to pre-computed expectations, not to the output of the
  function under test recomputed inside the test.
- Use strong assertions (`toEqual(1)`) over weak ones
  (`toBeGreaterThanOrEqual(1)`) whenever possible.
- Cover edge cases, realistic inputs, unexpected inputs, and value
  boundaries — not just the happy path.
- Do not test conditions the type checker already guarantees (e.g. that
  a function rejects `null` for a non-nullable parameter).
- Assert the whole structure in one `toEqual` when practical, instead of a
  chain of single-property checks.

## 12. Tooling

- **Build:** electron-vite (main + preload + renderer).
- **Packaging:** electron-builder.
- **Auto-update:** Electron's built-in Squirrel.Windows `autoUpdater` against
  `update.electronjs.org`. `electron-updater` is **not** a dependency.
- **Linter / formatter:** Biome (single config). Do not propose ESLint or
  ESLint-only plugins; accept a lint gap instead.
- **Package manager:** npm.
- **TS:** `tsconfig.base.json` + separate configs for main / preload /
  renderer.
- **CI:** `biome check`, `tsc --noEmit`, `vitest run`, app build.
- Pre-commit hook (optional): `biome check --staged` and `tsc --noEmit`.

## 13. What we do NOT do

- No "Clean Architecture" with usecases / repositories / entities — overkill
  for a desktop app.
- No custom DI container. A service factory in bootstrap covers the same
  ground.
- Do not split `main` and `renderer` into separate npm packages — they are
  bound together by the IPC contract.
- Do not create shared packages "for the future". Until there is a second
  consumer, it is part of the app.
- No feature flags or backwards-compat shims when the code can simply be
  changed.
- No error handling, fallbacks, or validation for impossible scenarios.
  Validation belongs at system boundaries.

## 14. Git and commits

- Commit messages follow **Conventional Commits**
  (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `build:`,
  `ci:`). Scope optional (`feat(bundle): …`).
- Commit subject ≤ 72 characters, imperative mood (`add bundle pause`,
  not `added bundle pause`).
- Body explains the **why**, not the **what** — the diff already shows
  what changed.
- Do not reference Claude / Anthropic / AI tooling in commit messages.
- Do not bundle unrelated changes in one commit. One concern per commit.
- Branches: `feat/<short-name>`, `fix/<short-name>`,
  `chore/<short-name>`.
- Never commit secrets / tokens / API keys. They live in env vars and
  platform secrets storage only.
- Never commit `console.log` / `console.error` / `console.debug`. Use the
  logger (`logger.scope('…')`).
- Never commit commented-out code. Delete it; git remembers.
- Pre-commit (if no hook): `biome check && tsc --noEmit && vitest run`.

## 15. Language

- All project artifacts — documentation, code comments, commit messages,
  identifiers, log messages, error codes — are written in **English**.
- This applies regardless of the language used in chat or discussion.
