import { Logo } from './Logo'

export interface NavItem<T extends string> {
  id: T
  label: string
  badge?: number
}

interface Props<T extends string> {
  tabs: NavItem<T>[]
  active: T
  onSelect: (id: T) => void
}

export function Header<T extends string>({ tabs, active, onSelect }: Props<T>) {
  return (
    <header className="app-header no-print">
      <div className="mx-auto max-w-7xl px-4 md:px-6 flex flex-wrap items-center gap-x-8 gap-y-2 min-h-16 py-2">
        <button className="brand" onClick={() => onSelect(tabs[0].id)} aria-label="ColdChain home">
          <Logo size={40} />
          <span className="brand-text">
            <span className="brand-name">ColdChain</span>
            <span className="brand-tag">Thermal pack planner for Cocoa Dolce</span>
          </span>
        </button>
        <nav className="app-nav" aria-label="Sections">
          <div role="tablist" className="flex items-center gap-1">
            {tabs.map((t) => (
              <button key={t.id} role="tab" aria-selected={active === t.id} className="nav-pill" onClick={() => onSelect(t.id)}>
                {t.label}
                {t.badge !== undefined && t.badge > 0 && <span className="nav-badge">{t.badge}</span>}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  )
}
