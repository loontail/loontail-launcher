import type { SVGProps } from 'react';

// Cape silhouette — V-collar at the top (shoulders), flowing sides that
// widen, and a pointed bottom — topped with an upload chevron. The
// collar V is what visually separates it from a generic shield/flag and
// reads as a cape at a glance.
export const CapeUploadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    {/* Upload chevron */}
    <path d="M12 2.5 V6" />
    <path d="M9 5 L12 2 L15 5" />
    {/* Cape: shoulder V, flared sides, pointed hem */}
    <path d="M7.5 8 L12 10 L16.5 8" />
    <path d="M7.5 8 Q5.5 14 6.5 21 L12 18.5 L17.5 21 Q18.5 14 16.5 8" />
  </svg>
);
