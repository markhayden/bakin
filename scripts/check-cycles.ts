/**
 * Import-cycle ratchet (audit FW3.5). WS2 broke the 17-cycle exec-tool
 * registry cluster, but with no gate the count silently drifted back up
 * (the dispatch split + workflow engine and SDK↔app edges each added
 * runtime-only cycles). This check pins the KNOWN cycles and fails on:
 *   - any NEW cycle (fix it or — deliberately, in review — allowlist it)
 *   - any allowlist entry that no longer exists (ratchet down: remove it)
 *
 * Run: `bun run check:cycles` (wired into CI next to typecheck).
 * Known-cycle notes: the dispatch cluster and workflows engine↔node-dispatch
 * are runtime-lazy (dynamic import at call time) — tolerated, documented in
 * their modules. The SDK↔app entries are the deliberate two-repo-layer
 * arrangement (implementations live in src/, SDK re-exports; see
 * packages/sdk/src/hooks/index.ts header).
 */
import madge from 'madge'

const ENTRIES = ['server.ts', 'src/core/mcp-server.ts']

/** Canonical form: sorted members joined — order/rotation insensitive. */
const key = (cycle: string[]) => [...cycle].sort().join(' | ')

const KNOWN_CYCLES = new Set<string>([
  // SDK type-layer self-references (type-only, benign)
  key(['packages/core/src/plugin-types.ts', 'packages/core/src/docs/index.ts', 'packages/core/src/docs/route.ts']),
  key(['packages/core/src/plugin-types.ts', 'packages/core/src/routing/types.ts']),
  key(['packages/sdk/src/types/context.ts', 'packages/sdk/src/types/registration.ts']),
  key(['packages/adapter-openclaw/src/index.ts', 'packages/adapter-openclaw/src/runtime.ts']),
  // SDK ↔ app implementation layer (deliberate; audit P2 #2, re-deferred)
  key(['packages/sdk/src/hooks/index.ts', 'src/hooks/use-query-state.ts']),
  key(['packages/sdk/src/components/index.ts', 'src/components/integrated-brainstorm/index.tsx', 'src/components/integrated-brainstorm/empty-state.tsx']),
  key(['packages/sdk/src/components/index.ts', 'src/components/integrated-brainstorm/index.tsx', 'src/components/integrated-brainstorm/input-row.tsx']),
  key(['packages/sdk/src/components/index.ts', 'src/components/integrated-brainstorm/index.tsx', 'src/components/integrated-brainstorm/input-row.tsx', 'src/components/integrated-brainstorm/use-brainstorm-state.ts', 'src/components/integrated-brainstorm/thinking-indicator.tsx']),
  key(['packages/sdk/src/components/index.ts', 'src/components/integrated-brainstorm/index.tsx', 'src/components/integrated-brainstorm/message-list.tsx']),
  // Dispatch fire-core: runtime-only cycles via lazy import('./dispatch-single')
  key(['src/core/dispatch-prepare.ts', 'src/core/dispatch-turns.ts', 'src/core/dispatch-session-death.ts', 'src/core/dispatch-single.ts']),
  key(['src/core/dispatch-turns.ts', 'src/core/dispatch-session-death.ts', 'src/core/dispatch-single.ts']),
  key(['src/core/dispatch-turns.ts', 'src/core/dispatch-session-death.ts', 'src/core/dispatch-single.ts', 'src/core/dispatch-workflow.ts']),
  key(['src/core/dispatch-turns.ts', 'src/core/dispatch-session-death.ts']),
  // Assets enrichment (post-#457): engine ↔ providers, runtime-lazy
  key(['plugins/assets/lib/enrichment/engine.ts', 'plugins/assets/lib/enrichment/direct.ts']),
  key(['plugins/assets/lib/enrichment/engine.ts', 'plugins/assets/lib/enrichment/runtime.ts']),
  // Workflows engine ↔ node-dispatch: dynamic import('./engine') back-edge
  key(['plugins/workflows/lib/engine.ts', 'plugins/workflows/lib/node-dispatch.ts']),
])

const result = await madge(ENTRIES, {
  fileExtensions: ['ts', 'tsx'],
  tsConfig: 'tsconfig.app.json',
  detectiveOptions: { ts: { skipTypeImports: false }, tsx: { skipTypeImports: false } },
})

const cycles = result.circular({ tsx: true } as never) as unknown as string[][]
const found = new Map(cycles.map((c) => [key(c), c]))

const newCycles = [...found.entries()].filter(([k]) => !KNOWN_CYCLES.has(k))
const staleAllowlist = [...KNOWN_CYCLES].filter((k) => !found.has(k))

if (newCycles.length > 0) {
  console.error(`NEW import cycles (${newCycles.length}) — break the cycle, or allowlist it deliberately in scripts/check-cycles.ts:`)
  for (const [, cycle] of newCycles) console.error(`  ${cycle.join(' > ')}`)
}
if (staleAllowlist.length > 0) {
  console.error(`Stale allowlist entries (${staleAllowlist.length}) — these cycles are GONE; ratchet down by removing them:`)
  for (const k of staleAllowlist) console.error(`  ${k}`)
}
if (newCycles.length > 0 || staleAllowlist.length > 0) process.exit(1)

console.log(`check-cycles: ${cycles.length} known cycles, 0 new, allowlist current.`)
