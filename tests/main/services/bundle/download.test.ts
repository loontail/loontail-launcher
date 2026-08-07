import { once } from 'node:events';
import fs from 'node:fs/promises';
import http, {
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerSessionAuthPort } from '@main/infra/http';
import { downloadEntry } from '@main/services/bundle/download';
import { BundleErrorCodes, type RemoteManifestEntry } from '@shared/contracts/bundle';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type TestServer = {
  server: Server;
  origin: string;
};

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

const TEST_ENTRY_PATH = 'mods/example.jar';
const TEST_FILE_BODY = 'bundle file body';

const startServer = async (handler: RequestHandler): Promise<TestServer> => {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP test server address');
  }
  return {
    server,
    origin: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
};

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
};

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const makeEntry = (url: string, sha256?: string): RemoteManifestEntry => ({
  path: TEST_ENTRY_PATH,
  name: 'example.jar',
  size: TEST_FILE_BODY.length,
  isDir: false,
  url,
  ...(sha256 ? { sha256 } : {}),
});

describe('downloadEntry URL policy', () => {
  let tempDir: string;
  const servers: Server[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'bundle-download-'));
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows HTTP downloads from loopback development hosts', async () => {
    const { server, origin } = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(TEST_FILE_BODY);
    });
    servers.push(server);
    const targetPath = path.join(tempDir, TEST_ENTRY_PATH);

    await downloadEntry(makeEntry(`${origin}/files/example.jar`), targetPath, {
      currentRequests: new Set(),
    });

    await expect(fs.readFile(targetPath, 'utf8')).resolves.toBe(TEST_FILE_BODY);
  });

  it('rejects ABORTED and clears currentRequests when the signal is already aborted', async () => {
    const currentRequests = new Set<ClientRequest>();
    const controller = new AbortController();
    controller.abort();
    const targetPath = path.join(tempDir, TEST_ENTRY_PATH);

    await expect(
      downloadEntry(makeEntry('http://127.0.0.1:1/files/example.jar'), targetPath, {
        currentRequests,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: BundleErrorCodes.ABORTED });

    expect(currentRequests.size).toBe(0);
    await expect(exists(targetPath)).resolves.toBe(false);
    await expect(exists(`${targetPath}.tmp`)).resolves.toBe(false);
  });

  it('rejects with DOWNLOAD_INTEGRITY_FAILED and removes the tmp on a SHA-256 mismatch', async () => {
    const { server, origin } = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(TEST_FILE_BODY);
    });
    servers.push(server);
    const targetPath = path.join(tempDir, TEST_ENTRY_PATH);

    await expect(
      downloadEntry(makeEntry(`${origin}/files/example.jar`, 'deadbeef'.repeat(8)), targetPath, {
        currentRequests: new Set(),
      }),
    ).rejects.toMatchObject({ code: BundleErrorCodes.DOWNLOAD_INTEGRITY_FAILED });

    // fail()'s shared cleanup path removes the tmp and never installs the file.
    await expect(exists(targetPath)).resolves.toBe(false);
    await expect(exists(`${targetPath}.tmp`)).resolves.toBe(false);
  });

  it('never sends the session bearer to a non-API host, even a reachable local one', async () => {
    // The loopback host is reachable (dev servers, these tests) but classifies as
    // `public`, so a crafted manifest entry pointing at it must download bare.
    // API_URL in tests is http://test.invalid, so 127.0.0.1 is NOT the API origin.
    registerSessionAuthPort({
      getToken: () => 'live-session-token',
      refresh: () => Promise.resolve('live-session-token'),
    });
    let seenAuthorization: string | undefined = 'unset';
    const { server, origin } = await startServer((request, response) => {
      seenAuthorization = request.headers.authorization;
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(TEST_FILE_BODY);
    });
    servers.push(server);

    await downloadEntry(
      makeEntry(`${origin}/files/example.jar`),
      path.join(tempDir, TEST_ENTRY_PATH),
      { currentRequests: new Set() },
    );

    expect(seenAuthorization).toBeUndefined();
  });

  it('rejects redirects to unexpected origins before writing the file', async () => {
    const { server, origin } = await startServer((_request, response) => {
      response.writeHead(302, { Location: 'http://example.test/files/example.jar' });
      response.end();
    });
    servers.push(server);
    const targetPath = path.join(tempDir, TEST_ENTRY_PATH);

    await expect(
      downloadEntry(makeEntry(`${origin}/files/example.jar`), targetPath, {
        currentRequests: new Set(),
      }),
    ).rejects.toMatchObject({ code: BundleErrorCodes.DOWNLOAD_FAILED });

    await expect(exists(targetPath)).resolves.toBe(false);
    await expect(exists(`${targetPath}.tmp`)).resolves.toBe(false);
  });
});
