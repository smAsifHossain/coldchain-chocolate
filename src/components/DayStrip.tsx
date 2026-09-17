import { dayAt, formatLong, pointKey, summarize, type DecideContext, type PackLine, type Settings } from '../engine'
import type { RunStatus } from '../app/useApp'

interface Props {
  shipDate: string
  ctx: DecideContext | null
  lines: PackLine[]
  settings: Settings
  run: RunStatus
}

/** The hero: what day we are shipping, how hot it is here, and what the bench must pull. */
export function DayStrip({ shipDate, ctx, lines, settings, run }: Props) {
  const originDay = ctx ? dayAt(ctx.forecasts.get(pointKey(ctx.origin)), shipDate) : null
  const summary = lines.length ? summarize(lines, settings, run.stale) : null

  return (
    <section aria-label="Ship day overview" className="sheet px-5 py-4 md:px-7 md:py-5">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="min-w-[14rem]">
          <div className="text-ink-soft text-sm">Shipping</div>
          <div className="display text-2xl md:text-3xl">{formatLong(shipDate)}</div>
        </div>
        <div>
          <div className="text-ink-soft text-sm">
            {ctx ? `${ctx.origin.city}, ${ctx.origin.state} high` : 'Origin high'}
          </div>
          <div className="display text-2xl md:text-3xl">
            {originDay ? `${Math.round(originDay.high)}°F` : '—'}
          </div>
        </div>
        {summary && (
          <>
            <div>
              <div className="text-ink-soft text-sm">Orders</div>
              <div className="display text-2xl md:text-3xl">{summary.orders}</div>
            </div>
            <div className="flex gap-6">
              <Count label="No thermal" n={summary.byTier.none} cls="text-cold" />
              <Count label="Single" n={summary.byTier.single} cls="text-foil" />
              <Count label="Double + ice" n={summary.byTier.double} cls="text-hot" />
              {summary.needsReview > 0 && <Count label="Check by hand" n={summary.needsReview} cls="text-review" />}
            </div>
            <div className="ml-auto text-right">
              <div className="text-ink-soft text-sm">Pull from the shelf</div>
              <div className="display text-xl md:text-2xl">
                {summary.liners} liner{summary.liners === 1 ? '' : 's'}, {summary.icePacks} ice pack{summary.icePacks === 1 ? '' : 's'}
              </div>
              <div className="text-ink-soft text-sm">about ${summary.cost.toFixed(2)} in packaging</div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function Count({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <div>
      <div className="text-ink-soft text-sm">{label}</div>
      <div className={`display text-2xl md:text-3xl ${cls}`}>{n}</div>
    </div>
  )
}
