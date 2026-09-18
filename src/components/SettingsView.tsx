import { useId, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, downloadText, mergeSettings, summarize, type ProductRule, type Settings, type Tier } from '../engine'
import type { AppApi } from '../app/useApp'

/** Every number the shipping team might want to change, without touching code. */
export function SettingsView({ app }: { app: AppApi }) {
  const s = app.settings
  const set = (patch: (draft: Settings) => void) => {
    const next = structuredClone(s)
    patch(next)
    app.setSettings(next)
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const [ioNote, setIoNote] = useState<string | null>(null)

  const importFile = async (file: File) => {
    try {
      app.setSettings(mergeSettings(JSON.parse(await file.text())))
      setIoNote('Settings loaded.')
    } catch {
      setIoNote('That file is not a settings export.')
    }
  }

  const originPlace = app.zipDb ? app.origin : null

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Impact app={app} />
      <Card title="Temperature thresholds" hint="Worst-case daily high across the whole trip, in °F.">
        <NumberField label="Single thermal from" value={s.thresholds.single} onChange={(v) => set((d) => void (d.thresholds.single = v))} suffix="°F" />
        <NumberField label="Double thermal + ice from" value={s.thresholds.double} onChange={(v) => set((d) => void (d.thresholds.double = v))} suffix="°F" />
        <NumberField label="Recommend hold or expedite from" value={s.thresholds.hold} onChange={(v) => set((d) => void (d.thresholds.hold = v))} suffix="°F" />
        <Toggle
          label="Add a liner in deep cold"
          checked={s.coldRule.enabled}
          onChange={(v) => set((d) => void (d.coldRule.enabled = v))}
          hint="Frozen chocolate can bloom or crack. Off by default."
        />
        {s.coldRule.enabled && (
          <NumberField label="Cold protection below" value={s.coldRule.below} onChange={(v) => set((d) => void (d.coldRule.below = v))} suffix="°F" />
        )}
      </Card>

      <Card title="Where the box is exposed" hint="What counts toward the worst case.">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold" htmlFor="origin">
            Ships from (zip)
          </label>
          <input id="origin" className="field !w-40" value={s.originZip} maxLength={5} inputMode="numeric" onChange={(e) => set((d) => void (d.originZip = e.target.value.replace(/\D/g, '')))} />
          <div className="text-ink-soft text-sm">
            {originPlace ? `${originPlace.city}, ${originPlace.state}` : 'Looking up…'}
            {app.zipDb && originPlace && originPlace.zip !== s.originZip ? ' — zip not found, using Wichita' : ''}
          </div>
        </div>
        <NumberField label="Days on the porch after delivery" value={s.porchDays} min={0} max={3} onChange={(v) => set((d) => void (d.porchDays = v))} />
        <Toggle
          label="Sample the route midpoint"
          checked={s.routeWaypoint}
          onChange={(v) => set((d) => void (d.routeWaypoint = v))}
          hint="A rough stand-in for the carrier hub between here and there."
        />
        <Toggle label="Carrier delivers on Saturday" checked={s.saturdayDelivery} onChange={(v) => set((d) => void (d.saturdayDelivery = v))} />
        <Toggle
          label="Skip carrier holidays"
          checked={s.observeHolidays}
          onChange={(v) => set((d) => void (d.observeHolidays = v))}
          hint="New Year's, Memorial Day, July 4, Labor Day, Thanksgiving, Christmas: no pickup or delivery."
        />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-semibold" htmlFor="cutoff">
            Carrier pickup time
          </label>
          <input id="cutoff" type="time" className="field !w-40" value={s.pickupCutoff} onChange={(e) => e.target.value && set((d) => void (d.pickupCutoff = e.target.value))} />
          <div className="text-ink-soft text-sm">After this, the planner assumes boxes ship the next carrier day.</div>
        </div>
      </Card>

      <Card title="Product sensitivity" hint="Some products soften sooner than a solid tempered bar. A matching line item lowers every threshold for that box. Starting values — tune them to what you see on the bench.">
        {s.productRules.map((r, i) => (
          <RuleRow
            key={i}
            rule={r}
            onChange={(next) => set((d) => void (d.productRules[i] = next))}
            onRemove={() => set((d) => void d.productRules.splice(i, 1))}
          />
        ))}
        <button className="btn btn-quiet self-start" onClick={() => set((d) => void d.productRules.push({ label: 'New rule', pattern: '', offset: -3 }))}>
          Add a product rule
        </button>
      </Card>

      <Card title="Transit time" hint="Ground estimates by distance from origin. A carrier quote will always beat this.">
        {s.transit.zones.map((z, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <NumberField label={i === 0 ? 'Up to (miles)' : undefined} value={z.maxMiles} onChange={(v) => set((d) => void (d.transit.zones[i].maxMiles = v))} compact />
            <span className="text-ink-soft pt-5">→</span>
            <NumberField label={i === 0 ? 'Ground days' : undefined} value={z.days} min={1} max={10} onChange={(v) => set((d) => void (d.transit.zones[i].days = v))} compact />
          </div>
        ))}
        <NumberField label="Beyond that, and Alaska / Hawaii" value={s.transit.farDays} min={1} max={10} onChange={(v) => set((d) => void (d.transit.farDays = v))} suffix="days" />
        <NumberField label="2-Day service" value={s.transit.twoDayDays} min={1} max={5} onChange={(v) => set((d) => void (d.transit.twoDayDays = v))} suffix="days" />
        <NumberField label="Overnight service" value={s.transit.overnightDays} min={1} max={3} onChange={(v) => set((d) => void (d.transit.overnightDays = v))} suffix="days" />
        <NumberField
          label="Suggest expediting a double-thermal box in transit for"
          value={s.longHotTransitDays}
          min={2}
          max={10}
          onChange={(v) => set((d) => void (d.longHotTransitDays = v))}
          suffix="days or more"
        />
      </Card>

      <Card title="Materials and cost" hint="What each tier pulls from the shelf, and what it costs.">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 items-center text-sm">
          <div />
          <div className="font-semibold text-center">Liners</div>
          <div className="font-semibold text-center">Ice packs</div>
          {(['none', 'single', 'double'] as Tier[]).map((t) => (
            <TierRow key={t} tier={t} s={s} set={set} />
          ))}
        </div>
        <NumberField label="Extra ice pack per transit day beyond" value={s.materials.extraDayThreshold} min={1} max={6} onChange={(v) => set((d) => void (d.materials.extraDayThreshold = v))} suffix="days" />
        <NumberField label="Ice packs per extra day" value={s.materials.icePackPerExtraDay} min={0} max={3} onChange={(v) => set((d) => void (d.materials.icePackPerExtraDay = v))} />
        <NumberField label="Never more than" value={s.materials.icePackMax} min={1} max={10} onChange={(v) => set((d) => void (d.materials.icePackMax = v))} suffix="ice packs" />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Cost per liner" value={s.costs.liner} step={0.05} onChange={(v) => set((d) => void (d.costs.liner = v))} prefix="$" />
          <NumberField label="Cost per ice pack" value={s.costs.icePack} step={0.05} onChange={(v) => set((d) => void (d.costs.icePack = v))} prefix="$" />
        </div>
      </Card>

      <div className="lg:col-span-2 sheet p-5 flex flex-wrap items-center gap-3">
        {app.settingsProblems.length > 0 ? (
          <ul className="text-hot text-sm flex-1" role="alert">
            {app.settingsProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : (
          <span className="text-ink-soft text-sm flex-1">Changes apply immediately and are saved on this device.</span>
        )}
        <input ref={fileRef} type="file" accept="application/json" className="sr-only" aria-label="Import settings" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <button className="btn btn-quiet" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className="btn btn-quiet" onClick={() => downloadText('coldchain-settings.json', JSON.stringify(s, null, 2), 'application/json')}>
          Export
        </button>
        <button className="btn btn-quiet" onClick={() => app.setSettings(structuredClone(DEFAULT_SETTINGS))}>
          Reset to defaults
        </button>
        {ioNote && (
          <span className="text-sm" role="status">
            {ioNote}
          </span>
        )}
      </div>
    </div>
  )
}

/** What today's list would look like under the settings as they are right now. */
function Impact({ app }: { app: AppApi }) {
  if (app.lines.length === 0) {
    return (
      <div className="lg:col-span-2 sheet p-5 text-ink-soft text-sm">
        Every change below applies immediately. Build a pack list on the Planner tab to see the effect on today's orders here as you edit.
      </div>
    )
  }
  const s = summarize(app.lines, app.settings)
  return (
    <div className="lg:col-span-2 sheet p-5 flex flex-wrap items-center gap-x-8 gap-y-3" aria-live="polite">
      <div className="text-sm text-ink-soft">With these settings, today's {s.orders} orders need</div>
      <div className="flex gap-6">
        <Stat n={s.byTier.none} label="no thermal" cls="text-cold" />
        <Stat n={s.byTier.single} label="single" cls="text-foil" />
        <Stat n={s.byTier.double} label="double + ice" cls="text-hot" />
      </div>
      <div className="ml-auto text-right">
        <div className="display text-xl">
          {s.liners} liner{s.liners === 1 ? '' : 's'}, {s.icePacks} ice pack{s.icePacks === 1 ? '' : 's'}
        </div>
        <div className="text-sm text-ink-soft">about ${s.cost.toFixed(2)} in packaging</div>
      </div>
    </div>
  )
}

function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div>
      <div className={`display text-2xl ${cls}`}>{n}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  )
}

function RuleRow({ rule, onChange, onRemove }: { rule: ProductRule; onChange: (r: ProductRule) => void; onRemove: () => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-soft">Label</label>
        <input className="field" value={rule.label} onChange={(e) => onChange({ ...rule, label: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-soft">Matches line items containing</label>
        <input className="field font-mono text-sm" value={rule.pattern} placeholder="truffle|caramel" onChange={(e) => onChange({ ...rule, pattern: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-ink-soft">Lower by</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            className="field !w-20"
            min={0}
            max={20}
            value={Math.abs(rule.offset)}
            onChange={(e) => onChange({ ...rule, offset: -Math.abs(Number(e.target.value) || 0) })}
          />
          <span className="text-ink-soft text-sm">°F</span>
        </div>
      </div>
      <button className="btn btn-quiet" onClick={onRemove} aria-label={`Remove rule ${rule.label}`}>
        Remove
      </button>
    </div>
  )
}

function TierRow({ tier, s, set }: { tier: Tier; s: Settings; set: (patch: (d: Settings) => void) => void }) {
  const label = tier === 'none' ? 'No thermal' : tier === 'single' ? 'Single thermal' : 'Double thermal'
  return (
    <>
      <div>{label}</div>
      <input type="number" className="field !w-20 text-center" min={0} max={4} value={s.materials.linersByTier[tier]} onChange={(e) => set((d) => void (d.materials.linersByTier[tier] = Number(e.target.value)))} aria-label={`${label} liners`} />
      <input type="number" className="field !w-20 text-center" min={0} max={6} value={s.materials.icePacksByTier[tier]} onChange={(e) => set((d) => void (d.materials.icePacksByTier[tier] = Number(e.target.value)))} aria-label={`${label} ice packs`} />
    </>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="sheet p-5 flex flex-col gap-4" aria-label={title}>
      <div>
        <h2 className="display text-lg">{title}</h2>
        {hint && <p className="text-ink-soft text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  compact,
}: {
  label?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  prefix?: string
  suffix?: string
  compact?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-semibold" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        {prefix && <span className="text-ink-soft">{prefix}</span>}
        <input
          id={id}
          type="number"
          className={`field ${compact ? '' : '!w-28'}`}
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={(e) => {
            const v = e.target.value === '' ? NaN : Number(e.target.value)
            if (Number.isFinite(v)) onChange(v)
          }}
        />
        {suffix && <span className="text-ink-soft text-sm">{suffix}</span>}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" className="mt-1 w-5 h-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-semibold text-sm block">{label}</span>
        {hint && <span className="text-ink-soft text-sm">{hint}</span>}
      </span>
    </label>
  )
}
