import { useRef, useState, type ChangeEvent } from 'react'
import {
  addDays,
  effectiveTier,
  formatShort,
  lineMaterials,
  SERVICE_LABEL,
  sortForBench,
  TIER_LABEL,
  toCsv,
  downloadText,
  type ImportResult,
  type PackLine,
  type Tier,
} from '../engine'
import type { AppApi } from '../app/useApp'
import { TierStamp } from './TierStamp'

export function OrdersView({ app, onGoToPackList }: { app: AppApi; onGoToPackList: () => void }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(18rem,22rem)_1fr] lg:items-start">
      <InputDock app={app} />
      <Results app={app} onGoToPackList={onGoToPackList} />
    </div>
  )
}

function describeImport(r: ImportResult): string {
  const n = r.orders.length
  const what = r.source === 'shopify' ? 'Shopify export' : r.source === 'csv' ? 'CSV' : 'list'
  const parts = [`${n} order${n === 1 ? '' : 's'} from the ${what}`]
  if (r.skipped.fulfilled) parts.push(`${r.skipped.fulfilled} already fulfilled, skipped`)
  if (r.skipped.noZip) parts.push(`${r.skipped.noZip} without a zip`)
  return parts.join(' — ')
}

function InputDock({ app }: { app: AppApi }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const finish = (r: ImportResult) => {
    setError(null)
    setNote(describeImport(r))
  }
  const fail = (e: unknown) => {
    setNote(null)
    setError(e instanceof Error ? e.message : String(e))
  }

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

  const onPaste = () => {
    if (!text.trim()) return
    try {
      finish(app.importText(text, 'Pasted list'))
      setText('')
    } catch (err) {
      fail(err)
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
        <p className="text-ink-soft text-sm">Upload the Shopify order export, or paste zip codes one per line.</p>
      </div>

      <div className="flex flex-col gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label="Upload orders CSV" />
        <button className="btn btn-primary justify-center" onClick={() => fileRef.current?.click()}>
          Upload Shopify export (.csv)
        </button>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={app.includeFulfilled} onChange={(e) => app.setIncludeFulfilled(e.target.checked)} />
          Include orders already fulfilled
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="paste" className="text-sm font-semibold">
          Or paste zip codes
        </label>
        <textarea
          id="paste"
          className="field font-mono text-sm"
          rows={4}
          placeholder={'85004\n#1042 33131 x2\n02138 2-Day'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn justify-center" onClick={onPaste} disabled={!text.trim()}>
          Use pasted list
        </button>
      </div>

      <button className="btn btn-quiet justify-center" onClick={onSample}>
        Load sample orders
      </button>

      {note && (
        <p className="text-sm" role="status">
          {note}
        </p>
      )}
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
        <p className="text-ink-faint text-xs">Forecasts reach 16 days out; confidence drops after 7.</p>
      </div>

      <button className="btn btn-primary justify-center text-base" onClick={app.build} disabled={!canBuild}>
        {app.run.phase === 'loading' ? 'Fetching forecasts…' : app.ctx ? 'Rebuild pack list' : 'Build pack list'}
      </button>
      {!app.zipDb && !app.zipError && <p className="text-ink-faint text-xs">Loading the zip code table…</p>}
      {app.zipError && (
        <p className="text-sm text-hot" role="alert">
          The zip table failed to load: {app.zipError}. Reload the page.
        </p>
      )}
      {app.orders.length > 0 && (
        <button className="text-sm text-ink-soft underline self-start" onClick={app.clearOrders}>
          Clear orders
        </button>
      )}
    </aside>
  )
}

function Results({ app, onGoToPackList }: { app: AppApi; onGoToPackList: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const lines = sortForBench(app.lines)

  if (app.orders.length === 0) {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">No orders yet</h2>
        <p className="text-ink-soft max-w-md mx-auto">
          Upload today's Shopify export or paste a few zip codes on the left. If you just want to see it work, load the sample orders.
        </p>
      </section>
    )
  }

  if (!app.ctx) {
    return (
      <section className="sheet p-8 text-center">
        <h2 className="display text-xl mb-2">
          {app.orders.length} order{app.orders.length === 1 ? '' : 's'} loaded
          {app.sourceLabel ? ` from ${app.sourceLabel}` : ''}
        </h2>
        <p className="text-ink-soft max-w-md mx-auto">
          {app.run.phase === 'loading' ? 'Fetching forecasts for every destination…' : 'Pick the ship date and build the pack list.'}
        </p>
      </section>
    )
  }

  return (
    <section className="sheet overflow-hidden" aria-label="Decisions">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line no-print">
        <h2 className="display text-lg">Decisions</h2>
        {app.needsRefetch && (
          <span className="text-sm text-hot">Origin or route settings changed — rebuild to fetch the new forecasts.</span>
        )}
        {app.run.message && (
          <span className="text-sm text-hot" role="status">
            {app.run.message}
            {app.run.errors.length > 0 && <span className="text-ink-soft"> ({app.run.errors[0]})</span>}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button className="btn btn-quiet" onClick={() => downloadText(`pack-list-${app.shipDate}.csv`, toCsv(lines, app.settings))}>
            Export CSV
          </button>
          <button className="btn" onClick={onGoToPackList}>
            Open pack list
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="bench">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Ship to</th>
              <th scope="col">Service</th>
              <th scope="col">Arrives</th>
              <th scope="col">Worst case</th>
              <th scope="col">Pack</th>
              <th scope="col">Pull</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <Row
                key={line.order.id}
                line={line}
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

function Row({ line, app, open, onToggle }: { line: PackLine; app: AppApi; open: boolean; onToggle: () => void }) {
  const d = line.decision
  const tier = effectiveTier(line)
  const m = lineMaterials(line, app.settings)
  const flags = (d.recommendation ? 1 : 0) + d.warnings.length
  const panelId = `row-${line.order.id.replace(/[^a-z0-9]/gi, '')}`

  return (
    <>
      <tr className={open ? 'bg-stone' : undefined}>
        <td>
          <div className="font-semibold">{d.orderId}</div>
          {line.order.customer && <div className="text-ink-soft text-sm">{line.order.customer}</div>}
        </td>
        <td>
          <div>{d.place || '—'}</div>
          <div className="text-ink-soft text-sm">{d.zip}</div>
        </td>
        <td>
          <div>{SERVICE_LABEL[d.serviceLevel]}</div>
          {d.status === 'ok' && (
            <div className="text-ink-soft text-sm">
              {d.transitDays} day{d.transitDays === 1 ? '' : 's'}
            </div>
          )}
        </td>
        <td>{d.status === 'ok' ? formatShort(d.deliveryDate) : '—'}</td>
        <td>
          {d.worst ? (
            <>
              <div className={`temp ${tier === 'double' ? 'text-hot' : tier === 'single' ? 'text-foil' : 'text-cold'}`}>
                {Math.round(d.worst.high!)}°F
              </div>
              <div className="text-ink-soft text-sm">
                {d.worst.place}, {formatShort(d.worst.date)}
              </div>
            </>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </td>
        <td>
          <TierStamp tier={tier} status={d.status} />
          {line.override && <div className="text-ink-soft text-xs mt-1">changed by hand</div>}
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
          <td colSpan={8} className="bg-stone">
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
  const setTier = (tier: Tier | '') => {
    if (tier === '' || tier === d.tier) app.setOverride(line.order.id, null)
    else app.setOverride(line.order.id, { tier, note })
  }
  const saveNote = () => {
    if (line.override) app.setOverride(line.order.id, { ...line.override, note })
  }

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1fr] py-2">
      <div className="flex flex-col gap-3">
        {d.recommendation && (
          <div className="border-l-4 border-hot pl-3">
            <div className="font-semibold text-hot">{d.recommendation.action === 'hold' ? 'Consider holding' : 'Consider a faster service'}</div>
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
            In the box: {line.order.lineItems.join(', ')} ({line.order.qty} piece{line.order.qty === 1 ? '' : 's'})
          </div>
        )}
        <div className="text-sm text-ink-soft">Forecast confidence: {d.confidence}</div>
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
                    <td className="pr-3">{p.high === null ? '—' : `${Math.round(p.high)}°`}</td>
                    <td>{p.low === null ? '—' : `${Math.round(p.low)}°`}</td>
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
            {line.override && (
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
