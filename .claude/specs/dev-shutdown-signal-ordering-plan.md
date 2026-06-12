# Plan: Dev Shutdown Signal Ordering (#459, defect 1)

## Context

Killing `bun run dev` orphans the antfly child on `:3738`. Root cause: `scripts/dev.ts` `registerShutdown()` (scripts/dev.ts:490-497) registers SIGINT/SIGTERM handlers **before** `await import('../server')`, and those handlers call `process.exit(0)` synchronously. Signal listeners run in registration order, so the real async shutdown chain in `src/core/lifecycle.ts:89-96` (plugins → dispatch/watchdog/doctor → watcher → `search.shutdown()` which stops antfly → SSE → HTTP → audit → ledger → server lock) never executes. Overlapping half-dead generations then cause phantom UI behavior.

This is the last open defect on issue #459 — defect 2 (EADDRINUSE) + the singleton lock merged in PR #465; the adapter `process.on('exit')` antfly kill + watcher ignore belong to PR #457 (still open, must not be duplicated).

Spec: `.claude/specs/dev-shutdown-signal-ordering.md` (approved). Confirmed design decisions:
1. **listenerCount detection** — dev handler always kills tailwind; only calls `process.exit(0)` when `process.listenerCount(signal) <= 1` (i.e. lifecycle handlers not yet registered — build phase). Otherwise falls through so lifecycle's later-registered listener runs the full chain.
2. **Second-signal escape hatch** — repeated SIGINT/SIGTERM (shared counter) logs a warning and `process.exit(130)` so a hung graceful shutdown is never unkillable.
3. **DI extraction for testability** — new `scripts/dev-shutdown.ts` with injected process-like object, following the `scripts/dev-log-classifier.ts` → `tests/scripts/dev-log-classifier.test.ts` pattern (dev.ts has top-level side effects and can't be imported in tests).

No changes to `src/core/lifecycle.ts`, `server.ts`, or `packages/adapter-antfly/`.

## Tasks

### Task 1 — `scripts/dev-shutdown.ts` + unit tests (commit 1)

New module:

```ts
export interface DevShutdownDeps {
  proc: Pick<NodeJS.Process, 'on' | 'listenerCount' | 'exit'>
  killTailwind: () => void
  warn: (message: string) => void
}

export function registerDevShutdown(deps: DevShutdownDeps): void
```

Behavior:
- Registers SIGINT + SIGTERM handlers and an `exit` handler (`killTailwind`) on `deps.proc`.
- On first signal: `killTailwind()`; then `if (proc.listenerCount(signal) <= 1) proc.exit(0)` — else fall through (lifecycle owns exit).
- On second signal (shared count across both signals): `warn(...)` + `proc.exit(130)`.

TDD: write `tests/scripts/dev-shutdown.test.ts` first against a fake proc (EventEmitter-based; never emit real signals on the test process). Cases:
1. Solo listener → tailwind killed, `exit(0)`.
2. Second listener present on the signal → tailwind killed, NO exit call.
3. Second signal (SIGINT then SIGINT, and SIGINT then SIGTERM) → warn + `exit(130)`.
4. `exit` event handler registered → killTailwind invoked.

Pure logic module, no app imports → no content-dir/OpenClaw mocks needed (matches other tests in `tests/scripts/`).

Verify: `bun test tests/scripts/dev-shutdown.test.ts --isolate` green.

Commit: `feat(dev): add dev-shutdown module deferring to lifecycle handlers` — pure addition, dev.ts untouched, safe rollback point.

### Task 2 — wire `scripts/dev.ts` (commit 2)

Replace `registerShutdown()` (scripts/dev.ts:490-497) with a call to `registerDevShutdown({ proc: process, killTailwind, warn: (m) => devLog('warn', 'dev', m) })`, where `killTailwind` is the existing tailwind kill (`if (tailwindChild && !tailwindChild.killed) tailwindChild.kill('SIGTERM')`). Import per repo import-order convention (relative, alongside `./dev-build-one-plugin`). Keep the call at the top of `main()`.

Verify: `bun run test` (full suite) green; typecheck via the suite/build.

Commit: `fix(dev): stop preempting lifecycle shutdown on SIGINT/SIGTERM (#459)` — the behavior change, isolated.

### Task 3 — manual end-to-end verification (checkpoint, no commit)

Acceptance criteria from the spec, against real `bun run dev`:
1. Wait for ready → `kill -TERM <pid>` → lifecycle shutdown logs appear, exit 0, `lsof -nP -iTCP:3738 -sTCP:LISTEN` empty (antfly stopped), `lsof -nP -iTCP:3737 -sTCP:LISTEN` empty.
2. Ctrl+C/SIGINT during initial build phase → prompt exit, tailwind child gone.
3. (Best-effort) second signal during graceful shutdown → warn + exit 130.

Note: requires the real `~/.bakin` dev environment on this machine (dev.ts runs the server in-process; this is the machine's normal dev loop).

### Task 4 — docs (commit 3)

- Add a short **Shutdown** section to `.claude/knowledge/dev-loop.md`: dev handler owns exit only during the build phase; defers to lifecycle once `registerShutdownHandlers()` runs; second signal forces exit 130; tailwind killed on every JS exit via the `exit` hook; antfly stop happens inside lifecycle's `search.shutdown()`.
- Copy the approved plan to `.claude/specs/dev-shutdown-signal-ordering-plan.md` per repo spec/plan convention.
- README / CLAUDE.md: no changes needed (internal dev tooling; CLAUDE.md already links dev-loop.md).

Commit: `docs(dev): document dev-loop shutdown semantics`

### Task 5 — review + ship

- `/agent-skills:test` pass for coverage check, then five-axis review of the diff.
- Push branch `fix/dev-shutdown-signal-ordering`, open PR referencing #459 (closes the remaining defect; note PR #465 shipped the server half).

## Dependency order

Task 1 → Task 2 → Task 3 (verify) → Task 4 → Task 5. Strictly linear; each commit is a rollback checkpoint.

## Verification summary

- Unit: `bun test tests/scripts/dev-shutdown.test.ts --isolate`
- Suite: `bun run test`
- Manual: issue repro (SIGTERM after ready → port 3738 free; SIGINT during builds; double-signal force exit)
