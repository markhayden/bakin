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
- [x] GATE: Mark live-approved; PR #704 MERGED 2026-07-21

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
- [x] GATE: Mark live-approved; bits PR #89 MERGED 2026-07-21

## PR 3 — bakin (`chore/703-remove-per-request-stream`)
- [x] Z1: legacy per-request path deleted; zero-import grep clean
- [x] Z2: docs final pass (messaging-plugin.md, CLAUDE.md, conversation-kit.md); spec/plan/todo kept in tasks/ per repo convention
- [ ] GATE: PR 3 suite green + Mark smoke on 3737
