import { formatShort, weekdayName, type Decision } from '../engine'

/**
 * One cell per day of the trip, left to right: ship day, days in transit,
 * delivery day, porch day. Color is what that day's high would call for; the
 * hottest day is outlined and shows its temperature.
 */
export function TripStrip({ decision: d }: { decision: Decision }) {
  if (d.window.length === 0) return null
  const byDate = new Map<string, { high: number | null; place: string; role: string }>()
  for (const p of d.window) {
    const cur = byDate.get(p.date)
    if (!cur || (p.high !== null && (cur.high === null || p.high > cur.high))) byDate.set(p.date, { high: p.high, place: p.place, role: p.role })
  }
  const cells = [...byDate.entries()]
  const t = d.thresholds
  const roleText: Record<string, string> = { origin: 'ship day', route: 'in transit', transit: 'in transit', destination: 'delivered', porch: 'on the porch' }
  return (
    <span className="strip" aria-label="Daily highs along the trip">
      {cells.map(([date, c]) => {
        const cls = c.high === null ? 's-missing' : c.high >= t.double ? 's-double' : c.high >= t.single ? 's-single' : 's-none'
        const worst = d.worst?.date === date
        return (
          <span
            key={date}
            className={`${cls} ${worst ? 's-worst' : ''}`}
            title={`${formatShort(date)}, ${roleText[c.role] ?? c.role} — ${c.high === null ? 'no forecast' : `${Math.round(c.high)}°F`} (${c.place})`}
          >
            <span className="s-day">{weekdayName(date).slice(0, 2)}</span>
            {worst && c.high !== null && <span className="s-temp">{Math.round(c.high)}°</span>}
          </span>
        )
      })}
    </span>
  )
}

/** Explains the strip once, in the column header. */
export function TripLegend() {
  return (
    <span className="strip-legend" aria-hidden="true">
      <span className="s-none" /> cool <span className="s-single" /> single <span className="s-double" /> double + ice
    </span>
  )
}
