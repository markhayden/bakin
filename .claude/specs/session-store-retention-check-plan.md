# Plan — Session-Store Retention Check (#435 close-out)

Spec: `session-store-retention-check.md`. Branch:
`feat/session-store-retention-check` off `main`.

Verified integration points (read during planning):

- Concept interface: `packages/core/src/adapters/runtime/concepts.ts:507`
  (`sessions: { list, get }`); `RuntimeSession` at `:239`.
- OpenClaw adapter stub: `packages/adapter-openclaw/src/runtime.ts:808`
  (`sessions = { list: async () => [], get: async () => null }`); home
  resolution via `getOpenClawHome()` from `./home`.
- Testing adapter: `packages/core/src/adapters/runtime/testing.ts:83` —
  leave `storeStats` omitted (exercises the absence path by default).
- Check registration: `plugins/health/index.ts` ~`:514` — register
  `session-store` after the `runtime` check, `run: () =>
  checkSessionStore(ctx.runtime)`.
- Tests live at `tests/adapter-openclaw/` (adapter) and
  `tests/plugins/health/` (new `session-store.test.ts`).
- Docs: `.claude/knowledge/adapter-architecture.md:77` lists concept names
  only (no method enumeration) → **no change needed there**; spec §5
  conditional resolves to "skip".

## Task 1 — Adapter capability `sessions.storeStats()` ✅ Commit 1

**Slice:** type + OpenClaw implementation + tests. Inert (no consumer).

1. `concepts.ts`: add `RuntimeSessionStoreStats` interface
   (`agentId/storeEntries/fileCount/diskBytes`) + optional
   `storeStats?(): Promise<RuntimeSessionStoreStats[]>` on `sessions`,
   doc-commented per spec §3.1. Export the type from the adapter barrel
   (`packages/core/src/adapters/runtime/index.ts`) if types are re-exported
   there (check at build time).
2. `packages/adapter-openclaw/src/runtime.ts`: implement `storeStats` on the
   `sessions` object — `readdir(<home>/agents)`, per agent stat every file
   in `sessions/` (skip agents without the dir), sum bytes, count files,
   `storeEntries` = key count of parsed `sessions.json` (missing/malformed →
   0, log at debug, never throw).
3. Tests `tests/adapter-openclaw/runtime-session-stats.test.ts`: temp
   `OPENCLAW_HOME` set **before imports** (CLAUDE.md rule), fixtures for
   multi-agent, missing dir, empty store, malformed store. Cleanup in
   `afterAll`. Mock logger.

**Acceptance:** tests green via
`bun test tests/adapter-openclaw/runtime-session-stats.test.ts --isolate`;
`bun run typecheck` (or `tsc` equivalent in repo scripts) clean.
**Verify live:** quick `bun -e` against real home comparing one agent's
`diskBytes` to `du -sk` (read-only).

**Commit:** `feat(core): add optional sessions.storeStats to runtime adapter`

## Task 2 — Health check `session-store` ✅ Commit 2

**Slice:** check + registration + tests. Depends on Task 1.

1. `plugins/health/lib/system-checks/session-store.ts`:
   `checkSessionStore(runtime: Pick<AgentRuntimeAdapter, 'sessions'>)`.
   Constants: `SESSION_STORE_WARN_BYTES` (500MB), `SESSION_STORE_ERROR_BYTES`
   (1GB), `SESSION_STORE_ORPHAN_RATIO` (10), `SESSION_STORE_ORPHAN_MIN_FILES`
   (100). Semantics per spec §3.2: absent capability → single ok ("stats not
   available for this runtime"); throw → single error result (logged); all
   healthy → single ok summary (agent count + total bytes); else one result
   per offending agent with sizes, counts, and the remediation message
   (`openclaw sessions cleanup --enforce`, `session.maintenance.maxDiskBytes`).
   `autoFixable: false` everywhere.
2. Register in `plugins/health/index.ts` after `runtime`:
   `{ id: 'session-store', name: 'Runtime session-store growth', run: ... }`.
3. Tests `tests/plugins/health/session-store.test.ts` (pure-function, fake
   runtime objects — no fs): ok path, byte warn, byte error, orphan warn,
   ratio suppressed under min-files, absent capability, stats throwing,
   multiple offenders → multiple results.

**Acceptance:** new tests green; `bun run test` full suite green;
**verify live:** restart-free check via `bakin doctor` or
`bun test` is not enough — run the doctor once on this machine and confirm
`session-store` fires WARN for `main` (24× ratio). Capture output for the
issue comment. Also run `bun run dev:mock` doctor path once to confirm the
absence → ok branch.

**Commit:** `feat(health): add session-store growth check`

## Task 3 — Docs ✅ Commit 3

1. `.claude/knowledge/session-forensics.md` (~line 97): replace the
   "upstream concern (rig validation item)" paragraph with verified
   2026.6.5 behavior (maintenance on writes + CLI, defaults, no startup
   pruning, disk budget opt-in) + pointer to the `session-store` doctor
   check.
2. `.claude/knowledge/doctor-and-health-checks.md`: add
   `plugins/health/lib/system-checks/session-store.ts` | `session-store`
   to the system-checks table.
3. Spec + this plan checked in (already written; included in this commit).

**Acceptance:** grep shows no remaining "upstream concern" retention note;
README confirmed untouched-by-design.

**Commit:** `docs(knowledge): record verified OpenClaw session retention behavior`

## Task 4 — Machine remediation + issue close-out (ops, no commit)

Depends on Task 2's live WARN capture.

1. Record before: `du -sh ~/.openclaw/agents/*/sessions`, dry-run cleanup
   JSON, doctor WARN text.
2. `openclaw sessions cleanup --enforce --all-agents`.
3. `openclaw config set session.maintenance.maxDiskBytes 536870912`
   (+ `openclaw config get session.maintenance` to confirm; gateway restart
   only if OpenClaw requires it to pick up config — check `openclaw doctor`).
4. Re-run doctor; record after-state (size WARN cleared; orphan-ratio WARN
   may persist for <30d artifacts — expected, note it).
5. Comment on #435: upstream findings, check id, before/after; close issue.
6. Merge PR (single PR containing commits 1–3, conventional title
   `feat(health): session-store retention check (#435)`).

**Acceptance criteria for the whole effort:** spec §7 items 1–6.

## Checkpoints / rollback

- After each commit the tree is green and shippable; commits 1–3 are
  independently revertible in reverse order (3: docs only; 2: doctor loses
  the check, capability stays inert; 1: removes the unused capability).
- Remediation is reversible only in config (`openclaw config unset
  session.maintenance.maxDiskBytes`); deleted artifacts are gone — which is
  the point, and they're >30d-old unreferenced transcripts handled by
  OpenClaw's own GC rules.

## Risks

- **Adapter walk cost:** ~1.8k files statted per doctor cycle for `main` —
  microseconds-to-low-ms territory, doctor is cron-cadence; acceptable.
- **OpenClaw config set side effects:** `openclaw.json` is rewritten by its
  own CLI (it already maintains `.bak` rotations). Bakin never touches it.
- **Threshold judgment:** constants are deliberate first guesses; one-line
  edits if reality disagrees.
