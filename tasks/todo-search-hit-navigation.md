# TODO: search-hit-navigation

Spec: `.claude/specs/search-hit-navigation.md` · Plan: `tasks/plan-search-hit-navigation.md`
Branch: `fix/search-hit-navigation`

- [ ] T1 Overlay: inert null-href hits (test-first) — commit 1 `fix(host): render null-href search hits as inert`
- [ ] T2 Schedule renderer → `?jobId=` drawer + manifest 1.0.1 — commit 2 `feat(schedule): add search hit renderer deep-linking to job drawer`
- [ ] T3 Team: `agents`→`team` key, `agent_id` fix, `?lessonId=` highlight + manifest 1.0.2 — commit 3 `fix(team): search hits — team renderer key, lesson agent_id, exact-lesson deep link`
- [ ] T4 Memory: `/record` route, `?recordId=` drawer, renderer href + manifest 2.0.2 — commit 4 `feat(memory): exact-record deep link — /record route + ?recordId= drawer`
- [ ] T5 Contract test (red-check against reverted fixes first) — commit 5 `test(plugins): contract — every content type has a working hit renderer`
- [ ] T6 Knowledge docs + spec status + README check — commit 6 `docs(search): hit-renderer contract, memory record deep link`
- [ ] Final gate: full suite green, manual 4-type click-through, ports clean, open PR
