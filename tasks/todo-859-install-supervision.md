# TODO: #859 install supervision (W1 of antfly follow-ups)

Plan: `.claude/specs/search-install-supervision-plan.md`

- [ ] T1: startService bootstraps on kickstart failure (+tests) — commit 1
- [ ] T2: ensure unchanged-path verify-loaded, action 'reloaded' (+tests) — commit 2
- [ ] CP1: suite + typecheck + lint green per commit
- [ ] T3: waitForEngineReady extraction + 60s gate on upgrade/already-installed (+tests) — commit 3
- [ ] T4: knowledge doc + #859 root-cause comment
- [ ] CP2: PR open; Mark live pass (manual bootout self-heal + clean install re-run); merge; update memory note

Queued next: W2 #845 (spec pending) → W3 #847 → W4 #846 → W5 #849
