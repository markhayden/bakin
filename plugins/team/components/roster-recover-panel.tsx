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
 * Evidence states stay apart (Codex r2 #10 / r3 #2): findings; verified-empty
 * (the roster check OBSERVED, its inspection SUCCEEDED — no unknown row, no
 * last-known row — and found nothing); UNVERIFIED (the check has not
 * reported, or could not inspect the roster); UNAVAILABLE (the report could
 * not be read — the last known rows stay, never "consistent"); STALE (a later
 * refresh failed — the last known state is shown as such, even "empty").
 *
 * Return verification (Codex r3 #5): a copied registry command ARMS one
 * targeted rerun of the roster check (`POST /doctor/run`) that fires when
 * the window regains focus or the tab becomes visible, then re-reads.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PluginLink, useQueryState } from '@makinbakin/sdk/navigation'
import { ConfirmDialog, HandoffCard, ListRow, ListRowGroup, ListRows } from '@makinbakin/sdk/patterns'
import { Banner, Button, Text, buttonVariants } from '@makinbakin/sdk/ui'

const ROSTER_CHECK_ID = 'team.agent-roster'

interface ReportLike {
  checks?: Array<{ checkId: string; latestExecution?: { outcome?: string } }>
  observations: Array<{ id: string; checkId?: string; status?: string; snapshot?: string; summary: string; evidence?: Record<string, unknown> }>
}

export type RosterVerification =
  | { verified: true }
  | { verified: false; gap: 'not-observed' | 'could-not-inspect' | 'stale' }

/**
 * Verified = the roster check OBSERVED in this report AND that inspection
 * succeeded: no `unknown` row (an unreadable roster is an observed unknown
 * observation, row 105) and no last-known row (stale evidence). Only then is
 * an empty finding list "consistent".
 */
export function rosterVerification(report: ReportLike): RosterVerification {
  const observed = (report.checks ?? []).some((check) => check.checkId === ROSTER_CHECK_ID && check.latestExecution?.outcome === 'observed')
  if (!observed) return { verified: false, gap: 'not-observed' }
  const rows = report.observations.filter((o) => (o.checkId ?? o.id.split(':')[0]) === ROSTER_CHECK_ID)
  if (rows.some((o) => o.status === 'unknown' || o.status === 'error')) return { verified: false, gap: 'could-not-inspect' }
  if (rows.length === 0 || rows.some((o) => o.snapshot === 'last_known')) return { verified: false, gap: 'stale' }
  return { verified: true }
}

/** Kept for callers that only need the boolean. */
export function rosterVerified(report: ReportLike): boolean {
  return rosterVerification(report).verified
}

export type RosterProblem =
  | { kind: 'duplicate'; agentId: string; positions: number[]; names: string[]; removable: boolean; registry?: { path: string; entryKeys: string[] }; summary: string }
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
/** The registry location of a duplicate (every entry key). */
function duplicateRegistryOf(value: unknown): { path: string; entryKeys: string[] } | null {
  if (!value || typeof value !== 'object') return null
  const { path, entryKeys } = value as { path?: unknown; entryKeys?: unknown }
  const keys = asStrings(entryKeys)
  return typeof path === 'string' && path !== '' && keys.length > 0 ? { path, entryKeys: keys } : null
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
      const registry = duplicateRegistryOf(evidence.registry)
      problems.push({
        kind: 'duplicate', agentId: evidence.agentId, positions: asNumbers(evidence.positions), names: asStrings(evidence.names),
        removable: evidence.removable !== false,
        ...(registry ? { registry } : {}),
        summary: observation.summary,
      })
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
  | { status: 'ok'; problems: RosterProblem[]; verification: RosterVerification }
  | { status: 'error'; message: string }

async function readProblems(signal: AbortSignal): Promise<ProblemsRead> {
  const res = await fetch('/api/plugins/health/doctor', { signal })
  if (!res.ok) return { status: 'error', message: `Health could not be read (${res.status}).` }
  const report = await res.json() as ReportLike
  return { status: 'ok', problems: rosterProblemsFrom(report), verification: rosterVerification(report) }
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
  /** Whether the roster check inspected the roster successfully in the current report (and why not). */
  verification: RosterVerification
  /** The latest read failed (the rows, if any, are the last known ones). */
  error: string | null
  refresh: () => Promise<void>
}

export function useRosterProblems(): RosterProblemsState {
  const [state, setState] = useState<{ problems: RosterProblem[] | null; verification: RosterVerification; error: string | null }>({ problems: null, verification: { verified: false, gap: 'not-observed' }, error: null })
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++generation.current
    const controller = new AbortController()
    try {
      const next = await readProblems(controller.signal)
      if (mine !== generation.current) return
      if (next.status === 'ok') setState({ problems: next.problems, verification: next.verification, error: null })
      else setState((previous) => ({ ...previous, error: next.message }))
    } catch (err) {
      if (mine === generation.current) setState((previous) => ({ ...previous, error: `Health could not be read: ${err instanceof Error ? err.message : String(err)}` }))
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { ...state, refresh }
}

const positionList = (positions: number[]) => positions.map((index) => index + 1).join(', ')

const GAP_COPY: Record<Exclude<RosterVerification, { verified: true }>['gap'], { title: string; description: string }> = {
  'not-observed': { title: 'Health has not verified the roster yet', description: 'The roster check has not reported in the current Health report, so nothing here is confirmed. Recheck the roster to find out.' },
  'could-not-inspect': { title: 'Health could not inspect the roster', description: 'The roster check ran but could not read the runtime roster, so nothing here is confirmed consistent. Recheck once the runtime answers.' },
  'stale': { title: 'Health has only stale roster evidence', description: 'The roster check\'s latest rows are last-known, not current, so nothing here is confirmed. Recheck the roster to find out.' },
}

export function RosterRecoverPanel({ onDismiss, onChanged }: { onDismiss: () => void; onChanged?: () => void }) {
  const { problems, verification, error: readError, refresh } = useRosterProblems()
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

  // Return verification (Codex r3 #5): a copied registry command arms ONE
  // targeted recheck that fires when the operator comes back to this window.
  const handoffArmed = useRef(false)
  const armHandoffReturn = useCallback(() => { handoffArmed.current = true }, [])
  useEffect(() => {
    const fire = () => {
      if (!handoffArmed.current) return
      handoffArmed.current = false
      void recheck()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') fire() }
    window.addEventListener('focus', fire)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', fire)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [recheck])

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
    if (readError) {
      // A later refresh failed: the last known state was "nothing found" — shown as last known, never as verified now.
      return (
        <Banner
          tone="danger"
          title="The latest refresh failed"
          description={`${readError} The last roster findings Health reported were none${verification.verified ? '' : ' (unverified)'}; nothing is confirmed until it reads again.`}
          action={<span className="flex gap-bakin-2">{retry}{dismiss}</span>}
          data-testid="roster-recover-panel"
          data-evidence="stale"
        />
      )
    }
    if (!verification.verified) {
      const copy = GAP_COPY[verification.gap]
      return (
        <Banner
          tone="attention"
          title={copy.title}
          description={copy.description}
          action={<span className="flex gap-bakin-2"><Button variant="outline" size="sm" busy={busy === 'recheck'} disabled={busy !== null} onClick={() => { void recheck() }}>Recheck roster</Button>{dismiss}</span>}
          data-testid="roster-recover-panel"
          data-evidence="unverified"
          data-gap={verification.gap}
        />
      )
    }
    return (
      <Banner
        tone="success"
        title="The roster is consistent"
        description="Every runtime agent has one stable id."
        action={<span className="flex gap-bakin-2"><Button variant="ghost" size="sm" busy={busy === 'recheck'} disabled={busy !== null} onClick={() => { void recheck() }}>Recheck roster</Button>{dismiss}</span>}
        data-testid="roster-recover-panel"
        data-evidence="verified-empty"
      />
    )
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
                        {problem.removable
                          ? <>The runtime addresses agents by id, so Bakin cannot remove ONE of these entries: removing the agent removes every entry named {problem.agentId} and moves its workspace to the trash.</>
                          : <>{problem.agentId} is the main agent, so it cannot be removed. {problem.registry ? <>Edit the entries <code className="font-bakin-typography-family-mono">{problem.registry.entryKeys.join(' / ')}</code> so one keeps the id, save, then recheck.</> : <>The runtime names no registry location, so the entries must be fixed where the runtime keeps its roster, then rechecked.</>}</>}
                      </Text>
                      {problem.registry ? (
                        <HandoffCard
                          className="mt-bakin-2"
                          headingLevel={4}
                          title={`Edit the roster entries for ${problem.agentId}`}
                          description={<>Opens the runtime's registry in your editor; the entries are <code className="font-bakin-typography-family-mono">{problem.registry.entryKeys.join(' / ')}</code>. Copy the command and come back — the roster check reruns when this window regains focus.</>}
                          command={registryEditCommand(problem.registry.path)}
                          onCopied={armHandoffReturn}
                        />
                      ) : null}
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
                          description={<>Opens the runtime's registry in your editor; the entry is <code className="font-bakin-typography-family-mono">{problem.registry.entryKey}</code>. Copy the command and come back — the roster check reruns when this window regains focus.</>}
                          command={registryEditCommand(problem.registry.path)}
                          onCopied={armHandoffReturn}
                        />
                      ) : null}
                    </>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-bakin-2">
                  {problem.kind === 'duplicate' ? (
                    <>
                      <PluginLink to={`/team/${encodeURIComponent(problem.agentId)}`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>Open {problem.agentId}</PluginLink>
                      {problem.removable ? (
                        <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => { setError(null); setPending(problem) }}>
                          Remove {problem.agentId} entirely
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" busy={busy === 'recheck'} disabled={busy !== null} onClick={() => { void recheck() }}>Recheck roster</Button>
                      )}
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
