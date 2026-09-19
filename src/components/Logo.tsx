/**
 * The ColdChain seal: a thin double ring like a wax stamp, a six-arm ice
 * crystal, and a square of tempered chocolate at its heart. Gold on cocoa in
 * the header; pass `tone="dark"` for cocoa lines on a light ground.
 */
export function Logo({ size = 40, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  const line = tone === 'light' ? '#d9b878' : '#2b1a12'
  const choc = tone === 'light' ? '#8a5a3a' : '#4a2c1c'
  const gloss = tone === 'light' ? '#c08a5c' : '#8a5a3a'
  const arms = [0, 60, 120, 180, 240, 300]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="none" stroke={line} strokeWidth="1.4" />
      <circle cx="24" cy="24" r="18.6" fill="none" stroke={line} strokeWidth="0.6" opacity="0.8" />
      <g stroke={line} strokeWidth="1.5" strokeLinecap="round" fill="none">
        {arms.map((a) => (
          <g key={a} transform={`rotate(${a} 24 24)`}>
            <line x1="24" y1="24" x2="24" y2="8.5" />
            <line x1="24" y1="12.5" x2="21.2" y2="9.7" />
            <line x1="24" y1="12.5" x2="26.8" y2="9.7" />
          </g>
        ))}
      </g>
      <g transform="rotate(45 24 24)">
        <rect x="19.6" y="19.6" width="8.8" height="8.8" rx="1.2" fill={choc} stroke={line} strokeWidth="0.9" />
        <path d="M21 26.6 L21 21 L26.6 21" fill="none" stroke={gloss} strokeWidth="1" strokeLinecap="round" />
      </g>
    </svg>
  )
}
