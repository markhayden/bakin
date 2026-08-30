'use client'

/**
 * MemoryCleanup — find → dispatch → verify flow for scrubbing a stale term
 * (e.g. an old product name) out of agents' memory.
 *
 * Bakin never edits runtime memory: it finds where the term appears, dispatches
 * a cleanup task to each affected agent (the agent edits its OWN files), then
 * re-checks. Only "actionable" tiers (durable / daily_note / dream) are
 * agent-editable; informational tiers (transcripts, audit) are shown for context
 * and left alone (they self-heal).
 */
import { useState } from 'react'
import { Search, Send, CheckCircle2, AlertTriangle, Lock } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Field,
  FieldLabel,
  Input,
  Label,
  Spinner,
  SystemState,
  Text,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { DisclosurePanel, Inline, Panel, Stack } from '@makinbakin/sdk/layout'
import { SegmentedControl, StatusBadge } from '@makinbakin/sdk/patterns'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { pluginFetch } from '@makinbakin/sdk/utils'

interface CleanupHit {
  rowId: string
  tier: string
  agent: string
  sourcePath: string
  label: 'actionable' | 'informational'
  snippets: string[]
  managed?: boolean
}
interface AgentGroup {
  agent: string
  hits: CleanupHit[]
  actionableCount: number
}
interface FindResponse {
  term: string
  groups: AgentGroup[]
  totalHits: number
  actionableHits: number
}
interface DispatchResponse {
  dispatched: Array<{ agent: string; taskId: string; hitCount: number; managedCount: number }>
  skipped: Array<{ agent: string; reason: string }>
  failed: Array<{ agent: string; reason: string }>
}
interface VerifyResponse {
  results: Array<{ agent: string; actionableRemaining: number; informationalRemaining: number; clean: boolean }>
}

/**
 * Read a cleanup response, surfacing the route's own error message rather than
 * a generic status code — the routes explain *why* a cleanup was refused.
 */
async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function MemoryCleanup() {
  const [term, setTerm] = useState('')
  const [action, setAction] = useState<'replace' | 'remove'>('replace')
  const [replacement, setReplacement] = useState('')
  const [instruction, setInstruction] = useState('')

  const [find, setFind] = useState<FindResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dispatch, setDispatch] = useState<DispatchResponse | null>(null)
  const [verify, setVerify] = useState<VerifyResponse | null>(null)

  const [busy, setBusy] = useState<null | 'find' | 'dispatch' | 'verify'>(null)
  const [error, setError] = useState<string | null>(null)

  const runFind = async () => {
    if (!term.trim()) return
    setBusy('find'); setError(null); setDispatch(null); setVerify(null)
    try {
      const data = await unwrap<FindResponse>(
        await pluginFetch('memory', 'cleanup/find', { method: 'POST', body: { term: term.trim() } }),
      )
      setFind(data)
      // Pre-select every agent that has something the agent can actually fix.
      setSelected(new Set(data.groups.filter((g) => g.actionableCount > 0).map((g) => g.agent)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runDispatch = async () => {
    if (!find) return
    const agents = [...selected]
    if (agents.length === 0) return
    if (action === 'replace' && !replacement.trim()) { setError('Replacement is required for rename'); return }
    setBusy('dispatch'); setError(null); setVerify(null)
    try {
      const data = await unwrap<DispatchResponse>(
        await pluginFetch('memory', 'cleanup/dispatch', {
          method: 'POST',
          body: {
            term: find.term,
            action,
            replacement: action === 'replace' ? replacement.trim() : undefined,
            agents,
            instruction: instruction.trim() || undefined,
          },
        }),
      )
      setDispatch(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runVerify = async () => {
    if (!find) return
    const agents = dispatch?.dispatched.map((d) => d.agent) ?? [...selected]
    if (agents.length === 0) return
    setBusy('verify'); setError(null)
    try {
      setVerify(await unwrap<VerifyResponse>(
        await pluginFetch('memory', 'cleanup/verify', {
          method: 'POST',
          body: { term: find.term, agents },
        }),
      ))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const toggle = (agent: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agent)) next.delete(agent); else next.add(agent)
      return next
    })
  }

  return (
    <Stack gap="section">
      {/* Find */}
      <Stack gap="dense">
        <Label htmlFor="cleanup-term">Find a term to scrub from agent memory</Label>
        <Inline gap="dense" wrap={false}>
          <Input
            id="cleanup-term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runFind() }}
            placeholder="e.g. beacon"
          />
          <Button onClick={runFind} disabled={busy === 'find' || !term.trim()}>
            {busy === 'find' ? <Spinner /> : <Search />}
            Find
          </Button>
        </Inline>
      </Stack>

      {error && (
        <SystemState
          kind="error"
          recovery="unavailable"
          scope="inline"
          align="left"
          title="Scrub request failed"
          description={error}
        />
      )}

      {/* Results + selection */}
      {find && (
        <Stack gap="item">
          <p className="text-bakin-text-muted">
            {find.totalHits} occurrence(s) · {find.actionableHits} editable across {find.groups.length} agent(s)
          </p>
          {find.groups.length === 0 && (
            <SystemState
              kind="initial-empty"
              scope="inline"
              align="left"
              title="No occurrences"
              description={`"${find.term}" does not appear in any agent's memory. Nothing to clean up.`}
            />
          )}
          {find.groups.map((g) => (
            <Panel key={g.agent} padding="compact">
              <Stack gap="dense">
                <Field orientation="horizontal" name={`cleanup-agent-${g.agent}`}>
                  <Checkbox
                    checked={selected.has(g.agent)}
                    onCheckedChange={() => toggle(g.agent)}
                    disabled={g.actionableCount === 0}
                  />
                  <FieldLabel>
                    {g.agent}
                    <StatusBadge tone="neutral" variant="soft">{g.actionableCount} editable</StatusBadge>
                    {g.hits.length > g.actionableCount && (
                      <StatusBadge tone="neutral" variant="outline">
                        {g.hits.length - g.actionableCount} informational
                      </StatusBadge>
                    )}
                  </FieldLabel>
                </Field>
                <DisclosurePanel
                  // Open by default: the operator confirms a destructive
                  // dispatch from this evidence, so hiding which files and
                  // which are package-managed behind a click is not honest.
                  open
                  variant="ghost"
                  summary={`${g.hits.length} occurrence(s)`}
                >
                  <Stack gap="dense" as="ul">
                    {g.hits.map((h) => (
                      <li key={h.rowId} className="min-w-0 text-bakin-typography-size-meta">
                        <Inline gap="dense" wrap={false}>
                          {/* Emphasis carries "the agent can edit this"; the
                              informational tiers stay quiet and self-heal. */}
                          <StatusBadge
                            tone={h.label === 'actionable' ? 'accent' : 'neutral'}
                            variant={h.label === 'actionable' ? 'solid' : 'outline'}
                          >
                            {h.tier}
                          </StatusBadge>
                          {h.managed && (
                            <Tooltip>
                              <TooltipTrigger
                                render={<span />}
                                className="inline-flex shrink-0 text-bakin-signal-highlight"
                              >
                                <Lock className="size-bakin-3" aria-hidden="true" />
                                <span className="sr-only">Package-managed</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Package-managed — the edit is pinned so it survives a template refresh.
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {/* The path truncates in this column, so the tooltip is
                              the only place the full location stays readable. */}
                          <Tooltip>
                            <TooltipTrigger
                              render={<span />}
                              className="min-w-0 truncate font-bakin-typography-family-mono text-bakin-text-muted"
                            >
                              {h.sourcePath}
                            </TooltipTrigger>
                            <TooltipContent>{h.sourcePath}</TooltipContent>
                          </Tooltip>
                        </Inline>
                        {h.snippets.map((s, i) => (
                          <Tooltip key={i}>
                            <TooltipTrigger
                              render={<span />}
                              className="block min-w-0 truncate ps-bakin-4 text-bakin-text-muted"
                            >
                              › {s}
                            </TooltipTrigger>
                            <TooltipContent>{s}</TooltipContent>
                          </Tooltip>
                        ))}
                      </li>
                    ))}
                  </Stack>
                </DisclosurePanel>
              </Stack>
            </Panel>
          ))}
        </Stack>
      )}

      {/* Action + dispatch */}
      {find && find.actionableHits > 0 && (
        <Panel padding="compact">
          <Stack gap="item">
            <SegmentedControl
              ariaLabel="Scrub action"
              size="sm"
              options={[
                { value: 'replace', label: 'Rename' },
                { value: 'remove', label: 'Remove' },
              ]}
              value={action}
              onValueChange={setAction}
            />
            {action === 'replace' && (
              <Stack gap="dense">
                <Label htmlFor="cleanup-replacement">Replace with</Label>
                <Input
                  id="cleanup-replacement"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="e.g. bakin"
                />
              </Stack>
            )}
            <Stack gap="dense">
              <Label htmlFor="cleanup-instruction">Instruction sent to the agent (optional)</Label>
              <Textarea
                id="cleanup-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Optional: override the instruction sent to the agent"
                rows={2}
              />
            </Stack>
            <div>
              <Button
                onClick={runDispatch}
                disabled={busy === 'dispatch' || selected.size === 0 || (action === 'replace' && !replacement.trim())}
              >
                {busy === 'dispatch' ? <Spinner /> : <Send />}
                Dispatch to {selected.size} agent(s)
              </Button>
            </div>
          </Stack>
        </Panel>
      )}

      {/* Dispatch result */}
      {dispatch && (
        <Panel padding="compact">
          <Stack gap="dense">
            <h3>Dispatched {dispatch.dispatched.length} scrub task(s)</h3>
            {dispatch.dispatched.map((d) => (
              <Text key={d.agent} size="meta" tone="muted" as="p">
                {d.agent} → <PluginLink to="/tasks">task {d.taskId}</PluginLink> ({d.hitCount} file(s){d.managedCount ? `, ${d.managedCount} pinned` : ''})
              </Text>
            ))}
            {dispatch.skipped.map((s) => (
              <Text key={s.agent} size="meta" tone="muted" as="p">
                {s.agent} — skipped ({s.reason})
              </Text>
            ))}
            {dispatch.failed?.map((f) => (
              <Alert key={f.agent} tone="danger">
                <AlertDescription>{f.agent} — failed ({f.reason})</AlertDescription>
              </Alert>
            ))}
            <div>
              <Button variant="outline" size="sm" onClick={runVerify} disabled={busy === 'verify'}>
                {busy === 'verify' ? <Spinner /> : <CheckCircle2 />}
                Verify
              </Button>
            </div>
          </Stack>
        </Panel>
      )}

      {/* Verify result */}
      {verify && (
        <Panel padding="compact">
          <Stack gap="dense">
            <h3>Verification</h3>
            {verify.results.map((r) => (
              <Inline key={r.agent} gap="dense">
                <StatusBadge
                  tone={r.clean ? 'success' : 'attention'}
                  variant="soft"
                  icon={r.clean ? CheckCircle2 : AlertTriangle}
                >
                  {r.clean ? 'Clean' : 'Remaining'}
                </StatusBadge>
                <span className="text-bakin-typography-size-meta">{r.agent}</span>
                <Text size="meta" tone="muted">
                  {r.clean ? 'clean' : `${r.actionableRemaining} editable occurrence(s) remain`}
                  {r.informationalRemaining > 0 ? ` · ${r.informationalRemaining} informational left (self-healing)` : ''}
                </Text>
              </Inline>
            ))}
          </Stack>
        </Panel>
      )}
    </Stack>
  )
}
