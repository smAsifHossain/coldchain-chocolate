import { useEffect, useState } from 'react'
import { useApp } from './app/useApp'
import { DayStrip } from './components/DayStrip'
import { OrdersView } from './components/OrdersView'
import { PackListView } from './components/PackListView'
import { PlannerView } from './components/PlannerView'
import { SettingsView } from './components/SettingsView'
import { AboutView } from './components/AboutView'

type Tab = 'orders' | 'packlist' | 'planner' | 'settings' | 'about'

const TABS: { id: Tab; label: string }[] = [
  { id: 'orders', label: 'Orders' },
  { id: 'packlist', label: 'Pack list' },
  { id: 'planner', label: 'Which day' },
  { id: 'settings', label: 'Settings' },
  { id: 'about', label: 'How it decides' },
]

function tabFromHash(): Tab {
  const h = window.location.hash.replace('#', '') as Tab
  return TABS.some((t) => t.id === h) ? h : 'orders'
}

export default function App() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>(tabFromHash)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Tab) => {
    window.location.hash = t
    setTab(t)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-paper focus:p-2 focus:z-10">
        Skip to content
      </a>
      <header className="bg-cocoa-deep text-white no-print">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-3 flex items-center gap-4">
          <div className="display text-xl tracking-tight">ColdChain</div>
          <div className="text-white/70 text-sm hidden sm:block">Thermal pack planner for Cocoa Dolce</div>
        </div>
        <nav className="mx-auto max-w-7xl px-4 md:px-6 overflow-x-auto" aria-label="Sections">
          <div role="tablist" className="flex">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className="tab !text-white/70 aria-selected:!text-white aria-selected:!border-white whitespace-nowrap"
                onClick={() => go(t.id)}
              >
                {t.label}
                {t.id === 'packlist' && app.lines.length > 0 && <span className="ml-1 text-white/60">({app.lines.length})</span>}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 md:px-6 py-5 flex flex-col gap-5 flex-1">
        {tab !== 'about' && tab !== 'settings' && (
          <div className={tab === 'packlist' ? 'no-print' : undefined}>
            <DayStrip shipDate={app.shipDate} ctx={app.ctx} lines={app.lines} settings={app.settings} run={app.run} />
          </div>
        )}
        {tab === 'orders' && <OrdersView app={app} onGoToPackList={() => go('packlist')} />}
        {tab === 'packlist' && <PackListView app={app} />}
        {tab === 'planner' && <PlannerView app={app} />}
        {tab === 'settings' && <SettingsView app={app} />}
        {tab === 'about' && <AboutView app={app} />}
      </main>

      <footer className="no-print mx-auto w-full max-w-7xl px-4 md:px-6 py-4 text-ink-faint text-xs flex flex-wrap gap-x-4 gap-y-1">
        <span>Built for the WSU Chocolathon, September 2026.</span>
        <span>
          Forecasts by{' '}
          <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>
          , zip codes by{' '}
          <a className="underline" href="https://www.geonames.org/" target="_blank" rel="noreferrer">
            GeoNames
          </a>
          .
        </span>
      </footer>
    </div>
  )
}
