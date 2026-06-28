import type { ClientSettingsOverride } from '@shared/contracts/settings';
import {
  migrateClientOverrideKey,
  migrateClientOverrides,
  migrateLastPlayedKeys,
} from '@shared/domain/settings';
import { describe, expect, it } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('migrateClientOverrideKey', () => {
  it('lifts a bare slug onto the official namespace', () => {
    expect(migrateClientOverrideKey('survival')).toBe('official:survival');
  });

  it('lifts a bare uuid onto the local namespace', () => {
    expect(migrateClientOverrideKey(UUID)).toBe(`local:${UUID}`);
  });

  it('passes an already-namespaced key through unchanged (idempotent)', () => {
    expect(migrateClientOverrideKey('official:survival')).toBe('official:survival');
    expect(migrateClientOverrideKey(`local:${UUID}`)).toBe(`local:${UUID}`);
  });
});

describe('migrateClientOverrides', () => {
  const override = (ram: number): ClientSettingsOverride => ({ memory: { allocatedRamMb: ram } });

  it('rehydrates a bare-slug override under official:<slug>', () => {
    const result = migrateClientOverrides({ survival: override(4096) });
    expect(result).toEqual({ 'official:survival': override(4096) });
  });

  it('rehydrates a bare-uuid override under local:<uuid>', () => {
    const result = migrateClientOverrides({ [UUID]: override(2048) });
    expect(result).toEqual({ [`local:${UUID}`]: override(2048) });
  });

  it('returns the same reference when nothing needs migrating', () => {
    const input = { 'official:survival': override(4096) };
    expect(migrateClientOverrides(input)).toBe(input);
  });
});

describe('migrateLastPlayedKeys', () => {
  it('rehydrates bare keys and keeps the most recent timestamp on a collision', () => {
    const result = migrateLastPlayedKeys({ survival: 100, 'official:survival': 200 });
    expect(result).toEqual({ 'official:survival': 200 });
  });

  it('returns the same reference when every key is already namespaced', () => {
    const input = { 'official:survival': 100, [`local:${UUID}`]: 200 };
    expect(migrateLastPlayedKeys(input)).toBe(input);
  });
});
