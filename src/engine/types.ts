// Core domain types for the thermal shipping decision engine.

/** The three packaging tiers the shipping team chooses between. */
export type Tier = 'none' | 'single' | 'double'

export type ServiceLevel = 'ground' | 'two_day' | 'overnight'

/** One shippable order. Only `zip` is required; the rest enriches the pack list. */
export interface Order {
  id: string
  zip: string
  qty: number
  customer?: string
  address?: string
  city?: string
  state?: string
  country?: string
  shippingMethod?: string
  serviceLevel?: ServiceLevel
  lineItems?: string[]
  fulfilled?: boolean
}

export interface ZoneRule {
  /** Great-circle miles from origin, inclusive upper bound. */
  maxMiles: number
  days: number
}

export interface Settings {
  originZip: string
  /** Worst-case daily high (°F) at or above which each tier applies. */
  thresholds: {
    single: number
    double: number
    /** At or above this, recommend holding the order or upgrading service. */
    hold: number
  }
  coldRule: {
    enabled: boolean
    /** Worst-case daily low (°F) below which a liner is added for cold protection. */
    below: number
  }
  transit: {
    /** Ground transit-day estimate by distance from origin, checked in order. */
    zones: ZoneRule[]
    /** Days for destinations beyond the last zone, and for AK / HI. */
    farDays: number
    twoDayDays: number
    overnightDays: number
  }
  /** Carrier delivers on Saturday (ground usually does not). */
  saturdayDelivery: boolean
  /** Days the package may sit at the destination after delivery. */
  porchDays: number
  /** Sample the forecast at the route midpoint as a stand-in for the sort hub. */
  routeWaypoint: boolean
  /** A double-tier order with transit this long or longer gets an expedite recommendation. */
  longHotTransitDays: number
  materials: {
    linersByTier: Record<Tier, number>
    icePacksByTier: Record<Tier, number>
    /** Extra ice packs per transit day beyond `extraDayThreshold` (double tier only). */
    icePackPerExtraDay: number
    extraDayThreshold: number
    icePackMax: number
  }
  costs: {
    liner: number
    icePack: number
  }
}

export interface DailyForecast {
  /** Local calendar date at the location, YYYY-MM-DD. */
  date: string
  high: number
  low: number
}

export interface LocationForecast {
  lat: number
  lon: number
  days: DailyForecast[]
  fetchedAt: number
  /** True when served from cache after a failed refresh. */
  stale: boolean
}

export type ExposureRole = 'origin' | 'route' | 'transit' | 'destination' | 'porch'

/** One place-and-day the package is exposed to weather. */
export interface ExposurePoint {
  date: string
  place: string
  role: ExposureRole
  high: number | null
  low: number | null
}

export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface Recommendation {
  action: 'hold' | 'expedite'
  detail: string
  holdUntil?: string
}

export interface Decision {
  orderId: string
  zip: string
  place: string
  status: 'ok' | 'needs_review' | 'no_forecast'
  serviceLevel: ServiceLevel
  distanceMiles: number | null
  transitDays: number
  shipDate: string
  deliveryDate: string
  window: ExposurePoint[]
  worst: ExposurePoint | null
  coldest: ExposurePoint | null
  tier: Tier
  liners: number
  icePacks: number
  cost: number
  recommendation: Recommendation | null
  warnings: string[]
  reasons: string[]
  confidence: Confidence
}
