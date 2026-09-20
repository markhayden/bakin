# TODO: #873 OpenClaw agents.entries (spec: .claude/specs/openclaw-entries-873.md, plan: tasks/plan-openclaw-entries-873.md)

Branch: `fix/873-openclaw-agents-entries` · Silo: adapter + mock + rig + tests ONLY

## Phase 1 — Read side
- [ ] T1: decoder + types + synthesis rules + materialize→entries — commit 1
- [ ] T2: shared accessors + agent-config mutators (commit 2) + corrupt-wipe fix (commit 3)
- [ ] CHECKPOINT A: full `bun run lint` + `bun run test` green

## Phase 2 — Write paths
- [ ] T3: model-routing setAgentModels → entries + applyRoutingPolicy pin — commit 4
- [ ] T4: memory workspacePath → shared shape-lookup — commit 5
- [ ] T5: creation path + adoption regression — commit 6

## Phase 3 — Mock + rig
- [ ] T6: crab fixture/seed-enrich + rig normalizer + pins — commit 7
- [ ] CHECKPOINT B: full suite + lint green

## Phase 4 — Close
- [ ] T7: live read-only verification against real ~/.openclaw (10 agents)
- [ ] T8: docs + final gate + PR — commit 8
