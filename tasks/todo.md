# TODO — WS2 refactor/core-extractions

Branch `refactor/core-extractions` off `main`. One commit per task; each green on
`bun run test` + `bun run typecheck`. Detail + decisions: `tasks/plan.md`.

No behavior change except K6 (images→assets boundary) and D1 (settings-notify convergence).
Respect the WS1 two-tier type contract. `madge --circular` is the cycle-break gate.

## Phase K — structural (break the cycle + the boundary)
- [ ] K1 — extract hook-registry singleton to a leaf module (removes the registry back-edge)
- [ ] K2 — move scripts/lib/registry.ts → src/core/exec-tools/ (5 importers repointed)
- [ ] K3 — unify the PluginContext factory (buildContext + buildCtx; converge updateSettings)
- [ ] K4 — madge gate: scripts/lib cluster (cycles 5-17,16) gone; iterate leaf extractions if not
- [ ] K5 — move workflow source/node-type/notification-channel registries → packages/core (cycle 4 + boundary)
- [ ] K6 — fix images→assets direct import (route via assets hooks)

## Phase D — dedup extractions (independent, low-risk)
- [ ] D1 — settings-store (5 sites, converge notification)
- [ ] D2 — promote atomicWriteJson → storage/ (JSON sites only; NOT log-rotation/binary)
- [ ] D3 — frontmatter/skill/lesson parser module (regex ×11, parseSkillFile ×3, lesson ×4)
- [ ] D4 — shared healthOk/warn/error constructors (13+ sites)

## Phase G — lock it in
- [ ] G1 — architecture guards: packages/sdk in SCAN_ROOTS + cross-plugin-import rule (prove it bites)

## PR gate
- [ ] test + typecheck + lint + build + madge-clean + boot smoke + docs → open PR

## Deferred decision (not in this PR unless you say so)
- [ ] (8) gate runtime.config.get/replace — adapter-API design; recommend its own PR (+ its guard)
