import type { CatalogItem } from '@shared/contracts/catalog';
import type { CatalogKey } from '@shared/contracts/ids';

// The cross-kind operational id that flows through the install / launch /
// repair / settings / bundle chain over IPC: the CatalogKey (`official:<slug>`
// or `local:<uuid>`). Every downstream channel, store, and settings record is
// keyed by it, so the renderer never down-casts to a bare slug/uuid.
export const operationalId = (item: CatalogItem): CatalogKey => item.key;
