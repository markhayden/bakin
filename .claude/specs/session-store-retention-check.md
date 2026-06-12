# Session-Store Retention Check (#435 close-out)

**Issue:** https://github.com/markhayden/bakin/issues/435
**Status:** Spec approved — see companion `session-store-retention-check-plan.md`
**Date:** 2026-06-11

## 1. Objective

Close out the remaining scope of #435 (OpenClaw session retention) now that
upstream has shipped built-in session-store maintenance. Three deliverables:

1. **Doctor early-warning check** — a read-only health check that watches
   per-agent session-store growth and fires before unbounded accumulation
   becomes a problem.
2. **Docs** — update knowledge docs that still describe retention as an
   open upstream concern; record the verified upstream behavior.
3. **Machine remediation** (ops, not code) — run OpenClaw's own cleanup and
   set a disk budget so the gateway self-maintains; use the before/after as
   live validation of the new check.

## 2. Verified Findings (2026-06-11, OpenClaw 2026.6.5 (5181e4f), this machine)

The issue's "raise upstream" action is **moot** — upstream shipped retention:

- `openclaw sessions cleanup` exists: store maintenance with `--dry-run`,
  `--enforce`, `--all-agents`, `--fix-missing`, `--fix-dm-scope`,
  `--active-key` protection.
- `session.maintenance` config: `mode` (default **enforce**), `pruneAfter`
  (default **30d**), `maxEntries` (default **500**), optional `maxDiskBytes`
  with `highWaterBytes` (default 80% of max). Docs:
  https://docs.openclaw.ai/reference/session-management-compaction
- Maintenance fires on session-store **writes** and via the manual CLI —
  **not** on gateway startup or reads.
- **Gap observed live:** without `maxDiskBytes` configured (`diskBudget:
  null` on this machine), there is no disk-budget eviction and unreferenced
  artifacts (transcripts/trajectories no longer referenced by the store) are
  only GC'd when cleanup actually runs, and only past a 30-day cutoff.
  Observed: `main` sessions dir at **321MB / 1,812 files** with only **74**
  live store entries; dry-run cleanup would free ~90MB (389 files) today.

Conclusion: upstream maintenance exists but is not self-sufficient on this
machine's configuration → an early-warning doctor check is the right
Bakin-side guard, plus a one-time ops remediation.

## 3. Design

### 3.1 Adapter capability — `runtime.sessions.storeStats()`

Extend the `sessions` concept on `AgentRuntimeAdapter`
(`packages/core/src/adapters/runtime/concepts.ts:507`) with an **optional**
method (same optionality pattern as `media?` / `images?`):

```ts
sessions: {
  list(agentId?: string): Promise<RuntimeSession[]>
  get(sessionId: string): Promise<RuntimeSession | null>
  /**
   * Per-agent session-store disk stats. Optional: runtimes without a
   * file-backed session store omit it; callers treat absence as
   * "stats unavailable" (skip, never error).
   */
  storeStats?(): Promise<RuntimeSessionStoreStats[]>
}
```

```ts
interface RuntimeSessionStoreStats {
  agentId: string
  storeEntries: number   // live entries in sessions.json
  fileCount: number      // files in the sessions dir (incl. sessions.json)
  diskBytes: number      // total bytes of the sessions dir
}
```

OpenClaw implementation (`packages/adapter-openclaw/src/runtime.ts`):
enumerate `<openclawHome>/agents/*/sessions/`, stat files, count
`sessions.json` entries (`Object.keys(parse(...)).length`; tolerate missing
or malformed stores → `storeEntries: 0`). Read-only; no OpenClaw CLI calls,
no mutation, respects `getOpenClawHome()` resolution. Agents without a
sessions dir are skipped.

The mock runtime (Imitation Crab) and the testing adapter omit
`storeStats` — absence is a supported state.

### 3.2 Health check — `runtime.session-store`

New file `plugins/health/lib/system-checks/session-store.ts`, registered by
the health plugin alongside the existing `runtime` check. Pure function over
`RuntimeSessionStoreStats[]` (stats-fetching injected, matching
`checkRuntime(runtime: Pick<...>)` style).

Per-agent evaluation, hardcoded named constants:

| Constant | Value | Fires |
|---|---|---|
| `SESSION_STORE_WARN_BYTES` | 500 MB | `warn` when an agent's sessions dir exceeds it |
| `SESSION_STORE_ERROR_BYTES` | 1 GB | `error` |
| `SESSION_STORE_ORPHAN_RATIO` | 10× | `warn` when `fileCount / max(storeEntries, 1)` exceeds it AND `fileCount` is non-trivial (≥ `SESSION_STORE_ORPHAN_MIN_FILES` = 100) |

- One `HealthCheckResult` summarizing all agents when everything is healthy
  (`status: 'ok'`); one result per offending agent otherwise, message naming
  the agent, size, file/entry counts, and the fix:
  `openclaw sessions cleanup --enforce` + configure
  `session.maintenance.maxDiskBytes`.
- `storeStats` absent on the active runtime → single `ok` result,
  "session-store stats not available for this runtime" (not a warning —
  mock/dev runtimes are healthy states).
- `autoFixable: false` — remediation mutates runtime-owned data; Bakin
  surfaces, the user (or the gateway itself) fixes. This preserves the
  adapter boundary: Bakin never writes under `~/.openclaw`.

### 3.3 Machine remediation (ops runbook, performed as part of this work)

After the check ships and its WARN against current state is captured:

1. `openclaw sessions cleanup --enforce --all-agents` (frees ~90MB today).
2. `openclaw config set session.maintenance.maxDiskBytes 536870912` (512MB
   per agent store) so the gateway's write-triggered high-water eviction is
   active going forward. Uses OpenClaw's own CLI exclusively.
3. Re-run the doctor check; confirm the size signal improves and record
   before/after in the issue close-out comment.

Note: orphan-ratio may still warn immediately after cleanup (artifacts <30d
old are retained by upstream GC). That is expected and documented in the
check message; the disk-budget eviction handles it over time.

## 4. Testing Strategy

- **Adapter:** unit tests for the OpenClaw `storeStats()` against a temp
  OpenClaw home (env-var + `@bakin/adapter-openclaw/home` mock per
  CLAUDE.md testing rules — set `OPENCLAW_HOME` before imports). Cases:
  multiple agents, missing sessions dir, empty/malformed `sessions.json`.
- **Check:** pure-function tests over synthetic stats — ok path, byte warn,
  byte error, orphan-ratio warn, ratio guard below min-files, absent
  capability, stats call throwing (→ single `error` result, logged).
- **Both content-dir resolvers + logger mocked** in any test touching the
  filesystem; temp dirs cleaned in `afterAll`.
- Full suite via `bun run test`; new files individually via
  `bun test <file> --isolate`.

## 5. Docs Impact

- `.claude/knowledge/session-forensics.md` — replace the "OpenClaw-side
  retention … is an upstream concern (rig validation item)" note with the
  verified upstream behavior + pointer to the new check.
- `.claude/knowledge/doctor-and-health-checks.md` — add
  `session-store.ts` to the system-checks table.
- `.claude/knowledge/adapter-architecture.md` — only if it enumerates the
  `sessions` concept surface (verify during build; add `storeStats?` if so).
- README.md — not impacted (no user-facing surface change beyond a doctor
  check; doctor checks aren't enumerated there).
- Issue #435 — close-out comment with verified findings, check id, and
  remediation before/after; then close.

## 6. Boundaries

**Always:**
- Adapter boundary: provider paths only inside `packages/adapter-openclaw/`;
  the check consumes `AppServices.runtime` capability only.
- Read-only with respect to `~/.openclaw` in all Bakin code paths.
- Strict TS, named constants, `createLogger`, no empty catches.

**Ask first:**
- Any change to `session.maintenance` values other than the agreed
  `maxDiskBytes=512MB`.
- Any deletion beyond what `openclaw sessions cleanup --enforce` itself
  performs.

**Never:**
- Bakin code writing/deleting under `~/.openclaw`.
- Auto-fix that mutates runtime session data.
- Parsing OpenClaw CLI output in the health check (the adapter walks the
  filesystem; no subprocess per doctor cycle).
- Backwards-compat shims — `storeStats` is optional by design, not for
  compat theater.

## 7. Acceptance Criteria

1. `getAppServices().runtime.sessions.storeStats()` returns accurate
   per-agent stats on this machine (spot-checked against `du`/`ls`).
2. Doctor lists `session-store` under the health plugin; firing semantics
   match §3.2 (verified by tests + one live run showing the day-one WARN).
3. Mock runtime (`bun run dev:mock`) doctor run shows the `ok`
   "not available" path, not an error.
4. Full test suite green; no test touches real `~/.bakin` or `~/.openclaw`.
5. Machine remediated per §3.3 with before/after recorded on #435; issue
   closed.
6. Docs updated per §5.

## 8. Commit Strategy (checkpoints)

Branch `feat/session-store-retention-check`; detailed task-level plan in the
companion plan doc. Natural rollback points:

1. `feat(core): add optional sessions.storeStats to runtime adapter` —
   concept type + OpenClaw implementation + adapter tests. Standalone:
   nothing consumes it yet; revert = delete capability.
2. `feat(health): add session-store growth check` — check + registration +
   tests. Revert = doctor loses one check; adapter capability remains inert.
3. `docs(knowledge): record verified OpenClaw session retention behavior` —
   knowledge-doc updates + spec/plan docs. Pure docs.

Remediation (§3.3) is machine ops, not a commit.
