import { formatShort, SERVICE_LABEL, type Decision } from '../engine'

/** One uniform description of how and when a box travels, whatever the store called the option. */
export function shippingLines(d: Decision): { main: string; sub: string | null } {
  const label = SERVICE_LABEL[d.serviceLevel]
  if (d.status !== 'ok') return { main: label, sub: null }
  if (d.serviceLevel === 'pickup') return { main: label, sub: `collected ${formatShort(d.shipDate)}` }
  return { main: `${label}, ${d.transitDays} day${d.transitDays === 1 ? '' : 's'}`, sub: `arrives ${formatShort(d.deliveryDate)}` }
}

export function ShippingCell({ decision }: { decision: Decision }) {
  const { main, sub } = shippingLines(decision)
  return (
    <>
      <div>{main}</div>
      {sub && <div className="text-ink-soft text-sm">{sub}</div>}
    </>
  )
}
