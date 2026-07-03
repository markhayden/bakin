/**
 * Root route. Renders the shell (providers + header + sidebar + activity
 * panel) and delegates the inner content area to <Outlet /> so nested
 * routes can render their pages.
 *
 * The route tree is code-based (not file-based via TanStack's Vite plugin)
 * because Bakin builds through Bun.build() rather than Vite. Bun has no
 * equivalent plugin today; explicit route modules keep the stack portable
 * and make every registration grep-able.
 */
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Providers } from '../providers/Providers'
import { Header } from '../components/layout/header'
import { AppSidebar } from '../components/layout/app-sidebar'
import { LayoutShell } from '../components/layout/layout-shell'
import { PluginHost } from '../plugin-host/PluginHost'
import { GlobalSearchOverlay } from '../components/search/global-search-overlay'
import config from '../../../../bakin.config'

const themeOverrides = config.theme && Object.keys(config.theme).length > 0
  ? Object.entries(config.theme).map(([k, v]) => `${k}: ${v}`).join('; ')
  : ''

function RootComponent() {
  useEffect(() => {
    if (!themeOverrides) return
    const styleEl = document.createElement('style')
    styleEl.setAttribute('data-bakin-theme', '')
    styleEl.textContent = `:root { ${themeOverrides} }`
    document.head.appendChild(styleEl)
    return () => { styleEl.remove() }
  }, [])

  return (
    <Providers>
      <PluginHost>
        {/* Inside PluginHost: the hit-renderer registry must be live. */}
        <GlobalSearchOverlay />
        <Header />
        <LayoutShell sidebar={<AppSidebar />}>
          <Outlet />
        </LayoutShell>
      </PluginHost>
    </Providers>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
