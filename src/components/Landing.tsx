import { useEffect, useMemo, useState } from 'react'
import { dayAt, formatShort, getForecasts, lookupZip, pointKey, sharedForecastCache, type DailyForecast, type Place } from '../engine'
import type { AppApi } from '../app/useApp'
import { Simulation } from './Simulation'

interface Props {
  app: AppApi
  onOpenPlanner: () => void
  onDemo: () => void
  onAbout: () => void
}

export function Landing({ app, onOpenPlanner, onDemo, onAbout }: Props) {
  return (
    <div className="flex flex-col">
      <Hero app={app} onOpenPlanner={onOpenPlanner} onDemo={onDemo} />
      <Simulation app={app} />
      <HowItWorks app={app} />
      <Limits onAbout={onAbout} />
    </div>
  )
}

/** Destinations the headline and thermometer cycle through: where Cocoa Dolce's boxes actually go. */
const CITIES: { zip: string; name: string }[] = [
  { zip: '67206', name: 'Wichita' },
  { zip: '75201', name: 'Dallas' },
  { zip: '78701', name: 'Austin' },
  { zip: '10001', name: 'New York' },
  { zip: '60606', name: 'Chicago' },
  { zip: '85004', name: 'Phoenix' },
  { zip: '33131', name: 'Miami' },
  { zip: '80203', name: 'Denver' },
  { zip: '98101', name: 'Seattle' },
  { zip: '30308', name: 'Atlanta' },
]

const CYCLE_MS = 2600

function Hero({ app, onOpenPlanner, onDemo }: Pick<Props, 'app' | 'onOpenPlanner' | 'onDemo'>) {
  const [highs, setHighs] = useState<Map<string, DailyForecast | null>>(new Map())
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)

  const places = useMemo<Place[]>(() => (app.zipDb ? CITIES.map((c) => lookupZip(app.zipDb!, c.zip)).filter((p): p is Place => !!p) : []), [app.zipDb])

  // One request for every city; the shared cache means the simulation below reuses it.
  useEffect(() => {
    if (places.length === 0) return
    let cancelled = false
    getForecasts(places, { cache: sharedForecastCache() }).then((r) => {
      if (cancelled) return
      const next = new Map<string, DailyForecast | null>()
      for (const p of places) next.set(p.zip, dayAt(r.forecasts.get(pointKey(p)), app.today))
      setHighs(next)
    })
    return () => {
      cancelled = true
    }
  }, [places, app.today])

  // Cycle the city; hold still for people who asked for reduced motion.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || places.length === 0) return
    const id = window.setInterval(() => setIdx((i) => (i + 1) % places.length), CYCLE_MS)
    return () => window.clearInterval(id)
  }, [places.length])

  const current = places[idx] ?? null
  const day = current ? (highs.get(current.zip) ?? null) : null
  const th = app.settings.thresholds
  const cityColor = day === null ? 'var(--color-ink)' : day.high >= th.double ? 'var(--color-hot)' : day.high >= th.single ? 'var(--color-foil)' : 'var(--color-cold)'

  const demo = async () => {
    setBusy(true)
    try {
      await onDemo()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 md:px-6 pt-10 pb-12 md:pt-16 md:pb-16 grid gap-10 lg:grid-cols-[3fr_2fr] lg:items-center" aria-label="Introduction">
      <div className="flex flex-col gap-6">
        <h1 className="display text-4xl md:text-6xl max-w-[16ch]">
          Know if the chocolate will melt on the way to
          <span className="block whitespace-nowrap">
            <span className="city-swap" key={current?.zip ?? 'none'} aria-live="polite" style={{ color: cityColor }}>
              {current?.city ?? 'anywhere'}
            </span>
            .
          </span>
        </h1>
        <p className="text-lg text-ink-soft max-w-prose">
          ColdChain reads the day's Shopify orders, checks the forecast along every route out of {app.origin.city}, and tells the packing bench exactly what to pull
          for each box: no thermal, a single liner, or double thermal with ice packs. One wrong call melts product; this makes the call for every order in seconds.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary text-base" onClick={onOpenPlanner}>
            Open the planner
          </button>
          <button className="btn text-base" onClick={demo} disabled={busy || !app.zipDb}>
            {busy ? 'Building…' : 'Try it with sample orders'}
          </button>
        </div>
        <p className="text-ink-faint text-sm">No account, nothing to install. Forecasts are live; nothing about the orders leaves this browser.</p>
      </div>
      <Thermometer
        high={day?.high ?? null}
        date={app.today}
        place={current ? `${current.city}, ${current.state}` : ''}
        thresholds={app.settings.thresholds}
        cities={places.map((p) => p.city)}
        active={idx}
        onPick={setIdx}
      />
    </section>
  )
}

/** Today's high at the origin against the three thresholds — the whole tool in one glance. */
function Thermometer({
  high,
  date,
  place,
  thresholds,
  cities,
  active,
  onPick,
}: {
  high: number | null
  date: string
  place: string
  thresholds: { single: number; double: number; hold: number }
  cities: string[]
  active: number
  onPick: (i: number) => void
}) {
  const MIN = 30
  const MAX = 110
  const H = 260
  const TOP = 24
  const y = (t: number) => TOP + ((MAX - Math.max(MIN, Math.min(MAX, t))) / (MAX - MIN)) * H
  const fillTop = high === null ? TOP + H : y(high)
  const tier = high === null ? null : high >= thresholds.double ? 'double' : high >= thresholds.single ? 'single' : 'none'
  const color = tier === 'double' ? '#b3311f' : tier === 'single' ? '#a8720e' : tier === 'none' ? '#3b5f7a' : '#b9b0a4'
  const label = tier === 'double' ? 'double thermal weather' : tier === 'single' ? 'single thermal weather' : tier === 'none' ? 'no thermal needed' : 'fetching the forecast'

  return (
    <figure className="sheet p-6 flex flex-col items-center gap-4" aria-label={`${place} high today`}>
      <div className="flex items-center gap-6 justify-center">
      <svg width="210" height={H + 70} viewBox={`0 0 210 ${H + 70}`} role="img" aria-label={high === null ? 'Thermometer loading' : `${Math.round(high)} degrees today`}>
        <title>{place} high today</title>
        {/* scale on the right */}
        {[MIN, 50, 70, 90, MAX].map((tk) => (
          <g key={tk}>
            <line x1="134" x2="140" y1={y(tk)} y2={y(tk)} stroke="#b9b0a4" strokeWidth="1" />
            <text x="145" y={y(tk) + 4} fontSize="11" fill="#9a8b80">
              {tk}°
            </text>
          </g>
        ))}
        {/* thresholds on the left */}
        {[
          { t: thresholds.single, c: '#a8720e', l: `single ${thresholds.single}°` },
          { t: thresholds.double, c: '#b3311f', l: `double + ice ${thresholds.double}°` },
        ].map((m) => (
          <g key={m.l}>
            <line x1="96" x2="140" y1={y(m.t)} y2={y(m.t)} stroke={m.c} strokeWidth="1.5" strokeDasharray="3 3" />
            <text x="92" y={y(m.t) + 4} fontSize="11" fill={m.c} fontWeight="700" textAnchor="end">
              {m.l}
            </text>
          </g>
        ))}
        {/* tube */}
        <rect x="110" y={TOP - 4} width="20" height={H + 8} rx="10" fill="#f4f2ee" stroke="#b9b0a4" strokeWidth="1.5" />
        <rect
          className="tube-fill"
          x="114"
          y={TOP}
          width="12"
          height={H + 4}
          rx="6"
          fill={color}
          style={{ transformOrigin: `120px ${TOP + H + 4}px`, transform: `scaleY(${(TOP + H + 4 - fillTop) / (H + 4)})`, transition: 'transform 900ms cubic-bezier(0.2, 0.8, 0.2, 1), fill 500ms ease' }}
        />
        <circle cx="120" cy={TOP + H + 22} r="18" fill={color} stroke="#f4f2ee" strokeWidth="3" style={{ transition: 'fill 500ms ease' }} />
        <circle cx="120" cy={TOP + H + 22} r="21" fill="none" stroke="#b9b0a4" strokeWidth="1.5" />
      </svg>
      <figcaption className="flex flex-col gap-1 min-w-[12rem]" key={place}>
        <div className="text-ink-soft text-sm fade-in">{place ? `${place}, ${formatShort(date)}` : formatShort(date)}</div>
        <div className="display text-5xl fade-in" style={{ color, transition: 'color 500ms ease' }}>
          {high === null ? 'loading' : `${Math.round(high)}°F`}
        </div>
        <div className="text-sm text-ink-soft fade-in">{label}</div>
      </figcaption>
      </div>
      {cities.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="City">
          {cities.map((c, i) => (
            <button
              key={c}
              role="tab"
              aria-selected={i === active}
              className={`city-dot ${i === active ? 'is-active' : ''}`}
              onClick={() => onPick(i)}
              aria-label={c}
              title={c}
            />
          ))}
        </div>
      )}
    </figure>
  )
}

function HowItWorks({ app }: { app: AppApi }) {
  const s = app.settings
  const steps = [
    {
      title: 'Upload the day’s orders',
      body: 'The Shopify order export, as it comes. Line items are grouped by order, zips are cleaned up, and orders that already shipped are set aside.',
    },
    {
      title: 'Check the weather along every route',
      body: `Ground transit is estimated from distance; delivery skips weekends. Daily highs are fetched for ${app.origin.city}, the route and each destination, from ship day to the day after delivery, in one request for the whole batch.`,
    },
    {
      title: 'Stamp every box',
      body: `The hottest day anywhere on the trip sets the tier. Below ${s.thresholds.single}°F nothing, from ${s.thresholds.single}°F a liner, from ${s.thresholds.double}°F two liners and ice. The bench gets a printed list, grouped by what to pull, hottest first.`,
    },
  ]
  return (
    <section className="mx-auto w-full max-w-7xl px-4 md:px-6 py-12 md:py-16" aria-label="How it works">
      <h2 className="display text-3xl md:text-4xl mb-8">Three steps, every morning</h2>
      <ol className="grid gap-8 md:grid-cols-3">
        {steps.map((st, i) => (
          <li key={st.title} className="flex gap-4">
            <div className="display text-4xl text-ink-faint leading-none">{i + 1}</div>
            <div>
              <h3 className="display text-xl mb-2">{st.title}</h3>
              <p className="text-ink-soft">{st.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Limits({ onAbout }: { onAbout: () => void }) {
  return (
    <section className="bg-paper border-t border-line" aria-label="Limits">
      <div className="mx-auto w-full max-w-7xl px-4 md:px-6 py-12 md:py-16 grid gap-8 lg:grid-cols-[2fr_3fr] lg:items-start">
        <div>
          <h2 className="display text-3xl md:text-4xl mb-3">Where it breaks</h2>
          <p className="text-ink-soft max-w-prose">A forecast is not a thermometer in the truck. The tool says so, row by row, and never invents a temperature it does not have.</p>
          <button className="btn mt-6" onClick={onAbout}>
            All ten limits, with the fix for each
          </button>
        </div>
        <ul className="flex flex-col gap-4">
          {[
            'The forecast is for the center of the zip code, not the doorstep. A hillside address can run a few degrees off.',
            'Transit days come from a distance table, not the carrier. The table is editable, and a carrier quote always wins.',
            'If the forecast service is unreachable, the last saved forecast is shown and labeled; with nothing saved, every order defaults to double thermal and says to check by hand.',
          ].map((t) => (
            <li key={t} className="border-l-2 border-line-strong pl-4 text-ink-soft">
              {t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
