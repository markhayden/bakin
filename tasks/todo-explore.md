# TODO — Explore plugin (issue #163 pivot)

Branch `feat/163-workshop` off `main`. One commit per slice; each green on
`bun run typecheck` + `bun run test`. Detail + decisions: `tasks/plan-explore.md`, `SPEC.md`.

- [ ] S0 — docs checkpoint commit (SPEC.md + tasks/plan-explore.md + tasks/todo-explore.md); pivot comment on #163
- [ ] S1 — feat(sdk,host): NavItem placement:'bottom' — SDK type + manifest parseNavItem + sidebar partition (nav-placement.ts) + tests
- [ ] S2 — feat(explore): scaffold 11th core plugin — plugins/explore/ + lockstep edits (core-plugin-ids, plugin-static-imports, bakin.config, tsconfig, manifest-drift test) + dependencies.ts stale-set fix + regen embedded assets
- [ ] S3 — feat(explore): unified curated-catalog.json v2 + src/core/curated-catalog/{schema,load} + onboarding reader migration + delete /api/curated + old JSONs + preserve builder-guard tests + regen
- [ ] S4 — feat(explore): GET /catalog install-state join + browse UI (tabs/facets/cards/detail drawer, URL state)
- [ ] S5 — feat(explore): install flows — curated one-click, custom source, consent dialog (manifestChanged bounce)
- [ ] S6 — feat(explore): remote refresh (injectable fetcher, atomic cache) + ?check=1 relay + deep-links
- [ ] S7 — chore(team): delete orphaned install-dialog.tsx + fix adopt-dialog comment
- [ ] S8 — docs(knowledge): explore-plugin.md; CLAUDE.md 10→11 + placement note; plugin-system.md; repo-architecture.md; core-plugin-ids.ts header
- [ ] Final — /agent-skills:test coverage review; full suite; manual dev pass; bun run build sanity

Rules: never `git add -A` (build-stamp trap); stage `_embedded-assets-static.ts` explicitly in S2/S3; all fs-touching tests mock both content-dir resolvers + openclaw home + logger.
