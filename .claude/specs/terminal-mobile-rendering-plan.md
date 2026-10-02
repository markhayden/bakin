# Plan: Terminal Rendering and Mobile Input

Status: Approved for implementation on 2026-10-01, including the specific
workspace extension. User response: “sure” to the final spec/plan/extension
approval question. The four exact TerminalInput visual baselines were approved
on 2026-10-01. Implementation results are in `terminal-mobile-rendering-evidence.md`.
Date: 2026-10-01
Spec: `terminal-mobile-rendering.md` (accepted interview decisions D1–D4).

## Result and architecture

Enable xterm WebGL rendering with normal-renderer fallback. Add persistent
mobile terminal keys, one-shot Ctrl, and expanded navigation/editing shortcuts.
Make the workspace respond to the visible viewport so the software keyboard
does not cover input controls or the prompt.

The proposed shared contract adds `WorkspacePage viewport="visual"` and
`WorkspacePageBody inputAccessory`. It extends the current archetype via
`@makinbakin/sdk/patterns`; it adds no entrypoint, public component export,
semantic token, or xterm dependency to Bakin. The plugin owns key encoding,
modifier state, session ownership, and ordered writes. Standard kit buttons,
layout, and bounded panels own presentation.

The extension, spec, and plan are approved. Execute the kickoff build/test
workflows sequentially; no parallel agents are needed for these shared files.

## Dependency order and feasibility gates

```text
Approve spec + specific kit extension + plan
  ├─ WebGL lifecycle → renderer browser evidence → renderer checkpoint
  └─ Workspace viewport/slot story → focus/layout evidence → kit checkpoint
       └─ mode-aware keys → controls → live plugin integration → adoption checkpoint
            └─ complete verification + docs + reviewed visuals → handoff
```

Do the keyboard geometry/focus proof before large control implementation. Test
the actual top-level preview: an iframe's VisualViewport does not reproduce a
phone's top-level keyboard. Prove the layout with the existing host shell and
its fixed header, a collapsed immersive header, and the current PTY minimum
rows. If the proposed slot cannot preserve a usable prompt on representative
phone/landscape sizes, revise the spec before broadening the host or public API.

## Ordered tasks

### T0 — Approval and workspace checkpoint

- Acceptance: the user explicitly approves the two workspace additions and the
  linked spec/plan. Record approval and any changes in the decision log.
- Files: this plan and `terminal-mobile-rendering.md`.
- Verify: `git diff --check`; inspect both worktrees and their starting HEADs.
- Checkpoint: create `feat/terminal-mobile-rendering` in each repository after
  checking for existing branches. Record both base SHAs. Preserve unrelated
  changes and stage only named task files.

### T0a — Reconcile verified compatibility metadata

- File in Bakin: `design-system/compatibility.json`.
- Acceptance: reconcile the six version/range differences documented under
  Preliminary validation below against the actual Bits manifests. This is a
  factual metadata repair, not permission to widen API/visual/performance gates.
  Review the exact diff; do not replace unrelated metadata or regenerate other
  design-system artifacts.
- Verify: `bun run ui:census:check`, then `bun run ui:conformance --quick` to
  establish the remaining baseline before feature changes.
- Dependency: T0. Keep this repair in its own `chore(ui): reconcile official
  plugin compatibility metadata` commit so it is separable from feature work.

### T1 — WebGL lifecycle and dependency

- Files in Bits: `plugins/terminal/package.json`, `bun.lock`,
  `plugins/terminal/components/terminal-renderer.ts` (new),
  `plugins/terminal/tests/renderer.test.ts` (new).
- Acceptance: pin `@xterm/addon-webgl` 0.19.0 alongside xterm 6.0.0; attach after
  `open`; catch initialization failure; dispose on context loss; return an
  idempotent cleanup. Do not probe or mutate private xterm internals.
- Tests: initialization failure, context loss, repeated cleanup, and listener
  removal leave the terminal object usable. Use injected public addon/terminal
  seams for lifecycle tests, then prove the actual addon in T2.
- Verify from Bits: `bun run test plugins/terminal/tests/renderer.test.ts`,
  `bun run typecheck`, `bun run lint`.
- Dependency: T0.

### T2 — Renderer integration and browser proof

- Files in Bits: `components/terminal-canvas.tsx`,
  `tests/browser.integration.test.ts`, `tests/managed-binary.browser.test.ts`,
  `tests/renderer.browser.test.ts` (new), and `README.md`, all under the
  Terminal plugin.
- Acceptance: every terminal mount/reconnect installs and cleans up the addon;
  forced WebGL failure/context loss preserve output, input, selection, theme,
  and resizing; retain `screenReaderMode: true`.
- Replace DOM-renderer-only output assertions in affected browser files with
  accessibility/output-state evidence. Pair those assertions with canvas
  screenshots; parsing text is not proof of a painted WebGL screen. Inspect
  other browser tests and move any additional necessary edits into a small
  follow-up task rather than weakening assertions.
- Browser proof: available WebGL, blocked WebGL, genuine context loss using
  `WEBGL_lose_context`, reconnect, repeated session mount/unmount, DPR changes,
  and a bounded ANSI/Unicode output burst. Exercise both Chromium and WebKit
  where available; fallback must remain useful on either engine.
- Verify: isolated preview and browser commands below, Bits terminal suite,
  typecheck/lint, and build. Compare burst responsiveness with forced fallback
  on the same browser; record observations without claiming an unmeasured gain.
- Dependency: T1. Commit renderer checkpoint C1 when verified.

### T3 — Extend workspace geometry through the public story

- Files in Bakin: `packages/ui/src/patterns/workspace-page.tsx`,
  `packages/ui/src/patterns/use-workspace-viewport.ts` (new, internal),
  `tests/ui/patterns/workspace-page.test.tsx`,
  `storybook/public/pages/workspace-page.stories.tsx`,
  `storybook/support/workspace-input-fixture.tsx` (new).
- Define `KeyboardAwareInput` before using it in Terminal. The fixture uses an
  ordinary editor and existing SDK imports, with no xterm or terminal protocol.
- Acceptance: opt-in visual viewport bounds the workspace within its host;
  `inputAccessory` reserves a trailing area, keeps the canvas flexible, and
  applies safe-area padding once. The no-slot/default-viewport path retains
  current composition, including flow workspaces.
- Measurement: coalesce VisualViewport resize/scroll and owner-size changes;
  account for offsets, zoom, and fractional sizes. Clean up all subscriptions
  and scheduled frames. Do not observe the resizing cell grid or mutate global
  body/host styles. Missing VisualViewport uses host geometry.
- Tests: changing visible height/offset, expanded accessory height, unsupported
  API, unmount cleanup, default behavior, and scroll ownership. Use real browser
  checks in T4 to cover geometry that a DOM emulator cannot establish.
- Verify: `bun test tests/ui/patterns/workspace-page.test.tsx --isolate`,
  `bun run ui:test:stories`, `bun run ui:conformance --quick`.
- Dependency: T0 and specific system-extension approval.

### T4 — Terminal input recipe, focus, and responsive evidence

- Files in Bakin: `storybook/public/recipes/terminal-input.stories.tsx` (new),
  `storybook/support/terminal-input-fixture.tsx` (new),
  `tests/ui/browser/workspace-input.browser.pw.ts` (new),
  `tests/ui/visual/workspace-input.visual.ts` (new).
- Acceptance: recipe shows compact/expanded/disabled/armed states with existing
  Button, Panel, Stack, and Inline; 44px targets fit 320px in two groups. It
  illustrates semantic key callbacks, not terminal escape bytes.
- Focus: pointer taps while typing retain editor focus, keyboard-open state,
  and one activation; keyboard/assistive activation retains accessible button
  traversal. Tapping/scrolling More and its panel must not duplicate input or
  create a focus trap. Preserve pinch zoom and 200% text access.
- Test 320px portrait, normal phone portrait, landscape/short visible height,
  tablet touch, wide desktop, and missing VisualViewport. Verify geometry at
  top-level preview in addition to Storybook. The kit test runs in Chromium,
  Firefox, and WebKit using the existing browser matrix.
- Verify: `bun run ui:test:stories`, `bun run ui:test:browsers`,
  `bun run ui:test:visual`, `bun run ui:conformance --quick`.
- Visual runs produce review candidates. Do not update baselines at this step.
- Dependency: T3.

### T5 — Public contract guidance and kit checkpoint

- Files in Bakin: `.claude/knowledge/style-guide.md`,
  `docs/src/content/docs/extending/ui/overview.md`,
  `.claude/specs/terminal-mobile-rendering-evidence.md` (new).
- Acceptance: explain opt-in workspace viewport/slot ownership, focus-preserving
  input composition, bounded expanded controls, and when to use the pattern.
  Correct the already-identified stale compact-header ordering/desktop guidance
  to match Storybook. Review public API inventory; these props add no named
  exports, so do not regenerate an unchanged inventory.
- Visual checkpoint: present exact new candidates, their paths and scope, and
  obtain explicit approval before adopting them. Put approved generated PNGs
  in their own named-file update task; do not accept unrelated baseline drift.
- Verify: `bun run ui:public-api:check`, `bun run ui:story-compliance:check`,
  `bun run ui:kit-coverage:check`, `bun run docs:validate`, typecheck/lint, and
  `bun run ui:conformance --full` after approved visual artifacts exist.
- Dependency: T4. Commit kit checkpoint C2 when verified. Keep Storybook running
  during active visual review.

### T6 — Terminal key encoding and modifier state

- Files in Bits: `plugins/terminal/components/terminal-input.ts` (new),
  `plugins/terminal/tests/input.test.ts` (new).
- Acceptance: encode the spec's finite key set using public terminal mode data;
  support normal/application arrows and Home/End, modified navigation,
  Shift+Tab, editing keys, and the explicit Ctrl shortcuts.
- One-shot Ctrl is consumed/cancelled exactly once. Paste, composition, and
  unsupported combinations preserve text. Reset at the spec's boundaries and
  never retain a latch across sessions. Keep state logic independent enough to
  test, without building a generic keyboard/configuration framework.
- Verify from Bits: `bun run test plugins/terminal/tests/input.test.ts` and
  typecheck/lint. Tests assert observable bytes/state transitions with a table
  of real use cases, including both cursor modes and Ctrl+C followed by text.
- Dependency: T0; may be completed after C2 in the sequential work order.

### T7 — Accessible controls and test SDK composition

- Files in Bits: `plugins/terminal/components/terminal-controls.tsx` (new),
  `plugins/terminal/tests/terminal-controls.test.tsx` (new),
  `test-sdk/patterns.js`. Existing `types/sdk-ambient.d.ts` declares these
  workspace components with permissive `PatternProps`; no declaration edit is
  needed for the two props. The assembled SDK supplies the real type check.
- Acceptance: consume the approved recipe, expose semantic key callbacks,
  preserve input focus for pointer activation, and keep normal keyboard button
  navigation. Show armed Ctrl, explicit expanded keys, and meaningful disabled
  states. Rapid taps emit one action each; scrolling emits none.
- Mirror the body slot in the existing test SDK so component tests actually
  render it; do not use the stub as evidence of production geometry. Refresh
  the copied stub with `bun install` if it changes, per Bits CLAUDE.md.
- Verify from Bits: `bun run test plugins/terminal/tests/terminal-controls.test.tsx`,
  `bun run typecheck`, `bun run lint`.
- Dependencies: C2 and T6.

### T8 — Connect keys to the live terminal and ownership rules

- Files in Bits: `components/terminal-canvas.tsx`,
  `components/terminal-page.tsx`, `components/terminal.css`,
  `tests/mobile-input.browser.test.ts` (new), `tests/browser.ts`, under Terminal.
- Acceptance: compose the opt-in workspace and slot; inject through the current
  xterm instance/`Terminal.input()` into the existing ordered queue. Read mode,
  session, and ownership at activation. No parallel server transport/queue.
- Gate sending on human ownership, a live connected session, and service state;
  distinguish input-blocking lifecycle changes from ordinary resize. Watching
  shows disabled keys; ended/deleted output has none. Preserve physical Tab
  capture and existing takeover semantics.
- Resolve the existing fixed minimum canvas height against short visible
  viewports; preserve usable output and controls rather than clipping them.
  Only scoped domain CSS may remain in the plugin. Viewport measurements live
  in the approved kit implementation.
- Extend the existing browser launcher with an optional engine selection for
  new input/renderer cases; retain existing Chromium default. New browser cases
  cover completion, history, Ctrl+C then normal text, mode-aware arrows,
  Shift+Tab, focus retention, expanded-panel scrolling, and disconnected input.
- Verify: browser commands below in Chromium and WebKit, the root terminal
  suite, typecheck/lint, and the built plugin with the assembled real SDK.
- Dependencies: C1, C2, T7.

### T9 — State/ownership regressions and installed-package fixture

- Files in Bits: `tests/ui.fixture.tsx`, `tests/design.browser.test.ts`,
  `tests/mobile-input.browser.test.ts`, `tests/ownership.test.ts` only if the
  existing suite needs an additional boundary assertion, and `README.md`, under
  Terminal. Keep each test addition at the layer where it can prove behavior.
- Acceptance: agent-owned taps send nothing and never resize its PTY; takeover,
  generation changes, disconnect/reconnect, and route switches discard stale
  input/modifiers; pointer taps and composition remain correct after reconnect.
- The real-SDK fixture must exercise the session detail and controls, not only
  the default session index. Add deliberate fixture routes/states so keyboard,
  axe, containment, screenshots, and disabled controls are verified by the
  published harness. Inspect the HTML report and screenshots.
- Verify: `bun run test plugins/terminal/tests`, the existing isolated
  installed-package conformance runner, and live browser scenarios. Preserve
  temporary homes/process cleanup in every fixture.
- Dependency: T8. Commit plugin adoption checkpoint C3 when verified.

### T10 — Final evidence, docs, and handoff

- Files in Bakin: `.claude/knowledge/terminal-plugin.md`,
  `.claude/specs/terminal-mobile-rendering-evidence.md`, this plan/spec as needed.
- Files in Bits: Terminal `README.md` for final operator/verification details.
- Acceptance: document automatic WebGL fallback, the key inventory, one-shot
  Ctrl, ownership/focus behavior, device evidence, exact commands/results, and
  the linked commit SHAs. Root READMEs were reviewed; their installation/catalog
  purpose does not require duplicating these terminal-specific instructions.
- Final checks: full Bakin conformance for the supported-contract change,
  relevant SDK/workspace tests, Bits terminal suite, typecheck/lint/build, real
  SDK fixture, live PTY cases, and manual phone keyboard checks.
- Record physical iPhone Safari/Android Chrome evidence where devices are
  available. Playwright WebKit is not a substitute for iPhone keyboard behavior.
  Clearly mark any unavailable physical-device check as outstanding rather
  than treating automation as a pass. No production session may be used.
- Review final diffs for scope, duplicate input paths, leaked listeners, stale
  callbacks, arbitrary styles, private xterm imports, and incorrect docs.
- Dependency: C3. Commit evidence checkpoint C4. No publishing, production
  plugin installation, service restart, merge, or release tag is part of this plan.

## Executable verification setup

Normal commands listed above run in the owning repository. Use Bun 1.3.13 as
pinned by Bakin. Do not run a production Bakin server for these tests.

### Assemble the SDK and verify official packages

Run from Bakin in one shell. The local validation version below labels only the
temporary artifact; it does not change or publish the repository's version.

```sh
terminal_review_root=$(mktemp -d /private/tmp/bakin-terminal-review.XXXXXX)
bun run build:css
bun run scripts/build-sdk-package.ts --version 0.1.1 --out "$terminal_review_root/sdk"
cd ../bakin-bits-official
BAKIN_SDK_DIR="$terminal_review_root/sdk" bun run build
BAKIN_SDK_PACKAGE_DIR="$terminal_review_root/sdk" bun run ui:conformance
```

The conformance runner already packs the real SDK, installs each plugin into
an isolated consumer, runs its `test:ui`, and copies reports before cleanup.
Inspect `../bakin-bits-official/test-results/plugin-ui-conformance/terminal/index.html`.
It runs the enrolled official fleet, so report unrelated existing failures
separately; do not silently lower the gate.

### Disposable live terminal preview

Continue from the Bits root in that shell. Use an isolated plugin copy to avoid
replacing the root's test SDK or modifying workspace package dependencies.

```sh
mkdir -p "$terminal_review_root/plugin"
rsync -a --exclude=node_modules --exclude=dist --exclude=test-results plugins/terminal/ "$terminal_review_root/plugin/"
cd "$terminal_review_root/plugin"
npm pack --pack-destination "$terminal_review_root" "$terminal_review_root/sdk"
# Set the disposable package's @makinbakin/sdk devDependency to the resulting
# .tgz, then install. A packed artifact matches the published package boundary.
bun install
TERMINAL_PREVIEW_PORT=3798 bun tests/dev-server.ts
```

Port 3798 must be free; if occupied, select another free loopback port and record
the actual URL. Do not stop someone else's process to free it. The preview needs
an available tmux binary and owns its private socket/database/process. Follow
the existing preview's SIGINT/SIGTERM cleanup. Use the printed temporary working
directory for test-created sessions.

In another shell, change to the exact temporary plugin path printed/recorded
above. After T8 adds optional engine selection, run:

```sh
TERMINAL_PREVIEW_URL=http://127.0.0.1:3798 bun test tests/browser.integration.test.ts tests/design.browser.test.ts --isolate
TERMINAL_PREVIEW_URL=http://127.0.0.1:3798 TERMINAL_BROWSER=chromium bun test tests/renderer.browser.test.ts tests/mobile-input.browser.test.ts --isolate
TERMINAL_PREVIEW_URL=http://127.0.0.1:3798 TERMINAL_BROWSER=webkit bun test tests/renderer.browser.test.ts tests/mobile-input.browser.test.ts --isolate
bun run test:ui
```

Before T8, use the default Chromium launcher for the T2 renderer proof and run
the WebKit repeat after the launcher is extended. Browser executables must be
installed for the engines being tested; a missing engine is not a passing skip.
Use existing canonical Bakin browser/visual runners for their Docker-pinned
environment. Physical-phone access to this loopback preview needs an available
device connection/private forwarding arrangement; do not expose the terminal
publicly as a shortcut to testing.

Stop the owned preview, confirm its owned shells are gone, copy evidence, then
remove only the recorded scratch directory. Tests must never touch production
`~/.bakin`, `~/.openclaw`, or `~/.pi` state.

## Commit and rollback strategy

Use conventional commits on the two feature branches. Record both base SHAs
and every checkpoint SHA in the evidence file; each commit must have passing
checks appropriate to its scope. Related docs/tests ship with their owning
behavior. Small tasks above are work units; the checkpoints below combine only
closely related, verified tasks into coherent commits.

| Checkpoint | Repository / suggested message | Contents and rollback |
| --- | --- | --- |
| C0 | Bakin: `docs(terminal): specify mobile input and accelerated rendering` | Approved spec/plan; no runtime effect |
| C0a | Bakin: `chore(ui): reconcile official plugin compatibility metadata` | Audited T0a repair; independent of the feature and retained if feature commits are reverted |
| C1 | Bits: `feat(terminal): enable WebGL rendering with fallback` | T1–T2, dependency/lockfile, browser assertions, renderer docs; independently reversible without changing input controls or session data |
| C2 | Bakin: `feat(ui): support keyboard-aware workspace input controls` | T3–T5, stories, approved visuals, guidance; must precede plugin adoption; split into geometry and documented-contract commits if review size warrants, but treat their SHAs as one checkpoint |
| C3 | Bits: `feat(terminal): add mobile terminal controls` | T6–T9, test stub, browser coverage, operator docs; revert this before reverting C2 |
| C4 | Bakin/Bits: `docs(terminal): record mobile input verification` | Final evidence and cross-repo knowledge updates; preserve the audit trail if behavior is rolled back |

If C3 is too large for a clear review, split the pure key encoding/tests from
the user-visible integration; do not expose unverified controls between commits.
Cross-repository rollback order is C3 → C2. C1 is independent and can remain or
be reverted separately. Use named `git revert` commits, never a hard reset or
force push. Rollback must not terminate shells or discard session output.

The installed runtime resolves the SDK from Bakin: a future deployment must
activate the C2-capable host before installing the C3 plugin. Record the actual
SDK/plugin minimum version with release metadata when a release is requested;
do not invent a version or add a compatibility shim during implementation.

## Plan vetting

| Risk found during discovery | Plan response |
| --- | --- |
| Layout viewport stays tall when a phone keyboard opens | Kit owns visual-viewport measurements; early top-level proof before controls |
| Storybook iframe hides the actual phone behavior | Top-level disposable preview plus physical-device evidence |
| Fixed canvas minimum crowds short viewports | T8 resolves the actual height constraint; landscape/keyboard checks gate adoption |
| Touch button blurs xterm or submits twice | Pointer/keyboard activation contract and real-browser assertions |
| Ctrl corrupts paste, IME, or a later session | Source-aware cancellation/reset tests; no bulk-string conversion |
| TUI uses application cursor sequences | Read public xterm modes at activation; byte tests and live TUI cases |
| Two queues or stale ownership cause mixed input | One existing queue and fresh generation checks; no new backend path |
| GPU fails or contexts are lost during navigation | Initialization/context-loss fallback, idempotent cleanup, real churn tests |
| Existing tests assert DOM-renderer structure | Renderer-independent output assertions plus painted-screen screenshots |
| The stub silently drops the new body slot | Mirror only the prop composition; verify the packed real SDK separately |
| Existing public prose contradicts Storybook | Correct the touched workspace guidance against the executable contract |
| New visuals require review | Generate candidates, request exact approval, then update only named baselines |

Scope review: no backend schema changes, service lifecycle changes, unrelated
plugin migration, or whole-host keyboard refactor. No backwards-compatibility
shims. The original mobile issue is still unlocated; implementation does not
depend on an invented issue number.

## Preliminary validation (2026-10-01)

Only the two new spec/plan documents were present in the working diff. Bits
was clean. Bun is 1.3.13. Inspected base commits:

- Bakin: `888abf467513a3849ec8c60b65b0d2df5d574c6e`.
- Bits: `fc83313e119f8aeb66fdb4ce6f27d67bcd65b7f5`.

`git diff --check` passed. `bun run ui:conformance --quick` passed exception
governance, generated-token validation, and public API freeze validation, then
stopped at `ui:census:check`: `official SDK compatibility matrix is stale`.
Later quick-gate checks did not run; this is not a passing conformance result.

Read-only comparison using the exported `buildCompatibilityMatrix` with the
recorded repository refs isolated the existing mismatch to these six fields:

| Field | Recorded | Actual manifest |
| --- | --- | --- |
| messaging version | 0.11.6 | 0.11.7 |
| messaging Bakin range | >=0.0.1-rc.36 | >=0.0.1-rc.39 |
| projects version | 0.11.1 | 0.11.2 |
| projects Bakin range | >=0.0.1-rc.36 | >=0.0.1-rc.39 |
| terminal version | 0.1.3 | 0.2.0 |
| terminal Bakin range | >=0.0.1-rc.36 | >=0.0.1-rc.40 |

The metadata has not been changed during planning. T0a reconciles it explicitly
after plan approval. No behavioral tests, visual captures, or device checks have
been run for the proposed feature; those require implementation.

## Review outcome

- [x] User approves final spec and explicit workspace extension (2026-10-01).
- [x] User approves this task/commit/verification plan (2026-10-01).
- [x] Implementation and evidence are complete; verification limits are recorded.
- [x] Exact visual candidates are approved (four TerminalInput images only).
- [ ] Full conformance passes; the full command currently stops at nine
  untouched spend-observer failures, also reproduced in isolation.
- [x] The unavailable physical-device check is explicitly recorded.
