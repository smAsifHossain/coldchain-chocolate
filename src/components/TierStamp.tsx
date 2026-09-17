import type { Decision, Tier } from '../engine'

const SHORT: Record<Tier, string> = { none: 'No thermal', single: 'Single thermal', double: 'Double + ice' }

export function TierStamp({ tier, status, size = 'md' }: { tier: Tier; status?: Decision['status']; size?: 'md' | 'lg' }) {
  const review = status && status !== 'ok'
  const cls = review ? 'stamp-review' : `stamp-${tier}`
  const label = review ? (status === 'no_forecast' ? 'No forecast' : 'Check by hand') : SHORT[tier]
  return (
    <span className={`stamp ${cls}`} style={size === 'lg' ? { fontSize: '0.95rem', padding: '0.35em 0.7em' } : undefined}>
      {label}
    </span>
  )
}

export function tierColorClass(tier: Tier): string {
  return tier === 'double' ? 'text-hot' : tier === 'single' ? 'text-foil' : 'text-cold'
}
