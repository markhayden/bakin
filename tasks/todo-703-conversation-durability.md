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
- [ ] P1: projects /ask on engine (202/409/abort, metering, streaming flag) + route tests
- [ ] P2: projects client (optimistic echo, rehydration) + component tests
- [ ] P3: projects nav badge/attention provider + seen tracking
- [ ] P4: plan history sidecar + restore endpoints + unit tests
- [ ] P5: plan diff toggle + history list + restore UI + tests
- [ ] P6: plan-first prompt (shared constant, both call sites pinned)
- [ ] M1: messaging sessions on engine (proposals via onChunk, incremental persistence) + tests
- [ ] M2: messaging client + attention provider
- [ ] V1: bump projects + messaging manifest versions
- [ ] GATE: bits suite green; Mark live-approves full #703 walk on 3737

## PR 3 — bakin (`chore/703-remove-per-request-stream`)
- [ ] Z1: delete useConversationStream + sse reader + exports + tests; zero-import grep
- [ ] Z2: final docs (messaging-plugin.md, CLAUDE.md bullet); dispose SPEC.md/tasks per Mark
- [ ] GATE: suite green; live smoke; ports free
