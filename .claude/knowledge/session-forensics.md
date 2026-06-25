# Session Forensics & Death Recovery — Deep Reference

Why: the 2026-06-04 incident (task-56d382ae). A research agent drafted six
deliverables as one ~700KB chat completion; OpenClaw killed the session
(`session.ended status:"interrupted"`), the gateway never delivered a final
frame, and Bakin waited out a 630s transport timer to report the red herring
"runtime gateway request timed out" — twice, identically, because retry
reproduced the deterministic failure. This system makes that class of failure
detected in milliseconds, diagnosed precisely, recovered automatically, and
prevented by prompt discipline.

## The trajectory file (read-only forensic source)

OpenClaw writes `~/.openclaw/agents/<id>/sessions/<sessionId>.trajectory.jsonl`
(schema `openclaw-trajectory`, version 1) — a sibling of the session `.jsonl`.
One file per session, one event run per turn:

```
session.started → context.compiled → prompt.submitted
  → tool.call / tool.result (repeated)
  → model.completed   data: { assistantTexts[], usage, timedOut, aborted, promptError }
  → session.ended     data: { status: 'success'|'interrupted'|…, timedOut, promptError }
```

`assistantTexts` holds the final completion text, truncated by OpenClaw at
**262,144 bytes** — in a death this is the salvageable partial output.
Bakin NEVER writes to `~/.openclaw`; all access is read-only and lives in
`packages/adapter-openclaw/src/trajectory-forensics.ts`.

## Detection (adapter-side, two independent layers)

`runOpenClawAgentGateway()` captures the trajectory byte offset before each
turn (per-attempt scoping — a session accrues one run per turn):

1. **Fail-fast** (`watchTrajectoryForDeath`): while the gateway request is
   pending, a stat-gated 200ms poll races the RPC. The moment
   `session.ended` (non-success) lands on disk, the turn rejects with a full
   `RuntimeTurnError` diagnosis and the pending RPC is aborted (its 630s
   timer cleared). In the incident, the evidence sat on disk ~106s before
   Bakin gave up; now detection is <400ms from the event write.
   The scan is **incremental** (#434): new bytes feed a carried scanner
   (`createTrajectoryScanner`) — each line is JSON.parsed exactly once
   across the watch's lifetime instead of re-parsing the whole tail from
   the turn-start offset on every size change (which was O(delta²) over
   tool-heavy turns). The trailing partial line is buffered as raw BYTES
   (multi-byte chars split across reads decode correctly once complete);
   `finalize()` probes it against a state clone so an unterminated line is
   evaluated without being consumed. Shared low-level reads live in
   `packages/adapter-openclaw/src/file-utils.ts` (`safeFileSize`,
   `readFileFrom`/`readFileBytesFrom`) — also used by runtime.ts's
   session-activity tail.
2. **Post-mortem** (`inspectTrajectoryRun`): if the transport timer fires
   anyway or the socket drops mid-turn, the trajectory tail is inspected.
   Three verdicts: `success` → the run finished but the frame was lost, so
   the adapter RETURNS the recovered text (a lost frame is no longer a
   10-minute failure); `death` → `RuntimeTurnError`; `null` (no evidence) →
   the original error stands. Tolerant parser: malformed lines, unknown
   events, and foreign schemas degrade to null — never worse than today.

`RuntimeTurnDiagnosis` fields: reason (`session_interrupted` |
`runtime_timeout`), sessionId/status, timedOut, completionBytes,
outputTruncated (at the 262,144 limit), oversizedOutput (vs
`settings.dispatch.oversizedOutputBytes`, default 128KB, passed per-send via
`MessageArgs.metadata`), lastToolCall (from `tool.call` events), salvagedText
(capped), usage, one-line detail.

## Error typing (the boundary contract)

`packages/adapter-openclaw/src/errors.ts` is the ONE place OpenClaw error
strings are interpreted: idle-timeout patterns → `RuntimeTurnError`
(runtime_timeout); cooldown/auth strings → `provider_cooldown` with
structured `providerInfo`; everything else `runtime_failed`. Transport and
timer failures are constructed typed at their source in `gateway-rpc.ts`.
Dispatch classifies on `RuntimeError.kind` only; an architecture test keeps
`dispatch.ts` free of error-message inspection forever.

## Recovery ladder (core-side)

See `.claude/knowledge/dispatch.md` § Session-death recovery ladder for the
full mechanics. Summary: salvage → immediate corrective re-dispatch →
decomposition into chained subtasks → block with an actionable diagnosis.
Salvaged output is written to `~/.bakin/tasks/salvage/<taskId>-d<seq>.md` and
persisted via the `assets.saveFromSource` hook (tag `salvaged-output`) so the
partial work is never lost and the corrective prompt can point at it.

## Per-attempt sessions

`threadId = task:<taskId>:d<seq>` (steps: `task:<id>:step:<stepId>:d<seq>`)
gives every dispatch attempt a fresh, deterministic provider session:
- forensics knows exactly which trajectory to watch,
- context can't accumulate across tasks (the incident sessions carried every
  prior task's history),
- a corrective attempt never replays the dead context,
- `MessageResult.metadata.sessionId` correlates the attempt with usage/audit,
- the gateway idempotency key `bakin:<threadId>` is stable per logical turn.

Session-store (`sessions.json`) reads are mtime-cached in the adapter since
per-dispatch sessions accumulate entries. OpenClaw-side retention exists as
of 2026.6.5 (#435 close-out): `session.maintenance` defaults to
`mode: enforce`, `pruneAfter: 30d`, `maxEntries: 500`, and maintenance runs
on session-store **writes** and via `openclaw sessions cleanup --enforce` —
never on gateway startup/reads. Unreferenced transcript/trajectory artifacts
are only GC'd past a 30-day cutoff, and disk-budget eviction requires
opting into `session.maintenance.maxDiskBytes`. The health plugin's
`session-store` doctor check (`plugins/health/lib/system-checks/
session-store.ts`, fed by the read-only `runtime.sessions.storeStats()`
adapter capability) is the early warning when accumulation outruns
maintenance.

## Observability

- Audit kinds: `task.runtime_session_died` (every death, full structured
  payload), `task.corrective_redispatch`, `task.decomposition_dispatched`,
  `task.runtime_failed_blocked` (terminal, with diagnosis). Query via
  `queryAuditEvents()` in `src/core/audit.ts`.
- Doctor: tasks plugin check `session-death-incidents` warns on any death in
  the last 24h with task/agent/size details.
- Task log entries carry the structured diagnosis under
  `entry.data.sessionDeath`.

## Testing

- Parser/watcher units: `tests/adapter-openclaw/trajectory-forensics.test.ts`
- Adapter integration (FakeWebSocket): `tests/adapter-openclaw/runtime-stream.test.ts`
- Ladder: `tests/core/dispatch-session-death.test.ts`
- Concurrency: `tests/core/dispatch-concurrency.test.ts`
- E2E via mock gateway: `tests/dev/mock-session-death.test.ts`

Imitation-crab chat modes for manual testing (`bun run dev:mock` +
`OPENCLAW_MOCK_CHAT_MODE`): `session-death` (writes an incident-shaped
trajectory, never finalizes), `idle-timeout`, `slow`
(`OPENCLAW_MOCK_CHAT_DELAY_MS`).
