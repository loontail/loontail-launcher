import { useClientStatus } from '@renderer/features/minecraft';
import type { CatalogItem } from '@shared/contracts/catalog';
import type { InstallStatus } from '@shared/contracts/minecraft';
import { type BuildStatusGlyph, describeBuildStatus } from './buildStatus';

export type { BuildStatusGlyph } from './buildStatus';
export { describeBuildStatus } from './buildStatus';

export type BuildStatusView = {
  status: InstallStatus;
  labelKey: string;
  glyph: BuildStatusGlyph;
};

export const useBuildStatus = (item: CatalogItem): BuildStatusView => {
  const { status } = useClientStatus(item.key);
  return { status, ...describeBuildStatus(status) };
};
