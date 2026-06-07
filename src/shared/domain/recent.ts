// Pick the items the user has played, most-recent first. Powers the Home
// "Continue" hero and "Recently played" strip. Pure: the played-at map is
// persisted in the main store and the catalog comes from the renderer query,
// so this stays unit-testable in isolation.
export const selectRecent = <T extends { key: string }>(
  playedAt: Record<string, number>,
  items: readonly T[],
  limit: number,
): T[] => {
  if (limit <= 0) return [];
  const played = items
    .map((item, index) => ({ item, index, at: playedAt[item.key] }))
    .filter((entry): entry is { item: T; index: number; at: number } => entry.at !== undefined);
  // DESC by timestamp; ties fall back to input order so the sort stays stable
  // across engines that do not guarantee it.
  played.sort((a, b) => b.at - a.at || a.index - b.index);
  return played.slice(0, limit).map((entry) => entry.item);
};
