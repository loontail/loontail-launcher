# CC-A triage (cross-cutting code-quality, part A)

Scope: CC-1, CC-2, CC-3, CC-4, CC-5, CC-6, CC-10, CC-11, CC-12, CC-13, CC-16, CC-18, CC-20, CC-21, CC-22, CC-23, CC-24, CC-25, CC-26, CC-27.
Read-only audit of `src/**` as of 2026-06-06.

## Verdict table

| ID | Verdict | Evidence |
|----|---------|----------|
| CC-01 | OPEN | `settings.ts:18-41` still field-by-field imperative merge |
| CC-02 | OPEN (partial) | `shared/contracts/settings.ts:1,14` still imports `LoaderKind` from kit + `satisfies Record<string,LoaderKind>`; comment added but contract dependency remains |
| CC-03 | ALREADY-RESOLVED | `updater/index.ts:69-79` listeners wrapped in try/catch; `registered=true` set only after all `.on()` succeed |
| CC-04 | OPEN | 8 services with `dispose: async () => {}` (app, auth, clients, media, servers, settings, skin, system) |
| CC-05 | ALREADY-RESOLVED | auth.ts/routes.ts prose comments now genuine "why"; verify.ts:32-38 borderline but encodes expired-vs-offline invariant |
| CC-06 | ALREADY-RESOLVED | yggdrasilClient.ts JSDoc replaced with why-comments (L6-8, L17-22) |
| CC-10 | ALREADY-RESOLVED | single `PROGRESS_THROTTLE_MS` in `shared/constants/progress.ts`; healProgress.ts uses shared throttledEmitter, no local const |
| CC-11 | ALREADY-RESOLVED | `errorMessage` lives in `@main/infra/errorMessage`, imported by all callers; no copies in errors.ts files |
| CC-12 | OPEN | `manager.ts:350` `ctx: Awaited<ReturnType<typeof buildContext>>` |
| CC-13 | OPEN | `bundleHealing.ts:43-48` `opOptions` helper + inline spread at L91 |
| CC-16 | OPEN | `context.ts:22` `resolved: ReturnType<typeof resolveClientSettings>`; (manager.ts:350 part == CC-12) |
| CC-18 | ALREADY-RESOLVED | zero `emitErrorEvent` references anywhere in src/ |
| CC-20 | OPEN | `bundleHealing.ts:12` `'bundle.heal'` vs `healer.ts:9` `'bundle.healer'` |
| CC-21 | OPEN | `bundle/manager.ts:381-384` returns `... || ''` |
| CC-22 | ALREADY-RESOLVED | progressAdapter.ts has no local const; throttle interval defaults from shared constant |
| CC-23 | OPEN | RAM pending pattern duplicated SystemSection.tsx:27-39 + ClientSettingsModal.tsx:54-73 |
| CC-24 | OPEN | ClientSettingsModal.tsx:66-93 inline async handlers |
| CC-25 | OPEN | FolderInfoBlock.tsx:65-73 six derived disk-ratio vars inline |
| CC-26 | OPEN | FolderInfoBlock formatBytes (L11-17) vs LauncherSection formatCacheSize (L20-24) |
| CC-27 | OPEN | LanguageSwitcher.tsx:26 `void i18n.language;` |

Counts: OPEN = 11 (CC-01, 02, 04, 12, 13, 16, 20, 21, 23, 24, 25, 26, 27 → note 13 distinct OPEN), ALREADY-RESOLVED = 7 (CC-03, 05, 06, 10, 11, 18, 22). OBSOLETE = 0.

Correction on count: OPEN IDs = CC-01, CC-02, CC-04, CC-12, CC-13, CC-16, CC-20, CC-21, CC-23, CC-24, CC-25, CC-26, CC-27 = **13 OPEN**. RESOLVED = CC-03, CC-05, CC-06, CC-10, CC-11, CC-18, CC-22 = **7**.

---

## OPEN task details

### CC-01 — patchLauncherSettings brittle merge
- File/symbol: `src/main/services/settings/settings.ts` `patchLauncherSettings` (L18-41).
- Fix: replace per-field `if (patch.X !== undefined)` chain with a two-level spread driven by `PatchLauncherSettings` (already `.strict()`): `next.memory = { ...current.memory, ...patch.memory }` etc. Optionally extract a `applyLauncherPatch` pure helper into `@shared/domain/settings` for symmetry with `setClientOverridePure`.
- Risk: Low (schema is strict; spread is type-safe). Effort: small. Packages: no. New test: yes — partial patch per section, omitted-section no-op, Zod round-trip.

### CC-02 — shared contract imports kit type
- File/symbol: `src/shared/contracts/settings.ts:1` (`import type { LoaderKind }`), L6 re-export, L14 `satisfies Record<string, LoaderKind>`, L74 `loader: LoaderKind | null`.
- Note: only a `type` import; a why-comment (L8-9) already explains the local mirror. Strictest fix per backlog: define `LoaderChoice = 'vanilla'|'forge'|'fabric'` locally, drop the `satisfies`/import, and add a `LoaderChoice extends LoaderKind` assertion in `main/` (e.g. a target.ts compile guard). Pragmatic alternative: leave as-is (type-only import is bundler-safe) and downgrade ticket.
- Risk: Medium (touches the canonical loader union used across contracts; `ResolvedClientSettings.loader` also references `LoaderKind`). Effort: small-medium. Packages: no. New test: build assertion that kit is absent from renderer bundle (hard to add cheaply) — recommend a `tsc` type-guard in main instead.

### CC-04 — empty async dispose bodies
- Files: `app/index.ts:13`, `auth/index.ts:30`, `clients/index.ts:15`, `media/index.ts:17`, `servers/index.ts:13`, `settings/index.ts:17`, `skin/index.ts:24`, `system/index.ts:14` (8 services).
- Fix: keep the uniform `dispose: () => Promise<void>` service contract but make no-op bodies explicit: `dispose: () => Promise.resolve()`. Do NOT change the shared service interface (bundle/console/minecraft/updater have real async dispose). Lowest-churn, preserves the orchestrator's uniform `await service.dispose()`.
- Risk: Low. Effort: trivial. Packages: no. New test: no.

### CC-12 — manager.finishRepair opaque ctx type
- File/symbol: `src/main/services/minecraft/manager.ts:350` `ctx: Awaited<ReturnType<typeof buildContext>>`.
- Fix: `import type { Context } from './context';` and annotate `ctx: Context`.
- Risk: Low. Effort: trivial. Packages: no. New test: no. **Same edit shared with CC-16 (manager.ts half).**

### CC-13 — bundleHealing opOptions ternary spreads
- File/symbol: `src/main/services/minecraft/bundleHealing.ts` `opOptions` (L43-48), inline spread L91.
- Fix: kit verify/repair accept `undefined` for `signal`/`onEvent`, so pass `{ signal: options?.signal, onEvent: options?.onEvent }` directly and delete `opOptions`. For the plan call (L88-92) pass `{ from, shouldRepairIssue, signal: options?.signal }`.
- Risk: Low (verify kit ignores undefined fields — confirm `RepairPlanOptions`/`VerifyOptions` accept optional undefined; they're declared `signal?`/`onEvent?` so safe). Effort: small. Packages: no. New test: no.

### CC-16 — Context.resolved uses ReturnType
- File/symbol: `src/main/services/minecraft/context.ts:22` `resolved: ReturnType<typeof resolveClientSettings>` → `resolved: ResolvedClientSettings` (import from `@shared/contracts/settings`). Second half (manager.ts:350) == CC-12.
- Risk: Low. Effort: trivial. Packages: no. New test: no.

### CC-20 — logger scope collision
- Files: `bundleHealing.ts:12` `'bundle.heal'`, `healer.ts:9` `'bundle.healer'`.
- Fix: rename bundleHealing scope to `'minecraft.bundleHeal'` (matches its location under services/minecraft); rename healer scope to `'bundle.heal'`.
- Risk: Low (log-string only; no code reads these). Effort: trivial. Packages: no. New test: no.

### CC-21 — resolveClientFolder empty-string fallback
- File/symbol: `src/main/services/bundle/manager.ts:381-384` returns `resolved.storage.clientFolder || ''`. Callers L181-184, L220, L481 check falsy.
- Fix: return `string | null` (`|| null`); update the 3 callers to `if (!clientFolder)` (already falsy-checking — null is still falsy, so behavior is preserved and the type now forces the check). Confirm no caller concatenates the result without a guard.
- Risk: Low. Effort: small. Packages: no. New test: no.

### CC-23 — extract useRamPending hook (cluster: RAM)
- Files: `settings/components/sections/SystemSection.tsx:27-39`, `clients/components/ClientSettingsModal.tsx:53-73`.
- Fix: create `src/renderer/features/settings/hooks/useRamPending.ts` (no hooks/ dir exists yet — flat `hooks.ts` today; either add subdir or co-locate). `useRamPending(savedRam, resetKey?)` owns `pendingRam`, reset `useEffect`, `isDirty`, returns `{ ramValue, setRam, handleSave, isDirty }`. Note divergence: SystemSection currently has NO reset effect (bug — stale pending on tab reopen), so the extraction also fixes that.
- Risk: Low. Effort: small. Packages: no. New test: yes (renderHook).

### CC-24 — extract ClientSettingsModal actions hook (cluster: client-settings)
- File: `clients/components/ClientSettingsModal.tsx:66-93` (handleRamSave/ToggleConsole/ToggleFullscreen/ResetAll/ChangeFolder).
- Fix: `useClientSettingsActions(slug, deps)` hook in clients feature; component becomes wiring. Overlaps CC-23 (handleRamSave). **Do CC-23 first, then CC-24 consumes useRamPending.**
- Risk: Medium (coordinates several mutations + local state; stale-closure care). Effort: medium. Packages: no. New test: yes.

### CC-25 — extract computeDiskUsageRatios (cluster: FolderInfo)
- File: `settings/components/FolderInfoBlock.tsx:65-73`.
- Fix: `computeDiskUsageRatios({ folder, folderBytes })` → `{ diskUsedRatio, folderRatio, clampedFolderRatio, restUsedRatio }` in `src/renderer/features/settings/lib/diskUsage.ts` (lib/ dir does not exist yet — create).
- Risk: Low. Effort: small. Packages: no. New test: yes (clamp invariant, zero total, undefined folderBytes).

### CC-26 — shared formatBytes (cluster: FolderInfo)
- Files: `FolderInfoBlock.tsx:11-17` (formatBytes), `sections/LauncherSection.tsx:20-24` (formatCacheSize).
- Fix: `src/renderer/shared/lib/formatBytes.ts` single `formatBytes(bytes, opts?)`; both callers delegate. LauncherSection's KB/MB variant becomes an opts/maxUnit form.
- Risk: Low (edge-case output may shift slightly — acceptable). Effort: small. Packages: no. New test: yes.

### CC-27 — LanguageSwitcher void subscription
- File: `settings/components/LanguageSwitcher.tsx:24-26`.
- Fix: derive `current` from `useTranslation().i18n.language` (e.g. `const { i18n } = useTranslation(); const current = i18n.language;`) instead of module-level `getCurrentLanguage()` + discarded `void i18n.language`. Removes the no-op expression and makes the re-render dependency explicit. Verify `SUPPORTED_LANGUAGES`/`Language` typing still aligns with `i18n.language` string.
- Risk: Low. Effort: small. Packages: no. New test: no.

---

## Clusters (disjoint file sets)

- **CLUSTER settings-merge [low]** — IDs=[CC-01]. files=[settings.ts (+optional shared/domain/settings.ts)]. effort=small. Standalone.
- **CLUSTER shared-contract [medium]** — IDs=[CC-02]. files=[shared/contracts/settings.ts]. effort=small-medium. Standalone; hot file (also touched by CC-01 conceptually but different file).
- **CLUSTER service-dispose [low]** — IDs=[CC-04]. files=[app/auth/clients/media/servers/settings/skin/system index.ts]. effort=trivial. Standalone.
- **CLUSTER mc-types-cleanup [low]** — IDs=[CC-12, CC-16]. files=[minecraft/context.ts, minecraft/manager.ts]. effort=trivial. **Shared hot file: manager.ts:350 is the SAME edit for both — do together.**
- **CLUSTER mc-healing-cleanup [low]** — IDs=[CC-13, CC-20]. files=[minecraft/bundleHealing.ts, bundle/healer.ts]. effort=small. bundleHealing.ts shared between the two; healer.ts only CC-20.
- **CLUSTER bundle-folder-type [low]** — IDs=[CC-21]. files=[bundle/manager.ts]. effort=small. Standalone (disjoint from healer.ts).
- **CLUSTER renderer-ram [low→medium]** — IDs=[CC-23, CC-24]. files=[settings/SystemSection.tsx, clients/ClientSettingsModal.tsx, new settings/hooks + clients hook]. effort=medium. **Ordering: CC-23 → CC-24.** Shared hot file: ClientSettingsModal.tsx.
- **CLUSTER renderer-folderinfo [low]** — IDs=[CC-25, CC-26]. files=[settings/FolderInfoBlock.tsx, settings/sections/LauncherSection.tsx, new settings/lib/diskUsage.ts, new shared/lib/formatBytes.ts]. effort=small. Shared hot file: FolderInfoBlock.tsx.
- **CLUSTER renderer-i18n [low]** — IDs=[CC-27]. files=[settings/LanguageSwitcher.tsx]. effort=small. Standalone.

### Inter-cluster file overlaps to coordinate
- `minecraft/manager.ts` appears in mc-types-cleanup (CC-12/16) only — not in mc-healing or bundle clusters. No bundle/manager.ts overlap with minecraft/manager.ts (different files).
- ClientSettingsModal.tsx touched by both CC-23 and CC-24 → keep in one cluster (renderer-ram).
- FolderInfoBlock.tsx touched by both CC-25 and CC-26 → one cluster (renderer-folderinfo).
