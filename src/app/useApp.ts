// Application state: orders in, forecasts fetched, decisions out. Everything
// that should survive a refresh (settings, today's orders, overrides) lives in
// localStorage; nothing leaves the browser except the forecast request.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  decide,
  effectiveShipDate,
  getForecasts,
  loadSettings,
  loadZipDb,
  lookupZip,
  parseCsv,
  pointsForOrder,
  saveSettings,
  sharedForecastCache,
  todayISO,
  validateSettings,
  type DecideContext,
  type GeoPoint,
  type ImportResult,
  type Order,
  type Override,
  type PackLine,
  type Place,
  type Settings,
  type ZipDb,
} from '../engine'

export const BASE_URL = import.meta.env.BASE_URL

const SESSION_KEY = 'coldchain.session.v1'
const OVERRIDES_KEY = 'coldchain.overrides.v1'

export type Phase = 'idle' | 'loading' | 'ready' | 'error'

/** Which stage of a build is running, for the progress stepper. */
export type BuildStep = 'locating' | 'forecasting' | 'deciding' | null

export interface RunStatus {
  phase: Phase
  message: string | null
  /** Some forecasts came from an older cache because the refresh failed. */
  stale: boolean
  /** Locations with no forecast at all. */
  missing: number
  errors: string[]
  ranAt: number | null
}

interface Session {
  orders: Order[]
  shipDate: string
  sourceLabel: string
  includeFulfilled: boolean
}

const FALLBACK_ORIGIN: Place = { zip: '67202', lat: 37.69, lon: -97.34, city: 'Wichita', state: 'KS' }

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable; the app still works for this session.
  }
}

export function overrideKey(shipDate: string, orderId: string): string {
  return `${shipDate}|${orderId}`
}

export function useApp() {
  const today = todayISO()
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())
  const [session, setSession] = useState<Session>(() =>
    readJson<Session>(SESSION_KEY, { orders: [], shipDate: effectiveShipDate(today).date, sourceLabel: '', includeFulfilled: false }),
  )
  const [overrides, setOverrides] = useState<Record<string, Override>>(() => readJson(OVERRIDES_KEY, {}))
  const [zipDb, setZipDb] = useState<ZipDb | null>(null)
  const [zipError, setZipError] = useState<string | null>(null)
  const [ctx, setCtx] = useState<DecideContext | null>(null)
  const [run, setRun] = useState<RunStatus>({ phase: 'idle', message: null, stale: false, missing: 0, errors: [], ranAt: null })
  const [step, setStep] = useState<BuildStep>(null)
  const cache = useRef(sharedForecastCache())
  const runId = useRef(0)

  useEffect(() => {
    loadZipDb(BASE_URL)
      .then(setZipDb)
      .catch((e: Error) => setZipError(e.message))
  }, [])

  useEffect(() => writeJson(SESSION_KEY, session), [session])
  useEffect(() => writeJson(OVERRIDES_KEY, overrides), [overrides])

  const setSettings = useCallback((next: Settings) => {
    setSettingsState(next)
    saveSettings(next)
  }, [])

  const settingsProblems = useMemo(() => validateSettings(settings), [settings])

  const origin = useMemo<Place>(() => {
    if (!zipDb) return FALLBACK_ORIGIN
    return lookupZip(zipDb, settings.originZip) ?? FALLBACK_ORIGIN
  }, [zipDb, settings.originZip])

  const setOrders = useCallback((orders: Order[], sourceLabel: string) => {
    setSession((s) => ({ ...s, orders, sourceLabel }))
    setCtx(null)
    setRun({ phase: 'idle', message: null, stale: false, missing: 0, errors: [], ranAt: null })
  }, [])

  const setShipDate = useCallback((shipDate: string) => {
    setSession((s) => ({ ...s, shipDate }))
  }, [])

  const setIncludeFulfilled = useCallback((includeFulfilled: boolean) => {
    setSession((s) => ({ ...s, includeFulfilled }))
  }, [])

  /** Every order in the file is kept; the "already shipped" checkbox filters live. */
  const importText = useCallback(
    (text: string, label: string): ImportResult => {
      const result = parseCsv(text, { includeFulfilled: true })
      setOrders(result.orders, label)
      return result
    },
    [setOrders],
  )

  const loadSample = useCallback(async (): Promise<ImportResult> => {
    const res = await fetch(`${BASE_URL}sample-orders.csv`)
    if (!res.ok) throw new Error('Sample orders could not be loaded.')
    return importText(await res.text(), 'Sample orders')
  }, [importText])

  const clearOrders = useCallback(() => setOrders([], ''), [setOrders])

  /**
   * Fetch forecasts for every point the orders need and freeze them as the
   * decision context. `ordersOverride` lets a caller build right after an
   * import, before React state has caught up.
   */
  const build = useCallback(async (ordersOverride?: Order[]) => {
    if (!zipDb) return
    const id = ++runId.current
    const list = ordersOverride ?? session.orders
    setStep('locating')
    setRun((r) => ({ ...r, phase: 'loading', message: null, errors: [] }))
    const partial: Pick<DecideContext, 'settings' | 'origin' | 'zipDb'> = { settings, origin, zipDb }
    const points: GeoPoint[] = []
    for (const o of list) points.push(...pointsForOrder(o, partial))
    await new Promise((r) => setTimeout(r, 250))
    if (id !== runId.current) return
    setStep('forecasting')
    const fetched = await getForecasts(points, { cache: cache.current })
    if (id !== runId.current) return
    setStep('deciding')
    await new Promise((r) => setTimeout(r, 250))
    if (id !== runId.current) return
    setStep(null)
    const next: DecideContext = {
      settings,
      origin,
      zipDb,
      shipDate: session.shipDate,
      today: todayISO(),
      forecasts: fetched.forecasts,
    }
    setCtx(next)
    const message =
      fetched.missing.length > 0 && fetched.forecasts.size === 0
        ? 'The forecast service could not be reached and nothing is cached. Decisions default to the safest tier — check the weather by hand.'
        : fetched.stale.length > 0
          ? 'The forecast service could not be reached. Showing the last saved forecast — re-run when you are back online.'
          : null
    setRun({
      phase: fetched.forecasts.size === 0 && points.length > 0 ? 'error' : 'ready',
      message,
      stale: fetched.stale.length > 0,
      missing: fetched.missing.length,
      errors: fetched.errors,
      ranAt: Date.now(),
    })
  }, [zipDb, settings, origin, session.orders, session.shipDate])

  /** One click for a judge: load the sample orders and build the pack list. */
  const runDemo = useCallback(async () => {
    const result = await loadSample()
    await build(result.orders)
  }, [loadSample, build])

  // On a refresh with orders still loaded, rebuild from the forecast cache so the
  // pack list is never lost to a reload.
  const autoBuilt = useRef(false)
  useEffect(() => {
    if (autoBuilt.current || !zipDb || session.orders.length === 0 || ctx) return
    autoBuilt.current = true
    void build()
  }, [zipDb, session.orders.length, ctx, build])

  /**
   * Decisions follow the current settings and ship date immediately; only the
   * forecasts are frozen at build time (a new origin or waypoint needs a re-fetch).
   */
  const liveCtx = useMemo<DecideContext | null>(() => {
    if (!ctx) return null
    return { ...ctx, settings, origin, shipDate: session.shipDate, today: todayISO() }
  }, [ctx, settings, origin, session.shipDate])

  /** Orders on the bench today: everything in the file minus what already shipped (unless asked for). */
  const orders = useMemo<Order[]>(
    () => (session.includeFulfilled ? session.orders : session.orders.filter((o) => !o.fulfilled)),
    [session.orders, session.includeFulfilled],
  )
  const shippedCount = useMemo(() => session.orders.filter((o) => o.fulfilled).length, [session.orders])

  const lines = useMemo<PackLine[]>(() => {
    if (!liveCtx) return []
    return orders.map((order) => ({
      order,
      decision: decide(order, liveCtx),
      override: overrides[overrideKey(liveCtx.shipDate, order.id)],
    }))
  }, [liveCtx, orders, overrides])

  const setOverride = useCallback((orderId: string, override: Override | null) => {
    setOverrides((o) => {
      const key = overrideKey(session.shipDate, orderId)
      const next = { ...o }
      if (override) next[key] = override
      else delete next[key]
      return next
    })
  }, [session.shipDate])

  /** True when a settings change means the forecast set no longer covers every point. */
  const needsRefetch =
    ctx !== null && (ctx.origin.zip !== origin.zip || ctx.settings.routeWaypoint !== settings.routeWaypoint)

  return {
    today,
    settings,
    setSettings,
    settingsProblems,
    orders,
    allOrders: session.orders,
    shippedCount,
    sourceLabel: session.sourceLabel,
    includeFulfilled: session.includeFulfilled,
    setIncludeFulfilled,
    shipDate: session.shipDate,
    setShipDate,
    zipDb,
    zipError,
    origin,
    ctx: liveCtx,
    lines,
    run,
    step,
    needsRefetch,
    build,
    runDemo,
    importText,
    loadSample,
    clearOrders,
    setOverride,
  }
}

export type AppApi = ReturnType<typeof useApp>
