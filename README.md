# ColdChain — thermal pack planner for Cocoa Dolce

Every morning the shipping team checks zip codes against the weather and decides, box by box: no thermal, single thermal, or double thermal with ice packs. One wrong call melts product. ColdChain makes that call for every order from the day's Shopify export, using the worst-case forecast across each order's whole trip — ship day in Wichita, every day in transit, delivery day, and a day on the porch — and prints the pack list the bench works from.

**Live:** https://smasifhossain.github.io/coldchain-chocolate/

Built for the WSU Chocolathon (Build Track, prompt B-2), September 2026.

## What it does

- Takes a Shopify order export, any CSV with a zip column, or a pasted list of zips
- Looks up every zip offline (41,000 US zips bundled), estimates transit days and the delivery date
- Fetches 16-day forecasts from Open-Meteo for the origin, destination and route midpoint — one request per batch, no API key
- Picks the tier from the worst-case daily high across the trip, with thresholds you can change
- Counts liners and ice packs (scaled for long transits) and the day's packaging cost
- Flags weekends in transit, PO boxes, Alaska/Hawaii, bad or mismatched zips, and suggests holding or expediting when it is simply too hot
- Shows a printable pack list grouped by tier, and a seven-day planner that answers "should this wait until Monday?"
- Says where it breaks, and what would fix it

## Run it locally

```bash
npm install
npm run dev
```

`npm test` runs the engine tests. `npm run zips` rebuilds the zip table from GeoNames.

## Data

Forecasts by [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Zip code locations from [GeoNames](https://www.geonames.org/) (CC BY 4.0). Nothing leaves the browser except the forecast request.
