# Implementation Plan: CLI TUI Developer Experience

## Overview

Implement the approved CLI TUI DX spec in one hard-cutover PR on branch `cli-tui-dx`. The end state is one canonical CLI command runner used by the compiled `bakin` tool and source-mode entry, with shared Ink UI for built-in human-facing commands and a global structured `--json` envelope for agents/scripts.

This is a no-shim cleanup before public launch. The plan intentionally removes the split dispatcher/legacy delegation shape instead of preserving it.

Spec: `.claude/specs/cli-tui-dx.md`

## Architecture Decisions

- Canonical command execution lives under `src/core/cli/*`.
- `cli/bakin.ts` becomes a thin source-mode entry that calls the canonical runner, or is otherwise reduced to no command ownership.
- Command handlers return structured results instead of calling `process.exit()` internally.
- UI rendering is a boundary layer: Ink for interactive TTY, plain text for non-TTY, JSON envelope for `--json`.
- Onboarding and doctor core logic remain renderer-agnostic.
- Runtime readiness remains a hard onboarding blocker.
- Every public command supports `--json`.
- Plain non-TTY remains text by default; JSON is explicit.
- Built-in commands get command-specific views. Plugin-contributed commands get canonical parsing, JSON envelope, error handling, and a generic result renderer unless richer metadata exists.
- Long-running commands use UI for preflight/final state only, then hand off cleanly to the process/log stream.
- Doctor fix actions are deferred to an immediate follow-up PR after confirming the existing auto-fix surface.

## Dependency Graph

```text
Command contract + global option model
  ↓
Canonical parser/runner + result envelope
  ↓
Renderer boundary
  ├─ JSON renderer
  ├─ Plain renderer
  └─ Ink UI components/design system
      ↓
Command migrations
  ├─ setup/diagnostics: onboard, check, install, doctor, status, paths
  ├─ lifecycle: start, stop, restart, dev, update, logs
  ├─ data commands: tasks, workflows, agents, packages, plugins, schedule
  └─ search/assets/tools: search, search:stats, reindex, trash, docs, agent-rules
      ↓
Source entry + compiled entry unified
      ↓
Docs and knowledge updates
      ↓
Full verification
```

## Edge Cases To Cover

- Global flags:
  - `--json`, `--help`, `-h`, `--version`, `-v`, `--no-color`, and `--verbose` must behave consistently.
  - Global flags should work before or after the command where reasonable.
  - Command-specific flags with the same name must have clear precedence.
- Raw payloads:
  - `workflows submit <taskId> <stepId> <json>` must not have JSON payload flags stripped by the global parser.
  - `settings set <key> <value>` must allow JSON-ish values and string values that look like flags when passed after `--`.
  - `tasks create/log/block/complete`, `agents send`, `schedule add --prompt`, and `search <query>` must preserve free-form text.
  - Support `--` to end option parsing for all commands that accept raw text or JSON.
- HTTP-backed commands:
  - Server-unreachable errors should render consistently in TTY, plain, and JSON modes.
  - `BAKIN_URL` must be reflected in diagnostics.
- Long-running streams:
  - `bakin start`, `bakin dev`, and `bakin logs` must not keep an Ink repaint loop active while child/server logs are streaming.
  - `bakin logs` needs separate behavior for one-shot recent logs vs live tail; `--json` should produce deterministic output rather than an endless mixed stream unless a later explicit streaming JSON mode is added.
- Prompt safety:
  - No prompt may appear in `--json`, non-TTY, or CI mode.
  - Consent/destructive flows must require `--yes`/`--force` in automation.
- Onboarding selections:
  - Official plugin selection must support arrow up/down, space toggle, and Enter confirm.
  - Official agent selection must use the same multi-select interaction.
  - `--yes` must use defaults; non-TTY without `--yes` must skip optional selections rather than hanging.
  - Already-installed plugins/agents must render as installed and avoid accidental reinstall.
- Color and accessibility:
  - `NO_COLOR`, `BAKIN_NO_COLOR`, and `--no-color` should disable ANSI color.
  - Status information must not rely on color alone.
- Source vs binary:
  - `bun run cli/bakin.ts ...`, `bun run cli ...`, and compiled `bakin ...` must use the same command implementation.
- Plugin-contributed commands:
  - Preserve manifest-driven dispatch to exec tools/API routes.
  - Provide generic human rendering and JSON envelopes.
  - Do not require bespoke Ink layouts without additional manifest view metadata.

## Task List

### Task 1: Add CLI Result and Option Contracts

**Description:** Define the shared command result, error, global options, and JSON envelope types. Establish stable exit-code and error-code helpers before migrating commands.

**Acceptance criteria:**

- A command can return `{ ok, command, exitCode, data, error }` through one type path.
- Global options include `json`, `verbose`, `color`, `yes`, `force` as appropriate.
- No command behavior changes yet.

**Verification:**

- `bun run typecheck`
- Focused unit tests for envelope helpers.

**Dependencies:** None

**Files likely touched:**

- `src/core/cli/result.ts` new
- `src/core/cli/options.ts` new
- `tests/cli/result.test.ts` new

**Estimated scope:** Small

### Task 2: Build Canonical Parser and Runner Skeleton

**Description:** Create a canonical command parser/runner that handles global flags, command lookup, usage errors, `--` end-of-options, and output rendering selection. Keep existing handlers callable while the migration proceeds.

**Acceptance criteria:**

- `dispatchCli()` routes through the new runner skeleton.
- Global `--json` is parsed consistently.
- Raw payload commands such as `workflows submit <json>` can pass JSON/text without global option parsing corrupting it.
- Free-form text commands preserve values that look like flags when the user passes `--`.
- Usage/unknown-command errors return structured results.
- Existing command behavior still passes through during migration.

**Verification:**

- `bun test --isolate tests/cli/start-onboarding-gate.test.ts tests/cli/legacy-start.test.ts`
- New parser tests for global flags and unknown commands.

**Dependencies:** Task 1

**Files likely touched:**

- `src/core/cli.ts`
- `src/core/cli/runner.ts` new
- `src/core/cli/parser.ts` new
- `tests/cli/runner.test.ts` new

**Estimated scope:** Medium

### Task 3: Add Renderer Boundary

**Description:** Implement JSON, plain, and Ink renderer selection. JSON renderer emits the global envelope. Plain renderer provides deterministic text. Ink renderer initially uses static components without keyboard prompts.

**Acceptance criteria:**

- `--json` bypasses Ink and emits the envelope without ANSI.
- Non-TTY defaults to plain text.
- Interactive TTY can render through Ink.
- Renderer can be tested without running full commands.

**Verification:**

- `bun test --isolate tests/cli`
- Snapshot/string tests for JSON and plain output.

**Dependencies:** Task 2

**Files likely touched:**

- `src/core/cli/render.ts` new
- `src/core/cli/ui/*` new
- `tests/cli/render.test.ts` new
- `package.json`
- `bun.lock`

**Estimated scope:** Medium

### Task 4: Add Shared Ink CLI Design System

**Description:** Build reusable Ink components for status rows, panels, grouped reports, tables, progress lists, empty states, errors, remediation blocks, multi-select lists, and generic JSON-ish result previews.

**Acceptance criteria:**

- Shared components cover all command surface shapes.
- Status vocabulary is consistent across commands.
- Components render legibly without color.
- Generic result renderer exists for plugin-contributed commands and unusual command payloads.
- Multi-select supports arrow up/down focus, space toggle, Enter confirm, disabled/installed items, and defaults.
- `renderToString()` tests cover blocker, table, report, and success summary layouts.

**Verification:**

- `bun test --isolate tests/cli/ui`
- `bun run typecheck`

**Dependencies:** Task 3

**Files likely touched:**

- `src/core/cli/ui/status.tsx`
- `src/core/cli/ui/panel.tsx`
- `src/core/cli/ui/table.tsx`
- `src/core/cli/ui/report.tsx`
- `src/core/cli/ui/prompts.tsx`
- `src/core/cli/ui/multi-select.tsx`
- `tests/cli/ui/*.test.tsx`

**Estimated scope:** Medium

### Task 5: Migrate Onboarding Commands

**Description:** Convert `onboard`, `check`, `install`, `mkdir`, and `settings init` to canonical handlers and shared TUI rendering. Implement the runtime hard-blocker UX and official plugin/agent selection steps.

**Acceptance criteria:**

- Runtime missing shows one controlled blocker with full docs URL.
- No raw provider logs in default onboarding output.
- Dependent steps are summarized once.
- No skip option exists for missing runtime.
- Official plugin install step lists installable official plugins with multi-select controls.
- Official agent install step lists official curated agents with matching multi-select controls.
- Selected official agents install through the existing agent-package install path.
- `--json` returns global envelope and structured component outcomes.
- Existing `--check`, `--yes`, `--force`, and `--verbose` behavior is preserved where intended.

**Verification:**

- `bun test --isolate tests/dev/mock-onboarding-contract.test.ts`
- New CLI onboarding render tests.
- Manual smoke with isolated `BAKIN_HOME` for runtime-missing case.

**Dependencies:** Tasks 1-4

**Files likely touched:**

- `src/core/onboarding/index.ts`
- `src/core/onboarding/runtime.ts`
- `src/core/cli/commands/onboard.ts` new
- `src/core/cli/commands/check.ts` new
- `src/core/cli/commands/install.ts` new
- `src/core/onboarding/recommended-plugins.ts`
- `src/core/onboarding/recommended-agents.ts` new
- `packages/host/src/data/curated-agents.json`
- `tests/cli/onboard-ui.test.tsx` new

**Estimated scope:** Medium

### Task 6: Migrate Doctor, Status, Paths, and Logs

**Description:** Convert diagnostic/inspection commands to canonical handlers and grouped report rendering. Doctor report uses the shared design system and exposes `autoFixable` as information only.

**Acceptance criteria:**

- `doctor` renders grouped checks, severity summary, remediation, and no prompts.
- `doctor --json` returns the global envelope.
- `status`, `paths`, and `logs` use consistent report/list formatting.
- `logs` avoids endless mixed streaming in `--json`; live tail remains a human/plain mode.
- Doctor fix actions remain explicitly out of scope.

**Verification:**

- `bun test --isolate tests/core/doctor.test.ts tests/core/doctor-plugin-checks.test.ts`
- New CLI doctor renderer tests.

**Dependencies:** Tasks 1-4

**Files likely touched:**

- `src/core/cli/commands/doctor.ts` new
- `src/core/cli/commands/status.ts` new
- `src/core/cli/commands/paths.ts` new
- `src/core/cli/commands/logs.ts` new
- `tests/cli/doctor-ui.test.tsx` new

**Estimated scope:** Medium

### Checkpoint A: Setup and Diagnostics

- `bun run typecheck`
- `bun test --isolate tests/cli tests/core/doctor.test.ts tests/core/doctor-plugin-checks.test.ts tests/dev/mock-onboarding-contract.test.ts`
- Review runtime-blocker output manually.
- Commit after this checkpoint.

### Task 7: Migrate Lifecycle Commands

**Description:** Convert `start`, `stop`, `restart`, `dev`, `update`, and setup service handling to canonical command handlers and shared UI.

**Acceptance criteria:**

- `start` keeps onboarding gate behavior.
- `restart` no longer lives in legacy `cli/bakin.ts`.
- `dev` keeps source-tree detection and verbose/no-color handling.
- `update` returns structured status and JSON envelope.
- Long-running commands use UI only for preflight/final state and do not corrupt server/dev log streams.

**Verification:**

- `bun test --isolate tests/cli/start-onboarding-gate.test.ts tests/cli/legacy-start.test.ts`
- Source-tree `bakin dev --help` or parser smoke as available.

**Dependencies:** Tasks 1-4

**Files likely touched:**

- `src/core/cli/commands/lifecycle.ts` new
- `src/core/cli.ts`
- `tests/cli/lifecycle.test.ts` new/update

**Estimated scope:** Medium

### Task 8: Migrate Plugin and Package Commands

**Description:** Convert plugin and package commands to canonical handlers with consistent tables, prompts, success summaries, errors, and JSON output.

**Acceptance criteria:**

- `plugins list/install/export/import/upgrade/remove/restore/scaffold/link/unlink` use the canonical runner.
- `packages install/list/remove/update` use the canonical runner.
- Consent prompts use Ink in interactive TTY and no prompts in `--json`/non-TTY.
- Destructive/non-TTY paths require explicit flags.

**Verification:**

- `bun test --isolate tests/cli/plugin-install-args.test.ts tests/cli/plugins-restore.test.ts tests/cli/install-plugin-assets.test.ts`
- Relevant lifecycle/plugin tests if handler contracts change.

**Dependencies:** Tasks 1-4

**Files likely touched:**

- `src/core/cli/commands/plugins.ts` new
- `src/core/cli/commands/packages.ts` new
- `src/core/cli/consent-prompt.ts`
- `tests/cli/plugins-ui.test.tsx` new/update

**Estimated scope:** Medium

### Task 9: Migrate Agents, Tasks, Workflows, and Schedule Commands

**Description:** Convert operational/data commands to canonical handlers with consistent table/report rendering and JSON envelopes.

**Acceptance criteria:**

- `tasks`, `workflows`, `agents`, and `schedule` commands have TTY, plain, and JSON paths.
- Tables share one formatter.
- Empty states and validation errors are consistent.
- Agent consumption path is deterministic.

**Verification:**

- `bun test --isolate tests/cli/bakin.test.ts tests/cli/schedule.test.ts tests/cli/agents-packages.test.ts`
- New render tests for representative tables and errors.

**Dependencies:** Tasks 1-4

**Files likely touched:**

- `src/core/cli/commands/tasks.ts` new
- `src/core/cli/commands/workflows.ts` new
- `src/core/cli/commands/agents.ts` new
- `src/core/cli/commands/schedule.ts` new or updated from `src/cli/schedule.ts`
- `tests/cli/data-commands-ui.test.tsx` new

**Estimated scope:** Large, but split into focused commits by command family

### Task 10: Migrate Search, Assets, Docs, Reindex, Agent Rules, and Plugin-Contributed Commands

**Description:** Convert the remaining CLI commands and extension-command dispatch behavior into the canonical runner.

**Acceptance criteria:**

- `search`, `search:stats`, `reindex`, `trash`, `docs`, and `agent-rules` use shared rendering and JSON envelopes.
- Plugin-contributed/manifest command behavior remains available through the canonical runner.
- Plugin-contributed commands use the generic renderer and JSON envelope; bespoke Ink views are out of scope until plugin manifests can declare view metadata.
- Errors include stable codes where practical.

**Verification:**

- `bun test --isolate tests/cli`
- Focused tests for search/reindex/trash parsing/rendering.

**Dependencies:** Tasks 1-4

**Files likely touched:**

- `src/core/cli/commands/search.ts` new
- `src/core/cli/commands/assets.ts` new
- `src/core/cli/commands/docs.ts` new
- `src/core/cli/commands/agent-rules.ts` new
- `tests/cli/misc-commands-ui.test.tsx` new

**Estimated scope:** Medium

### Checkpoint B: Full Command Surface

- `bun run lint`
- `bun run typecheck`
- `bun test --isolate tests/cli`
- Commit after this checkpoint.

### Task 11: Remove Legacy Command Ownership

**Description:** Eliminate the old split implementation. `cli/bakin.ts` becomes a thin entry or is otherwise reduced so it cannot diverge from the compiled binary command behavior.

**Acceptance criteria:**

- No command implementation remains exclusively in `cli/bakin.ts`.
- `src/core/cli.ts` no longer delegates unknown commands to `cli/bakin.ts`.
- Tests reflect the new hard cutover.
- `package.json` source-mode `bin`/`cli` still works.

**Verification:**

- `bun test --isolate tests/cli`
- `bun run typecheck`

**Dependencies:** Tasks 7-10

**Files likely touched:**

- `cli/bakin.ts`
- `src/core/cli.ts`
- `package.json` if entry scripts need adjustment
- `tests/cli/legacy-start.test.ts`

**Estimated scope:** Medium

### Task 12: Update Command Registry and Docs

**Description:** Update CLI command contracts for global `--json`, new flags, behavior changes, and improved descriptions. Regenerate docs and update hand-authored setup/health docs.

**Acceptance criteria:**

- Generated CLI docs include global JSON behavior where supported by the contract model.
- First-time setup docs describe the runtime blocker clearly.
- Health docs describe the new doctor report behavior.
- `.claude/knowledge` captures the new CLI architecture and any doctor/onboarding changes.

**Verification:**

- `bun run docs:generate`
- `bun run docs:validate`
- `bun run docs:validate:routes`

**Dependencies:** Tasks 1-11

**Files likely touched:**

- `src/core/cli/registry.ts`
- `packages/core/src/docs/metadata.ts` if command contract needs global option metadata
- `docs/src/content/docs/start/first-time-setup.mdx`
- `docs/src/content/docs/start/operation.md`
- `docs/src/content/docs/using/health.md`
- `.claude/knowledge/cli-tui-dx.md` new
- `.claude/knowledge/doctor-and-health-checks.md`
- `.claude/knowledge/dev-loop.md` if needed

**Estimated scope:** Medium

### Task 13: Final Verification and Cleanup

**Description:** Run the full focused verification suite, inspect output manually, and remove transitional TODOs/dead code.

**Acceptance criteria:**

- No old CLI implementation paths remain.
- All public commands have JSON envelope support.
- Manual samples for `onboard`, `doctor`, and representative data commands are documented in PR notes.
- No unrelated changes are included.

**Verification:**

- `bun run lint`
- `bun run typecheck`
- `bun test --isolate tests/cli`
- `bun test --isolate tests/core/doctor.test.ts tests/core/doctor-plugin-checks.test.ts`
- `bun test --isolate tests/dev/mock-onboarding-contract.test.ts`
- `bun run docs:check`
- `node ./node_modules/astro/bin/astro.mjs build` if docs build is not already covered by `docs:check`

**Dependencies:** All prior tasks

**Files likely touched:** Cleanup across changed files

**Estimated scope:** Small

## Commit Strategy

Use granular commits that preserve natural rollback points:

1. `docs: specify cli tui dx cutover`
   - Add approved spec and plan.
2. `refactor: add cli result and global option contracts`
   - Types, envelope helpers, parser scaffolding tests.
3. `refactor: route cli through canonical runner`
   - New runner skeleton with legacy behavior temporarily callable.
4. `feat: add shared cli renderers and ink components`
   - JSON/plain/Ink renderer boundary and UI primitives.
5. `feat: migrate onboarding cli to ink renderer`
   - Onboard/check/install/mkdir/settings init and runtime blocker.
6. `feat: migrate doctor and diagnostics cli`
   - Doctor/status/paths/logs.
7. `feat: migrate lifecycle cli commands`
   - Start/stop/restart/dev/update/setup service.
8. `feat: migrate plugin and package cli commands`
   - Plugins/packages plus consent prompt handling.
9. `feat: migrate operational data cli commands`
   - Tasks/workflows/agents/schedule.
10. `feat: migrate search asset and utility cli commands`
    - Search/reindex/trash/docs/agent-rules and extension dispatch.
11. `refactor: remove legacy cli command ownership`
    - Thin source entry, no delegation.
12. `docs: update cli docs for tui and json contracts`
    - Generated docs, user docs, knowledge docs.
13. `test: complete cli cutover verification coverage`
    - Any final test consolidation and cleanup.

Commit only after each checkpoint passes its targeted verification. If a later migration fails badly, roll back to the previous command-family commit rather than unwinding the entire PR.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Full CLI cutover is large | High | Commit by command family with checkpoint tests after each group. |
| Ink output fights existing console logs | High | Renderer boundary owns output; default onboarding hides provider logs; verbose is explicit. |
| Agent output becomes brittle | High | Global `--json` envelope and non-TTY plain output tests. |
| Command behavior diverges between source and compiled binary | High | Remove command ownership from `cli/bakin.ts`; both entries call canonical runner. |
| Prompt behavior blocks automation | High | No prompts in `--json`/non-TTY; require explicit `--yes`/`--force`. |
| Onboarding multi-select interaction is under-tested | High | Add focused keyboard interaction tests if `renderToString()` is insufficient; this is the trigger for adding an Ink interaction helper. |
| Global flags conflict with command payloads | High | Support `--` and command-specific positional parsing tests, especially raw JSON/text commands. |
| Plugin-contributed commands lack rich view metadata | Medium | Use generic renderer now; defer bespoke plugin command views until manifest contracts grow. |
| Long-running commands fight Ink repainting | Medium | Keep Ink to preflight/final state and hand off stdout/stderr directly for running processes. |
| Adding Ink affects binary build size or compile behavior | Medium | Verify `bun run typecheck`, CLI tests, and binary build path before final. |
| Existing docs generator cannot express global flags cleanly | Medium | Extend `CliCommandContract` once rather than duplicating `--json` on every command manually. |
| Doctor fix scope expands | Medium | Defer fix actions; add immediate follow-up task after cutover. |

## Open Questions

- Should the runtime docs URL remain `https://makinbakin.com/docs/start/first-time-setup/`, or should a more specific runtime prerequisite page be created during docs updates?
- Should global `--json` be documented as an option on every command card or as a global CLI section only?
- Should plugin command manifest metadata gain view-model hints in the immediate follow-up series, or wait until there are user plugins that need bespoke CLI views?
