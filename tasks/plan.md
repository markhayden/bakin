# Plan: Team plugin canonical main-agent ids

**Spec:** `.claude/specs/issue-90-team-main-agent-canonical.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/90
**Branch:** `fix/issue-90-team-main-agent`
**Created:** 2026-04-15
**Author:** claude (opus-4-6) / roscoe

---

## Spec correction (apply before starting work)

The spec as written says Bakin "never writes to openclaw.json, ever." That's wrong — `plugins/team/lib/openclaw-adapter.ts:279` (`addAgent`) and `:333` (`removeAgent`) already write to it as part of normal user-initiated agent CRUD, and the CLAUDE.md adapter principle explicitly permits it ("Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never *copies* OpenClaw").

The correct rule is: **doctor checks, migration helpers, and onboarding code never auto-mutate openclaw.json.** User-initiated CRUD through the existing adapter functions is fine.

**Pre-flight task:** update section 4 ("Out of scope") and section 7 ("Never") of the spec to reflect this. Do this in the same PR, at the top of commit 1.

---

## Dependency graph

```
Phase 1 (solo):
  T3 — create openclaw-config.ts, migrate the three duplicate readers
       (pure refactor, no behavior change)
              │
              ▼
Phase 2 (6-way parallel, all file-disjoint after T3):
  ┌──── T1 — main-agent.ts: strip detection heuristic
  │
  ├──── T2 — settings.ts: delete `agents` + `mainAgentId` fields,
  │          migrate cli/bakin.ts consumers
  │
  ├──── T4 — openclaw-adapter.ts: listAgents validation + dedupe
  │
  ├──── T5 — team-grid.tsx: pyramid root = main agent,
  │          reportsTo?.mainAgentId resolution
  │
  ├──── T6 — team/index.ts: writer normalization (reportsTo===main → null)
  │
  └──── T7 — onboarding/openclaw.ts: doctor integrity check
              │
              ▼
Phase 3 (solo):
  T8 — docs (describes the final shipped state)
              │
              ▼
Phase 4 (runbook, no commit):
  T9 — manual cleanup on this machine
```

**Why this shape:** after the T3 refactor lands, each of T1/T2/T4/T5/T6/T7 touches a single file that no other task touches. Zero merge conflicts, zero ordering dependencies. They can execute as 6 parallel sub-agents (6× wall-time speedup on Phase 2) or serially by a single agent — either way the commit graph is the same.

**Key micro-reshuffle from v1 of this plan:** the `settings.mainAgentId` field deletion moved from T1 into T2, so T1 is now `main-agent.ts`-only and T2 is `settings.ts` + `cli/bakin.ts`-only. That removes the false conflict between T1 and T2 that made them appear sequential.

**Commit landing order** (for rollback sanity) follows the graph: T3 first, then any order of T1/T2/T4/T5/T6/T7, then T8. T9 is a runbook, not a commit.

---

## Phase 1 — Refactor prelude (solo, 1 commit)

### T3. Centralize the `openclaw.json` reader

**Files:**
- `packages/core/src/openclaw-config.ts` — **new file**
- `packages/core/src/main-agent.ts` — migrate to use the new module (keep existing heuristic for now; T1 strips it)
- `plugins/team/lib/openclaw-adapter.ts` — migrate `getOpenClawConfig` to use the new module
- `packages/core/src/settings.ts` — migrate `readAgentIdsFromOpenClaw` to use the new module (keep the field for now; T2 deletes it)
- `tests/core/openclaw-config.test.ts` — **new** unit tests for the reader

**Changes:**
- **Create `packages/core/src/openclaw-config.ts`** — owns the single mtime-cached reader for `openclaw.json`. Exports:
  - `readOpenClawConfig(): OpenClawConfig | null`
  - `getAgentList(): OpenClawAgent[]`
  - `getAgentIds(): string[]`
  - `findAgentById(id: string): OpenClawAgent | null`
  - Shared `OpenClawConfig` / `OpenClawAgent` Zod schemas (types defined here and re-exported).
- **Delete the three duplicate readers:**
  - `packages/core/src/main-agent.ts` — `readOpenClawConfig` + `cachedConfig` (lines ~94–114)
  - `plugins/team/lib/openclaw-adapter.ts` — `getOpenClawConfig` + `configCache` (lines ~51–67)
  - `packages/core/src/settings.ts` — `readAgentIdsFromOpenClaw` + its `__bakinOpenClawMtime` / `__bakinOpenClawAgents` globals (lines ~256–273)
- **Replace with imports** from `@bakin/core/openclaw-config`.
- **No behavior change.** `getMainAgentId()` still runs its heuristic. `BakinSettings.agents` is still populated. All existing tests still pass unchanged.
- Pure plumbing refactor. The sole purpose of this commit is to collapse three readers into one so Phase 2 can fan out cleanly.

**Acceptance:**
- `packages/core/src/openclaw-config.ts` exists with the exports above.
- Net LOC reduction across the three touched files: ~30–50 lines.
- No behavior observable from outside: all pre-existing tests pass without modification.
- `grep -rn "statSync.*openclaw.json" packages src plugins` returns exactly one hit (the new module).

**Verification:**
- `npm run test` passes in full.
- `npm run typecheck` passes.
- `bakin check openclaw` still works.
- Team page renders identically to before.

**Commit:** `refactor(core): centralize openclaw.json reader into openclaw-config module`

---

## ✅ Phase 1 checkpoint

- `npm run typecheck` green
- `npm run test` green (full suite, no modifications)
- Manual: start dev server, team page and `/api/settings` both unchanged from Phase 0

If this fails, `git revert` the T3 commit — everything is back to pre-refactor state with zero side effects.

---

## Phase 2 — Parallel fan-out (6 commits, independently landable)

**All six tasks below touch disjoint files and can execute in parallel.** Either as six concurrent sub-agents (fastest), or serially by one agent in any order. Each lands as its own commit for granular rollback.

### T1. Strip the detection heuristic from `getMainAgentId()`

**Files:**
- `packages/core/src/main-agent.ts` — rewrite
- `tests/core/main-agent.test.ts` — update + add cases

**Changes:**
- `getMainAgentId()` reads from `openclaw-config.findAgentById("main")`. If present, returns `"main"`. If missing, throws: *"openclaw.json has no agent with id 'main'. OpenClaw's orchestrator id is always 'main'; add that entry or run `bakin check openclaw`."*
- `tryGetMainAgentId()` returns `"main"` if the entry exists, `null` otherwise. No detection, no fallback.
- `getMainAgentName()` returns `identity.name` from the `main` entry, falling back to the string `"Main"` when unset.
- Delete `detectOrchestratorFromOpenClaw()`. (This function becomes dead code after the heuristic is stripped.)
- **Does NOT touch `settings.ts`.** The `mainAgentId` override deletion is T2's responsibility.

**Acceptance:**
- `getMainAgentId()` with a valid openclaw.json returns `"main"`.
- With `agents.list[0] = { id: "main" }` only, returns `"main"`.
- With `{ id: "bob" }` only (no `main`), throws.
- With an empty list, throws.
- `tryGetMainAgentId()` returns `null` in the empty / missing cases.
- `getMainAgentName()` returns `"Roscoe"` when the main entry has `identity.name: "Roscoe"`, returns `"Main"` when identity is absent.

**Verification:**
- `npm run test -- tests/core/main-agent.test.ts` passes.
- `npm run typecheck` passes.
- `grep -rn "detectOrchestratorFromOpenClaw\|OPENCLAW_TO_BAKIN\|OPENCLAW_ID_TO_BAKIN_NAME"` returns zero hits.

**Commit:** `refactor(core): getMainAgentId always returns "main"`

---

### T2. Delete `BakinSettings.agents` + `settings.mainAgentId`, migrate consumers

**Files:**
- `packages/core/src/settings.ts` — delete the two fields and related code
- `cli/bakin.ts` — migrate consumers to `openclaw-config.getAgentIds()`
- `tests/core/settings.test.ts` (if exists) — drop assertions on the deleted fields

**Changes:**
- Delete `agents: string[]` from `BakinSettings` (line 56).
- Delete `mainAgentId?: string` from `BakinSettings` (line 62) and its comment block.
- Delete `agents: []` from `DEFAULTS` (line 182).
- Delete `readAgentIdsFromOpenClaw()` and its globals (already thin after T3's centralization; just remove the wrapper).
- Delete the `hasExplicitAgentsOverride` branch (lines 348–354).
- Migrate `cli/bakin.ts` consumers:
  - `cli/bakin.ts:87` — replace `settings.agents.join(', ')` with `getAgentIds().join(', ')`
  - `cli/bakin.ts:882` — delete the `(settings as Record...).agents as string[]` cast hack; replace with `getAgentIds()`
  - `cli/bakin.ts:147` — verify this is reading an API response's `result.agents` (not settings); leave alone if so
- **Does NOT touch `main-agent.ts`.** T1 handles that.

**Acceptance:**
- `BakinSettings` type has no `agents` or `mainAgentId` fields.
- `getSettings()` returns a settings object that is identical to before for all other fields.
- No code path in `settings.ts` touches `openclaw.json`.
- `grep -rn "settings\\.agents\|settings\\.mainAgentId" packages src plugins cli` returns no hits.

**Verification:**
- `npm run typecheck` passes.
- `npm run test` passes.
- `bakin` commands that listed agents render identical output.

**Commit:** `refactor(core): drop stale settings.agents + mainAgentId fields`

---

### T4. `listAgents()` dedupes and validates OpenClaw's agent list

### T4. `listAgents()` dedupes and validates OpenClaw's agent list

**Files:**
- `plugins/team/lib/openclaw-adapter.ts` — `listAgents()` rewrite
- `tests/plugins/team/openclaw-adapter.test.ts` — new or extended
- `tests/fixtures/openclaw/` — add negative fixtures (broken configs)

**Changes:**
- After T3, `listAgents()` pulls its raw list from `openclaw-config.getAgentList()`. Validation pass:
  1. Track seen ids; on duplicate id, log error and skip the second occurrence.
  2. Resolve each agent's effective workspace (explicit `workspace` field OR `defaults.workspace` when the agent has no override). Track seen resolved workspaces; on collision, log an error naming both ids and skip the second.
  3. Confirm an entry with `id === "main"` exists. If missing, log a critical error and return an empty list so the UI surfaces an unmistakable empty state instead of silently hiding the orchestrator.
- Log level: use `log.error` for dupes, `log.error` + empty-return for missing main. Never `log.warn` — these are bugs in the config, not curiosities.
- Do NOT mutate `openclaw.json`. Read-only path.

**Acceptance:**
- Given a fixture with `[{id:"main"},{id:"roscoe",workspace:<default>}]`, `listAgents()` returns 1 entry (`main`) and logs one error mentioning both ids and the shared workspace.
- Given a fixture with `[{id:"main"},{id:"main"}]`, returns 1 entry, logs one error mentioning duplicate id.
- Given a fixture with `[{id:"bob"}]` (no main), returns `[]` and logs a critical error.
- Given a clean fixture, returns the full list unchanged.

**Verification:**
- `npm run test -- tests/plugins/team/openclaw-adapter.test.ts` passes.
- `npm run typecheck` passes.

**Commit:** `feat(team): validate and dedupe openclaw agent list`

---

### T5. Pyramid root is always `main`; `reportsTo` defaults to main at render time

**Files:**
- `plugins/team/components/team-grid.tsx` — rewrite `buildGraph()` grouping logic
- `plugins/team/hooks/use-agent-store.ts` — ensure a selector for the main agent id is available (route response already returns `mainAgentId`)
- `plugins/team/index.ts` — the `GET /` route already returns `mainAgentId`; verify the store consumes it
- `tests/plugins/team/team-grid.test.tsx` — new or extended (or write assertions against `buildGraph` as a pure function if component-level tests aren't set up)

**Changes in `team-grid.tsx:buildGraph()`:**
- Accept `mainAgentId: string` as a new input field in `GraphInput`. Pass it from the store.
- Pyramid root = the agent whose `id === mainAgentId`. Always. Not derived from `topAgentIds`.
- `teamsByReporter` key resolution: `team.reportsTo ?? mainAgentId`. This means a null/undefined `reportsTo` renders under the main agent automatically.
- Delete the `topAgentIds` heuristic; replace with `new Set([mainAgentId])` plus any additional ids that appear as non-null `reportsTo` values. (An agent who is a team leader for a non-default reporter also gets a "top-of-subtree" row.)
- Unassigned bucket: only include agents that (a) are not in any team's `teamMembers`, (b) are not the `mainAgentId`, (c) are not a team leader. In the default flat config, subagents all go under main via the default `reportsTo` fallback, so unassigned is empty.
- Row 1 now always has exactly the main agent (if present); teams for main render in row 2 (section headers) and row 3 (members). Matches current visual hierarchy for the "one orchestrator with teams under it" case.
- If `mainAgentId` is not in the roster (e.g. `listAgents()` returned empty per T4's missing-main path), render only the founder + an empty state message.

**Acceptance:**
- Fresh install simulation: `team.json` absent, openclaw.json has `main` + 7 subagents. Pyramid renders founder → main → single row of 7 subagents. No "Unassigned" bucket.
- Current user state during transition: openclaw.json still has both `main` and `roscoe` — T4 dedupes to just `main`, T5 puts `main` at the root, Creators + Builders teams with `reportsTo: "roscoe"` (unresolvable) fall back to main per T6.
- Roster override: team.json has a team with `reportsTo: "basil"`. That team renders under basil, not main.
- Empty roster: only the founder node renders.
- No duplicate card for the main agent anywhere in the grid.

**Verification:**
- `npm run test -- tests/plugins/team/team-grid.test.tsx` passes (or whichever harness we use).
- Manual: start dev server on imitation-crab fixture, visually confirm the pyramid shape.

**Commit:** `feat(team): pyramid root is always the main agent`

---

### T6. Normalize `team.json` writes: null/omit `reportsTo` when it equals main

**Files:**
- `plugins/team/index.ts` — the team.json writer route (POST/PUT for teams)
- `plugins/team/lib/team-settings.ts` (if exists) or wherever `writePluginSettings` lives
- `tests/plugins/team/routes.test.ts` — add normalization assertion

**Changes:**
- On write: for each team in the incoming payload, if `reportsTo === getMainAgentId()` or `reportsTo === undefined`, set it to `null`. (Null over omission for schema stability.)
- On read: in `buildGraph`, a `null`/missing `reportsTo` resolves to `mainAgentId` at render time (already covered by T5).
- Reading a team.json written by old code that has `"reportsTo": "roscoe"` (an unknown id): **graceful degradation** — treat any `reportsTo` that isn't in the roster as null, and log a warning telling the user to re-save. This way, the user's current messy team.json starts rendering correctly as soon as T5+T6 land.

**Acceptance:**
- POST `/api/plugins/team/teams` with `reportsTo: "main"` → written file has `reportsTo: null`.
- POST with `reportsTo: "basil"` → written file has `reportsTo: "basil"`.
- Reading a file with `reportsTo: "roscoe"` (unknown id) logs a warning and treats the team as reporting to main.
- Reading a file with `reportsTo: null` resolves to main at render time.

**Verification:**
- `npm run test -- tests/plugins/team/routes.test.ts` passes.
- `npm run test -- tests/plugins/team/team-grid.test.tsx` still passes.
- Manual: edit team.json by hand with `reportsTo: "roscoe"`, reload, confirm the team renders under main.

**Commit:** `feat(team): normalize team.json writes to drop implicit main reportsTo`

---

### T7. Doctor check for openclaw.json integrity

**Files:**
- `src/core/onboarding/openclaw.ts` — extend the existing `check()` function OR add a new sub-check
- `tests/core/doctor.test.ts` (or `tests/core/onboarding/openclaw.test.ts`) — new cases
- `cli/bakin.ts` — if a `bakin check openclaw` subcommand exists, ensure it hits the new validation

**Changes:**
- Add a validator that, on `bakin check openclaw` / `bakin doctor`, reports:
  1. Does an agent with `id === "main"` exist? If not, error with actionable text.
  2. Are there duplicate ids in `agents.list`? If so, error naming the dupes.
  3. Are there two agents whose effective workspace (explicit + defaults fallback) resolves to the same path? If so, error naming both ids and the shared path.
- Reports-only. Does not auto-fix. Non-zero exit on error.
- Wire into `bakin onboard` and the doctor loop so fresh installs catch broken configs immediately.

**Acceptance:**
- Clean openclaw.json: check passes silently.
- Missing main: clear error *"openclaw.json has no agent with id 'main'. Add an entry: `{ \"id\": \"main\", \"identity\": { \"name\": \"<your-agent-name>\" } }`"*.
- Duplicate id: clear error naming the id.
- Two agents sharing workspace `/Users/.../workspace`: clear error naming both ids and the shared path.
- Non-zero exit code when any of the above fire.

**Verification:**
- `npm run test -- tests/core/doctor.test.ts` passes.
- Manual: break openclaw.json intentionally (add a duplicate id), run `bakin check openclaw`, confirm the error.
- Manual: run on a known-good imitation-crab fixture, confirm silence.

**Commit:** `feat(onboarding): doctor validates openclaw.json integrity`

---

## ✅ Phase 2 checkpoint

After T1, T2, T4, T5, T6, T7 have all landed (in any order):
- `npm run typecheck` green
- `npm run test` green (full suite)
- Manual: start dev server on imitation-crab fixture — team page shows founder → Crab → 7 subagents. No duplicate cards.
- Manual: edit team.json on imitation-crab to add a Creators team with `reportsTo: null`. Reload. Confirm Creators renders under Crab.
- Manual: run `bakin check openclaw` against a deliberately-broken fixture. Confirm it flags the expected error and exits non-zero.

Commits so far: 7 on the branch (T3 + T1 + T2 + T4 + T5 + T6 + T7). Revert granularity: any single commit is independently reversible because all six parallel tasks touch disjoint files.

---

## Phase 3 — Docs (solo, 1 commit)

### T8. Doc updates

**Files:**
- `.claude/knowledge/agent-system.md` — confirm line 50 statement is now literally true (after fix, not aspirational); add a subsection on `getMainAgentId()` being trivial and the `openclaw-config.ts` centralized reader
- `.claude/knowledge/team-plugin.md` — create if missing, or append: document the pyramid rendering rules (root = main, reportsTo resolution, unassigned bucket semantics) and the team.json schema
- `CLAUDE.md` — check the "OpenClaw Adapter Principle" section and the Directory Map's `main-agent.ts` description; update if stale. The principle statement is still correct — leave it alone unless the specific file descriptions are wrong.
- `README.md` — no changes needed (README doesn't discuss agent identity)

**Acceptance:**
- `.claude/knowledge/agent-system.md` mentions the centralized `openclaw-config.ts` reader and notes that `getMainAgentId()` is constant-return.
- `.claude/knowledge/team-plugin.md` exists and documents the pyramid rules.
- Running `grep -rn "roscoe\|OPENCLAW_TO_BAKIN" .claude/knowledge CLAUDE.md README.md` returns only intentional references (e.g. historical context).

**Verification:**
- Read each touched doc; confirm the statements match the shipped code.

**Commit:** `docs: update agent-system and team-plugin knowledge notes`

---

### T9. Manual cleanup on this machine (documented, not code)

**Not a commit — a runbook for roscoe to execute after T1–T8 merge.**

```bash
# 1. Back everything up first
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.pre-issue-90
cp -r ~/.bakin ~/.bakin.pre-issue-90

# 2. Stop Bakin
bakin stop

# 3. Edit ~/.openclaw/openclaw.json by hand:
#    - In the agents.list[0] "main" entry, add identity.name = "Roscoe" and identity.emoji = "🐾"
#    - Delete the agents.list[] entry with id: "roscoe"
#    (Do not leave a stale workspace field — inherit from agents.defaults.workspace)

# 4. Move avatars
mv ~/.bakin/agents/roscoe/avatar.jpg ~/.bakin/agents/main/
mv ~/.bakin/agents/roscoe/avatar-full.png ~/.bakin/agents/main/
rm ~/.bakin/agents/roscoe/AGENTS.md    # stale — owned by openclaw now
rmdir ~/.bakin/agents/roscoe

# 5. Delete stale heartbeat
rm ~/.bakin/heartbeats/roscoe.json

# 6. Edit ~/.bakin/plugin-settings/team.json by hand:
#    - Remove "reportsTo": "roscoe" from both team entries
#    (null/omitted means main at render time — T5/T6)

# 7. Edit ~/.bakin/settings.json by hand:
#    - Delete the top-level "agents": [...] array
#    (T2 deleted the field from the type — it's no longer read)

# 8. Run the new doctor check
bakin check openclaw
# Should print nothing (clean)

# 9. Start Bakin
bakin start

# 10. Open team page in browser. Expected:
#     - Founder (Mark) at top
#     - Roscoe as single card below
#     - Creators + Builders sections under Roscoe
#     - No orphan "main" card anywhere
```

**Acceptance:**
- Team page renders one Roscoe card at the pyramid top, with Creators + Builders underneath. No duplicate.
- `bakin check openclaw` passes.
- No files in `~/.bakin/agents/roscoe/` or `~/.bakin/heartbeats/roscoe.json`.
- `~/.bakin/settings.json` has no `agents` field.
- `~/.bakin/plugin-settings/team.json` has `reportsTo: null` (or omitted) on both teams.

**Commit:** (no code commit — this is a runbook the user executes.)

---

## ✅ Phase 3 checkpoint (final)

- All tests green.
- Team page visually correct on this machine.
- Issue #90 closable with a summary comment linking the commits.

---

## Commit sequence summary

| # | Task | Commit | Phase | Parallel? | Reversible? |
|---|------|--------|-------|-----------|-------------|
| 1 | T3 | `refactor(core): centralize openclaw.json reader into openclaw-config module` | 1 (solo) | No — must land first | Yes (pure refactor) |
| 2 | T1 | `refactor(core): getMainAgentId always returns "main"` | 2 | ✅ Parallel | Yes |
| 3 | T2 | `refactor(core): drop stale settings.agents + mainAgentId fields` | 2 | ✅ Parallel | Yes |
| 4 | T4 | `feat(team): validate and dedupe openclaw agent list` | 2 | ✅ Parallel | Yes |
| 5 | T5 | `feat(team): pyramid root is always the main agent` | 2 | ✅ Parallel | Yes |
| 6 | T6 | `feat(team): normalize team.json writes to drop implicit main reportsTo` | 2 | ✅ Parallel | Yes |
| 7 | T7 | `feat(onboarding): doctor validates openclaw.json integrity` | 2 | ✅ Parallel | Yes |
| 8 | T8 | `docs: update agent-system and team-plugin knowledge notes` | 3 (solo) | No — must land last | Yes |

**8 commits. 3 phases. 3 checkpoints (after Phase 1, Phase 2, Phase 3).**

The Phase 2 fan-out (commits 2–7) is truly parallel: each task touches a disjoint set of files, so they can execute as six concurrent sub-agents or serially in any order. The commit landing order within Phase 2 doesn't matter for correctness — only for reviewability.

Any single commit can be reverted with `git revert <sha>` without corrupting the ones before it. The only ordering constraint is: commit 1 must land before any Phase 2 commit, and commit 8 must land after.

---

## Risks and open edges

1. **T3 scope creep.** Centralizing the openclaw.json reader touches main-agent.ts, settings.ts, openclaw-adapter.ts, and possibly cli/bakin.ts. If the refactor touches more than ~150 lines, split it into "create openclaw-config.ts" and "migrate consumers" as two commits.
2. **team-grid.tsx tests may not exist yet.** The current test file structure is unclear — if no test harness exists for rendering React components in this repo, we'll write assertions against `buildGraph()` as a pure function rather than the full component. That's fine for verifying the pyramid shape.
3. **T6 unresolved-id fallback.** Graceful degradation means team.json with `reportsTo: "roscoe"` "just works" after Phase 2 — which is good for the user but means the T9 manual edit of team.json is optional, not strictly required. Keep it in the runbook so on-disk state matches code expectations.
4. **Imitation Crab fixture.** `dev/imitation-crab/fixtures/openclaw.json:9` already has `id: "main"`. Good — this is the "fresh install" reference for F2/F6 tests. Don't touch it.
5. **`~/.bakin/agents/{id}/AGENTS.md`** — origin unclear. The plan treats it as a stale artifact on this machine. If something still writes it and the spec's implication is wrong, that's a follow-up to investigate, not a blocker for this PR.
