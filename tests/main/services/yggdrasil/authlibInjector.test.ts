import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));

import {
  authlibInjectorJarName,
  buildAuthlibInjectorJvmArg,
  resolveAuthlibInjectorJarPath,
} from '@main/services/yggdrasil/authlibInjector';

const VENDOR_DIR_ENV = 'LOONTAIL_AUTHLIB_INJECTOR_VENDOR_DIR';

let vendorDir = '';

beforeEach(async () => {
  vendorDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loontail-authlib-test-'));
  process.env[VENDOR_DIR_ENV] = vendorDir;
});

afterEach(async () => {
  delete process.env[VENDOR_DIR_ENV];
  await fs.rm(vendorDir, { recursive: true, force: true });
});

describe('authlibInjectorJarName', () => {
  it('derives the filename from the version constant', () => {
    expect(authlibInjectorJarName()).toMatch(/^authlib-injector-\d+\.\d+\.\d+\.jar$/);
  });
});

describe('resolveAuthlibInjectorJarPath', () => {
  it('returns the jar inside the vendor dir when it is present', async () => {
    const jarPath = path.join(vendorDir, authlibInjectorJarName());
    await fs.writeFile(jarPath, 'stub');
    expect(resolveAuthlibInjectorJarPath()).toBe(jarPath);
  });

  it('throws authlib_injector_missing when the jar is absent', async () => {
    await fs.writeFile(path.join(vendorDir, 'authlib-injector-0.0.0.jar'), 'wrong version');
    try {
      resolveAuthlibInjectorJarPath();
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(YggdrasilError);
      expect((err as YggdrasilError).code).toBe(YggdrasilErrorCodes.AUTHLIB_INJECTOR_MISSING);
      expect((err as YggdrasilError).context).toEqual({
        dir: vendorDir,
        files: ['authlib-injector-0.0.0.jar'],
      });
    }
  });
});

describe('buildAuthlibInjectorJvmArg', () => {
  it('produces the canonical -javaagent string', () => {
    expect(
      buildAuthlibInjectorJvmArg({
        jarPath: '/opt/x/authlib-injector-1.2.5.jar',
        apiRoot: 'https://example.test/api/yggdrasil',
      }),
    ).toBe('-javaagent:/opt/x/authlib-injector-1.2.5.jar=https://example.test/api/yggdrasil');
  });
});
