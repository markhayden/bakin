# TODO — fix/security (audit findings)

Branch `fix/security-audit` off `main`. One commit per task, each green on
`bun run test` + `bun run typecheck`. Detail: `tasks/plan.md`.

- [ ] T1 — delete `src/core/plugin-installer.ts` + test (dead shell-injection liability)
- [ ] T2 — avatar route: validate agent id (TDD: traversal test fails first)
- [ ] T3 — plugin-settings route: plugin-id guard (reuse canonical regex)
- [ ] T4 — image idempotency rows: persist promptHash-only coordination shape + ledger doc
- [ ] T5 — antfly password → secret store (+ env override, one-time migration, search doc)
- [ ] T6 — drop `trustExistingDist`: github installs rebuild from validated source + lifecycle doc
- [ ] T7 — PR gate: lint + build + boot smoke + doc sweep → open PR for review
