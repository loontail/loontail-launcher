import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Register the custom `--text-*` size tokens under `font-size` so tailwind-merge
// keeps size and colour as independent groups; otherwise it drops the size when
// both appear in one `cn(...)` call.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display',
            'h1',
            'h2',
            'body',
            'body-med',
            'eyebrow',
            'caption',
            'microlabel',
            'console-body',
            'console-meta',
            'console-badge',
            'progress-label',
            'progress-value',
          ],
        },
      ],
    },
  },
});

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
