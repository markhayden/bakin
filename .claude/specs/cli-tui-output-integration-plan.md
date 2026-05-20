# Plan: Full CLI TUI Output Revamp

## Status

Draft implementation plan following the style spike in
`.claude/specs/cli-tui-output-style.md`.

This plan replaces the narrower "make the main screens look better" scope. The
target outcome is a full built-in CLI revamp: one command execution path, one
renderer boundary, and consistent human-facing TTY output for every built-in
command family.

## Objective

Make every Bakin CLI entrypoint and built-in command use the same command
contract and rendering system:

- `bun run cli/bakin.ts ...`
- `bun run cli ...`
- installed `bakin ...` binary/source bin entry
- binary-facing `src/core/cli.ts` dispatch
- plugin-contributed command fallback

Success means:

- human TTY output consistently uses the approved Bakin header, status blocks,
  section dividers, summaries, remediation rows, progress states, and prompts
- `--json` emits deterministic structured envelopes and never renders Ink
- non-TTY plain output remains stable and machine-friendly
- source and binary entrypoints no longer own duplicate command behavior
- built-in commands stop printing ad hoc `console.log`/`console.error` output
  from deep command handlers

## Current Problem

The repo currently has overlapping CLI ownership:

- `cli/bakin.ts` owns a large source-mode command switch with direct printing
  and `process.exit()` calls.
- `src/core/cli.ts` owns binary-facing command behavior with a second set of
  direct print paths.
- `src/core/cli/runner.ts`, `result.ts`, and `render.tsx` already define part of
  a cleaner command/result/render boundary, but most commands do not use it yet.
- Production Ink components still use older bracket status badges, while the
  style gallery contains the approved newer TUI direction.

The revamp should finish the architecture cleanup, not just restyle doctor or
onboarding.

## Non-Goals

- Do not change plugin/server API contracts unless a renderer needs structured
  data already returned by those APIs.
- Do not implement unrelated product features from older hardening plans, such
  as new service-management behavior, unless needed for existing command output.
- Do not add compatibility shims for old human output strings.
- Do not migrate browser UI design patterns.
- Do not make the style gallery call real Bakin APIs.

## Design Decisions

- Canonical command execution lives under `src/core/cli/*`.
- `cli/bakin.ts` becomes a thin source-mode entrypoint that delegates to the
  canonical dispatcher.
- Binary dispatch and source dispatch use the same handlers.
- Built-in handlers return structured results; only the top-level CLI boundary
  writes to stdout/stderr or exits.
- Renderers sit at the boundary:
  - Ink for interactive TTY.
  - Plain deterministic text for non-TTY.
  - JSON envelope for `--json`.
- Production TUI primitives live under `src/core/cli/ui/*`; the gallery imports
  those primitives so design fixtures and production cannot drift.
- Interactive selection uses the existing `MultiSelect` primitive, with embedded
  title suppression when a surrounding screen/section already names the action.
- The Bakin header appears on human-facing TTY command screens, not JSON, plain,
  or intentionally stream-like output.
- The Antfly/search-adapter onboarding prompt defaults to `y/N`; `--yes` is the
  explicit path for unattended install consent.

## Migration Order

### Slice 1: Promote Shared TUI Primitives

Create production-ready primitives from the gallery design:

- `BakinHeader`
- `Section`
- `StatusToken`
- `SummaryStrip`
- `FindingRows`
- `ProgressMeter`
- `NextActions`
- shared table/list rows
- error/remediation blocks
- typed status vocabulary and mappings

Refactor the gallery to consume these shared primitives instead of defining its
own copies.

Verification:

- `bun test --isolate tests/cli/ui.test.tsx tests/cli/tui-gallery.test.tsx`
- `bun run typecheck`

Commit checkpoint:

- `refactor: promote shared cli tui primitives`

### Slice 2: Finish Command Result and Renderer Boundary

Harden the existing `CliCommandResult`, envelope, parser, runner, and renderer
boundary so all later command migrations have a stable target.

Acceptance:

- global `--json`, `--no-color`, `--verbose`, `--yes`, `--force`, `--help`, and
  `--version` have one parse path
- `--` reliably ends option parsing for commands that accept raw text or JSON
- render mode resolution is centralized
- `renderInkEnvelope()` uses the new TUI primitives
- JSON and plain renderers remain deterministic and header-free

Verification:

- `bun test --isolate tests/cli/result.test.ts tests/cli/render.test.tsx tests/cli/runner.test.ts`
- new parser tests for raw payload and global flag behavior

Commit checkpoint:

- `refactor: harden cli result renderer boundary`

### Slice 3: Unify Source and Binary Entrypoints

Move command ownership out of `cli/bakin.ts` and `src/core/cli.ts` duplication
into canonical handlers under `src/core/cli/commands/*`.

Acceptance:

- `cli/bakin.ts` is a thin wrapper around canonical dispatch
- binary-facing dispatch calls the same canonical dispatch
- built-in command registration lives in one place
- top-level dispatch owns stdout/stderr writes and exit codes
- command handlers no longer call `process.exit()` internally

Verification:

- source and binary dispatch tests for representative commands
- `bun run cli -- --version`
- `bun run cli -- doctor --json` with mocked server/offline paths where tests
  already support it

Commit checkpoint:

- `refactor: unify cli entrypoints`

### Slice 4: Migrate Foundation and Generic Commands

Migrate the commands that establish shared behavior and generic fallbacks:

- `version`
- `help`
- `status`
- `paths`
- `logs`
- `docs`
- plugin-contributed command fallback
- generic error/unknown-command output

Acceptance:

- TTY output uses the Bakin header and status blocks where appropriate
- JSON output uses envelopes
- non-TTY output stays concise and deterministic
- stream-like commands such as live logs do not keep an Ink repaint loop active
  while streaming

Verification:

- render tests for generic success/error
- command tests for unknown command, help, version, status, paths, logs

Commit checkpoint:

- `refactor: migrate foundation cli commands`

### Slice 5: Migrate Setup and Onboarding Commands

Migrate setup/readiness commands:

- `onboard`
- `check <target|all>`
- `install <component>`
- `mkdir`
- `settings init`
- onboarding confirmations and selections

Acceptance:

- real selection screens use `MultiSelect`
- Antfly search adapter prompt defaults to `y/N`
- non-TTY and `--json` never hang on prompts
- `--yes` uses defaults without rendering interactive prompts
- runtime blockers, async progress, final status, and skipped steps match the
  approved gallery direction

Verification:

- `bun test --isolate tests/cli/onboarding-ui.test.tsx tests/cli/ui.test.tsx`
- focused prompt/default tests
- isolated `BAKIN_HOME` smoke tests for blocked and already-onboarded cases

Commit checkpoint:

- `refactor: migrate onboarding cli commands`

### Slice 6: Migrate Doctor and Repair Commands

Migrate diagnostic and repair workflows:

- `doctor`
- `doctor --full`
- `doctor --fix`
- `doctor --fix --yes`
- `doctor --delegate`
- `doctor --delegate --yes`
- `doctor repair list`
- `doctor repair show`
- `doctor repair verify`

Acceptance:

- default doctor stays report-only
- offline/default doctor clearly separates local checks from skipped server
  checks
- repair previews, applied repairs, and delegated repair task creation use the
  approved grouped report layout
- mutation/delegation prompts remain explicit and non-TTY safe
- `--json` remains machine-readable and does not render Ink

Verification:

- `bun test --isolate tests/cli/doctor-ui.test.tsx tests/cli/doctor-repair.test.ts`
- relevant core doctor tests
- manual gallery comparison for doctor screens

Commit checkpoint:

- `refactor: migrate doctor cli commands`

### Slice 7: Migrate Plugin and Package Commands

Migrate plugin/package command families:

- `plugins list`
- `plugins install`
- `plugins export`
- `plugins import`
- `plugins upgrade`
- `plugins remove`
- `plugins restore`
- `plugins link`
- `plugins unlink`
- `packages install`
- `packages list`
- `packages remove`
- `packages update`

Acceptance:

- install/import/remove/restore consent and failure output uses consistent
  prompt/error primitives
- list/report commands use shared rows/tables
- export without a file remains machine-readable and does not add TUI decoration
- JSON output remains structured

Verification:

- existing plugin CLI tests
- new render tests for install/list/error cases

Commit checkpoint:

- `refactor: migrate plugin package cli commands`

### Slice 8: Migrate Task, Workflow, Agent, and Schedule Commands

Migrate operational command families:

- `tasks list/get/create/move/log/block/depend/complete`
- `workflows list/start/step/submit`
- `agents list/status/tasks/send/install/remove/update/lessons`
- `schedule list/add/pause/resume/remove/run/runs`

Acceptance:

- list screens use dense, scannable shared table/list components
- mutating commands render concise success/failure summaries
- free-form text arguments remain intact, especially after `--`
- workflow submit JSON payloads are not corrupted by global parsing
- JSON mode produces envelopes for all commands

Verification:

- existing task/workflow/agent/schedule CLI tests
- parser tests for free-form text and JSON payload commands
- focused render tests for representative list and mutation results

Commit checkpoint:

- `refactor: migrate operational cli commands`

### Slice 9: Migrate Search, Assets, Rules, and Remaining Built-Ins

Migrate the remaining built-in command surfaces:

- `search`
- `reindex`
- asset trash/restore/empty commands
- `agent-rules`
- `settings get/set`
- `dispatch`
- `start`
- `serve`
- `stop`
- `restart`
- `dev`
- any remaining built-in commands from `renderCliUsage()`

Acceptance:

- every built-in command has a canonical handler
- no remaining built-in command relies on legacy ad hoc printing
- long-running commands clearly separate preflight/final status from raw server
  or child-process logs
- settings/search commands preserve raw values and query text

Verification:

- command coverage audit against `src/core/cli/registry.ts`
- targeted tests for long-running command preflight behavior
- `bun run cli -- --help` and command-specific help smoke checks

Commit checkpoint:

- `refactor: migrate remaining builtin cli commands`

### Slice 10: Remove Legacy Command Ownership and Dead Output Paths

Delete or collapse obsolete code after all command families have moved.

Acceptance:

- `cli/bakin.ts` is only an entrypoint wrapper
- duplicate source/binary command implementations are removed
- no built-in command handler uses direct stdout/stderr printing except approved
  streaming boundaries
- obsolete bracket-status production components are removed or refactored
- style gallery still renders the approved mock screens

Verification:

- `rg "process.exit|console\\.log|console\\.error" cli src/core/cli` audited with
  documented intentional exceptions
- full CLI test suite
- `bun run typecheck`

Commit checkpoint:

- `refactor: remove legacy cli output paths`

### Slice 11: Documentation, Knowledge, and Release Review

Update durable docs:

- `.claude/specs/cli-tui-output-style.md`
- `.claude/specs/cli-tui-output-integration-plan.md`
- `.claude/knowledge/doctor-and-health-checks.md`
- `.claude/knowledge/dev-loop.md`
- README/help docs if command examples or output behavior changed

Run final review:

- `bun test --isolate tests/cli`
- targeted doctor/onboarding/plugin/task tests
- `bun run typecheck`
- manual render checks at 72, 100, and 132 columns
- source-mode and binary-mode smoke checks where available

Commit checkpoint:

- `docs: record full cli tui revamp`

## Testing Strategy

Use layered tests:

- Pure unit tests for status mapping, row grouping, prompt defaults, and
  selection state transitions.
- Parser tests for global flags, `--`, raw text, and JSON payload preservation.
- Ink `renderToString()` tests for reusable primitives and command-specific
  views.
- Command-level tests for JSON/plain/Ink routing boundaries.
- Existing behavior tests for doctor repair, onboarding, plugin install, task
  mutation, workflow submission, and schedule operations.
- Entry-point tests proving source and binary dispatch use the same handlers.
- Manual gallery comparison for visual regressions before opening the PR.

Avoid full-screen snapshots except for tiny stable primitives. Prefer targeted
assertions for header presence, status tokens, section labels, wrapping, next
actions, prompt defaults, absence of repeated headings, and JSON/plain output
isolation.

## Risks

- This is a large refactor because command behavior is duplicated between
  `cli/bakin.ts` and `src/core/cli.ts`.
- Some existing tests may assert old bracket status labels such as `[OK]`; those
  should move to component-level or envelope assertions when human output
  changes.
- Ink's default `MultiSelect` layout is tight at narrow widths. Customize it in
  a focused slice only if the real onboarding screen proves too cramped.
- Long-running commands can accidentally mix Ink rendering with raw logs if the
  boundary is not explicit.
- Plugin-contributed commands may have irregular payloads; the generic renderer
  must stay robust and JSON must remain the authoritative agent interface.

## Open Decisions

1. Should this revamp happen as one PR or as a stack of PRs?

   Recommendation: stack PRs by slices. The work is broad enough that a single
   PR would be hard to review and painful to revert.

2. Should the full revamp include customizing `MultiSelect` for narrow-width
   layout?

   Recommendation: not in the first implementation pass. Keep the real Ink
   primitive unless the production onboarding screen is unusable at 72 columns.

3. Should human output substring compatibility be preserved?

   Recommendation: no. Preserve JSON/plain contracts for machines, but let human
   TTY output change to the approved design.
