import {
  CreateInstancePayloadSchema,
  InstanceManifestSchema,
  InstanceRegistrySchema,
} from '@shared/contracts/instance';
import { describe, expect, it } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

const minimalManifest = {
  schema: 1,
  id: UUID,
  name: 'My Build',
  minecraftVersion: '1.21.4',
  loader: { type: 'fabric', version: '0.16.9' },
  createdAt: '2026-06-07T12:00:00.000Z',
  updatedAt: '2026-06-07T12:00:00.000Z',
};

describe('InstanceManifestSchema', () => {
  it('fills defaults for omitted optional fields', () => {
    const parsed = InstanceManifestSchema.parse(minimalManifest);
    expect(parsed.runtimeVersion).toBeNull();
    expect(parsed.bundle).toEqual({ source: 'none' });
    expect(parsed.presentation).toEqual({
      description: '',
      icon: null,
      iconPreset: null,
      screenshots: [],
    });
    expect(parsed.servers).toEqual([]);
    expect(parsed.origin).toBeNull();
  });

  it('round-trips a fully-specified remote-bundle manifest', () => {
    const full = {
      ...minimalManifest,
      runtimeVersion: 'java-runtime-delta',
      bundle: {
        source: 'remote',
        bundleSlug: 'survival',
        manifestUrl: 'https://cdn.example/m.json',
      },
      presentation: { description: 'desc', icon: 'icon.png', screenshots: ['a.png', 'b.png'] },
      origin: { source: 'official', slug: 'flagship' },
    };
    const parsed = InstanceManifestSchema.parse(full);
    expect(parsed.bundle).toMatchObject({ source: 'remote', bundleSlug: 'survival' });
    expect(parsed.origin).toMatchObject({ source: 'official', slug: 'flagship' });
  });

  it('rejects a non-uuid id', () => {
    expect(InstanceManifestSchema.safeParse({ ...minimalManifest, id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects an empty name', () => {
    expect(InstanceManifestSchema.safeParse({ ...minimalManifest, name: '' }).success).toBe(false);
  });

  it('rejects an unknown loader type', () => {
    expect(
      InstanceManifestSchema.safeParse({
        ...minimalManifest,
        loader: { type: 'quilt', version: '1' },
      }).success,
    ).toBe(false);
  });

  it('rejects a remote bundle without a manifest url', () => {
    expect(
      InstanceManifestSchema.safeParse({
        ...minimalManifest,
        bundle: { source: 'remote', bundleSlug: 'survival' },
      }).success,
    ).toBe(false);
  });
});

describe('InstanceRegistrySchema', () => {
  it('defaults to an empty instances list', () => {
    expect(InstanceRegistrySchema.parse({ schema: 1 }).instances).toEqual([]);
  });

  it('parses a populated index', () => {
    const parsed = InstanceRegistrySchema.parse({
      schema: 1,
      instances: [
        { id: UUID, name: 'B', dir: `/x/local/${UUID}`, updatedAt: '2026-06-07T12:00:00.000Z' },
      ],
    });
    expect(parsed.instances).toHaveLength(1);
  });
});

describe('CreateInstancePayloadSchema', () => {
  it('accepts a minimal create payload', () => {
    const parsed = CreateInstancePayloadSchema.parse({
      name: 'Fresh',
      minecraftVersion: '1.21.4',
      loader: 'vanilla',
    });
    expect(parsed.loaderVersion).toBeUndefined();
  });

  it('rejects a blank name', () => {
    expect(
      CreateInstancePayloadSchema.safeParse({
        name: '',
        minecraftVersion: '1.21.4',
        loader: 'vanilla',
      }).success,
    ).toBe(false);
  });
});
