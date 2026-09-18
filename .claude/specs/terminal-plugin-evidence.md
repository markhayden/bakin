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

Final installed-checkout verification used Bits `6705a8b` and the assembled
matching core SDK. The real-shell test also navigates Back to the index and
reopens its own session, proving output/process continuity. Service status was
200/ready with zero running sessions after cleanup. The final HTML report has
no package blockers or conformance findings and both screenshot assets load.
The full gate was rerun in `/private/tmp/bakin-terminal-core`; quick conformance
and lint passed before the repository suite reproduced the previously recorded
runtime-switch dry-run byte-identity failure. This is not a merge-ready claim.

The dev Tailwind watcher's accumulated class cache differs from a fresh
canonical CSS build, so the final SDK was assembled in the isolated checkout.
No stylesheet-identity check, legacy-style allowance, baseline, or budget was
relaxed. The development checkout's generated CSS remains uncommitted along
with the pre-existing generated-version and embedded-asset edits.

## Automatic Fit and Agent Identity (2026-09-09)

Installed Bits commits `d1ae8c4` and `ae52145` make the kit agent assignment
field full-width, with the same registered identity presentation as Tasks.
Terminal permissions remain authoritative; no agent was enabled by this change.
The xterm surface now fills the pane instead of retaining its initial 360px
height. The input owner's cell grid automatically fits on mount, pane resize,
font readiness, and reconnect. Resize requests are debounced and coalesced, and
do not invalidate queued input. Read-only viewers do not resize shared PTYs.
The user explicitly requested automatic-only fitting, so the Fit tool is removed.

Existing public contracts used: `agents/agent-select` / `AssignmentAndFiltering`
and `pages/workspace-page` / `ImmersiveCanvas`. No public story or API change is
needed; the only added domain CSS sets the plugin-owned xterm root height.

Red reproductions measured a 116px agent field beside 398px inputs and a 360px
xterm surface inside an approximately 870px pane. Both regressions now pass.
Verification: Bits typecheck/lint, core quick conformance, clean installed-SDK
conformance (16 unit tests, 61 assertions, zero findings), new-session browser
coverage, and live shell input/automatic desktop-mobile resize/reconnect/cleanup.
After removing Fit, all three design browser tests pass (20 assertions), including
the absence of the button and zero resize requests from an agent-owned viewer.
Desktop/mobile screenshots and the final fixture HTML report were inspected.
The full repository suite was not repeated for this narrow consumer follow-up;
the previously recorded runtime-switch failure remains a separate blocker.

Manual smoke test: title `Manual shell test`, program `Shell`, working directory
`/tmp`, assigned agent `Unassigned`, task `No task`, project `No project`.
Run `pwd` and `printf 'terminal test OK\n'`; finish with Session actions >
Terminate and complete. Shell sessions have no Checkout field.

## Table Index and Header Actions (2026-09-09)

The latest navigation refinement uses `lists/data-table.stories.tsx` /
`ActivatableRows` for the index, with Session, Program, Agent, Status, and Working
directory columns. `DataTable` owns row activation and horizontal overflow;
navigation still uses the public SDK router and session-title links. Detail
controls now occupy the full and compact workspace header action slots, replacing
New terminal. The separate session-control row is removed; the xterm status row
and automatic viewport fitting are unchanged. No new kit contract or exception.

Verification: Bits typecheck/lint, core quick conformance (228 tests), clean
installed-SDK fixture (zero findings), three design browser tests and one real
shell test (32 assertions). The browser regression asserts table columns, absence
of New terminal inside a session, controls inside the compact title row, tooltips,
Back navigation, mobile containment, automatic fit, reconnect, and test-owned
shell completion. Desktop/mobile screenshots and the fixture HTML report were
inspected. Full repository conformance was not repeated for this consumer change.

## Stream Controls and Seamless Inset (2026-09-10)

Bits `599a9de` and `90941f8` move stream controls into the existing session-actions
menu using `overlays/dropdown-menu.stories.tsx` / `Actions`: Send Tab to terminal
is a controlled checkbox item, and Reconnect terminal only reattaches the stream.
Connection and ownership status share the title header; the separate toolbar is
removed. The `BoundedOverflow` output uses kit `p-bakin-4` padding and the canvas
background. xterm's public theme option matches that computed background, and
the plugin-scoped viewport rule covers unused space below retained short grids.
This is domain rendering CSS, not a new system pattern or exception.

Verification: core quick conformance, Bits typecheck/lint, real-SDK conformance
and HTML report, and four live browser tests (40 assertions). Browser coverage
checks both xterm background layers, the 16px inset, no extra toolbar height,
header status and menu controls, desktop/mobile containment and automatic fit,
read-only non-resizing, actual Tab delivery when enabled and focus escape when
disabled, reconnect, Back navigation, and completion of test-owned shells.
Screenshot review caught the unused black viewport below short completed output;
the scoped rule fixes it and the final desktop/mobile evidence was inspected.
The full repository suite was not repeated for this consumer-only follow-up.

Session-actions width follow-up: Bits `256ef4a` sets the existing DropdownMenu
content to `w-72` (288px), retaining kit available-width collision limits. This
uses `overlays/dropdown-menu.stories.tsx` / `Actions`, with no public contract
change. The regression reproduces the former 160px menu and verifies single-line
labels on desktop and mobile, plus 320px viewport containment. All three design
browser tests pass (35 assertions); both menu screenshots were inspected.
Bits typecheck/lint and core quick conformance also pass.

## Flexible Tables and Index Actions (2026-09-12)

The requested kit update changes `DataTable` default cells from `nowrap` to
wrapping, including unbroken paths. It retains native auto table layout,
readable non-wrapping headers, and explicit column width/minimum-width overrides;
genuinely constrained content can still scroll locally. No new public API is
needed. `CanonicalUsage` now exercises long paths in a 320px container and an
explicit column minimum that intentionally overflows. `ActivatableRows` tests
nested menu actions without row navigation, backed by unit coverage for buttons,
links, and React portals. API inventory remains unchanged and valid.

Terminal composes shared `SessionActions` in each row and the session header.
Rows offer Take control, Complete session (exited/owned only), Terminate and
complete, and Delete completed output. The latter retains metadata. Confirmations
carry the target ID rather than depending on the selected route, name the target,
use the latest known generation, block repeated submits, and keep API errors
visible for retry. Existing service authorization and cleanup rules are unchanged.
The title has a proportional width, paths wrap, and the action column uses the
existing row-size token. Menus use the kit's bounded `w-xs` size, replacing the
earlier raw width utility without adding a style allowance.

Focused verification: 15 DataTable unit tests, five public Storybook interaction
and accessibility checks, five installed-plugin browser tests (56 assertions),
and the real-SDK index conformance fixture with zero findings. The browser tests
cover long-path fit, row-button tooltips, pointer/keyboard isolation, cancellation,
correct multi-row targeting, delete failure/retry, explicit ownership handoff,
termination, desktop/mobile menus, and the existing real-shell workflow. Evidence
is under `plugins/terminal/test-results/design` and
`test-results/plugin-ui-conformance/terminal`. No visual baseline was regenerated.

Final gates: core quick conformance passes (228 tests and TypeScript); Bits lint
and typecheck pass. Full conformance reached the repository suite: 9,313 passed,
two skipped, and one failed in the previously observed runtime-switch dry-run
byte-identity test. That failure prevents later full-gate stages from running;
this is not a clean full-conformance or merge-ready result. The separate public
table stories and installed-SDK/browser checks above passed. The final quick
gate was rerun successfully without the full suite competing for resources.

## Review fixes (2026-09-17)

A full branch review found and fixed four issues across both repositories.

The Bits full suite segfaulted five out of five runs (bun 1.3.13 runner
crash) while main stayed clean. Bisection isolated the trigger: a top-level
`import { chromium } from 'playwright'` in any bun `--isolate` test child
crashes the runner intermittently even when every test in the file is
skipped. The four terminal browser tests now gate and lazy-load playwright
through a shared `tests/browser.ts` helper; five consecutive full-suite runs
pass with 549 tests and zero failures. The same eager import existed in
Bakin's `focusable-disabled.browser.test.ts` and was fixed the same way.

That Bakin test was also dead: nothing set `BAKIN_UI_BROWSER_TEST`, so the
aria-disabled focus-order contract never executed. `ui:test:conformance`
now runs it with the flag, covering the ui-visual verify job and full
conformance; verified passing locally.

Two Bits contract failures were closed: `test-sdk/testing/ui/conformance.js`
now stubs `transformPluginCss` (pass-through; plugin sources carry their own
ownership scope), and `catalog.json` lists the terminal plugin
(not default-selected — it needs tmux and the macOS service setup).

The committed `packages/sdk/styles.css` predated the branch's kit changes
and the sibling terminal plugin, so installed-plugin utilities such as
`w-(--bakin-layout-size-row)` were missing from the served artifact; it was
rebuilt with bakin-bits-official at the repinned compatibility ref.
