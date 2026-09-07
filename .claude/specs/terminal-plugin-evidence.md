# Terminal Implementation Evidence

Date: 2026-09-09. Scope: development implementation, not release approval.

## Screenshot-driven Design Pass

The reported HTTP-origin crash was reproduced with `crypto.randomUUID` absent.
Terminal client markers now use 128 cryptographically random bits through
`getRandomValues`, which is available on insecure HTTP contexts. The installed
page was also checked at the device's HTTP Tailscale address: `isSecureContext`
was false, `randomUUID` undefined, and Terminal loaded successfully.

Removed the hand-styled session rail, row selection, toolbar rhythm, and text
styles. Public PageAside, dense ListRows, Stack/Inline/Section, Text, AgentSelect,
and BoundedOverflow now own those concerns. Empty/loading/error states use
SystemState page scope with no empty rail or decorative frame. Request failures
have a retry state instead of being mistaken for missing service setup; stale
refresh failures retain usable content and clear after recovery. Narrow screens
use Select for session navigation. The only plugin CSS left is xterm's focused
terminal outline, using the kit focus token, plus xterm's own renderer styles.

Selected stories: WorkspacePage/FullBleedWorkspace,
CollapsibleAside/CollapseRoundtrip, ListRows/DenseRows,
SystemState/ScopeAndRecovery, Flow/CanonicalUsage, and Text/CanonicalUsage.
No public contract, token, baseline, exception, or style allowance was changed.

Verification: core quick conformance (228 architecture tests plus TypeScript),
Bits lint/typecheck, clean installed-SDK tests (15 passing unit tests), and the
canonical plugin UI fixture passed. Focused browser checks cover absent UUID,
empty/error/recovery states, rail collapse, route selection, long-title mobile
navigation, populated form behavior, and real shell input/reconnect/completion.
Screenshots in Bits `plugins/terminal/test-results/{design,live}` were inspected.
Full conformance was not rerun for this composition-only pass; existing broad
gate failures below still block a merge-ready release claim. The dev Tailwind
watcher regenerated `packages/sdk/styles.css` for the new consumer classes.

## Local Dev Installation and Form Follow-up

On explicit user request, Terminal is now installed in the existing local dev
instance at `http://localhost:3737/terminal`, using its normal Bakin home. Both
permanent checkouts are on `feat/terminal-plugin`; nothing was merged or published.
The plugin is linked from the permanent official Bits checkout with hot reload.
Its private launchd service is installed and ready. The old disposable preview
has been stopped. Agent access remains opt-in; no agents were silently enabled.

New Terminal loads named runtime agents (disabled entries remain visible), active
tasks, optional Projects choices, and valid directory/agent defaults. Task links
and agent workspaces suggest values without replacing manual titles/directories.
The public AgentSelect `CanonicalUsage` and Select `CanonicalUsage` patterns are
composed through SDK `/patterns` and `/ui`; no system extension was needed.

Verification: installed-SDK typecheck/unit tests/UI fixture, Bits typecheck/lint,
and core quick conformance passed. Installed-host Playwright checks passed for
defaults, disabled agents, task/project linking, preserved edits, real shell
input/reconnect/completion, and desktop/mobile layouts. Initial smoke-test failures
were service readiness and the host's mobile Live Activity overlay; tests now
close that overlay and complete only their own sessions even on failure. The
actual 10-agent roster and long task label were checked in the mobile dialog.
All smoke-test shells were completed; no user session was touched.

Before restart, live-run and streaming-chat APIs both reported no active work.
The existing generated-version and embedded-assets edits were preserved exactly.
Configuration and edit backups are in
`/private/tmp/bakin-terminal-install-backup-20260909` (private directory).
The dev server logs to `~/.bakin/dev-terminal.log` and uses the existing data.
The broad pre-release gate failures below remain unresolved, not waived.

## Passing Checks

- Core affected tests:70 passed,220 assertions across10 files covering MCP
  credentials/session binding/policy, runtime provider, OpenClaw provisioning,
  Git session worktrees, remove/unlink, SDK harness, and snapshot-failure behavior.
- Latest Git-only rerun:4 passed,35 assertions.
- Core `bun run ui:conformance --quick`:passed, including 228 UI architecture
  tests and TypeScript. No public API/baseline allowance changed.
- Core lint:zero errors,5 existing warnings. Bits lint/typecheck:passed.
- Terminal tests through the normal Bits DOM preload:13 passed,2 opt-in tests
  skipped,53 assertions. The opt-in tests were separately executed successfully.
- Real tmux test: shell PID survives manager restart; input, resize, completion
  pass. `TERMINAL_CLI_TEST=1` additionally starts Claude Code and Codex, observes
  nonempty interactive screens and live processes, then terminates them. No
  prompt submission, autonomous work, or permission-mode override.
- Separate launchd probe retained shell PID across host LaunchAgent restart,
  and checked counter, resize and interrupt. tmux3.7c/Bun1.3.13/macOS.
- Public real-SDK `bun run test:ui`:passed. HTML report and desktop/mobile
  screenshots are in Bits `plugins/terminal/test-results/bakin-ui/`.
- Clean installed-package verification also passes via
  `BAKIN_SDK_PACKAGE_DIR=/private/tmp/bakin-terminal-sdk bun run ui:conformance`:
  standalone TypeScript, all 13 Terminal unit tests, and the browser fixture.
  The copied report is `test-results/plugin-ui-conformance/terminal/index.html`
  in Bits. Terminal is explicitly enrolled as a conformant official plugin.
- Live Playwright shell create/input/reconnect/terminate:passed at1440x900 and
  320x740, no browser runtime errors or horizontal document overflow. Screenshots
  are in `plugins/terminal/test-results/live/` and were visually inspected.
- Assembled matching SDK builds successfully. Bits builds all3 plugins with
  `BAKIN_SDK_DIR=/private/tmp/bakin-terminal-sdk bun run build`.
- Package metadata and lockfile have been restored to the repository test SDK;
  no machine-local dependency path is committed.

## Broad Gates Not Green

`bun run ui:conformance --full` reached the full repository suite and reported
9306 pass,1 skip,5 fail. Its later Storybook/cross-browser stages did not run.
The run overlapped a redundant repository test run initially; that duplicate
was cancelled. Diagnosis/reruns:

- Global-search timing test and public SDK inventory timeout pass in isolation.
- SDK localRoot test was added while the long-running suite held an older
  module; latest isolated SDK harness test passes.
- Removal snapshot test had an incomplete legacy fixture. Updated it to a valid
  manifest, preserving the snapshot-failure assertion; latest test passes.
- Runtime-switch dry-run still reproduces an OpenClaw SQLite/WAL tree mutation
  mismatch in isolation. The identical failure also reproduces in the original
  main checkout without the Terminal commits, so it predates this implementation.

Core `bun run build` passes CSS/vendors/plugins/host/assets, then fails binary
compilation on missing Playwright `chromium-bidi/lib/cjs/bidiMapper/BidiMapper`
and `chromium-bidi/lib/cjs/cdp/CdpConnection` imports. Generated build-only file
changes were excluded; production working-tree changes were not touched.

Full Bits `bun run test` crashes Bun1.3.13 in Messaging UI tests (SIGSEGV/SIGTRAP),
including after restoring the intended test SDK. Terminal's focused tests pass.
No runtime version, test timeout, dependency pin, or baseline was changed merely
to make these broad gates pass. Investigate these remaining gates before merge.

Logs remain under `/private/tmp/bakin-terminal-{conformance,core-build,bits-tests,
focused,quick,lint}.log`. These are diagnostic files, not release artifacts.

## Review and Limits

Review fixed dead tmux pane retention, repeat-completion TTL extension,
attachment recovery, parser overflow/persistence failure reporting, pending
output deletion, unloaded-plugin removal bypass, unlink bypass, and safe
actual-HEAD Git ancestry checks. Health findings contain no terminal output.

Only macOS service setup is implemented. The old manifest version minimum must
be replaced with the actual released core prerequisite before publishing.
Single-user OS trust remains explicit; this is not an agent sandbox. Project
links are navigation metadata. Long-running/noisy-process and slow-reader soak
coverage is not a substitute for the bounded-buffer unit checks and remains a
recommended pre-release acceptance exercise. Retained metadata/branches are not
automatically purged; output payloads and live worktrees are bounded separately.

## UI Conformance

- Pattern: `storybook/public/pages/page.stories.tsx` / `CanonicalUsage`,
  `lists/list-rows.stories.tsx` / `InteractiveRows`, and
  `pages/workspace-page.stories.tsx` / `ImmersiveCanvas`.
- Contract: SDK `/patterns`, `/ui`, `/navigation`; plugin-owned xterm content.
- Story/style-guide update:workspace and tooltip interaction regressions;
  plugin README and knowledge notes describe the index/detail navigation.
- Deviation:none.
- Verification:quick gate, real-SDK fixture, live desktop/mobile browser tests
  passed; full gate blocked as described above.

## Immersive Index and Tooltips (2026-09-09)

The user's final navigation choice supersedes the earlier session picker:
`/terminal` is a kit list; `/terminal/:id` is a full-width immersive workspace
with Back navigation. Agent assignment and paths are in a kit popover; session
completion actions use the kit menu. All icon controls have explanatory hover
and keyboard tooltips. Disabled controls retain focus for their explanations.

Regression checks caught and fixed two existing kit boundary bugs: fractional
header heights could prevent the compact row appearing, and a long tooltip
could overflow a 320px viewport. Public story interaction assertions cover
these contracts; no visual baseline or public API was changed. The conformance
runner also incorrectly excluded focusable aria-disabled controls from its
expected tab sequence; the new browser regression failed before that fix and
passes afterward.

Focused evidence:6 workspace/tooltip Storybook tests, the focusable-disabled
browser regression, 2 design browser tests covering index/Back, full-width
output, empty/error states, all tooltips, keyboard focus and narrow popovers.
Real shell verification covers input, viewport fit, reconnect and termination;
test-created processes are completed. Screenshots are in the Bits checkout's
`plugins/terminal/test-results/{design,live}`. The clean installed-SDK fixture
and its HTML report are under `test-results/plugin-ui-conformance/terminal`.
The all-at-once root-preload Terminal test run hit a Bun SIGTRAP; the clean
installed-SDK run passed all 15 unit tests. One combined browser invocation
timed out; focused reruns passed. No timeouts or safety gates were relaxed.
