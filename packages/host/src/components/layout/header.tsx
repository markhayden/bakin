import { useState, useEffect } from 'react'
import { Download, Loader2, Menu, X, PanelLeftClose, PanelLeft, Bug, Search, Radio } from 'lucide-react'
import { ConnectionDot } from './connection-dot'
import { DispatchTimer } from './dispatch-timer'
import { NotificationToggle } from './notification-toggle'
import { AppSidebar } from './app-sidebar'
import { openGlobalSearch } from '../search/use-search-hotkey'
import { useSidebarContext } from '@/context/sidebar-context'
import { useActivityContext } from '@/context/activity-context'
import { useDebug } from '@makinbakin/sdk/hooks'
import { usePluginEvent, emitPluginEvent } from '@/hooks/use-plugin-event'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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
      className={`fixed left-0 right-0 z-50 flex h-9 items-center gap-3 border-b border-red-500/40 bg-red-500/15 px-4 text-xs text-foreground ${offset ? 'top-9' : 'top-0'}`}
    >
      <span className="font-medium text-red-500">Dispatch paused</span>
      <span className="min-w-0 truncate text-muted-foreground">Kill switch is on — no task dispatch or billed media until resumed.</span>
      <button
        onClick={resume}
        disabled={resuming}
        className="ml-auto rounded border border-red-500/40 px-2 py-0.5 text-xs hover:bg-red-500/20 disabled:opacity-50"
      >
        {resuming ? 'Resuming…' : 'Resume'}
      </button>
    </div>
  )
}

function DebugToggle() {
  const [debug, toggleDebug] = useDebug()
  return (
    <button
      onClick={toggleDebug}
      title="Debug mode"
      className={`transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)] ${debug ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      <Bug className="size-4" />
    </button>
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
          className="fixed top-0 left-0 right-0 z-50 flex h-9 items-center gap-3 border-b border-info/30 bg-info/10 px-4 text-xs text-foreground"
        >
          <Download className="size-3.5 shrink-0 text-info" />
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

      <header className="fixed top-[var(--bakin-header-top,0px)] left-0 right-0 z-50 h-14 border-b border-border bg-background flex items-center px-4">
        <button
          className="md:hidden mr-3 text-muted-foreground hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation-drawer"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <button
          onClick={toggle}
          className="hidden md:flex text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)] mr-2"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
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
          {version && <span className="hidden text-[10px] font-mono text-muted-foreground md:inline">v{version}</span>}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3 md:gap-4">
          <button
            type="button"
            onClick={() => openGlobalSearch()}
            aria-label="Search everything"
            className="flex h-bakin-8 w-bakin-8 shrink-0 items-center justify-center gap-2 rounded-md border border-border/60 p-0 text-xs text-muted-foreground transition-colors hover:text-foreground sm:h-auto sm:w-auto sm:px-2.5 sm:py-1"
            title="Search everything (⌘K)"
            data-testid="global-search-button"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-border/60 px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
          </button>
          <div className="hidden md:block"><DispatchTimer /></div>
          <div className="hidden md:block"><DebugToggle /></div>
          <div className="hidden sm:block"><NotificationToggle /></div>
          <ConnectionDot />
          <button
            type="button"
            onClick={toggleActivity}
            aria-label={activityOpen ? 'Close Live Activity' : 'Open Live Activity'}
            aria-pressed={activityOpen}
            title="Live Activity"
            data-testid="mobile-live-activity-button"
            className="flex h-bakin-8 w-bakin-8 shrink-0 items-center justify-center rounded-md border border-border/60 p-0 text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            <Radio aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <div
            id="mobile-navigation-drawer"
            className="absolute bottom-0 left-0 top-[var(--bakin-shell-top,3.5rem)] w-52 overflow-hidden border-r border-border bg-background"
          >
            <AppSidebar forceExpanded onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Bakin</DialogTitle>
            <DialogDescription>
              Bakin will replace the installed binary with v{displayUpdateStatus?.latestVersion ?? displayUpdateStatus?.latestTag} and restart automatically.
            </DialogDescription>
          </DialogHeader>
          {updateError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {updateError}
            </div>
          )}
          {updateMessage && (
            <div className="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
              {updateMessage}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUpdateDialogOpen(false)}>
              Close
            </Button>
            <Button type="button" variant="info" onClick={applyUpdate} disabled={updating || Boolean(updateMessage)}>
              {updating && <Loader2 className="size-3.5 animate-spin" />}
              Update Bakin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
