// Calendar-date helpers. Dates are plain YYYY-MM-DD strings so they never
// shift across time zones between the browser and the forecast service.

export type ISODate = string

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now)
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(s: ISODate): number {
  return parseISODate(s).getDay()
}

export function isWeekend(s: ISODate): boolean {
  const d = dayOfWeek(s)
  return d === 0 || d === 6
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** Every date from `from` to `to` inclusive. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Thu Sep 18" */
export function formatShort(s: ISODate): string {
  const d = parseISODate(s)
  return `${WEEKDAY[d.getDay()]} ${MONTH[d.getMonth()]} ${d.getDate()}`
}

/** "Thursday, September 18, 2026" */
export function formatLong(s: ISODate): string {
  return parseISODate(s).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function weekdayName(s: ISODate): string {
  return WEEKDAY[dayOfWeek(s)]
}

/** nth weekday of a month: nth=1 first, nth=-1 last. dow 0=Sun. */
function nthWeekday(year: number, month: number, dow: number, nth: number): ISODate {
  if (nth > 0) {
    const first = new Date(year, month, 1)
    const offset = (dow - first.getDay() + 7) % 7
    return toISODate(new Date(year, month, 1 + offset + (nth - 1) * 7))
  }
  const last = new Date(year, month + 1, 0)
  const offset = (last.getDay() - dow + 7) % 7
  return toISODate(new Date(year, month, last.getDate() - offset))
}

/** A fixed-date holiday observed on the nearest weekday when it falls on a weekend. */
function observed(year: number, month: number, day: number): ISODate {
  const d = new Date(year, month, day)
  if (d.getDay() === 6) d.setDate(d.getDate() - 1)
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return toISODate(d)
}

/**
 * Days UPS and FedEx do not pick up or deliver ground: New Year's Day, Memorial
 * Day, Independence Day, Labor Day, Thanksgiving, Christmas (observed dates).
 */
export function carrierHolidays(year: number): Set<ISODate> {
  return new Set([
    observed(year, 0, 1),
    nthWeekday(year, 4, 1, -1),
    observed(year, 6, 4),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4),
    observed(year, 11, 25),
  ])
}

const holidayCache = new Map<number, Set<ISODate>>()

export function isCarrierHoliday(s: ISODate): boolean {
  const year = Number(s.slice(0, 4))
  let set = holidayCache.get(year)
  if (!set) {
    set = carrierHolidays(year)
    holidayCache.set(year, set)
  }
  return set.has(s)
}
