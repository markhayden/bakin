# Spec: CLI TUI DX Hardening

## Status

Draft for the second-stage CLI/plugin/runtime hardening pass on branch
`cli-tui-dx`.

This spec supersedes the original CLI TUI DX cutover spec for all unfinished
work. The original spec remains useful as historical context for the first pass;
this document is the source of truth for the remediation work identified during
the branch review.

## Objective

Finish the hard cutover to a crisp, reliable Bakin developer experience before
public launch. The goal is not compatibility with partially migrated internals.
The goal is a clean architecture that behaves predictably for humans, agents,
source checkouts, and compiled binary installs.

This pass addresses:

- Full CLI command ownership under the canonical runner.
- A single public plugin SDK import contract.
- Dist-only user plugin activation with hard dependency hygiene.
- Clean plugin build/install failure modes for binary users.
- Agent-package installer rollback correctness.
- Runtime and model-listing robustness on fresh machines.
- Offline/degraded doctor.
- First-class macOS/Linux service management.
- Removal of legacy shims, commented service code, and accidental source-repo
  assumptions.

## Non-Goals

- Windows support. Supported platforms for this pass are macOS and Linux.
- Per-plugin SDK runtime versions. A running Bakin instance provides one SDK
  version.
- A fully self-contained binary plugin builder. That is tracked separately in
  GitHub issue #267.
- Deterministic doctor repairs. `doctor --fix` is tracked separately in GitHub
  issue #268.
- Agent-delegated doctor repair tracking. Tracked separately in GitHub issue
  #269.
- Backwards compatibility for old `@bakin/sdk` plugin imports.

## Guiding Principles

- Prefer deleting transitional compatibility over preserving it.
- Make prerequisites explicit before mutating user state.
- Do not import runtime plugin source directly.
- Do not depend on the Bakin source checkout in binary/user-plugin paths.
- Default human commands should be polished and calm.
- Agent/script consumption should use deterministic JSON envelopes.
- Diagnostics should produce useful output even when the server is offline.
- Service management must be explicit and reversible.

## CLI Architecture

All built-in command ownership moves to the canonical CLI runner under
`src/core/cli/*`.

Target shape:

- `cli/bakin.ts` is a thin source-mode entrypoint only.
- Built-in handlers return structured command results instead of calling
  `process.exit()` deep in the stack.
- Renderers sit at the boundary:
  - Ink for interactive TTY.
  - Plain deterministic text for non-TTY.
  - JSON envelope for `--json`.
- Plugin command fallback still exists, but it flows through canonical parsing,
  errors, result envelopes, and generic rendering.
- Unknown flags and missing flag values fail clearly.
- `--` ends global/command option parsing for raw text/JSON commands.
- Legacy commented LaunchAgent/reboot blocks are deleted, not carried forward.

Every public command supports `--json` unless it is an intentionally long-running
foreground stream. Long-running commands must clearly document their JSON
behavior.

## Public SDK Contract

The only plugin-facing SDK import name is:

```ts
@makinbakin/sdk
@makinbakin/sdk/*
```

Hard cutover requirements:

- Rename `packages/sdk/package.json` to `@makinbakin/sdk`.
- Remove every `@bakin/sdk` import-map entry.
- Remove every `@bakin/sdk` build external.
- Update plugin source, examples, fixtures, tests, docs, generated references,
  and `.claude/knowledge` to use `@makinbakin/sdk/*`.
- `@bakin/core` remains separate as an internal/backend core package.
- Installed plugins that import `@bakin/sdk/*` fail build/activation with a clear
  error telling the user to update imports to `@makinbakin/sdk/*`.
- No compatibility shim rewrites or aliases are added.

The npm package is useful for plugin-author editor types and CI, but runtime and
install behavior are governed by the SDK bundled with the running Bakin version.

## Plugin Runtime And Build Contract

User plugins activate from built artifacts only:

```text
~/.bakin/plugins/<plugin-id>/dist/index.js
~/.bakin/plugins/<plugin-id>/dist/client.js
```

Source files may remain in `~/.bakin/plugins/<plugin-id>/`, but Bakin never
imports `index.ts` directly at runtime.

Requirements:

- Plugin install/link builds server/client artifacts before activation.
- Plugin registry imports only `dist/index.js` for user plugins.
- If `dist/index.js` is missing or stale and cannot be built, the plugin is
  marked failed/inactive with a clear build error.
- Dev-linked plugins still support live reload by rebuilding `dist/*`, then
  reloading from `dist/index.js`.
- Build errors are surfaced in plugin status and doctor.
- Runtime symlink repair into installed plugin `node_modules` is removed.

## Plugin Dependency Hygiene

Bakin-provided externals are small and explicit:

- `react`
- `react-dom`
- `react-dom/client`
- `react/jsx-runtime`
- `react/jsx-dev-runtime`
- `@tanstack/react-router`
- `@makinbakin/sdk`
- supported `@makinbakin/sdk/*` subpaths

Everything else is plugin-owned. If a plugin imports another package, that
package must be declared in the plugin's own `package.json`.

Build-time enforcement:

- Reject imports from app internals such as `@/...`, `src/...`, `../../../src`,
  or old `@bakin/sdk/*`.
- Reject imports of undeclared third-party packages.
- Allow relative imports within the plugin source tree.
- Allow Node/Bun built-ins where appropriate for server builds.
- Client builds must not import server-only Node modules unless bundled tooling
  can prove they do not enter browser code.

Short-term binary behavior:

- If a plugin declares dependencies and the required external tooling is not
  available, fail before mutating plugin install state.
- The error must explain the prerequisite and point at the self-contained builder
  follow-up.
- No partial install, no activation from source, no runtime symlink hack.

## Plugin Compatibility

One Bakin instance provides one SDK version. Plugins declare Bakin compatibility
through their manifest's Bakin version range.

Requirements:

- Install fails before build/copy if a plugin declares an incompatible Bakin
  version range.
- Server boot marks previously installed incompatible plugins as failed/inactive.
- Incompatible plugins do not register server routes and are not exposed in the
  browser plugin manifest.
- Doctor reports incompatible plugins with remediation: update plugin, remove
  plugin, or change Bakin version.

## Agent-Package Installer Correctness

The installer must not leave lockfile entries when a late install failure removes
or fails to commit source artifacts.

Requirements:

- Treat lockfile writes and staging commits as one logical transaction.
- If any post-lockfile step fails, restore the previous lockfile or reorder the
  flow so the lockfile is written only after commit state is durable.
- Keep existing projection/runtime rollback behavior.
- Add tests for failures after projection and after lockfile preparation.
- `installAs` behavior must be consistent for agent packages. If it is supported,
  it must affect the runtime agent id and lockfile key coherently. If not
  supported for agent packages, reject it with a clear message.

## Runtime And Models Robustness

Runtime checks should not initialize the full Bakin app-services/search stack just
to validate runtime availability.

Requirements:

- Onboarding runtime checks instantiate or access only the runtime adapter.
- No Antfly/search startup is triggered by the runtime prerequisite check.
- OpenClaw binary resolution checks PATH and configured binary paths without
  hard-coding Homebrew as the only expected install.
- Model listing failures from `openclaw models list --all --json` are
  negative-cached/backed off.
- Model-list errors are logged as concise one-line warnings by default, with raw
  error detail available in verbose logs.
- Repeated UI requests must not spam identical model-list stack traces.

## Dispatcher Contract Diagnostics

Route response contract failures must be actionable.

Requirements:

- Dispatcher warnings include method, route path, plugin id when available,
  response status, response content-type, and validation reason.
- In test mode, contract mismatches continue to throw.
- In dev mode, contract mismatches should be loud enough to fix quickly and
  should not emit anonymous `[dispatcher] response 200...` messages.
- Routes returning binary/text responses must declare non-JSON response specs.

## Doctor

`bakin doctor` becomes useful with or without a running Bakin server.

Default behavior:

- Try server-backed diagnostics.
- If the server is reachable, run the full diagnostic report.
- If the server is unreachable, run offline/local diagnostics and render skipped
  server-only checks.

Offline/local checks include at minimum:

- onboarding marker and version
- settings parse
- configured runtime adapter availability
- search binary/config availability
- service/autostart status
- plugin lockfile parse and build-state surface
- agent-package lockfile parse and projection/source sanity where possible

Skipped server-only checks should be explicit, for example:

```text
SERVER CHECKS
[SKIP] plugin health       Requires running Bakin server
[SKIP] runtime hooks       Requires running Bakin server
[SKIP] live search tables  Requires running Bakin server
```

Exit behavior:

- `0`: no local/full errors and no warnings beyond expected offline skips.
- `2`: warnings exist.
- `1`: errors exist.

Strict mode:

- `bakin doctor --full` requires server-backed diagnostics.
- If the server is offline, exit `1` with a clear message to run `bakin start`.

Agent notification:

- Default `bakin doctor` is report-only.
- `bakin doctor --notify-agent` explicitly sends the report to the configured
  main/orchestrator agent.
- Notification is best-effort and reports success/failure cleanly.
- Automatic main-agent notifications are removed from default doctor/server boot.

## Service Management And Autostart

Supported platforms:

- macOS: LaunchAgent via `launchctl`
- Linux: user systemd via `systemctl --user`

Settings shape:

```ts
service: {
  enabled: boolean
  manager: 'manual' | 'launchd' | 'systemd'
}
```

Default:

```ts
{ enabled: false, manager: 'manual' }
```

Commands:

- `bakin autostart enable`
- `bakin autostart disable`
- `bakin autostart status`
- `bakin autostart restart`

Server target:

- `bakin serve` is the non-delegating foreground server target.
- It is hidden from normal help.
- It exists for service managers and advanced debugging.
- It never installs, starts, stops, or restarts services.
- It never prompts.
- It ignores `settings.service.enabled`.
- Service files must call `bakin serve`, never `bakin start`.

User-facing lifecycle:

- `bakin start` follows the configured service preference.
  - service disabled: run foreground server/manual mode
  - service enabled: ask launchd/systemd to start the managed service, then exit
- `bakin restart` restarts the managed service when service mode is enabled.
- `bakin stop` stops the managed service when service mode is enabled.
- Do not use broad `pgrep -f` process hunting.
- Manual foreground processes are stopped with Ctrl+C unless a future verified
  PID ownership model is implemented.

Onboarding:

- Near the end, after core setup succeeds, ask whether to enable autostart.
- Default selection is manual.
- `--yes` keeps manual unless an explicit service/autostart flag is supplied.
- Service installation is an externally visible host mutation and requires
  explicit consent.

Doctor:

- Checks the configured manager only.
- Reports platform/manager mismatch clearly.
- Verifies service file path, executable path, args, load/enable state, and
  running state where possible.

## Documentation And Knowledge

Update as part of this work:

- `.claude/knowledge/plugin-system.md`
- `.claude/knowledge/agent-packages.md`
- `.claude/knowledge/doctor-and-health-checks.md`
- `.claude/knowledge/adapter-architecture.md`
- `.claude/knowledge/release-pipeline.md`
- README/docs if command names or onboarding instructions are impacted

Docs must reflect:

- canonical SDK import name
- dist-only plugin activation
- plugin dependency boundary
- offline doctor behavior
- autostart/service behavior
- macOS/Linux platform scope

## Acceptance Criteria

- `bun run cli ...`, source entry, and compiled binary entry use the same
  built-in command implementation.
- `@bakin/sdk` is gone from plugin-facing code, docs, import maps, build
  externals, tests, and fixtures.
- User plugins activate only from `dist/index.js`.
- No runtime source-repo symlink repair remains.
- Plugin build/import boundary is enforced with clear errors.
- Agent-package install failures cannot leave stale successful lockfile entries.
- Runtime prerequisite checks do not start search/app-services.
- Model list failures do not spam repeated stack traces.
- Dispatcher contract errors identify the route/plugin.
- `bakin doctor` works offline with degraded checks.
- `bakin doctor --full` is strict.
- `bakin doctor --notify-agent` is explicit.
- macOS/Linux autostart is implemented through first-class service managers.
- `bakin serve` is hidden, foreground-only, and non-delegating.
- Onboarding defaults to manual service mode.
- Tests cover all changed contracts.
