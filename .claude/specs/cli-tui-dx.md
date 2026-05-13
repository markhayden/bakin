# Spec: CLI TUI Developer Experience

## Objective

Rework the Bakin CLI into a unified, polished developer experience where every public entry point is served by the same compiled `bakin` tool and every human-facing command renders through a shared Ink-based terminal UI.

The highest-priority flows for initial implementation are:

- `bakin onboard`: first-run setup, structured as a clear step-by-step onboarding experience.
- `bakin doctor`: diagnostics, structured as an actionable health report.

Success means the whole CLI feels controlled, organized, and product-grade. A missing prerequisite must read as a deliberate blocker with next steps, not as raw logs or a crash. This is a pre-public-launch hard cutover: prioritize the clean final architecture over backwards compatibility or transitional shims.

## Current State

- `package.json` exposes `bakin` through `./cli/bakin.ts` in source mode.
- The compiled binary uses `server.ts`, which calls `dispatchCli()` in `src/core/cli.ts`.
- `src/core/cli.ts` implements some commands directly and delegates many commands back to `cli/bakin.ts`.
- `bakin onboard` is implemented by `src/core/onboarding/index.ts`, with individual components under `src/core/onboarding/*`.
- `bakin doctor` calls `/api/plugins/health/doctor?fresh=true` from `cli/bakin.ts`.
- Console output is mostly `console.log`/`console.error`, raw tables, and stdlib readline prompts.
- Lower-level Antfly/runtime logs can appear inline during onboarding, overwhelming the high-level setup story.

## Target UX Principles

- Every human-facing command uses the shared Ink design system for layout, spacing, color, progress, status tokens, confirmations, tables, and final summaries.
- The CLI has two first-class consumers: humans in an interactive terminal and agents/scripts that need deterministic output.
- Default output shows high-level state only.
- Raw provider logs are hidden by default and routed to log files or verbose/details output.
- Non-TTY, `--json`, and agent-oriented modes remain scriptable and do not depend on Ink interaction.
- Missing hard prerequisites stop cleanly with one clear blocker screen.
- Dependent skipped steps are summarized once, not repeated one by one.
- CLI commands share one visual language: status labels, groups, spacing, colors, and remediation format.

## Runtime Blocker Contract

Runtime readiness is a hard prerequisite for onboarding.

When `bakin onboard` reaches the runtime step and no active supported runtime/orchestrator agent is found:

- Stop onboarding immediately.
- Do not offer a skip path.
- Do not install a runtime automatically.
- Explain that Bakin requires an active agent runtime such as OpenClaw.
- Link to official prerequisite/setup documentation with a full URL.
- Show the exact detected issue, for example: "No orchestrator agent was found."
- Summarize downstream steps as blocked in one grouped list.
- Offer an exit/acknowledge action.
- Exit non-zero after acknowledgement.
- Tell the user to rerun `bakin onboard` after the runtime is ready.

Example inline TUI direction:

```text
Bakin Onboarding

Step 3 of 6  Runtime
Status       Blocked

Bakin requires an active agent runtime before setup can continue.
No orchestrator agent was found in the configured runtime.

Required:
  - Install and start OpenClaw or another supported runtime
  - Create at least one orchestrator agent
  - Verify the runtime is reachable

Docs:
  https://makinbakin.com/docs/start/first-time-setup/

Blocked steps:
  Search, search models, plugin assets, agent assets, LLM, channels, recommended plugins

Next:
  Run `bakin onboard` again after the runtime is ready.

[Enter] Exit
```

## Onboarding Flow

The existing component order remains the starting point:

1. `mkdir`
2. `settings`
3. `runtime`
4. `search`
5. `search-models`
6. `mcporter`
7. `plugin-assets`
8. `agent-assets`
9. `llm`
10. `channels`
11. `recommended-plugins`
12. `recommended-agents`

The implementation may group these into user-facing sections so the CLI does not feel like eleven unrelated checks. Candidate grouping:

- Local home and settings: `mkdir`, `settings`
- Runtime prerequisite: `runtime`
- Search stack: `search`, `search-models`
- Integration assets: `mcporter`, `plugin-assets`, `agent-assets`
- Official plugins: `recommended-plugins`
- Official agents: curated agent package selection and install
- Credentials and channels: `llm`, `channels`
- Recommended extensions: additional future wizard steps

Each step needs a high-level status:

- `ready`
- `checking`
- `installing`
- `blocked`
- `warning`
- `failed`
- `complete`

Default status copy should be user-centered, for example:

- "Bakin home ready"
- "Settings ready"
- "Runtime blocked"
- "Antfly installed and accessible"
- "Termite models present"
- "Recommended plugins installed"

### Official Plugin And Agent Selection

Onboarding must include rich multi-select steps for optional official plugins and agents.

Official plugins:

- List every installable plugin from the official Bakin bits source/catalog.
- Show name, short description, install status, and dependency notes where relevant.
- Use an Ink multi-select control in interactive TTY mode.
- Keyboard contract:
  - Arrow up/down moves focus.
  - Space selects or unselects the focused item.
  - Enter locks in the selected set and continues.
  - Escape or an explicit cancel action returns to the previous safe state where practical.
- Default selections should follow each plugin's `defaultSelected` metadata.
- Already-installed plugins are shown as installed and are not selected for reinstall by default.
- Dependency ordering is still resolved by `planPluginDependencyOrder()`.

Official agents:

- List every official agent from the curated catalog currently shipped at `packages/host/src/data/curated-agents.json`.
- Show name, description, tags, trust/source, and install status.
- Use the same Ink multi-select keyboard contract as plugins.
- Selected agents install through the existing agent package install path using each catalog entry's `source` and `ref`.
- Already-installed/adopted agents are shown as installed and are not selected for reinstall by default.
- Installing agents must be optional; the user can continue with none selected if the runtime prerequisite is already satisfied.

Automation and non-TTY behavior:

- `--yes` uses default selections and never prompts.
- `--json` never prompts and reports the available/default/selected sets.
- Non-TTY without `--yes` does not prompt; it should skip optional selections with an actionable message.

## Doctor Flow

`bakin doctor` uses the same Ink visual system as onboarding but behaves as a diagnostic report, not a wizard.

Default behavior:

- Force a fresh diagnostic run.
- Group checks by system area where possible.
- Show a compact severity summary.
- Show check rows with status, name, message, and actionable remediation.
- Do not prompt by default.
- Do not auto-fix by default.
- Hide raw logs unless verbose/details mode is requested.

Deferred follow-up:

- `bakin doctor --fix` / interactive remediation actions should follow immediately after this CLI cutover.
- Before implementing fix actions, verify whether existing health checks already expose a clean auto-fix path that can be surfaced as a thin CLI affordance.
- Do not block the TUI/reporting cutover on new repair-workflow design.

Candidate groups:

- Runtime
- Bakin server
- Search
- Plugins
- Agent packages/assets
- Tasks/workflows/schedule
- Storage/content paths

## CLI Architecture

All public command dispatch should be unified behind the compiled `bakin` CLI path.

Target shape:

- One canonical command registry and parser.
- No split where `src/core/cli.ts` handles some commands and `cli/bakin.ts` handles others.
- Command handlers should return structured results/exit codes rather than calling `process.exit()` deep inside handlers.
- Ink rendering should sit at the presentation boundary.
- Core checks/installers stay renderer-agnostic and testable.
- `--json` should bypass Ink and emit structured JSON.
- `--json` is a global convention supported by every public command.
- Non-TTY output should be deterministic and readable.
- Remove legacy delegation rather than preserving compatibility shims.
- One PR may cover the full CLI surface, but commits must be granular and leave natural rollback points.

## Command Surface Care

Every built-in command should receive command-appropriate TUI treatment:

- Setup flows (`onboard`, `check`, `install`) use step/status layouts with remediation and confirmation where needed.
- Diagnostic flows (`doctor`, `status`, `logs`, `paths`) use grouped reports and compact summaries.
- Data-management flows (`tasks`, `agents`, `packages`, `plugins`, `schedule`, `search`, `trash`) use consistent tables, empty states, validation errors, and success summaries.
- Lifecycle flows (`start`, `stop`, `restart`, `dev`, `update`) use clear progress state and final outcome messages.
- Script/agent-oriented variants use `--json` or non-TTY plain output, while preserving the same structured data model.
- Long-running commands such as `start` and `dev` should use Ink for preflight/status only when helpful, then hand off cleanly to the long-running process/log stream.
- Plugin-contributed CLI commands use the canonical parser, JSON envelope, errors, and generic result renderer. Rich bespoke Ink layouts require richer plugin command metadata and are not required in this cutover.

The implementation plan should cover the full CLI surface in one PR. Work may still be internally sequenced through granular commits, but the branch should land as a full cutover rather than a partially polished CLI.

## Agent Consumption Contract

Agents are expected to consume many CLI commands directly, especially data and operational commands outside the most human-heavy flows (`onboard`, `doctor`, `start`, `restart`, `dev`).

Requirements:

- Every command that returns data must support deterministic machine consumption.
- Prefer `--json` for structured data and automation.
- Every public command supports `--json`; commands with no data still return a stable status envelope.
- Global flags must be parsed without stealing command payloads. Commands that accept raw JSON/text payloads must support `--` to end option parsing.
- JSON output uses one consistent envelope across commands:

```json
{
  "ok": true,
  "command": "example",
  "exitCode": 0,
  "data": {},
  "error": null
}
```

- Failure envelopes use stable error codes where practical:

```json
{
  "ok": false,
  "command": "onboard",
  "exitCode": 1,
  "data": {},
  "error": {
    "code": "RUNTIME_BLOCKED",
    "message": "Bakin requires an active agent runtime."
  }
}
```

- Non-TTY output must avoid dynamic Ink repaint behavior.
- Plain non-TTY output remains plain text by default; JSON is selected explicitly with `--json`.
- Machine-readable output must not include ANSI color, spinners, progress animation, or prose-only summaries.
- Validation errors should include stable error codes where practical.
- Exit codes must remain meaningful and documented.
- Interactive prompts must never appear in non-TTY mode unless the user explicitly requests interactivity.
- `--yes` remains the automation path for confirmations that are safe to auto-approve.
- Destructive commands should require explicit flags in non-TTY mode rather than hidden prompts.

## Interactive Prompt Contract

Interactive TTY prompts should use Ink-native controls rather than raw `y/n` prompts.

Requirements:

- Use clear focus state and visible keyboard affordances.
- Support Enter for the default/selected action.
- Support arrow/tab navigation where multiple actions exist.
- Keep typed `y/n` only as a plain fallback for non-Ink/plain rendering if needed.
- Never prompt in `--json` mode.
- Never prompt in non-TTY mode unless explicit interactivity is requested.
- Use `--yes` for safe automation approvals.
- Require explicit destructive flags such as `--force` rather than relying on prompts in automation.
- Plugin-contributed commands should not prompt unless their command metadata explicitly supports an interactive flow.

## Ink Usage

Use Ink for human-facing TUI rendering.

Official Ink docs describe it as a React renderer for CLIs with `<Box>`, `<Text>`, hooks, `render()`, and `renderToString()`. Ink supports inline rendering by default and alternate-screen rendering when explicitly enabled. This spec defaults to inline rendering so terminal scrollback remains useful during setup failures.

Implementation expectations:

- Add `ink` as a dependency if absent.
- Reuse existing React dependency.
- Keep components under a CLI-specific module tree, not mixed into browser UI components.
- Use `renderToString()` or Ink testing utilities for stable output tests where practical.
- Start with `renderToString()` and command runner tests; add an Ink interaction testing helper only for keyboard controls that need real input coverage.
- Do not use alternate screen for onboarding or doctor unless a later decision changes this.

## Logging And Details

Default CLI output must not stream low-level provider logs.

Requirements:

- Antfly/OpenClaw/provider logs continue to be written to durable log files.
- Onboarding shows high-level provider state, not raw provider lines.
- `--verbose` may show raw logs or expanded detail.
- `--json` output remains machine-readable and does not include ANSI decoration.
- Console logger behavior must not fight Ink output.

## Commands

Primary commands involved:

```sh
bakin onboard
bakin onboard --check
bakin onboard --yes
bakin onboard --json
bakin onboard --force
bakin onboard --verbose

bakin doctor
bakin doctor --json
bakin doctor --verbose

bakin <command> --json

bakin start
bakin stop
bakin restart
bakin dev
bakin status
bakin check all
bakin install search
bakin install search-models
bakin install plugin-assets
bakin install agent-assets
bakin install recommended-plugins
```

Repository commands for verification:

```sh
bun run lint
bun run typecheck
bun test --isolate tests/cli
bun test --isolate tests/core/doctor.test.ts tests/core/doctor-plugin-checks.test.ts
bun test --isolate tests/dev/mock-onboarding-contract.test.ts
bun run docs:generate
bun run docs:validate
node ./node_modules/astro/bin/astro.mjs build
```

## Project Structure

Existing:

```text
cli/bakin.ts                         legacy/source CLI entry
src/core/cli.ts                      compiled binary CLI dispatcher
src/core/cli/registry.ts             command contracts/docs
src/core/onboarding/*                onboarding checks/installers
src/core/doctor.ts                   doctor orchestration
packages/adapter-antfly/*            search adapter setup/logging
plugins/health/*                     doctor routes and system checks
tests/cli/*                          CLI coverage
.claude/knowledge/*                  deep references
docs/src/content/docs/start/*        setup/operation docs
docs/src/content/docs/using/health.md health docs
```

Target additions:

```text
src/core/cli/commands/*              command handlers and parsing
src/core/cli/ui/*                    Ink components and shared CLI design system
src/core/cli/render.ts               TTY/json/plain renderer boundary
tests/cli/ui/*                       render/output tests
```

Exact file layout can be adjusted during planning to fit the existing codebase.

## Code Style

Keep core behavior separated from terminal presentation:

```ts
export interface CliCommandResult<TPayload = unknown> {
  exitCode: 0 | 1 | 2
  payload: TPayload
}

export async function runOnboardCommand(options: OnboardCommandOptions): Promise<CliCommandResult<RunOnboardResult>> {
  const result = await runOnboard(options)
  return { exitCode: result.exitCode, payload: result }
}
```

Ink components should receive already-normalized view models, not call installers directly unless they are a thin shell around an explicit command runner.

## Testing Strategy

Add or update tests at these layers:

- Parser/dispatch tests: every public CLI command routes through the canonical dispatcher.
- Onboarding renderer tests: runtime blocker renders one blocker panel, docs link, blocked step summary, and no duplicated remediation.
- Doctor renderer tests: groups statuses, summarizes severity, and hides raw logs by default.
- JSON/non-TTY tests: no Ink-only formatting, no ANSI codes, deterministic output.
- Existing core onboarding tests remain focused on component behavior.
- Existing doctor orchestration tests remain focused on registry/gate/audit behavior.
- CLI docs generation tests continue to validate command registry output.

## Documentation

Update docs if behavior changes:

- `docs/src/content/docs/start/first-time-setup.mdx`
- `docs/src/content/docs/start/operation.md`
- `docs/src/content/docs/using/health.md`
- Generated CLI docs through `src/core/cli/registry.ts` + `bun run docs:generate`
- `.claude/knowledge/doctor-and-health-checks.md` if doctor CLI behavior changes materially
- `.claude/knowledge/dev-loop.md` if `bakin dev` dispatch/logging changes materially
- Add/update `.claude/knowledge/cli-tui-dx.md` if the final architecture is substantial enough to need deep reference coverage

## Boundaries

Always:

- Preserve a scriptable `--json` path.
- Keep onboarding/doctor core logic renderer-agnostic.
- Keep runtime setup user-managed.
- Keep runtime missing as a hard blocker.
- Keep terminal output readable without color.
- Run focused CLI/onboarding/doctor tests before commit.
- Update docs and `.claude/knowledge` when behavior or architecture changes.

Ask first:

- Adding a non-Ink prompt framework.
- Switching onboarding to alternate-screen/full-screen mode.
- Auto-installing or mutating an agent runtime.
- Changing onboarding component order.
- Changing exit-code semantics.
- Removing public commands from the CLI surface.
- Keeping compatibility shims or duplicate command implementations after the cutover.

Never:

- Hide hard failures behind green status.
- Print raw provider logs in default onboarding output.
- Repeat identical remediation for every cascade-skipped dependent step.
- Call `process.exit()` from deep command helpers.
- Modify runtime-owned config automatically during onboarding.

## Success Criteria

- `bakin onboard` renders an organized Ink flow in interactive terminals.
- Missing runtime produces a controlled blocker screen with docs and next steps.
- Missing runtime does not print raw Antfly/provider logs by default.
- Missing runtime does not repeat downstream remediation for every skipped component.
- `bakin doctor` renders a grouped diagnostic report using the same status language.
- `--json` remains clean and parseable.
- CLI dispatch has a clear path toward one compiled command surface.
- The legacy split dispatcher is removed or reduced to a single thin entry that calls the canonical command runner.
- Every public human-facing command uses the shared CLI UI system by the end of the PR.
- Tests cover the runtime-blocker UX and doctor report UX.
- Relevant docs and `.claude/knowledge` are updated.

## Open Questions

- Should `bakin install <component>` use Ink confirmation/progress now, or only after onboard/doctor are complete?
- Which exact official runtime prerequisite URL should the runtime blocker display?
- `bakin doctor --fix` is deferred from this PR but should be the immediate follow-up; discovery must verify whether existing auto-fix behavior can be exposed thinly.
- CLI UI tests start with `renderToString()` and command runner coverage; add an Ink-specific helper only if prompt keyboard behavior requires it.
