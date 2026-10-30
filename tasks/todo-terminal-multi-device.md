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
- [x] T15b Follow controls → top-right ↓ Live pill + three follow states (live-test fix, 2026-10-27)
- [ ] T24b H3 CSS sync + repin
- [x] Checkpoint B3 → `tmd/cp5` (optional early live preview)

**Bits B4** (#133; H1 gained caller {cwd, cols, rows}, refuseEnv, recovery)
- [x] T16a CLI commands
- [x] T16b Attach admission + ownership
- [x] T16c Native size authority
- [x] T17 Handoff UI + README (attach command in Details with CopyButton)
- [ ] T24b H3 CSS sync + repin
- [x] Checkpoint B4 → `tmd/cp6` (8 Codex rounds; live test at the cutover)

**Bits B5**
- [x] ~~T18a v1 key bar (86a5a1a) — failed live iPhone test, replaced by v2~~
- [x] T18a Key bar v2 foundation (session state, keycaps, ⌃/⌥ modifiers + encoding, hide keyboard)
- [x] T18c ••• key sheet (abc, lock toggles)
- [x] Physical iPhone checkpoint #1 (Mark, Home Screen + Safari tab) — follow-ups shipped: Return hides, hidden-cursor follow, bottom padding, one-word chip
- [x] T18b Arrow joystick (long-press locks: sheet lock toggles instead)
- [x] T18d Kit recipe update (bakin 0ace3a54d … 972daf0dc + bits b0f33af keycaps → kit Buttons; 4 Codex rounds)
- [x] T18 Compose sheet (opened from •••) (6a9acec … e624ff4; 4 Codex rounds; tmux now decides bracketed paste for every browser paste)
- [-] T19b Pin editing — deferred (decision 5: spec says Later)
- [x] T20 Links (f0e2ddc) + kit CopyButton touch size (bakin 9265199a0, 2 Codex rounds); terminal tap-to-copy moved to T36b (B5 has no output clipboard write to fall back from; Mark confirmed 2026-10-28)
- [ ] T24b H3 CSS sync + repin
- [ ] Checkpoint B5 → `tmd/cp7`

**Phase 8R: raw-output transport (spec D13; ≥2 Codex rounds per task; stack B5 → R1 → R2 → R3 → B6)**
- [x] xterm 6.0.0 erase-above crash fix + parser guard (B3: f347056, 3ccd66a; review fixes 7c3d0a2, 4be3341)
- [x] T30 Terminal profile module (R1: ce411b3; review fixes 52f4826)
- [x] T30b Profile owns terminal config (10k scrollback, Unicode 15 graphemes + generated tmux widths, UTF-8 boundaries, tmux width parity; 52f4826 + round-1 fixes)
- [x] T31a Control-mode output streaming + ordered event log (R1: 8747b2e, 848b856, 4cc8d47; 3 Codex rounds)
- [x] T31b Command/output coexistence on one control client (R1: 055a61d, f561941, eee03ad; B5 fixes c89278e store totals, 03db1cc Screen coalescing; 3 Codex rounds)
- [x] T31c Reseed core (SEED_CMD boundary) (R1: b147fb8, e8d38bf, e682ccd, 73aa132, 976bf84; 2 rounds + 3 confirming; adds patchSharedTabStops)
- [x] T32a Checkpoint serializer (R1: f10d3ca, 85a61ac, c314bc3, bfa23ac; 3 rounds + clean confirm)
- [x] T32b Full-state verifier + fuzz in CI (R1: c930f34 … 8459d6b; 2 rounds + 4 confirming; CI four-shard fuzz job; decoder + chunked-print-clear fixes)
- [x] T32c Replica + tail + cadence + shadow mode (R1: fb3aa7f, 9fbf2fa, ca90e4b; review fixes ba0f675, 5e3b4df; overload rebuilds after measuring tmux 40 MB/s vs replica 21 MB/s; product decisions 1–3 open for Mark before T33, spec D13 Bounded load)
- [x] T32d Memory budget + warning (R1: 27b0379, d4eae94, 5165ec7, 97d4bd3; 4 Codex rounds) — retained 27.4 MB with a full tail, live peak 79.4 MB; 32 MB is a reference-workload target (metadata-dense content recorded); tmux cell limit; 640 MB Health warning
- [ ] Checkpoint R1 → `tmd/r1`
- [x] T33 Socket protocol v2 (join) — R2: 33a replica subscription, 33b raw-display viewer, 33c client (streamed restore, raw-picture queue, fresh terminal per picture), 33d input health + browser gates, 33e overload freshness (screen-only seeds, quiet history restore; freshness p95 ~1.0 s); dormant until T38a; decision 7 (heap figure) settled 2026-10-28: growth after fill ≤ 8 MiB, total within the 96 MB peak
- [x] T34a Width-change rebase + one ordered resize source
- [x] T34b Service update: scroll-on-clear off
- [x] T35a Recovery banner
- [x] T35b Final bundle persistence, ended sessions + rollback contract (post-T38b rollback items deferred to T38b)
- [x] T37 Digest safety net
- [x] T38a Opt-in raw path (setting, default off; latched per session)
- [x] Checkpoint R2 → `tmd/r2` (Bits e19a5d0, local; no CSS change or repin needed)
- [ ] T36 Native scrolling, follow, gestures
- [ ] T36b Clipboard offers (copy on tap) — the terminal's tap-to-copy, CopyButton size="touch"; also decide whether the T35a recovery banner collapses on phones (Mark: my call)
- [ ] Checkpoint R3 → Mark's manual end-to-end acceptance
- [x] T38b Delete the bridge (after acceptance) — Bits 0.4.0-dev.24, Codex 3 rounds

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
