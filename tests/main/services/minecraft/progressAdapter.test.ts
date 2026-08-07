import {
  createInstallProgressTracker,
  DownloadCategories,
  EventTypes,
  type InstallPlan,
  type MinecraftKit,
  type ProgressEvent,
  type ProgressSnapshot,
  VerificationKinds,
  VerifyFileCategories,
  VerifyFileStatuses,
} from '@loontail/minecraft-kit';
import type { MinecraftEnv } from '@main/services/minecraft/env';
import {
  createPlannedProgressAdapter,
  createRepairProgressAdapter,
} from '@main/services/minecraft/progressAdapter';
import { asCatalogKey, type CatalogKey } from '@shared/contracts/ids';
import { type ProgressStage, ProgressStages } from '@shared/contracts/minecraft';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@loontail/minecraft-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@loontail/minecraft-kit')>();
  return { ...actual, createInstallProgressTracker: vi.fn() };
});

const KEY = asCatalogKey('official:test-client');
const CLIENT_FOLDER = 'Z:/client';

const makeEnv = () => {
  const progress = vi.fn();
  const broadcaster = {
    status: vi.fn(),
    progress,
    log: vi.fn(),
    error: vi.fn(),
  };
  const env = {
    kit: {} as MinecraftKit,
    broadcaster,
    ops: new Map<CatalogKey, never>(),
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      silly: vi.fn(),
      verbose: vi.fn(),
      warn: vi.fn(),
    },
    emitStatus: broadcaster.status,
    emitError: vi.fn(),
    persistRuntime: vi.fn(),
    clearRuntimeOverride: vi.fn(),
  } as unknown as MinecraftEnv;
  return { env, progress };
};

const verifyEvent = (path: string): ProgressEvent => ({
  type: EventTypes.VERIFY_FILE_CHECKED,
  file: {
    path,
    category: VerifyFileCategories.CLIENT_JAR,
    status: VerifyFileStatuses.MISSING,
  },
});

const downloadProgressEvent = (bytesDownloaded: number, totalBytes: number): ProgressEvent => ({
  type: EventTypes.DOWNLOAD_PROGRESS,
  file: {
    url: 'https://files.test.invalid/lib.jar',
    target: `${CLIENT_FOLDER}/libraries/lib.jar`,
    category: DownloadCategories.LIBRARY,
  },
  bytesDownloaded,
  totalBytes,
});

describe('createRepairProgressAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits a MinecraftProgressEvent of the correct shape through broadcaster.progress', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { env, progress } = makeEnv();
    const adapter = createRepairProgressAdapter(env, KEY);
    const file = `${CLIENT_FOLDER}/versions/1.20.1/1.20.1.jar`;

    adapter.onEvent(verifyEvent(file));

    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({
      key: KEY,
      stage: ProgressStages.MINECRAFT,
      stagePercent: 0,
      overallPercent: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      currentFile: file,
    });

    adapter.dispose();
  });

  it('lets a typed verification aspect override the file-category stage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { env, progress } = makeEnv();
    const adapter = createRepairProgressAdapter(env, KEY);

    // CLIENT_JAR normally maps to MINECRAFT, but a RUNTIME aspect tag wins.
    adapter.onEvent({
      ...verifyEvent(`${CLIENT_FOLDER}/a.jar`),
      aspect: VerificationKinds.RUNTIME,
    });

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: ProgressStages.RUNTIME }),
    );

    adapter.dispose();
  });

  it('falls back to the file category when no aspect is tagged', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { env, progress } = makeEnv();
    const adapter = createRepairProgressAdapter(env, KEY);

    adapter.onEvent(verifyEvent(`${CLIENT_FOLDER}/a.jar`));

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: ProgressStages.MINECRAFT }),
    );

    adapter.dispose();
  });

  it('reports a clamped, non-decreasing download percent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { env, progress } = makeEnv();
    const adapter = createRepairProgressAdapter(env, KEY);

    // First event emits immediately; later events within the throttle window are
    // coalesced and surfaced by dispose's flush.
    adapter.onEvent(downloadProgressEvent(25, 100));
    adapter.onEvent(downloadProgressEvent(150, 100));
    adapter.dispose();

    const percents = progress.mock.calls.map((call) => call[0].overallPercent as number);
    expect(percents[0]).toBe(25);
    // Over-reported bytes are clamped to 100, and the sequence never decreases.
    expect(percents.at(-1)).toBe(100);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1] as number);
    }
    // overallPercent mirrors stagePercent for the single repair download stage.
    for (const call of progress.mock.calls) {
      expect(call[0].overallPercent).toBe(call[0].stagePercent);
    }
  });

  it('flushes the pending progress on dispose and stops emitting afterwards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { env, progress } = makeEnv();
    const adapter = createRepairProgressAdapter(env, KEY);

    adapter.onEvent(verifyEvent(`${CLIENT_FOLDER}/a.jar`));
    expect(progress).toHaveBeenCalledTimes(1);

    // A second event within the throttle window schedules a pending flush
    // instead of emitting immediately.
    const lastFile = `${CLIENT_FOLDER}/b.jar`;
    adapter.onEvent(verifyEvent(lastFile));
    expect(progress).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    // dispose flushes the pending event so the final count is never dropped,
    // then cancels the timer.
    adapter.dispose();
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ currentFile: lastFile }));
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(progress).toHaveBeenCalledTimes(2);
  });
});

const snapshot = (
  stage: ProgressStage,
  stagePercent: number,
  totalBytes: number,
  overallPercent = stagePercent,
): ProgressSnapshot => ({ stage, stagePercent, overallPercent, bytesDownloaded: 0, totalBytes });

const emptyPlan: Pick<InstallPlan, 'actions'> = { actions: [] };

// Captures the listener the planned adapter registers so the test can feed it
// synthetic snapshots without building a real InstallPlan.
const mountPlannedAdapter = (env: MinecraftEnv) => {
  let listener: ((s: ProgressSnapshot) => void) | undefined;
  vi.mocked(createInstallProgressTracker).mockReturnValue({
    onEvent: vi.fn(),
    snapshot: vi.fn(),
    finish: vi.fn(),
    subscribe: (l) => {
      listener = l;
      return vi.fn();
    },
  });
  createPlannedProgressAdapter(env, KEY, emptyPlan);
  return { emit: (s: ProgressSnapshot) => listener?.(s) };
};

describe('createPlannedProgressAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(createInstallProgressTracker).mockReset();
  });

  it('reconstructs per-stage bytes from stagePercent and rounds before IPC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    emit(snapshot(ProgressStages.MINECRAFT, 33.333, 1_000));

    expect(progress).toHaveBeenCalledTimes(1);
    const event = progress.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      key: KEY,
      stage: ProgressStages.MINECRAFT,
      stagePercent: 33.333,
      // 33.333% of 1000 bytes, rounded.
      bytesDownloaded: 333,
      totalBytes: 1_000,
    });
    expect(Number.isInteger(event?.bytesDownloaded)).toBe(true);
  });

  it('emits monotonically rising per-stage bytes as the stage advances', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    for (const percent of [10, 25, 60, 100]) {
      vi.setSystemTime(percent * 10);
      emit(snapshot(ProgressStages.MINECRAFT, percent, 1_000));
    }

    const bytes = progress.mock.calls.map((call) => call[0].bytesDownloaded as number);
    expect(bytes).toEqual([100, 250, 600, 1_000]);
    for (let i = 1; i < bytes.length; i += 1) {
      expect(bytes[i]).toBeGreaterThanOrEqual(bytes[i - 1] as number);
    }
  });

  it('emits zero bytes when the stage total is unknown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    emit(snapshot(ProgressStages.PREPARE, 50, 0));

    expect(progress.mock.calls[0]?.[0]).toMatchObject({
      bytesDownloaded: 0,
      totalBytes: 0,
    });
  });

  it('derives bytes from the snapshot alone, so a stage change carries nothing forward', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    emit(snapshot(ProgressStages.RUNTIME, 100, 2_000));
    emit(snapshot(ProgressStages.MINECRAFT, 0, 5_000));

    const last = progress.mock.calls.at(-1)?.[0];
    expect(last?.stage).toBe(ProgressStages.MINECRAFT);
    expect(last?.bytesDownloaded).toBe(0);
    expect(last?.totalBytes).toBe(5_000);
  });
});
