# Terminal mobile input and rendering — implementation evidence

Approved 2026-10-01: spec, implementation plan, `WorkspacePage viewport="visual"`,
and `WorkspacePageBody inputAccessory`. The user also explicitly approved the
four TerminalInput visual baselines: mobile/desktop × compact/expanded.
Implementation and behavior checkpoints are complete. Full-gate limits and the
pending performance-budget approval are recorded below.

## Starting state

- Bakin main: `888abf467513a3849ec8c60b65b0d2df5d574c6e`.
- Bits main: `fc83313e119f8aeb66fdb4ce6f27d67bcd65b7f5`.
- Bun 1.3.13. Both worktrees clean apart from the new planning documents.
- Quick conformance stopped at the existing compatibility-matrix drift recorded
  in the plan. No product behavior had changed.

## Checkpoints

Both repositories use `feat/terminal-mobile-rendering`.

| Checkpoint | Repository / commit | Scope |
| --- | --- | --- |
| C0 | Bakin `a482c5bf6` | Approved spec/plan |
| C0a | Bakin `f9f06ac18` | Six audited compatibility metadata fields |
| C1 | Bits `c894a9b` | WebGL lifecycle, dependency, renderer tests |
| C2 | Bakin `07ac503cb` | Shared workspace contract and stories |
| C2 visuals | Bakin `8e8a8c73f` | Four approved visual baselines |
| C3 encoding | Bits `06ef8bf` | Pure key protocol and tests |
| C3 adoption | Bits `e6063d9` | Mobile controls and input integration |
| C4 | Bakin — this evidence commit | Evidence and cross-repository guidance |

Revert C3 before C2; C1 is independent. Use ordinary revert commits. Rollback
must not terminate shells or discard output. A future deployment must activate
the C2-capable host before installing C3. No publishing, production install,
service restart, merge, or release is included. No issue number was invented.

## Delivered behavior and resolved findings

- xterm 6.0.0 loads matching WebGL addon 0.19.0 after opening the terminal.
  Construction/activation failure and context loss restore the normal renderer.
  Addon and context listener cleanup is idempotent and owned by the mount.
- Narrow/touch layouts expose Esc, Tab, one-shot Ctrl, arrows, and More. The
  bounded expanded panel contains Enter, Backspace, Delete, Shift+Tab, Home/End,
  Page Up/Down, and Ctrl+C/D/Z/R/L/A/E/U/K/W. Buttons have 44px minimum targets.
- Pointer taps preserve existing editor focus; native keyboard activation is
  retained. Ctrl cancels on paste/composition, leaving the interaction,
  disconnection, ownership/generation changes, or a second tap. Routine resize
  preserves it. Cursor keys follow xterm's current application-cursor mode.
- Keys use the existing ordered queue and current ownership/generation checks.
  Watching/disconnected/busy controls cannot submit. Ended/deleted sessions do
  not expose the strip. Input epoch and Ctrl reset before newly enabled controls
  can receive input, avoiding a passive-effect race found during review.
- The kit measures the host/VisualViewport intersection in CSS pixels, owns
  safe-area clearance, and cleans up observers/listeners. It changes no global
  document styles. Missing VisualViewport retains host sizing.
- A scrolled-away full header becomes inert and hidden to assistive technology;
  the compact title supplies the accessible H1. The installed-SDK harness found
  these two accessibility problems and verified the fixes.
- The old 160px canvas minimum and five-row PTY floor hid the prompt in a short
  keyboard-open viewport. The canvas now has no fixed minimum. The client and
  both validators accept 1–150 integer rows; ownership checks remain intact.
- Fixtures now supply a finite host pane and its real 56px inset. Old browser
  assertions were updated for Name, current row navigation, memory routing,
  and Ended status. Output assertions use the accessibility tree, allowing
  either renderer. The clean plugin test package declares its own DOM/RTL deps.

## Public contract and approved visuals

- `storybook/public/pages/workspace-page.stories.tsx — KeyboardAwareInput`
- `storybook/public/recipes/terminal-input.stories.tsx — CompactAndExpanded`
- Focused entries: `@makinbakin/sdk/{ui,layout,patterns,navigation}`.
- No new exported component, entrypoint, token, accessibility suppression,
  legacy barrel, private xterm import, or design exception.
- Style guide, public UI overview, Terminal knowledge article, and plugin README
  document the contract. Root READMEs do not need terminal-specific duplication.
- The four snapshots under
  `tests/ui/snapshots/{chromium-mobile,chromium-desktop}/workspace-input.visual.ts/`
  were generated and inspected in `mcr.microsoft.com/playwright:v1.60.0-noble`.
  They were copied only after the user's exact approval. Existing snapshots
  were not updated.

## Verification

| Check | Result |
| --- | --- |
| Bakin `ui:conformance --quick` | Pass: 228 architecture tests plus typecheck |
| Workspace unit tests | Pass: 6 tests |
| Bakin lint | Pass |
| CSS/vendor/core-plugin/host builds | Pass |
| SDK assembly | Pass: disposable local package 0.1.6 |
| `ui:build:public:verify` | Pass: deterministic index and fixture manifest |
| Full Storybook interactions | Pass: 367 tests in 116 files; 5 excluded files skipped |
| Current canonical visual comparisons | 317 pass, 1 CalendarGrid mismatch; all four TerminalInput images pass |
| Focused workspace browser matrix | Pass: 12 checks across Chromium, Firefox and WebKit |
| Current Chromium/Firefox/WebKit behavior | Pass: all 168 checks |
| Plugin conformance harness teeth | Pass |
| Full docs generation/validation/build | Pass: 483 public stories published locally |
| Bits Terminal unit suite | Pass: 40 tests; 15 opt-in skips |
| Bits typecheck/lint/build | Pass |
| Official Bits clean installed-package conformance | Pass across enrolled fleet |
| Terminal real SDK `test:ui` | Pass: no package or conformance findings |
| Renderer available/blocked/context-lost | Pass in Chromium and WebKit |
| Mobile completion/history/Ctrl+C, focus and keyboard geometry | Pass in Chromium and WebKit |
| Live application cursor mode | Pass in both: raw application receives ESC O A |
| Ownership/reconnect disabling and Ctrl reset | Pass in both engines |
| Existing create/reconnect/physical-Tab scenario | Pass independently and three traced repetitions |
| Physical iPhone Safari / Android Chrome keyboards | Outstanding |

Renderer checks exercise a colored Unicode burst, device scale 2, resizing, and
three navigation remounts. First-output timing includes typing and transport;
it is not a GPU benchmark. Mobile tests use real disposable PTYs and a mocked
top-level VisualViewport. WebKit/mobile emulation does not prove native-phone
keyboard behavior.

The full Bakin command passed its quick, lint and CSS stages, then stopped at
repository tests: **10,174 pass, 19 skip, 9 fail** across 1,070 files. All failures
are in untouched `tests/core/spend-observer.test.ts`. That file independently
reproduced **7 pass, 9 fail**, including on the untouched starting commit with
its own frozen-lockfile install. No spend-observer code/tests were changed. The
remaining full-gate stages are run independently; the aggregate is not a pass.

The only full visual failure is the untouched mobile CalendarGrid story:
49 differing pixels. It reproduces in isolation and against a fresh build of
the untouched starting commit `888abf467`, using its own frozen-lockfile install.
The base and feature actual screenshots are byte-identical. Its existing PNG
was preserved; this is pre-existing visual debt, not a new terminal baseline.

A full browser/visual attempt was discarded after discovering the determinism
verifier builds temporary copies and the served static output was older. Final
comparisons use the newly built `storybook-static-public`. The discarded run
is not final-source evidence. Live assertions also needed normalization of
platform-dependent `od` spacing and a wait for settled modifier state.

Combined Bun-isolated browser files intermittently hang at `browser.close()`
after all integration assertions pass. An instrumented run localized the hang;
independent execution and three traced repetitions pass. No timeout increase
or skipped product assertion was used to call it passing.

## Payload review

These are built JS bytes, not gzip size. The existing 2,048-byte review tolerance
is unchanged. Shared reachable rows overlap and must not be added together.

| Artifact | Previous | Proposed | Delta |
| --- | ---: | ---: | ---: |
| Terminal client | 514,331 | 688,510 | +174,179 |
| SDK shared chunks total | 942,574 | 945,817 | +3,243 |
| Conversation reachable | 713,482 | 716,675 | +3,193 |
| Navigation reachable | 427,002 | 429,374 | +2,372 |
| Patterns reachable | 619,896 | 622,268 | +2,372 |

A measurement-only build with a no-op WebGL module measured 525,176 bytes versus
688,510 for the real client: about 163,334 bytes attributable to WebGL. Remaining
client growth is controls/input integration; shared growth is workspace geometry.
Separately loading WebGL would require broadening the single-client plugin
build/loading contract. The alternative is to revisit renderer delivery.

Exact approval of these budgets was requested. No performance baseline has
been changed while approval is pending.

The final input-reset correction adds 50 bytes: the current Terminal measurement
is 688,560 bytes. The proposed 688,510 review baseline above still covers this
within the existing 2,048-byte tolerance; no extra headroom is proposed.

## Artifacts and limits

Durable local logs and live screenshots: `test-results/terminal-mobile-rendering/`.
Scratch: `/private/tmp/bakin-terminal-review.T7Jv70`.
Installed report: `../bakin-bits-official/test-results/plugin-ui-conformance/terminal/index.html`.
The report and both screenshots were inspected. The final static fixture uses
the same 56px host inset as the live fixture, preserving the compact header.
Its captured keys are disabled
because the fixture deliberately represents an agent-owned/disconnected session.

Before merge-ready handoff: disposition the unrelated full-gate failures,
obtain the scoped payload approval, and record physical-device testing when
devices are available. Production state and user sessions were not used.

The owned live preview was stopped. Its private tmux service and the two
recorded failed-start services all report not running. Maintainer Storybook
remains available at `http://127.0.0.1:6006` for review.
