const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

type FormatBytesOptions = {
  placeholder?: string;
  // 'gb' picks GB/MB, 'mb' picks MB/KB.
  maxUnit?: 'gb' | 'mb';
};

export const formatBytes = (
  bytes: number | undefined,
  { placeholder = '—', maxUnit = 'gb' }: FormatBytesOptions = {},
): string => {
  if (typeof bytes !== 'number') return placeholder;

  if (maxUnit === 'gb') {
    const gb = bytes / GB;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${(bytes / MB).toFixed(0)} MB`;
  }

  if (bytes < MB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
};
