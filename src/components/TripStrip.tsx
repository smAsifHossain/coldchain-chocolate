import { formatShort, type Decision, type Settings } from '../engine'

/** One colored cell per day of the trip; the hottest day is outlined. Reads at a glance in a table row. */
export function TripStrip({ decision: d, settings }: { decision: Decision; settings: Settings }) {
  if (d.window.length === 0) return null
  const byDate = new Map<string, { high: number | null; place: string }>()
  for (const p of d.window) {
    const cur = byDate.get(p.date)
    if (!cur || (p.high !== null && (cur.high === null || p.high > cur.high))) byDate.set(p.date, { high: p.high, place: p.place })
  }
  const cells = [...byDate.entries()]
  const t = settings.thresholds
  return (
    <span className="strip" aria-label="Daily highs along the trip">
      {cells.map(([date, c]) => {
        const cls = c.high === null ? 's-missing' : c.high >= t.double ? 's-double' : c.high >= t.single ? 's-single' : 's-none'
        const worst = d.worst?.date === date
        return (
          <span
            key={date}
            className={`${cls} ${worst ? 's-worst' : ''}`}
            title={`${formatShort(date)}: ${c.high === null ? 'no forecast' : `${Math.round(c.high)}°F`} (${c.place})`}
          />
        )
      })}
    </span>
  )
}
