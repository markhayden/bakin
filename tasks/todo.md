# TODO — WS1 refactor/contract-types

Branch `refactor/contract-types` off `main`. One commit per task; each green on
`bun run test` + `bun run typecheck`. Detail + crux decision: `tasks/plan.md`.

Decision (forced by the SDK's self-contained publish constraint): **SDK types module is the
single canonical home for all shared contract types; core re-exports from it.**

## Phase A — unify (kills the drift)
- [x] A0 — delete 7 verified-dead files (~620 LOC); re-verify deadness at HEAD
- [x] A1 — health-check contract family → SDK canonical, core re-exports
- [x] A2 — exec-tool types → SDK canonical
- [x] A3 — search API contract → SDK canonical
- [x] A4 — manifest contract (core's PluginManifest is stale) → drop core copy, re-export SDK
- [x] A5 — PluginContext + BakinPlugin (RISKY: runtime-adapter surface) → SDK canonical
- [x] A6 — Task / TaskLogEntry (add updatedAt/version to SDK) → single-home in SDK
- [x] A7 — AvailableModel (reconcile required-ness) → SDK canonical
- [x] A8 — WorkflowInstance/Def (fix id→instanceId wire shape) → SDK canonical
- [x] A9 — AgentUsage → SDK type-only + drop plugin-dir-escaping import
- [x] A10 — strip src/types residue to its 3 live types

## Phase B — split (pure reorg)
- [ ] B1 — split sdk/types/index.ts → primitives/manifest/runtime/services/registration/context (+ barrel)
- [~] B2 — MOOT: unification shrank core/plugin-types.ts 1129→738 lines (under the 800 threshold); split no longer warranted

## PR gate
- [ ] test + typecheck + lint + full build green; SDK publish guard clean; boot smoke; doc sweep → open PR
