# TODO: Chat Conversation Kit & Chat Overhaul

Plan: `tasks/plan-chat-conversation-kit.md` · Spec: `.claude/specs/chat-conversation-kit.md`

## Phase 1 — Foundations
- [x] T1.1 feat(sdk): markdown media + syntax highlighting (curated langs, copy button, lightbox images, video, safe links) — f2ce3d87
- [x] T1.2 refactor(core): extract shared image downscale from assets enrichment — 7fd800e9

## Phase 2 — Fold engine
- [x] T2.1 feat(sdk): conversation turn model + foldConversation (exhaustive unit suite; subsumes foldTurnChunks / brainstorm activity / use-chat-data coalescing) — 812321f6

## Phase 3 — Kit components
- [x] T3.1 feat(sdk): Conversation / UserMessage / AgentTurn / ThinkingIndicator / ConversationEmptyState — 06d3d774
- [x] T3.2 feat(sdk): ActivityGroup + ToolCallDrawer — b505fe42
- [x] T3.3 feat(sdk): Composer (resize, history, drafts, typing-never-blocked, attachments UI, char counter) — e73b2d93
- [x] T3.4 feat(sdk): ConversationPanel + useConversationStream + readSseStream + server helpers (embedded-mode API contract test) — e0548038
- [x] T3.5 refactor(sdk): TurnOutputView as kit wrapper (tasks/workflows consumers unchanged) — 40e0a7f6
- [x] **CHECKPOINT A** — suite 6672 green + typecheck + vendors/plugins/host build clean (visual pass deferred to Checkpoint B dev:mock session) — 40e0a7f6

## Phase 4 — Chat core
- [x] T4.1 feat(chat): transcript v2 + structured persistence + abort + seen/rename/pin routes + unreadCount — 38afce21
- [x] T4.2 feat(chat): page rebuild on the kit (rail, launcher, draft mode, composer wiring, shortcuts, contrast fix) — 4fe05922
- [x] T4.3 feat(chat): auto-titles (fallback + budget-gated LLM) — ca824552
- [x] **CHECKPOINT B** — suite 6694 green; /verify isolated REST drive PASSED (create/202-send/rename+pin/seen/abort-409/list unreadCount+streaming/delete; v2 error row with typed errorKind persisted e2e). Live mock-turn drive not possible on this machine: adapter gateway port is hardcoded 18789 and the REAL gateway owns it — full turn e2e + visual pass deferred to the dockerized rig (--mode isolated) at Checkpoint E

## Phase 5 — Attention
- [x] T5.1 feat(chat): badge provider, unread store, toast, sound, OS notification, tab title — f01a24ea
- [x] **CHECKPOINT C** — attention rules + provider pinned by tests; cross-page visual demo folded into the Checkpoint E rig session. NOTE: full-suite runs on the loaded machine intermittently 900s-timeout random unrelated files (all pass in isolation; timeouts, never assertions)

## Phase 6 — Attachments
- [x] T6.1 feat(chat): attachment upload + serving routes — cee66136
- [x] T6.2 feat(chat): send through runtime (capability gate, downscale, replay thumbnails) — cee66136
- [x] T6.3 test(runtime): conformance mock + imitation-crab attachment coverage (tests/dev/ run explicitly: 46 green) — 098c2352
- [x] **CHECKPOINT D** — chat suite 46 green, conformance 49 green, typecheck clean

## Phase 7 — Search
- [x] T7.1 feat(chat): transcripts as search content type + ⌘K hit renderer — 01f287d7
- [x] **CHECKPOINT E (core gates)** — suite 6716 green (recurring onboarding-adapter-gating 15s-timeout flake only; passes isolated), asset chain + assert-production-assets pass, guest-guarded isolated boot serves chat page/bundle/11 routes/both slots, antfly guard held. Rig visual pass + PR opening pending user session

## Phase 8 — bits migration (bakin-bits-official)
- [ ] T8.0 chore: .build-sdk link + test-sdk stub updates
- [ ] T8.1 feat(projects): brainstorm on the kit
- [ ] T8.2 feat(messaging): brainstorm-view + plan-workspace on the kit (proposal events, readOnly, layout parity)
- [ ] **CHECKPOINT F** — bits tests + builds + linked visual pass → PR-3 merge, rebuild installed plugins

## Phase 9 — Deletion + docs (bakin)
- [ ] T9.1 refactor(sdk)!: delete IntegratedBrainstorm + brainstorm utils (grep gate, size delta)
- [ ] T9.2 docs: chat-plugin.md rewrite, NEW conversation-kit.md, CLAUDE.md, repo-architecture, docs site, README check
- [ ] **FINAL CHECKPOINT** — both repos green, docs true → PR-4 merge
