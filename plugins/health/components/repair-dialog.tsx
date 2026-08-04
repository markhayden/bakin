'use client'

import { useEffect, useMemo, useState } from 'react'
import type { HealthRepairTarget } from '@makinbakin/sdk/types'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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

const SAFETY_TONE = {
  safe: 'success',
  manual: 'attention',
  destructive: 'danger',
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
          <DialogTitle className="flex items-center gap-bakin-2">
            <Wrench className="size-bakin-4" aria-hidden="true" /> {title}
          </DialogTitle>
          <DialogDescription>
            Safe changes are selected for you. Manual or destructive changes remain off until you confirm each one.
          </DialogDescription>
        </DialogHeader>

        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

        {repair.planning && (
          <div role="status" className="flex items-center gap-bakin-2 py-bakin-6 text-bakin-typography-size-body text-bakin-text-muted">
            <RefreshCw className="size-bakin-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Planning against the current evidence…
          </div>
        )}

        {repair.error && (
          <Alert tone="danger">
            <AlertTitle>{repairErrorTitle(repair.stale, repair.outcomeUnknown)}</AlertTitle>
            <AlertDescription>
              {repair.error}
              {repair.stale && (
                <Button className="mt-bakin-3 block" size="sm" variant="outline" onClick={() => void replan()}>
                  Re-plan from fresh evidence
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {!repair.planning && repair.plan && !repair.result && !repair.stale && (
          <div className="max-h-[min(52vh,28rem)] space-y-3 overflow-y-auto pr-1">
            {repair.plan.items.length === 0 && (
              <p className="rounded-bakin-control border border-bakin-border-subtle p-bakin-4 text-bakin-typography-size-body text-bakin-text-muted">
                No deterministic repair is available for this issue. Follow its resolution steps instead.
              </p>
            )}
            {repair.plan.items.map((item) => {
              const nonSafe = item.safety !== 'safe'
              return (
                <div key={item.id} className="flex items-start gap-bakin-3 rounded-bakin-surface border border-bakin-border-subtle p-bakin-4 focus-within:ring-2 focus-within:ring-bakin-focus-ring">
                  <Checkbox
                    className="mt-bakin-1"
                    checked={selected.has(item.id)}
                    onCheckedChange={() => toggle(item.id)}
                    aria-label={`${nonSafe ? 'Select and confirm' : 'Select'} repair: ${item.title}`}
                  />
                  <span className="min-w-0 space-y-bakin-2 text-bakin-typography-size-body">
                    <span className="flex flex-wrap items-center gap-bakin-2 font-bakin-typography-weight-medium text-bakin-text-primary">
                      {item.title}
                      <StatusBadge variant="outline" tone={SAFETY_TONE[item.safety]}>{item.safety}</StatusBadge>
                    </span>
                    <span className="block text-bakin-text-muted">{item.reason}</span>
                    {item.changes.length > 0 && (
                      <span className="block rounded-bakin-control bg-bakin-canvas-default p-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
                        {item.changes.map((change) => `${change.action} ${change.target}: ${change.description}`).join(' · ')}
                      </span>
                    )}
                    {nonSafe && (
                      <span className="flex items-start gap-bakin-1 text-bakin-typography-size-meta text-bakin-signal-highlight">
                        <AlertTriangle className="mt-bakin-0 size-bakin-3 shrink-0" aria-hidden="true" />
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
              <div key={item.itemId} className="flex items-start gap-bakin-2 rounded-bakin-control border border-bakin-border-subtle p-bakin-3 text-bakin-typography-size-body">
                {item.status === 'applied'
                  ? <CircleCheck className="mt-bakin-0 size-bakin-4 shrink-0 text-bakin-action-primary-background" aria-hidden="true" />
                  : <AlertTriangle className="mt-bakin-0 size-bakin-4 shrink-0 text-bakin-signal-highlight" aria-hidden="true" />}
                <div><p className="font-bakin-typography-weight-medium capitalize">{item.status}</p><p className="text-bakin-text-muted">{item.message}</p></div>
              </div>
            ))}
            <div className={repair.result.verifiedIncidentIds.length === 0
              ? 'rounded-bakin-control border border-bakin-action-primary-background/30 bg-bakin-action-primary-background/5 p-bakin-3 text-bakin-typography-size-body'
              : 'rounded-bakin-control border border-bakin-signal-highlight/30 bg-bakin-signal-highlight/5 p-bakin-3 text-bakin-typography-size-body'}>
              <p className="font-bakin-typography-weight-medium">Verification</p>
              <p className="mt-bakin-1 text-bakin-text-muted">
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
