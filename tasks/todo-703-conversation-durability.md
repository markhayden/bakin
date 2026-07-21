# TODO — Issue #703 (see tasks/plan-703-conversation-durability.md for detail)

## PR 1 — bakin (`feat/703-conversation-turn-engine`)
- [ ] E1: kit turn service (engine) + lifecycle tests
- [ ] E2: useConversationThread hook + tests
- [ ] E3: attention rules + badge provider kit + tests
- [ ] C1: chat server on engine — chat tests byte-identical + green
- [ ] C2a: NEW characterization tests for current useChatStream (pass pre-swap)
- [ ] C2b: chat client wrapper — characterization + frozen tests green
- [ ] C3: chat attention facade — attention tests byte-identical + green
- [ ] B1: brands durable brainstorm (server + client) + tests
- [ ] D1: knowledge docs (conversation-kit, chat-plugin, brands-plugin)
- [ ] GATE: full suite green; chat-test diff empty (incl. tests/integration/pi/chat-on-pi.test.ts); Mark live-approves chat parity + brands on 3737

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
