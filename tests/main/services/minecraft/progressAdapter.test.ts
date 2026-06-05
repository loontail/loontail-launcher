import {
  DownloadCategories,
  EventTypes,
  type MinecraftKit,
  type ProgressEvent,
  VerificationKinds,
  VerifyFileCategories,
  VerifyFileStatuses,
} from '@loontail/minecraft-kit';
import type { ManagerEnv } from '@main/services/minecraft/env';
import { createRepairProgressAdapter } from '@main/services/minecraft/progressAdapter';
import { type ClientSlug, asClientSlug } from '@shared/contracts/ids';
import { ProgressStages } from '@shared/contracts/minecraft';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SLUG = asClientSlug('test-client');
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
    ops: new Map<ClientSlug, never>(),
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
