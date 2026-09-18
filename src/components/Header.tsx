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

/** Kraft box with a cold-blue band — the same mark as the app icon. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="4" y="11" width="32" height="24" rx="3" fill="#c9a27a" />
      <rect x="4" y="11" width="32" height="7" rx="3" fill="#b28a63" />
      <rect x="17" y="11" width="6" height="24" fill="#7fa7c4" />
      <rect x="4" y="22" width="32" height="3.5" fill="#7fa7c4" />
      <path d="M8 8.5 L20 4 L32 8.5" fill="none" stroke="#e8dccb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Header<T extends string>({ tabs, active, onSelect }: Props<T>) {
  return (
    <header className="app-header no-print">
      <div className="mx-auto max-w-7xl px-4 md:px-6 flex flex-wrap items-center gap-x-8 gap-y-2 min-h-16 py-2">
        <button className="brand" onClick={() => onSelect(tabs[0].id)} aria-label="ColdChain home">
          <Logo />
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
