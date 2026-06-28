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
import { resolveBundleRedirectUrl, validateBundleAssetDownloadUrl } from './urlPolicy';

const logger = scopedLogger('bundle.download');

export type DownloadChunkCallback = (bytes: number) => void;

export type DownloadOptions = {
  // Set of in-flight requests for the task. The downloader registers/unregisters
  // itself here so cancelSync can synchronously destroy every active socket.
  currentRequests: Set<ClientRequest>;
  signal?: AbortSignal;
  onChunk?: DownloadChunkCallback;
};

const HTTPS_PROTOCOL = 'https:';

const requestOnce = (url: string, options: DownloadOptions): Promise<IncomingMessage> =>
  new Promise<IncomingMessage>((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(validateBundleAssetDownloadUrl(url));
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
        // Bundle `/files` and manifests are now session-gated. Attach the live
        // bearer so the downloader is authorised; a CDN redirect that points
        // off-host still works because the header is dropped on cross-origin
        // hops by the server, and the policy validator already constrains hosts.
        headers: sessionAuthHeader(),
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
    // Register the settle/cleanup listeners before the abort check. If the
    // signal is already aborted on entry we reject explicitly here; otherwise a
    // destroy would fire into a Promise with no error/close listener and the
    // await would wedge forever — never releasing the operation lock (LL-106).
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

// Walk a chain of 3xx redirects up to BUNDLE_DOWNLOAD_MAX_REDIRECTS hops, then
// hand back the final 200 response stream. Throws on any non-2xx terminal.
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

// Stream the response into `${dest}.tmp`, verify the SHA-256 (when known), and
// atomically rename into place. On any failure the tmp file is removed so a
// retry starts clean.
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
  // Defensive: stale tmp from a crashed prior run.
  await fsp.rm(tmpPath, { force: true });

  const response = await followRedirects(entry.url, options);

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpPath);
    // Inline write-time hash, intentionally not routed through bundle/hash.ts
    // (which hashes by reading a file back): we digest the stream as it lands
    // to avoid a second read pass. Must use the same algorithm as hash.ts
    // (sha256) so verification stays consistent across both paths.
    const hash = createHash('sha256');
    const signal = options.signal;
    let settled = false;
    const onAbort = () => fail(new BundleError(BundleErrorCodes.ABORTED, 'Download aborted'));
    // Detach the abort listener on every settle path. `{ once: true }` only
    // auto-removes it when it actually fires, and every file in a sync shares
    // one AbortSignal, so a successful download would otherwise leave an
    // orphaned listener behind — thousands of them on a large bundle.
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
      settled = true;
      cleanup();
      if (entry.sha256) {
        const observed = hash.digest('hex');
        if (observed !== entry.sha256) {
          reject(
            new BundleError(
              BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED,
              `SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, got ${observed}`,
            ),
          );
          return;
        }
      }
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
    // Best-effort tmp cleanup — antivirus or another process may still hold
    // the handle on Windows. Worst case is a stale .tmp picked up on the next
    // sync; warn so operators can spot a persistent leak.
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
