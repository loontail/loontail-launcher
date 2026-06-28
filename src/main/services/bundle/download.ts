import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http, { type ClientRequest, type IncomingMessage } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { URL } from 'node:url';
import {
  BUNDLE_DOWNLOAD_MAX_REDIRECTS,
  BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS,
} from '@main/constants/bundle';
import { atomicReplace } from '@main/infra/atomicFile';
import { errorMessage } from '@main/infra/errorMessage';
import { sessionAuthHeader } from '@main/infra/http';
import { scopedLogger } from '@main/infra/logger';
import { BundleErrorCodes, type RemoteManifestEntry } from '@shared/contracts/bundle';
import { BundleError } from './errors';
import {
  isTrustedBundleAssetUrl,
  resolveBundleRedirectUrl,
  validateBundleAssetDownloadUrl,
} from './urlPolicy';

const logger = scopedLogger('bundle.download');

export type DownloadChunkCallback = (bytes: number) => void;

export type DownloadOptions = {
  // In-flight requests for the task, so cancelSync can synchronously destroy
  // every active socket.
  currentRequests: Set<ClientRequest>;
  signal?: AbortSignal;
  onChunk?: DownloadChunkCallback;
};

const HTTPS_PROTOCOL = 'https:';

const requestOnce = (url: string, options: DownloadOptions): Promise<IncomingMessage> =>
  new Promise<IncomingMessage>((resolve, reject) => {
    let parsed: URL;
    let validatedUrl: string;
    try {
      validatedUrl = validateBundleAssetDownloadUrl(url);
      parsed = new URL(validatedUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const transport = parsed.protocol === HTTPS_PROTOCOL ? https : http;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        // Attach the bearer only when the host is the trusted API origin, so the
        // secret is never sent off-host (SSRF/bearer-exfil defense).
        headers: isTrustedBundleAssetUrl(validatedUrl) ? sessionAuthHeader() : {},
        timeout: BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        resolve(res);
      },
    );
    options.currentRequests.add(req);
    const onAbort = () => {
      req.destroy(new BundleError(BundleErrorCodes.ABORTED, 'Download aborted'));
    };
    // Register settle/cleanup listeners before the abort check, else an
    // already-aborted signal would destroy into a Promise with no error/close
    // listener and wedge the await forever — never releasing the lock (LL-106).
    req.on('error', (err) => {
      options.currentRequests.delete(req);
      options.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy(
        new BundleError(
          BundleErrorCodes.DOWNLOAD_FAILED,
          `Request timed out after ${BUNDLE_DOWNLOAD_REQUEST_TIMEOUT_MS}ms`,
        ),
      );
    });
    req.on('close', () => {
      options.currentRequests.delete(req);
      options.signal?.removeEventListener('abort', onAbort);
    });
    if (options.signal) {
      if (options.signal.aborted) {
        options.currentRequests.delete(req);
        req.destroy();
        reject(new BundleError(BundleErrorCodes.ABORTED, 'Download aborted'));
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.end();
  });

const followRedirects = async (url: string, options: DownloadOptions): Promise<IncomingMessage> => {
  const initial = validateBundleAssetDownloadUrl(url);
  let current = initial;
  for (let hop = 0; hop <= BUNDLE_DOWNLOAD_MAX_REDIRECTS; hop++) {
    const res = await requestOnce(current, options);
    const status = res.statusCode ?? 0;
    if (status >= 200 && status < 300) return res;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      current = resolveBundleRedirectUrl(res.headers.location, current, initial);
      continue;
    }
    res.resume();
    throw new BundleError(BundleErrorCodes.DOWNLOAD_FAILED, `HTTP ${status} for ${current}`);
  }
  throw new BundleError(BundleErrorCodes.DOWNLOAD_FAILED, `Too many redirects fetching ${url}`);
};

export const downloadEntry = async (
  entry: RemoteManifestEntry,
  destPath: string,
  options: DownloadOptions,
): Promise<void> => {
  if (!entry.url) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Manifest entry ${entry.path} has no URL`,
    );
  }
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.tmp`;
  await fsp.rm(tmpPath, { force: true });

  const response = await followRedirects(entry.url, options);

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpPath);
    // Digest the stream as it lands to avoid a second read pass; must stay sha256
    // to match hash.ts so verification is consistent across both paths.
    const hash = createHash('sha256');
    const signal = options.signal;
    let settled = false;
    const onAbort = () => fail(new BundleError(BundleErrorCodes.ABORTED, 'Download aborted'));
    // Detach on every settle path: `{ once: true }` only auto-removes on fire,
    // and every file in a sync shares one signal — a success would otherwise
    // leak a listener per file (thousands on a large bundle).
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      response.destroy();
      writeStream.destroy();
      reject(err);
    };
    response.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      options.onChunk?.(chunk.length);
    });
    response.on('error', fail);
    writeStream.on('error', fail);
    writeStream.on('finish', () => {
      if (settled) return;
      if (entry.sha256) {
        const observed = hash.digest('hex');
        if (observed !== entry.sha256) {
          // Route through fail() to share the settle/cleanup/teardown semantics
          // of every other reject path.
          fail(
            new BundleError(
              BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED,
              `SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${observed}`,
            ),
          );
          return;
        }
      }
      settled = true;
      cleanup();
      resolve();
    });
    if (signal) {
      if (signal.aborted) {
        fail(new BundleError(BundleErrorCodes.ABORTED, 'Download aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    response.pipe(writeStream);
  }).catch(async (err: unknown) => {
    // Best-effort tmp cleanup — on Windows antivirus may still hold the handle;
    // warn so a persistent leak is visible.
    await fsp
      .rm(tmpPath, { force: true })
      .catch((rmErr: unknown) => logger.warn(`Failed to remove tmp ${tmpPath}`, rmErr));
    if (err instanceof BundleError) throw err;
    if (options.signal?.aborted) {
      throw new BundleError(BundleErrorCodes.ABORTED, 'Download aborted');
    }
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Failed to download ${entry.path}: ${errorMessage(err)}`,
    );
  });

  try {
    await atomicReplace(tmpPath, destPath, (rmErr: unknown) =>
      logger.warn(`Failed to remove tmp ${tmpPath}`, rmErr),
    );
  } catch (err) {
    throw new BundleError(
      BundleErrorCodes.DOWNLOAD_FAILED,
      `Failed to install ${entry.path}: ${errorMessage(err)}`,
    );
  }
};
