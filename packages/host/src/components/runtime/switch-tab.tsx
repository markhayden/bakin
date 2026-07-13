/**
 * Runtime hub — Switch: the guided flow. Preview first (a dry run is the
 * DEFAULT action — zero writes), then a confirm dialog for the real switch,
 * live progress steps over the runtime:switch SSE stream, and a result told
 * as grouped cards (carried / attention / stays behind) instead of prose.
 */
import { useCallback, useRef, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { reduceSwitchProgress, SWITCH_PHASE_LABELS, type SwitchStepRow } from '../../lib/runtime-report'
import type { CapabilityReport, SwitchResultPayload } from './types'

function StepDot({ status }: { status: SwitchStepRow['status'] }) {
  const cls = status === 'ok'
    ? 'bg-emerald-500'
    : status === 'error'
      ? 'bg-red-500'
      : status === 'skip'
        ? 'bg-zinc-400'
        : 'animate-pulse bg-sky-500'
  return <span className={`mt-1 inline-block size-2 shrink-0 rounded-full ${cls}`} />
}

function ProgressSteps({ steps }: { steps: SwitchStepRow[] }) {
  if (steps.length === 0) return null
  return (
    <Card data-testid="switch-progress">
      <CardContent className="space-y-1.5 p-4">
        {steps.map((step) => (
          <div key={step.phase} className="flex items-start gap-2 text-sm">
            <StepDot status={step.status} />
            <div className="min-w-0">
              <span>{SWITCH_PHASE_LABELS[step.phase] ?? step.phase}</span>
              {step.detail && <span className="ml-2 text-xs text-muted-foreground">{step.detail}</span>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function ResultCards({ result }: { result: SwitchResultPayload }) {
  const verb = result.dryRun ? 'Would carry' : 'Carried'
  const attention: string[] = []
  for (const u of result.roster?.unmappedModels ?? []) {
    attention.push(`${u.agentId}: ${u.field === 'subagentModel' ? 'subagent model' : 'model'} '${u.sourceModel}' has no equivalent on ${result.to} — falls back to the routing default`)
  }
  for (const p of result.roster?.preserved ?? []) {
    attention.push(`${p.agentId}: subagent model '${p.sourceModel}' preserved — restored when you switch back`)
  }
  for (const f of result.roster?.failed ?? []) attention.push(`${f.agentId}: ${f.error}`)
  for (const f of result.workspaces?.failed ?? []) attention.push(`${f.agentId} (${f.path}): ${f.error}`)
  for (const f of result.cron?.failed ?? []) attention.push(`cron ${f.jobId}: ${f.error}`)
  if (result.credentials && result.credentials.llmProviders.length === 0) {
    attention.push(`${result.to} has no model providers configured — carried agents cannot run turns until you log in on the target.`)
  }

  const workspaceFiles = (result.workspaces?.carried ?? []).reduce((sum, c) => sum + c.files, 0)
  const workspaceSkills = (result.workspaces?.skills ?? []).reduce((sum, s) => sum + s.carried, 0)

  return (
    <div className="space-y-3" data-testid="switch-result">
      {!result.ok && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600 dark:text-red-400">Switch failed</CardTitle>
            <CardDescription>
              {result.error}
              {result.restored !== undefined && (result.restored ? ' — the previous runtime was restored.' : ' — restore ALSO failed; check settings backup.')}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {result.ok && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {result.dryRun ? `Preview: ${result.from} → ${result.to}` : `Switched ${result.from} → ${result.to}`}
            </CardTitle>
            {result.restartRequired && (
              <CardDescription>Restart the Bakin server to finish — plugins hold the old runtime until then.</CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-lg font-semibold">{result.roster?.carried.length ?? 0}</p><p className="text-xs text-muted-foreground">agents {verb.toLowerCase()}</p></div>
            <div><p className="text-lg font-semibold">{result.roster?.existing.length ?? 0}</p><p className="text-xs text-muted-foreground">already on {result.to}</p></div>
            <div><p className="text-lg font-semibold">{workspaceFiles + workspaceSkills}</p><p className="text-xs text-muted-foreground">files + skills {verb.toLowerCase()}</p></div>
            <div><p className="text-lg font-semibold">{result.cron ? result.cron.adopted.length : '—'}</p><p className="text-xs text-muted-foreground">cron jobs {result.dryRun ? 'would be adopted' : 'adopted'}</p></div>
          </CardContent>
        </Card>
      )}

      {attention.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Needs your attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {attention.map((line) => <li key={line}>→ {line}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {(result.cantCarry?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Stays behind</CardTitle>
            <CardDescription>Runtime-owned things that never cross a switch.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {result.cantCarry!.map((line) => (
                <li key={line.concern}>{line.detail}{line.count !== undefined ? ` (${line.count})` : ''}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result.backupPath && !result.dryRun && (
        <p className="text-xs text-muted-foreground">Settings backup: {result.backupPath}</p>
      )}
    </div>
  )
}

export function SwitchTab({ report, onSwitched }: { report: CapabilityReport; onSwitched: () => void }) {
  const [target, setTarget] = useState<string | null>(null)
  const [adoptCron, setAdoptCron] = useState(false)
  const [copyWorkspaces, setCopyWorkspaces] = useState(true)
  const [running, setRunning] = useState<'preview' | 'switch' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [steps, setSteps] = useState<SwitchStepRow[]>([])
  const [result, setResult] = useState<SwitchResultPayload | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const others = report.adapters.filter((name) => name !== report.adapter)

  const run = useCallback(async (dryRun: boolean) => {
    if (!target) return
    setRunning(dryRun ? 'preview' : 'switch')
    setSteps([])
    setResult(null)

    // Dedicated short-lived stream: fresh SSE connections get no replay, so
    // wait (bounded) for the handshake before firing the POST or a fast
    // local switch renders only its late phases.
    const es = new EventSource('/api/events')
    esRef.current = es
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string)
        if (event?.type === 'runtime:switch') setSteps((prev) => reduceSwitchProgress(prev, event))
      } catch { /* non-JSON keepalives */ }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000)
      es.onopen = () => { clearTimeout(timer); resolve() }
    })

    try {
      const res = await fetch('/api/runtime/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          ...(dryRun ? { dryRun: true } : {}),
          ...(copyWorkspaces ? {} : { copyWorkspaces: false }),
          ...(adoptCron ? { adoptCron: true } : {}),
        }),
      })
      setResult(await res.json() as SwitchResultPayload)
      if (!dryRun) onSwitched()
    } catch (err) {
      setResult({
        ok: false,
        from: report.adapter,
        to: target,
        error: err instanceof Error ? err.message : String(err),
        backupPath: null,
        restartRequired: false,
        roster: null,
        workspaces: null,
        cron: null,
        cantCarry: null,
        credentials: null,
        sync: null,
        ...(dryRun ? { dryRun: true } : {}),
      })
    } finally {
      es.close()
      esRef.current = null
      setRunning(null)
    }
  }, [target, adoptCron, copyWorkspaces, report.adapter, onSwitched])

  if (others.length === 0) {
    return <p className="text-sm text-muted-foreground">No other runtime adapters are available to switch to.</p>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {others.map((name) => (
          <button
            key={name}
            type="button"
            data-testid={`switch-target-${name}`}
            onClick={() => { setTarget(name); setResult(null); setSteps([]) }}
            className={`rounded-xl border p-4 text-left transition-colors ${
              target === name ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              {report.adapter} <ArrowRight className="size-3.5 text-muted-foreground" /> {name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Agents, models, and workspace content carry over; Bakin data (tasks, assets, chats) is never touched.
            </p>
          </button>
        ))}
      </div>

      {target && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1 rounded" checked={copyWorkspaces} onChange={(e) => setCopyWorkspaces(e.target.checked)} />
              <span className="flex flex-col">
                <span>Carry workspace content</span>
                <span className="text-xs text-muted-foreground">Soul, memory, and agent-authored skills copy onto agents the switch creates.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1 rounded" checked={adoptCron} onChange={(e) => setAdoptCron(e.target.checked)} data-testid="switch-adopt-cron" />
              <span className="flex flex-col">
                <span>Adopt the runtime's cron jobs into Bakin schedules</span>
                <span className="text-xs text-muted-foreground">Native cron jobs stop with the old runtime — adopting keeps them running as Bakin schedules.</span>
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={running !== null} onClick={() => void run(true)} data-testid="switch-preview">
                {running === 'preview' && <Loader2 className="mr-2 size-4 animate-spin" />}
                Preview switch
              </Button>
              <Button size="sm" disabled={running !== null} onClick={() => setConfirming(true)} data-testid="switch-execute">
                {running === 'switch' && <Loader2 className="mr-2 size-4 animate-spin" />}
                Switch to {target}
              </Button>
              <span className="text-xs text-muted-foreground">Preview is a dry run — nothing is written.</span>
            </div>
          </CardContent>
        </Card>
      )}

      <ProgressSteps steps={steps} />
      {result && <ResultCards result={result} />}

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        title={`Switch to ${target}?`}
        description="The switch backs up settings first and restores them if anything fails. A server restart finishes the change."
        confirmLabel={`Switch to ${target}`}
        confirmTestId="switch-confirm"
        onConfirm={() => {
          setConfirming(false)
          void run(false)
        }}
      />
    </div>
  )
}
