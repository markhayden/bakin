/**
 * Memory cleanup — pure core.
 *
 * The cleanup feature finds where a term (e.g. an old product name) appears
 * across memory tiers and dispatches a cleanup task to each affected agent so
 * the agent edits its OWN source files. Bakin never writes runtime memory.
 *
 * This module is the pure, testable core: exact-match detection (semantic
 * ranking alone isn't faithful for a literal scrub), tier labeling, snippet
 * extraction, and grouping search hits by agent. Route wiring lives in
 * routes/cleanup.ts.
 */
import type { MemoryTier } from './types'

/**
 * Tiers whose source the owning agent can edit directly (markdown docs the
 * harness re-reads every session). The append-only OpenClaw streams
 * (session/turn/checkpoint) and Bakin's own audit log are informational only —
 * they self-heal / age out and we never rewrite them.
 */
export const ACTIONABLE_TIERS: ReadonlySet<MemoryTier> = new Set<MemoryTier>([
  'durable',
  'daily_note',
  'dream',
])

export type CleanupLabel = 'actionable' | 'informational'

export function tierLabel(tier: MemoryTier): CleanupLabel {
  return ACTIONABLE_TIERS.has(tier) ? 'actionable' : 'informational'
}

/** Case-insensitive substring match — the literal test for a true occurrence. */
export function contentMatches(content: string, term: string): boolean {
  if (!term) return false
  return content.toLowerCase().includes(term.toLowerCase())
}

const MAX_SNIPPET_LEN = 160

/** Trimmed line if short; otherwise a windowed slice around the match (long
 * single-line / JSON content shouldn't dump whole). */
function windowAround(line: string, needleLower: string): string {
  const trimmed = line.trim()
  if (trimmed.length <= MAX_SNIPPET_LEN) return trimmed
  const i = trimmed.toLowerCase().indexOf(needleLower)
  const start = Math.max(0, i - 40)
  const end = Math.min(trimmed.length, i + needleLower.length + 40)
  return (start > 0 ? '…' : '') + trimmed.slice(start, end).trim() + (end < trimmed.length ? '…' : '')
}

/** Extract up to `maxLines` bounded snippets containing the term, for display. */
export function matchingSnippets(content: string, term: string, maxLines = 3): string[] {
  if (!term) return []
  const needle = term.toLowerCase()
  const out: string[] = []
  for (const line of content.split('\n')) {
    if (line.toLowerCase().includes(needle)) {
      out.push(windowAround(line, needle))
      if (out.length >= maxLines) break
    }
  }
  return out
}

export interface CleanupHit {
  rowId: string
  tier: MemoryTier
  agent: string
  sourcePath: string
  label: CleanupLabel
  snippets: string[]
  /** True when the source is an agent-package projection (`<file>.installedBy`
   * present) — its edit can revert on template refresh unless `.userEdited` is set. */
  managed?: boolean
}

export interface AgentCleanupGroup {
  agent: string
  hits: CleanupHit[]
  actionableCount: number
}

export type CleanupAction = 'replace' | 'remove'

export interface ComposeTaskInput {
  term: string
  action: CleanupAction
  replacement?: string
  agent: string
  /** Actionable hits for this agent (the files the agent will edit). */
  hits: CleanupHit[]
  /** Optional operator override of the default instruction lead. */
  instruction?: string
}

/**
 * Build the title + description for the cleanup task dispatched to one agent.
 * The agent edits its own source files; this gives it the exact locations +
 * a clear instruction. Pure.
 */
export function composeTask(input: ComposeTaskInput): { title: string; description: string } {
  const { term, action, replacement, hits, instruction } = input
  const title =
    action === 'replace'
      ? `Memory cleanup: rename "${term}" → "${replacement ?? ''}"`
      : `Memory cleanup: remove references to "${term}"`

  const lead =
    instruction ??
    (action === 'replace'
      ? `Replace every reference to "${term}" with "${replacement ?? ''}" in the memory files listed below. Keep everything else intact.`
      : `Remove the references to "${term}" from the memory files listed below — delete the offending text; keep the rest intact.`)

  const findings = hits
    .map((h) => {
      const snips = h.snippets.map((s) => `    > ${s}`).join('\n')
      return `- ${h.sourcePath}${snips ? `\n${snips}` : ''}`
    })
    .join('\n')

  const description = [
    lead,
    '',
    'Files to edit:',
    findings,
    '',
    `When done, confirm "${term}" no longer appears in those files.`,
  ].join('\n')

  return { title, description }
}

/** Group hits by agent, count actionable ones, sort most-actionable first. */
export function groupByAgent(hits: CleanupHit[]): AgentCleanupGroup[] {
  const byAgent = new Map<string, CleanupHit[]>()
  for (const h of hits) {
    const arr = byAgent.get(h.agent) ?? []
    arr.push(h)
    byAgent.set(h.agent, arr)
  }
  const groups: AgentCleanupGroup[] = []
  for (const [agent, agentHits] of byAgent) {
    groups.push({
      agent,
      hits: agentHits,
      actionableCount: agentHits.filter((h) => h.label === 'actionable').length,
    })
  }
  groups.sort(
    (a, b) =>
      b.actionableCount - a.actionableCount ||
      b.hits.length - a.hits.length ||
      a.agent.localeCompare(b.agent),
  )
  return groups
}
