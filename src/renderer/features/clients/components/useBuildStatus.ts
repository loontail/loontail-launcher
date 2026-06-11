import { operationalId } from '@renderer/features/catalog';
import { useClientStatus } from '@renderer/features/minecraft';
import type { CatalogItem } from '@shared/contracts/catalog';
import type { InstallStatus } from '@shared/contracts/minecraft';
import { type BuildStatusGlyph, type BuildStatusTone, describeBuildStatus } from './buildStatus';

export type { BuildStatusGlyph, BuildStatusTone } from './buildStatus';
export { describeBuildStatus } from './buildStatus';

export type BuildStatusView = {
  status: InstallStatus;
  labelKey: string;
  tone: BuildStatusTone;
  glyph: BuildStatusGlyph;
};

export const useBuildStatus = (item: CatalogItem): BuildStatusView => {
  const { status } = useClientStatus(operationalId(item));
  return { status, ...describeBuildStatus(status) };
};
