# Todo: Terminal Multi-Device

Spec: `.claude/specs/terminal-multi-device.md`
Plan: `.claude/specs/terminal-multi-device-plan.md`

Each line is one commit. Tick a checkpoint once its tag is set.

- [x] T0 Branches, bases, docs commit → `tmd/cp0`

**Bakin H1**
- [x] T1 Typed cliCommand args + plugin-id dispatch
- [x] T2 Interactive launch mode + confirm handshake
- [x] T3 H1 docs
- [x] Checkpoint H1 → `tmd/cp1` (full suite, 2× Codex, PR opened with do-not-merge)

**Bakin H2**
- [x] T4 Socket-route contract + SDK harness
- [x] T5 Upgrade handler (`server.ts` + `ws`) + admission + lifecycle
- [x] T6 Real-socket integration + H2 docs
- [x] Checkpoint H2 → `tmd/cp2`

**Bits B0** (merged and released first)
- [x] T7 messaging/projects arg declarations + patch bumps (PR #125; merge + release still pending)

**Bits B1**
- [x] T8 CI pin, test-sdk, version alignment (0.4.0-dev.1)
- [x] T9 Managed-only service, generated conf, fingerprint, Health incident
- [x] T10 Control-mode client
- [x] T11 Bridge rewire (ignore-size, send-keys, push output)
- [x] Checkpoint B1 → `tmd/cp3` (incl. mandatory real-tmux run)

**Bits B2**
- [x] T12 Server socket protocol (alongside SSE)
- [x] T13 Client socket + delete SSE/POST + reconnect baseline
- [ ] T24b H3 CSS sync + repin
- [x] Checkpoint B2 → `tmd/cp4`

**Bits B3**
- [x] T14 Sizing server (claim/resize, defaultSize, agent resize removed)
- [x] T15 Viewer rendering (fit/pan/pinch/follow/header)
- [ ] T24b H3 CSS sync + repin
- [x] Checkpoint B3 → `tmd/cp5` (optional early live preview)

**Bits B4**
- [ ] T16a CLI commands
- [ ] T16b Attach admission + ownership
- [ ] T16c Native size authority
- [ ] T17 Handoff UI + README
- [ ] T24b H3 CSS sync + repin
- [ ] Checkpoint B4 → `tmd/cp6`

**Bits B5**
- [ ] T18 Compose sheet
- [ ] T19 History view
- [ ] T20 Links, tap-to-copy, emoji width
- [ ] T24b H3 CSS sync + repin
- [ ] Checkpoint B5 → `tmd/cp7`

**Bits B6**
- [ ] T21 Attention server (resolve open questions 1–2 first)
- [ ] T22 Attention client
- [ ] T23a Upload storage and lifecycle
- [ ] T23b Image draft UI + readability
- [ ] T24b H3 CSS sync + repin
- [ ] Checkpoint B6 → `tmd/cp8`

**Completion**
- [ ] T24 Docs sweep + evidence
- [ ] T25 Final gates + `publish.yml` pinned ref
- [ ] T26 Maintenance cutover + live checklist (with Mark)
- [ ] T27 Merge + release + installed-artifact smoke (with Mark)
