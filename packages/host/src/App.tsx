/**
 * Bakin host shell.
 *
 * Ported from src/app/layout.tsx in TC2 of the Bun migration (#147).
 *
 * Differences from the Next.js original:
 *   - No <html>/<body> — index.html owns the document chrome.
 *   - No next/font — system font stack via globals.css for now. Phase D
 *     decides whether we load Inter / JetBrains Mono from a CDN.
 *   - No `export const metadata` — <title> lives in index.html.
 *   - No `'use client'` directives anywhere in the host bundle.
 *   - Theme overrides from bakin.config are injected into document.head
 *     from a layout effect instead of rendered server-side.
 *
 * Children is currently a placeholder — TC3 installs TanStack Router and
 * replaces it with <RouterProvider>. TC4+ wires individual pages.
 */
import { useEffect } from 'react'
import { Providers } from './providers/Providers'
import { Header } from './components/layout/header'
import { AppSidebar } from './components/layout/app-sidebar'
import { LayoutShell } from './components/layout/layout-shell'
import config from '../../../bakin.config'

const themeOverrides = config.theme && Object.keys(config.theme).length > 0
  ? Object.entries(config.theme).map(([k, v]) => `${k}: ${v}`).join('; ')
  : ''

export function App() {
  useEffect(() => {
    if (!themeOverrides) return
    const styleEl = document.createElement('style')
    styleEl.setAttribute('data-bakin-theme', '')
    styleEl.textContent = `:root { ${themeOverrides} }`
    document.head.appendChild(styleEl)
    return () => {
      styleEl.remove()
    }
  }, [])

  return (
    <Providers>
      <Header />
      <LayoutShell sidebar={<AppSidebar />}>
        <div className="p-6 text-sm text-muted-foreground">
          Shell ready. TC3 installs router, TC4+ wires pages.
        </div>
      </LayoutShell>
    </Providers>
  )
}
