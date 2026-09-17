# Chocolathon — B-2: Thermal Shipping Decision Engine

Source: https://www.wsuaiclub.com/hq (read 2026-09-15). Event: WSU AI Club × Cocoa Dolce × Lovable.
Client: Cocoa Dolce, Wichita KS artisan chocolate maker. Track: **Build** ($700 scholarship + chocolates).

## The prompt (verbatim intent)

**Problem.** Each day the shipping team manually checks zip codes and temperatures to decide:
*no thermal*, *single thermal*, or *double thermal with ice packs*. It works, but one wrong call = melted product.

**Challenge.** Automate the decision. Take destination zip codes, pull origin/destination forecasts
for the transit window, apply thermal thresholds, output a daily pack list per order.

**Winning entry includes (treat as the checklist):**
1. Working tool that takes a **batch of zip codes OR a Shopify order export** and returns thermal decisions
2. **Configurable temperature thresholds**
3. **Clear daily summary view** the packing team can **print or view on a tablet**
4. **Multi-day transit handling** — worst-case temperature across the whole window, not just ship day
5. **Shipping timeline guidance** — how long shipping should take (and, implicitly, when to ship)

**Stretch.** Estimate daily ice-pack and thermal-liner cost.

## How it is scored (Build Track, each line 1–10, two independent judges, no weights)

| Line | 1 | 5 | 10 |
|---|---|---|---|
| It runs | Nothing to click | Main path runs, parts stubbed | End to end, on your link |
| They could operate it | Needs you next to it | Works with a walkthrough | Staff could use it Monday |
| It answers the prompt | Generic w/ chocolate label | Solves the task, with gaps | Built for how they actually work |
| Honest about limits | Claims more than it does | Some limits named | Says where it breaks, and the fix |

Tiebreak order: line 1 total → line 2 total → median judge total.
Top 3 per track advance; finals are NOT scored — Cocoa Dolce leadership (Ben Hesse, COO) picks the winner live.

**Four gates (fail one = not scored):**
- Link opens with **no login, no install** (test in a private window)
- Video **≤ 3 minutes** (unlisted OK, private not)
- One submission, one person, one track
- Work started **after prompts unlocked (Mon Sep 14)** — libraries/templates/public tools are fine

## Key dates

- Prompts live: Mon Sep 14, 2026
- **Submissions: Sat Sep 19, 1:00–2:00 PM (hard cutoff)** via Microsoft Form on the HQ page
- Finale: Sat Sep 19, Woolsey Hall WSU, 8:30 AM–5 PM. Must attend in person to submit/present.
- Finals presentations 3:45–4:30 PM, winners 4:45 PM
- Lovable Pro code (100 credits) emailed to registrants; optional; redeem before Sep 19 5 PM

## What the submission form asks for (have ready before 1 PM Sat)

- Team name exactly as registered; submitter name + WSU email
- Track + prompt (Build / B-2)
- One sentence: what you built
- Product link (public, no login)
- Video link (≤3 min)
- "What a judge should click first"
- Repo/source link (optional)
- Anything needed to run it: **sample zip codes / sample Shopify CSV** — provide these in-app too

## Rules that matter

- WSU students only, teams 1–5, locked at registration
- Any stack, AI optional
- **Do not contact Cocoa Dolce staff or suppliers** — treat prompt detail as ground truth
- Judges score from links only; must prove itself without you present

## Derived requirements / design implications

**Inputs**
- Paste/upload a list of zip codes, AND upload a Shopify orders CSV export
  (Shopify columns: `Name`, `Email`, `Shipping Zip`, `Shipping City`, `Shipping Province`,
  `Shipping Method`, `Lineitem name`, `Lineitem quantity`, `Fulfillment Status`, `Created at`, …)
- Origin zip (default Wichita, KS — configurable)
- Ship date (default today; allow picking tomorrow / next ship day)

**Weather**
- Zip → lat/lon (offline centroid table or zippopotam.us), then forecast from a free API
  (Open-Meteo: no key, daily max temps 7–16 days; or NWS api.weather.gov for US)
- Need daily **highs** for origin on ship day + destination across every day of the transit window
- Decision uses **max temp across the window** (origin ship day ∪ destination days ∪ ideally transit)

**Transit window**
- Estimate transit days from origin→destination (zone/distance heuristic from zip prefix, or carrier
  zone table). Ground from Wichita is typically 1–5 business days.
- Guidance: recommended ship days (e.g. Mon–Wed so it doesn't sit in a hub over the weekend),
  expected delivery date, and "upgrade to 2-day/overnight" when window is too hot/long.

**Thresholds (configurable, sane defaults)**
- Chocolate softens ~80°F+, melts ~85–90°F. Common chocolatier practice:
  - `< ~65°F` → No thermal
  - `65–80°F` → Single thermal (liner)
  - `> 80°F` → Double thermal + ice packs (and possibly expedite / hold)
- Also consider a "too hot to ship ground — hold or expedite" ceiling

**Outputs**
- Per-order row: order #, destination, transit days, worst-case temp (+ which day/where), decision,
  ice-pack count, notes
- **Daily pack list / summary**: counts per tier, total liners + ice packs needed, flagged risky orders,
  print-friendly and readable on a tablet
- Stretch: cost = liners × unit cost + ice packs × unit cost (unit costs configurable)
- Export CSV / print

**Honest limits to document in-app (rubric line 4)**
- Forecast is by zip centroid, not the doorstep; forecast horizon limits; carrier delays/holds;
  package sitting on porch/truck in sun; hub temps not modeled; API outage → fallback/demo mode;
  transit-day estimates are heuristics not carrier quotes; residential vs. PO Box, etc.
- For each: what the fix would be (carrier API, tracking, actual address geocoding…)

**Operability (rubric line 2)**
- Zero-config first run: sample CSV + sample zips pre-loaded, one click to "Run today's pack list"
- Clear defaults, settings page for thresholds/costs/origin, no accounts
- Fallback when weather API fails (cached last forecast or clearly labeled demo data), never a blank screen
