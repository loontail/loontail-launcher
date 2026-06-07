import { operationalId } from '@renderer/features/catalog/buildIdentity';
import type { CatalogItem } from '@shared/contracts/catalog';
import { describe, expect, it } from 'vitest';

const UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('operationalId', () => {
  it('uses the Strapi slug for an official build', () => {
    const item = {
      kind: 'official',
      ref: { source: 'official', slug: 'survival' },
    } as unknown as CatalogItem;
    expect(operationalId(item)).toBe('survival');
  });

  it('uses the instance UUID for a local build', () => {
    const item = {
      kind: 'local',
      ref: { source: 'local', id: UUID },
    } as unknown as CatalogItem;
    expect(operationalId(item)).toBe(UUID);
  });
});
