# TODO: Chat Conversation Kit & Chat Overhaul

Plan: `tasks/plan-chat-conversation-kit.md` · Spec: `.claude/specs/chat-conversation-kit.md`

## Phase 1 — Foundations
- [ ] T1.1 feat(sdk): markdown media + syntax highlighting (curated langs, copy button, lightbox images, video, safe links)
- [ ] T1.2 refactor(core): extract shared image downscale from assets enrichment

## Phase 2 — Fold engine
- [ ] T2.1 feat(sdk): conversation turn model + foldConversation (exhaustive unit suite; subsumes foldTurnChunks / brainstorm activity / use-chat-data coalescing)

## Phase 3 — Kit components
- [ ] T3.1 feat(sdk): Conversation / UserMessage / AgentTurn / ThinkingIndicator / ConversationEmptyState
- [ ] T3.2 feat(sdk): ActivityGroup + ToolCallDrawer
- [ ] T3.3 feat(sdk): Composer (resize, history, drafts, typing-never-blocked, attachments UI, char counter)
- [ ] T3.4 feat(sdk): ConversationPanel + useConversationStream + readSseStream + server helpers (embedded-mode API contract test)
- [ ] T3.5 refactor(sdk): TurnOutputView as kit wrapper (tasks/workflows consumers unchanged)
- [ ] **CHECKPOINT A** — suite + build + dev:mock (tasks/workflows) → open PR-1

## Phase 4 — Chat core
- [ ] T4.1 feat(chat): transcript v2 + structured persistence + abort + seen/rename/pin routes + unreadCount
- [ ] T4.2 feat(chat): page rebuild on the kit (rail, launcher, draft mode, composer wiring, shortcuts, contrast fix)
- [ ] T4.3 feat(chat): auto-titles (fallback + budget-gated LLM)
- [ ] **CHECKPOINT B** — suite + /verify + dev:mock (chat)

## Phase 5 — Attention
- [ ] T5.1 feat(chat): badge provider, unread store, toast, sound, OS notification, tab title
- [ ] **CHECKPOINT C** — cross-page attention demo in dev:mock

## Phase 6 — Attachments
- [ ] T6.1 feat(chat): attachment upload + serving routes
- [ ] T6.2 feat(chat): send through runtime (capability gate, downscale, replay thumbnails)
- [ ] T6.3 test(runtime): conformance mock + imitation-crab attachment coverage (run tests/dev/ explicitly)
- [ ] **CHECKPOINT D**

## Phase 7 — Search
- [ ] T7.1 feat(chat): transcripts as search content type + ⌘K hit renderer
- [ ] **CHECKPOINT E** — full suite + build + /verify + full visual pass → open PR-2

## Phase 8 — bits migration (bakin-bits-official)
- [ ] T8.0 chore: .build-sdk link + test-sdk stub updates
- [ ] T8.1 feat(projects): brainstorm on the kit
- [ ] T8.2 feat(messaging): brainstorm-view + plan-workspace on the kit (proposal events, readOnly, layout parity)
- [ ] **CHECKPOINT F** — bits tests + builds + linked visual pass → PR-3 merge, rebuild installed plugins

## Phase 9 — Deletion + docs (bakin)
- [ ] T9.1 refactor(sdk)!: delete IntegratedBrainstorm + brainstorm utils (grep gate, size delta)
- [ ] T9.2 docs: chat-plugin.md rewrite, NEW conversation-kit.md, CLAUDE.md, repo-architecture, docs site, README check
- [ ] **FINAL CHECKPOINT** — both repos green, docs true → PR-4 merge
