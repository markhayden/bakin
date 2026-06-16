# Plan: WS4 — refactor/cli (consolidate three CLIs into one)

Spec: `.claude/specs/audit-2026-06/REPORT.md` + `APPENDIX-cohesion.md` (the authoritative
per-file split plan with verified line ranges). Branch: `refactor/cli` off `main`.
The audit's biggest single win (~1,500+ lines die). One revertable commit per phase; every
commit green on `bun run test` + `bun run typecheck`. PR gate adds `bun run build` (the binary
compiles readonly.tsx via src/core/cli.ts — a full build is mandatory) + lint + docs.

## Current state (recon 2026-06-15, confirmed)

Three CLIs:
- `src/core/cli.ts` (330) — binary dispatcher. Handles version/update/dev/start/serve directly;
  delegates the rest to `cli/bakin.ts` by **monkey-patching process.argv + process.exit**
  (`process.exit(code)` throws `DelegatedCliExit`, caught → exit code). no-arg → `start`.
- `cli/bakin.ts` (4,632) — npm `bakin` bin (package.json:10) + the delegated source CLI. Owns
  30+ command groups. `BASE_URL = process.env.BAKIN_URL || http://localhost:${PORT||3737}` (line 53).
  ~44 byte-identical `printXxxTui` wrappers (lazy `Promise.all([import(ui), import(render-to-string),
  import(react)])` + console.log), ~95 inline `isTTY` branches. no-arg → help. **No `update` case.**
- `src/cli/schedule.ts` (237) — 7 schedule command fns, called from cli/bakin.ts. **BUG:**
  `BASE_URL = http://localhost:${PORT||3737}` (line 7) — ignores `BAKIN_URL`.

Stalled framework (`src/core/cli/{runner,parser,options,result}.ts`, 37/128/96/71 lines) — complete,
tested, **zero production callers**.

Render layer `src/core/cli/ui/readonly.tsx` (2,808): ~35 all-`unknown` DTO interfaces (14-316),
~80 helpers (318-1638), 38 exported `*Report` ink components (1639-2808). No module-load side
effects; one-directional imports (readonly → ./tui → ./style-tokens); ALL consumers load it via
`import('.../cli/ui/readonly')` (~30 sites in bakin.ts, src/core/cli.ts, src/cli/schedule.ts) +
`tests/cli/readonly-ui.test.tsx` (imports all 34 components by name).

Load-bearing contracts the split MUST preserve:
- package.json bin → `./cli/bakin.ts`; binary dispatcher dynamic-imports `'../../cli/bakin'` and
  destructures `{ main }`; `scripts/instance*.ts` shell out to `bun run cli/bakin.ts`. So cli/bakin.ts
  stays a file exporting `main()` with its `import.meta.main` guard.
- Extracted command modules MUST keep calling `process.exit` (not return codes) or the binary's
  exit-code plumbing + tests (`rejects.toThrow('exit:1')`) break.
- Heavy deps (react/ink/ui/onboarding/whiskit) are dynamically imported on purpose for cheap binary
  startup — no new module may statically pull them into the entry import graph.
- Mutual lazy dep: bakin.ts ↔ src/core/cli.ts — both sides stay dynamic (no static cycle).

## Phases (appendix order; lowest-risk first)

### B1 — split `src/core/cli/ui/readonly.tsx` (2,808 → 11 reports/* + barrel)  ⟵ start here
Low-risk: no side effects; a barrel at the old path keeps every dynamic-import + readonly-ui.test.tsx
working unchanged. Move by the appendix line-ranges into `src/core/cli/ui/reports/`:
`format.ts` (pure formatters+DetailFieldRow), `command-meta.tsx`, `runtime.tsx` (status/dispatch/agents/
version), `settings.tsx` (+paths +docs), `tasks.tsx`, `workflows.tsx`, `plugins.tsx`, `packages.tsx`,
`search.tsx` (+reindex), `schedule.tsx`, `trash.tsx`. Replace readonly.tsx with `readonly.ts`
(`export * from './reports/*'`, types included). All reports import shared formatters from format.ts;
doctor.tsx/doctor-repair.tsx adopt format.ts's plural/valueText in the same pass (verified dups).
- **Accept:** typecheck + `tests/cli/readonly-ui.test.tsx` green; **full `bun run build`** (binary
  compiles it). No DTO retyping yet (keep behavior identical; Zod redesign is a later, optional pass).
- Commit: `refactor(cli): split readonly.tsx into per-domain report modules + barrel`

### B2 — `renderInkReport` helper; collapse the 45 printXxxTui wrappers
Add one generic lazy `renderInkReport(load, props)` (in `src/core/cli/ui/`, next to render-to-string)
preserving lazy loading; replace the ~44 copy-paste wrappers in cli/bakin.ts. Make the eager
`const USAGE = renderCliUsage(...)` (bakin.ts:3790) lazy. Prerequisite for clean bakin.ts seams.
- **Accept:** typecheck + tests/cli green; grep shows ≤1 `renderToString(createElement` in bakin.ts.
- Commit: `refactor(cli): one renderInkReport helper replacing 45 printXxxTui wrappers`

### B3 — extract `src/cli/http.ts` (one BAKIN_URL-aware client)
BASE_URL + api/apiGet/apiPost/apiPostJson/apiDelete + apiErrorPayload/jsonObject/parseJsonText +
getCliAgent/getCliRoster. Adopt in cli/bakin.ts AND src/cli/schedule.ts — **fixes the BAKIN_URL bug.**
Replace `isServerConnectionError` message-text classification with a typed connection error.
- **Accept:** typecheck + tests/cli + schedule.test green; `BAKIN_URL=... bakin schedule list` hits the override.
- Commit: `refactor(cli): shared BAKIN_URL-aware http client; fix schedule BAKIN_URL bug`

### B4 — extract `src/cli/output.ts`
print/printTable, renderInkReport re-home, exit helpers (exitCommandIssue/Usage/UnknownSubcommand/
CommandFailure), one `confirmPrompt` (collapse the 3 readline copies), statusIcon/formatBytes/daysUntil,
and an `emit({tui,plain,json})` dispatcher to kill the inline isTTY/plain/json branching.
- **Accept:** typecheck + tests/cli green.
- Commit: `refactor(cli): shared output module + emit() dispatcher; collapse isTTY branching`

### B5 — `src/cli/lifecycle.ts` + command modules; slim cli/bakin.ts to a ~200-line router
Extract lifecycle (waitForServerVersion/cmdStartServer/cmdReboot/cmdStop) + per-scope command modules
(one file per group); each `case` becomes one line. Move the top-of-file static server-core imports
(whiskit/settings/import-export) into their command modules. Keep bakin.ts ↔ src/core/cli.ts dynamic.
Fix divergences: no-arg parity, add `update` to bakin.ts, help-registry-driven dispatch.
- **Accept:** typecheck + full tests/cli green; `bun run build`; behavioral parity verified.
- Commits: one per extracted module + one for the divergence fixes.

### B6 — wire or retire the stalled framework (`runner/parser/options/result`)
Decide during B5: if the slimmed router adopts parser/options/runner, wire them (delete dead bits);
else delete the framework + its tests as superseded. Document the call.
- Commit: `refactor(cli): {adopt|retire} the cli command framework`

### B7 — test splits
Extract `tests/cli/helpers/tty-cli-harness.ts` (the ×10 copy-pasted TTY harness + withTempBakinHome);
split `readonly-commands.test.ts` (1,432) into `readonly-help-errors.test.ts`, `readonly-logs.test.ts`,
and per-domain command test files along the source seams; de-chain mega-`it()`s.
- **Accept:** full suite green; harness shared.
- Commits: one per split file group.

### Docs
`.claude/knowledge/repo-architecture.md` + CLAUDE.md "Build, Dev, CLI" section (CLI structure changes
materially); note the consolidated client + the fixed divergences.

## Risks & mitigations
- **Binary build** — readonly.tsx compiles into the single-file binary via src/core/cli.ts; every
  phase touching cli/* runs a full `bun run build` before commit (+ build-stamp trap: revert
  generated-version.ts + _embedded-assets-static.ts).
- **Exit-code plumbing** — command modules keep calling `process.exit`; don't convert to return codes.
- **Dynamic-import graph** — never statically import react/ink/ui/whiskit into the entry; keep the
  bakin.ts ↔ src/core/cli.ts mutual dep dynamic.
- **Test mocks** — tests/cli/* mock modules by resolved path + import `{ main }`; extracted code must
  import the SAME modules (only relative specifiers change).

## Status
- B1 — ☑ readonly.tsx (2,809) → 11 reports/* modules + barrel. Verified (typecheck/252-isolated/binary).
- B2 — ☑ renderInkReport helper; collapsed 41 printXxxTui wrappers (−204 net). 4 inline renders left.
- B3 — ☑ shared src/cli/http.ts client; **fixed schedule BAKIN_URL bug**. isServerConnectionError
  typed-error improvement deferred (moved verbatim).
- B4 — ☑ extracted 8 pure output helpers → src/cli/output.ts. Exit helpers + emit() + confirm
  unification deferred (entangled / behavior-sensitive).
- B5 — ☐ **(next focused unit — large + fragile)** command modules + slim router + emit() dispatcher
  + confirm unification + no-arg/update/help-registry divergence fixes. Touches exit-code plumbing,
  dynamic-import contracts; behavior-changing parts want the dockerized-rig E2E before merge.
- B6 — ☐ wire/retire the stalled runner/parser/options/result framework.
- B7 — ☐ test splits (tty-cli-harness + readonly-commands.test split).
- docs — ☐

### Checkpoint (2026-06-15): B1–B4 are a coherent, low-risk, fully-verified chunk (pure
extractions + dedup + the BAKIN_URL bug fix). B5+ are higher-risk. Suggested split: ship B1–B4 as
"WS4 part 1" and tackle B5 as a fresh focused effort (mirrors the WS3 → WS3b split).
