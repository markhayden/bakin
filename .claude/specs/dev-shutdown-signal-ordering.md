# Dev Shutdown Signal Ordering (#459, defect 1)

**Issue:** [#459](https://github.com/markhayden/bakin/issues/459) — Dev loop leaves orphaned processes.
**Scope:** Defect 1 only. Defect 2 (unhandled EADDRINUSE) and the server singleton lock shipped in PR #465. The adapter-side `process.on('exit')` antfly kill and the `antfly/` watcher ignore belong to PR #457 (antfly-zig migration, still open) and MUST NOT be duplicated here.

## Objective

Killing `bun run dev` with SIGINT/SIGTERM must run the server's full graceful-shutdown chain (`src/core/lifecycle.ts` — plugins → dispatch/watchdog/doctor → watcher → `search.shutdown()` → SSE → HTTP → audit → ledger → server lock) so the antfly child on `:3738` is stopped, not orphaned.

### Root cause

`scripts/dev.ts` `registerShutdown()` registers SIGINT/SIGTERM handlers **before** `await import('../server')`. Node/Bun run signal listeners in registration order; dev.ts's handler calls `process.exit(0)` synchronously, so `lifecycle.ts`'s async `shutdown()` (registered later on the same signals) never executes. The antfly child survives parent death and squats `127.0.0.1:3738`; overlapping half-dead generations produce phantom UI behavior.

## Design (decisions confirmed 2026-06-11)

1. **Detection — `listenerCount` check.** Inside the dev signal handler: kill tailwind, then `if (process.listenerCount(signal) <= 1) process.exit(0)`. Before server boot completes, dev.ts is the only listener and owns the exit (builds phase, Ctrl+C must still work). After `lifecycle.registerShutdownHandlers()` runs, the count is 2 and dev.ts falls through — the lifecycle listener runs the full graceful chain and exits. Self-contained in dev.ts; no lifecycle.ts changes; verified only these two registrants exist in the `bun run dev` process (imitation-crab and `cli/bakin.ts` handlers are separate processes).

2. **Escape hatch — second signal forces exit.** A repeated SIGINT/SIGTERM (shared counter across both signals) logs a warning and calls `process.exit(130)` immediately. Without it, a hung graceful chain (stalled plugin `shutdownAll()`, wedged antfly kill) makes `bun run dev` unkillable at the terminal — strictly worse UX than today's instant exit. The force path does NOT touch antfly directly (dev.ts importing the adapter would violate the adapter boundary); in the pathological hung case antfly may orphan — no worse than current behavior, and PR #457's exit hook covers it.

3. **Testability — extract with dependency injection.** New `scripts/dev-shutdown.ts` exporting `registerDevShutdown(deps)` where `deps` injects a process-like object (`on`/`listenerCount`/`exit`), a `killTailwind` callback, and a `warn` logger. `dev.ts` calls it with the real `process`. Tests use a fake emitter — emitting real SIGINT on the test process would kill the runner. Matches the established `scripts/dev-log-classifier.ts` → `tests/scripts/dev-log-classifier.test.ts` extraction pattern.

4. **The `process.on('exit')` tailwind cleanup stays** — it covers every JS-level exit path regardless of who calls `process.exit`.

## Acceptance criteria

1. `bun run dev`, wait for ready, `kill -TERM <pid>` → server logs the lifecycle shutdown chain, process exits 0, and `lsof -nP -iTCP:3738 -sTCP:LISTEN` is empty (antfly stopped). Same for Ctrl+C (SIGINT).
2. SIGINT during the initial build phase (before the server import) still exits promptly and kills the tailwind child.
3. A second SIGINT/SIGTERM while a graceful shutdown is in flight forces exit 130 with a logged warning.
4. Unit tests in `tests/scripts/dev-shutdown.test.ts` cover: solo-listener exit(0); defer when a second listener is present; tailwind killed on both paths; second-signal force exit(130); `exit`-hook cleanup registration.
5. Full suite (`bun run test`) passes.

## Out of scope / known gaps

- **Boot-window gap:** a signal arriving after antfly is spawned but before `registerShutdownHandlers()` (end of `server.ts` `main()`) exits via dev.ts's own path and can orphan antfly. Accepted by the issue; PR #457's sync adapter exit hook is the cover. No server.ts changes here.
- **Defect 3 (watcher deadlock):** no JS handler can run in a deadlocked process; fixed on the #457 branch (`shouldIgnoreContentWatcherPath` ignores `antfly/`).
- No changes to `src/core/lifecycle.ts`, `server.ts`, or `packages/adapter-antfly/`.

## Testing strategy

- TDD: write `tests/scripts/dev-shutdown.test.ts` against the new module first, then wire `scripts/dev.ts`.
- Pure logic module — no filesystem, no content-dir mocks needed (no app imports). Logger is injected, not the app logger.
- Manual verification: the repro from the issue (acceptance criteria 1–3) against a real `bun run dev`.

## Commit strategy (rollback checkpoints)

Branch `fix/dev-shutdown-signal-ordering` off `main`:

1. `feat(dev): add dev-shutdown module deferring to lifecycle handlers` — new `scripts/dev-shutdown.ts` + `tests/scripts/dev-shutdown.test.ts`. Pure addition; dev.ts untouched; safe to revert.
2. `fix(dev): stop preempting lifecycle shutdown on SIGINT/SIGTERM (#459)` — `scripts/dev.ts` replaces `registerShutdown()` with `registerDevShutdown(...)`. The behavior change, isolated for rollback.
3. `docs(dev): document dev-loop shutdown semantics` — add a Shutdown section to `.claude/knowledge/dev-loop.md`.

## Documentation impact

- `.claude/knowledge/dev-loop.md`: new short section on shutdown ordering (dev handler defers to lifecycle once registered; second signal forces exit).
- README / CLAUDE.md: unaffected (internal dev tooling; CLAUDE.md already points at dev-loop.md).
