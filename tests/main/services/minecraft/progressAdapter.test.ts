import {
  DownloadCategories,
  EventTypes,
  type InstallPlan,
  type MinecraftKit,
  type ProgressEvent,
  type ProgressSnapshot,
  VerificationKinds,
  VerifyFileCategories,
  VerifyFileStatuses,
  createInstallProgressTracker,
} from '@loontail/minecraft-kit';
import type { ManagerEnv } from '@main/services/minecraft/env';
import {
  createPlannedProgressAdapter,
  createRepairProgressAdapter,
} from '@main/services/minecraft/progressAdapter';
import { type CatalogKey, asCatalogKey } from '@shared/contracts/ids';
import { type ProgressStage, ProgressStages } from '@shared/contracts/minecraft';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@loontail/minecraft-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@loontail/minecraft-kit')>();
  return { ...actual, createInstallProgressTracker: vi.fn() };
});

const SLUG = asCatalogKey('official:test-client');
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
  } as unknown as ManagerEnv;
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
    const adapter = createRepairProgressAdapter(env, SLUG);
    const file = `${CLIENT_FOLDER}/versions/1.20.1/1.20.1.jar`;

    adapter.onEvent(verifyEvent(file));

    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({
      slug: SLUG,
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
    const adapter = createRepairProgressAdapter(env, SLUG);

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
    const adapter = createRepairProgressAdapter(env, SLUG);

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
    const adapter = createRepairProgressAdapter(env, SLUG);

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
    const adapter = createRepairProgressAdapter(env, SLUG);

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
const mountPlannedAdapter = (env: ManagerEnv) => {
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
  createPlannedProgressAdapter(env, SLUG, emptyPlan);
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
      slug: SLUG,
      stage: ProgressStages.MINECRAFT,
      stagePercent: 33.333,
      // 33.333% of 1000 bytes, rounded.
      bytesDownloaded: 333,
      totalBytes: 1_000,
      speedBytesPerSec: 0,
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
      speedBytesPerSec: 0,
    });
  });

  it('reports a non-negative speed sampled over reconstructed per-stage bytes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    emit(snapshot(ProgressStages.MINECRAFT, 0, 1_000)); // 0 bytes @ t=0
    vi.setSystemTime(1_000);
    emit(snapshot(ProgressStages.MINECRAFT, 50, 1_000)); // 500 bytes @ t=1s

    const last = progress.mock.calls.at(-1)?.[0];
    // 500 bytes over 1s → 500 B/s, never negative.
    expect(last?.speedBytesPerSec).toBe(500);
    expect(last?.speedBytesPerSec).toBeGreaterThanOrEqual(0);
  });

  it('resets the speed window at a stage boundary so the rate does not dip negative', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    emit(snapshot(ProgressStages.RUNTIME, 0, 2_000));
    vi.setSystemTime(1_000);
    emit(snapshot(ProgressStages.RUNTIME, 100, 2_000)); // 2000 bytes @ t=1s, fast
    vi.setSystemTime(1_500);
    // Next stage restarts at a smaller reconstructed byte count; without a reset
    // this would compute a negative rate.
    emit(snapshot(ProgressStages.MINECRAFT, 0, 5_000));

    const last = progress.mock.calls.at(-1)?.[0];
    expect(last?.stage).toBe(ProgressStages.MINECRAFT);
    expect(last?.bytesDownloaded).toBe(0);
    // Single fresh sample in the new stage window → no rate yet, never negative.
    expect(last?.speedBytesPerSec).toBe(0);
  });

  it('resets the window on a backwards byte jump within a stage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env, progress } = makeEnv();
    const { emit } = mountPlannedAdapter(env);

    emit(snapshot(ProgressStages.MINECRAFT, 80, 1_000)); // 800 bytes
    vi.setSystemTime(1_000);
    emit(snapshot(ProgressStages.MINECRAFT, 20, 1_000)); // 200 bytes (replan)

    const last = progress.mock.calls.at(-1)?.[0];
    expect(last?.bytesDownloaded).toBe(200);
    expect(last?.speedBytesPerSec).toBe(0);
  });
});
