# SPEC: Full System Audit & Granularity Refactor

**Status:** Draft — pending approval
**Date:** 2026-06-11
**Driver:** Mark Hayden (sole user/operator)
**Priority:** Reduce tech debt. No backwards compatibility, no shims. Clean and clear.

## 1. Objective

Audit the entire Bakin system (~258k lines TS, 1,237 files) for architecture problems,
security issues, oversized files, cross-plugin duplication, and SDK gaps — then execute
a phased refactor that decomposes oversized files into focused modules, extracts shared
code to the right layer, and fixes design problems found along the way.

**Success criteria:**
- A prioritized, adversarially-verified audit report exists and Mark has triaged it.
- No source file over ~800 lines without an explicit cohesion justification recorded
  in the audit report; no test file over ~1,200 lines.
- Code duplicated across 2+ plugins lives in exactly one place (SDK or packages/core).
- All security findings within the threat model are fixed or explicitly accepted.
- The two-CLI situation (`src/core/cli.ts` + `cli/bakin.ts`) is consolidated into one
  coherent structure.
- Full test suite green, binary builds, dev server boots, docs accurate — at every
  PR boundary.

## 2. Phases

### Phase 0 — Audit (multi-agent workflow)
Fan out parallel auditor agents, one per dimension; adversarially verify significant
findings before they enter the report.

Dimensions:
1. **Architecture** — layering violations, adapter-boundary leaks, plugin coupling,
   the two-CLI overlap, dead code, wrong-layer logic.
2. **Security** — threat model: *Tailscale is the perimeter*. In scope: path traversal
   in file-serving routes, command/prompt injection via agent-controlled content,
   plugin-install supply chain (`github:` installs run arbitrary code), secrets leaking
   into logs/audit/search indexes, SSRF from server-side fetches. Out of scope:
   missing-auth/CSRF findings.
3. **File size & cohesion** — every source file >800 lines and test file >1,200 lines:
   proposed split seams, or a cohesion argument for staying whole.
4. **Duplication** — code repeated across plugins/components; for each cluster, the
   proposed shared home (SDK vs packages/core) and consumer count.
5. **SDK gaps** — things plugins reach around the SDK to do (deep imports, copy-paste
   from host, missing hooks/components/utilities). 2+ real consumers required to
   propose extraction; no speculative API.
6. **Tooling** — scripts/ (docs generator, build pipeline, instance rig) and
   dev/imitation-crab audited with the same lenses.

**Output:** `.claude/specs/audit-2026-06/REPORT.md` — findings with severity
(P0 fix-now / P1 this-effort / P2 documented-deferred), file:line evidence, and a
proposed workstream breakdown. Mark triages the report before any plan is written.

### Phase 1 — Foundations (from audit findings)
SDK and packages/core extractions land **first** so later file splits sit on the right
shared code. Placement rule: duplicated client code (UI, hooks, utilities) →
`@makinbakin/sdk`; duplicated server code → `packages/core`, reaching plugins via `ctx`.
Bar: 2+ real consumers today.

### Phase 2 — Decomposition & redesign
Per-file split + redesign, in audit-priority order. Redesign-while-splitting is
explicitly allowed: if a file's internals are bad, fix the design in the same pass.
Each file = one coherent, revertable commit. CLI consolidation is a first-class
workstream here, not just a `bakin.ts` split.

### Phase 3 — Security fixes
P0s may be pulled forward into any phase (fix-now). Remaining accepted findings are
fixed as their own workstream.

### Phase 4 — Test coverage & docs sweep
`/agent-skills:test` pass over redesigned areas; verify `.claude/knowledge/*`,
`CLAUDE.md`, `README.md`, and `docs/*` reflect reality.

Each of Phases 1–3 gets its own `/agent-skills:plan` derived from the triaged report,
then `/agent-skills:build` execution.

## 3. Commands

| Action | Command |
|---|---|
| Full test suite | `bun run test` |
| Single test file | `bun test <path> --isolate` |
| Typecheck | `bun run typecheck` (tsc -p tsconfig.app.json --noEmit) |
| Lint | `bun run lint` |
| Full binary build | `bun run build` |
| Dev server | `bun run dev` (mock: `bun run dev:mock`) |
| Isolated instance | `bun run instance up` / `instance dev --mode isolated` |

**Build-stamp trap:** `bun run build` rewrites a tracked generated-version file —
never `git add -A` after a local build.

## 4. Project structure rules

- Source files target 200–400 lines; >800 requires recorded justification.
- Splits follow existing conventions: plugins decompose into `lib/` + `components/`
  + `lib/routes/`; core modules into focused siblings under their package.
- Extraction destinations: client → `packages/sdk/src/*` (exported via the existing
  sub-path structure; mind vendor-bundle weight, #422 splitting), server →
  `packages/core/src/*`.
- Plugin authors' canonical surface stays `@makinbakin/sdk/*` — no new deep-import
  patterns. No direct plugin-to-plugin imports (HookRegistry only).
- Adapter boundary holds: provider code stays behind `packages/adapter-*` factories.

## 5. Code style

Per CLAUDE.md, unchanged: strict TS (no `any` across boundaries), Zod at system
boundaries, functional preference, `createLogger('module')`, no empty catches,
`const` over `let`, kebab-case files, conventional commits with scope.

## 6. Testing strategy

- Every commit: `bun run test` green + typecheck clean.
- Redesigned behavior ships with new/updated tests **in the same commit**.
- Split test files along the same seams as the source they test.
- All filesystem-touching tests follow the CLAUDE.md mock rules (both content-dir
  resolvers, OpenClaw home, logger, watcher; env vars before imports; `--isolate`).
- Every PR: `bun run build` succeeds, dev server boots, UI-touching changes get a
  browser smoke check.

## 7. Commit & rollback strategy

- **Branch + PR per workstream** (e.g. `audit/report`, `refactor/sdk-extractions`,
  `refactor/cli`, `refactor/plugin-team`, …). Mark reviews and merges every PR.
- **One commit per finding/file** — a file's split+redesign is a single commit; an
  extraction (shared module + all consumers migrated) is a single commit. Every
  commit is a rollback checkpoint: suite green, typecheck clean.
- Conventional commits with scope: `refactor(team): split index.ts into lib modules`,
  `feat(sdk): extract shared facet utilities`, `fix(security): …`.
- Dependency order between PRs documented in each plan; SDK/core extraction PRs merge
  before the refactor PRs that depend on them.
- No shims, no re-export compatibility layers, no deprecation periods — dead paths
  are deleted in the commit that obsoletes them.

## 8. Boundaries

**Always:**
- Update `.claude/knowledge/*` docs in the same PR that changes the system they
  describe; check `CLAUDE.md` and `README.md` for impact.
- Keep the adapter boundary, execution-ledger invariants, usage-recorder singleton,
  and testing isolation rules intact through every refactor.
- Verify behavior claims with tests, not inspection.

**Ask first:**
- Deleting anything that looks dead but is reachable from the binary CLI surface,
  release pipeline, or agent-package projection (three-mode verification: binary
  users, repo users, repo devs).
- Any change to the release pipeline / signing / npm publish flow.
- Pulling a P2 (deferred) finding into scope.

**Never:**
- Backwards-compat shims or re-export layers.
- Tests that touch real `~/.bakin/` or `~/.openclaw/`.
- New stat-tracking parallel to `src/core/usage.ts`; fabricated model metadata;
  error-classification by message text.
- Merge to main without Mark's PR review.

## 9. Threat model (security audit calibration)

Tailscale is the auth perimeter — the network boundary is trusted. The audit asks:
*what can hurt the system from inside the perimeter, or through content the agents
ingest?* Agent-controlled and external content (web fetches, installed plugins,
agent-written files) is untrusted input even though the human user is trusted.
