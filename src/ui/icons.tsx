import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />
  );
}

export const IconHome = () => (
  <Svg><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></Svg>
);
export const IconNotes = () => (
  <Svg><path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" /><path d="M14 3.5V9h5.5" /><path d="M8.5 13h7M8.5 16.5h5" /></Svg>
);
export const IconQueue = () => (
  <Svg><path d="M4 7h16M4 12h16M4 17h10" /></Svg>
);
export const IconBots = () => (
  <Svg><circle cx="7" cy="8" r="2.2" /><circle cx="17" cy="8" r="2.2" /><circle cx="12" cy="16.5" r="2.2" /><path d="M8.8 9.4 10.6 14.6M15.2 9.4 13.4 14.6" /></Svg>
);
export const IconSettings = () => (
  <Svg><path d="M4 8h10M18 8h2M4 16h4M12 16h8" /><circle cx="16" cy="8" r="2.2" /><circle cx="10" cy="16" r="2.2" /></Svg>
);
export const IconMic = () => (
  <Svg width="16" height="16"><rect x="9" y="3" width="6" height="10" rx="3" /><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5v3" /></Svg>
);
