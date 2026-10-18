/**
 * Runtime hub — Runtimes: a sortable, responsive roster with a guided switch flow.
 * Preview switch opens the ConfirmDialog, which owns the WHOLE flow —
 * options, consequences, preview trigger, typed confirm; nothing actionable
 * lives inline on the page (repair-button precedent). Preview is a dry run
 * (zero writes) whose grouped result cards render on the page as read-only
 * output. Preview and switch are operations (#895), followed live with
 * `useOperation` and shown with `OperationProgress`.
 */
import { useCallback, useEffect, useState } from 'react'
import { startOperation, useOperation } from '@makinbakin/sdk/hooks'
import { DisclosurePanel, Inline, Stack } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import {
  ConfirmDialog,
  CopyButton,
  OperationProgress,
  KeyValue,
  StatGroup,
  StatTile,
  StatusBadge,
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
import { isOperationFinished, type OperationStartResponse } from '@makinbakin/sdk/types'
import { ExtensionsSection } from './extensions-section'
import { RuntimeTable } from './runtime-table'
import { describeRequestError } from '../../lib/request-error'
import type { CapabilityReport, SwitchResultPayload } from './types'

const CRON_OUTCOME_TONE = { adopt: 'success', skip: 'neutral', refuse: 'attention', failed: 'danger' } as const
const CRON_OUTCOME_LABEL = { adopt: 'Adopted', skip: 'Already Bakin', refuse: 'Refused', failed: 'Failed' } as const

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
  for (const d of result.deadSelections?.dead ?? []) {
    attention.push(`${d.label} (${d.ref}) uses '${d.model}' — ${d.detail}${d.proposal.to ? `; proposed: ${d.proposal.to}` : ''}. Nothing was changed — review in Models.`)
  }
  for (const f of result.workspaces?.failed ?? []) attention.push(`${f.agentId} (${f.path}): ${f.error}`)
  for (const f of result.cron?.failed ?? []) attention.push(`cron ${f.jobId}: ${f.error}`)
  for (const r of result.cron?.refused ?? []) attention.push(`cron ${r.name}: refused — ${r.reason}; it stays native`)
  if (result.credentials && result.credentials.llmProviders.length === 0) {
    attention.push(`${result.to} has no model providers configured — carried agents cannot run turns until you log in on the target.`)
  }
  for (const step of result.channels?.setup ?? []) attention.push(`Channels: ${step}`)

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
                <StatTile label="cron jobs refused" value={result.cron ? result.cron.refused.length : '—'} />
              </StatGroup>
              {result.cron && result.cron.listing.length > 0 && (
                <DisclosurePanel summary="Cron jobs" summaryMeta={`${result.cron.listing.length} in the source runtime`} data-testid="switch-cron-listing">
                  <ul className="m-0 grid list-none gap-bakin-2 p-0">
                    {result.cron.listing.map((row) => (
                      <li key={row.jobId} className="min-w-0">
                        <Inline gap="dense" align="center" wrap>
                          <StatusBadge tone={CRON_OUTCOME_TONE[row.outcome]} variant="solid" size="xs">{CRON_OUTCOME_LABEL[row.outcome]}</StatusBadge>
                          <Text size="body" className="min-w-0 break-words">{row.name}</Text>
                          {row.commandPreview ? <Text size="meta" tone="muted" mono className="min-w-0 break-all">{row.commandPreview}</Text> : null}
                        </Inline>
                        {row.reason ? <Text size="meta" tone="muted" as="p" className="min-w-0 break-words">{row.reason}</Text> : null}
                      </li>
                    ))}
                  </ul>
                </DisclosurePanel>
              )}
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

      {result.channels && (
        <DisclosurePanel
          variant="soft"
          summary="Channel delivery"
          summaryMeta={`${result.channels.source.owner} → ${result.channels.target.owner} (${result.channels.target.projectedState.replace(/_/g, ' ')})`}
          data-testid="switch-channels"
        >
          <Stack gap="dense">
            <Text size="meta" tone="muted" as="p">{result.channels.ownership}</Text>
            <Text size="meta" tone="muted" as="p">
              Bakin token: {result.channels.target.tokenSource === null ? 'not set' : result.channels.target.tokenSource === 'env' ? 'environment variable' : 'Bakin store'}.{' '}
              <PluginLink to="/settings?tab=channels">Open Settings → Channels</PluginLink>
            </Text>
          </Stack>
        </DisclosurePanel>
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

export function RuntimesTab({ report, onSwitched }: { report: CapabilityReport; onSwitched: () => void }) {
  const [target, setTarget] = useState<string | null>(null)
  const [adoptCron, setAdoptCron] = useState(false)
  const [copyWorkspaces, setCopyWorkspaces] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<SwitchResultPayload | null>(null)
  // The preview or switch in flight — an operation (#895), followed live.
  const [operation, setOperation] = useState<{ dryRun: boolean; target: string; start: OperationStartResponse } | null>(null)
  // Busy from the moment the request is sent: a preview and a switch (or two
  // clicks) must never race to own the one follower.
  const [starting, setStarting] = useState<'preview' | 'switch' | null>(null)
  const followed = useOperation<SwitchResultPayload>(operation?.start.operationId ?? null, operation ? { bootId: operation.start.bootId } : {})
  const running: 'preview' | 'switch' | null = operation ? (operation.dryRun ? 'preview' : 'switch') : starting

  const others = report.adapters.filter((name) => name !== report.adapter)
  const roster = [report.adapter, ...others]

  /** A report for a switch that ended without one (refused, restarted, lost). */
  const failedResult = useCallback((to: string, dryRun: boolean, error: string): SwitchResultPayload => ({
    ok: false,
    from: report.adapter,
    to,
    error,
    backupPath: null,
    restartRequired: false,
    roster: null,
    workspaces: null,
    cron: null,
    cantCarry: null,
    credentials: null,
    channels: null,
    sync: null,
    ...(dryRun ? { dryRun: true } : {}),
  }), [report.adapter])

  const run = useCallback(async (dryRun: boolean) => {
    if (!target || operation !== null || starting !== null) return
    setStarting(dryRun ? 'preview' : 'switch')
    setResult(null)
    try {
      const start = await startOperation(() => fetch('/api/runtime/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          ...(dryRun ? { dryRun: true } : {}),
          ...(copyWorkspaces ? {} : { copyWorkspaces: false }),
          ...(adoptCron ? { adoptCron: true } : {}),
        }),
      }))
      setOperation({ dryRun, target, start })
    } catch (err) {
      setResult(failedResult(target, dryRun, describeRequestError(err)))
    } finally {
      setStarting(null)
    }
  }, [target, operation, starting, adoptCron, copyWorkspaces, failedResult])

  const view = followed.operation
  const phase = followed.phase
  useEffect(() => {
    if (!operation) return
    // The switch keeps running on the server whatever this tab does; only
    // its outcome can go missing (a restart, a lost record).
    if (phase === 'restarted' || phase === 'expired') {
      setOperation(null)
      setResult(failedResult(operation.target, operation.dryRun, 'Bakin restarted or lost track of the switch — check the active runtime above.'))
      if (!operation.dryRun) onSwitched()
      return
    }
    if (!view || !isOperationFinished(view.status)) return
    setOperation(null)
    setResult(view.result?.body ?? failedResult(operation.target, operation.dryRun, view.outcome?.message ?? `The switch ${view.status}.`))
    if (!operation.dryRun) onSwitched()
  }, [operation, view, phase, failedResult, onSwitched])

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
      <RuntimeTable label="Available runtimes" queryKey="runtimesSort" rows={roster} rowKey={name => name} columns={[
        { key: 'name', header: 'Runtime', narrow: 'primary', sortable: true, sortValue: name => RUNTIME_LABELS[name] ?? name,
          cell: name => <Text weight="semibold">{RUNTIME_LABELS[name] ?? name}</Text> },
        { key: 'description', header: 'Description', narrow: 'meta', cellClassName: 'whitespace-normal', cell: name => RUNTIME_BLURBS[name] ?? 'Runtime adapter.' },
        { key: 'status', header: 'Status', narrow: 'meta', cell: name => name === report.adapter ? <StatusBadge tone="success" variant="solid" size="xs">Active</StatusBadge> : <Text size="meta" tone="muted">Available</Text> },
        { key: 'version', header: 'Version', narrow: 'label', cell: name => name === report.adapter ? `${report.runtime.name}@${report.runtime.version}` : '—' },
        { key: 'action', header: 'Action', narrow: 'trailing', hideLabel: true, cell: name => <Button size="xs" variant="outline"
          disabled={name === report.adapter || running !== null} data-testid={`switch-target-${name}`}
          aria-label={`Preview switch to ${RUNTIME_LABELS[name] ?? name}`}
          onClick={() => { setTarget(name); setResult(null); setConfirming(true) }}>Preview switch</Button> },
      ]} />

      <ExtensionsSection />

      {running !== null && !view && (
        <SystemState
          kind="loading"
          scope="inline"
          align="left"
          headingLevel={3}
          title={running === 'preview' ? 'Running preview…' : `Switching to ${target ? RUNTIME_LABELS[target] ?? target : ''}…`}
          description="Progress appears here as each phase reports in."
        />
      )}
      {running !== null && view ? <OperationProgress operation={view} phase={phase} data-testid="switch-progress" /> : null}
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
