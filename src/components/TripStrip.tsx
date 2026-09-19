import { formatShort, weekdayName, type Decision, type ExposureRole } from '../engine'

const ROLE_TEXT: Record<ExposureRole, string> = {
  origin: 'ship day',
  route: 'in transit',
  transit: 'in transit',
  destination: 'delivery day',
  porch: 'day after delivery, in case the box sits outside',
}

/** "ship day" / "on the porch" for the worst-case line; nothing for ordinary transit or delivery days. */
export function worstRoleNote(d: Decision): string {
  if (!d.worst) return ''
  if (d.worst.role === 'porch') return ', day after delivery'
  if (d.worst.role === 'origin' && d.serviceLevel !== 'pickup') return ', ship day'
  return ''
}

/**
 * One small cell per day of the trip, left to right: ship day, days in
 * transit, delivery day, then a hatched cell for the day on the porch. Color
 * is what that day's high would call for; the hottest day is outlined.
 */
export function TripStrip({ decision: d }: { decision: Decision }) {
  if (d.window.length === 0) return null
  const byDate = new Map<string, { high: number | null; place: string; role: ExposureRole }>()
  for (const p of d.window) {
    const cur = byDate.get(p.date)
    if (!cur) byDate.set(p.date, { high: p.high, place: p.place, role: p.role })
    else if (p.high !== null && (cur.high === null || p.high > cur.high)) byDate.set(p.date, { high: p.high, place: p.place, role: cur.role })
  }
  const cells = [...byDate.entries()]
  const t = d.thresholds
  return (
    <span className="strip" aria-label="Daily highs along the trip">
      {cells.map(([date, c]) => {
        const cls = c.high === null ? 's-missing' : c.high >= t.double ? 's-double' : c.high >= t.single ? 's-single' : 's-none'
        const worst = d.worst?.date === date
        return (
          <span
            key={date}
            className={`${cls} ${worst ? 's-worst' : ''} ${c.role === 'porch' ? 's-porch' : ''} ${c.role === 'destination' ? 's-delivery' : ''}`}
            title={`${formatShort(date)}, ${ROLE_TEXT[c.role]} — ${c.high === null ? 'no forecast' : `${Math.round(c.high)}°F`} (${c.place})`}
          >
            {weekdayName(date).slice(0, 1)}
          </span>
        )
      })}
    </span>
  )
}

