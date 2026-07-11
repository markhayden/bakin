# TODO — Dual-runtime dev rig

Plan: ./plan.md · Spec: /SPEC.md · Branch: feat/dev-rig-dual-runtime

- [ ] T1 docs(specs): spec + plan committed, old SPEC.md archived to tasks/gate-discord/
- [ ] T2 feat(core): BAKIN_RUNTIME_ADAPTER override in getSettings() + tests  ← checkpoint A (with T3)
- [ ] T3 feat(assets): BAKIN_AGENT_PATH_MAP translation (assets_save + image refs) + tests
- [ ] T4 feat(instance): --runtime matrix in args/paths/modes + arch-test allows + gitignore
- [ ] T5 feat(instance): pi lifecycle (/login TUI, default model), dev → scripts/dev.ts HMR  ← checkpoint B
- [ ] T6 feat(instance): rig antfly child (3838) + LaunchAgent guard test
- [ ] T7 feat(instance): sandbox-pi compose service + exec routing  ← checkpoint C
- [ ] T8 fix(rig): remediate live io.bakin.antfly clobber (coordinate: stop isolated dev server first) + audit fixes
- [ ] T9 docs: dev-rig.md rename + README/CLAUDE.md/pi-adapter/assets/search sweep
- [ ] T10 test: full suite + tests/dev + live E2E matrix (evidence below)

## Live E2E evidence (T10)

- [ ] native×oc: container deliverable → asset via translation → indexed
- [ ] isolated×oc: asset flow + search on 3838 + plist byte-identical (hash: ______)
- [ ] isolated×pi: /login → dispatch → asset → search
- [ ] native×pi: boot + turn smoke
- [ ] sandbox×pi: onboard + turn smoke
- [ ] validate.ts campaign (openclaw)
- [ ] reset scoping: real homes + plist untouched (hashes: ______)

## Coordination points (Mark)

- [ ] /login once for the shared dev pi-home (T5 or T10)
- [ ] Stop the running isolated dev server before T8 remediation
- [ ] ChatGPT /login recommended (gives Pi image gen+edit for free)
