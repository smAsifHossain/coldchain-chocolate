import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  addDays,
  boxesFor,
  effectiveTier,
  formatShort,
  lineMaterials,
  SERVICE_LABEL,
  sortForBench,
  TIER_LABEL,
  tierOverridden,
  toCsv,
  downloadText,
  type ImportResult,
  type PackLine,
  type Tier,
} from '../engine'
import type { AppApi } from '../app/useApp'
import { TierStamp } from './TierStamp'
import { ShippingCell } from './ShippingCell'
import { TripStrip, worstRoleNote } from './TripStrip'
import type { BuildStep } from '../app/useApp'

export function OrdersView({ app, onGoToPackList }: { app: AppApi; onGoToPackList: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(18rem,22rem)_1fr] lg:items-start">
      <InputDock app={app} />
      <Results app={app} onGoToPackList={onGoToPackList} />
    </div>
  )
}

/** "15:00" as "3 PM", "15:30" as "3.30 PM". */
function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h)) return hhmm
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m ? `${hour}.${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`
}

/** What is on the bench right now, recomputed from state so the checkbox and filters read true. */
function StatusLine({ app }: { app: AppApi }) {
  if (app.allOrders.length === 0) return null
  const n = app.orders.length
  const parts = [`${n} order${n === 1 ? '' : 's'}${app.sourceLabel ? ` from ${app.sourceLabel}` : ''}`]
  if (app.shippedCount > 0) {
    parts.push(`${app.shippedCount} already shipped, ${app.includeFulfilled ? 'included' : 'hidden'}`)
  }
  const noZip = app.orders.filter((o) => !o.zip).length
  if (noZip > 0) parts.push(`${noZip} without a zip`)
  return (
    <p className="text-sm" role="status">
      {parts.join('. ')}.
    </p>
  )
}

function InputDock({ app }: { app: AppApi }) {
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const finish = (_r: ImportResult) => setError(null)
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      finish(app.importText(await file.text(), file.name))
    } catch (err) {
      fail(err)
    } finally {
      e.target.value = ''
    }
  }

  const onSample = async () => {
    try {
      finish(await app.loadSample())
    } catch (err) {
      fail(err)
    }
  }

  const canBuild = app.orders.length > 0 && !!app.zipDb && app.run.phase !== 'loading'
  const maxDate = addDays(app.today, 14)

  return (
    <aside className="sheet p-5 flex flex-col gap-5 no-print" aria-label="Orders in">
      <div>
        <h2 className="display text-lg mb-1">Today's orders</h2>
        <p className="text-ink-soft text-sm">Upload the Shopify order export, or any CSV with a zip column.</p>
      </div>

      <div className="flex flex-col gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label="Upload orders CSV" />
        <button className="btn btn-primary justify-center" onClick={() => fileRef.current?.click()}>
          Upload Shopify export (.csv)
        </button>
        {app.shippedCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={app.includeFulfilled} onChange={(e) => app.setIncludeFulfilled(e.target.checked)} />
            Show the {app.shippedCount} order{app.shippedCount === 1 ? '' : 's'} that already shipped
          </label>
        )}
      </div>

      <button className="btn btn-quiet justify-center" onClick={onSample}>
        Load sample orders
      </button>

      <StatusLine app={app} />
      {error && (
        <p className="text-sm text-hot" role="alert">
          {error}
        </p>
      )}

      <hr className="rule" />

      <div className="flex flex-col gap-2">
        <label htmlFor="shipdate" className="text-sm font-semibold">
          Ship date
        </label>
        <input
          id="shipdate"
          type="date"
          className="field"
          value={app.shipDate}
          min={app.today}
          max={maxDate}
          onChange={(e) => e.target.value && app.setShipDate(e.target.value)}
        />
        {app.cutoff.afterCutoff && app.shipDate === app.cutoff.date && (
          <p className="text-sm text-foil" role="status">
            Past today's {clockLabel(app.settings.pickupCutoff)} pickup, so planning for {formatShort(app.shipDate)}.
          </p>
        )}
        <p className="text-ink-faint text-xs">Forecasts reach 16 days out; confidence drops after 7.</p>
      </div>

      <button className="btn btn-primary justify-center text-base" onClick={() => void app.build()} disabled={!canBuild}>
        {app.run.phase === 'loading' ? 'Fetching forecasts…' : app.ctx ? 'Rebuild pack list' : 'Build pack list'}
      </button>
      {!app.zipDb && !app.zipError && <p className="text-ink-faint text-xs">Loading the zip code table…</p>}
      {app.zipError && (
        <p className="text-sm text-hot" role="alert">
          The zip table failed to load ({app.zipError}). Reload the page.
        </p>
      )}
      {app.allOrders.length > 0 && (
        <button className="text-sm text-ink-soft underline self-start" onClick={app.clearOrders}>
          Clear orders
        </button>
      )}
    </aside>
  )
}

type Filter = 'all' | Tier | 'review' | 'flagged'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'double', label: 'Double + ice' },
  { id: 'single', label: 'Single' },
  { id: 'none', label: 'No thermal' },
  { id: 'flagged', label: 'Needs a look' },
  { id: 'review', label: 'Check by hand' },
]

function Results({ app, onGoToPackList }: { app: AppApi; onGoToPackList: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const all = useMemo(() => sortForBench(app.lines), [app.lines])
  const lines = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((l) => {
      const d = l.decision
      if (filter === 'review' && d.status === 'ok') return false
      if (filter === 'flagged' && !d.recommendation && d.warnings.length === 0) return false
      if ((filter === 'double' || filter === 'single' || filter === 'none') && (d.status !== 'ok' || effectiveTier(l) !== filter)) return false
      if (!q) return true
      const hay = [d.orderId, l.order.customer, d.place, d.zip, l.order.shippingMethod, ...(l.order.lineItems ?? [])].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [all, filter, query])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, double: 0, single: 0, none: 0, flagged: 0, review: 0 }
    for (const l of all) {
      const d = l.decision
      if (d.status !== 'ok') c.review++
      else c[effectiveTier(l)]++
      if (d.recommendation || d.warnings.length > 0) c.flagged++
    }
    return c
  }, [all])

  if (app.orders.length === 0) {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">No orders yet</h2>
        <p className="text-ink-soft max-w-md mx-auto">
          Upload today's Shopify export on the left. If you just want to see it work, load the sample orders.
        </p>
      </section>
    )
  }

  if (!app.ctx || app.run.phase === 'loading') {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">
          {app.orders.length} order{app.orders.length === 1 ? '' : 's'} loaded
          {app.sourceLabel ? ` from ${app.sourceLabel}` : ''}
        </h2>
        {app.run.phase === 'loading' ? (
          <Progress step={app.step} orders={app.orders.length} />
        ) : (
          <p className="text-ink-soft max-w-md mx-auto">Pick the ship date and build the pack list.</p>
        )}
      </section>
    )
  }

  return (
    <section className="sheet overflow-hidden" aria-label="Decisions">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line no-print">
        <h2 className="display text-lg">Decisions</h2>
        {app.needsRefetch && (
          <span className="text-sm text-hot">Origin or route settings changed. Rebuild to fetch the new forecasts.</span>
        )}
        {app.run.message && (
          <span className="text-sm text-hot" role="status">
            {app.run.message}
            {app.run.errors.length > 0 && <span className="text-ink-soft"> ({app.run.errors[0]})</span>}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn btn-quiet" onClick={() => downloadText(`pack-list-${app.shipDate}.csv`, toCsv(all, app.settings))}>
            Export CSV
          </button>
          <button className="btn" onClick={onGoToPackList}>
            Open pack list
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line no-print" role="group" aria-label="Filter decisions">
        {FILTERS.map((f) =>
          counts[f.id] > 0 || f.id === 'all' ? (
            <button
              key={f.id}
              className={`btn btn-quiet !min-h-9 !py-1 !px-3 text-sm ${filter === f.id ? '!bg-ink !text-white !border-ink' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className={filter === f.id ? 'text-white/70' : 'text-ink-faint'}>{counts[f.id]}</span>
            </button>
          ) : null,
        )}
        <input
          type="search"
          className="field !min-h-9 !py-1 !w-56 ml-auto text-sm"
          placeholder="Find an order, name, city, zip…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search orders"
        />
      </div>
      {lines.length === 0 && (
        <p className="px-4 py-6 text-ink-soft text-sm">Nothing matches. Clear the search or pick another filter.</p>
      )}
      <div className="overflow-x-auto">
        <table className="bench">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Destination</th>
              <th scope="col">Shipping</th>
              <th scope="col">Worst case</th>
              <th scope="col">Pack</th>
              <th scope="col">Pull</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <Row
                key={line.order.id}
                line={line}
                index={index}
                app={app}
                open={open === line.order.id}
                onToggle={() => setOpen(open === line.order.id ? null : line.order.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const STEPS: { id: Exclude<BuildStep, null>; label: (n: number) => string }[] = [
  { id: 'locating', label: (n) => `Locating ${n} zip code${n === 1 ? '' : 's'}` },
  { id: 'forecasting', label: () => 'Fetching 16-day forecasts for every route' },
  { id: 'deciding', label: () => 'Deciding every box' },
]

function Progress({ step, orders }: { step: BuildStep; orders: number }) {
  const idx = STEPS.findIndex((s) => s.id === step)
  return (
    <ol className="inline-flex flex-col gap-2 text-left mx-auto" aria-live="polite">
      {STEPS.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'now' : 'todo'
        return (
          <li key={s.id} className={`flex items-center gap-3 ${state === 'todo' ? 'text-ink-faint' : ''}`}>
            <span
              className={`inline-block w-5 h-5 rounded-full border-2 ${state === 'done' ? 'bg-ink border-ink' : state === 'now' ? 'border-ink animate-pulse' : 'border-line-strong'}`}
              aria-hidden="true"
            />
            <span className={state === 'now' ? 'font-semibold' : ''}>{s.label(orders)}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Row({ line, app, open, onToggle, index }: { line: PackLine; app: AppApi; open: boolean; onToggle: () => void; index: number }) {
  const d = line.decision
  const stagger = `${Math.min(index, 14) * 45}ms`
  const tier = effectiveTier(line)
  const m = lineMaterials(line, app.settings)
  const flags = (d.recommendation ? 1 : 0) + d.warnings.length
  const panelId = `row-${line.order.id.replace(/[^a-z0-9]/gi, '')}`

  return (
    <>
      <tr className={`row-in ${open ? 'bg-stone' : ''}`} style={{ ['--stagger' as string]: stagger }}>
        <td>
          <div className="font-semibold">{d.orderId}</div>
          {line.order.customer && <div className="text-ink-soft text-sm">{line.order.customer}</div>}
        </td>
        <td>
          <div>{d.place || 'unknown'}</div>
          <div className="text-ink-soft text-sm">{d.zip}</div>
        </td>
        <td>
          <ShippingCell decision={d} />
        </td>
        <td>
          {d.worst ? (
            <>
              <div className={`temp ${tier === 'double' ? 'text-hot' : tier === 'single' ? 'text-foil' : 'text-cold'}`}>
                {Math.round(d.worst.high!)}°F
              </div>
              <div className="text-ink-soft text-sm">
                {d.worst.place}, {formatShort(d.worst.date)}
                {worstRoleNote(d)}
              </div>
              <TripStrip decision={d} />
            </>
          ) : (
            <span className="text-ink-faint">not judged</span>
          )}
        </td>
        <td>
          <span className="stamp-in inline-block" style={{ ['--stagger' as string]: stagger }}>
            <TierStamp tier={tier} status={d.status} />
          </span>
          {tierOverridden(line) && <div className="text-ink-soft text-xs mt-1">changed by hand</div>}
          {boxesFor(line) > 1 && <div className="text-ink-soft text-xs mt-1">{boxesFor(line)} boxes</div>}
        </td>
        <td className="whitespace-nowrap">
          {m.liners || m.icePacks ? (
            <>
              {m.liners > 0 && (
                <div>
                  {m.liners} liner{m.liners === 1 ? '' : 's'}
                </div>
              )}
              {m.icePacks > 0 && (
                <div>
                  {m.icePacks} ice pack{m.icePacks === 1 ? '' : 's'}
                </div>
              )}
            </>
          ) : (
            <span className="text-ink-faint">nothing</span>
          )}
        </td>
        <td className="text-right">
          <button className="btn btn-quiet !min-h-9 !py-1 !px-2 text-sm" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
            {flags > 0 && (
              <span className={d.recommendation ? 'text-hot font-bold' : 'text-foil font-bold'} aria-label={`${flags} notes`}>
                {flags}
              </span>
            )}
            {open ? 'Hide' : 'Why'}
          </button>
        </td>
      </tr>
      {open && (
        <tr id={panelId}>
          <td colSpan={7} className="bg-stone">
            <Details line={line} app={app} />
          </td>
        </tr>
      )}
    </>
  )
}

function Details({ line, app }: { line: PackLine; app: AppApi }) {
  const d = line.decision
  const [note, setNote] = useState(line.override?.note ?? '')
  const current = line.override ?? {}
  const setTier = (tier: Tier | '') => {
    const next = { ...current, note }
    if (tier === '' || tier === d.tier) delete next.tier
    else next.tier = tier
    app.setOverride(line.order.id, next)
  }
  const setBoxes = (n: number) => {
    const next = { ...current, note }
    if (!Number.isFinite(n) || n <= 1) delete next.boxes
    else next.boxes = Math.round(n)
    app.setOverride(line.order.id, next)
  }
  const saveNote = () => app.setOverride(line.order.id, { ...current, note })

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1fr] py-2">
      <div className="flex flex-col gap-3">
        {d.recommendation && (
          <div className="border-l-4 border-hot pl-3">
            <div className="font-semibold text-hot">{d.recommendation.action === 'hold' ? 'Consider holding' : 'Consider air service'}</div>
            <p className="text-sm">{d.recommendation.detail}</p>
          </div>
        )}
        {d.reasons.length > 0 && (
          <div>
            <div className="font-semibold mb-1">How this was decided</div>
            <ul className="list-disc pl-5 text-sm flex flex-col gap-1">
              {d.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {d.warnings.length > 0 && (
          <div>
            <div className="font-semibold mb-1">Watch out</div>
            <ul className="list-disc pl-5 text-sm flex flex-col gap-1">
              {d.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {line.order.lineItems && line.order.lineItems.length > 0 && (
          <div className="text-sm text-ink-soft">
            <span className="font-semibold">In the box</span> {line.order.lineItems.join(', ')} ({line.order.qty} piece{line.order.qty === 1 ? '' : 's'})
          </div>
        )}
        {line.order.shippingMethod && (
          <div className="text-sm text-ink-soft">
            The order says “{line.order.shippingMethod}”, read as {SERVICE_LABEL[d.serviceLevel]}.
          </div>
        )}
        <div className="text-sm text-ink-soft">Forecast confidence is {d.confidence}.</div>
      </div>

      <div className="flex flex-col gap-4">
        {d.window.length > 0 && (
          <div>
            <div className="font-semibold mb-1">Where the box will be</div>
            <table className="text-sm w-full">
              <thead>
                <tr className="text-ink-soft">
                  <th scope="col" className="text-left font-medium pr-3">Day</th>
                  <th scope="col" className="text-left font-medium pr-3">Place</th>
                  <th scope="col" className="text-left font-medium pr-3">High</th>
                  <th scope="col" className="text-left font-medium">Low</th>
                </tr>
              </thead>
              <tbody>
                {d.window.map((p, i) => (
                  <tr key={i} className={d.worst && p === d.worst ? 'font-bold text-hot' : undefined}>
                    <td className="pr-3 whitespace-nowrap">{formatShort(p.date)}</td>
                    <td className="pr-3">
                      {p.place} <span className="text-ink-faint">({p.role === 'transit' ? 'in transit' : p.role})</span>
                    </td>
                    <td className="pr-3">{p.high === null ? 'none' : `${Math.round(p.high)}°`}</td>
                    <td>{p.low === null ? 'none' : `${Math.round(p.low)}°`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="no-print">
          <label className="font-semibold block mb-1" htmlFor={`override-${line.order.id}`}>
            Pack it differently
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              id={`override-${line.order.id}`}
              className="field !w-auto"
              value={line.override?.tier ?? ''}
              onChange={(e) => setTier(e.target.value as Tier | '')}
            >
              <option value="">Use the decision ({TIER_LABEL[d.tier]})</option>
              {(['none', 'single', 'double'] as Tier[]).map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              Ships as
              <input
                type="number"
                className="field !w-16 !min-h-10"
                min={1}
                max={50}
                value={boxesFor(line)}
                onChange={(e) => setBoxes(Number(e.target.value))}
                aria-label="Number of boxes"
              />
              box{boxesFor(line) === 1 ? '' : 'es'}
            </label>
            {(tierOverridden(line) || boxesFor(line) > 1 || note) && (
              <input
                className="field !w-auto flex-1 min-w-[12rem]"
                placeholder="Why? (shows on the pack list)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={saveNote}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
