# Terminal Rendering and Mobile Input

Status: Approved for implementation on 2026-10-01. The user explicitly approved
the final spec, plan, and both workspace-pattern additions. Visual baseline
candidates still require review once generated.
Started: 2026-10-01
Repositories: `bakin` and `../bakin-bits-official` (both authorized by the user).
Implementation plan: `terminal-mobile-rendering-plan.md`.

## Objective

Enable accelerated terminal rendering and make common terminal interactions
usable from a phone. Define the mobile interaction pattern in Bakin's public
Storybook before consuming it in the official Terminal plugin. Keep terminal
protocol and session ownership in the plugin; shared UI belongs in the kit.

Prioritize removing duplication and keeping the implementation small. This is
the existing single-user installation; compatibility shims are not a goal.

## Confirmed scope and decisions

### D1: Compact controls with expanded keys

Accepted 2026-10-01. Provide compact access to Tab, Escape, Ctrl, and arrows,
with an expandable area for Home/End, Page Up/Down, and common Ctrl shortcuts.
Cover the main terminal use cases first; additional keys can follow later.
The final arrangement, modifier behavior, and expanded inventory below were
approved with the implementation plan.

### D2: Persistent compact controls

Accepted 2026-10-01. Keep compact controls visible at the terminal bottom when
the phone keyboard is closed and above the keyboard while typing. Expanded
keys open only on request. Reserve space for the controls so they do not cover
terminal output; adapt the pane to the visible viewport and preserve the
existing ownership rule for PTY resizing.

### D3: Mobile browser coverage

Accepted 2026-10-01. Cover iPhone Safari and Android Chrome. Include a real
software-keyboard check on the user's everyday phone in acceptance evidence.
Browser automation supplements this check; viewport emulation alone does not
prove phone keyboard behavior. The particular device for that check remains
to be recorded when arranging verification.

### D4: Ctrl applies to one key

Accepted 2026-10-01. Tapping Ctrl arms it for the next supported key, then it
turns off. Tapping Ctrl again cancels it. Common combinations also appear as
single-tap shortcuts in the expanded controls.

Show the armed state with both a visual treatment and `aria-pressed`. Clear it
on session change, loss of input ownership, disconnect, page hiding, or leaving
the terminal interaction. Ordinary pane resizing must not cancel it. Paste and
IME composition cancel the latch and keep their original text intact; do not
transform a pasted string or a composition result into control bytes.

### R1: Enable accelerated rendering

The user requested enabling xterm's GPU renderer. The plugin currently uses
`@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0, without a WebGL addon.
The matching xterm 6.0.0 release contains `@xterm/addon-webgl` 0.19.0.

Proposed behavior: load WebGL after opening the terminal, automatically use the
normal renderer when initialization fails, and dispose the addon on context
loss so the terminal remains usable. Verify cleanup across reconnect and session
navigation. No user-facing renderer setting is currently proposed.

## Discovery

- Plugin: `../bakin-bits-official/plugins/terminal/`.
- `components/terminal-canvas.tsx` creates xterm and the Fit addon, streams
  snapshots/output, handles physical-key Tab capture, and forwards input.
- `components/terminal-page.tsx` owns the ordered write queue, generation and
  sequence checks, takeover, status, and current session. Mobile keys must use
  the same input path rather than introduce another transport or write queue.
- Human-owned running sessions are writable. Read-only viewers scale their
  local font instead of resizing the shared PTY. Preserve this distinction.
- Existing session controls include interrupt, takeover, Tab capture, reconnect,
  and lifecycle actions. There are no on-screen Tab or arrow keys.
- Existing browser tests use Chromium with narrow viewports and physical-key
  simulation. They do not establish behavior with a real phone keyboard.
- Host viewport metadata currently specifies width and initial scale. No shared
  VisualViewport handling was found in host/UI source during discovery.
- `Terminal.input()` feeds the existing `onData` path. Public
  `Terminal.modes.applicationCursorKeysMode` supports mode-aware arrows and
  Home/End without private xterm imports.
- Some existing browser tests inspect `.xterm-screen.textContent`. That is tied
  to the DOM renderer; WebGL adoption needs renderer-independent output evidence
  plus actual canvas screenshots. Keep `screenReaderMode` enabled.
- The UI author guide's workspace paragraph is stale: it says the compact header
  is mobile-only and precedes the full header. Storybook and source put it after
  the full header and support the scrolled desktop state. Correct this paragraph
  with the new workspace guidance; the executable contract takes precedence.
- Searches of both repositories' GitHub issues did not locate the reported
  mobile-controls ticket. Bakin #754 is the closed original terminal request;
  #759 concerns mobile filtering/sorting, not terminal input. Keep the ticket
  reference unresolved rather than attach an unrelated issue.

## Proposed use-case coverage

These acceptance scenarios interpret “main use cases” for final spec review.

| Use case | Required interaction |
| --- | --- |
| Complete commands and paths | Send Tab; repeated Tab can list completions |
| Recall and edit commands | Up/Down history, Left/Right cursor movement |
| Leave a mode or dismiss a terminal prompt | Send Escape |
| Stop a foreground program | Send Ctrl+C through the existing input path |
| Move within a long command | Home/End and useful line-editing shortcuts |
| Search history and clear the screen | Common Ctrl shortcuts, including Ctrl+R and Ctrl+L |
| Navigate an interactive CLI or pager | Arrows, Enter, Escape, Page Up/Down, and reverse navigation where needed |
| Enter ordinary text | Keep xterm's existing text/composition input working |

The key encoding must respect the terminal's active modes. Do not assume the
same arrow/Home/End sequence is correct for every shell and full-screen program.
Use public xterm APIs; do not reach into private renderer or keyboard internals.

## Proposed terminal interaction contract

These are implementation recommendations for review, not additional accepted
interview decisions.

### Layout and key inventory

On a narrow phone, arrange the compact controls in two groups:

```text
[ Esc ] [ Tab ] [ Ctrl ] [ More ]
[  ←  ] [  ↓  ] [  ↑   ] [  →   ]
```

Use existing large/icon-large kit buttons (44px minimum targets). The groups
can share one row when the available width allows it; keep each group intact
at 320px. Do not make keys smaller to force a single row. Labels/icons have
explicit accessible names. Standard keyboard tab order traverses the controls;
use a named group, not an ARIA toolbar with an unimplemented roving-focus model.

More expands an in-place, named key panel above the compact groups. It stays
open until toggled or the session becomes inapplicable, so repeated special-key
use does not require reopening it. Use existing `Panel scroll` for the expanded
region and bound it relative to the available workspace height. Keep compact
controls and terminal output reachable on short viewports. Short landscape
geometry is an early validation gate, including the current terminal's minimum
height and five-row PTY floor; do not hide overflow to make a screenshot pass.

Expanded keys:

- Navigation/editing: Enter, Backspace, Delete, Shift+Tab, Home, End, Page Up,
  Page Down.
- Ctrl shortcuts: C (interrupt), D (EOF), Z (suspend), R (history search),
  L (clear/redraw), A/E (line start/end), U/K (delete before/after cursor),
  W (delete word). Labels name the combination; explanations describe common
  shell behavior without promising that every program binds it identically.

Ctrl can modify on-screen navigation keys and ordinary ASCII letters using
xterm-compatible sequences. Explicit combinations such as Shift+Tab or Ctrl+C
send exactly their named combination and clear a pending latch. Unsupported
combinations clear the latch and preserve ordinary input; they must not invent
an escape sequence. No sticky modifier, programmable macros, full function-key
keyboard, or new clipboard workflow in this iteration. Rapid repeated taps are
required; custom press-and-hold repeat can follow separately.

Show controls on narrow layouts and touch-capable devices, including tablets.
Wide pointer-only desktop layouts keep their existing physical-key workflow.
Do not try to infer whether a Bluetooth keyboard is connected. Physical
keyboard and touch controls can coexist; physical Tab still follows Capture
Tab, while tapping the Tab button always sends terminal Tab.

### Focus, text input, and ownership

Pointer activation must preserve the editor's existing focus and keyboard-open
state. Avoid handling both pointer-down and click as separate key submissions.
Keyboard and screen-reader activation retain normal button navigation and
activation. Opening/closing More must not force a modal focus trap. Scrolling
the expanded panel must not be mistaken for a key tap.

When already typing, key taps keep xterm focused. With the software keyboard
closed, special keys work without forcing it open. Tapping the terminal opens
ordinary text input through the existing xterm focus path.

The strip never claims an agent-owned session. While watching, it stays visible
but sending keys is disabled; use the existing Take over action. Disable sending
while disconnected, service-unavailable, or in a lifecycle/ownership transition.
Do not treat an ordinary automatic PTY resize as an ownership transition.
Hide the strip for ended/completed sessions and deleted output. The latest
ownership/generation must still be checked immediately before a queued write.

Use one injection path through the current terminal and existing page queue.
No new server API, input queue, credential, or session protocol is needed.

## Public pattern discovery

Closest existing contracts:

- `storybook/public/pages/workspace-page.stories.tsx` — `ImmersiveCanvas`:
  compact context header and remaining-height workspace canvas.
- `storybook/public/primitives/button.stories.tsx` — `Sizes`, `States`:
  standard 44px large/icon-large targets, names, focus, and disabled states.
- `storybook/public/layout/flow.stories.tsx` — `CanonicalUsage`,
  `GapScaleAndWrapping`: semantic spacing and responsive composition.
- `storybook/public/pages/page.stories.tsx`: named command-toolbar composition
  for document pages; this does not define a workspace input accessory.

Identified gap: the public workspace story does not define persistent input
controls, their relationship to an on-screen keyboard, or preserving terminal
input focus while pressing them. Existing buttons and layout primitives cover
the visual ingredients, but do not establish that combined behavior.

### Approved reusable extension

Extend the existing workspace pattern with two opt-in capabilities, through
the already-supported `/patterns` entrypoint:

1. `WorkspacePage viewport="visual"`: bound a contained/immersive workspace
   (`flow={false}`) to its visible intersection with the host pane and browser
   visual viewport. The default remains `"host"`. Own the resize/scroll
   measurement and listener cleanup in the kit. Handle missing VisualViewport,
   browser chrome, rotation, fractional metrics, and pinch zoom without disabling
   zoom or globally resizing the host shell.
2. `WorkspacePageBody inputAccessory={...}`: reserve a trailing area below the
   remaining-height canvas. Own its layout and safe-area treatment in the kit;
   the caller supplies named groups and standard controls. Preserve the current
   DOM/layout path when the slot is absent. Do not add another page archetype,
   entrypoint, token family, or a general keyboard component.

First demonstrate the combination as
`storybook/public/pages/workspace-page.stories.tsx` — `KeyboardAwareInput`,
using an ordinary editor fixture. Add the terminal composition recipe at
`storybook/public/recipes/terminal-input.stories.tsx` — `CompactAndExpanded`.
The recipe demonstrates presentation, focus behavior, and emitted semantic key
actions; it does not copy terminal byte encoding or embed xterm in the kit.
Expanded content composes `layout/panel.stories.tsx` — `CanonicalUsage` with
`scroll`, standard buttons, and `Stack`/`Inline`.

Why ordinary composition is insufficient: a row of buttons can be composed
today, but it cannot make the existing workspace respond to a visual viewport
that shrinks while the layout viewport stays the same. A plugin-local footer
offset or host-shell mutation would duplicate page geometry outside the owning
archetype. The optional body slot also gives that geometry one owner instead of
requiring each consumer to reproduce the remaining-height canvas calculation.

Safeguards: preserve 44px targets, names, focus, zoom, and disabled states; use
bounded scrolling and one safe-area inset; retain `/navigation` routing; scope
terminal CSS to its plugin root; keep session state and key bytes out of the kit.
Review this extension against the proposed stories and real keyboard evidence
before plugin adoption. If those tests show it needs unrelated host navigation
changes or broader public APIs, revise this proposal before expanding scope.
After acceptance, document a supported pattern rather than a permanent exception.
New visual baseline candidates require separate inspection and exact approval
before being adopted; approval of the feature does not approve unseen images.

Use focused SDK entrypoints: `/patterns`, `/layout`, `/ui`, and `/navigation`.
Keep xterm dependencies and terminal key encoding in Bits. Shared kit code must
not depend on xterm or know about terminal sessions.

## Required states and boundaries

- Driving, watching an agent, connecting/disconnected, busy ownership changes,
  exited/completed sessions, deleted output, and unavailable service.
- Compact/expanded controls, keyboard open/closed, portrait/landscape, narrow
  screens down to 320px, device safe areas, zoom, and hardware keyboard use.
- Controls must not obscure the prompt, cause page-wide horizontal overflow,
  send duplicate keys, retain a stale modifier across sessions, or accidentally
  claim an agent-controlled session.
- Preserve keyboard navigation, screen-reader names, visible focus, and the
  existing explicit physical-Tab capture choice. On-screen Tab is an explicit
  terminal action and must be specified separately from browser focus traversal.
- PTY input and resize remain subject to current ownership and generation
  checks. Do not alter the shell/service lifecycle for this work.

## Project structure

| Location | Responsibility |
| --- | --- |
| `storybook/public/` | Public composition, interaction, and state contract |
| `packages/ui/src/`, `packages/sdk/src/` | Shared implementation/export only if required and approved |
| `design-system/public-api.json` | Public API registration if the supported contract changes |
| `.claude/knowledge/style-guide.md` | Shared pattern guidance |
| `.claude/knowledge/terminal-plugin.md` | Terminal integration and verification knowledge |
| `docs/src/content/docs/extending/ui/overview.md` | Public plugin-author guidance |
| `../bakin-bits-official/plugins/terminal/components/` | xterm lifecycle, key input, and plugin integration |
| `../bakin-bits-official/plugins/terminal/tests/` | Terminal behavior and browser verification |
| `../bakin-bits-official/test-sdk/` | Test SDK mirror if a new public export is introduced |
| `../bakin-bits-official/plugins/terminal/README.md` | Operator instructions and verification commands |

Review the root READMEs for impact; add feature details to the owning documents
rather than duplicate terminal instructions in unrelated introductions.

## Code style

Follow the existing TypeScript/React and Bun conventions: single quotes,
semicolon-free statements, external imports before SDK imports, then relative
imports. Existing focused imports illustrate the boundary:

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { BoundedOverflow } from '@makinbakin/sdk/layout'
import type { Session } from '../lib/contracts'
```

Keep protocol mapping independent of presentation when it enables meaningful
behavior tests. Avoid a configurable keyboard framework for one plugin.

## Commands and testing strategy

From Bakin:

```sh
bun run ui:conformance --quick
bun run ui:test:stories
bun run ui:conformance --full
bun run typecheck
bun run lint
bun run ui:dev
```

From the Bits root:

```sh
bun run test plugins/terminal/tests
bun run typecheck
bun run lint
BAKIN_SDK_DIR=<assembled-matching-sdk> bun run build
bun plugins/terminal/tests/dev-server.ts
```

With a matching real SDK installed, from the Terminal plugin:

```sh
bun run test:ui
TERMINAL_PREVIEW_URL=<disposable-preview-url> bun test tests/browser.integration.test.ts --isolate
```

The accompanying plan resolves SDK assembly and disposable preview setup to
executable commands. Bits root tests require its `test/setup-dom.ts` preload; use the root
test script for its suite. Browser fixtures require the real SDK rather than
the ambient test stub. Inspect `test-results/bakin-ui/index.html` after running
the plugin fixture.

Verification should cover actual emitted input and ordering, mode-aware keys,
modifier reset, ownership transitions, renderer availability/context loss, and
reconnect cleanup. Exercise completion, history, interrupt, and interactive
navigation against a disposable real PTY. Capture browser evidence for expanded
and compact controls, long output, disabled states, and small visible heights.
Real phone keyboard behavior needs device verification; desktop viewport
emulation alone is not evidence that the software keyboard remains open.

All tests and previews use temporary data and isolated services. Never attach
to or mutate the user's live terminal sessions or production homes.

## Planning and commit requirements

After the spec is reviewed, write and vet the implementation plan with exact
files, dependencies, acceptance checks, and executable verification commands.
Include separate rollback checkpoints for the renderer, the approved public
UI contract, and plugin adoption. Record cross-repository dependency and revert
order. Each implementation checkpoint includes its relevant docs and evidence.
The user must approve the implementation plan before build work begins.

## Acceptance checklist

- [ ] WebGL renders when available; unavailable/context-lost paths keep readable
  output, input, selection, and reconnect behavior. Repeated navigation does
  not accumulate active addon listeners or leave blank terminals.
- [ ] Completion, history, editing, interrupt, reverse traversal, pager movement,
  and interactive CLI navigation pass against disposable real sessions.
- [ ] Compact/expanded controls work at 320px, portrait/landscape, and with the
  keyboard open/closed. Repeated taps preserve focus and send one key each.
- [ ] Ctrl is one-shot, cancellable, visibly/semantically armed, and resets at
  the documented boundaries without corrupting paste or IME composition.
- [ ] Watching cannot send keys or resize the shared PTY; stale queued input
  is rejected/cancelled across ownership or generation changes.
- [ ] Shared stories, browser checks, plugin conformance, and docs agree on the
  public contract. Existing workspaces without the opt-in props retain behavior.
- [ ] Both target browser families have recorded evidence, including physical
  phone keyboard verification with any unavailable device check stated honestly.
- [ ] The renderer and public-kit/plugin changes have independent rollback
  checkpoints, with cross-repository dependency and revert order recorded.

## Remaining approvals and verification dependencies

1. Workspace extension, final spec, and plan approved on 2026-10-01.
2. Four TerminalInput visual baselines approved on 2026-10-01.
3. Record the actual phone/browser used for the real-keyboard acceptance check;
   availability of a device is verification evidence, not an assumed pass.
4. The original mobile-controls issue reference remains unlocated. This does
   not block implementation; do not create or close tickets without instruction.
5. The measured build-size budget increase awaits its separate explicit
   approval. Current verification and remaining limits are recorded in
   `terminal-mobile-rendering-evidence.md`.

## Sources

- [xterm WebGL addon, pinned to xterm 6.0.0](https://github.com/xtermjs/xterm.js/tree/6.0.0/addons/addon-webgl)
- [Matching addon package version](https://raw.githubusercontent.com/xtermjs/xterm.js/6.0.0/addons/addon-webgl/package.json)
- [Addon lifecycle implementation](https://raw.githubusercontent.com/xtermjs/xterm.js/6.0.0/addons/addon-webgl/src/WebglAddon.ts)
- [VisualViewport API](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
- Existing architecture and safety: `.claude/knowledge/terminal-plugin.md`,
  `.claude/specs/terminal-plugin.md`, both repository `CLAUDE.md` files, and
  `.agents/skills/bakin-ui-conformance/SKILL.md`.
