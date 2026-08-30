/**
 * Runtime hub — Runtimes: the runtime roster (shared EntityCardBody anatomy:
 * icon tile + title row + badge + description) with the guided switch flow.
 * Clicking a runtime opens the ConfirmDialog, which owns the WHOLE flow —
 * options, consequences, preview trigger, typed confirm; nothing actionable
 * lives inline on the page (repair-button precedent). Preview is a dry run
 * (zero writes) whose grouped result cards render on the page as read-only
 * output, with live progress steps (Timeline) over the runtime:switch SSE
 * stream.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Cpu } from 'lucide-react'
import { DisclosurePanel, Grid, Inline, Stack } from '@makinbakin/sdk/layout'
import {
  ConfirmDialog,
  CopyButton,
  KeyValue,
  StatGroup,
  StatTile,
  StatusBadge,
  Timeline,
  TimelineEntry,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import {
  Banner,
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
  Separator,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { reduceSwitchProgress, SWITCH_PHASE_LABELS, type SwitchStepRow } from '../../lib/runtime-report'
import { ExtensionsSection } from './extensions-section'
import { EntityCardBody } from './shared'
import { describeRequestError, responseError } from '../../lib/request-error'
import type { CapabilityReport, SwitchResultPayload } from './types'
import { cn } from '@makinbakin/sdk/utils'

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
      <CardContent>
        <Timeline aria-label="Switch progress">
          {steps.map((step) => (
            <TimelineEntry
              key={step.phase}
              tone={STEP_TONE[step.status]}
              markerLabel={STEP_MARKER_LABEL[step.status]}
              title={SWITCH_PHASE_LABELS[step.phase] ?? step.phase}
              meta={step.detail ? <Text size="meta" tone="muted">{step.detail}</Text> : undefined}
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
    <Stack gap="item" data-testid="switch-result">
      {!result.ok && (
        <Banner
          tone="danger"
          announce="polite"
          headingLevel={3}
          title="Switch failed"
          description={
            <>
              {result.error}
              {result.restored !== undefined && (result.restored ? ' — the previous runtime was restored.' : ' — restore ALSO failed; check settings backup.')}
            </>
          }
        />
      )}

      {result.ok && (
        <Card>
          <CardHeader>
            <CardTitle>
              {result.dryRun ? `Preview: ${result.from} → ${result.to}` : `Switched ${result.from} → ${result.to}`}
            </CardTitle>
            {result.restartRequired && (
              <CardDescription>Restart the Bakin server to finish — plugins hold the old runtime until then.</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Stack gap="item">
              <StatGroup label="Switch summary">
                <StatTile label={`agents ${verb.toLowerCase()}`} value={result.roster?.carried.length ?? 0} />
                <StatTile label={`already on ${result.to}`} value={result.roster?.existing.length ?? 0} />
                <StatTile label={`files + skills ${verb.toLowerCase()}`} value={workspaceFiles + workspaceSkills} />
                <StatTile label={`cron jobs ${result.dryRun ? 'would be adopted' : 'adopted'}`} value={result.cron ? result.cron.adopted.length : '—'} />
              </StatGroup>
              {result.dryRun && onProceed && (
                <>
                  <Separator />
                  <Inline gap="dense" align="center">
                    <Button size="sm" onClick={onProceed} disabled={busy} data-testid="switch-execute">
                      Switch to {RUNTIME_LABELS[result.to] ?? result.to}…
                    </Button>
                    <Text size="meta" tone="muted">Opens the confirmation — nothing has been written yet.</Text>
                  </Inline>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* The kit's `tone` rail replaces the hand-tinted border. This stays
          expanded on purpose: it is the one part of a switch result the user
          has to act on, so it never hides behind a disclosure. */}
      {attention.length > 0 && (
        <Card tone="attention">
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="m-0 list-disc ps-bakin-4 text-bakin-typography-size-meta text-bakin-text-muted">
              {attention.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {(result.cantCarry?.length ?? 0) > 0 && (
        <DisclosurePanel
          variant="soft"
          summary="Stays behind"
          summaryMeta={`${result.cantCarry!.length} runtime-owned`}
        >
          <ul className="m-0 list-disc ps-bakin-4 text-bakin-typography-size-meta text-bakin-text-muted">
            {result.cantCarry!.map((line) => (
              <li key={line.concern}>{line.detail}{line.count !== undefined ? ` (${line.count})` : ''}</li>
            ))}
          </ul>
        </DisclosurePanel>
      )}

      {result.backupPath && !result.dryRun && (
        <KeyValue
          layout="inline"
          items={[{
            label: 'Settings backup',
            mono: true,
            breakValue: true,
            value: (
              <>
                {result.backupPath}
                <CopyButton text={result.backupPath} label="Copy settings backup path" />
              </>
            ),
          }]}
        />
      )}
    </Stack>
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

/** A dry run only reads; bound it so a wedged server can't pin "Previewing…". */
const PREVIEW_TIMEOUT_MS = 60_000

export function RuntimesTab({ report, onSwitched }: { report: CapabilityReport; onSwitched: () => void }) {
  const [target, setTarget] = useState<string | null>(null)
  const [adoptCron, setAdoptCron] = useState(false)
  const [copyWorkspaces, setCopyWorkspaces] = useState(true)
  const [running, setRunning] = useState<'preview' | 'switch' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [steps, setSteps] = useState<SwitchStepRow[]>([])
  const [result, setResult] = useState<SwitchResultPayload | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Without this, navigating away mid-switch leaves the progress stream open
  // and the settle path calls setState on an unmounted tree.
  useEffect(() => () => {
    esRef.current?.close()
    esRef.current = null
  }, [])

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
        // A dry run is read-only by contract (zero writes), so abandoning it is
        // safe and beats a permanent "Previewing…". A REAL switch is deliberately
        // unbounded: the client aborting does not stop the server mid-flip, so a
        // deadline here would report "failed" over a switch still applying and
        // invite a double-switch retry. Progress stays visible on the SSE stream.
        ...(dryRun ? { signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS) } : {}),
        body: JSON.stringify({
          target,
          ...(dryRun ? { dryRun: true } : {}),
          ...(copyWorkspaces ? {} : { copyWorkspaces: false }),
          ...(adoptCron ? { adoptCron: true } : {}),
        }),
      })
      // A 5xx can answer with an HTML error page: parsing it first threw and
      // the catch below reported a real server failure as a network error.
      if (!res.ok) throw await responseError(res, 'The runtime was not switched')
      setResult(await res.json() as SwitchResultPayload)
      if (!dryRun) onSwitched()
    } catch (err) {
      setResult({
        ok: false,
        from: report.adapter,
        to: target,
        error: describeRequestError(err),
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
    return (
      <SystemState
        kind="initial-empty"
        scope="section"
        title="Only one runtime is available"
        description="No other runtime adapters are installed, so there is nothing to switch to."
      />
    )
  }

  return (
    <Stack gap="item">
      <Text as="p" tone="muted">
        The runtime is the engine that runs your agents. Switching is a real migration, not a toggle —
        agents start fresh sessions on the target and runtime-owned state stays behind. Preview first.
      </Text>
      <Grid layout="split" gap="item">
        {roster.map((name) => {
          const isActive = name === report.adapter
          return (
            <button
              key={name}
              type="button"
              disabled={isActive || running !== null}
              data-testid={`switch-target-${name}`}
              onClick={() => { setTarget(name); setResult(null); setSteps([]); setConfirming(true) }}
              className={cn('rounded-bakin-surface border bg-bakin-surface-default p-bakin-4 text-left text-bakin-text-primary shadow transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring', isActive
                  ? 'cursor-default border-bakin-action-primary-background/40 bg-bakin-action-primary-background/5 ring-1 ring-bakin-action-primary-background/40'
                  : 'border-bakin-border-subtle hover:bg-bakin-canvas-default/40')}
            >
              <EntityCardBody
                icon={Cpu}
                tone={isActive ? 'active' : 'neutral'}
                title={RUNTIME_LABELS[name] ?? name}
                badge={isActive ? <StatusBadge tone="success" variant="soft">Active</StatusBadge> : undefined}
                meta={isActive ? `${report.runtime.name}@${report.runtime.version}` : name}
                blurb={RUNTIME_BLURBS[name] ?? 'Runtime adapter.'}
              />
            </button>
          )
        })}
      </Grid>

      <ExtensionsSection />

      {running !== null && steps.length === 0 && (
        <SystemState
          kind="loading"
          scope="inline"
          align="left"
          headingLevel={3}
          title={running === 'preview' ? 'Running preview…' : `Switching to ${target ? RUNTIME_LABELS[target] ?? target : ''}…`}
          description="Progress appears here as each phase reports in."
        />
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
            <span className="mt-bakin-2 block">• Agents start fresh sessions on {target} — in-flight context does not carry.</span>
            <span className="block">• Runtime-owned channels and cron jobs stay behind{adoptCron ? ' (cron will be adopted into Bakin schedules)' : ''}.</span>
            <span className="block">• {target} needs its own provider credentials — carried agents can't run turns without them.</span>
            <span className="block">• Bakin data (tasks, assets, chats, schedules) is never touched; settings are backed up and restored if anything fails.</span>
            <span className="mt-bakin-2 block">A server restart finishes the change.</span>
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
        <Stack gap="item">
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
          <Separator />
          <Inline gap="dense" align="center">
            <Button size="sm" variant="outline" data-testid="switch-preview" onClick={() => { setConfirming(false); void run(true) }}>
              Preview switch
            </Button>
            <Text size="meta" tone="muted">Dry run — nothing is written.</Text>
          </Inline>
        </Stack>
      </ConfirmDialog>
    </Stack>
  )
}
