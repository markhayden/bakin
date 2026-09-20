# Implementation Plan: OpenClaw `agents.entries` Compatibility (#873)

**Spec:** `.claude/specs/openclaw-entries-873.md` (approved 2026-09-20)
**Branch:** `fix/873-openclaw-agents-entries`, cut from `main` in the MAIN checkout
(test-live-before-merge — though note this box runs adapter=pi, so the live test is
CLI/adapter-level against the real `~/.openclaw/openclaw.json`, read-only).
**Silo (hard):** every diff inside `packages/adapter-openclaw/`, `dev/imitation-crab/`,
`scripts/instance/`, or tests. Zero contract/SDK/core/Pi changes.

## Overview

Teach the ONE decoder the 9.5 shape first, then collapse the six inline bypasses into
shared accessors so mutations are shape-correct, then migrate the mock/rig/fixtures.
Vertical slices: each task lands a complete read-or-write path with its tests.

## Dependency Graph

```
T1 decoder + types (config.ts: entries read, synthesis rules, materialize→entries)
 ├── T2 shared accessors + agent-config mutators (identity/allowlist/remove/upsert
 │     + wipe fix + workspace shape-lookup helper)
 │     ├── T3 model-routing setAgentModels + applyRoutingPolicy pin
 │     └── T4 memory.ts workspacePath → shared lookup
 ├── T5 runtime.ts creation path (duplicate guard proof + fallback via accessors)
 └── T6 crab fixture + seed-enrich + rig normalizer + their test pins
T7 live verification on this machine's real config (read-only)
T8 docs + final gate + PR
```

T1 → T2 sequential spine; T3/T4/T5 independent after T2; T6 independent after T1.

## Commit Strategy

One conventional commit per task; each green + revertible:

| # | Commit | Rollback note |
|---|--------|---------------|
| 1 | `fix(adapter-openclaw): decode agents.entries; synthesis only for virgin configs` | Read-side only; revert restores legacy-only reads |
| 2 | `refactor(adapter-openclaw): shared agent accessors; mutations write entries` | Depends on 1. Revert restores inline legacy writes |
| 3 | `fix(adapter-openclaw): corrupt openclaw.json is never overwritten by upsert` | Independent two-line fix + regression; separate so the data-loss fix is cherry-pickable |
| 4 | `fix(adapter-openclaw): per-agent model writes land on entries` | Depends on 2 |
| 5 | `refactor(adapter-openclaw): memory workspace lookup rides the shared accessor` | Depends on 2 |
| 6 | `fix(adapter-openclaw): creation fallback writes entries; duplicate guard sees real roster` | Depends on 2 |
| 7 | `chore(mock): imitation-crab + dev rig speak the 2026.9.5 agents shape` | Depends on 1 (mock feeds conformance) |
| 8 | `docs(knowledge): openclaw agents.entries model + adapter accessor rules` | Docs only |

Rules: `bun run lint` + touched tests per commit; full suite at Checkpoints A/B. No
commit references later work. Never stage the dirty `_embedded-assets-static.ts`.
Attribution lines per repo standard.

## Task List

### Phase 1 — Read side

#### T1: Decoder + types (commit 1)
**Files:** `config.ts`, `tests/adapter-openclaw/config-cache.test.ts`,
`tests/core/openclaw-config.test.ts`.
**Do:** Widen `OpenClawConfig['agents']` (`ownership?: string`,
`entries?: Record<string, OpenClawAgent>`, keep `defaults`/`list`); `OpenClawAgent.id`
stays required on the DECODED shape (the key injects it) — entries values on disk may
omit it. `agentListFrom` per spec D1/D2 (entries → list → ownership-explicit ⇒ [] →
empty-entries ⇒ [] → virgin ⇒ implicit main). `materializeImplicitMainAgent` writes
`entries.main` (and only under D2 conditions); fix the stale header comment.
**Accept:** decode of the REAL 10-agent shape (fixture copied from live config, paths
anonymized); key-wins-over-embedded-id; polymorphic model passthrough; empty-entries
[] ; ownership-explicit []; virgin → main; legacy list still decodes.
**Verify:** `bun test tests/adapter-openclaw/config-cache.test.ts tests/core/openclaw-config.test.ts tests/core/main-agent.test.ts --isolate`. **Size:** M.

#### T2: Shared accessors + agent-config mutators (commit 2) + wipe fix (commit 3)
**Files:** `config.ts` (accessors), `agent-config.ts`, new
`tests/adapter-openclaw/agent-config-entries.test.ts`.
**Do:** `findAgentIn` / `upsertAgentIn` / `deleteAgentIn` in config.ts — operate on
the LIVE `agents.entries[id]` object (decoded copies are read-only); on a list-shaped
config the first mutation converts the section to entries (delete `list`) in the same
write. Port `updateOpenClawAgentIdentity`, `updateAgentAllowlist` (incl. main
materialization), `removeOpenClawAgentConfig` (incl. the allowAgents scrub across
entries), `upsertOpenClawAgentConfig` (drop the bare `{id:'main'}` push — D2 rules own
main now), `openClawAgentsList` retired. All mutators move to
`readOpenClawConfigForMutation()`. Extract `configuredWorkspaceFor(config, agentId)`;
`getWorkspacePath` keeps its trust predicate. Commit 3 = the strict-read switch in
upsert + corrupt-config regression test.
**Accept:** every mutation on an entries config touches only `entries[id]`,
round-trips `ownership`/`defaults`/`gateway`/unknown entry fields; legacy config
upgrades one-way on first mutation; corrupt config ⇒ throw, file untouched.
**Verify:** new test file + `bun test tests/adapter-openclaw/ --isolate`. **Size:** L
(split across two commits keeps each reviewable).

### CHECKPOINT A — `bun run lint` + `bun run test` full green

### Phase 2 — Remaining write paths

#### T3: model-routing (commit 4)
**Files:** `model-routing.ts`, `tests/adapter-openclaw/model-routing.test.ts`.
**Do:** `setAgentModels` via `findAgentIn`/`upsertAgentIn` (main materialization per
D2); header mapping comment updated. Add the pin: `applyRoutingPolicy` preserves
`entries` + `ownership` (already true via spread — test only).
**Accept:** non-main model/subagentModel writes land on `entries[id]` (the #873
throw is gone); legacy-shape test flips to upgrade-asserting; alias/defaults
behavior unchanged.
**Verify:** `bun test tests/adapter-openclaw/model-routing.test.ts --isolate`. **Size:** S.

#### T4: memory workspace lookup (commit 5)
**Files:** `memory.ts`, `tests/adapter-openclaw/memory-workspace-path.test.ts`.
**Do:** replace the inline `agents.list.find` with `configuredWorkspaceFor`; keep the
`existsSync`-only trust rule and fallbacks byte-identical.
**Accept:** existing pins pass with entries-shaped mocks; per-entry workspace honored.
**Verify:** that test file. **Size:** XS.

#### T5: creation path (commit 6)
**Files:** `runtime.ts` (only if needed — fallback goes through upsert already),
`tests/adapter-openclaw/runtime-binary.test.ts`.
**Do:** confirm `agents.create` duplicate guard + allowlist-failure fallback ride the
new accessors; flip the on-disk shape assertions to entries; add the adoption
regression (create on existing entries id ⇒ typed already-exists; findAgentById sees
entries agents).
**Accept:** spec D4. **Verify:** `bun test tests/adapter-openclaw/runtime-binary.test.ts --isolate`. **Size:** S.

### Phase 3 — Mock + rig

#### T6: crab + rig speak 9.5 (commit 7)
**Files:** `dev/imitation-crab/fixtures/openclaw.json`,
`dev/imitation-crab/seed-enrich.ts`, `scripts/instance/agent-paths.ts`,
`tests/dev/{mock-seed,mock-runtime-contract}.test.ts`,
`tests/scripts/instance/agent-paths.test.ts`.
**Do:** fixture → `entries` + `ownership: "explicit"` + `defaults` (same 5 agents);
seed-enrich upserts `entries[id]`; `normalizeAgentPaths` walks `entries ?? list`.
**Accept:** mock-seed pins the new shape; mock-runtime-contract roster unchanged;
runtime-conformance (openclaw.conformance) green against the new fixture.
**Verify:** `bun test tests/dev/ tests/scripts/instance/agent-paths.test.ts tests/integration/runtime-conformance/ --isolate`. **Size:** S.

### CHECKPOINT B — full suite + lint green

### Phase 4 — Live proof + close

#### T7: Live verification (read-only, this machine)
A scratch script (NOT the live server; NO writes to ~/.openclaw) that calls
`getAgentList()`/`findAgentById`/`getWorkspacePath` against the REAL config via
OPENCLAW_HOME default: expect all 10 agents with correct identity/model/workspace,
matching `openclaw agents list --json`. Success criterion 1 proven on real data.
Optionally `bakin check runtime` remains green.

#### T8: Docs + gate + PR (commit 8)
`.claude/knowledge/adapter-architecture.md` (or the openclaw section owner —
confirm at build time): the 9.5 agents model, decoder/accessor rules
("agents.list is never written again"), synthesis conditions. CLAUDE.md: no changes
expected (no top-level claims about openclaw config shape — confirm). README: no
impact expected — confirm. Final gate: lint, full suite, `check:cycles`. PR
references #873 with the live-verification transcript; close #873 after merge.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Write path strips unknown entry fields (`models` map, future keys) | High | Accessors patch the LIVE entry object, never reconstruct; round-trip tests assert unknown-field survival |
| Legacy→entries upgrade loses data on a hybrid file (both keys present) | Med | Upgrade rule: entries wins as read-truth; upgrade write merges list-only agents INTO entries before deleting list; test covers the hybrid |
| Main-agent resolution flips behavior for core (getMainAgentId via findAgentById) | Med | D2 keeps virgin-config synthesis; main-agent tests + main-agent-resolution suite run at Checkpoint A |
| Conformance/crab drift breaks non-openclaw suites | Low | Crab change is fixture-shape only; conformance asserts are shape-independent (verified in exploration) |
| Rig normalizer regression (docker paths) | Low | agent-paths tests cover entries + list walks |

## Parallelization

Single-session sequential (T1→T8). T3/T4/T5 are independent post-T2 if ever split.
