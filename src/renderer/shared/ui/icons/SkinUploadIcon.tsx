import type { SVGProps } from 'react';

export const SkinUploadIcon = (props: SVGProps<SVGSVGElement>) => (
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
    <path d="M12 2.5 V6" />
    <path d="M9 5 L12 2 L15 5" />
    <path d="M9 8 L4 10 L6 13.5 L9 12.5 V22 H15 V12.5 L18 13.5 L20 10 L15 8" />
    <path d="M9 8 Q12 10.5 15 8" />
  </svg>
);
