'use client'

/**
 * `/team?recover=1` (self-healing PR1 slice 1.4b; rows 106–107): the roster
 * editor Health hands the operator, one row per failing ENTRY, read from
 * the canonical cached report's evidence (positions, ids, names) — never
 * from sentence text. `?agent=<id>` / `?entry=<n>` land on the failing row.
 *
 * The roster is the runtime's record and the neutral contract addresses
 * agents BY ID (`agents.remove(id)`), so:
 * - a DUPLICATED id has one executable decision here: remove the agent
 *   entirely — every entry with that id and its workspace go (typed
 *   confirmation; the main agent is refused by the route) — then the
 *   roster check reruns on the spot;
 * - an entry WITHOUT an id cannot be addressed through the contract at all
 *   (no member names an entry by position), so its row names the entry
 *   and its workspace and offers the recheck once the registry entry has
 *   an id. The honest gap (a registry-location member) is reported, not
 *   papered over with a "fix it in the registry" sentence.
 *
 * Evidence states stay apart (Codex r2 #10): findings; verified-empty (the
 * roster check OBSERVED and found nothing); UNVERIFIED (the check has not
 * reported in the current report); UNAVAILABLE (the report could not be
 * read — the last known rows stay, never "consistent").
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PluginLink, useQueryState } from '@makinbakin/sdk/navigation'
import { ConfirmDialog, HandoffCard, ListRow, ListRowGroup, ListRows } from '@makinbakin/sdk/patterns'
import { Banner, Button, Text, buttonVariants } from '@makinbakin/sdk/ui'

const ROSTER_CHECK_ID = 'team.agent-roster'

interface ReportLike {
  checks?: Array<{ checkId: string; latestExecution?: { outcome?: string } }>
  observations: Array<{ id: string; checkId?: string; summary: string; evidence?: Record<string, unknown> }>
}

/** The roster check has OBSERVED in this report — only then is an empty finding list "consistent". */
export function rosterVerified(report: ReportLike): boolean {
  return (report.checks ?? []).some((check) => check.checkId === ROSTER_CHECK_ID && check.latestExecution?.outcome === 'observed')
}

export type RosterProblem =
  | { kind: 'duplicate'; agentId: string; positions: number[]; names: string[]; summary: string }
  | { kind: 'missing-id'; rosterIndex: number; name?: string; workspace?: string; registry?: { path: string; entryKey: string }; summary: string }

function asNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : []
}
function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
/** The registry location the check recorded (`agents.registryLocation()`), when the runtime has one. */
function registryOf(value: unknown): { path: string; entryKey: string } | null {
  if (!value || typeof value !== 'object') return null
  const { path, entryKey } = value as { path?: unknown; entryKey?: unknown }
  return typeof path === 'string' && path !== '' && typeof entryKey === 'string' && entryKey !== '' ? { path, entryKey } : null
}
/** The handoff command for the registry file — the operator's editor, never a Bakin write (mirrors the check's). */
function registryEditCommand(path: string): string {
  return `"\${EDITOR:-nano}" ${JSON.stringify(path)}`
}

/** The roster findings as the check emitted them (evidence first, summary as the fallback label). */
export function rosterProblemsFrom(report: ReportLike): RosterProblem[] {
  const problems: RosterProblem[] = []
  for (const observation of report.observations) {
    if (!observation.id.startsWith(`${ROSTER_CHECK_ID}:`)) continue
    const evidence = observation.evidence ?? {}
    if (evidence.kind === 'duplicate' && typeof evidence.agentId === 'string') {
      problems.push({ kind: 'duplicate', agentId: evidence.agentId, positions: asNumbers(evidence.positions), names: asStrings(evidence.names), summary: observation.summary })
    } else if (evidence.kind === 'missing-id' && typeof evidence.rosterIndex === 'number') {
      problems.push({
        kind: 'missing-id',
        rosterIndex: evidence.rosterIndex,
        ...(typeof evidence.name === 'string' ? { name: evidence.name } : {}),
        ...(typeof evidence.workspace === 'string' ? { workspace: evidence.workspace } : {}),
        ...(registryOf(evidence.registry) ? { registry: registryOf(evidence.registry)! } : {}),
        summary: observation.summary,
      })
    }
  }
  return problems
}

type ProblemsRead =
  | { status: 'ok'; problems: RosterProblem[]; verified: boolean }
  | { status: 'error'; message: string }

async function readProblems(signal: AbortSignal): Promise<ProblemsRead> {
  const res = await fetch('/api/plugins/health/doctor', { signal })
  if (!res.ok) return { status: 'error', message: `Health could not be read (${res.status}).` }
  const report = await res.json() as ReportLike
  return { status: 'ok', problems: rosterProblemsFrom(report), verified: rosterVerified(report) }
}

/** Targeted rerun of the roster check — the return verification for every control on this panel. False = Health could not be asked. */
async function recheckRoster(): Promise<boolean> {
  try {
    const res = await fetch('/api/plugins/health/doctor/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkIds: [ROSTER_CHECK_ID] }),
    })
    return res.ok
  } catch {
    return false
  }
}

export interface RosterProblemsState {
  /** Null until the first successful read; a failed refresh keeps the last known rows. */
  problems: RosterProblem[] | null
  /** The roster check has observed in the current report. */
  verified: boolean
  /** The latest read failed (the rows, if any, are the last known ones). */
  error: string | null
  refresh: () => Promise<void>
}

export function useRosterProblems(): RosterProblemsState {
  const [state, setState] = useState<{ problems: RosterProblem[] | null; verified: boolean; error: string | null }>({ problems: null, verified: false, error: null })
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++generation.current
    const controller = new AbortController()
    try {
      const next = await readProblems(controller.signal)
      if (mine !== generation.current) return
      if (next.status === 'ok') setState({ problems: next.problems, verified: next.verified, error: null })
      else setState((previous) => ({ ...previous, error: next.message }))
    } catch (err) {
      if (mine === generation.current) setState((previous) => ({ ...previous, error: `Health could not be read: ${err instanceof Error ? err.message : String(err)}` }))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { ...state, refresh }
}

const positionList = (positions: number[]) => positions.map((index) => index + 1).join(', ')

export function RosterRecoverPanel({ onDismiss, onChanged }: { onDismiss: () => void; onChanged?: () => void }) {
  const { problems, verified, error: readError, refresh } = useRosterProblems()
  const [agentParam] = useQueryState('agent', '')
  const [entryParam] = useQueryState('entry', '')
  const [pending, setPending] = useState<Extract<RosterProblem, { kind: 'duplicate' }> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const highlighted = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    highlighted.current?.focus({ preventScroll: true })
    highlighted.current?.scrollIntoView?.({ block: 'center' })
  }, [problems])

  const recheck = useCallback(async () => {
    setBusy('recheck')
    setError(null)
    try {
      if (!await recheckRoster()) setError('Health could not be asked to recheck the roster — run checks from the Health page.')
      await refresh()
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const removeAgent = useCallback(async (problem: Extract<RosterProblem, { kind: 'duplicate' }>) => {
    setBusy(`remove:${problem.agentId}`)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/team/${encodeURIComponent(problem.agentId)}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null
        setError(typeof body?.error === 'string' ? body.error : `Remove failed (${res.status})`)
        return
      }
      setPending(null)
      onChanged?.()
      if (!await recheckRoster()) setError('Removed, but Health could not be asked to recheck the roster — run checks from the Health page.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [onChanged, refresh])

  const dismiss = <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
  const retry = <Button variant="outline" size="sm" onClick={() => { void refresh() }}>Try again</Button>
  if (problems === null) {
    // Never read successfully: an honest error, never an empty (= consistent) list.
    if (readError) {
      return <Banner tone="danger" title="Health could not be read" description={`${readError} The roster findings are unknown until it can.`} action={<span className="flex gap-bakin-2">{retry}{dismiss}</span>} data-testid="roster-recover-panel" data-evidence="unavailable" />
    }
    return null
  }
  if (problems.length === 0) {
    if (!verified) {
      return (
        <Banner
          tone="attention"
          title="Health has not verified the roster yet"
          description="The roster check has not reported in the current Health report, so nothing here is confirmed. Recheck the roster to find out."
          action={<span className="flex gap-bakin-2"><Button variant="outline" size="sm" busy={busy === 'recheck'} disabled={busy !== null} onClick={() => { void recheck() }}>Recheck roster</Button>{dismiss}</span>}
          data-testid="roster-recover-panel"
          data-evidence="unverified"
        />
      )
    }
    return <Banner tone="success" title="The roster is consistent" description="Every runtime agent has one stable id." action={dismiss} data-testid="roster-recover-panel" data-evidence="verified-empty" />
  }

  const isHighlighted = (problem: RosterProblem) => problem.kind === 'duplicate'
    ? agentParam !== '' && problem.agentId === agentParam
    : entryParam !== '' && String(problem.rosterIndex) === entryParam

  return (
    <div data-testid="roster-recover-panel" className="grid gap-bakin-3" data-evidence={readError ? 'stale' : 'findings'}>
      {readError && <Banner tone="danger" title="The latest refresh failed" description={`${readError} Showing the last roster findings Health reported.`} action={retry} />}
      {error && pending === null && <Banner tone="danger" title="The last action did not go through" description={error} />}
      <ListRowGroup label={problems.length === 1 ? '1 roster problem' : `${problems.length} roster problems`} headerVariant="section" headerTone="attention">
        <ListRows variant="separated" aria-label="Roster problems">
          {problems.map((problem) => {
            const key = problem.kind === 'duplicate' ? `duplicate:${problem.agentId}` : `missing-id:${problem.rosterIndex}`
            const focused = isHighlighted(problem)
            return (
              <ListRow
                key={key}
                ref={focused ? highlighted : undefined}
                tabIndex={focused ? -1 : undefined}
                data-roster-problem={key}
                data-highlighted={focused ? 'true' : undefined}
                className={`flex min-w-0 flex-wrap items-center justify-between gap-bakin-3${focused ? ' outline outline-2 outline-offset-2 outline-bakin-signal-highlight' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  {problem.kind === 'duplicate' ? (
                    <>
                      <Text as="span" weight="medium">Agent id {problem.agentId} at roster positions {positionList(problem.positions)}</Text>
                      <Text as="span" tone="muted" className="block">
                        {problem.names.length > 1 ? `Named ${problem.names.join(' / ')}. ` : ''}
                        The runtime addresses agents by id, so Bakin cannot remove ONE of these entries: removing the agent removes every entry named {problem.agentId} and moves its workspace to the trash.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text as="span" weight="medium">Roster entry {problem.rosterIndex + 1} has no id{problem.name ? ` (named ${problem.name})` : ''}</Text>
                      <Text as="span" tone="muted" className="block">
                        {problem.workspace ? <>Workspace <code className="font-bakin-typography-family-mono">{problem.workspace}</code>. </> : null}
                        {problem.registry
                          ? <>The runtime addresses agents by id, so Bakin cannot assign one for you: give <code className="font-bakin-typography-family-mono">{problem.registry.entryKey}</code> an id in the registry file, save, then recheck.</>
                          : <>No runtime surface names an entry by position, so Bakin cannot assign the id for you: give the entry an id in the runtime's registry, then recheck.</>}
                      </Text>
                      {problem.registry ? (
                        <HandoffCard
                          className="mt-bakin-2"
                          headingLevel={4}
                          title={`Give roster entry ${problem.rosterIndex + 1} an id`}
                          description={<>Opens the runtime's registry in your editor; the entry is <code className="font-bakin-typography-family-mono">{problem.registry.entryKey}</code>. Recheck when you have saved.</>}
                          command={registryEditCommand(problem.registry.path)}
                        />
                      ) : null}
                    </>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-bakin-2">
                  {problem.kind === 'duplicate' ? (
                    <>
                      <PluginLink to={`/team/${encodeURIComponent(problem.agentId)}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>Open {problem.agentId}</PluginLink>
                      <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => { setError(null); setPending(problem) }}>
                        Remove {problem.agentId} entirely
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" busy={busy === 'recheck'} disabled={busy !== null} onClick={() => { void recheck() }}>Recheck roster</Button>
                  )}
                </span>
              </ListRow>
            )
          })}
        </ListRows>
      </ListRowGroup>
      <div className="flex justify-end">{dismiss}</div>
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `Remove agent ${pending.agentId}?` : ''}
        description={pending ? `Every roster entry named ${pending.agentId} (positions ${positionList(pending.positions)}) is removed from the runtime and its workspace moves to the trash. Tasks assigned to ${pending.agentId} lose their agent.` : undefined}
        confirmLabel="Remove agent"
        confirmTone="danger"
        confirmValue={pending?.agentId}
        busy={pending !== null && busy === `remove:${pending.agentId}`}
        error={error}
        onConfirm={() => { if (pending) void removeAgent(pending) }}
        onCancel={() => { setPending(null); setError(null) }}
      />
    </div>
  )
}
