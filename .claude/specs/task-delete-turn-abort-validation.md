# Validation Report: Task Delete → Abort In-Flight Turn (#604)

**Date:** 2026-07-05 · **Branch:** `feat/task-delete-turn-abort` @ 50e02169 (T1–T7 complete)
**Environment:** live OpenClaw **2026.6.11** (upgraded from 2026.6.9 during this effort per spec action), real gateway on loopback; validation Bakin instance on **PORT=3799** with a throwaway `BAKIN_HOME` (production server on 3737 untouched; `OPENCLAW_HOME` NOT set, per the home-doubling gotcha).

## Procedure

1. Booted the branch build against the throwaway home; verified boot + REST + dispatch loop.
2. Created task `61cf866e` ("write a 300-word note on tide pool ecosystems…"), triggered `POST /api/dispatch` — dispatched to `main`, `threadId task:61cf866e:d1`, turn live on the real gateway (20:16:58).
3. `DELETE /api/plugins/tasks/61cf866e` ~17s into the turn (20:17:15).

## Results — all pass

| Check | Evidence |
|---|---|
| Delete responds instantly | `{"ok":true}` in **33ms** |
| In-flight turn aborted locally | `dispatch-turns` log "Aborted in-flight turn(s)" + "turn aborted" settle at **20:17:15.254 — the same millisecond as the delete** (not the turn's natural end) |
| Audit trail | `task.turn_aborted {id: 61cf866e, runId: task:61cf866e:d1, reason: task-deleted}` in audit.jsonl |
| No recovery ladder / reconcile noise | zero `task.dispatch_failed*` / ladder events after the abort |
| Slot freed | registry emptied at settle; no `agent_busy` deferral, no `task.turn_force_released` (sweep never needed) |
| Ledger purge | `SELECT COUNT(*) FROM runs WHERE task_id='61cf866e'` → **0** |
| Ghost-turn residual (documented re-scope) | The OpenClaw-side run continued (~1 min); its MCP calls failed closed (`bakin_exec_tasks_get.fail: Task not found`, `tasks_assign.fail`) and the agent gave up at 20:18:16 — the exact bounded fallback the spec accepts |
| Production isolation | 0 references to `61cf866e` in production `~/.bakin/audit.jsonl`; live server on 3737 untouched throughout |

## Spec risk items closed

- **Risk 1 (chat.abort key form):** resolved in T2 live probes — the canonical `agent:<id>:explicit:<uuid>` key is what the gateway uses for explicit sessions; the frame is accepted (`ok:true`).
- **Risk 2 (backend-mode abort):** confirmed NOT server-side abortable on 2026.6.11 (chat.abort/sessions.abort registries track channel auto-reply runs only; `/stop` queues behind the active run; `tasks.cancel` is registry-intent-only). This is the re-scoped, documented residual: local settle is the load-bearing fix, and this run demonstrates the ghost turn is short-lived and harmless once every tool fails closed.
- **Risks 3/4 (races):** pinned by unit tests (abort-after-settle no-op; sweep catches delete-vs-register).

## Comparison to the original incident (2026-07-04, task df6cba8d)

| | Before | After |
|---|---|---|
| Agent dispatch slot | held ~10 min (unbounded if hung) | freed in the same millisecond as the delete |
| Watchdog visibility | invisible (board-scoped) | registry sweep + force-release after 60s grace |
| Audit | fail-noise only | structured `task.turn_aborted` |
| `bakin_exec_get_step` | false ok/complete | fails closed (unit-pinned; instance file also deleted by the unified path) |
| Session end | error on `submit_step` | agent stops within ~1 min as tools fail closed |

## Verdict

Ship it. The deadlock class (ghost turn holding the agent slot, invisible to recovery) is eliminated; every delete entry point converges on the canonical cascade; residual server-side spend is bounded and documented, pending upstream OpenClaw abort support for backend `agent` RPC runs (worth filing upstream).
