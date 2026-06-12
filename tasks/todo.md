# TODO — fix/security (audit findings)

Branch `fix/security-audit` off `main`. One commit per task, each green on
`bun run test` + `bun run typecheck`. Detail: `tasks/plan.md`.

- [x] T1 — delete `src/core/plugin-installer.ts` + test ✅ da27f235
- [x] T2 — avatar route: validate agent id (TDD, traversal failed first) ✅ e54cc26e
- [x] T3 — plugin-settings route: plugin-id guard (canonical regex) ✅ 86f8d271
- [x] T4 — image idempotency rows: coordination facts only + ledger doc ✅ f0af0668
- [x] T5 — antfly password → secret store + migration + search doc ✅ f8cb7e1f
- [x] T6 — drop `trustExistingDist`: rebuild github installs from source ✅ 1d4a4b34
- [x] T7 — gate green (test/typecheck/lint/build + isolated boot smoke incl. live migration) → **PR #497**
