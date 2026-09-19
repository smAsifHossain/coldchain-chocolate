<div align="center">

# ColdChain

**Thermal packaging decisions for every Cocoa Dolce order, from the forecast along its route.**

ColdChain reads the day's Shopify orders, looks up the weather for each box's whole
trip, and tells the packing bench what to pull: no thermal, a single liner, or double
thermal with ice packs. It runs entirely in the browser with no account, no API key,
and no server.

<p>
  <a href="https://smasifhossain.github.io/coldchain-chocolate/"><img alt="ColdChain live application" src="https://img.shields.io/badge/Live%20app-Open-b3311f?style=flat&amp;logo=googlechrome&amp;logoColor=white&amp;labelColor=2b1a12"></a>
  <a href="package.json"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat&amp;logo=typescript&amp;logoColor=white&amp;labelColor=2b1a12"></a>
  <a href="package.json"><img alt="React 19" src="https://img.shields.io/badge/React-19-61dafb?style=flat&amp;logo=react&amp;logoColor=white&amp;labelColor=2b1a12"></a>
  <a href="src/engine/__tests__"><img alt="85 tests" src="https://img.shields.io/badge/Tests-85%20passing-16a34a?style=flat&amp;logo=vitest&amp;logoColor=white&amp;labelColor=2b1a12"></a>
  <a href="LICENSE"><img alt="BSD 2-Clause License" src="https://img.shields.io/badge/License-BSD--2--Clause-16a34a?style=flat&amp;logo=opensourceinitiative&amp;logoColor=white&amp;labelColor=2b1a12"></a>
</p>

[Live application](https://smasifhossain.github.io/coldchain-chocolate/) | [How it decides](https://smasifhossain.github.io/coldchain-chocolate/#about) | [Sample orders](samples/shopify-orders-50.csv) | [Chocolathon prompt](https://www.wsuaiclub.com/hq)

Built for the WSU Chocolathon, September 2026, Build Track prompt B-2, Thermal Shipping Decision Engine.

</div>

---

## What ColdChain does

Every morning Cocoa Dolce's shipping team checks zip codes against the weather and
decides, box by box, how much thermal protection to use. One wrong call melts
product. ColdChain makes that call for every order in the day's Shopify export and
prints the pack list the bench works from.

For each order it locates the destination, estimates the trip, fetches a 16-day
forecast for the origin, the route and the destination, and judges the box on the
hottest day anywhere in that window, from the morning it leaves Wichita to the day
after it is delivered. Every decision shows the temperature, place and day that
drove it, so a packer can agree with it or change it.

ColdChain is a hackathon prototype. Its transit times and material counts are
editable rules of thumb, not carrier quotes or thermodynamics, and it says so on
every screen where that matters.

## Main features

- Accepts a Shopify order export as it comes, or any CSV with a zip column.
- Locates 41,702 zip codes from a table bundled into the app, with no lookup service.
- Fetches forecasts from Open-Meteo in one request per batch, with the National
  Weather Service as an automatic fallback and a labeled cache when both are down.
- Judges the worst case across ship day, transit days, delivery day and the day
  after delivery, including a route midpoint as a stand-in for the carrier hub.
- Applies configurable thresholds, stricter rules for cream centers and milk
  chocolate, and counts liners, ice packs and packaging cost per box.
- Handles weekends, the six carrier holidays, the daily pickup cutoff, store
  pickups, PO boxes, Alaska, Hawaii, territories and military addresses.
- Flags what it cannot judge, such as a zip in the wrong state for the order,
  instead of guessing.
- Suggests holding or upgrading to air service when a trip is simply too hot.
- Prints a pack list grouped by what to pull, with ticks that survive a refresh,
  and a card layout for the bench tablet.
- Keeps orders, settings, overrides and ticks on the device. Nothing about an
  order leaves the browser.

## How an order is judged

1. **Find the destination.** The zip is cleaned (ZIP+4 trimmed, Excel's dropped
   leading zeros restored, Shopify's leading apostrophe removed) and looked up in
   the bundled table. A zip whose state does not match the order, a non-US
   address, or a missing zip is sent to "check by hand" at the safest tier.
2. **Estimate the trip.** Distance from the origin sets ground transit days.
   2-Day Air and Next Day Air use their service; a store pickup has no trip.
   Delivery skips Sundays, Saturdays unless enabled, and carrier holidays. A
   weekend or holiday ship date rolls forward to the next carrier day.
3. **Fetch the forecast.** Daily highs and lows for the next 16 days for the
   origin, the destination and the great-circle midpoint, one request for up to
   50 locations. Results are cached for six hours.
4. **Build the exposure window.** Ship day at the origin, every day in transit at
   the midpoint and the destination, delivery day, and one day after delivery in
   case the box sits outside.
5. **Take the worst case.** The highest daily high in the window sets the tier.
   Boxes containing cream centers or milk chocolate are judged a few degrees
   stricter. At or above the hold threshold, or on a long hot trip, the engine
   re-runs itself with 2-Day Air and with each of the next seven ship dates to
   find a better option.
6. **Count the materials.** Liners and ice packs per tier, an extra ice pack for
   each transit day beyond the second, times the number of boxes, priced from
   unit costs.
7. **Show the work.** Each row lists its reasons and warnings in plain language.
   A packer can change the tier, set the box count, and leave a note; the change
   is recorded on the pack list and in the CSV export.

### Tiers

| Stamp | Worst-case daily high | Pull |
| --- | --- | --- |
| No thermal | Below 65°F | Nothing extra |
| Single thermal | 65°F to 79°F | 1 liner |
| Double thermal + ice packs | 80°F and above | 2 liners, 2 ice packs, plus 1 per transit day beyond 2, capped at 4 |
| Check by hand | Cannot be judged | Packed as double thermal until a person confirms |

Above 95°F the row also suggests holding for a cooler day or upgrading to
2-Day Air, with the specific alternative and its worst case.

### Default rules

Every number below is editable in Settings and saved on the device.

| Rule | Default |
| --- | --- |
| Origin | Wichita, KS 67202 |
| Ground transit by distance | 1 day to 150 mi, 2 to 600, 3 to 1,000, 4 to 1,400, 5 beyond |
| Alaska, Hawaii, territories, military | 5 days, flagged |
| 2-Day Air, Next Day Air | 2 days, 1 day |
| Day after delivery counted | 1 |
| Route midpoint sampled | Yes |
| Saturday delivery | No |
| Carrier holidays skipped | New Year's, Memorial Day, July 4, Labor Day, Thanksgiving, Christmas |
| Carrier pickup time | 3 PM; after it, the ship date defaults to the next carrier day |
| Product sensitivity | Cream centers 5°F stricter, white or milk chocolate 3°F stricter |
| Unit costs | Liner $1.85, ice pack $0.95 |
| Forecast confidence | High within 7 days, medium to 14, low beyond |

## Supported input

ColdChain reads the standard Shopify order export. One row per line item is
expected; rows are grouped by the order `Name`, quantities are summed, and
orders marked `fulfilled` are hidden unless asked for.

| Shopify column | Used for |
| --- | --- |
| `Name` | Order number |
| `Shipping Zip`, `Shipping Province`, `Shipping Country` | Destination and the state cross-check |
| `Shipping Method` | Speed class: Ground, 2-Day Air, Next Day Air, Store pickup |
| `Lineitem name`, `Lineitem quantity` | Product sensitivity rules and piece count |
| `Shipping Name`, `Shipping Address1`, `Shipping City` | Pack list labels and the PO Box check |
| `Fulfillment Status` | Hides orders that already shipped |

Any other CSV works if it has a column named like `zip` or `postal`; order,
quantity, shipping method, city, state and customer columns are picked up when
present. Two files ship with the repository: a 16-order set loaded by the
"Load sample orders" button, and a 50-order export in `samples/`.

## Architecture

```text
Browser (GitHub Pages, static)
  |
  |-- public/data/zips.json        41,702 zips, compiled from GeoNames, loaded once
  |
  |-- Open-Meteo API               16-day daily highs and lows, up to 50 points per request
  |     |
  |     '-- National Weather Service   7-day fallback, one point per call, when Open-Meteo fails
  |
  |-- localStorage                 settings, today's orders, overrides, packed ticks,
  |                                 forecast cache with a 6-hour refresh
  |
  '-- src/engine                   pure TypeScript, no DOM: import -> locate -> transit
                                    -> window -> decide -> materials -> pack list
```

The decision engine in `src/engine/` has no React or browser dependencies, which is
what makes it testable: the same functions run in the app, in the home-page
simulation, and under Vitest with mocked forecasts.

## Run locally

```bash
npm install
npm run dev
```

The dev server prints its address. The app is served under the `/coldchain-chocolate/`
path to match GitHub Pages.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the engine test suite once |
| `npm run typecheck` | TypeScript only |
| `npm run zips` | Rebuild `public/data/zips.json` from GeoNames (US, PR, VI, GU) |
| `node scripts/build-icons.mjs` | Regenerate the PNG app icons from the seal geometry |

## Try it

1. Open the app and press **Try it with sample orders** on the home page. It loads
   16 orders, builds the pack list, and opens the Planner.
2. Press **Why** on any row to see the exposure window, the reasons, and the
   controls to change the tier or set the box count.
3. Open **Pack list** to see the sheet grouped by what to pull, tick a few boxes,
   refresh the page, and find the ticks still there. **Print** uses the table layout.
4. Open **Settings**, lower the double-thermal threshold, and watch the impact
   strip at the top recompute today's list as you type.
5. Upload `samples/shopify-orders-50.csv` with **Upload Shopify export** for a
   fuller day: two zips with dropped leading zeros, a PO box, Alaska, Hawaii, a
   five-box corporate order, a store pickup, and two orders already shipped.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`: install, test, build, and
deploy `dist/` to GitHub Pages. The repository's Pages source must be set to
GitHub Actions once. The Vite `base` is `/coldchain-chocolate/`; change it if the
repository is renamed.

There is nothing else to deploy. Forecast requests go straight from the browser to
Open-Meteo and, if needed, the National Weather Service. Neither requires a key.

## Tests

```bash
npm test
```

85 tests cover zip normalization and the state cross-check, distance zones and
business-day math including holidays, the exposure window and worst-case
selection, tier thresholds at their boundaries, ice-pack scaling and box
multiplication, product sensitivity rules, weekend and hub warnings, store pickups,
PO boxes, military addresses, hold and expedite recommendations, the cold rule,
Shopify grouping and the fulfilled filter, generic CSV detection, CSV export
quoting, forecast batching, cache freshness, the NWS fallback, and that both
sample files import clean with every order locatable.

## Repository layout

```text
.github/workflows/    GitHub Pages deployment
public/data/          Compiled zip table
public/icons/         Generated app icons and manifest assets
public/               Favicon, web manifest, 16-order sample
samples/              50-order Shopify export for testing
scripts/              Zip table and icon generators
src/app/              Application state and persistence
src/components/       Screens and shared pieces
src/engine/           Decision engine: import, zip, transit, weather, decide, pack list, export
src/engine/__tests__/ Vitest suites and fixtures
```

## Privacy

Orders never leave the browser. The only outbound requests carry latitude and
longitude pairs to the forecast services; no names, addresses, order numbers or
products are sent. Settings, the day's orders, overrides and ticks are stored in
the browser's local storage on the device that made them, and "Clear orders"
removes the order list.

## Known limitations

Each of these is also listed inside the app with what would fix it.

- The forecast is for the center of the zip code, not the doorstep. Geocoding the
  street address was left out on purpose to avoid sending customer addresses to a
  third party.
- Hub and truck temperatures are approximated by the route midpoint and the air
  temperature. A box in a trailer in the sun runs hotter.
- Transit days come from a distance table, not a carrier's time-in-transit map.
  The table is editable.
- Forecast confidence drops after seven days and nothing exists beyond sixteen.
  The intended workflow is to run it the morning of shipping.
- The day after delivery is a flat one-day buffer.
- Product sensitivity offsets and ice-pack counts are starting values, not
  measurements. A temperature logger in a few real shipments would calibrate them.
- Boxes per order defaults to one and is set by hand for large orders.

## Data sources

- [Open-Meteo](https://open-meteo.com/) forecast API, CC BY 4.0, no key required.
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api), public domain, used as fallback.
- [GeoNames postal codes](https://www.geonames.org/) for the US, Puerto Rico, the US Virgin Islands and Guam, CC BY 4.0, compiled into `public/data/zips.json`.
- [WSU Chocolathon prompt B-2](https://www.wsuaiclub.com/hq), written with Cocoa Dolce.

## Author

Developed by [S M Asif Hossain](https://www.linkedin.com/in/smasifhossain).

## License

ColdChain is available under the [BSD 2-Clause License](LICENSE).
