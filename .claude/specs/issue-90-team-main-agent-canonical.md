---
name: team-plugin-main-agent-canonical
issue: https://github.com/markhayden/bakin/issues/90
status: draft
author: claude (opus-4-6) / main-operator
date: 2026-04-15
---

# Spec — Team plugin derives entire roster from OpenClaw's canonical ids

## 1. Objective

The Bakin team page today shows two cards for the same logical agent: "Main Operator" at the pyramid top and "main" as an unassigned orphan at the bottom. This is the visible symptom of a deeper problem — Bakin still has code and stored state that treats display names and canonical ids as interchangeable, even though the adapter principle says only OpenClaw owns agent identity.

This spec defines the changes needed to guarantee that **the Bakin team page, on any OpenClaw install (fresh or existing), renders exactly the agents OpenClaw reports — keyed by OpenClaw's canonical id, labeled by `identity.name` at render time — with the orchestrator (`id: "main"`) at the top of the pyramid and no duplicate cards ever, regardless of what the user chose to name their main agent.**

No Bakin code or data file may hold a hardcoded agent id string like `"main-operator"`, `"main"`, or `"bob"`. The only hardcoded literal allowed is the canonical orchestrator id `"main"` itself, because that is an OpenClaw-defined contract (documented in `.claude/knowledge/agent-system.md:50` and reflected in the imitation-crab fixture at `dev/imitation-crab/fixtures/openclaw.json:9`).

### Target user
Single-user, single-machine (this Mac mini). No backwards-compat shims. Reduce tech debt aggressively — any code that only exists because of the old `main-operator`-as-id assumption gets deleted, not deprecated.

## 2. OpenClaw contract (restated — this is the invariant everything depends on)

- Every OpenClaw install has exactly one agent whose id is the literal string `"main"`. That agent is the orchestrator. This is OpenClaw's convention, not Bakin's.
- The human-facing name of the main agent ("Main Operator", "Crab", "Bob", etc.) lives in `agents.list[].identity.name`. It is arbitrary per install.
- Subagents have whatever ids OpenClaw assigns them (`pixel`, `patch`, `chef`, …). Those ids are also canonical — Bakin never renames them.
- `agents.defaults.workspace` is the main agent's workspace. Subagents each have their own workspace under `workspaces/{id}/`.
- Anything Bakin needs to display as a human label must be resolved at render time from `identity.name` (or fall back to the id). Display names are never stored as keys.

## 3. Core features & acceptance criteria

### F1 — `getMainAgentId()` always returns `"main"`
**Change:** Strip the detection heuristic in `packages/core/src/main-agent.ts`. The function becomes: read `openclaw.json`, confirm an entry with `id === "main"` exists, return `"main"`. If missing, throw with a message telling the user to add a `main` entry to their `openclaw.json` (the adapter principle says Bakin won't do it for them).

**Accept:**
- `tryGetMainAgentId()` returns `"main"` when an entry exists, `null` otherwise.
- `getMainAgentId()` returns `"main"` or throws with a clear message.
- `getMainAgentName()` returns `identity.name` from the `main` entry, falling back to `"Main"` if unset.
- `settings.mainAgentId` override is **deleted** from `BakinSettings`. It was a hack for the pre-rename world. (Tech debt reduction.)
- No code path exists that can cause `getMainAgentId()` to return anything other than `"main"`. Grep proof in the PR description.

### F2 — Team plugin dedupes and validates OpenClaw's agent list
**Change:** In `plugins/team/lib/openclaw-adapter.ts`'s `listAgents()`, add a validation pass:
- Reject duplicate ids (log an error, skip the second).
- Reject two agents whose resolved workspace path is identical (log an error, skip the second — that's the `main` + `main-operator` bug we're fixing).
- Require the `main` entry to exist; if missing, return an empty list and log a critical error so the UI shows an empty state instead of silently omitting the orchestrator.

**Accept:**
- Given a broken `openclaw.json` with both `{ id: "main" }` and `{ id: "main-operator", workspace: <default> }`, `listAgents()` returns one agent (`main`), logs one error, and the UI shows a single pyramid root.
- Given a clean `openclaw.json`, `listAgents()` is a pure passthrough (no extra allocations, same shape as today).
- The adapter never mutates `openclaw.json`.

### F3 — Pyramid root is always the `main` agent; `reportsTo` defaults resolve at render time
**Change:** In `plugins/team/components/team-grid.tsx` and whatever computes the team grouping:
- The pyramid root is the agent with `id === "main"`. Always. Not derived from team membership, not from `topAgentIds`.
- Every other agent reports to `main` by default. A `team` entry in `team.json` whose `reportsTo` is null/undefined is resolved at render time to `getMainAgentId()`.
- Teams in `team.json` may set `reportsTo` to a non-`"main"` agent id for sub-org structures (e.g. Creators reports to Chef instead of main). That override is respected.
- The "Unassigned" bucket is only rendered if there are genuinely agents that have no team assignment AND no implicit-main parent. In the default flat configuration (no teams yet), all subagents render as a single row directly under main, with no "Unassigned" label.

**Accept:**
- Fresh install (no `team.json`): pyramid shows founder → main agent → all subagents in one row. No "Unassigned" bucket.
- User's current install after fix: pyramid shows founder → Main Operator (main) → Creators team + Builders team, each with their members. No stray `main` card.
- User edits `team.json` to add `reportsTo: "chef"` on Creators team: Creators team appears under Chef instead of main.
- Deleting `team.json` entirely (fresh-install simulation) still renders a valid pyramid.

### F4 — `team.json` schema strips stored `reportsTo` strings that equal the current main id
**Change:** When Bakin writes `team.json`, any `reportsTo` value that equals `getMainAgentId()` is stored as `null` (or omitted). When Bakin reads it, `null`/missing → `main` at render time. This means `team.json` on disk never contains the literal string `"main"` or `"main-operator"` as a `reportsTo` value — the default-pyramid-root is implicit.

This prevents the same class of bug from recurring if someone ever renames the canonical id, and it makes `team.json` portable between installs that might have different `identity.name` values.

**Accept:**
- After this fix ships, `~/.bakin/plugin-settings/team.json` contains no `"reportsTo": "main"` strings anywhere. `reportsTo` is either null/omitted or a non-main agent id.
- Reading a team.json written by the old code (with `"reportsTo": "main-operator"`) works: the `"main-operator"` string resolves to nothing and falls back to main. We don't need a migration shim because the first write under the new code cleans it up. (This is *not* a backwards-compat shim — it's graceful handling of a string that happens to be invalid.)

### F5 — Delete the stale `agents: [...]` array in `settings.json`
**Change:** Grep for whoever writes `agents: [...]` into `~/.bakin/settings.json`. That field is not in the `BakinSettings` type and is duplicating OpenClaw data. Delete:
- The writer code.
- The field from the user's actual `settings.json` (one-time edit).
- Any reader code (if any exists).

**Accept:**
- No code in `packages/core/src/settings.ts` (or anywhere else) writes an `agents` field to `settings.json`.
- `~/.bakin/settings.json` on this machine no longer has the field.
- Grep for `settings.agents` / `\.agents.*=.*\[` returns only tests/fixtures that can be deleted.

### F6 — Doctor / health check: detect broken openclaw.json
**Change:** Add a check (in `src/core/onboarding/openclaw.ts` or a new doctor check) that validates:
- Exactly one agent has `id === "main"`.
- No two agents share the same `workspace` path (after resolution — relative paths, `~` expansion, `agents.defaults.workspace` inheritance).
- Every agent has a unique `id`.

On failure, the check prints a specific, actionable error (e.g. "openclaw.json has two agents sharing workspace `/Users/.../workspace`: `main` and `main-operator`. Remove one.") and exits non-zero. It does not auto-fix.

**Accept:**
- `bakin check openclaw` (or equivalent) catches the current broken state on a machine that still has the duplicate.
- A clean openclaw.json passes silently.
- The check is wired into `bakin onboard` / `bakin doctor` so fresh installs hit it automatically.
- No test fixture contains a broken openclaw.json outside of the negative-test cases for this check.

### F7 — Manual cleanup on this machine (post-fix)
Not part of the Bakin code, but part of the task: after F1–F6 ship and pass tests, perform these one-shot fixes on this Mac mini to match the new contract:
1. Edit `~/.openclaw/openclaw.json`: delete the `main-operator` entry, move its `identity: { name: "Main Operator", emoji: "🐾" }` and `workspace` / `agentDir` fields into the `main` entry. Keep the same subagents list.
2. Move `~/.bakin/agents/main-operator/avatar.jpg` and `avatar-full.png` → `~/.bakin/agents/main/`.
3. Delete `~/.bakin/agents/main-operator/` (should be empty after the move, or just has a stale `AGENTS.md` that came from the old rename — delete that too unless `agents/main/AGENTS.md` is stale in which case overwrite).
4. Delete `~/.bakin/heartbeats/main-operator.json`.
5. Open `~/.bakin/plugin-settings/team.json` and change `"reportsTo": "main-operator"` → remove the field entirely (null/omitted means main). The next write from the new code would do this anyway, but we do it by hand so the transition is observable.
6. Open `~/.bakin/settings.json`, delete the top-level `agents: [...]` array.
7. Restart Bakin. Team page should show a single Main Operator at the pyramid top with Creators + Builders under it. No orphan "main" card.

## 4. Out of scope

- Changing OpenClaw's internal id scheme. `main` is a contract Bakin accepts, not invents.
- **Auto-mutating `openclaw.json`** from doctor checks, migration helpers, or onboarding code. User-initiated agent CRUD through the existing `addAgent` / `removeAgent` adapter functions (`plugins/team/lib/openclaw-adapter.ts:279,333`) remains the legitimate write path — that's what CLAUDE.md's "Bakin writes to OpenClaw" clause refers to. What we're ruling out is code that *silently* edits the file as a side effect of a check or migration.
- A generic "agent id migration" tool. This is a single install; the manual steps in F7 are fine and documented.
- The `bakin-main-operator` → `bakin-main` mcporter rename, which per the audit is already in place (`tests/core/mcporter.test.ts` confirms).
- Multi-user or multi-install scenarios. Single user, single machine.
- UI to edit teams / reportsTo. The existing team.json edit UI already exists; we're just changing what it stores.

## 5. Tech stack / constraints

- TypeScript strict mode, no `any` across module boundaries.
- Zod validation at new boundaries (the validated `openclaw.json` shape in F2/F6 should flow through a Zod schema).
- All OpenClaw paths via `getOpenClawPath()` in `packages/core/src/openclaw-home.ts`. No `~/.openclaw/` string literals.
- All Bakin paths via `getContentDir()` / `getBakinPaths()`. No `~/.bakin/` string literals.
- Logger: `createLogger('main-agent')` / `createLogger('team:adapter')` / etc. No `console.log`.
- **No backwards-compat shims.** If old code exists only to support a pre-rename layout, delete it in the same PR.

## 6. Testing strategy

Every test file touching storage must mock `src/core/content-dir` per `CLAUDE.md`'s test isolation rules. See `tests/plugins/test-helpers.ts` for the established pattern.

### Unit tests
- `tests/core/main-agent.test.ts` — add cases:
  - Returns `"main"` when openclaw.json has an agent with `id: "main"`.
  - Throws when missing.
  - `getMainAgentName()` returns `identity.name` when set, falls back to `"Main"` when missing.
  - Old `settings.mainAgentId` override field no longer exists / has no effect (grep-level check + a test that asserts the field isn't in `BakinSettings`).
- `tests/plugins/team/openclaw-adapter.test.ts` — add cases:
  - Duplicate id → second is skipped, error logged.
  - Two agents sharing workspace → second is skipped, error logged.
  - Missing `main` entry → returns empty list, critical error logged.
  - Clean config → one-to-one passthrough.

### Integration tests
- `tests/plugins/team/routes.test.ts` — extend:
  - `GET /api/plugins/team` returns a roster where every entry's id appears in `openclaw.json` and nothing else.
  - On a broken openclaw.json with both `main` and `main-operator`, the route returns only the `main` entry.
- `tests/plugins/team/team-grid.test.tsx` (new or existing) — render the grid with a `team.json` that has no `reportsTo` and confirm the pyramid root is the `main` agent.

### Doctor check
- `tests/core/doctor.test.ts` — extend:
  - Valid openclaw.json passes.
  - Missing `main` → fails with actionable message.
  - Duplicate workspace → fails with actionable message naming both ids.
  - Duplicate id → fails.

### Manual / e2e
- Start Bakin with the imitation-crab fixture (which has `id: "main"`, `identity.name: "Crab"`). Team page shows Crab at the pyramid top. No duplicate.
- After manual cleanup (F7) on the real machine: team page shows Main Operator at the pyramid top, Creators + Builders under. No orphan main card.

### Test isolation reminder
All tests use the `tests/plugins/test-helpers.ts` `activatePlugin` / `callRoute` helpers, which mock `getContentDir`, `logger`, `watcher`, `openclaw-client`. Any new test fixtures that need an openclaw.json go under `tests/fixtures/openclaw/` and are loaded via a mocked `getOpenClawPath()`.

## 7. Boundaries

**Always:**
- Treat `"main"` as the canonical orchestrator id. Never hardcode any other agent id.
- Resolve display names from `identity.name` at render time.
- Read agent data from OpenClaw. Write UI-only augmentations to `~/.bakin/`.
- Use `getOpenClawPath()` / `getContentDir()` for all path resolution.
- Log with `createLogger()`.

**Ask first about:**
- Adding any new stored field that holds an agent id as a string (we should prefer "resolved at render time" wherever possible).
- Changing the `BakinSettings` schema (other unrelated fields exist; don't accidentally drop them).
- Touching the imitation-crab fixture (we rely on it as the "fresh install" reference).

**Never:**
- Auto-mutate `openclaw.json` from a doctor check, migration helper, or onboarding step. (User-initiated CRUD through the existing `addAgent`/`removeAgent` adapter functions is fine — those are the legitimate write path.)
- Store an agent display name (`"Main Operator"`, `"Crab"`) as a key in any data structure or filesystem path.
- Add a backwards-compat shim for the old `main-operator`-as-id layout. Delete the old code paths; the single manual cleanup in F7 is the entire migration.
- Use `settings.mainAgentId` as a source of truth. It's gone after F1.
- Re-introduce `OPENCLAW_TO_BAKIN` / `OPENCLAW_ID_TO_BAKIN_NAME` maps or any equivalent.

## 8. Commit strategy (rollback checkpoints)

The work decomposes into six independent commits, each testable on its own. Any one can be reverted without breaking the others.

1. **`refactor(core): getMainAgentId always returns "main"`** — F1. Strips the detection heuristic and `settings.mainAgentId` override. Updates `main-agent.ts` and `tests/core/main-agent.test.ts`. Self-contained; rolls back to current heuristic cleanly.

2. **`refactor(core): remove stale agents[] field from BakinSettings`** — F5. Deletes the writer, removes the field from `settings.json` on disk, updates tests. Independent of F1.

3. **`feat(team): dedupe and validate openclaw agent list`** — F2. Adds the validation pass to `listAgents()`, logs duplicates, keeps the adapter read-only. Includes `tests/plugins/team/openclaw-adapter.test.ts` cases.

4. **`feat(team): pyramid root is always the main agent`** — F3 + F4. Changes `team-grid.tsx` to derive the root from `getMainAgentId()`, drops the `topAgentIds` heuristic for the root, makes `reportsTo: null` resolve to main at render time. Writes team.json normalized (no stored `"main"` string).

5. **`feat(onboarding): doctor check for openclaw.json integrity`** — F6. Adds the validation check, wires it into `bakin onboard` / `bakin doctor`, new `tests/core/doctor.test.ts` cases.

6. **`chore: cleanup stale main-operator artifacts on this machine`** — F7 as a tiny documentation-only commit to `.claude/knowledge/` (or an internal migration note), capturing what was done by hand. The actual filesystem edits are not in the repo but are listed so future-me can trace them.

**Merge order:** 1 → 2 → 3 → 4 → 5 → 6. Each commit must pass `npm run test` and `npm run typecheck` before the next lands. If any commit breaks something unexpected, revert only that commit; the earlier commits remain valid.

**Rollback:** because `main-agent.ts` underpins everything, commit 1 is the highest-risk. If its test suite passes but runtime behavior is off, `git revert <commit-1>` restores the heuristic without affecting commits 2+. Commits 3 and 4 are tightly coupled — if 4 needs to revert, 3 can stay in place (it just means the adapter still validates but the UI hasn't taken advantage of it yet).

## 9. Knowledge / doc updates

After the fix ships, update:
- `.claude/knowledge/agent-system.md` — confirm the existing statement on line 50 is still accurate (it should be, after the fix it's literally true instead of aspirational); add a note that `getMainAgentId()` is now a trivial constant-return and that the detection heuristic is gone.
- `.claude/knowledge/team-plugin.md` (if exists; otherwise check if one should be created) — document the pyramid rendering rules and `reportsTo` resolution.
- `CLAUDE.md` — the "OpenClaw Adapter Principle" section already captures the spirit; no changes needed unless the `main-agent.ts` description in the Directory Map is stale.
- `README.md` — no impact (README doesn't talk about agent ids).

## 10. Open questions

None remaining — decisions #1–#4 from the clarifying round are locked in above.
