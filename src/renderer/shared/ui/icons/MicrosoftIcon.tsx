import type { SVGProps } from 'react';

// Microsoft brand mark: four equal squares in red / green / blue / yellow.
// Rendered with explicit hex fills (not currentColor) because the logo is
// always shown in its trademarked colour palette.
export const MicrosoftIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <rect x="2" y="2" width="9" height="9" fill="#F35325" />
    <rect x="13" y="2" width="9" height="9" fill="#81BC06" />
    <rect x="2" y="13" width="9" height="9" fill="#05A6F0" />
    <rect x="13" y="13" width="9" height="9" fill="#FFBA08" />
  </svg>
);
