import {
  DownloadCategories,
  EventTypes,
  type ProgressEvent,
  VerifyFileCategories,
  VerifyFileStatuses,
} from '@loontail/minecraft-kit';
import { createHealProgressListener } from '@main/services/bundle/healProgress';
import type { EmitProgress } from '@main/services/bundle/runner';
import { BundleSyncStatuses } from '@shared/contracts/bundle';
import { asCatalogKey } from '@shared/contracts/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SLUG = asCatalogKey('official:heal-client');

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
    target: 'Z:/client/libraries/lib.jar',
    category: DownloadCategories.LIBRARY,
  },
  bytesDownloaded,
  totalBytes,
});

type EmitCall = Parameters<EmitProgress>;

describe('createHealProgressListener', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits explicit 0/0 bytes for a verify-only HEALING emission so download totals never leak', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const calls: EmitCall[] = [];
    const emit: EmitProgress = (slug, status, patch) => {
      calls.push([slug, status, patch]);
    };
    const listener = createHealProgressListener(SLUG, emit);

    listener.onEvent(verifyEvent('Z:/client/versions/1.20.1/1.20.1.jar'));
    listener.dispose();

    expect(calls).toHaveLength(1);
    const [slug, status, patch] = calls[0] as EmitCall;
    expect(slug).toBe(SLUG);
    expect(status).toBe(BundleSyncStatuses.HEALING);
    expect(patch).toMatchObject({
      processedFiles: 1,
      bytesDownloaded: 0,
      bytesTotal: 0,
    });
  });

  it('reports real heal-download bytes when a heal download is in flight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const calls: EmitCall[] = [];
    const emit: EmitProgress = (slug, status, patch) => {
      calls.push([slug, status, patch]);
    };
    const listener = createHealProgressListener(SLUG, emit);

    listener.onEvent(downloadProgressEvent(40, 100));
    listener.dispose();

    const last = calls.at(-1) as EmitCall;
    expect(last[2]).toMatchObject({ bytesDownloaded: 40, bytesTotal: 100 });
  });
});
