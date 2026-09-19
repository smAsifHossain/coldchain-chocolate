import { boxesFor, effectiveTier, formatLong, formatShort, lineMaterials, SERVICE_LABEL, sortForBench, summarize, tierOverridden, TIER_LABEL, type PackLine, type Tier } from '../engine'
import type { AppApi } from '../app/useApp'
import { TierStamp } from './TierStamp'
import { worstRoleNote } from './TripStrip'

const TIER_ORDER: Tier[] = ['double', 'single', 'none']

/** The sheet the bench works from: grouped by what to pull, hottest first, printable, tickable. */
export function PackListView({ app }: { app: AppApi }) {
  if (!app.ctx || app.lines.length === 0) {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">No pack list yet</h2>
        <p className="text-ink-soft">Build today's decisions on the Planner tab first.</p>
      </section>
    )
  }

  const lines = sortForBench(app.lines)
  const summary = summarize(lines, app.settings, app.run.stale)
  const review = lines.filter((l) => l.decision.status !== 'ok')
  const byTier = (t: Tier) => lines.filter((l) => l.decision.status === 'ok' && effectiveTier(l) === t)
  const generated = app.run.ranAt ? new Date(app.run.ranAt) : new Date()
  const packedCount = lines.filter((l) => app.isPacked(l.order.id)).length
  const pct = lines.length ? Math.round((packedCount / lines.length) * 100) : 0
  const strictest = Math.abs(Math.min(0, ...app.settings.productRules.map((r) => r.offset)))

  return (
    <section className="sheet p-4 md:p-8" aria-label="Pack list">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b-2 border-ink">
        <div>
          <div className="text-ink-soft text-sm">Cocoa Dolce thermal pack list</div>
          <h2 className="display text-2xl md:text-3xl">{formatLong(app.shipDate)}</h2>
          <div className="text-ink-soft text-sm mt-1">
            Built {generated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} from {app.origin.city}, {app.origin.state}
            {app.run.stale ? ' — using a saved forecast; the live services were unreachable' : app.run.fallback ? ' — forecasts from the National Weather Service' : ''}
          </div>
        </div>
        <div className="flex gap-2 no-print">
          {packedCount > 0 && (
            <button className="btn btn-quiet" onClick={app.clearPacked}>
              Clear ticks
            </button>
          )}
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-5 border-b border-line print-break-inside-avoid">
        <Stat label="Boxes" value={String(summary.boxes)} sub={summary.boxes !== summary.orders ? `${summary.orders} orders` : undefined} />
        <Stat label="Thermal liners" value={String(summary.liners)} />
        <Stat label="Ice packs" value={String(summary.icePacks)} />
        <Stat label="Packaging cost" value={`$${summary.cost.toFixed(2)}`} />
      </div>

      <div className="py-4 no-print" aria-live="polite">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="font-semibold">
            {packedCount} of {lines.length} packed
          </span>
          <span className="text-ink-soft">{pct}%</span>
        </div>
        <div className="h-2 rounded bg-line overflow-hidden" role="progressbar" aria-valuenow={packedCount} aria-valuemin={0} aria-valuemax={lines.length}>
          <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {review.length > 0 && <Group title="Check these by hand first" lines={review} app={app} tone="review" />}
      {TIER_ORDER.map((t) => {
        const group = byTier(t)
        return group.length > 0 ? <Group key={t} title={TIER_LABEL[t]} lines={group} app={app} tone={t} /> : null
      })}

      <footer className="pt-4 text-ink-faint text-xs">
        Worst-case temperatures cover the ship day at origin, every day in transit, delivery day and {app.settings.porchDays} day
        {app.settings.porchDays === 1 ? '' : 's'} on the porch. Thresholds: single thermal from {app.settings.thresholds.single}°F, double thermal with ice from{' '}
        {app.settings.thresholds.double}°F{strictest > 0 ? `; sensitive products judged up to ${strictest}°F stricter` : ''}. Forecast by Open-Meteo
        {app.run.fallback ? ' and the National Weather Service' : ''}.
      </footer>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-ink-soft text-sm">{label}</div>
      <div className="display text-2xl">{value}</div>
      {sub && <div className="text-ink-faint text-xs">{sub}</div>}
    </div>
  )
}

function pullText(line: PackLine, app: AppApi): string {
  const m = lineMaterials(line, app.settings)
  const parts: string[] = []
  if (m.liners > 0) parts.push(`${m.liners} liner${m.liners === 1 ? '' : 's'}`)
  if (m.icePacks > 0) parts.push(`${m.icePacks} ice pack${m.icePacks === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : 'nothing extra'
}

function notesFor(line: PackLine): string[] {
  const d = line.decision
  const notes: string[] = []
  if (tierOverridden(line)) notes.push(`Changed by hand${line.override?.note ? `: ${line.override.note}` : ''}`)
  else if (line.override?.note) notes.push(line.override.note)
  if (d.recommendation) notes.push(d.recommendation.detail)
  notes.push(...d.warnings)
  return notes
}

function Group({ title, lines, app, tone }: { title: string; lines: PackLine[]; app: AppApi; tone: Tier | 'review' }) {
  const count = lines.length
  const toneCls = tone === 'review' ? 'text-review' : tone === 'double' ? 'text-hot' : tone === 'single' ? 'text-foil' : 'text-cold'
  return (
    <section className="pt-5 print-break-inside-avoid" aria-label={title}>
      <h3 className={`display text-xl mb-2 ${toneCls}`}>
        {title} <span className="text-ink-faint font-medium text-base">({count})</span>
      </h3>

      {/* Cards for the bench tablet and phones */}
      <ul className="flex flex-col gap-3 md:hidden no-print">
        {lines.map((line) => {
          const d = line.decision
          const packed = app.isPacked(line.order.id)
          const boxes = boxesFor(line)
          return (
            <li key={line.order.id} className={`border border-line rounded-lg p-3 flex gap-3 ${packed ? 'opacity-55' : ''}`}>
              <input
                type="checkbox"
                className="w-7 h-7 mt-0.5 shrink-0"
                checked={packed}
                onChange={(e) => app.setPacked(line.order.id, e.target.checked)}
                aria-label={`Packed ${d.orderId}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-lg">
                    {d.orderId}
                    {boxes > 1 && <span className="text-ink-soft text-sm font-normal"> — {boxes} boxes</span>}
                  </div>
                  <TierStamp tier={effectiveTier(line)} status={d.status} />
                </div>
                <div className="text-sm">
                  {line.order.customer ? `${line.order.customer}, ` : ''}
                  {d.place || '—'} {d.zip}
                </div>
                <div className="display text-lg mt-1">Pull {pullText(line, app)}</div>
                <div className="text-ink-soft text-sm">
                  {line.order.shippingMethod || SERVICE_LABEL[d.serviceLevel]}
                  {d.status === 'ok' ? `, arrives ${formatShort(d.deliveryDate)}` : ''}
                  {d.worst ? ` — worst ${Math.round(d.worst.high!)}°F ${d.worst.place}, ${formatShort(d.worst.date)}${worstRoleNote(d)}` : ''}
                </div>
                {line.order.lineItems && line.order.lineItems.length > 0 && <div className="text-ink-faint text-xs mt-1">{line.order.lineItems.join(', ')}</div>}
                {notesFor(line).map((n, i) => (
                  <div key={i} className="text-sm mt-1">
                    {n}
                  </div>
                ))}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Table for desktop and print */}
      <div className="hidden md:block print:block">
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
              const packed = app.isPacked(line.order.id)
              const boxes = boxesFor(line)
              return (
                <tr key={line.order.id} className={packed ? 'opacity-55' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Packed ${d.orderId}`}
                      className="w-6 h-6"
                      checked={packed}
                      onChange={(e) => app.setPacked(line.order.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <div className="font-semibold">{d.orderId}</div>
                    {line.order.customer && <div className="text-ink-soft text-sm">{line.order.customer}</div>}
                    {line.order.lineItems && line.order.lineItems.length > 0 && <div className="text-ink-soft text-xs">{line.order.lineItems.join(', ')}</div>}
                    {boxes > 1 && <div className="text-sm font-semibold">{boxes} boxes</div>}
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
                    <div className="text-sm mt-1">{pullText(line, app)}</div>
                  </td>
                  <td>
                    {d.worst ? (
                      <>
                        <div className="font-bold">{Math.round(d.worst.high!)}°F</div>
                        <div className="text-ink-soft text-sm">
                          {d.worst.place}, {formatShort(d.worst.date)}
                          {worstRoleNote(d)}
                        </div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-sm max-w-[22rem]">
                    {notesFor(line).map((n, i) => (
                      <div key={i}>{n}</div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
