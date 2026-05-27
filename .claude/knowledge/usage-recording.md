# Usage Recording — Deep Reference

All MCP tool calls, REST requests, and agent lifecycle events flow through **one** in-memory recorder in `src/core/usage.ts`. The previous fragmentation (`request-log.ts` + `toolStats` in registry.ts) caused the health dashboard to show zeros while real traffic was flowing — that incident is the reason this is a single source of truth.

**Never add a parallel stat-tracking system.** The health plugin's `/usage-feed` route and the tabbed Usage section on the health page are the only consumers you should add to.

## Writing

```ts
recordUsage({ kind, name, agent, durationMs, status, meta })
```

| Field | Values |
|---|---|
| `kind` | `'mcp' \| 'rest' \| 'agent'` |
| `name` | tool name / route path / event name |
| `agent` | optional agent id |
| `durationMs` | numeric |
| `status` | `'ok' \| 'error'` |
| `meta` | free-form record for extra context |

The ring buffer holds 10 000 entries, FIFO-evicted.

## Runtime session usage

Health's context and cost cards do **not** come from the in-memory usage recorder above. They are derived from runtime session JSONL entries via `src/core/agent-usage.ts`, then served by `plugins/health` at `/usage`.

- Token fields (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`) are summed from assistant messages in each agent's latest session.
- Cost fields are runtime-reported only. Bakin does not map model ids to pricing tables for Health.
- Missing runtime cost is represented as unavailable, not `$0.00`.
- Historical token/cost aggregation across multiple sessions is separate follow-up work; the current Health card is latest-session scoped.

## Reading

| API | Use |
|---|---|
| `getUsageFeed({ kind?, window, agent? })` | Top-N / by-agent / recent aggregation |
| `getStatsByMs({ kind?, windowMs, agent? })` | Total + error counts (used by watchdog) |
| `getErrorCount(windowMs)` | Errors tile on `/summary` |

Windows: `'5m' | '1h' | '24h'`.

## Auto-recording sites

- **MCP** — `src/core/mcp-server.ts:registerTools` records every tool call.
- **REST** — `trackResponse` middleware in `src/core/rest-tracking.ts` records every response.
- **Agent** — dispatch / heartbeat / lifecycle modules emit `kind: 'agent'` entries.

Manual `recordUsage` calls are only needed for new flows that aren't covered by the three auto-recorders above.
