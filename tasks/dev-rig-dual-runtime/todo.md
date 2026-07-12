# TODO — Dual-runtime dev rig

Plan: ./plan.md · Spec: /SPEC.md · Branch: feat/dev-rig-dual-runtime

- [x] T1 docs(specs): spec + plan committed, old SPEC.md archived to tasks/gate-discord/ (76b519fd)
- [x] T2 feat(core): BAKIN_RUNTIME_ADAPTER override in getSettings() + tests (12ee9318)  ← checkpoint A (with T3)
- [x] T3 feat(assets): BAKIN_AGENT_PATH_MAP translation (assets_save + image refs) + tests (f7b802af)
- [x] T4 feat(instance): --runtime matrix in args/paths/modes + arch-test allows + gitignore (0bf9b7e7)
- [x] T5 feat(instance): pi lifecycle (/login TUI, default model), dev → scripts/dev.ts HMR (e082845d)  ← checkpoint B
- [x] T6 feat(instance): rig antfly child (3838) + LaunchAgent guard test (9c0be502; live-probed: ready on 3838, clean stop)
- [x] T7 feat(instance): sandbox-pi compose service + exec routing (2d1b52cc; profile validates)  ← checkpoint C
- [x] T8 fix(rig): remediated 2026-07-12 — stopped isolated dev server (pid 10118), ran the adapter's own
      ensureProvisioned from the real home (mode launchd, action "restarted"); plist AND running process
      (pid 93737) now carry --data-dir /Users/markhayden/.bakin/antfly.
      Baseline plist sha256: b8abfe63e81fcc41363de8795b9475e9b70348ba02cd3d86b02cc319d413fb71
- [x] T9 docs: dev-rig.md rename + README/CLAUDE.md/pi-adapter/assets/search sweep (bdec3428)
- [ ] T10 test: full suite ✅ (6560 pass/0 fail) + tests/dev ✅ (46 pass) + live E2E matrix (evidence below)

## Live E2E evidence (T10)

- [x] isolated×oc (2026-07-12, after Codex re-auth via `instance up`): settings re-patched
      openclaw (runtime switch on one instance works) → dev booted openclaw + rig antfly →
      task 83a84d47 dispatched through the gateway → agent wrote the CONTAINER path
      /home/node/.openclaw/workspace/oc-rig-proof.md → bakin_exec_assets_save succeeded via
      BAKIN_AGENT_PATH_MAP (asset 20260712-text-a492bc1f v1; manifest source.path = the
      TRANSLATED host path) → indexed + searchable on 3838. Plist byte-identical
      (b8abfe63e81fcc41…). This exact call was the documented pre-initiative failure.
- [~] native×oc flow: same code path as isolated×oc (identical hostEnv incl. translation map;
      only BAKIN_HOME differs) — covered by the isolated live proof + unit matrix.
- [x] isolated×pi (2026-07-12): up idempotent (login skipped, model seeded openai-codex/gpt-5.5) →
      dev booted Pi (imageGen native) with rig antfly on 3838 → task 72bca7dc dispatched → agent
      wrote rig-proof.md → bakin_exec_assets_save → asset 20260712-text-d9ce4c44 v1
      (source.path = pi workspace) → indexed + searchable (bakin_assets hit on 3838).
      Found+fixed live: antfly data dir must be {home}/antfly (c3a118a0) — reattach proved
      (11 tables back, outbox drained). Plist byte-identical throughout
      (b8abfe63e81fcc41…); real antfly data-dir stayed ~/.bakin/antfly. Antfly child
      started/stopped with the server (clean exits).
- [x] native×pi (2026-07-12): booted real ~/.bakin on Pi via env override (board quiet —
      2 archived tasks); Active runtime: pi; real settings.json still {} after; plist unchanged;
      real antfly serving real home. Clean stop.
- [ ] sandbox×pi: needs in-container /login (user TTY)
- [x] validate.ts campaign (2026-07-12): 18/18 after fixing R5.2's uncaught sidecar-startup
      window (8f2afd4b; reproduced twice, retried transient-only). R7.1/R7.2: abort workaround
      still required — upstream defect STANDS. Exit-1-after-clean-summary fixed too
      (late-attached drill rejection handler + explicit exit code): verified exit=0, 18/18.
- [~] reset scoping: unit-pinned (resetTargets provably under dev/; lifecycle wipe tests).
      Live reset deliberately NOT run — it wipes Codex + Pi auth (re-login cost). Run any time
      with: hash real dirs → `instance reset --mode isolated` → compare.

## Coordination points (Mark)

- [ ] /login once for the shared dev pi-home (T5 or T10)
- [ ] Stop the running isolated dev server before T8 remediation
- [ ] ChatGPT /login recommended (gives Pi image gen+edit for free)
