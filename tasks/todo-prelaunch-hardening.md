# Pre-Launch Battle-Hardening — Task Checklist

Canonical plan: `.claude/specs/prelaunch-hardening/PLAN.md` (spec: `SPEC.md` alongside).
Rule: one task = 1–2 green conventional commits; check off only after verification passes.

## PR 1a — feat/openclaw-push-streaming
- [x] T1 Gateway frame fixtures + OQ2 resolution (spike) ✅ (chat frames suffice for text; 5 Appendix-A corrections)
- [x] T2 Event-frame plumbing in gateway-rpc (caps, ack, protocol gate) ✅
- [x] T3 Normalized chunk taxonomy + streaming contract (R5/R5b) ✅ (ChatChunk discriminated union + format hints + typed error kind)
- [x] T4 OpenClaw streamChat rewrite (push events) ✅ (chat-frame text, tool chips from tool stream, abort=clean done)
- [x] T5 Server-side abort via accepted run ids ✅
- [x] T6 Imitation Crab event frames + streaming e2e ✅ (mock emits ack/chat/agent frames; 4-test e2e vs real adapter)
- [x] T7 WS1a docs ✅ (session-forensics, adapter-architecture R5 contract + two-seam rule + ack-keyed abort, chat-plugin, repo map, rig recorder note)
- [x] CHECKPOINT 1a: suite green ✅ / e2e green ✅ / PR merged ✅ (#632)
- [ ] 🔶 USER: runtime flip to OpenClaw + live validation (box stays on OpenClaw)

## PR 1b — feat/dispatch-live-activity
- [x] T8 onActivity tap on messaging.send (both adapters) ✅ (tool/status only; contained callbacks; OpenClaw via gateway frames, Pi via shared sessionEventChunks)
- [x] T9 Live task activity on board + timeline (ephemeral SSE) ✅ (turn-activity SSE event; board chip + team timeline live row)
- [x] T10 Delete trajectory activity tail (forensics only) ✅ (tail + mergeChatStreams + transcript-chunk path deleted; survivors → session-store.ts, poll const → trajectory-forensics)
- [ ] T11 WS1b docs
- [ ] CHECKPOINT 1b: live box shows dispatch chips; PR merged

## PR 2a — fix/sdk-golden-path (parallel worktree)
- [ ] T12 Delete manifest.entry (+ tests field); single root layout
- [ ] T13 Scaffold rewrite
- [ ] T14 Golden-path integration test + build.md tutorial fix
- [ ] T15 Host/SDK semver gate
- [ ] T16 Symmetric contributes enforcement + sync-manifest
- [ ] CHECKPOINT 2a: golden path verbatim-works; PR merged

## PR 2b — feat/sdk-testing-and-types
- [ ] T17 @makinbakin/sdk/testing
- [ ] T18 In-repo tests consume sdk/testing
- [ ] T19 Type tightening (contract commit + adoption commit)
- [ ] T20 Uniform duplicate-throw + /internal split + pluginFetch
- [ ] T21 TurnOutputView + migrate chat & step-output
- [ ] T22 Reference plugin (examples/) + CI gate
- [ ] T23 🔶 Starter-repo mirror step (ask-first: OQ1 repo name/visibility)
- [ ] T24 Public docs sweep
- [ ] CHECKPOINT 2b: success criteria #2 #3 #6; PR merged

## PR 3 — feat/runtime-conformance (after 1a AND 2b)
- [ ] T25 Conformance suite skeleton + messaging pins (3 targets)
- [ ] T26 Stream/capability/provisioning pins
- [ ] T27 Mock default flip (minimal shape) + test sweep
- [ ] T28 OpenClaw sessions.list/get for real
- [ ] T29 ping/restart/toolsAllow/oversizedOutputBytes semantics
- [ ] T30 Dead surface deletion + typed CRUD errors + arch ban
- [ ] T31 Provider-leak fixes + WS3 docs
- [ ] CHECKPOINT 3: suite = adapter acceptance gate; PR merged

## PR 4 — chore/cleanup-sweep (anytime; during WS1 soak)
- [ ] T32 Rig off mcporter (native-MCP provisioning)
- [ ] T33 Fixtures, comments, knowledge-doc drift
- [ ] T34 SDK primitive adoption sweep (ex-sdk-gaps A2/A3/A4 + useAvailableModels relocation; after PR 2b)
- [ ] CHECKPOINT 4: initiative close — all success criteria re-verified, Pi worktree retired, SPEC marked complete
