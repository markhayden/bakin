# Implementation Plan: CLI TUI DX Hardening

Spec: `.claude/specs/cli-tui-dx-hardening.md`

## Overview

This plan finishes the branch as a full hard cutover. Work is intentionally
sequenced into commits that leave natural rollback points. Each checkpoint should
typecheck and run the focused tests for the area just changed.

Priority is tech-debt reduction over compatibility. The plan removes old shims,
source-checkout assumptions, and partially migrated command paths.

## Phase 0: Baseline And Guardrails

Tasks:

- Confirm branch is not `main`.
- Capture current `git diff main...HEAD` and current focused test baseline.
- Add or update tests that lock the intended failures before broad rewrites:
  - plugin deprecated SDK import fails clearly
  - user plugin registry refuses source activation when dist is absent
  - agent-package lockfile is not left stale on late install failure
  - offline doctor renders skipped server checks
  - service manager default is manual

Commit:

1. `test: add hardening regression coverage`

Verification:

- `bun run typecheck`
- Focused new tests; failing tests are acceptable only before the implementation
  commit that fixes them.

## Phase 1: Canonical SDK Name

Tasks:

- Rename SDK package metadata from `@bakin/sdk` to `@makinbakin/sdk`.
- Update TS paths/import resolution as needed.
- Replace plugin source imports.
- Replace build externals in:
  - `scripts/build-plugins.ts`
  - `scripts/dev.ts`
  - `scripts/dev-build-one-plugin.ts`
  - `packages/host/build.ts`
  - `packages/host/src/plugin-host/user-plugin-builder.ts`
- Replace browser import map entries and vendor bundle generation.
- Update tests/fixtures/snippets/docs/knowledge.
- Remove dual alias expectations.
- Keep `@bakin/core` untouched.

Commit:

2. `refactor: make makinbakin sdk the only plugin sdk import`

Verification:

- `rg "@bakin/sdk"` returns no plugin-facing references.
- `bun run build:vendors`
- `bun run build:plugins`
- `bun run typecheck`
- SDK/import-map/plugin-host focused tests.

Rollback point:

- If this fails broadly, revert this commit without touching later service/doctor
  work.

## Phase 2: Dist-Only User Plugin Activation

Tasks:

- Remove plugin-registry workspace symlink repair.
- Require user plugin activation from `dist/index.js`.
- Ensure install/link builds before activation.
- Ensure dev-linked reload rebuilds before activation.
- Mark plugins failed/inactive when dist is missing or build fails.
- Surface build errors in registry snapshot/manifest/doctor.
- Remove source-import fallback.

Commit:

3. `refactor: activate user plugins from built artifacts only`

Verification:

- Plugin registry tests.
- User plugin lifecycle tests.
- Hot reload/link tests.
- Manual smoke with a temp plugin importing `@makinbakin/sdk`.

Rollback point:

- Revert this commit if user plugin activation regresses, leaving canonical SDK
  rename intact.

## Phase 3: Plugin Dependency Boundary And Compatibility Gates

Tasks:

- Add build-time import/dependency scanner.
- Fail deprecated `@bakin/sdk/*` imports clearly.
- Fail app-internal imports (`@/`, `src/`, relative traversal into Bakin source).
- Fail undeclared third-party imports.
- Keep Bakin-provided external list explicit.
- Validate manifest Bakin version compatibility during install and boot.
- If plugin dependencies require external tooling and it is unavailable, fail
  before mutating install state.

Commit:

4. `feat: enforce plugin dependency and compatibility gates`

Verification:

- Builder tests for allowed/denied imports.
- Install tests for incompatible Bakin version.
- User plugin lifecycle tests.
- `bun run typecheck`.

Rollback point:

- Revert dependency gate commit independently if enforcement is too strict.

## Phase 4: Agent-Package Installer Transaction Fix

Tasks:

- Make lockfile update and staging commit transactionally coherent.
- Add rollback for prior lockfile state or reorder write after durable commits.
- Clarify/restrict `installAs` for agent packages.
- Add tests for failures after projections and after lockfile preparation.

Commit:

5. `fix: make agent package installs transaction safe`

Verification:

- Agent package installer, collision, updater, lockfile tests.
- Onboarding recommended agents tests.

Rollback point:

- Revert this commit if package install behavior regresses.

## Phase 5: Runtime And Models Robustness

Tasks:

- Make onboarding runtime check use runtime adapter only, not full app-services.
- Ensure runtime prerequisite check cannot start Antfly/search.
- Improve OpenClaw binary/path messaging.
- Add negative cache/backoff for failed model list command.
- Replace raw model-list stack trace logging with concise warning + verbose detail.

Commit:

6. `fix: harden runtime checks and model discovery`

Verification:

- Onboarding runtime tests.
- OpenClaw adapter binary/model tests.
- Models plugin route tests.
- Manual fresh-machine smoke where OpenClaw model listing fails.

## Phase 6: Dispatcher Diagnostics

Tasks:

- Add route/plugin/method/path context to dispatcher validation failures.
- Thread route context from plugin catch-all dispatch.
- Ensure binary/text routes declare non-JSON response specs.
- Add tests proving anonymous parse warnings are gone.

Commit:

7. `fix: add actionable route contract diagnostics`

Verification:

- Route dispatcher tests.
- Assets file route tests.
- Plugin route tests.
- Docs route contract check if applicable.

## Phase 7: Offline Doctor And Explicit Notification

Tasks:

- Add local/offline diagnostic runner.
- Make default `bakin doctor` degrade when server is unreachable.
- Add strict `bakin doctor --full`.
- Add explicit `bakin doctor --notify-agent`.
- Remove automatic main-agent notification from default doctor/server boot path.
- Render skipped server-only checks clearly.
- Add JSON shape with `mode: "offline" | "full"`.

Commit:

8. `feat: support offline doctor diagnostics`

Verification:

- Doctor core tests.
- CLI doctor UI tests.
- Offline server-unreachable smoke.
- JSON envelope tests.

Rollback point:

- Revert doctor commit independently if server-backed diagnostics regress.

## Phase 8: Service Management And Autostart

Tasks:

- Add service settings shape:
  - `enabled`
  - `manager: 'manual' | 'launchd' | 'systemd'`
- Add service manager abstraction.
- Implement macOS LaunchAgent manager.
- Implement Linux user systemd manager.
- Add hidden non-delegating `bakin serve`.
- Add `bakin autostart enable|disable|status|restart`.
- Update `start|stop|restart` behavior to respect service mode.
- Remove broad `pgrep -f` process management.
- Update doctor service check to use the abstraction.
- Add onboarding near-end autostart choice, default manual.

Commit:

9. `feat: add explicit autostart service management`

Verification:

- Service manager unit tests with command execution mocked.
- Settings tests.
- CLI autostart render/JSON tests.
- Doctor service tests.
- Manual macOS smoke if safe.
- Linux manager tests can use mocked `systemctl`.

Rollback point:

- Revert this commit if service behavior is not launch-ready.

## Phase 9: Full CLI Command Cutover

Tasks:

- Move built-in command handlers out of `cli/bakin.ts` into canonical runner.
- Convert handlers to structured results.
- Normalize unknown flags, missing values, errors, and JSON envelopes.
- Keep plugin command fallback under canonical runner.
- Reduce `cli/bakin.ts` to a thin entrypoint.
- Delete commented legacy LaunchAgent/reboot code.
- Ensure `bun run cli ...`, source direct, and binary dispatch paths share the
  same implementation.

Commit:

10. `refactor: complete canonical cli command cutover`

Verification:

- CLI parser/runner/render tests.
- Onboarding UI tests.
- Doctor UI tests.
- Command smoke tests for representative commands:
  - `onboard --check --json`
  - `doctor --json`
  - `paths --json`
  - `plugins list --json`
  - `agents list --json`
  - `autostart status --json`
  - unknown command

Rollback point:

- This is the highest-risk commit. Keep it separate from service/plugin fixes so
  it can be reverted without losing earlier hardening.

## Phase 10: Documentation And Knowledge

Tasks:

- Update `.claude/knowledge` files:
  - `plugin-system.md`
  - `agent-packages.md`
  - `doctor-and-health-checks.md`
  - `adapter-architecture.md`
  - `release-pipeline.md`
  - `dev-loop.md`
- Update README/docs impacted by command names and onboarding/autostart.
- Mark old CLI TUI spec as superseded or remove it if the new spec fully
  replaces it.
- Add references to issues #267, #268, #269 for deferred work.

Commit:

11. `docs: update cli hardening architecture notes`

Verification:

- `bun run docs:validate` where applicable.
- `rg "@bakin/sdk"` confirms no stale docs except intentional migration history.

## Phase 11: Final Verification

Tasks:

- Run typecheck.
- Run plugin build and host build.
- Run focused test groups:
  - CLI
  - onboarding
  - doctor/health
  - plugin lifecycle/builder/registry
  - agent packages
  - OpenClaw adapter/models
  - service manager tests
- Run docs validation.
- Manual smoke:
  - offline doctor
  - runtime-missing onboarding
  - plugin install/build failure with missing Bun/tooling
  - autostart status on current platform
  - `bakin serve` foreground path

Commit:

12. `test: verify cli hardening cutover`

Final PR checklist:

- No `@bakin/sdk` compatibility aliases remain.
- No plugin registry symlink repair remains.
- No raw user plugin source activation remains.
- No broad process-kill restart fallback remains.
- No default doctor runtime notification remains.
- JSON output remains deterministic.
- TUI output remains crisp for onboarding/doctor/autostart errors.
