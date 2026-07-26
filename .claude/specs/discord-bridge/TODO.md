# Discord Bridge — TODO

Plan: `.claude/specs/discord-bridge/PLAN.md`

## Phase A — Delivery bridge (branch: feat/discord-bridge)
- [x] A0 Compile spike: @discordjs stack under bun build --compile (scratchpad)
      PASS 2026-07-26 — compiled binary hit READY as the live bot, REST listed
      12 guild channels, clean shutdown; all 4 intents accepted (MESSAGE_CONTENT
      enabled); zero native optional deps. D2 stands, no fallback needed.
- [x] A1 Neutral ChannelBridge contract + AdapterInitOpts.channelBridge
- [x] A2 settings.integrations.discord + config module + System & Alerts fields
- [x] A3 Discord client lifecycle + boot gating + arch confinement
- [x] A4 Send surface (embeds/content/threads/edits/DM/chunking/retry) + audit
- [x] A5 Approval cards + modal reject + allowlist → ApprovalResolveEvent
- [x] A6 adapter-pi delegation ('shimmed') + conformance pin + gate round-trip test
- [x] A7 delivery.discord doctor check (Integrations & Keys already handles named secrets — no UI change needed)
- [x] A8 Docs sweep (delivery-bridge.md, pi-adapter fix, CLAUDE.md, §10.1; README has no channel claims — no change needed)
- [ ] CHECKPOINT 1: live validation runbook + owner sign-off + PR 1 merged

## Phase B — Inbound chat (branch: feat/discord-inbound-chat)
- [ ] B1 subscribeInboundMessages contract + bridge inbound gating + attachments
- [ ] B2 Chat plugin wiring: channel↔chat map, turn engine, typing, reply
- [ ] B3 Docs + #669 close-out comment
- [ ] CHECKPOINT 2: live validation + owner sign-off + PR 2 merged
