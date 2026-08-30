import { useState, useEffect } from 'react'
import { Download, Menu, X, PanelLeftClose, PanelLeft, Bug, Search, Radio } from 'lucide-react'
import { ConnectionDot } from './connection-dot'
import { DispatchTimer } from './dispatch-timer'
import { NotificationToggle } from './notification-toggle'
import { AppSidebar } from './app-sidebar'
import { openGlobalSearch } from '../search/use-search-hotkey'
import { useSidebarContext } from '@/context/sidebar-context'
import { useActivityContext } from '@/context/activity-context'
import { useDebug } from '@makinbakin/sdk/hooks'
import {
  Alert,
  AlertDescription,
  Button,
  CommandShortcut,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
} from '@makinbakin/sdk/ui'
import { usePluginEvent, emitPluginEvent } from '@/hooks/use-plugin-event'
import { cn } from '@makinbakin/sdk/utils'

interface BakinUpdateStatus {
  supported: boolean
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  updateAvailable: boolean
  checkedAt: string
  reason?: string
  error?: string
}

/**
 * Kill-switch state (cost-control v2): polled on the shared 15s cadence
 * (lite status endpoint); UI-driven toggles (Spend tab / this banner) fan
 * out a client-side 'budget.paused_changed' event for instant reflection —
 * CLI/settings-file toggles land within the poll. Lifted into Header so the
 * paused banner participates in the same --bakin-header-top offset
 * mechanism as the update banner — the banner must PUSH the header down,
 * never be painted over by it.
 */
function useDispatchPaused(): { paused: boolean; resuming: boolean; resume: () => Promise<void> } {
  const [paused, setPaused] = useState(false)
  const [resuming, setResuming] = useState(false)

  // Deliberately NOT `useJsonFetch`: 15s poll + SSE overlay + keep-prior-value
  // on transient failure — a different lifecycle than the one-shot hook.
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/plugins/models/budget/status?lite=1')
        if (!res.ok) return
        const body = (await res.json()) as { paused?: boolean }
        if (!cancelled) setPaused(body.paused === true)
      } catch {
        // Status is a convenience poll — network blips just skip a beat.
      }
    }
    check()
    const timer = setInterval(check, 15_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  usePluginEvent('budget.paused_changed', (payload) => {
    if (typeof payload.paused === 'boolean') setPaused(payload.paused)
  })

  const resume = async () => {
    setResuming(true)
    try {
      await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatch: { paused: false } }),
      })
      setPaused(false)
      emitPluginEvent({ event: 'budget.paused_changed', paused: false })
    } finally {
      setResuming(false)
    }
  }
  return { paused, resuming, resume }
}

function DispatchPausedBanner({ offset, resuming, resume }: { offset: boolean; resuming: boolean; resume: () => Promise<void> }) {
  return (
    <div
      role="status"
      className={cn('fixed left-0 right-0 z-50 flex h-9 items-center gap-bakin-3 border-b border-bakin-signal-danger/40 bg-bakin-signal-danger/15 px-bakin-4 text-xs text-bakin-text-primary', offset ? 'top-9' : 'top-0')}
    >
      <span className="font-bakin-typography-weight-medium text-bakin-signal-danger">Dispatch paused</span>
      <span className="min-w-0 truncate text-bakin-text-muted">Kill switch is on — no task dispatch or billed media until resumed.</span>
      <Button
        type="button"
        size="xs"
        variant="danger"
        className="ml-auto"
        onClick={resume}
        disabled={resuming}
      >
        {resuming ? 'Resuming…' : 'Resume'}
      </Button>
    </div>
  )
}

function DebugToggle() {
  const [debug, toggleDebug] = useDebug()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleDebug}
      aria-pressed={debug}
      aria-label="Debug mode"
      className={debug ? 'text-bakin-text-primary' : 'text-bakin-text-muted hover:text-bakin-text-primary'}
    >
      <Bug className="size-bakin-4" />
    </Button>
  )
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<BakinUpdateStatus | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const { collapsed, toggle } = useSidebarContext()
  const { open: activityOpen, toggle: toggleActivity } = useActivityContext()
  const displayUpdateStatus = updateStatus
  const showUpdateBanner = Boolean(updateStatus?.supported && updateStatus.updateAvailable)
  const { paused: dispatchPaused, resuming, resume } = useDispatchPaused()

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/update/status')
      .then(r => r.json())
      .then(d => {
        if (d && typeof d === 'object') setUpdateStatus(d as BakinUpdateStatus)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const root = document.documentElement
    // Each active banner is h-9 (2.25rem); the header (h-14 = 3.5rem) and
    // the shell content shift down by the banner stack so a banner can never
    // be painted over.
    const banners = (showUpdateBanner ? 1 : 0) + (dispatchPaused ? 1 : 0)
    if (banners > 0) {
      root.style.setProperty('--bakin-header-top', `${banners * 2.25}rem`)
      root.style.setProperty('--bakin-shell-top', `${banners * 2.25 + 3.5}rem`)
      return () => {
        root.style.removeProperty('--bakin-header-top')
        root.style.removeProperty('--bakin-shell-top')
      }
    }
    root.style.removeProperty('--bakin-header-top')
    root.style.removeProperty('--bakin-shell-top')
  }, [showUpdateBanner, dispatchPaused])

  // The drawer is `md:hidden`, but a Sheet that is open while hidden would
  // still hold its focus trap and scroll lock — close it when the viewport
  // grows past the mobile breakpoint instead of leaving it invisibly modal.
  useEffect(() => {
    if (!mobileOpen || typeof window.matchMedia !== 'function') return
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false)
    }
    closeOnDesktop()
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [mobileOpen])

  async function applyUpdate() {
    setUpdating(true)
    setUpdateError(null)
    setUpdateMessage(null)
    try {
      const res = await fetch('/api/update/apply', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Bakin update failed.')
      }
      const message = typeof body?.message === 'string' ? body.message : 'Bakin update completed. Restarting Bakin now...'
      setUpdateMessage(message)
      if (body?.restart?.ok === false) return
      setTimeout(() => {
        let sawRestartGap = false
        const poll = setInterval(async () => {
          try {
            const versionRes = await fetch('/api/version', { cache: 'no-store' })
            if (!versionRes.ok) {
              sawRestartGap = true
              return
            }
            if (!sawRestartGap) return
            clearInterval(poll)
            window.location.reload()
          } catch {
            sawRestartGap = true
          }
        }, 1000)
      }, 2000)
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
      {dispatchPaused && <DispatchPausedBanner offset={Boolean(showUpdateBanner)} resuming={resuming} resume={resume} />}
      {showUpdateBanner && (
        <div
          role="status"
          className="fixed top-0 left-0 right-0 z-50 flex h-9 items-center gap-bakin-3 border-b border-bakin-signal-info/30 bg-bakin-signal-info/10 px-bakin-4 text-xs text-bakin-text-primary"
        >
          <Download className="size-3.5 shrink-0 text-bakin-signal-info" />
          <span className="min-w-0 truncate">
            New Bakin version available: v{displayUpdateStatus?.currentVersion} to v{displayUpdateStatus?.latestVersion ?? displayUpdateStatus?.latestTag}
          </span>
          <Button
            type="button"
            size="xs"
            variant="info"
            className="ml-auto"
            onClick={() => setUpdateDialogOpen(true)}
          >
            Update Bakin
          </Button>
        </div>
      )}

      <header className="fixed top-(--bakin-header-top) left-0 right-0 z-50 h-14 border-b border-bakin-border-subtle/30 bg-bakin-canvas-default flex items-center px-bakin-4">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden mr-bakin-3 text-bakin-text-muted hover:text-bakin-text-primary"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation-drawer"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          className="hidden md:inline-flex text-bakin-text-muted hover:text-bakin-text-primary mr-bakin-2"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? (
            <PanelLeft className="size-bakin-4" />
          ) : (
            <PanelLeftClose className="size-bakin-4" />
          )}
        </Button>
        <div className="flex items-center gap-bakin-2">
          <img src="/bakin-logo.svg" alt="Bakin" className="h-7 w-7" />
          <span className="text-base font-bakin-typography-weight-bold tracking-widest text-bakin-text-primary uppercase italic">Bakin</span>
          {version && <span className="hidden text-bakin-typography-size-meta font-mono text-bakin-text-muted md:inline">v{version}</span>}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-bakin-2 sm:gap-3 md:gap-4">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => openGlobalSearch()}
            aria-label="Search everything"
            className="gap-bakin-2 border-bakin-border-subtle/60 text-xs font-bakin-typography-weight-regular text-bakin-text-muted hover:text-bakin-text-primary sm:h-auto sm:w-auto sm:min-w-0 sm:px-2.5 sm:py-1"
            data-testid="global-search-button"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <CommandShortcut className="ml-0 hidden pl-0 sm:inline">⌘K</CommandShortcut>
          </Button>
          <div className="hidden md:block"><DispatchTimer /></div>
          <div className="hidden md:block"><DebugToggle /></div>
          <div className="hidden sm:block"><NotificationToggle /></div>
          <ConnectionDot />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={toggleActivity}
            aria-label={activityOpen ? 'Close Live Activity' : 'Open Live Activity'}
            aria-pressed={activityOpen}
            data-testid="mobile-live-activity-button"
            className="border-bakin-border-subtle/60 text-bakin-text-muted hover:text-bakin-text-primary md:hidden"
          >
            <Radio aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </header>

      {/* Mobile navigation drawer — the kit Sheet owns the scrim, Escape,
          focus trap, and scroll lock. The visually hidden title names the
          dialog; the SheetHeader keeps the close button clear of the nav. */}
      <Sheet open={mobileOpen} onOpenChange={(next) => setMobileOpen(next)}>
        <SheetContent
          id="mobile-navigation-drawer"
          side="left"
          closeLabel="Close navigation"
          className="md:hidden data-[side=left]:w-52 data-[side=left]:sm:w-52 data-[side=left]:sm:max-w-none"
          overlayProps={{ className: 'md:hidden' }}
        >
          <SheetHeader>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1">
            <AppSidebar forceExpanded onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Bakin</DialogTitle>
            <DialogDescription>
              Bakin will replace the installed binary with v{displayUpdateStatus?.latestVersion ?? displayUpdateStatus?.latestTag} and restart automatically.
            </DialogDescription>
          </DialogHeader>
          {updateError && (
            <Alert tone="danger">
              <AlertDescription>{updateError}</AlertDescription>
            </Alert>
          )}
          {updateMessage && (
            <Alert tone="success">
              <AlertDescription>{updateMessage}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUpdateDialogOpen(false)}>
              Close
            </Button>
            <Button type="button" variant="info" onClick={applyUpdate} disabled={updating || Boolean(updateMessage)}>
              {updating && <Spinner size="sm" />}
              Update Bakin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
