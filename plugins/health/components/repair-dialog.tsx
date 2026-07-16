'use client'

import { useEffect, useMemo, useState } from 'react'
import type { HealthRepairTarget } from '@makinbakin/sdk/types'
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@makinbakin/sdk/ui'
import { AlertTriangle, CircleCheck, RefreshCw, Wrench } from 'lucide-react'
import { useRepairPlan } from '../hooks/use-repair-plan'

const SAFETY_STYLES = {
  safe: 'border-success/30 bg-success/10 text-success',
  manual: 'border-warning/30 bg-warning/10 text-warning',
  destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
} as const

function repairErrorTitle(stale: boolean, outcomeUnknown: boolean): string {
  if (stale) return 'The evidence changed before apply.'
  if (outcomeUnknown) return 'The repair outcome needs confirmation.'
  return 'The repair request failed.'
}

export function RepairDialog({
  open,
  onOpenChange,
  target,
  title = 'Repair this issue',
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: HealthRepairTarget
  title?: string
  onApplied?: () => void
}) {
  const repair = useRepairPlan(target)
  const { planRepair } = repair
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setAnnouncement('Planning repair options.')
    void planRepair().then((plan) => {
      if (!plan) return
      setSelected(new Set(plan.items.filter((item) => item.safety === 'safe').map((item) => item.id)))
      setAnnouncement(`Repair plan ready with ${plan.items.length} option${plan.items.length === 1 ? '' : 's'}.`)
    })
  }, [open, planRepair])

  const selectedItems = useMemo(
    () => repair.plan?.items.filter((item) => selected.has(item.id)) ?? [],
    [repair.plan, selected],
  )
  const confirmedItemIds = selectedItems.filter((item) => item.safety !== 'safe').map((item) => item.id)
  const hasNonSafe = confirmedItemIds.length > 0

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const replan = async () => {
    setAnnouncement('Re-planning against the latest Health evidence.')
    const plan = await repair.planRepair()
    if (!plan) return
    setSelected(new Set(plan.items.filter((item) => item.safety === 'safe').map((item) => item.id)))
    setAnnouncement('Repair plan updated.')
  }

  const apply = async () => {
    setAnnouncement('Applying the selected repairs, then verifying affected checks.')
    const result = await repair.applyRepair([...selected], confirmedItemIds)
    if (!result) return
    const failed = result.results.filter((item) => item.status === 'failed').length
    setAnnouncement(failed > 0
      ? `${failed} repair${failed === 1 ? '' : 's'} failed. Verification completed.`
      : result.verifiedIncidentIds.length === 0
        ? 'Repairs applied and the selected issue no longer appears in fresh evidence.'
        : 'Repairs applied, but verification found that the issue still needs attention.')
    onApplied?.()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!repair.applying) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[min(88vh,52rem)] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4" aria-hidden="true" /> {title}
          </DialogTitle>
          <DialogDescription>
            Safe changes are selected for you. Manual or destructive changes remain off until you confirm each one.
          </DialogDescription>
        </DialogHeader>

        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

        {repair.planning && (
          <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Planning against the current evidence…
          </div>
        )}

        {repair.error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">{repairErrorTitle(repair.stale, repair.outcomeUnknown)}</p>
            <p className="mt-1 text-muted-foreground">{repair.error}</p>
            {repair.stale && <Button className="mt-3" size="sm" variant="outline" onClick={() => void replan()}>Re-plan from fresh evidence</Button>}
          </div>
        )}

        {!repair.planning && repair.plan && !repair.result && !repair.stale && (
          <div className="max-h-[min(52vh,28rem)] space-y-3 overflow-y-auto pr-1">
            {repair.plan.items.length === 0 && (
              <p className="rounded-lg border border-border/70 p-4 text-sm text-muted-foreground">
                No deterministic repair is available for this issue. Follow its resolution steps instead.
              </p>
            )}
            {repair.plan.items.map((item) => {
              const nonSafe = item.safety !== 'safe'
              return (
                <div key={item.id} className="flex items-start gap-3 rounded-xl border border-border/80 p-4 focus-within:ring-2 focus-within:ring-ring">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(item.id)}
                    onCheckedChange={() => toggle(item.id)}
                    aria-label={`${nonSafe ? 'Select and confirm' : 'Select'} repair: ${item.title}`}
                  />
                  <span className="min-w-0 space-y-2 text-sm">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {item.title}
                      <Badge variant="outline" className={SAFETY_STYLES[item.safety]}>{item.safety}</Badge>
                    </span>
                    <span className="block text-muted-foreground">{item.reason}</span>
                    {item.changes.length > 0 && (
                      <span className="block rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                        {item.changes.map((change) => `${change.action} ${change.target}: ${change.description}`).join(' · ')}
                      </span>
                    )}
                    {nonSafe && (
                      <span className="flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        Selecting this item is its individual confirmation. Review the described change first.
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {repair.result && (
          <div className="max-h-[min(52vh,28rem)] space-y-3 overflow-y-auto" data-testid="repair-result">
            {repair.result.results.map((item) => (
              <div key={item.itemId} className="flex items-start gap-2 rounded-lg border border-border/70 p-3 text-sm">
                {item.status === 'applied'
                  ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />}
                <div><p className="font-medium capitalize">{item.status}</p><p className="text-muted-foreground">{item.message}</p></div>
              </div>
            ))}
            <div className={repair.result.verifiedIncidentIds.length === 0
              ? 'rounded-lg border border-success/30 bg-success/5 p-3 text-sm'
              : 'rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm'}>
              <p className="font-medium">Verification</p>
              <p className="mt-1 text-muted-foreground">
                {repair.result.verifiedIncidentIds.length === 0
                  ? 'Fresh checks no longer show the selected issue.'
                  : `The repair ran, but ${repair.result.verifiedIncidentIds.length} related incident${repair.result.verifiedIncidentIds.length === 1 ? '' : 's'} remain.`}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {!repair.result ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={repair.applying}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void apply()}
                disabled={repair.planning || repair.applying || selected.size === 0 || repair.stale}
                variant={hasNonSafe ? 'destructive' : 'default'}
              >
                {repair.applying ? 'Applying and verifying…' : `Apply ${selected.size} repair${selected.size === 1 ? '' : 's'}`}
              </Button>
            </>
          ) : <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
