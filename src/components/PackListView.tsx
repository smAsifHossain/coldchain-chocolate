import { effectiveTier, formatLong, formatShort, lineMaterials, SERVICE_LABEL, sortForBench, summarize, TIER_LABEL, type PackLine, type Tier } from '../engine'
import type { AppApi } from '../app/useApp'
import { TierStamp } from './TierStamp'

const TIER_ORDER: Tier[] = ['double', 'single', 'none']

/** The sheet the bench works from: grouped by what to pull, hottest first, printable. */
export function PackListView({ app }: { app: AppApi }) {
  if (!app.ctx || app.lines.length === 0) {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">No pack list yet</h2>
        <p className="text-ink-soft">Build today's decisions on the Orders tab first.</p>
      </section>
    )
  }

  const lines = sortForBench(app.lines)
  const summary = summarize(lines, app.settings, app.run.stale)
  const review = lines.filter((l) => l.decision.status !== 'ok')
  const byTier = (t: Tier) => lines.filter((l) => l.decision.status === 'ok' && effectiveTier(l) === t)
  const generated = app.run.ranAt ? new Date(app.run.ranAt) : new Date()

  return (
    <section className="sheet p-5 md:p-8" aria-label="Pack list">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b-2 border-ink">
        <div>
          <div className="text-ink-soft text-sm">Cocoa Dolce thermal pack list</div>
          <h2 className="display text-2xl md:text-3xl">{formatLong(app.shipDate)}</h2>
          <div className="text-ink-soft text-sm mt-1">
            Built {generated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} from {app.origin.city}, {app.origin.state}
            {app.run.stale ? ' — using a saved forecast; the live service was unreachable' : ''}
          </div>
        </div>
        <div className="flex gap-2 no-print">
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-5 border-b border-line print-break-inside-avoid">
        <Stat label="Boxes" value={String(summary.orders)} />
        <Stat label="Thermal liners" value={String(summary.liners)} />
        <Stat label="Ice packs" value={String(summary.icePacks)} />
        <Stat label="Packaging cost" value={`$${summary.cost.toFixed(2)}`} />
      </div>

      {review.length > 0 && <Group title="Check these by hand first" lines={review} app={app} tone="review" />}
      {TIER_ORDER.map((t) => {
        const group = byTier(t)
        return group.length > 0 ? <Group key={t} title={TIER_LABEL[t]} lines={group} app={app} tone={t} /> : null
      })}

      <footer className="pt-4 text-ink-faint text-xs">
        Worst-case temperatures cover the ship day at origin, every day in transit, delivery day and {app.settings.porchDays} day
        {app.settings.porchDays === 1 ? '' : 's'} on the porch. Thresholds: single thermal from {app.settings.thresholds.single}°F, double thermal with ice from{' '}
        {app.settings.thresholds.double}°F. Forecast by Open-Meteo.
      </footer>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-ink-soft text-sm">{label}</div>
      <div className="display text-2xl">{value}</div>
    </div>
  )
}

function Group({ title, lines, app, tone }: { title: string; lines: PackLine[]; app: AppApi; tone: Tier | 'review' }) {
  const count = lines.length
  const toneCls = tone === 'review' ? 'text-review' : tone === 'double' ? 'text-hot' : tone === 'single' ? 'text-foil' : 'text-cold'
  return (
    <section className="pt-5 print-break-inside-avoid" aria-label={title}>
      <h3 className={`display text-xl mb-2 ${toneCls}`}>
        {title} <span className="text-ink-faint font-medium text-base">({count})</span>
      </h3>
      <table className="bench">
        <thead>
          <tr>
            <th scope="col" className="w-8">
              <span className="sr-only">Done</span>
            </th>
            <th scope="col">Order</th>
            <th scope="col">Destination</th>
            <th scope="col">Shipping method</th>
            <th scope="col">Pull</th>
            <th scope="col">Worst case</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const d = line.decision
            const m = lineMaterials(line, app.settings)
            const notes: string[] = []
            if (line.override) notes.push(`Changed by hand${line.override.note ? `: ${line.override.note}` : ''}`)
            if (d.recommendation) notes.push(d.recommendation.detail)
            notes.push(...d.warnings)
            return (
              <tr key={line.order.id}>
                <td>
                  <input type="checkbox" aria-label={`Packed ${d.orderId}`} className="w-5 h-5" />
                </td>
                <td>
                  <div className="font-semibold">{d.orderId}</div>
                  {line.order.customer && <div className="text-ink-soft text-sm">{line.order.customer}</div>}
                  {line.order.lineItems && line.order.lineItems.length > 0 && (
                    <div className="text-ink-soft text-xs">{line.order.lineItems.join(', ')}</div>
                  )}
                </td>
                <td>
                  <div>{d.place || '—'}</div>
                  <div className="text-ink-soft text-sm">{d.zip}</div>
                </td>
                <td>
                  <div>{line.order.shippingMethod || SERVICE_LABEL[d.serviceLevel]}</div>
                  <div className="text-ink-soft text-sm">
                    {SERVICE_LABEL[d.serviceLevel]}
                    {d.status === 'ok' ? `, arrives ${formatShort(d.deliveryDate)}` : ''}
                  </div>
                </td>
                <td className="whitespace-nowrap">
                  <TierStamp tier={effectiveTier(line)} status={d.status} />
                  <div className="text-sm mt-1">
                    {m.liners > 0 ? `${m.liners} liner${m.liners === 1 ? '' : 's'}` : ''}
                    {m.liners > 0 && m.icePacks > 0 ? ', ' : ''}
                    {m.icePacks > 0 ? `${m.icePacks} ice pack${m.icePacks === 1 ? '' : 's'}` : ''}
                    {!m.liners && !m.icePacks ? 'nothing extra' : ''}
                  </div>
                </td>
                <td>
                  {d.worst ? (
                    <>
                      <div className="font-bold">{Math.round(d.worst.high!)}°F</div>
                      <div className="text-ink-soft text-sm">
                        {d.worst.place}, {formatShort(d.worst.date)}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-sm max-w-[22rem]">
                  {notes.map((n, i) => (
                    <div key={i}>{n}</div>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
