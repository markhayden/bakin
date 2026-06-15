# TODO — WS2 refactor/core-extractions

Branch `refactor/core-extractions` off `main`. One commit per task; each green on
`bun run test` + `bun run typecheck`. Detail + decisions: `tasks/plan.md`.

Respect the WS1 two-tier type contract. `madge --circular` is the cycle-break gate.

## Phase K — structural (break the cycle)
- [x] K1 — extract hook-registry singleton to a leaf module ✅
- [x] K2 — move scripts/lib/registry.ts → src/core/exec-tools/ ✅ (18→6 cycles; scripts/lib cluster gone)
- [x] K3 — unify the PluginContext factory (converged updateSettings notify) ✅
- [x] K4 — madge gate: scripts/lib cluster gone ✅
- [x] K5′ — extract plugin-skill registry to a leaf (breaks the workflow cycle) ✅ 18→4 cycles
- [~] K5-boundary — DEFERRED to WS6: move workflow registries → packages/core (intertwined with the workflows-plugin split; node-type-registry mixes machinery + 280 lines of domain schemas)
- [~] K6 — DEFERRED to WS6: images→assets boundary. Same cross-plugin class; routing via hooks forces a sync→async ripple across ~6 image fns; the alt (promote 835-line asset-service to core) is a WS5/6 move. Fits the workflows/assets restructure.

## Phase D — dedup extractions (independent, low-risk)
- [x] D1 — settings-store (5 sites) ✅ (caught+fixed a latent factory persist bug)
- [x] D2 — promote atomicWriteJson → storage/ (4 JSON sites) ✅
- [x] D3 — frontmatter/skill/lesson parser module ✅
- [x] D4 — shared healthOk/warn/error/fixed constructors (13 sites) ✅

## Phase G — lock it in
- [x] G1 — architecture guard: packages/sdk in SCAN_ROOTS ✅

## PR gate — PART 1 (cycle break + settings-store + atomic-write)
- [x] test + typecheck + lint + build + madge (18→4, runtime clusters gone) + boot smoke + docs → PR opened

## Deferred to follow-up PRs
- (8) gate runtime.config.get/replace — adapter-API design; its own PR (+ its guard)
- WS6: K5-boundary (workflow registries → core) + K6 (images→assets) + the cross-plugin/core→plugin import guards
