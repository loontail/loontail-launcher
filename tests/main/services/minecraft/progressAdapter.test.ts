import {
  EventTypes,
  type MinecraftKit,
  type ProgressEvent,
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
    emitErrorEvent: vi.fn(),
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

  it('cleans up timers on dispose and stops emitting afterwards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { env, progress } = makeEnv();
    const adapter = createRepairProgressAdapter(env, SLUG);

    adapter.onEvent(verifyEvent(`${CLIENT_FOLDER}/a.jar`));
    expect(progress).toHaveBeenCalledTimes(1);

    // A second event within the throttle window schedules a pending flush
    // instead of emitting immediately.
    adapter.onEvent(verifyEvent(`${CLIENT_FOLDER}/b.jar`));
    expect(progress).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    adapter.dispose();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(progress).toHaveBeenCalledTimes(1);
  });
});
