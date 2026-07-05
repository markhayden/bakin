# TODO — Explore plugin (issue #163 pivot)

Branch `feat/163-workshop` off `main`. One commit per slice; each green on
`bun run typecheck` + `bun run test`. Detail + decisions: `tasks/plan-explore.md`, `SPEC.md`.

- [x] S0 — docs checkpoint commit (db0a963e); pivot comment posted on #163
- [x] S1 — feat(sdk,host): NavItem placement:'bottom' (8cd338cc)
- [x] S2 — feat(explore): scaffold 11th core plugin (10f4197f)
- [x] S3 — feat(explore): unified curated catalog v2 + onboarding migration + delete /api/curated (0d916dd6)
- [x] S4 — feat(explore): GET /catalog install-state join + browse UI (0fb6a0db)
- [x] S5 — feat(explore): install flows + consent (21fb757e)
- [x] S6 — feat(explore): remote refresh + update probes (e747bcfc)
- [x] S7 — chore(team): delete orphaned install-dialog (bf714795)
- [x] S8 — docs(knowledge): explore-plugin.md + CLAUDE.md/knowledge/generated docs
- [ ] Final — /agent-skills:test coverage review; full suite; manual dev pass; bun run build sanity

Rules: never `git add -A` (build-stamp trap); stage `_embedded-assets-static.ts` explicitly in S2/S3; all fs-touching tests mock both content-dir resolvers + openclaw home + logger.
