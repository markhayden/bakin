# TODO — Issue #703 (see tasks/plan-703-conversation-durability.md for detail)

## PR 1 — bakin (`feat/703-conversation-turn-engine`)
- [x] E1: kit turn service (engine) + lifecycle tests — src/core/conversation-turns.ts, commit 0344240a8
- [x] E2: useConversationThread hook + tests — commit 3213684a6
- [x] E3: attention rules + badge provider kit + tests — commit 384d9ec41
- [x] C1: chat server on engine — chat tests byte-identical + green (60+1 tests, 0 edits)
- [x] C2a: characterization tests — commit 380801284
- [x] C2b: chat client wrapper — commit 10e761874
- [x] C3: chat attention facade + provider — attention tests byte-identical
- [x] B1: brands durable brainstorm — commits 71df0319d + ce50077c2
- [x] D1: knowledge docs — commit c1ba95aa4
- [ ] GATE: suite green ✓ (8032/0 fail), freeze diff = additions only ✓ — AWAITING Mark live-approval on 3737

## PR 2 — bakin-bits-official (`feat/703-brainstorm-durability`)
- [x] P1: projects /ask on engine — commit 7933fdf (bits)
- [x] P2: projects client — commits 7933fdf + b6d241b
- [x] P3: projects attention — commit f2ba8c7
- [x] P4: plan history — commit 7ebf1f3
- [x] P5: Changes view — commit 665ffd2
- [x] P6: plan-first prompt — commit d56c00a
- [x] M1: messaging engine turns — commit b1270a0 (+ engine onTurnComplete hook, bakin 9c06b377f)
- [x] M2: messaging client + attention (incl. plan-workspace) — commit 827d359
- [x] V1: projects 0.8.0, messaging 0.9.0 — commit 43ded14
- [ ] GATE: bits suite green ✓ (433/0 ×4) — AWAITING Mark live-approval; PR https://github.com/markhayden/bakin-bits-official/pull/89

## PR 3 — bakin (`chore/703-remove-per-request-stream`)
- [ ] Z1: delete useConversationStream + sse reader + exports + tests; zero-import grep
- [ ] Z2: final docs (messaging-plugin.md, CLAUDE.md bullet); dispose SPEC.md/tasks per Mark
- [ ] GATE: suite green; live smoke; ports free
