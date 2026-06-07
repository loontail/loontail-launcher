import type { CatalogItem } from '@shared/contracts/catalog';
import { SourceKinds } from '@shared/contracts/catalog';
import type { ClientSlug } from '@shared/contracts/ids';

// The opaque operational id that flows through the slug-keyed install / launch /
// repair / settings chain: the Strapi slug for official builds, the instance
// UUID for local builds. Typed as ClientSlug because every downstream IPC and
// store is keyed by it; the two id keyspaces never overlap.
export const operationalId = (item: CatalogItem): ClientSlug =>
  (item.ref.source === SourceKinds.OFFICIAL ? item.ref.slug : item.ref.id) as unknown as ClientSlug;
