import { useState, useEffect } from 'react'
import { Download, Menu, X, PanelLeftClose, PanelLeft, Bug, Search, Radio } from 'lucide-react'
import { ConnectionDot } from './connection-dot'
import { DispatchTimer } from './dispatch-timer'
import { NotificationToggle } from './notification-toggle'
import { AppSidebar } from './app-sidebar'
import { OperationsTray } from '../operations/operations-tray'
import { openGlobalSearch } from '../search/use-search-hotkey'
import { useSidebarContext } from '@/context/sidebar-context'
import { useActivityContext } from '@/context/activity-context'
import { useDebug, useMediaQuery, useOperation, useSelfUpdateVerification, startOperation, type SelfUpdateHandoff } from '@makinbakin/sdk/hooks'
import type { UpdateRecord } from '@makinbakin/sdk/types'
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
import { cn, OPERATOR_DECLARATION_HEADERS } from '@makinbakin/sdk/utils'

/** The engine's `bakin:bakin` record (#1007 D7.7): the banner shows only when a newer release is available and not skipped. */
const BAKIN_RECORD_ID = 'bakin:bakin'
const BAKIN_APPLY_ROUTE = '/api/updates/bakin%3Abakin/apply'
const BAKIN_SKIP_ROUTE = '/api/updates/bakin%3Abakin/skip'
function isSkipped(record: UpdateRecord): boolean {
  const skipped = record.skipped
  const available = record.available
  if (!skipped || !available) return false
  return (skipped.version ?? '') === (available.version ?? '') && (skipped.sha ?? '') === (available.sha ?? '') && (skipped.digest ?? '') === (available.digest ?? '')
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
function useSpendStatus(): {
  paused: boolean
  resuming: boolean
  resume: () => Promise<void>
  refresh: () => Promise<void>
} {
  const [paused, setPaused] = useState(false)
  const [resuming, setResuming] = useState(false)

  // Deliberately NOT `useJsonFetch`: 15s poll + SSE overlay + keep-prior-value
  // on transient failure — a different lifecycle than the one-shot hook. (The
  // spend ladder's 90%/cap attention is the badge provider's: persistent
  // toasts, not header rows — `plugins/spend/components/ladder-toasts.tsx`.)
  const refresh = async () => {
    try {
      const res = await fetch('/api/plugins/spend/status?lite=1')
      if (!res.ok) return
      const body = (await res.json()) as { paused?: boolean }
      setPaused(body.paused === true)
    } catch {
      // Status is a convenience poll — network blips just skip a beat.
    }
  }
  useEffect(() => {
    let cancelled = false
    const check = () => { if (!cancelled) void refresh() }
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
  return { paused, resuming, resume, refresh }
}

/** Each banner row is --bakin-banner-height (globals.css); the stack shifts the header by count × that. */
const BANNER_HEIGHT_REM = 2.25

type HeaderBarTone = 'info' | 'attention' | 'danger'
const HEADER_BAR_TONE: Record<HeaderBarTone, string> = {
  info: 'border-bakin-signal-info/30 bg-bakin-signal-info/10',
  attention: 'border-bakin-signal-attention/40 bg-bakin-signal-attention/15',
  danger: 'border-bakin-signal-danger/40 bg-bakin-signal-danger/15',
}

/**
 * One row of the fixed banner stack. Rows are flow children of the stack
 * container, so stacking order is source order — no per-row offsets.
 */
function HeaderBar({ tone, children }: { tone: HeaderBarTone; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex h-[var(--bakin-banner-height)] items-center gap-bakin-3 border-b px-bakin-4 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary',
        HEADER_BAR_TONE[tone],
      )}
    >
      {children}
    </div>
  )
}

function DispatchPausedBanner({ resuming, resume }: { resuming: boolean; resume: () => Promise<void> }) {
  return (
    <HeaderBar tone="danger">
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
    </HeaderBar>
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
  const [bakinRecord, setBakinRecord] = useState<UpdateRecord | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateOperation, setUpdateOperation] = useState<{ operationId: string; bootId: string } | null>(null)
  const [handoff, setHandoff] = useState<SelfUpdateHandoff | null>(null)
  const { collapsed, toggle } = useSidebarContext()
  const { open: activityOpen, toggle: toggleActivity } = useActivityContext()
  const showUpdateBanner = Boolean(bakinRecord && bakinRecord.outcome === 'update-available' && !isSkipped(bakinRecord))
  const { paused: dispatchPaused, resuming, resume } = useSpendStatus()
  // The update operation ends with the old process: `restarted` (or its
  // `restarting` stage) is the handoff — verification is explicit (D7.11).
  const { operation: updateView, phase: updatePhase } = useOperation(updateOperation?.operationId ?? null, {
    bootId: updateOperation?.bootId,
    onSettle: (operation, phase) => {
      if (!updateOperation) return
      if (phase === 'restarted') {
        // The old process is gone: the only honest terminal state — verify the new one.
        if (bakinRecord?.available?.version) setHandoff({ expectedVersion: bakinRecord.available.version, oldBootId: updateOperation.bootId })
        else setUpdateError('Bakin restarted, but the release it was updating to is no longer known — check its version by hand.')
        return
      }
      // Every other settle releases the active operation so Update can be tried again.
      setUpdateOperation(null)
      if (phase === 'expired' || phase === 'unreachable') {
        setUpdateError('Bakin lost track of the update — check for updates and try again.')
        return
      }
      if (operation?.status === 'failed') setUpdateError(operation.outcome?.message ?? 'Bakin update failed.')
      else if (operation?.status === 'cancelled') setUpdateError('The update was cancelled before anything changed.')
    },
  })
  const restarting = updateView?.stages.some((stage) => stage.id === 'restarting' && stage.status === 'active') ?? false
  if (restarting && !handoff && updateOperation && bakinRecord?.available?.version) {
    setHandoff({ expectedVersion: bakinRecord.available.version, oldBootId: updateOperation.bootId })
  }
  const verification = useSelfUpdateVerification(handoff)
  const updateMessage = verification.status === 'verifying'
    ? `Restarting into v${verification.handoff.expectedVersion}…`
    : verification.status !== 'idle'
      ? verification.summary
      : updateOperation && updatePhase !== 'finished'
        ? (updateView?.stages.find((stage) => stage.status === 'active')?.label ?? 'Starting the update…')
        : null

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/version', { signal: controller.signal }).then(r => r.json()).then(d => {
      if (controller.signal.aborted) return
      setVersion(d.version)
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  // The engine's records: read once, then every `updates.changed` (the
  // banner is the engine's `bakin` record, never a probe of its own, D7.7).
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/updates', { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { records?: UpdateRecord[] } | null) => {
        if (controller.signal.aborted || !d) return
        setBakinRecord(d.records?.find((record) => record.id === BAKIN_RECORD_ID) ?? null)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  usePluginEvent('updates.changed', (payload) => {
    const ids = (payload as { ids?: unknown })?.ids
    if (!Array.isArray(ids) || !ids.includes(BAKIN_RECORD_ID)) return
    fetch('/api/updates').then(r => (r.ok ? r.json() : null)).then((d: { records?: UpdateRecord[] } | null) => {
      if (d) setBakinRecord(d.records?.find((record) => record.id === BAKIN_RECORD_ID) ?? null)
    }).catch(() => {})
  })

  // Once the new boot is verified, reload into the new shell.
  useEffect(() => {
    if (verification.status !== 'verified') return
    const timer = setTimeout(() => { window.location.reload() }, 1_500)
    return () => clearTimeout(timer)
  }, [verification.status])

  useEffect(() => {
    const root = document.documentElement
    // Each active banner is h-9 (2.25rem); the header (h-14 = 3.5rem) and
    // the shell content shift down by the banner stack so a banner can never
    // be painted over. Order (top → down): update, kill switch.
    const banners = (showUpdateBanner ? 1 : 0) + (dispatchPaused ? 1 : 0)
    if (banners > 0) {
      root.style.setProperty('--bakin-header-top', `${banners * BANNER_HEIGHT_REM}rem`)
      root.style.setProperty('--bakin-shell-top', `${banners * BANNER_HEIGHT_REM + 3.5}rem`)
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
  // The breakpoint is an external store; the close lands in the same render
  // the viewport crosses it (issue 966b).
  const desktopViewport = useMediaQuery('(min-width: 768px)')
  if (mobileOpen && desktopViewport) setMobileOpen(false)

  async function applyUpdate() {
    setUpdating(true)
    setUpdateError(null)
    try {
      const started = await startOperation(() => fetch(BAKIN_APPLY_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json', ...OPERATOR_DECLARATION_HEADERS }, body: '{}' }))
      setUpdateOperation({ operationId: started.operationId, bootId: started.bootId })
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
    } finally {
      setUpdating(false)
    }
  }

  /** Dismiss = skip this release identity (D7.7); the banner returns for the next one. */
  async function skipUpdate() {
    try {
      const res = await fetch(BAKIN_SKIP_ROUTE, { method: 'POST', headers: OPERATOR_DECLARATION_HEADERS })
      const body = (await res.json().catch(() => null)) as { record?: UpdateRecord } | null
      if (res.ok && body?.record) setBakinRecord(body.record)
    } catch {
      // The next updates.changed re-reads the record; nothing to say here.
    }
  }

  return (
    <>
      {/* The banner stack: source order IS stacking order (update, kill
          switch); the header and shell shift down by the stack's height via
          --bakin-header-top. */}
      <div className="fixed inset-x-0 top-0 z-50 flex flex-col" data-slot="header-banners">
      {showUpdateBanner && (
        <HeaderBar tone="info">
          <Download className="size-3.5 shrink-0 text-bakin-signal-info" />
          <span className="min-w-0 truncate">
            New Bakin version available: {bakinRecord?.installed?.display ?? `v${version}`} to {bakinRecord?.available?.display}
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
          <Button type="button" size="xs" variant="ghost" onClick={skipUpdate} aria-label="Skip this version">
            Skip
          </Button>
        </HeaderBar>
      )}
      {dispatchPaused && <DispatchPausedBanner resuming={resuming} resume={resume} />}
      </div>

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
          <OperationsTray />
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
              Bakin will replace the installed binary with {bakinRecord?.available?.display ?? 'the new release'} and restart automatically. The page reloads once the new version answers.
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
            <Button type="button" variant="info" onClick={applyUpdate} disabled={updating || Boolean(updateOperation)}>
              {updating && <Spinner size="sm" />}
              Update Bakin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
