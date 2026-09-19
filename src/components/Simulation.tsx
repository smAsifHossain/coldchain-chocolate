import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDays,
  decide,
  effectiveShipDate,
  formatShort,
  getForecasts,
  lookupZip,
  midpoint,
  normalizeZip,
  pointKey,
  SERVICE_LABEL,
  sharedForecastCache,
  TIER_LABEL,
  weekdayName,
  type DecideContext,
  type Decision,
  type ExposurePoint,
  type ForecastMap,
  type GeoPoint,
  type Order,
  type Place,
  type ServiceLevel,
  type Tier,
} from '../engine'
import type { AppApi } from '../app/useApp'

const PRESETS: { zip: string; label: string }[] = [
  { zip: '85004', label: 'Phoenix' },
  { zip: '33131', label: 'Miami' },
  { zip: '75201', label: 'Dallas' },
  { zip: '60606', label: 'Chicago' },
  { zip: '80203', label: 'Denver' },
  { zip: '98101', label: 'Seattle' },
  { zip: '02138', label: 'Boston' },
]

const FRAME_MS = 520
const T_MIN = 40
const T_MAX = 110

interface DayCol {
  date: string
  place: string
  role: ExposurePoint['role']
  high: number | null
  tier: Tier | 'missing'
}

/** One column per calendar day: the hottest reading that day, labeled by where the box is. */
function columns(d: Decision, thresholds: { single: number; double: number }): DayCol[] {
  const byDate = new Map<string, DayCol>()
  for (const p of d.window) {
    const cur = byDate.get(p.date)
    const tier: DayCol['tier'] = p.high === null ? 'missing' : p.high >= thresholds.double ? 'double' : p.high >= thresholds.single ? 'single' : 'none'
    const candidate: DayCol = { date: p.date, place: p.place, role: p.role, high: p.high, tier }
    if (!cur) byDate.set(p.date, candidate)
    else if (p.high !== null && (cur.high === null || p.high > cur.high)) {
      // Keep the destination's name for in-transit days even when the route midpoint is hotter.
      byDate.set(p.date, { ...candidate, place: cur.role === 'transit' && p.role === 'route' ? cur.place : candidate.place, role: cur.role === 'transit' ? 'transit' : candidate.role })
    }
  }
  return [...byDate.values()]
}

function roleLabel(c: DayCol, origin: string): string {
  switch (c.role) {
    case 'origin':
      return origin
    case 'route':
    case 'transit':
      return 'in transit'
    case 'destination':
      return 'delivered'
    case 'porch':
      return 'day after delivery'
  }
}

function barHeight(high: number | null): string {
  if (high === null) return '6%'
  const pct = ((high - T_MIN) / (T_MAX - T_MIN)) * 100
  return `${Math.max(6, Math.min(100, pct))}%`
}

export function Simulation({ app }: { app: AppApi }) {
  const { zipDb, settings, origin, today } = app
  const [destZip, setDestZip] = useState(PRESETS[0].zip)
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [service, setService] = useState<ServiceLevel>('ground')
  const [shipDate, setShipDate] = useState(() => effectiveShipDate(today).date)
  const [forecasts, setForecasts] = useState<ForecastMap>(new Map())
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [frame, setFrame] = useState(-1)
  const cache = useRef(sharedForecastCache())
  const timer = useRef<number | null>(null)

  const shipChoices = useMemo(() => {
    const out: string[] = []
    let d = effectiveShipDate(today).date
    while (out.length < 5) {
      out.push(d)
      d = effectiveShipDate(addDays(d, 1)).date
    }
    return out
  }, [today])

  const dest: Place | null = useMemo(() => (zipDb ? lookupZip(zipDb, destZip) : null), [zipDb, destZip])

  // Fetch the origin, every preset and every midpoint in one request; custom zips add one more.
  useEffect(() => {
    if (!zipDb) return
    const zips = new Set([...PRESETS.map((p) => p.zip), destZip])
    const points: GeoPoint[] = [origin]
    for (const z of zips) {
      const p = lookupZip(zipDb, z)
      if (!p) continue
      points.push(p, midpoint(origin.lat, origin.lon, p.lat, p.lon))
    }
    const needed = points.filter((p) => !forecasts.has(pointKey(p)))
    if (needed.length === 0) {
      setFetchState('ready')
      return
    }
    let cancelled = false
    setFetchState('loading')
    getForecasts(points, { cache: cache.current }).then((r) => {
      if (cancelled) return
      setForecasts((prev) => new Map([...prev, ...r.forecasts]))
      setFetchState(r.forecasts.size === 0 ? 'error' : 'ready')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zipDb, origin, destZip])

  const decision: Decision | null = useMemo(() => {
    if (!zipDb || !dest || fetchState !== 'ready') return null
    const ctx: DecideContext = { settings, shipDate, today, origin, zipDb, forecasts }
    const order: Order = { id: 'demo', zip: dest.zip, qty: 1, serviceLevel: service }
    return decide(order, ctx)
  }, [zipDb, dest, fetchState, settings, shipDate, today, origin, forecasts, service])

  const cols = useMemo(() => (decision ? columns(decision, settings.thresholds) : []), [decision, settings.thresholds])
  const worstIdx = decision?.worst ? cols.findIndex((c) => c.date === decision.worst!.date) : -1

  // Play the trip every time the decision changes.
  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current)
    setFrame(-1)
    if (!decision || cols.length === 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setFrame(cols.length)
      return
    }
    let f = -1
    timer.current = window.setInterval(() => {
      f += 1
      setFrame(f)
      if (f >= cols.length && timer.current) {
        window.clearInterval(timer.current)
        timer.current = null
      }
    }, FRAME_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [decision, cols.length])

  const replay = () => {
    if (timer.current) window.clearInterval(timer.current)
    setFrame(-1)
    let f = -1
    timer.current = window.setInterval(() => {
      f += 1
      setFrame(f)
      if (f >= cols.length && timer.current) {
        window.clearInterval(timer.current)
        timer.current = null
      }
    }, FRAME_MS)
  }

  const applyCustom = () => {
    const n = normalizeZip(custom)
    if (!n.zip || !zipDb || !lookupZip(zipDb, n.zip)) {
      setCustomError(n.note ?? `${custom} is not a zip code in the table`)
      return
    }
    setCustomError(null)
    setDestZip(n.zip)
  }

  const done = frame >= cols.length && decision !== null
  const boxIdx = Math.max(0, Math.min(cols.length - 1, frame))
  const originLabel = `${origin.city}, ${origin.state}`

  return (
    <section className="thermal" aria-label="Simulation">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-10 md:py-14 flex flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="display text-3xl md:text-4xl">Watch one box make the trip</h2>
            <p className="muted mt-2 max-w-prose">
              Live forecast, real rules. Pick where it is going and when it leaves {origin.city}; the hottest day anywhere along the way decides how it gets packed.
            </p>
          </div>
          <button className="btn" onClick={replay} disabled={!decision}>
            Play again
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Destination">
            <span className="muted text-sm mr-1">To</span>
            {PRESETS.map((p) => (
              <button key={p.zip} className="btn !min-h-10 !py-1.5 !px-3 text-sm" aria-pressed={destZip === p.zip} onClick={() => setDestZip(p.zip)}>
                {p.label}
              </button>
            ))}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                applyCustom()
              }}
            >
              <input
                className="field !w-28 !min-h-10 !py-1.5 text-sm"
                placeholder="any zip"
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Any US zip code"
              />
              <button className="btn !min-h-10 !py-1.5 !px-3 text-sm" type="submit">
                Go
              </button>
            </form>
            {customError && (
              <span className="text-sm" style={{ color: '#f0a08a' }} role="alert">
                {customError}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ship day">
            <span className="muted text-sm mr-1">Leaving</span>
            {shipChoices.map((d) => (
              <button key={d} className="btn !min-h-10 !py-1.5 !px-3 text-sm" aria-pressed={shipDate === d} onClick={() => setShipDate(d)}>
                {formatShort(d)}
              </button>
            ))}
            <span className="muted text-sm ml-3 mr-1">by</span>
            {(['ground', 'two_day', 'overnight'] as ServiceLevel[]).map((s) => (
              <button key={s} className="btn !min-h-10 !py-1.5 !px-3 text-sm" aria-pressed={service === s} onClick={() => setService(s)}>
                {SERVICE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {fetchState === 'error' && (
          <p role="alert" style={{ color: '#f0a08a' }}>
            The forecast service could not be reached, so there is nothing to simulate right now. The planner would fall back to its last saved forecast.
          </p>
        )}

        {decision && decision.status !== 'ok' && (
          <p role="status" className="muted">
            {decision.warnings[0]}
          </p>
        )}

        {decision && decision.status === 'ok' && cols.length > 0 && (
          <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-end">
            <div className="relative" aria-label="Day by day temperatures">
              <div className="relative h-12">
                <div
                  className="box-glyph absolute top-0 -translate-x-1/2"
                  style={{ left: `${cols.length > 1 ? (boxIdx / (cols.length - 1)) * 100 : 50}%` }}
                  aria-hidden="true"
                >
                  <BoxGlyph tier={frame >= worstIdx && worstIdx >= 0 ? decision.tier : 'none'} />
                </div>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
                {cols.map((c, i) => (
                  <div key={c.date} className="day-col flex flex-col items-center gap-2" data-lit={frame >= i} data-worst={done && i === worstIdx}>
                    <div className="h-40 md:h-52 w-full max-w-16 flex items-end">
                      <div className={`bar bar-${c.tier}`} style={{ ['--h' as string]: frame >= i ? barHeight(c.high) : '0%' }} />
                    </div>
                    <div className="display text-lg md:text-2xl">{c.high === null ? '—' : `${Math.round(c.high)}°`}</div>
                    <div className="text-sm text-center leading-tight">
                      <div>{weekdayName(c.date)}</div>
                      <div className="faint text-xs">{c.date.slice(5).replace('-', '/')}</div>
                    </div>
                    <div className="muted text-xs text-center leading-tight">{roleLabel(c, originLabel)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-h-[12rem]">
              {done ? (
                <Verdict decision={decision} destLabel={dest ? `${dest.city}, ${dest.state}` : ''} />
              ) : (
                <p className="muted">
                  {frame < 0 ? 'Leaving…' : frame < cols.length ? `${formatShort(cols[boxIdx].date)}: ${roleLabel(cols[boxIdx], originLabel)}` : ''}
                </p>
              )}
            </div>
          </div>
        )}

        {fetchState === 'loading' && !decision && <p className="muted">Fetching the forecast…</p>}
      </div>
    </section>
  )
}

function Verdict({ decision: d, destLabel }: { decision: Decision; destLabel: string }) {
  const cls = d.tier === 'double' ? 'stamp-double' : d.tier === 'single' ? 'stamp-single' : 'stamp-none'
  const pull = [
    d.liners > 0 ? `${d.liners} liner${d.liners === 1 ? '' : 's'}` : null,
    d.icePacks > 0 ? `${d.icePacks} ice pack${d.icePacks === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return (
    <div className="fade-in flex flex-col gap-3">
      <span className={`stamp stamp-in ${cls}`} style={{ fontSize: '1.05rem', padding: '0.4em 0.8em', alignSelf: 'flex-start' }}>
        {TIER_LABEL[d.tier]}
      </span>
      <p>
        Worst case <strong>{Math.round(d.worst!.high!)}°F</strong> in {d.worst!.place} on {formatShort(d.worst!.date)}.
      </p>
      <p className="muted text-sm">
        {destLabel}: {SERVICE_LABEL[d.serviceLevel]}, {d.transitDays} day{d.transitDays === 1 ? '' : 's'}, delivered {formatShort(d.deliveryDate)}.
      </p>
      <p>
        <span className="muted text-sm">Pull </span>
        <strong>{pull.length ? pull.join(' + ') : 'nothing extra'}</strong>
        {d.cost > 0 && <span className="muted text-sm"> — about ${d.cost.toFixed(2)}</span>}
      </p>
      {d.recommendation && <p className="text-sm" style={{ color: '#f0c8a0' }}>{d.recommendation.detail}</p>}
      {d.warnings.length > 0 && <p className="faint text-xs">{d.warnings[0]}</p>}
    </div>
  )
}

/** A small kraft box; the band takes the tier color once the hot day has been passed. */
function BoxGlyph({ tier }: { tier: Tier }) {
  const band = tier === 'double' ? '#e24b2a' : tier === 'single' ? '#e0a93a' : '#7fa7c4'
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="4" y="10" width="32" height="26" rx="3" fill="#c9a27a" />
      <rect x="4" y="10" width="32" height="8" rx="3" fill="#b28a63" />
      <rect x="17" y="10" width="6" height="26" fill={band} />
      <rect x="4" y="21" width="32" height="4" fill={band} opacity="0.9" />
    </svg>
  )
}
