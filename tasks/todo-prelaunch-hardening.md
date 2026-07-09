# Pre-Launch Battle-Hardening — Task Checklist

Canonical plan: `.claude/specs/prelaunch-hardening/PLAN.md` (spec: `SPEC.md` alongside).
Rule: one task = 1–2 green conventional commits; check off only after verification passes.

## PR 1a — feat/openclaw-push-streaming
- [ ] T1 Gateway frame fixtures + OQ2 resolution (spike)
- [ ] T2 Event-frame plumbing in gateway-rpc (caps, ack, protocol gate)
- [ ] T3 Normalized chunk taxonomy + streaming contract (R5/R5b)
- [ ] T4 OpenClaw streamChat rewrite (push events)
- [ ] T5 Server-side abort via accepted run ids
- [ ] T6 Imitation Crab event frames + streaming e2e
- [ ] T7 WS1a docs
- [ ] CHECKPOINT 1a: suite green, e2e green, PR merged
- [ ] 🔶 USER: runtime flip to OpenClaw + live validation (box stays on OpenClaw)

## PR 1b — feat/dispatch-live-activity
- [ ] T8 onActivity tap on messaging.send (both adapters)
- [ ] T9 Live task activity on board + timeline (ephemeral SSE)
- [ ] T10 Delete trajectory activity tail (forensics only)
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
