'use client'

import { useState, useEffect } from 'react'
import { Menu, X, PanelLeftClose, PanelLeft } from 'lucide-react'
import { ConnectionDot } from './connection-dot'
import { DispatchTimer } from './dispatch-timer'
import { NotificationToggle } from './notification-toggle'
import { AppSidebar } from './app-sidebar'
import { useSidebarContext } from '@/context/sidebar-context'

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [version, setVersion] = useState('')
  const { collapsed, toggle } = useSidebarContext()

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {})
  }, [])

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-border bg-background flex items-center px-4">
        <button
          className="md:hidden mr-3 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <button
          onClick={toggle}
          className="hidden md:flex text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)] mr-2"
        >
          {collapsed ? (
            <PanelLeft className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>
        <div className="flex items-center gap-2">
          <img src="/bakin-logo.svg" alt="Bakin" className="h-7 w-7" />
          <span className="text-base font-bold tracking-widest text-foreground uppercase italic">Bakin</span>
          {version && <span className="text-[10px] font-mono text-muted-foreground">v{version}</span>}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <DispatchTimer />
          <NotificationToggle />
          <ConnectionDot />
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute top-14 left-0 bottom-0 w-52 bg-background border-r border-border">
            <AppSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
