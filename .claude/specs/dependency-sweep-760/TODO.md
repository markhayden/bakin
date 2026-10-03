# TODO — dependency sweep #760

Tick with the merge SHA. One PR in flight at a time. Post-merge checkpoint after every row (PLAN.md).

| # | Branch | Contents | Status | Merge SHA |
|---|---|---|---|---|
| 1 | `chore/deps-01-housekeeping-and-minors` | remove nodemailer/@types/nodemailer/router-devtools · happy-dom 20.14.5 · minor/patch batch · regenerated artifacts · runbook doc + audit script | ☐ | |
| 2 | `chore/deps-02-zod-4.6` | zod ~4.6.5 (root, reference-plugin) + behavior audit | ☐ | |
| 3 | `chore/deps-03-typescript-6` | typescript 6.0.3 + diagnostics | ☐ | |
| 4 | `chore/deps-04-eslint-10` | eslint 10.12 · typescript-eslint 8.71 · remove eslint-plugin-react | ☐ | |
| 5 | `chore/deps-05-react-19.3-ink-8` | react/react-dom/@types 19.3.0 (root + docs) · ink 8.0.0 | ☐ | |
| 6 | `chore/deps-06-base-ui-1.8` | @base-ui/react 1.8.0 (root + packages/ui) + dialog/popover visual pass | ☐ | |
| 7 | `chore/deps-07-lucide-1` | lucide-react 1.51 · 9 alias renames · a11y check · baselines | ☐ | |
| 8 | `chore/deps-08-dagre-dndkit-jsyaml` | dagre 3.1.1 · dnd-kit 0.5.0 (Feedback plugin) · js-yaml 5.4.2 (named imports, empty guard, drop @types) | ☐ | |
| 9 | `chore/deps-09-sharp-0.35` | sharp 0.35.5 + pin-data regen + compile-and-run | ☐ | |
| 10 | `chore/deps-10-vite-8-vitest-5-storybook-10.6` | vite 8.3.2 · vitest 5.0.3 · @vitest/browser-playwright 5.0.3 · storybook 10.6.1 | ☐ | |
| 11 | `chore/deps-11-playwright-1.63` | playwright 1.63.0 · canonical image v1.63.0-noble (workflow ×5, script, test) · snapshots | ☐ | |
| 12 | `chore/deps-12-docs-astro-7` | astro 7.3.5 · starlight 0.42.5 · @astrojs/react 7.0.0 · markdown processor · remove docs zod/@xyflow · entry.id | ☐ | |
| 13 | `chore/deps-13-pi-sdk-1.0` | pi-coding-agent 1.0.1 + pi-ai ^1.0.1 lockstep · live chat + image check | ☐ | |
| B | bits `chore/deps-sweep-companion` | zod/lucide/js-yaml/typescript/eslint/playwright/@types/bun/happy-dom · SDK ref · manifest bumps | ☐ | |
| F | — | issues: TS 7 · bun 1.4 matrix · @eslint-react · close #760 | ☐ | |

## Deferred (issues to file in row F)
- TypeScript 7 (no compiler API until 7.1; typescript-eslint <6.1)
- bun 1.4.x repin (TDZ fixed upstream in 1.4.0; re-run #755 matrix; @types/bun follows)
- React lint coverage via @eslint-react (decision, not a bump)
