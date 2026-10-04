# TODO — dependency sweep #760

Tick with the merge SHA. One PR in flight at a time. Post-merge checkpoint after every row (PLAN.md).

| # | Branch | Contents | Status | Merge SHA |
|---|---|---|---|---|
| 1 | `chore/deps-01-housekeeping-and-minors` | remove nodemailer/@types/nodemailer/router-devtools · happy-dom 20.14.5 (+ Base UI harness switch) · minor/patch batch · regenerated artifacts · runbook doc + audit script | ✅ #947 | c7cdfac2f |
| 2 | `chore/deps-02-zod-4.6` | zod ~4.6.5 (root, reference-plugin) + behavior audit · lockfile dedupe · workflows health-check union-issue fix · #948 filed | ✅ #949 | 1e1f41c83 |
| 3 | `chore/deps-03-typescript-6` | typescript 6.0.3 · `*.css` ambient declaration · SDK stylesheet export types · scaffold env.d.ts + types:[bun] | ✅ #951 | 8452dbb33 |
| 4 | `chore/deps-04-eslint-10` | eslint 10.12 · typescript-eslint 8.71 · remove eslint-plugin-react · 3 stale directives dropped | ✅ #952 | fb6beeda5 |
| 5 | `chore/deps-05-react-19.3-ink-8` | react/react-dom/@types 19.3.0 (root + docs) · ink 8.0.0 · react-devtools-core declared for the compiled binary | ✅ #954 | fd8a55672 |
| 6 | `chore/deps-06-base-ui-1.8` | @base-ui/react 1.8.0 (root + packages/ui) · visual pass (progress label fix surfaced) · vendor-chunk test per-module · WebKit abort wording | ✅ #955 | 9473af59c |
| 7 | `chore/deps-07-lucide-1` | lucide-react 1.51 · 9 alias renames (47 files) · a11y clean · list-rows snapshot | ✅ #956 | c389ac1af |
| 8 | `chore/deps-08-dagre-dndkit-jsyaml` | dagre 3.1.1 · dnd-kit 0.5.0 (Feedback plugin) · js-yaml 5.4.2 (16 named imports, empty-frontmatter guard + tests, drop @types) | ✅ #957 | b2f4c0176 |
| 9 | `chore/deps-09-sharp-0.35` | sharp 0.35.5 · pin-data regen (libvips 1.3.4) · installer adapted (dist/index.cjs, versioned native, @img/sharp-* externals) | ✅ #959 | fe89fcc8a |
| 10 | `chore/deps-10-vite-8-vitest-5-storybook-10.6` | vite 8.3.2 · vitest 5.0.3 · @vitest/browser-playwright 5.0.3 · storybook 10.6.1 · tokens-reference snapshot · .vitest/ ignored | ✅ #960 | e6ff48a00 |
| 11 | `chore/deps-11-playwright-1.63` | playwright 1.63.0 · canonical image v1.63.0-noble (workflow ×8, script, test) · 24 snapshots re-rendered | ✅ #961 | b1555352f |
| 12 | `chore/deps-12-docs-astro-7` | astro 7.3.5 · starlight 0.42.5 · @astrojs/react 7.0.0 · markdown processor · remove docs zod/@xyflow · entry.id · openapi-spec module · docs js-yaml 4 | ✅ #962 | 217fcab7d |
| 13 | `chore/deps-13-pi-sdk-1.0` | pi-coding-agent 1.0.2 + pi-ai ^1.0.2 lockstep · undici peer context converged · live chat + image check PASSED | ✅ #963 | 31607fd5e |
| 14 | `chore/deps-14-lucide-1.52` | lucide-react 1.52.0 (released mid-sweep) · zero drift | ✅ #968 | 6deb29bae |
| B | bits `chore/deps-bakin-760-companion` | zod/lucide/js-yaml/typescript/eslint/playwright/@types/bun/happy-dom · brand icons → generic · SDK ref 31607fd5e · messaging 0.11.8 / projects 0.11.3 / terminal 0.3.1 | ✅ bits#115 | 15508f7 |
| F | `chore/deps-760-wrapup` | issues filed: #964 TS 7 · #965 bun 1.4 + @types/bun · #966 @eslint-react · #967 upstream pi runtime-setup export (+ #948 earlier) · close #760 | ✅ | |

## Deferred (issues to file in row F)
- TypeScript 7 (no compiler API until 7.1; typescript-eslint <6.1)
- bun 1.4.x repin (TDZ fixed upstream in 1.4.0; re-run #755 matrix; @types/bun follows)
- React lint coverage via @eslint-react (decision, not a bump)
