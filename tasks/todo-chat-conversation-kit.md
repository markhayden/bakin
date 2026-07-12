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

## Phase 8 — bits migration (bakin-bits-official, branch feat/conversation-kit)
- [x] T8.0 chore: .build-sdk link (local SDK build 0.0.1-rc.5-kit.0) + test-sdk stub updates — bits 112f37c
- [x] T8.1 feat(projects): brainstorm on the kit (stored rows migrated to ConversationMessage) — bits 37b7b44
- [x] T8.2 feat(messaging): brainstorm-view + plan-workspace on the kit (proposal onCustom bridge, readOnly, layout parity; keeps its own SessionMessage storage) — bits 0d96481
- [x] **CHECKPOINT F** — bits suite 408 green, both plugins build against the kit SDK, grep gate clean. REMAINING: .build-sdk must repoint to the published rc at SDK release; linked visual pass folds into the rig session

## Phase 9 — Deletion + docs (bakin)
- [x] T9.1 refactor(sdk)!: delete IntegratedBrainstorm + brainstorm utils (grep gate clean; vendors 1484 KB) — af715e14
- [x] T9.2 docs: chat-plugin.md rewrite, NEW conversation-kit.md, CLAUDE.md, shared-ui-patterns, docs site + regenerated references (45 pages validated), README untouched (no chat refs) — 4f3744af
- [x] **FINAL CHECKPOINT (code)** — bakin suite 6606/0 clean exit, typecheck clean, both repos green

## Remaining for the user session
- [ ] Rig visual pass (`bun run instance dev --mode isolated`): chat UX end-to-end (launcher, streaming, tool drawer, attention cross-page, attachments vs crab, sound), linked bits plugins
- [ ] PR strategy call: everything is ONE ordered branch (feat/chat-conversation-kit, 19 commits) — split per plan's PR-1/2/4 or ship as one PR + bits PR
- [ ] At SDK release: publish rc with the kit, repoint bits .build-sdk from the local file link, rebuild installed messaging/projects plugins
