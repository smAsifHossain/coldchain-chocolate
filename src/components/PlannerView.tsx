import { useMemo } from 'react'
import { addDays, boxesFor, formatShort, isWeekend, planShipDays, TIER_RANK, weekdayName, type Decision, type Tier } from '../engine'
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
    return app.lines.map((line) => ({ order: line.order, boxes: boxesFor(line), days: planShipDays(line.order, ctx, DAYS) }))
  }, [ctx, app.lines])

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
    let cost = 0
    let icePacks = 0
    for (const p of plan) {
      const d = p.days[i].decision
      if (d.status !== 'ok') continue
      ok++
      if (d.tier === 'double') double++
      cost += d.cost * p.boxes
      icePacks += d.icePacks * p.boxes
    }
    return { double, ok, cost: Math.round(cost * 100) / 100, icePacks }
  })
  const bestIdx = dayTotals.reduce(
    (best, t, i) => (isWeekend(dates[i]) ? best : t.double < dayTotals[best].double || (t.double === dayTotals[best].double && t.cost < dayTotals[best].cost) ? i : best),
    firstWeekday(dates),
  )
  const today = dayTotals[0]
  const best = dayTotals[bestIdx]
  const saving = Math.round((today.cost - best.cost) * 100) / 100

  return (
    <section className="sheet overflow-hidden" aria-label="Ship-day planner">
      <div className="px-5 py-4 border-b border-line">
        <h2 className="display text-lg">Which day to ship</h2>
        <p className="text-ink-soft text-sm">
          Each cell is the tier if that order ships that day; a “wait” tag marks an order that would do better on a later day. Weekends have no pickup.{' '}
          {bestIdx === 0 ? (
            <>
              <strong className="text-ink">{formatShort(dates[0])}</strong> is already the best day this week: {today.double} of {today.ok} need ice, about ${today.cost.toFixed(2)} in packaging.
            </>
          ) : (
            <>
              Ship <strong className="text-ink">{formatShort(dates[bestIdx])}</strong> instead of {formatShort(dates[0])}: {today.double - best.double} fewer box
              {today.double - best.double === 1 ? '' : 'es'} on ice, {today.icePacks - best.icePacks} fewer ice pack{today.icePacks - best.icePacks === 1 ? '' : 's'},{' '}
              {saving > 0 ? `about $${saving.toFixed(2)} less packaging` : 'about the same packaging cost'}.
            </>
          )}
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
                  {i === bestIdx && <div className="text-cold text-xs font-semibold mt-1">{bestIdx === 0 ? 'ship as planned' : 'best for the batch'}</div>}
                  {i === 0 && bestIdx !== 0 && <div className="text-ink-faint text-xs font-normal mt-1">planned</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.map(({ order, days }) => {
              const decisions = days.map((d) => d.decision)
              const best = bestFor(decisions, dates)
              const planned = decisions[0]
              const improvement =
                best > 0 && planned.status === 'ok' && planned.worst && decisions[best].worst
                  ? TIER_RANK[decisions[best].tier] < TIER_RANK[planned.tier]
                    ? 'less ice'
                    : `${Math.round(planned.worst.high! - decisions[best].worst!.high!)}° cooler`
                  : null
              return (
                <tr key={order.id}>
                  <th scope="row" className="text-left font-semibold whitespace-nowrap">
                    <div>{order.id}</div>
                    <div className="text-ink-soft text-sm font-normal">{days[0].decision.place || order.zip}</div>
                  </th>
                  {days.map(({ shipDate, decision }, i) => {
                    const weekend = isWeekend(shipDate)
                    const heat = weekend || decision.status !== 'ok' ? '' : `heat-${decision.tier}`
                    return (
                      <td key={shipDate} className={`text-center ${heat} ${i === bestIdx ? 'outline outline-2 -outline-offset-2 outline-cold' : ''}`}>
                        <Cell decision={decision} weekend={weekend} note={i === best ? improvement : null} />
                      </td>
                    )
                  })}
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
            <tr>
              <th scope="row" className="text-left">
                Packaging
              </th>
              {dayTotals.map((t, i) => (
                <td key={i} className={`text-center text-sm ${i === bestIdx ? 'bg-cold-bg font-semibold' : 'text-ink-soft'}`}>
                  {isWeekend(dates[i]) ? <span className="text-ink-faint">—</span> : `${t.cost.toFixed(2)}`}
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

/**
 * Index of the best weekday for one order: lowest tier, then lowest worst-case
 * high. Ties go to the earlier day, so "wait" is only suggested when it helps.
 */
function bestFor(decisions: Decision[], dates: string[]): number {
  let best = -1
  decisions.forEach((d, i) => {
    // A weekend "ship date" silently becomes the next Monday; never suggest it.
    if (isWeekend(dates[i]) || d.status !== 'ok' || !d.worst) return
    if (best === -1) {
      best = i
      return
    }
    const b = decisions[best]
    if (TIER_RANK[d.tier] < TIER_RANK[b.tier] || (d.tier === b.tier && d.worst.high! < b.worst!.high!)) best = i
  })
  return best
}

function Cell({ decision, weekend, note }: { decision: Decision; weekend: boolean; note: string | null }) {
  if (weekend) return <span className="text-ink-faint text-sm">no pickup</span>
  if (decision.status !== 'ok' || !decision.worst) return <span className="text-review text-sm">check</span>
  const tier: Tier = decision.tier
  const cls = tier === 'double' ? 'text-hot' : tier === 'single' ? 'text-foil' : 'text-cold'
  return (
    <div className={`${cls} ${note ? 'font-extrabold' : ''}`} title={note ? `Waiting until this day: ${note}` : undefined}>
      <div className="text-lg leading-none">{Math.round(decision.worst.high!)}°</div>
      <div className="text-xs">{tier === 'double' ? 'double + ice' : tier === 'single' ? 'single' : 'none'}</div>
      {note && <div className="mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-bold bg-paper border border-current">wait: {note}</div>}
    </div>
  )
}
