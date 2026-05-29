import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Loaders,
  type MinecraftKit,
  type Target,
  VerificationKinds,
  type VerificationResult,
  type VerifyOperationOptions,
  targetPaths,
} from '@loontail/minecraft-kit';

const VERSIONS_DIR = 'versions';

type TargetReadyVerifier = {
  readonly targetReady?: {
    run(target: Target, options?: VerifyOperationOptions): Promise<TargetReadinessReport>;
  };
};

type TargetReadinessReport = {
  readonly isReady: boolean;
  readonly verifications?: readonly VerificationResult[];
};

export const RuntimeVerificationCacheModes = {
  USE: 'use',
  BYPASS: 'bypass',
} as const;

export type RuntimeVerificationCacheMode =
  (typeof RuntimeVerificationCacheModes)[keyof typeof RuntimeVerificationCacheModes];

export type TargetInstallStateOptions = {
  readonly runtimeVerificationCache?: RuntimeVerificationCacheMode;
};

export const InstallReadinessStates = {
  READY: 'ready',
  NOT_READY: 'not-ready',
  NOT_APPLICABLE: 'not-applicable',
  UNKNOWN: 'unknown',
} as const;

export type InstallReadinessState =
  (typeof InstallReadinessStates)[keyof typeof InstallReadinessStates];

export type TargetInstallState = {
  readonly minecraft: InstallReadinessState;
  readonly runtime: InstallReadinessState;
  readonly loader: InstallReadinessState;
  readonly bundle: InstallReadinessState;
};

const runtimeVerificationCache = new Map<string, Promise<VerificationResult>>();

const runtimeVerificationCacheKey = (target: Target): string =>
  JSON.stringify([
    target.runtime.component,
    target.runtime.manifestSha1,
    target.runtime.platformKey,
    targetPaths.runtimeRoot(target.directory, target.runtime.component, target.runtime.installRoot),
  ]);

export const invalidateRuntimeVerification = (target: Target): void => {
  runtimeVerificationCache.delete(runtimeVerificationCacheKey(target));
};

export const clearRuntimeVerificationCache = (): void => {
  runtimeVerificationCache.clear();
};

// Legacy fallback scan: the durable install manifest is the fast current-target
// proof, but this keeps cancel/uninstall recovery tolerant of old installs.
export const isAnythingInstalled = async (clientFolder: string): Promise<boolean> => {
  if (!clientFolder) return false;
  const versionsRoot = path.join(clientFolder, VERSIONS_DIR);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(versionsRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(versionsRoot, entry.name, `${entry.name}.json`);
    try {
      await fs.access(jsonPath);
      return true;
    } catch {
      /* keep looking */
    }
  }
  return false;
};

export const getTargetInstallState = async (
  kit: MinecraftKit,
  target: Target,
  options: TargetInstallStateOptions = {},
): Promise<TargetInstallState> => {
  try {
    const verifier = kit.verify as MinecraftKit['verify'] & TargetReadyVerifier;
    if (
      options.runtimeVerificationCache === RuntimeVerificationCacheModes.BYPASS &&
      verifier.targetReady !== undefined
    ) {
      return targetInstallStateFromReadiness(target, await verifier.targetReady.run(target));
    }
    const results = await verifyTargetAspects(kit, target, options);
    return targetInstallStateFromResults(target, results);
  } catch {
    return {
      minecraft: InstallReadinessStates.UNKNOWN,
      runtime: InstallReadinessStates.UNKNOWN,
      loader: loaderApplies(target)
        ? InstallReadinessStates.UNKNOWN
        : InstallReadinessStates.NOT_APPLICABLE,
      bundle: InstallReadinessStates.UNKNOWN,
    };
  }
};

// "Ready" = the kit can verify every launch-critical aspect for this target.
export const isTargetReady = async (
  kit: MinecraftKit,
  target: Target,
  options: TargetInstallStateOptions = {},
): Promise<boolean> => isMinecraftTargetReady(await getTargetInstallState(kit, target, options));

export const isMinecraftTargetReady = (state: TargetInstallState): boolean =>
  state.minecraft === InstallReadinessStates.READY &&
  state.runtime === InstallReadinessStates.READY &&
  (state.loader === InstallReadinessStates.READY ||
    state.loader === InstallReadinessStates.NOT_APPLICABLE);

const verifyTargetAspects = async (
  kit: MinecraftKit,
  target: Target,
  options: TargetInstallStateOptions,
): Promise<readonly VerificationResult[]> => {
  const results = [
    await kit.verify.minecraft.run(target),
    await verifyRuntimeWithCache(kit, target, options),
  ];
  if (target.loader.type === Loaders.FABRIC) {
    results.push(await kit.verify.fabric.run(target));
  } else if (target.loader.type === Loaders.FORGE) {
    results.push(await kit.verify.forge.run(target));
  }
  return results;
};

const verifyRuntimeWithCache = (
  kit: MinecraftKit,
  target: Target,
  options: TargetInstallStateOptions,
): Promise<VerificationResult> => {
  if (options.runtimeVerificationCache === RuntimeVerificationCacheModes.BYPASS) {
    return kit.verify.runtime.run(target);
  }

  const key = runtimeVerificationCacheKey(target);
  const cached = runtimeVerificationCache.get(key);
  if (cached) return cached;

  const verification = kit.verify.runtime.run(target).catch((error: unknown) => {
    runtimeVerificationCache.delete(key);
    throw error;
  });
  runtimeVerificationCache.set(key, verification);
  return verification;
};

const targetInstallStateFromReadiness = (
  target: Target,
  readiness: TargetReadinessReport,
): TargetInstallState =>
  targetInstallStateFromResults(
    target,
    readiness.verifications !== undefined && readiness.verifications.length > 0
      ? readiness.verifications
      : compatibilityResults(target, readiness.isReady),
  );

const targetInstallStateFromResults = (
  target: Target,
  results: readonly VerificationResult[],
): TargetInstallState => {
  const byKind = new Map(results.map((result) => [result.kind, result]));
  return {
    minecraft: resultState(byKind.get(VerificationKinds.MINECRAFT)),
    runtime: resultState(byKind.get(VerificationKinds.RUNTIME)),
    loader: loaderState(target, byKind),
    bundle: InstallReadinessStates.UNKNOWN,
  };
};

const resultState = (result: VerificationResult | undefined): InstallReadinessState => {
  if (result === undefined) return InstallReadinessStates.UNKNOWN;
  return result.isValid ? InstallReadinessStates.READY : InstallReadinessStates.NOT_READY;
};

const loaderState = (
  target: Target,
  byKind: ReadonlyMap<VerificationResult['kind'], VerificationResult>,
): InstallReadinessState => {
  if (target.loader.type === Loaders.FABRIC)
    return resultState(byKind.get(VerificationKinds.FABRIC));
  if (target.loader.type === Loaders.FORGE) return resultState(byKind.get(VerificationKinds.FORGE));
  return InstallReadinessStates.NOT_APPLICABLE;
};

const loaderApplies = (target: Target): boolean =>
  target.loader.type === Loaders.FABRIC || target.loader.type === Loaders.FORGE;

const compatibilityResults = (target: Target, isReady: boolean): readonly VerificationResult[] => {
  const result = (kind: VerificationResult['kind']): VerificationResult => ({
    targetId: target.id,
    kind,
    isValid: isReady,
    issues: [],
    checkedFiles: 0,
    durationMs: 0,
  });
  return [
    result(VerificationKinds.MINECRAFT),
    result(VerificationKinds.RUNTIME),
    ...(target.loader.type === Loaders.FABRIC ? [result(VerificationKinds.FABRIC)] : []),
    ...(target.loader.type === Loaders.FORGE ? [result(VerificationKinds.FORGE)] : []),
  ];
};
