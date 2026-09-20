# TODO: #880 override scope (spec: .claude/specs/openclaw-override-scope-880.md, plan: tasks/plan-openclaw-override-880.md)

Branch: `fix/880-override-scope` · Live rig: THIS box (adapter=openclaw on 3737)

- [x] T1: perTurnModel contract (core + pi + openclaw-static + mock) — commit 1
- [x] T2: core modelClamp in applyThinkingCapability + audit — commit 2
- [x] T3: gateway-rpc admin request + granted-scope parse + downgrade + details widening — commit 3
- [x] T4: dynamic perTurnModel + admission-rejection single retry — commit 4
- [x] CHECKPOINT A: full lint + suite
- [x] T5: adapter health check + models.routing standing-clamp finding — commit 5
- [x] T6: conformance perTurnModel honesty + teeth — commit 6
- [x] CHECKPOINT B: full suite + lint + check:cycles
- [x] T7: live verify on this box (admin granted; routed turn completes)
- [x] T8: docs + PR — commit 7
- [ ] T9: POST-MERGE: prod deploy + RESTORE prod routes + close #880
