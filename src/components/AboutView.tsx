import { useState } from 'react'
import { materialsFor, TIER_LABEL, type Tier } from '../engine'
import type { AppApi } from '../app/useApp'
import { TierStamp } from './TierStamp'

const LIMITS: { limit: string; fix: string }[] = [
  {
    limit: 'The forecast is for the center of the zip code, not the doorstep. A hillside address can run a few degrees off.',
    fix: 'Geocode the full street address. Not done on purpose, because it would send customer addresses to a third-party service. Today nothing about an order leaves the browser.',
  },
  {
    limit: 'Hub and truck temperatures are guessed from the route midpoint. A box in a metal trailer in the sun runs hotter than the air.',
    fix: 'Carrier tracking scans give the real hub locations; a temperature logger in a few real shipments gives the truck-versus-air gap. Both need Cocoa Dolce’s carrier account.',
  },
  {
    limit: 'Transit days come from a distance table, not from the carrier. UPS and FedEx publish exact time-in-transit maps.',
    fix: 'Copy the carrier map into the transit table in Settings today; connect the UPS or FedEx time-in-transit API when an account is available.',
  },
  {
    limit: 'Forecast confidence drops after 7 days and there is nothing beyond 16. Next week is an estimate.',
    fix: 'Physics. Run it again the morning of shipping. That is the intended daily workflow, and confidence is printed on every row.',
  },
  {
    limit: 'Porch time after delivery is a flat buffer. A box left out over a long weekend is not modeled.',
    fix: 'The carrier’s delivery-confirmation webhook would say when the box was picked up. Until then, raise the porch days in Settings for rural routes.',
  },
  {
    limit: 'Product sensitivity rules ship with starting numbers (cream centers 5°F stricter, milk and white chocolate 3°F). They are educated guesses, not measurements.',
    fix: 'Cocoa Dolce knows its own recipes. Adjust the offsets in Settings, or add a rule per SKU.',
  },
  {
    limit: 'Ice-pack counts are rules of thumb, not thermodynamics. Box size, liner quality and pack size all matter.',
    fix: 'Ship a few boxes with a temperature logger, then tune the counts in Settings to what actually holds.',
  },
  {
    limit: 'Boxes per order defaults to one. A large order that ships as several boxes needs the count set by hand.',
    fix: 'Read the box count from Shopify fulfillment data once orders are split there.',
  },
]

const SOLVED: string[] = [
  'A second forecast provider. If Open-Meteo is down, the National Weather Service answers (7 days instead of 16), and the pack list says so.',
  'Puerto Rico, the US Virgin Islands and Guam are in the zip table.',
  'Carrier holidays, the pickup cutoff, store-pickup orders, PO boxes and military addresses are all handled and explained on the row.',
  'A zip that lands in a different state than the order says is flagged instead of silently trusted. It is the kind of typo that looks right until the box melts.',
]

export function AboutView({ app }: { app: AppApi }) {
  const s = app.settings
  return (
    <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-5">
        <WhatIf app={app} />
        <section className="sheet p-6 md:p-8" aria-label="How it decides">
          <h2 className="display text-2xl mb-4">How it decides</h2>
          <ol className="flex flex-col gap-4 list-decimal pl-5 max-w-prose">
            <li>
              <strong>Find the destination.</strong> The zip is cleaned up (ZIP+4 trimmed, Excel’s dropped leading zeros restored) and looked up in a bundled table of
              41,700 zip codes covering the 50 states, DC, Puerto Rico, the Virgin Islands and Guam, so this step never waits on the network. A zip in the wrong state
              for the order is sent to “check by hand”.
            </li>
            <li>
              <strong>Estimate the trip.</strong> Distance from {app.origin.city} sets ground transit days ({s.transit.zones.map((z) => `${z.days} up to ${z.maxMiles} mi`).join(', ')}, {s.transit.farDays} beyond).
              2-Day Air and Next Day Air orders use their service; store pickups have no trip at all. Delivery skips Sundays{s.saturdayDelivery ? '' : ', Saturdays'}
              {s.observeHolidays ? ' and the six carrier holidays' : ''}; after the {s.pickupCutoff} pickup, “today” means the next carrier day.
            </li>
            <li>
              <strong>Fetch the forecast.</strong> Daily highs and lows for the next 16 days from Open-Meteo for the origin, the destination{s.routeWaypoint ? ' and the route midpoint' : ''},
              in one request for the whole batch with no account or key. If Open-Meteo is down, the National Weather Service fills in.
            </li>
            <li>
              <strong>Build the exposure window.</strong> Ship day at origin, every day in transit, delivery day at the destination, and {s.porchDays} day{s.porchDays === 1 ? '' : 's'} after delivery, in case the box sits outside.
            </li>
            <li>
              <strong>Take the worst case.</strong> The highest daily high anywhere in that window decides the tier. Below {s.thresholds.single}°F no thermal, from {s.thresholds.single}°F a single
              liner, from {s.thresholds.double}°F two liners with ice packs. Boxes with cream centers or milk chocolate are judged a few degrees stricter. At {s.thresholds.hold}°F or above, or when a hot trip runs{' '}
              {s.longHotTransitDays}+ days, it also works out whether a faster service or a later ship day would help.
            </li>
            <li>
              <strong>Count the materials.</strong> Liners and ice packs per tier, an extra pack for each transit day beyond {s.materials.extraDayThreshold} (capped at {s.materials.icePackMax}),
              times the number of boxes. Cost uses the unit prices in Settings.
            </li>
            <li>
              <strong>Show the work.</strong> Every row lists the temperature, place and day that drove the call, so the packer can agree or change it, and the change is recorded on the pack list.
            </li>
          </ol>
          <h3 className="display text-lg mt-8 mb-2">Data sources</h3>
          <ul className="text-sm flex flex-col gap-1 max-w-prose">
            <li>
              Forecasts: <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (free, no key, CC BY 4.0), with the{' '}
              <a className="underline" href="https://www.weather.gov/documentation/services-web-api" target="_blank" rel="noreferrer">National Weather Service API</a> as fallback.
            </li>
            <li>
              Zip code locations: <a className="underline" href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> postal codes (CC BY 4.0), compiled into the app.
            </li>
            <li>Nothing else leaves the browser. Orders, settings, overrides and ticks stay on this device.</li>
          </ul>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        <section className="sheet p-6 md:p-8" aria-label="Where it breaks">
          <h2 className="display text-2xl mb-1">Where it breaks</h2>
          <p className="text-ink-soft text-sm mb-4">And what would fix each one.</p>
          <dl className="flex flex-col gap-4">
            {LIMITS.map((l, i) => (
              <div key={i} className="border-l-2 border-line-strong pl-3">
                <dt className="text-sm font-semibold">{l.limit}</dt>
                <dd className="text-sm text-ink-soft mt-1">
                  <span className="font-semibold text-ink">Fix</span> {l.fix}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="sheet p-6 md:p-8" aria-label="Already handled">
          <h2 className="display text-xl mb-3">Already handled</h2>
          <ul className="flex flex-col gap-2 text-sm text-ink-soft list-disc pl-5">
            {SOLVED.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** Drag the worst-case temperature and the transit days; watch the call change. */
function WhatIf({ app }: { app: AppApi }) {
  const s = app.settings
  const [high, setHigh] = useState(88)
  const [days, setDays] = useState(3)
  const [sensitive, setSensitive] = useState(false)
  const offset = sensitive ? Math.min(0, ...s.productRules.map((r) => r.offset)) : 0
  const t = { single: s.thresholds.single + offset, double: s.thresholds.double + offset, hold: s.thresholds.hold + offset }
  const tier: Tier = high >= t.double ? 'double' : high >= t.single ? 'single' : 'none'
  const m = materialsFor(tier, days, s)
  const tooHot = high >= t.hold
  const color = tier === 'double' ? '#b3311f' : tier === 'single' ? '#a8720e' : '#3b5f7a'

  return (
    <section className="sheet p-6 md:p-8" aria-label="Try the rules">
      <h2 className="display text-2xl mb-1">Try the rules</h2>
      <p className="text-ink-soft text-sm mb-5">Slide the worst-case temperature and the transit time; the call updates with your current settings.</p>
      <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="flex justify-between text-sm">
              <span className="font-semibold">Hottest day on the trip</span>
              <span className="display text-xl" style={{ color }}>
                {high}°F
              </span>
            </span>
            <input type="range" min={40} max={110} value={high} onChange={(e) => setHigh(Number(e.target.value))} className="w-full accent-ink" />
            <span className="flex justify-between text-xs text-ink-faint">
              <span>40°</span>
              <span>single from {t.single}°</span>
              <span>double from {t.double}°</span>
              <span>110°</span>
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="flex justify-between text-sm">
              <span className="font-semibold">Days in transit</span>
              <span className="display text-xl">{days}</span>
            </span>
            <input type="range" min={0} max={6} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full accent-ink" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
            Box has cream centers or milk chocolate ({Math.abs(Math.min(0, ...s.productRules.map((r) => r.offset)))}°F stricter)
          </label>
        </div>
        <div className="flex flex-col items-start gap-3 md:min-w-[16rem]">
          <span className="stamp-in inline-block" key={tier}>
            <TierStamp tier={tier} size="lg" />
          </span>
          <div className="display text-2xl">{TIER_LABEL[tier]}</div>
          <div className="text-sm">
            Pull{' '}
            <strong>
              {m.liners > 0 ? `${m.liners} liner${m.liners === 1 ? '' : 's'}` : ''}
              {m.liners > 0 && m.icePacks > 0 ? ' + ' : ''}
              {m.icePacks > 0 ? `${m.icePacks} ice pack${m.icePacks === 1 ? '' : 's'}` : ''}
              {!m.liners && !m.icePacks ? 'nothing extra' : ''}
            </strong>
            {m.cost > 0 && <span className="text-ink-soft">, about ${m.cost.toFixed(2)}</span>}
          </div>
          {tooHot && <div className="text-sm text-hot">At or above {t.hold}°F the planner would suggest a faster service or a cooler ship day.</div>}
          {tier === 'double' && days >= s.longHotTransitDays && !tooHot && (
            <div className="text-sm text-hot">{days} days on ice is a long trip, so the planner would suggest 2-Day Air.</div>
          )}
        </div>
      </div>
    </section>
  )
}
