import { useMemo } from 'react'
import { addDays, formatShort, isWeekend, planShipDays, TIER_RANK, weekdayName, type Decision, type Tier } from '../engine'
import type { AppApi } from '../app/useApp'

const DAYS = 7

/**
 * Every order against the next seven ship days. Answers the question the
 * shipping desk actually asks in a heat wave: "should this one wait?"
 */
export function PlannerView({ app }: { app: AppApi }) {
  const ctx = app.ctx
  const plan = useMemo(() => {
    if (!ctx) return []
    return app.orders.map((order) => ({ order, days: planShipDays(order, ctx, DAYS) }))
  }, [ctx, app.orders])

  if (!ctx || plan.length === 0) {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">Nothing to plan yet</h2>
        <p className="text-ink-soft">Build today's decisions on the Orders tab, then come back to compare ship days.</p>
      </section>
    )
  }

  const dates = Array.from({ length: DAYS }, (_, i) => addDays(ctx.shipDate, i))
  const dayTotals = dates.map((_, i) => {
    let double = 0
    let ok = 0
    for (const p of plan) {
      const d = p.days[i].decision
      if (d.status !== 'ok') continue
      ok++
      if (d.tier === 'double') double++
    }
    return { double, ok }
  })
  const bestIdx = dayTotals.reduce((best, t, i) => (isWeekend(dates[i]) ? best : t.double < dayTotals[best].double ? i : best), firstWeekday(dates))

  return (
    <section className="sheet overflow-hidden" aria-label="Ship-day planner">
      <div className="px-5 py-4 border-b border-line">
        <h2 className="display text-lg">Which day to ship</h2>
        <p className="text-ink-soft text-sm">
          Each cell is the tier if that order ships that day. Weekends have no pickup. Best day for the whole batch:{' '}
          <strong className="text-ink">{formatShort(dates[bestIdx])}</strong> ({dayTotals[bestIdx].double} of {dayTotals[bestIdx].ok} need ice).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="bench">
          <thead>
            <tr>
              <th scope="col">Order</th>
              {dates.map((d, i) => (
                <th key={d} scope="col" className={`text-center ${i === bestIdx ? 'bg-cold-bg' : ''} ${isWeekend(d) ? 'text-ink-faint' : ''}`}>
                  <div>{weekdayName(d)}</div>
                  <div className="font-normal">{formatShort(d).slice(4)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.map(({ order, days }) => {
              const best = bestFor(days.map((d) => d.decision))
              return (
                <tr key={order.id}>
                  <th scope="row" className="text-left font-semibold whitespace-nowrap">
                    <div>{order.id}</div>
                    <div className="text-ink-soft text-sm font-normal">{days[0].decision.place || order.zip}</div>
                  </th>
                  {days.map(({ shipDate, decision }, i) => (
                    <td key={shipDate} className={`text-center ${i === bestIdx ? 'bg-cold-bg/60' : ''}`}>
                      <Cell decision={decision} weekend={isWeekend(shipDate)} best={i === best} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="text-left">
                Need ice
              </th>
              {dayTotals.map((t, i) => (
                <td key={i} className={`text-center font-semibold ${i === bestIdx ? 'bg-cold-bg' : ''}`}>
                  {isWeekend(dates[i]) ? <span className="text-ink-faint">—</span> : `${t.double} / ${t.ok}`}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function firstWeekday(dates: string[]): number {
  const i = dates.findIndex((d) => !isWeekend(d))
  return i === -1 ? 0 : i
}

/** Index of the coolest weekday for one order (lowest tier, then lowest worst-case). */
function bestFor(decisions: Decision[]): number {
  let best = -1
  decisions.forEach((d, i) => {
    if (d.status !== 'ok' || !d.worst) return
    if (best === -1) {
      best = i
      return
    }
    const b = decisions[best]
    if (TIER_RANK[d.tier] < TIER_RANK[b.tier] || (d.tier === b.tier && d.worst.high! < b.worst!.high!)) best = i
  })
  return best
}

function Cell({ decision, weekend, best }: { decision: Decision; weekend: boolean; best: boolean }) {
  if (weekend) return <span className="text-ink-faint text-sm">no pickup</span>
  if (decision.status !== 'ok' || !decision.worst) return <span className="text-review text-sm">check</span>
  const tier: Tier = decision.tier
  const cls = tier === 'double' ? 'text-hot' : tier === 'single' ? 'text-foil' : 'text-cold'
  return (
    <div className={`${cls} ${best ? 'font-extrabold' : ''}`}>
      <div className="text-lg leading-none">{Math.round(decision.worst.high!)}°</div>
      <div className="text-xs">{tier === 'double' ? 'double + ice' : tier === 'single' ? 'single' : 'none'}</div>
    </div>
  )
}
