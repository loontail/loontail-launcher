import type { SVGProps } from 'react';

export const GbFlagIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 60 36"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    preserveAspectRatio="xMidYMid slice"
    {...props}
  >
    <rect width="60" height="36" fill="#012169" />
    <path d="M0 0L60 36M60 0L0 36" stroke="#fff" strokeWidth="7.2" />
    <path d="M0 0L60 36M60 0L0 36" stroke="#C8102E" strokeWidth="4" />
    <path d="M30 0V36M0 18H60" stroke="#fff" strokeWidth="12" />
    <path d="M30 0V36M0 18H60" stroke="#C8102E" strokeWidth="7" />
  </svg>
);
