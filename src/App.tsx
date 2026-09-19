import { useEffect, useState } from 'react'
import { useApp } from './app/useApp'
import { DayStrip } from './components/DayStrip'
import { Landing } from './components/Landing'
import { OrdersView } from './components/OrdersView'
import { PackListView } from './components/PackListView'
import { PlannerView } from './components/PlannerView'
import { SettingsView } from './components/SettingsView'
import { AboutView } from './components/AboutView'
import { Header } from './components/Header'

type Tab = 'home' | 'orders' | 'packlist' | 'planner' | 'settings' | 'about'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'orders', label: 'Planner' },
  { id: 'packlist', label: 'Pack list' },
  { id: 'planner', label: 'Which day' },
  { id: 'settings', label: 'Settings' },
]

/** Reachable from the footer and the home page, not the main navigation. */
const QUIET_TABS: Tab[] = ['about']

function tabFromHash(): Tab {
  const h = window.location.hash.replace('#', '') as Tab
  return TABS.some((t) => t.id === h) || QUIET_TABS.includes(h) ? h : 'home'
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
    window.scrollTo({ top: 0 })
  }

  const demo = async () => {
    go('orders')
    await app.runDemo()
  }

  const wide = tab === 'home'

  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-paper focus:p-2 focus:z-10">
        Skip to content
      </a>
      <Header
        tabs={TABS.map((t) => (t.id === 'packlist' ? { ...t, badge: app.lines.length } : t))}
        active={tab}
        onSelect={go}
      />

      <main id="main" tabIndex={-1} className={wide ? 'flex-1' : 'mx-auto w-full max-w-7xl px-4 md:px-6 py-5 flex flex-col gap-5 flex-1'}>
        {tab === 'home' && <Landing app={app} onOpenPlanner={() => go('orders')} onDemo={demo} onAbout={() => go('about')} />}
        {(tab === 'orders' || tab === 'packlist' || tab === 'planner') && (
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
        <button className={`underline ${tab === 'about' ? 'text-ink' : ''}`} onClick={() => go('about')}>
          How it decides, and where it breaks
        </button>
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
