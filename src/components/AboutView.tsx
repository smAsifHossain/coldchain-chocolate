import type { AppApi } from '../app/useApp'

const LIMITS: { limit: string; fix: string }[] = [
  {
    limit: 'The forecast is for the center of the zip code, not the doorstep. A hillside address can run a few degrees off.',
    fix: 'Geocode the full street address with a paid geocoder and forecast that point.',
  },
  {
    limit: 'Hub and truck temperatures are guessed from the route midpoint. A box in a metal trailer in the sun runs hotter than the air.',
    fix: 'Pull the carrier’s tracking scans to learn the real hub locations, and calibrate with a temperature logger in a few real shipments.',
  },
  {
    limit: 'Transit days come from a distance table, not from the carrier. UPS and FedEx publish exact time-in-transit maps.',
    fix: 'Connect the UPS or FedEx time-in-transit API, or copy the carrier map into the transit table in Settings.',
  },
  {
    limit: 'Forecast confidence drops after 7 days and there is nothing beyond 16. Weekend and next-week plans are estimates.',
    fix: 'Run it again the morning of shipping — that is the intended daily workflow. Confidence is shown on every row.',
  },
  {
    limit: 'Porch time after delivery is a flat one-day buffer. A box left out over a long weekend is not modeled.',
    fix: 'Use the carrier’s delivery-confirmation webhook to know when a box has actually been picked up.',
  },
  {
    limit: 'If the forecast service (Open-Meteo) is unreachable, the tool shows the last saved forecast and says so; with nothing saved it defaults every order to double thermal.',
    fix: 'Add a second forecast provider such as the National Weather Service as an automatic fallback.',
  },
  {
    limit: 'Every product is treated the same. Truffles, caramels and solid bars soften at different temperatures.',
    fix: 'Map Shopify SKUs to a melt point per product and apply the most sensitive one in the box.',
  },
  {
    limit: 'Ice-pack counts are rules of thumb, not thermodynamics. Box size, liner quality and pack size all matter.',
    fix: 'Ship a few boxes with a temperature logger, then tune the counts in Settings to what actually holds.',
  },
  {
    limit: 'Zip codes cover the 50 states and DC. Puerto Rico and other territories are not in the table.',
    fix: 'Add the GeoNames PR / VI / GU tables to the build script.',
  },
  {
    limit: 'Materials are counted per order, not per box. An order that ships as two boxes needs the liners and ice packs doubled.',
    fix: 'Read the box count from Shopify fulfillment data, or add a boxes column to the export.',
  },
]

export function AboutView({ app }: { app: AppApi }) {
  const s = app.settings
  return (
    <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
      <section className="sheet p-6 md:p-8" aria-label="How it decides">
        <h2 className="display text-2xl mb-4">How it decides</h2>
        <ol className="flex flex-col gap-4 list-decimal pl-5 max-w-prose">
          <li>
            <strong>Find the destination.</strong> The zip is cleaned up (ZIP+4 trimmed, Excel’s dropped leading zeros restored) and looked up in a bundled table of
            41,000 US zip codes, so this step never waits on the network.
          </li>
          <li>
            <strong>Estimate the trip.</strong> Distance from {app.origin.city} sets ground transit days ({s.transit.zones.map((z) => `≤${z.maxMiles} mi: ${z.days}`).join(', ')}, farther: {s.transit.farDays}).
            2-Day and Overnight orders use their service. Delivery skips Sundays{s.saturdayDelivery ? '' : ' and Saturdays'}; a weekend ship date rolls to Monday.
          </li>
          <li>
            <strong>Fetch the forecast.</strong> Daily highs and lows for the next 16 days come from Open-Meteo for the origin, the destination{s.routeWaypoint ? ', and the route midpoint' : ''} —
            one request for the whole batch, no account or key.
          </li>
          <li>
            <strong>Build the exposure window.</strong> Ship day at origin, every day in transit, delivery day at the destination, and {s.porchDays} day{s.porchDays === 1 ? '' : 's'} on the porch.
          </li>
          <li>
            <strong>Take the worst case.</strong> The highest daily high anywhere in that window decides the tier: below {s.thresholds.single}°F no thermal, from {s.thresholds.single}°F a single
            liner, from {s.thresholds.double}°F two liners with ice packs. At {s.thresholds.hold}°F or above, or when a hot trip runs {s.longHotTransitDays}+ days, it also works out
            whether a faster service or a later ship day would help.
          </li>
          <li>
            <strong>Count the materials.</strong> Liners and ice packs per tier, plus an extra pack for each transit day beyond {s.materials.extraDayThreshold}, capped at {s.materials.icePackMax}.
            Cost uses the unit prices in Settings.
          </li>
          <li>
            <strong>Show the work.</strong> Every row lists the temperature, place and day that drove the call, so the packer can agree or change it — and the change is recorded on the pack list.
          </li>
        </ol>
        <h3 className="display text-lg mt-8 mb-2">Data sources</h3>
        <ul className="text-sm flex flex-col gap-1 max-w-prose">
          <li>
            Forecasts: <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (free, no key, CC BY 4.0).
          </li>
          <li>
            Zip code locations: <a className="underline" href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> postal codes (CC BY 4.0), compiled into the app.
          </li>
          <li>Nothing else leaves the browser. Orders, settings and overrides stay on this device.</li>
        </ul>
      </section>

      <section className="sheet p-6 md:p-8" aria-label="Where it breaks">
        <h2 className="display text-2xl mb-1">Where it breaks</h2>
        <p className="text-ink-soft text-sm mb-4">And what would fix each one.</p>
        <dl className="flex flex-col gap-4">
          {LIMITS.map((l, i) => (
            <div key={i} className="border-l-2 border-line-strong pl-3">
              <dt className="text-sm font-semibold">{l.limit}</dt>
              <dd className="text-sm text-ink-soft mt-1">Fix: {l.fix}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
