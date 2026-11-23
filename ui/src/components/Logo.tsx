import { useId } from 'react';

/** Brand mark: a chat bubble with "AI". Decorative; the title next to it names the app. */
export function Logo({ size }: { size: number }) {
  const gid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b7cff" />
          <stop offset="1" stopColor="#3b5bdb" />
        </linearGradient>
      </defs>
      <path
        d="M32 22 A34 34 0 1 1 30 77 L18 88 L22 70"
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="52" y="50" textAnchor="middle" dominantBaseline="central" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="29" fill={`url(#${gid})`}>
        AI
      </text>
    </svg>
  );
}
