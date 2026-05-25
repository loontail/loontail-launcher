import type { SVGProps } from 'react';

// Loontail brand mark — the same rotated diamond used by the app bar.
// Lives as an SVG so it can sit inside an inline-flex chip without
// needing the absolute-positioned glow that the title-bar version uses.
export const LoontailMarkIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <rect
      x="6"
      y="6"
      width="12"
      height="12"
      rx="1.5"
      transform="rotate(45 12 12)"
      fill="currentColor"
    />
  </svg>
);
