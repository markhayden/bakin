/**
 * Runtime hub — Runtimes: the runtime roster (capability-card anatomy:
 * icon tile + title row + badge + description) with the guided switch flow.
 * Clicking a runtime opens the ConfirmDialog, which owns the WHOLE flow —
 * options, consequences, preview trigger, typed confirm; nothing actionable
 * lives inline on the page (repair-button precedent). Preview is a dry run
 * (zero writes) whose grouped result cards render on the page as read-only
 * output, with live progress steps (Timeline) over the runtime:switch SSE
 * stream.
 */
import { useCallback, useRef, useState } from 'react'
import { Cpu, Loader2 } from 'lucide-react'
import {
  ConfirmDialog,
  StatGroup,
  StatTile,
  StatusBadge,
  Timeline,
  TimelineEntry,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
} from '@makinbakin/sdk/ui'
import { reduceSwitchProgress, SWITCH_PHASE_LABELS, type SwitchStepRow } from '../../lib/runtime-report'
import { ExtensionsSection } from './extensions-section'
import type { CapabilityReport, SwitchResultPayload } from './types'

const STEP_TONE: Record<SwitchStepRow['status'], StatusTone> = {
  ok: 'success',
  error: 'danger',
  skip: 'neutral',
  running: 'accent',
}

const STEP_MARKER_LABEL: Record<SwitchStepRow['status'], string> = {
  ok: 'complete',
  error: 'failed',
  skip: 'skipped',
  running: 'running',
}

function ProgressSteps({ steps }: { steps: SwitchStepRow[] }) {
  if (steps.length === 0) return null
  return (
    <Card data-testid="switch-progress">
      <CardContent className="p-4">
        <Timeline aria-label="Switch progress">
          {steps.map((step) => (
            <TimelineEntry
              key={step.phase}
              tone={STEP_TONE[step.status]}
              markerLabel={STEP_MARKER_LABEL[step.status]}
              title={SWITCH_PHASE_LABELS[step.phase] ?? step.phase}
              meta={step.detail ? <span className="text-xs text-bakin-text-muted">{step.detail}</span> : undefined}
            />
          ))}
        </Timeline>
      </CardContent>
    </Card>
  )
}

function ResultCards({ result, onProceed, busy = false }: { result: SwitchResultPayload; onProceed?: () => void; busy?: boolean }) {
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
        <Card className="border-bakin-signal-danger/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-bakin-signal-danger">Switch failed</CardTitle>
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
          <CardContent className="space-y-4">
            <StatGroup label="Switch summary">
              <StatTile label={`agents ${verb.toLowerCase()}`} value={result.roster?.carried.length ?? 0} />
              <StatTile label={`already on ${result.to}`} value={result.roster?.existing.length ?? 0} />
              <StatTile label={`files + skills ${verb.toLowerCase()}`} value={workspaceFiles + workspaceSkills} />
              <StatTile label={`cron jobs ${result.dryRun ? 'would be adopted' : 'adopted'}`} value={result.cron ? result.cron.adopted.length : '—'} />
            </StatGroup>
            {result.dryRun && onProceed && (
              <div className="flex items-center gap-2 border-t border-bakin-border-subtle/60 pt-3">
                <Button size="sm" onClick={onProceed} disabled={busy} data-testid="switch-execute">
                  Switch to {RUNTIME_LABELS[result.to] ?? result.to}…
                </Button>
                <span className="text-xs text-bakin-text-muted">Opens the confirmation — nothing has been written yet.</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {attention.length > 0 && (
        <Card className="border-bakin-signal-highlight/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Needs your attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-bakin-text-muted">
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
            <ul className="space-y-1 text-xs text-bakin-text-muted">
              {result.cantCarry!.map((line) => (
                <li key={line.concern}>{line.detail}{line.count !== undefined ? ` (${line.count})` : ''}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {result.backupPath && !result.dryRun && (
        <p className="text-xs text-bakin-text-muted">Settings backup: {result.backupPath}</p>
      )}
    </div>
  )
}

/**
 * Honest one-liners per known adapter — what you get and what you give up.
 * Unknown adapters fall back to a neutral line; blurbs and labels are UI
 * copy only, never capability logic (that's the Overview grid's job).
 */
const RUNTIME_BLURBS: Record<string, string> = {
  openclaw: 'Runs agents through its own gateway — native Discord delivery, native cron, per-agent MCP tool access.',
  pi: 'Runs agents in-process — fast and simple, no gateway. Approvals and alerts surface in the app; Bakin owns scheduling.',
}
const RUNTIME_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  pi: 'Pi',
}

export function RuntimesTab({ report, onSwitched }: { report: CapabilityReport; onSwitched: () => void }) {
  const [target, setTarget] = useState<string | null>(null)
  const [adoptCron, setAdoptCron] = useState(false)
  const [copyWorkspaces, setCopyWorkspaces] = useState(true)
  const [running, setRunning] = useState<'preview' | 'switch' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [steps, setSteps] = useState<SwitchStepRow[]>([])
  const [result, setResult] = useState<SwitchResultPayload | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const others = report.adapters.filter((name) => name !== report.adapter)
  const roster = [report.adapter, ...others]

  const run = useCallback(async (dryRun: boolean) => {
    if (!target || running !== null) return
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
  }, [target, running, adoptCron, copyWorkspaces, report.adapter, onSwitched])

  if (others.length === 0) {
    return <p className="text-sm text-bakin-text-muted">No other runtime adapters are available to switch to.</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-bakin-text-muted">
        The runtime is the engine that runs your agents. Switching is a real migration, not a toggle —
        agents start fresh sessions on the target and runtime-owned state stays behind. Preview first.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {roster.map((name) => {
          const isActive = name === report.adapter
          return (
            <button
              key={name}
              type="button"
              disabled={isActive || running !== null}
              data-testid={`switch-target-${name}`}
              onClick={() => { setTarget(name); setResult(null); setSteps([]); setConfirming(true) }}
              className={`rounded-bakin-surface border bg-bakin-surface-default p-5 text-left text-bakin-text-primary shadow transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring ${
                isActive
                  ? 'cursor-default border-bakin-action-primary-background/40 bg-bakin-action-primary-background/5 ring-1 ring-bakin-action-primary-background/40'
                  : 'border-bakin-border-subtle hover:bg-bakin-canvas-default/40'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-bakin-control ${isActive ? 'bg-bakin-action-primary-background/10' : 'bg-bakin-canvas-default/60'}`}>
                  <Cpu className={`size-5 ${isActive ? 'text-bakin-action-primary-background' : 'text-bakin-text-muted'}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold">{RUNTIME_LABELS[name] ?? name}</p>
                    {isActive && (
                      <StatusBadge tone="success" variant="soft">Active</StatusBadge>
                    )}
                    <span className="ml-auto text-bakin-typography-size-meta text-bakin-text-muted/60">
                      {isActive ? `${report.runtime.name}@${report.runtime.version}` : name}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-bakin-text-muted">
                    {RUNTIME_BLURBS[name] ?? 'Runtime adapter.'}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <ExtensionsSection />

      {running !== null && steps.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-bakin-text-muted">
          <Loader2 className="size-4 animate-spin" />
          {running === 'preview' ? 'Running preview…' : `Switching to ${target}…`}
        </p>
      )}
      <ProgressSteps steps={steps} />
      {result && <ResultCards result={result} onProceed={() => setConfirming(true)} busy={running !== null} />}

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        title={`Switch to ${target ? RUNTIME_LABELS[target] ?? target : ''}?`}
        className="sm:max-w-xl"
        description={
          <>
            This migrates your agent roster to {target}. Before you switch:
            <span className="mt-2 block">• Agents start fresh sessions on {target} — in-flight context does not carry.</span>
            <span className="block">• Runtime-owned channels and cron jobs stay behind{adoptCron ? ' (cron will be adopted into Bakin schedules)' : ''}.</span>
            <span className="block">• {target} needs its own provider credentials — carried agents can't run turns without them.</span>
            <span className="block">• Bakin data (tasks, assets, chats, schedules) is never touched; settings are backed up and restored if anything fails.</span>
            <span className="mt-2 block">A server restart finishes the change.</span>
          </>
        }
        confirmLabel={`Switch to ${target ? RUNTIME_LABELS[target] ?? target : ''}`}
        confirmValue={target ?? ''}
        confirmTestId="switch-confirm"
        onConfirm={() => {
          setConfirming(false)
          void run(false)
        }}
      >
        <div className="space-y-3">
          <Field orientation="horizontal" name="copy-workspaces">
            <Checkbox
              checked={copyWorkspaces}
              onCheckedChange={(checked) => setCopyWorkspaces(checked === true)}
            />
            <FieldLabel>Carry workspace content</FieldLabel>
            <FieldDescription>Soul, memory, and agent-authored skills copy onto agents the switch creates.</FieldDescription>
          </Field>
          <Field orientation="horizontal" name="adopt-cron">
            <Checkbox
              checked={adoptCron}
              onCheckedChange={(checked) => setAdoptCron(checked === true)}
              data-testid="switch-adopt-cron"
            />
            <FieldLabel>Adopt the runtime's cron jobs into Bakin schedules</FieldLabel>
            <FieldDescription>Native cron jobs stop with the old runtime — adopting keeps them running as Bakin schedules.</FieldDescription>
          </Field>
          <div className="flex items-center gap-2 border-t border-bakin-border-subtle/60 pt-3">
            <Button size="sm" variant="outline" data-testid="switch-preview" onClick={() => { setConfirming(false); void run(true) }}>
              Preview switch
            </Button>
            <span className="text-xs text-bakin-text-muted">Dry run — nothing is written.</span>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  )
}
