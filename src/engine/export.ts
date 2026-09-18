import { formatShort } from './dates'
import { SERVICE_LABEL } from './transit'
import { TIER_LABEL } from './decide'
import { boxesFor, effectiveTier, lineMaterials, tierOverridden, type PackLine } from './packlist'
import type { Settings } from './types'

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The pack list as a spreadsheet the team can keep. */
export function toCsv(lines: PackLine[], settings: Settings): string {
  const header = [
    'Order',
    'Customer',
    'Destination',
    'Zip',
    'Pieces',
    'Boxes',
    'Shipping method',
    'Speed',
    'Ship date',
    'Transit days',
    'Delivery',
    'Worst case F',
    'Worst case where',
    'Worst case when',
    'Tier',
    'Overridden',
    'Override note',
    'Liners',
    'Ice packs',
    'Cost',
    'Confidence',
    'Recommendation',
    'Warnings',
  ]
  const rows = lines.map((l) => {
    const d = l.decision
    const tier = effectiveTier(l)
    const m = lineMaterials(l, settings)
    return [
      d.orderId,
      l.order.customer ?? '',
      d.place,
      d.zip,
      l.order.qty,
      boxesFor(l),
      l.order.shippingMethod ?? '',
      SERVICE_LABEL[d.serviceLevel],
      d.shipDate,
      d.transitDays,
      d.deliveryDate,
      d.worst ? Math.round(d.worst.high!) : '',
      d.worst?.place ?? '',
      d.worst ? formatShort(d.worst.date) : '',
      TIER_LABEL[tier],
      tierOverridden(l) ? 'yes' : '',
      l.override?.note ?? '',
      m.liners,
      m.icePacks,
      m.cost.toFixed(2),
      d.confidence,
      d.recommendation?.detail ?? '',
      d.warnings.join(' | '),
    ]
      .map(csvCell)
      .join(',')
  })
  return [header.join(','), ...rows].join('\r\n')
}

export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
