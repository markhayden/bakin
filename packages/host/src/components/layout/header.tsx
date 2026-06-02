import { useState, useEffect } from 'react'
import { Download, Loader2, Menu, X, PanelLeftClose, PanelLeft, Bug } from 'lucide-react'
import { ConnectionDot } from './connection-dot'
import { DispatchTimer } from './dispatch-timer'
import { NotificationToggle } from './notification-toggle'
import { AppSidebar } from './app-sidebar'
import { useSidebarContext } from '@/context/sidebar-context'
import { useDebug } from '@makinbakin/sdk/hooks'
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
  const displayUpdateStatus = updateStatus
  const showUpdateBanner = Boolean(updateStatus?.supported && updateStatus.updateAvailable)

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
    if (showUpdateBanner) {
      root.style.setProperty('--bakin-header-top', '2.25rem')
      root.style.setProperty('--bakin-shell-top', '5.75rem')
      return () => {
        root.style.removeProperty('--bakin-header-top')
        root.style.removeProperty('--bakin-shell-top')
      }
    }
    root.style.removeProperty('--bakin-header-top')
    root.style.removeProperty('--bakin-shell-top')
  }, [showUpdateBanner])

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
          <DebugToggle />
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
          <div className="absolute top-[var(--bakin-shell-top,3.5rem)] left-0 bottom-0 w-52 bg-background border-r border-border">
            <AppSidebar onNavigate={() => setMobileOpen(false)} />
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
