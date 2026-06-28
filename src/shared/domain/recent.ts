// Pick played items, most-recent first.
export const selectRecent = <T extends { key: string }>(
  playedAt: Record<string, number>,
  items: readonly T[],
  limit: number,
): T[] => {
  if (limit <= 0) return [];
  const played = items
    .map((item, index) => ({ item, index, at: playedAt[item.key] }))
    .filter((entry): entry is { item: T; index: number; at: number } => entry.at !== undefined);
  // DESC by timestamp; ties fall back to input order for a stable sort.
  played.sort((a, b) => b.at - a.at || a.index - b.index);
  return played.slice(0, limit).map((entry) => entry.item);
};
