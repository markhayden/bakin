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
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PluginLink, useQueryState } from '@makinbakin/sdk/navigation'
import { ConfirmDialog, ListRow, ListRowGroup, ListRows } from '@makinbakin/sdk/patterns'
import { Banner, Button, Text, buttonVariants } from '@makinbakin/sdk/ui'

const ROSTER_CHECK_ID = 'team.agent-roster'

interface ReportLike {
  observations: Array<{ id: string; checkId?: string; summary: string; evidence?: Record<string, unknown> }>
}

export type RosterProblem =
  | { kind: 'duplicate'; agentId: string; positions: number[]; names: string[]; summary: string }
  | { kind: 'missing-id'; rosterIndex: number; name?: string; workspace?: string; summary: string }

function asNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number') : []
}
function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
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
        summary: observation.summary,
      })
    }
  }
  return problems
}

async function readProblems(signal: AbortSignal): Promise<RosterProblem[]> {
  const res = await fetch('/api/plugins/health/doctor', { signal })
  if (!res.ok) return []
  return rosterProblemsFrom(await res.json() as ReportLike)
}

/** Targeted rerun of the roster check — the return verification for every control on this panel. */
async function recheckRoster(): Promise<void> {
  await fetch('/api/plugins/health/doctor/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkIds: [ROSTER_CHECK_ID] }),
  }).catch(() => null)
}

export function useRosterProblems(): { problems: RosterProblem[] | null; refresh: () => Promise<void> } {
  const [problems, setProblems] = useState<RosterProblem[] | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const mine = ++generation.current
    const controller = new AbortController()
    try {
      const next = await readProblems(controller.signal)
      if (mine === generation.current) setProblems(next)
    } catch {
      if (mine === generation.current) setProblems([])
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { problems, refresh }
}

const positionList = (positions: number[]) => positions.map((index) => index + 1).join(', ')

export function RosterRecoverPanel({ onDismiss, onChanged }: { onDismiss: () => void; onChanged?: () => void }) {
  const { problems, refresh } = useRosterProblems()
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
    try {
      await recheckRoster()
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
      await recheckRoster()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [onChanged, refresh])

  if (problems === null) return null
  const dismiss = <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
  if (problems.length === 0) {
    return <Banner tone="success" title="The roster is consistent" description="Every runtime agent has one stable id." action={dismiss} data-testid="roster-recover-panel" />
  }

  const isHighlighted = (problem: RosterProblem) => problem.kind === 'duplicate'
    ? agentParam !== '' && problem.agentId === agentParam
    : entryParam !== '' && String(problem.rosterIndex) === entryParam

  return (
    <div data-testid="roster-recover-panel" className="grid gap-bakin-3">
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
                        No runtime surface names an entry by position, so Bakin cannot assign the id for you: give the entry an id in the runtime's registry, then recheck.
                      </Text>
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
