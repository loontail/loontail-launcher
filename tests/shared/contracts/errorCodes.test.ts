import { ERROR_CODES } from '@shared/constants/errorCodes';
import { LOGIN_ERROR_CODE } from '@shared/contracts/auth';
import { BundleErrorCodes } from '@shared/contracts/bundle';
import { MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { SkinErrorCodes } from '@shared/contracts/skin';
import { SystemErrorCodes } from '@shared/contracts/system';
import { describe, expect, it } from 'vitest';

// Every registry below lands in the same `IpcError.code` field, so a value shared
// by two of them makes the code ambiguous at the renderer: the same string would
// have to be routed to two different remediations.
const REGISTRIES = {
  ERROR_CODES,
  MinecraftErrorCodes,
  BundleErrorCodes,
  SkinErrorCodes,
  SystemErrorCodes,
  LOGIN_ERROR_CODE,
} as const;

describe('IpcError code registries', () => {
  it('never emit the same code value from two registries', () => {
    const owners = new Map<string, string[]>();
    for (const [registry, codes] of Object.entries(REGISTRIES)) {
      for (const value of Object.values(codes)) {
        owners.set(value, [...(owners.get(value) ?? []), registry]);
      }
    }
    const collisions = [...owners.entries()]
      .filter(([, registries]) => registries.length > 1)
      .map(([value, registries]) => `${value}: ${registries.join(' + ')}`);
    expect(collisions).toEqual([]);
  });

  it('namespaces every domain code so its subsystem is readable off the wire', () => {
    const domainPrefixes: Record<string, string> = {
      MinecraftErrorCodes: 'minecraft/',
      BundleErrorCodes: 'bundle/',
      SkinErrorCodes: 'skin/',
      SystemErrorCodes: 'system/',
      LOGIN_ERROR_CODE: 'auth/',
    };
    for (const [registry, prefix] of Object.entries(domainPrefixes)) {
      for (const value of Object.values(REGISTRIES[registry as keyof typeof REGISTRIES])) {
        expect(value.startsWith(prefix), `${registry}: ${value}`).toBe(true);
      }
    }
  });

  it('keys every registry in SCREAMING_SNAKE_CASE', () => {
    for (const [registry, codes] of Object.entries(REGISTRIES)) {
      for (const key of Object.keys(codes)) {
        expect(/^[A-Z][A-Z0-9_]*$/.test(key), `${registry}: ${key}`).toBe(true);
      }
    }
  });
});
