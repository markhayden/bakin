import { useEffect } from 'react'
import { Outlet } from '@tanstack/react-router'
import { useHostStore, useFullscreen, usePathname } from '@makinbakin/sdk/hooks'
import { Header } from './header'
import { AppSidebar } from './app-sidebar'
import { LayoutShell } from './layout-shell'

/**
 * The shell's chrome (header, sidebar, activity rail) and the page, or the
 * page alone while a plugin holds full screen (useFullscreen). Full screen
 * ends when the page changes or the browser leaves its own full screen.
 */
export function FullscreenShell() {
  const { active, exit } = useFullscreen()
  const holder = useHostStore((state) => state.fullscreen)
  const pathname = usePathname()
  useEffect(() => { if (holder !== null && holder !== pathname) exit() }, [holder, pathname, exit])
  useEffect(() => {
    // Esc held, F11, the system: the browser left full screen, so the shell does too.
    const changed = () => { if (!document.fullscreenElement && useHostStore.getState().fullscreen !== null) exit() }
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [exit])
  return (
    <>
      {!active && <Header />}
      <LayoutShell sidebar={<AppSidebar />} fullscreen={active}>
        <Outlet />
      </LayoutShell>
    </>
  )
}
