'use client'

/**
 * Generic doctor repair flow (layered-context spec, C10) — the first repair
 * affordance in the Health UI. Works for ANY check whose handler offers
 * repairs, not just agent-sync:
 *
 *   plan (GET /doctor/repair/plan) → per-item review with safety labels →
 *   explicit selection (safe items pre-checked; manual/destructive items
 *   require individually ticking their confirmation box) →
 *   apply (POST /doctor/repair/apply { accepted, itemIds, allowDestructive })
 *   → results + verification.
 *
 * Destructive consent is structural: the apply engine refuses non-safe items
 * unless the caller passed explicit itemIds + allowDestructive, which this
 * dialog only sends for items the user ticked one-by-one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@makinbakin/sdk/ui'
import { AlertTriangle, CircleCheck, Wrench } from 'lucide-react'

interface RepairChange {
  kind: string
  target: string
  action: string
  description: string
}

interface RepairPlanItem {
  id: string
  checkId: string
  healthCheckId: string
  checkName: string
  title: string
  reason: string
  safety: 'safe' | 'manual' | 'destructive'
  requiresConfirmation: boolean
  changes: RepairChange[]
}

interface RepairPlanReport {
  items: RepairPlanItem[]
  errors: Array<{ healthCheckId: string; message: string }>
  summary: { totalItems: number; safeItems: number }
}

interface RepairApplyResult {
  id: string
  checkId: string
  status: 'applied' | 'skipped' | 'failed'
  message: string
}

interface RepairApplyReport {
  status: 'confirmation_required' | 'applied'
  applied: RepairApplyResult[]
  skipped: RepairApplyResult[]
  errors: Array<{ healthCheckId: string; message: string }>
  verification: Array<{ check: string; status: string; message: string }>
}

const SAFETY_STYLES: Record<RepairPlanItem['safety'], string> = {
  safe: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  manual: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  destructive: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

export function RepairDialog({ open, onOpenChange, onApplied }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied?: () => void
}) {
  const [plan, setPlan] = useState<RepairPlanReport | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<RepairApplyReport | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  const loadPlan = useCallback(async () => {
    setPlanning(true)
    setPlanError(null)
    setResult(null)
    try {
      const res = await fetch('/api/plugins/health/doctor/repair/plan')
      if (!res.ok) throw new Error(`plan failed (${res.status})`)
      const report = await res.json() as RepairPlanReport
      setPlan(report)
      // Safe items are pre-selected; anything requiring confirmation starts
      // unticked — consent is per item, never implied.
      setSelected(new Set(report.items.filter((i) => i.safety === 'safe' && !i.requiresConfirmation).map((i) => i.id)))
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanning(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadPlan()
  }, [open, loadPlan])

  const destructiveSelected = useMemo(
    () => plan?.items.some((i) => selected.has(i.id) && i.safety !== 'safe') ?? false,
    [plan, selected],
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async () => {
    if (!plan || selected.size === 0) return
    setApplying(true)
    setApplyError(null)
    try {
      const res = await fetch('/api/plugins/health/doctor/repair/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accepted: true,
          itemIds: [...selected],
          allowDestructive: destructiveSelected,
        }),
      })
      const report = await res.json() as RepairApplyReport
      if (!res.ok && (report as unknown as { error?: string }).error) {
        throw new Error((report as unknown as { error: string }).error)
      }
      setResult(report)
      onApplied?.()
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4" /> Repair
          </DialogTitle>
          <DialogDescription>
            Review the planned repairs. Safe items are pre-selected; anything
            marked manual or destructive needs its own checkbox ticked.
          </DialogDescription>
        </DialogHeader>

        {planning && <p className="text-sm text-muted-foreground">Planning repairs…</p>}
        {planError && <p className="text-sm text-red-400">{planError}</p>}

        {!planning && plan && !result && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {plan.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing repairable right now — remaining findings need manual attention.
              </p>
            )}
            {plan.items.map((item) => (
              <label
                key={item.id}
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer ${item.safety === 'destructive' ? 'border-red-300 dark:border-red-900' : 'border-border'}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  aria-label={`Select repair: ${item.title}`}
                />
                <span className="space-y-1 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {item.title}
                    <Badge className={`${SAFETY_STYLES[item.safety]} text-[10px] px-1.5`}>{item.safety}</Badge>
                  </span>
                  <span className="block text-muted-foreground">{item.reason}</span>
                  {item.changes.map((change, i) => (
                    <span key={i} className="block text-xs text-muted-foreground">
                      → {change.action} {change.target}: {change.description}
                    </span>
                  ))}
                  {item.safety === 'destructive' && (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      <AlertTriangle className="size-3" /> Overwrites content — tick to confirm explicitly.
                    </span>
                  )}
                </span>
              </label>
            ))}
            {plan.errors.length > 0 && (
              <p className="text-xs text-yellow-500">
                {plan.errors.length} check(s) failed to plan: {plan.errors.map((e) => e.healthCheckId).join(', ')}
              </p>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-2 max-h-96 overflow-y-auto text-sm">
            {[...result.applied, ...result.skipped].map((r) => (
              <div key={r.id} className="flex items-start gap-2">
                {r.status === 'applied'
                  ? <CircleCheck className="size-4 shrink-0 text-green-500 mt-0.5" />
                  : <AlertTriangle className="size-4 shrink-0 text-yellow-500 mt-0.5" />}
                <span><span className="font-medium">{r.id}</span> — {r.status}: {r.message}</span>
              </div>
            ))}
            {result.errors.map((e, i) => (
              <p key={i} className="text-red-400 text-xs">{e.healthCheckId}: {e.message}</p>
            ))}
            {result.verification.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Verification: {result.verification.filter((v) => v.status === 'ok' || v.status === 'fixed').length}/{result.verification.length} checks clean after repair.
              </p>
            )}
          </div>
        )}
        {applyError && <p className="text-sm text-red-400">{applyError}</p>}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={apply}
                disabled={applying || selected.size === 0}
                variant={destructiveSelected ? 'destructive' : 'default'}
              >
                {applying ? 'Applying…' : destructiveSelected ? `Apply ${selected.size} (incl. destructive)` : `Apply ${selected.size} repair${selected.size === 1 ? '' : 's'}`}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
