# Winning plan — Build Track B-2: Thermal Shipping Decision Engine

Deadline: **Sat Sep 19, 2026, 1:00–2:00 PM** (hard). Today: Wed Sep 17. ≈ 2.5 build days.
Requirements: see REQUIREMENTS.md. This file is the execution plan.

---

## 0. How we win (strategy)

Two preliminary judges (software people) score from the link only. Finals are decided live by
Cocoa Dolce's COO + leadership — operations people. So we win on:

| Rubric line | A 10 means | What we do |
|---|---|---|
| It runs | End to end, on your link | Static app, no login, no keys, no backend to go down. Bundled zip DB. Forecast cache fallback. Sample data preloaded. |
| They could operate it | Staff could use it Monday | Upload Shopify export → one button → printable pack list. Sane defaults. Tablet-sized touch targets. Overrides with a note. |
| It answers the prompt | Built for how they actually work | Shopify CSV (multi-line orders), exact tier vocabulary, worst-case across the *whole* transit window incl. porch day, weekend/hub rule, ship-day planner, materials + cost per day. |
| Honest about limits | Says where it breaks, and the fix | Dedicated "How it decides & limits" page; per-order confidence; stale-forecast banner; never fabricates a temperature. |

What most teams will ship: a Lovable page that takes a zip, calls a weather API, shows a table.
We beat that on **reliability, operational fit, explainability, honesty, and the stretch goal done**.

---

## 1. Architecture (free, static, GitHub Pages)

- **Stack:** Vite + React + TypeScript. Tailwind for speed. PapaParse (CSV). Vitest (tests). No router (tabs in-page) so Pages never 404s.
- **Hosting:** GitHub Pages via GitHub Actions (`actions/deploy-pages`). Public repo doubles as the "source link". URL: `https://<user>.github.io/<repo>/`. Vite `base: '/<repo>/'`.
- **Zip → location:** GeoNames US postal codes (CC BY 4.0, ~41k rows) compiled at build time into a compact JSON `{zip: [lat, lon, city, st]}` (~1 MB raw, gzipped by Pages). Fully offline. Zippopotam.us as a runtime fallback for a zip missing from the table.
- **Forecast:** Open-Meteo `/v1/forecast` — no key, CORS `*`, up to 16 days, **multiple lat/lon per request** (batch 50 unique locations per call), `temperature_unit=fahrenheit`, `timezone=auto`. Verified working 2026-09-17.
- **Persistence:** localStorage — settings, per-day overrides, forecast cache (6 h TTL). Settings export/import as JSON.
- **Zero secrets, zero cost, zero servers.** If Open-Meteo is down, cached forecasts are used with a visible "stale" banner; if none, the order is marked "forecast unavailable — manual check", never a made-up number.

---

## 2. Decision engine (pure TS module, unit-tested, no UI dependencies)

Input: `Order {id, zip, qty, serviceLevel?, shipDate}` + `Settings` + `Forecasts`. Output: `Decision`.

1. **Normalize zip** — strip ZIP+4, restore leading zeros Excel drops (`2138` → `02138`), flag non-5-digit / non-US / APO-FPO. Lookup lat/lon/city/state. Unknown → `needsReview`.
2. **Transit estimate** — haversine miles from origin (default Wichita 67202, configurable) → carrier-zone-style table (configurable):
   `≤150 mi: 1 day · ≤600: 2 · ≤1000: 3 · ≤1400: 4 · else 5`; AK/HI/PR → 5 + flag "expedite recommended".
   Service level overrides: Overnight = 1, 2-Day = 2, Ground = table. Shopify "Shipping Method" text mapped by keywords.
   Delivery date = ship date + business days (skip Sunday; Saturday delivery configurable, default off for ground). Orders after the daily cutoff time roll to the next ship day.
3. **Exposure window** — origin high on ship day; **route waypoint** highs (great-circle midpoint, a stand-in for the sort hub — optional, clearly labeled) on the middle days; destination highs from (arrival − 1) through delivery **+ porch buffer** (default 1 day, configurable).
4. **Worst case** = max high across the window; record *where* and *when* (e.g. "91°F · Phoenix · Sat").
5. **Tier** (all thresholds configurable, defaults below):
   - `< 65°F` → **No thermal**
   - `65–79°F` → **Single thermal**
   - `≥ 80°F` → **Double thermal + ice packs**
   - `≥ 95°F` or (double tier and transit ≥ 4 days) → also **recommend: upgrade to 2-Day / hold until <date>**
   - Ground transit that spans Sat+Sun with tier ≥ single → warn "sits in a hub over the weekend — ship Mon–Wed"
   - Optional cold rule (`< 20°F` → single liner to prevent bloom/cracking), default off
6. **Materials** — liners per tier (0/1/2), ice packs per tier (0/0/2) + 1 per transit day beyond 2 (cap 4), all configurable. Cost = liners × liner$ + packs × pack$.
7. **Confidence** — days 1–7 high, 8–14 medium, 15–16 low, beyond → unavailable.
8. Every decision carries `reasons[]` in plain English so the packer can trust or override it.

---

## 3. Screens

1. **Orders (home)** — input panel: paste zips (one per line, optional `zip,qty`) · upload Shopify CSV · **Load sample orders**. Ship date (default today / next ship day), default service level. **Build pack list** button. Results table: order · ship-to · service · transit days · est. delivery · worst-case (temp/where/when) · tier badge · liners · packs · cost · warnings. Sort/filter, override tier + note, export CSV.
2. **Pack List (print / tablet)** — the deliverable the bench uses. Grouped by tier, date header, totals (orders, liners, ice packs, cost), checkbox per order, `@media print` styles, big text. "Print" button.
3. **Ship-Day Planner** — 7-column grid: each order × next 7 ship days → tier per day, with "best day" highlighted. Answers "should this wait until Monday?" at a glance.
4. **Settings** — thresholds, origin zip, transit table, materials & unit costs, porch buffer, Saturday delivery, cutoff time, route-waypoint toggle. Reset to defaults. Export/import JSON.
5. **How it decides & Limits** — the algorithm in plain English, data sources + attribution, and an explicit limits table (see §7), each with "the fix".

Responsive: works at 400 px (phone) and 768–1024 px (tablet). No login. Loads < 2 s.

---

## 4. Shopify CSV handling

Columns used: `Name`, `Email`, `Financial Status`, `Fulfillment Status`, `Shipping Method`, `Shipping Name`, `Shipping Zip`, `Shipping City`, `Shipping Province`, `Shipping Country`, `Lineitem quantity`, `Lineitem name`, `Created at`.
- One row per line item → **group by `Name`**, sum quantities, keep first shipping fields.
- Default filter: unfulfilled + paid (toggle to include all).
- `Shipping Method` → service level via keywords: overnight/next day → 1 day; 2nd day/2-day/express → 2 days; else ground.
- Non-US country → flagged, not scored.
- Also accepts a plain zip list, or a generic CSV with a `zip` column.

---

## 5. Sample data (ships with the app, loads in one click)

`sample-orders.csv` ≈ 16 orders, chosen to exercise every path: Wichita local (1 day) · Kansas City · Dallas · Denver · Phoenix (hot) · Las Vegas · Houston · Miami · Atlanta · Chicago · Minneapolis · Boston `02138` (leading zero) · Seattle · Los Angeles · Anchorage (AK flag) · one PO Box · one bad zip · one already-fulfilled order · one order with 3 line items · one "UPS 2nd Day Air" order.

---

## 6. Tests (Vitest, run in CI before deploy)

Zip normalization · haversine/zone → days · business-day math (Thu ship + 3 ground days → Tue) · window construction incl. porch day · worst-case selection · tier boundaries (64.9 / 65 / 79.9 / 80 / 95) · ice-pack scaling · weekend warning · Shopify grouping/filtering · service-level keyword mapping · CSV export round-trip · cache fallback behavior.

---

## 7. Limits we state (and the fix for each)

| Limit | Fix |
|---|---|
| Forecast is for the zip centroid, not the doorstep | Geocode the full street address (paid API) |
| Hub/truck temperatures are approximated by a route midpoint | Carrier tracking scans + hub locations |
| Transit days are a distance heuristic, not a carrier quote | UPS/USPS time-in-transit API |
| Forecast confidence drops after day 7; nothing beyond 16 | Re-run the morning of shipping (the intended workflow) |
| Porch time after delivery is a fixed buffer | Delivery-confirmation webhooks |
| Open-Meteo outage → cached/stale or "manual check" | Second provider (NWS) as fallback |
| Product-specific melt points (truffles vs. bars) not modeled | Per-SKU threshold map from Shopify line items |
| Ice-pack counts are rules, not thermodynamics | Calibrate with a logger in a few real shipments |

---

## 8. Deployment (GitHub Pages, free)

1. Create **public** repo (e.g. `thermal-shipping-engine`). Push.
2. `.github/workflows/deploy.yml`: on push to `main` → checkout → setup-node 20 → `npm ci` → `npm test` → `npm run build` → `upload-pages-artifact` (`dist`) → `deploy-pages`.
3. Repo → Settings → Pages → Source: **GitHub Actions**.
4. `vite.config.ts`: `base: '/thermal-shipping-engine/'`.
5. Test the URL in a private window and on a phone. Deploy on day 1 so the pipeline is proven early.

---

## 9. Schedule

**Wed Sep 17 (today) — foundation + live URL**
- [ ] Scaffold Vite/React/TS/Tailwind, Vitest
- [ ] Build script: GeoNames → compact zip JSON
- [ ] Open-Meteo client with batching + cache
- [ ] Decision engine + core tests
- [ ] Minimal Orders screen (paste zips → table)
- [ ] GitHub repo + Actions → Pages live

**Thu Sep 18 — full feature set**
- [ ] Shopify CSV import + sample data
- [ ] Settings screen (persisted)
- [ ] Pack List print/tablet view
- [ ] Ship-Day Planner
- [ ] Overrides, cost, warnings, CSV export
- [ ] "How it decides & Limits" page
- [ ] Responsive polish, error states, stale-cache banner

**Fri Sep 19 — harden + package**
- [ ] Edge-case tests, fix everything found
- [ ] README (what/why/how, screenshots, attribution)
- [ ] Private-window + phone + tablet test of the live link
- [ ] Record ≤3-min video (script §10)
- [ ] Draft submission answers (§11)
- [ ] **Code freeze Friday evening**

**Sat Sep 19 — no code changes**
- 9:00 AM re-test the live link. 1:00 PM submit. Rehearse a 3-minute live demo for finals.

---

## 10. Video script (≤ 3:00)

- 0:00–0:20 — The problem: manual zip + temperature checks; one wrong call melts product.
- 0:20–1:30 — Demo: upload Shopify export → Build pack list → table with worst-case temps and tiers → Pack List print view on a tablet → export.
- 1:30–2:10 — Ship-Day Planner ("wait until Monday"), Settings (thresholds are theirs to change), the daily cost line.
- 2:10–2:45 — How it decides (window, worst case, thresholds) and the Limits page.
- 2:45–3:00 — Tests + deploy pipeline; "no login, no keys, works Monday."

---

## 11. Submission form answers (draft)

- **One sentence:** A no-login web tool that turns Cocoa Dolce's daily Shopify orders into a printable thermal pack list — no / single / double thermal + ice packs — using the worst-case forecast across each order's full transit window.
- **What to click first:** "Load sample orders" → "Build pack list" → then the "Pack List" tab.
- **Run notes:** Nothing to install. Try zips 85004 (Phoenix), 33101 (Miami), 98101 (Seattle), 67206 (Wichita). Settings tab to change thresholds.
- **Repo:** public GitHub link.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Open-Meteo down during judging | localStorage cache + stale banner; NWS secondary if time permits |
| Judge has no CSV | Sample orders one click away; paste zips works too |
| Zip DB too large / slow | ~1 MB raw, gzip ~300 KB, lazy-loaded; ZIP3 fallback table |
| Pages base path breaks assets | Set `base` day 1; verify on the real URL |
| Forecast beyond 16 days | Cap ship date picker at +14 days; show "unavailable" beyond horizon |
| Scope creep | Planner and route-waypoint are the first things to cut; everything in §2 steps 1–6 and screens 1, 2, 4, 5 is mandatory |
