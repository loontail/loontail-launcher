import { RovingGroup } from '@renderer/shared/ui/RovingGroup';
import type { CatalogItem } from '@shared/contracts/catalog';
import { RecentCard } from './RecentCard';

type RecentStripProps = {
  items: CatalogItem[];
};

// Responsive grid of RecentCards that reflows its column count by width. A single
// roving-tabindex group: one tab stop, arrow keys move between cards.
export const RecentStrip = ({ items }: RecentStripProps) => (
  <RovingGroup
    className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3"
    resetKey={items.length}
  >
    {items.map((item) => (
      <RecentCard key={item.key} item={item} />
    ))}
  </RovingGroup>
);
