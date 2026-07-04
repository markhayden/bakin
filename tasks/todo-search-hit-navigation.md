# TODO: search-hit-navigation

Spec: `.claude/specs/search-hit-navigation.md` · Plan: `tasks/plan-search-hit-navigation.md`
Branch: `fix/search-hit-navigation`

- [x] T1 Overlay: inert null-href hits (test-first) — commit 1 `fix(host): render null-href search hits as inert`
- [x] T2 Schedule renderer → `?jobId=` drawer + manifest 1.0.1 — commit 2 `feat(schedule): add search hit renderer deep-linking to job drawer`
- [x] T3 Team: `agents`→`team` key, `agent_id` fix, `?lessonId=` highlight + manifest 1.0.2 — commit 3 `fix(team): search hits — team renderer key, lesson agent_id, exact-lesson deep link`
- [x] T4 Memory: `/record` route, `?recordId=` drawer, renderer href + manifest 2.0.2 — commit 4 `feat(memory): exact-record deep link — /record route + ?recordId= drawer`
- [x] T5 Contract test (red-checked against reverted team-key fix) — commit 5 `test(plugins): contract — every content type has a working hit renderer`
- [x] T6 Knowledge docs + spec status + README check (no impact) — commit 6 `docs(search): hit-renderer contract, memory record deep link`
- [x] T7 (found in browser verify): lazy plugin clients never registered renderers until page visit — `requestAllPlugins()` on overlay open — commit 7 `fix(host): load all lazy plugin clients when the search overlay opens`
- [ ] Final gate: full suite green, manual 4-type click-through (schedule ✓, lessons ✓, memory ✓ incl. not-found ✓), ports clean, open PR
