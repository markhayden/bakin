# Plan: Terminal Multi-Device Sessions, Native Handoff, and Mobile Quality

Status: APPROVED by Mark on 2026-10-25 ("lets do it"), including the publish.yml pinned-ref CI change.
Date: 2026-10-25
Spec: `terminal-multi-device.md` (approved 2026-10-25; decisions D1–D12).
Task checklist: `tasks/todo-terminal-multi-device.md`.
Repositories: `bakin` (host/SDK/CLI) and `../bakin-bits-official` (`plugins/terminal`,
plus the `cliCommands` declarations in `plugins/{messaging,projects}`).

## Shape

The work ships as two native `gh stack` stacks, one per repository. **Nothing
merges** until Mark signs off the live checklist on the full stack (D12).

```text
bakin stack (base main)            bits stack (base main)
H1 cli launch + typed args  ──┐    B0 cliCommand arg declarations (messaging, projects) — merged + released FIRST
H2 plugin socket routes     ──┼──▶ B1 managed tmux service + control client + bridge
H3 canonical CSS (T24b)     ──┤
                              │    B2 WebSocket transport + reconnect baseline
   Bits CI BAKIN_SDK_REF ─────┘    B3 multi-device sizing           ◀── early live preview
   pinned to the H2, then H3 tip         B4 native handoff (CLI + attach admission)
                                   B5 key bar + compose + pinning + links/copy
                                   R1 bounded shadow replica (raw-output transport, dark)
                                   R2 opt-in raw path (join, rebase, recovery, digest)
                                   R3 native scrollback; Mark's acceptance; bridge deletion
                                   B6 attention/activity + image paste
```

Dependency order inside Bits:
- B1 → B2: the socket output fan-out comes from the event-driven bridge, and
  input goes through the control client.
- B2 → B3: claim and resize are socket messages. No throwaway POST sizing.
- B3 → B4: an attach is a size claim.
- B5 and B6 depend on B2. They are stacked after B4 only to keep one linear
  stack.

High-risk items come first: H2 (WebSocket under Bun's node-compat) and B1 (the
control-mode client and real tmux behavior). Both prove themselves with
integration tests before anything is built on them.

## Branches, worktrees and live serving

- Create both branches in the **main checkouts**, so 3737 (the bakin repo tree)
  and the linked terminal plugin (symlinked to the bits checkout) serve them
  for Mark's live testing. Use the memory rule `test-live-before-merge`.
- Before every commit, verify `git branch --show-current` and HEAD.
- Branch names:

  | Branch | Repo |
  |---|---|
  | `feat/terminal-md-h1-cli-launch` | bakin |
  | `feat/terminal-md-h2-socket-routes` | bakin |
  | `feat/terminal-md-h3-canonical-css` | bakin |
  | `feat/terminal-md-b0-cli-args` | bits |
  | `feat/terminal-md-b1-tmux-bridge` | bits |
  | `feat/terminal-md-b2-socket` | bits |
  | `feat/terminal-md-b3-sizing` | bits |
  | `feat/terminal-md-b4-handoff` | bits |
  | `feat/terminal-md-b5-mobile` | bits |
  | `feat/terminal-md-r1-replica` | bits |
  | `feat/terminal-md-r2-raw-path` | bits |
  | `feat/terminal-md-r3-scroll` | bits |
  | `feat/terminal-md-b6-attention` | bits |

- Record the base SHAs in this file's Evidence section at T0.
- Server-side code is not hot-reloaded by `bun run dev`. To exercise host
  changes, 3737 needs a restart, which is Mark's call. Never kill his server
  without asking (memory `no-background-dev-instances`, `dev-server-bun-deadlock`).
- All automated tests and previews use disposable homes and private tmux and
  launchd jobs. Never touch the live service except in T26.

## Commit strategy and rollback checkpoints

### Commits

- **One task = one commit**, or at most a `feat` plus a `test` commit when the
  test commit is reviewed separately. Each commit is conventional with a scope:
  - `feat(cli): …`, `feat(plugins): …` and `docs(plugins): …` in bakin;
  - `feat(terminal): …`, `refactor(terminal): …`, `test(terminal): …` and
    `docs(terminal): …` in bits.
- **Every commit is green on its own:** typecheck, lint, and the touched
  test files. A commit never leaves a half-wired path. A retired route is
  deleted in the same commit that replaces it, not before.
- **Docs ride with behavior:** the knowledge, README, and docs-site edits that
  describe a change are in the same commit, or in the PR's final `docs(…)`
  commit when they span several tasks. No PR merges with stale docs.
- **Review fixes** go in follow-up commits on the PR branch (`fix(terminal):
  address review round N`). History is never rewritten after a PR is opened,
  except for `gh stack rebase` cascades. Rewriting orphans the Bits
  `BAKIN_SDK_REF` pin (memory `terminal-plugin-prs`).
- **Never commit** `generated-version.ts` after a build.
- Each PR body ends with the attribution line.
- Merges are **merge commits, not squash**, so per-task commits remain
  revertable after landing. Mark confirms this at merge time.

### Rollback checkpoints

Each checkpoint is a lightweight local tag, `tmd/cp<N>`, on the stack tip
once its checkpoint verification passes. Rolling back means resetting the
affected branch to the tag. That is always a fully green state.

| Tag | After | Rollback effect |
|---|---|---|
| `tmd/cp0` | T0 | Clean bases, spec and plan committed |
| `tmd/cp1` | H1 complete | CLI launch works. Drop H2 and everything above |
| `tmd/cp2` | H2 complete | Host capability complete. Bits work starts from here |
| `tmd/cp3` | B0–B1 | New service and bridge. The browser still uses the old SSE path (B1 keeps it) |
| `tmd/cp4` | B2 | WebSocket transport live. SSE and POST are deleted |
| `tmd/cp5` | B3 | Sizing complete. **Early live preview for Mark** |
| `tmd/cp6` | B4 | Native handoff |
| `tmd/cp7` | B5 | Mobile input (key bar, compose, pins, links) |
| `tmd/r0-baseline` | B5 tip, 2026-10-28 | R branches start here |
| `tmd/r1` | R1 | Shadow replica, dark. Drop R1 and above to roll back |
| `tmd/r2` | R2 | Opt-in raw path. Setting off = today's transport |
| `tmd/r3` | R3 | Native scrollback, accepted by Mark; then T38b deletes the bridge |
| `tmd/cp8` | B6 | Feature complete |

### Rollback by layer

- **Unpublished local work:** reset to the checkpoint tag.
- **Published PR branches:** roll back by forward revert commits
  (`git revert <range>` back to the tag), never by reset.
  - Exception: dropping whole PRs from the **top** of a stack with
    `gh stack`, since nothing descends from them.
  - After any cascade, re-verify that Bits `BAKIN_SDK_REF` still names a
    reachable reviewed SHA.
- **After merge, before release:** `git revert -m 1 <merge>` per PR, top-down.
  Bits PRs revert before Bakin PRs.
- **Live box:**
  - The linked plugin follows the bits checkout. `git checkout <tag>`, then
    reload, rolls the plugin back.
  - The tmux service rollback is **drained and manual**. The old code's
    setup returns early when the binary path matches (`service.ts:77`), so
    it cannot restore its own conf by itself.
    1. End all sessions.
    2. `launchctl bootout gui/$UID/io.bakin.terminal.<hash>`.
    3. Delete that plist.
    4. Run the restored version's **Set up service**, which now sees no
       plist and installs fresh.
  - Data stays readable within the bridge era (B1–R3 before T38b): session
    JSON only gains fields, and the history-capture, upload and bundle
    tables are additive. Rolling back below T38b is narrowed (T35b).
  - **No rollback path** for live tmux panes across a service restart. That
    is acceptable because cutover requires drained sessions.
- **After release:** reinstall the previous `terminal-v0.3.5` artifact and
  run the previous Bakin release. Follow the drained service procedure above.
  Because B0's arg declarations are additive (verified in T1), older cores
  ignore them.

## Release sequencing

1. Mark signs off the live checklist (T26) on both stack tips. Record the
   SHAs, the Bun and tmux versions, and the results.
2. **B0 goes first and alone.** Merge B0, then tag `messaging-v<next>` and
   `projects-v<next>` one at a time. Mark upgrades both on the live box
   **before** the strict-argument core ships. Once rc.45 is released,
   already-installed manifests have their args declared. B0's declarations
   are ignored by the current core (verified in T1), so B0 needs no floor
   change.
3. Merge the bakin stack bottom-up (H1 → H2 → H3). Use `gh pr merge
   --merge`, never squash, so per-task commits stay revertable.
4. Cut **Bakin rc.45**: prep plus `workflow_dispatch`. Retry by
   re-dispatching; never move the tag (memory `rc41-release-shipped`).
5. Repin Bits `BAKIN_SDK_REF` to the **rc.45 tag commit**. Raise the
   **terminal** floor to `>=0.0.1-rc.45`. Both go in the B-stack's final
   commit, `chore(terminal): floor at rc.45`, which also sets 0.4.0, and are
   tested before merge.
6. Merge the bits stack bottom-up (B1 → B5, R1 → R3, then B6, with merge
   commits). T38b lands on R3 only after Mark's acceptance.
7. Tag `terminal-v0.4.0`. `publish.yml` clones moving Bakin `main`
   (`publish.yml:90`). Before tagging, verify Bakin main still equals the
   rc.45 commit. T25 changes `publish.yml` to check out the same pinned
   `BAKIN_SDK_REF` as CI. Mark approves that CI change as part of this plan.
6. **Installed-artifact smoke test:** on a disposable home with the pinned
   runtime set to pi and dispatch paused (memory
   `verify-boot-touches-production-runtime`), install the released terminal,
   create a session, attach natively, and open the socket. Then upgrade the
   live box through the normal plugin upgrade (Mark).

### Versions

Every bits PR must bump its package version (`check-version-bump.sh`):
- terminal: B1 `0.4.0-dev.1`, then B2 `dev.2` and so on: B5, then R1, R2
  and R3 each take the next dev number, then B6. The final floor commit sets
  `0.4.0`. `index.ts`, `package.json` and
  `bakin-plugin.json` stay in agreement. They currently disagree (0.2.0 vs
  0.3.5); B1 fixes that.
- messaging and projects: one patch bump each in B0, and they are touched
  nowhere else in the stack.
- **CI runs only on non-draft PRs** (`ci.yml:24`). Every PR is opened
  ready-for-review, with a `do-not-merge` label and "DO NOT MERGE — awaiting
  live sign-off" at the top of its body. That is also what `gh stack merge`
  requires.

## Tasks

The test command in every Bits task is run from the Bits root:
`bun run test plugins/terminal/tests/<file>`. In Bakin it is
`bun test <file> --isolate`. The typecheck and lint gates are implied for every
task.

### Phase 0 — Setup

**T0: Branches, bases, docs commit** (XS)
- Acceptance:
  - Both main checkouts are clean, with any unrelated changes preserved.
  - The H1 and B0 branches are created from fresh `origin/main`.
  - The spec, plan and todo files are committed on H1 as
    `docs(specs): terminal multi-device spec and plan`.
  - Base SHAs are recorded.
- Verify: `git status`, `git log -1` in both repos; `git diff --check`.
- Checkpoint: `tmd/cp0`.

### Phase 1 — Bakin H1: CLI launch mode and typed arguments

**T1: Typed cliCommand arguments and plugin-id dispatch** (M)
- Acceptance:
  - The manifest (`packages/sdk/src/types/manifest.ts`,
    `packages/core/src/plugins/manifest.ts`) declares `args`: name, type
    (`string|number|boolean|enum`), required, positional or flag.
  - Dispatch parses strictly: unknown flags and extra positionals are
    rejected, and nothing is coerced.
  - The route path uses the contributing plugin's id
    (`plugin-dispatch.ts:125`).
  - `bakin --help` renders the declared args.
  - Older cores ignore `args`. Verify that the Bits schema/loader does not
    reject unknown keys. If it does, B0 is ordered after the release instead.
- Verify:
  - `bun test tests/cli/plugin-dispatch*.test.ts --isolate`.
  - A help-render test.
  - A messaging/projects fixture manifest dispatches correctly.
- Files:
  - `packages/sdk/src/types/manifest.ts`
  - `packages/core/src/plugins/manifest.ts`
  - `src/cli/commands/plugin-dispatch.ts`
  - `src/cli/help.ts`
  - tests
- Dependencies: T0.

**T2: Interactive launch mode** (M)
- Acceptance:
  - `dispatch.launch.bin` is validated at manifest load as a member of that
    plugin's `requires.bins`.
  - New `src/cli/launch.ts`:
    - TTY and reachable-local-server prechecks run before the POST.
    - It resolves the binary in `~/.bakin/bin` and spawns it with inherited
      stdio and env (no shell, no `env -i`).
    - The child's exit code propagates.
  - The route response is validated against a typed
    `{ args: string[], confirm?: { path, token } }` schema.
  - When `confirm` is present, the CLI POSTs `{ token, pid }` to the
    plugin's confirm route right after spawning, then waits on the child.
    This host-side half of the attach reservation handshake (D7) is generic:
    the token is opaque to core.
  - If the confirm request fails, the CLI kills the child and exits
    non-zero.
  - Operator provenance is sent (`--as human`). Agent contexts are refused
    in the CLI, and the route receives provenance it can check. Reuse the
    approvals provenance plumbing; locate the exact helper while building.
- Verify:
  - `tests/cli/launch.test.ts` under a PTY harness: stdio inheritance, exit
    code, no-TTY refusal, agent-context refusal, and an undeclared bin
    rejected at load.
- Files:
  - `src/cli/launch.ts`
  - `src/cli/commands/plugin-dispatch.ts`
  - manifest types/validator
  - provenance helper export
  - tests
- Dependencies: T1.

**T3: H1 docs** (S)
- Acceptance:
  - The docs site page for plugin CLI commands covers args and launch.
  - `.claude/knowledge/plugin-system.md` gets a "CLI commands" section.
  - The `CLAUDE.md` CLI paragraph mentions launch mode.
  - `bun run docs:validate` passes.
- Verify: `bun run docs:validate`; `bun run lint`.

**Checkpoint H1** (`tmd/cp1`)
- The full `bun run test` passes, along with `typecheck`, `lint`,
  `check:cycles`.
- Two Codex review rounds, with fixes committed.
- Open the PR (ready for review, `do-not-merge` label) as the first `gh stack` entry.

### Phase 2 — Bakin H2: Plugin socket routes

**T4: Socket-route contract** (M)
- Acceptance:
  - SDK types for `contributes.socketRoutes` and `defineSocketRoute({ path,
    admit, open })`.
  - The handler receives a typed socket:
    - `send(binary|json)` returns a backpressure state;
    - `onDrain`, `onMessage`, `onClose`, and `close(code, reason)`.
  - The manifest validator checks every path against the declared routes.
  - The SDK testing harness gains an in-memory socket pair for plugin tests.
  - Bits `test-sdk` stubs are added in B1.
- Verify: SDK type tests; `bun test tests/sdk-testing/socket*.test.ts`.
- Files:
  - `packages/sdk/src/types/*`
  - `packages/sdk/src/testing/*`
  - core manifest validator
  - tests
- Dependencies: cp1.

**T5: Host upgrade path** (M — high risk, fail fast)
- Acceptance:
  - `server.ts` wires the `upgrade` event on the server it creates
    (`server.ts:242`). The event goes to a new `createUpgradeHandler` in
    `src/core/server/upgrade-handler.ts`. `request-handler.ts` is an HTTP
    request callback and stays unchanged.
  - The new handler routes `/api/plugins/<id>/<socketPath>` through the
    live `pluginRegistry`, using a pinned host-owned `ws` dependency. Add it
    to the dependency-sweeps coupling ledger.
  - **Before** the upgrade completes:
    - the Origin is checked against the public origin, and host auth runs;
    - the plugin's `admit` runs.
  - Sends are bounded per connection, with a 2 MiB default queue and drain
    events.
  - Every socket closes on plugin disable, hot-reload sweep, and server
    shutdown.
- Verify: unit tests for admission and routing.
- Files:
  - `server.ts`
  - `src/core/server/upgrade-handler.ts` (new)
  - `src/core/plugins/socket-routes.ts` (new)
  - the hot-reload sweep
  - `package.json` and `bun.lock`
- Dependencies: T4.

**T6: Real-socket integration on Bun 1.4.3 and H2 docs** (M)
- Acceptance: `tests/integration/sockets/` boots the server on a disposable
  home and uses a real `ws` client. It covers:
  - binary round trip;
  - rejected Origin;
  - rejected admission;
  - backpressure and drain;
  - client disconnect;
  - plugin reload closing sockets;
  - shutdown.

  Also:
  - A teeth test proves that admission bites.
  - The docs site gains a socket-routes page; `plugin-system.md` and the
    `CLAUDE.md` architecture line are updated.
  - Bits `ci.yml` `BAKIN_SDK_REF` is pinned to the H2 tip, done in B1.
- Verify: `bun test tests/integration/sockets --isolate`; `bun run docs:validate`.

**Checkpoint H2** (`tmd/cp2`)
- The full suite passes, then `ui:conformance --quick`, run sequentially,
  never two at once.
- Two Codex rounds.
- The stack is pushed; both PRs are ready for review with the `do-not-merge` label.

### Phase 3 — Bits B0: argument declarations

**T7: Declare args for messaging and projects cliCommands** (S)
- Acceptance:
  - Every existing `cliCommands` entry declares its args.
  - Messaging and projects each get a patch version bump.
  - Their tests pass against the H2-assembled SDK.
- Verify:
  - `bun run test plugins/messaging plugins/projects`
  - `bun run typecheck`
  - `BAKIN_SDK_DIR=… bun run build`

### Phase 4 — Bits B1: managed tmux service, control client, bridge (browser unchanged)

**T8: CI pin, test-sdk, version alignment** (S)
- Acceptance:
  - `BAKIN_SDK_REF` points at the H2 tip.
  - `test-sdk` has socket-route and launch types.
  - The terminal version reads `0.4.0-dev.1` in the manifest, `package.json`
    and `index.ts`.
- Verify: `bun install`; `bun run typecheck`; CI green on the PR (ready for review, `do-not-merge`).

**T9: Managed-only service, generated conf, fingerprint, Health incident** (M)
- Acceptance:
  - `TerminalService.tmux` resolves only `~/.bakin/bin/tmux`.
  - The conf generator emits D7 exactly: the minimal prefix table and the
    listed options.
  - The fingerprint covers the asset sha, the version, the conf and the
    canonical plist. It is recorded only after a verified startup, and the
    `service.ts:77` early return is fixed.
  - Setup is serialized against creation, attach and control connections. It
    names the blocking sessions and refuses when state is unknown.
  - A new incident, "Terminal service update available", is declared in the
    catalog with the drained Set up service repair action.
  - The README's "manual fallback" line is removed.
- Verify:
  - `service.test.ts`: conf snapshot, fingerprint, early-return regression.
  - `plugin.test.ts`: incident catalog.
- Files:
  - `lib/service.ts`
  - `lib/tmux-config.ts` (new)
  - `index.ts`
  - tests
  - `README.md`

**T10: Control-mode client** (M — high risk)
- Acceptance: `lib/control.ts` provides:
  - one persistent `tmux -C` client per session;
  - a `%begin/%end/%error` parser, with commands correlated by number;
  - `send-keys -H` encoding;
  - `refresh-client -B` subscriptions;
  - `%exit` handling and reconnect;
  - a bounded command queue.
- Verify:
  - `control.test.ts`: parser fixtures, including split frames, octal
    escapes, and an error inside a block.
  - **Real tmux:** `TERMINAL_PROCESS_TEST=1 … processes.integration.test.ts`
    covering a command round trip, a subscription change, and kill/reconnect.

**T11: Bridge rewire** (M)
- Acceptance:
  - The bridge PTY attaches with `-f ignore-size`, and the window is
    `window-size manual`.
  - `write` goes through the control client and awaits `%end`. If the pane
    is in copy-mode, it cancels copy-mode first.
  - Liveness uses `#{pane_dead}`.
  - Output is pushed to subscribers through an event callback. The 100 ms
    poll is removed, and the SSE route is adapted to the push source as a
    temporary consumer until B2 deletes it.
  - `@bakin_title` is set on create and on recovery.
- Verify: the existing `processes`/`sessions` unit tests are updated; real
  tmux tests cover write ordering, copy-mode cancel, and dead-pane detection.

**Checkpoint B1** (`tmd/cp3`)
- `bun run test plugins/terminal/tests` and the **mandatory** real-tmux run
  pass, plus `typecheck`, `lint`, `build`.
- The disposable preview works end to end with the current UI.
- Two Codex rounds. PR opened ready for review with `do-not-merge`.

### Phase 5 — Bits B2: WebSocket transport and reconnect baseline

**T12: Server socket protocol** (M)
- Acceptance: `lib/socket.ts` is registered as a socket route.
  - The opening message binds viewer identity.
  - Each connection gets an epoch, and the sync bundle is atomic.
  - Output fan-out uses binary frames.
  - Input envelopes carry `{generation, viewerSeq, data}`. The server
    assigns the session `inputSequence`, and results are
    `accepted`/`rejected`/`uncertain`.
  - ACK windows: 16 KiB or 50 ms; pause at 256 KiB; evict at 2 MiB or after
    10 s paused.
  - Heartbeat: 15 s ping, 30 s timeout.
  - Interrupt goes through as input.
  - A `resize` message carries **today's** semantics: only a writable human
    viewer may send it. T14 replaces it with claim/resize.
  - The socket route is added **alongside** SSE. Nothing is deleted in this
    commit, so the UI keeps working.
- Verify:
  - `socket.test.ts` with the harness socket pair.
  - Bounded-load test: `yes` for 30 s with one stalled viewer. Thresholds
    per the spec.
  - Race tests: reconnect during output, two writable viewers, an uncertain
    result never replayed.

**T13: Client socket, retire SSE/POST, reconnect baseline** (M)
- Acceptance:
  - `terminal-canvas.tsx` **and** `terminal-page.tsx` (its write and
    interrupt paths, `terminal-page.tsx:159`) use one socket. Take, Return,
    assign, complete, terminate and delete stay as HTTP POST lifecycle
    commands.
  - **Deleted in this same commit:**
    - the `stream` function and the `/stream` route;
    - the POST `write`/`resize`/`interrupt` operations from `commandSchema`;
    - the unused `/history` cursor route;
    - the matching manifest `apiRoutes`.
  - The browser ACKs after the write callback.
  - Input is coalesced: 8 ms or 4 KiB, never across a generation change.
  - "Input not sent" and "May have been delivered" surface in the UI.
  - On `visibilitychange`, focus, or online: reconnect with a fresh sync,
    revalidated ownership and size, and a repaint. WebGL is recreated only
    after context loss.
  - The `autocomplete="off"` attribute is not in scope here (B5).
- Verify:
  - Browser tests: reconnect, input results, and a hidden/visible cycle on
    Chromium and WebKit.
  - `ui:conformance --quick`.

**Checkpoint B2** (`tmd/cp4`)
- All gates plus the real-tmux run.
- `rg` confirms no `/stream` and no `text/event-stream` in `plugins/terminal`.
- Two Codex rounds.

### Phase 6 — Bits B3: multi-device sizing

**T14: Sizing server** (M)
- Acceptance:
  - `lib/sizing.ts` holds the pure claim and resize policy (epoch and
    revision, floor).
  - Session fields: `sizeAuthority`, `sizeEpoch`, `sizeRevision`,
    `sizeState`.
  - Socket messages `claim` and `resize`.
  - Resize order: tmux first, then PTY, then Screen, then the store, with
    reconciling and input pause on failure.
  - Creation resolves its dimensions before spawning: the creator's pane, or
    `defaultSize` for agents.
  - The `defaultSize` setting defaults to 200×60, with a "Use as default"
    command.
  - Agent `resize` is removed from the exec tool, and `screen` returns
    `{text, cols, rows, sizeRevision}`. The tool description is updated.
- Verify:
  - `sizing.test.ts`: stale epoch, floor, and no-op revision.
  - The four-step failure-injection test.
  - Real tmux: two viewers claiming in turn.
  - `plugin.test.ts`: the exec-tool schema lacks `resize`.

**T15: Viewer rendering** (M)
- Acceptance:
  - The canvas uses explicit authority state, not `writable`.
  - The authority device fits its pane and debounces resizes: rows
    immediately, columns after 100 ms.
  - A non-authority device:
    - fits the font to the width, with a per-device minimum (10 px on touch);
    - pans natively with `overflow:auto` on both axes;
    - supports custom pinch zoom (via `touch-action`), remembered per device
      with guarded `localStorage`, plus Reset view;
    - follows the cursor after each render batch, pausing on pan, selection,
      or scrolling into history until "↓ Live" is tapped (T15b).
  - The header shows the size line, "Fit to this device", and "Size frozen".
  - Panning never focuses the keyboard. Kit patterns follow
    `bakin-ui-conformance`; any deviation goes to Mark first.
- Verify:
  - Browser tests on desktop and iPhone emulation, Chromium and WebKit:
    claim/fit, pan, pinch, follow pause/resume, and no input from pans.
  - `ui:conformance --quick`.

**T15b: Follow controls off the input line** (XS, follow-up to the completed B3 checkpoint, from the live test 2026-10-27)
- Acceptance:
  - "Follow cursor" becomes a 32 px "↓ Live" pill (≥ 44 px touch target)
    in the pane's top-right corner, with Reset view as a 32 px icon beside
    it. Both are anchored to the viewport wrapper, outside the scrolling
    content, shown only when not following, and keep terminal focus on tap.
  - Follow uses three states (following / panned / reading history) with
    selection as an inhibitor; it resumes on "↓ Live" or on focusing the
    terminal to type (D10), never on merely reaching the bottom. Cursor reveal keeps the cursor out from under the
    pill.
- Verify: the sizing browser test asserts, at phone and desktop sizes, that
  the controls overlap neither the last row nor the cursor (cursor placed
  under the pill's corner), a horizontal pan at the bottom stays panned,
  and tapping the pill with the keyboard up does not blur the terminal.

**Checkpoint B3** (`tmd/cp5`, the **early live preview**)
- All gates pass and two Codex rounds are done.
- Offer Mark an optional live preview of sizing on 3737. This requires the
  maintenance cutover first (T26 steps 1–4), plus a host restart, which is
  his call.
- Findings fold into B3 before continuing.

### Phase 7 — Bits B4: native handoff

**T16a: CLI commands** (M)
- Acceptance: `lib/cli.ts` with the typed `cliCommands`.
  - **`new` and `attach`** use `launch: { bin: 'tmux' }` and return the
    attach args plus `confirm`.
    - The attach args never include `-d`, and the CLI keeps the env intact.
  - **`ls`** is an ordinary `apiRoute` that prints a table, not a launch
    command. Its columns are short id, title, program, owner, state, size,
    cwd/worktree, and native client count. Bakin's bridge and control
    clients are excluded from the count.
  - **`new` defaults:**
    - cwd = the caller's directory, sent by the CLI as a declared arg;
    - program = shell;
    - `checkout: 'existing'`, passed explicitly;
    - title = basename of the cwd;
    - `--worktree` works for every program, including shells;
    - `--agent` assigns the agent only.
  - **Ref resolution:** an exact full id wins. Otherwise a unique prefix of
    at least 8 characters, or an exact title. Ambiguity lists the
    candidates and exits non-zero.
  - **Refusals, before anything is created:** `$TMUX` set (the CLI sends a
    declared flag, and the route also refuses), no TTY (H1), agent context
    (H1), and an agent-owned session ("Take control first").
  - The attach hint line prints: `Detach: Ctrl-b d · Scrollback: Ctrl-b [ ·
    Closing the window also detaches`.
  - A partial failure on `new` keeps the session, prints its id and the
    attach command, and exits non-zero. It never retries.
- Verify:
  - `cli.test.ts` covers refs, defaults, refusals, and the `ls` table.
  - A host CLI fixture test proves dispatch end to end.

**T16b: Attach admission and ownership** (M)
- Acceptance:
  - Reservations are single-use, last 15 s, are bound to the generation,
    and are confirmed with `{token, pid}`.
  - A `client-attached` subscription detaches any client that matches no
    reservation, including a raw `tmux attach`.
  - Take, Return, and assign invalidate reservations.
  - Return detaches admitted native clients and waits for them before
    granting agent ownership.
  - Attach admission is serialized in `Sessions.run()`.
- Verify (real tmux):
  - an unreserved raw attach is detached;
  - attach racing Return;
  - an expired reservation is refused;
  - Return detaches the native client.

**T16c: Native size authority** (S)
- Acceptance:
  - An admitted attach is a claim with authority kind `native`.
  - The `client-resized`/`client-attached` hook sets `@bakin_client_size`,
    and the subscription applies it to the authority. If the 3.7c format
    expansion fails verification, a 1 s `list-clients` poll is used
    instead.
  - `client-detached` from the authority freezes the size.
- Verify (real tmux): resizing the native client's PTY follows; detach
  freezes; a browser claim takes over and stops the following.

**T17: Handoff UI and README** (S)
- Acceptance:
  - A "Copy attach command" menu item copies `bakin terminal attach <id>
    --as human`, with the tap-to-copy fallback from B5 stubbed through the
    kit `copyToClipboard`.
  - Details shows the short id.
  - An "Open in a terminal app" indicator appears.
  - The README gains a "Continue in a terminal app" section: the CLI, the
    key hints, and the agent-owned refusal.
- Verify: a browser test for the menu and indicator; `ui:conformance --quick`.

**Checkpoint B4** (`tmd/cp6`): all gates, the real-tmux run, and two Codex rounds.

### Phase 8 — Bits B5: mobile reading and input

Amended 2026-10-27 after the first live test (Mark), then again on
2026-10-28: the key bar (T18a–c, v2 after the iPhone test), Compose (T18),
pin editing (T19b), and links/emoji (T20). Scrollback moved to Phase 8R
(native, raw-output transport); the 2026-10-27 snapshot tasks were never
built. Spec D9 items 3 and 9, D10 follow states and controls. Mockups: Claude artifact "Terminal mobile
key bar" (boards C1, C2, A3). Playwright device emulation does not prove the
native iOS keyboard or gestures, so two **physical-iPhone checkpoints with
Mark** are part of this phase (after T18b, and Phase 8R's R3 acceptance).

**T18a: Key bar v2 foundation** (M; v1 built as 86a5a1a failed the live
iPhone test 2026-10-27, so v2 replaces it, spec D9 item 9)
- Acceptance:
  - An editing-session state (idle / typing / sheet) on touch devices. The
    bar renders in the always-mounted accessory slot.
  - `TerminalInputHandle` gains `focus()`, `blur()`, `text()` (gated literal
    input) and `modifier(name)`. The handle's modifier state is
    off / once / locked for ⌃ and ⌥.
  - xterm-6-compatible encoding for Ctrl, Alt (ESC prefix), CSI `1;m`
    cursor/Home/End and `n;m~` tilde keys. A modifier is never applied twice.
    Paste and IME clear one-shot and keep a lock. Disconnection, ownership
    or session change and backgrounding clear everything.
  - iOS-style keycaps: esc ⇥ ⌃ ⌥, •••, a divider, and hide keyboard (always
    enabled). A 38 px fallback applies below 370 px.
- Verify:
  - Unit: the encoding matrix against xterm 6's rules, modifier
    transitions, and the session reducer.
  - Browser (Chromium + WebKit): bar shows on focus and stays while using
    it, hide keyboard ends the session, one input per activation, no
    double modifier, desktop shows no bar.
  - `ui:conformance --quick`.

**T18c: ••• key sheet** (M)
- Acceptance:
  - ••• dismisses the keyboard and opens a bounded sheet in the slot: the
    spec's Keys and Control groups plus Ctrl and Option lock toggles.
  - `abc` refocuses the terminal directly from the tap. Hide keyboard
    closes the sheet.
  - Keyboard users get focus into the sheet, Escape closes it, and focus
    returns.
- Verify: unit tests for the sheet's sends and lock toggles; browser tests
  for open, send, abc and hide, with focus behaviour.

**Checkpoint: physical iPhone #1** (Mark, Home Screen app and a Safari tab,
after the live install is refreshed)
- Repeated open, hide, sheet and abc cycles.
- Portrait and landscape.
- Predictive and emoji keyboards.
- Paste and dictation.
- Background and resume.
- A Bluetooth keyboard attached and detached.
- No hidden cursor, unwanted resize, lost character or stuck modifier.

**T18b: Arrow joystick + modifier locks** (M)
- Acceptance:
  - The joystick per spec: dead zone, hysteresis, step on entry, 350/100 ms
    repeat, cancel paths, suppressed trailing click, tap-to-step, and arrow
    keys when focused.
  - ⌃ and ⌥ lock from the ••• sheet's lock toggles (built in place of
    long-press, 2026-10-28; a tap arms or cancels).
- Verify:
  - Unit: the pure direction and repeat machine with an injected clock.
  - Browser: drag sends and repeats, cancel stops, no click after a drag.

**T18d: Kit recipe update** (S, bakin) — built (bakin 0ace3a54d, c34d28437,
4fb283cc8, 972daf0dc; bits b0f33af; 4 Codex rounds)
- Acceptance: `recipes/terminal-input.stories.tsx` and its fixture show the
  v2 pattern, with coverage and story compliance updated.
  - As built: `BarAndSheet` — one row of `icon-lg` keys (six fit 320 px),
    off / one-shot / locked modifiers (named and shown by shape), a bounded
    More keys Panel in the same accessory, Hide keyboard always enabled;
    Escape owned by an open sheet (captured; a dialog's, a composition's or
    a claimed Escape left alone); committed text ends a one-shot modifier.
    Guidance in the story, style guide and public UI docs; four visual
    baselines regenerated in the canonical image (only those).
  - The Bits key bar's keycaps became kit Buttons drawn by scoped CSS (the
    legacy-style ratchet counted the raw buttons), pixel-identical.
- Verify: `ui:conformance --full` in bakin (the census step fails on the
  stale Bits compatibility matrix until T24b's repin; every other step,
  the story, browser and visual runs pass).

**T19a / T19 / T19c (snapshot scrollback): superseded 2026-10-28** by
Phase 8R (the raw-output transport, spec D13 and D9 item 3). Never built.

**T18: Compose sheet** (M)
- Acceptance:
  - A native textarea sheet with Paste and Paste+Enter. It uses bracketed
    paste only when the app enables it, read from xterm's mode.
  - Per-session drafts are kept in guarded `localStorage`.
  - `autocomplete="off"` is set on the helper textarea.
  - Input enters through the same socket queue. Opened from **Compose** in
    ••• (the keyboard button only focuses the terminal).
  - Focus moves to the textarea deliberately without unmounting the bar's
    parent.
- Verify: unit tests for paste encoding; WebKit iPhone-emulation browser tests.
- Built (6a9acec, 78c2165, 4373cdc, d5f7377, e624ff4; 4 Codex rounds): see spec D9 item 2 "As
  built" — explicit paste input delivered by tmux (`paste-buffer -p -r
  -S`), Paste + Enter in one envelope, drafts owned by the page and cleared
  only on the accepted revision, real-tmux and browser (Chromium + WebKit)
  coverage including a refused paste.

**T19b: Pin editing** (S) — deferred out of B5 (decision 5, spec D9 item 9: Later)
- Acceptance: **Edit pinned keys** in ••• adds, removes and moves pins with
  explicit buttons (no long-press needed); holding any key never sends it.
  Pins live per device in guarded `localStorage` (browser-local by Mark's
  choice; synced settings only if it proves useful), validated against the
  supported keys, deduplicated, capped at 12.
- Verify: unit tests for edits, validation, the cap and storage failure;
  one browser test.

**T20: Links and tap-to-copy** (S) — links built (f0e2ddc); tap-to-copy
uses the kit `CopyButton`'s new touch size (decision 6, spec D9 item 4)
- Acceptance:
  - `@xterm/addon-web-links` 0.12.0 is added (plain-text URLs; OSC 8 links
    follow the profile's allowlist, T30).
  - Copying a selection: when iOS rejects `writeText`, a tap-to-copy prompt
    appears. Program clipboard offers (OSC 52) are T36b, not this task.
  - Character widths moved to the profile (T30b).
- Verify:
  - Browser test: link and copy.
  - The package and lockfile diff is reviewed.

**Checkpoint B5** (`tmd/cp7`): all gates, the real-tmux run, and two Codex rounds.

### Phase 8R — raw-output transport and native scrollback (spec D13, 2026-10-28; revised after Codex round 1)

**Stack:** B5 → R1 → R2 → R3 → B6. R branches start from `tmd/r0-baseline`
(the B5 tip on 2026-10-28). B5's remaining tasks (T18d, T18, T19b, T20) land
on B5 and merge forward into the R branches. Character widths live in the
terminal profile (T30b), not T20. Each R branch is its own PR with its own
dev version bump. The release order is B5 → R1 → R2 → R3 → B6.

**Process (Mark, 2026-10-28):** "as long as you review each step with codex
a minimum of 2 times you are good to keep moving forward to completion where
we can test end to end manually again."
- Every task gets at least two Codex rounds, with findings fixed, before
  the next one starts.
- Every task's acceptance includes its docs (README, `.claude/knowledge`,
  public docs), or says "no public change".
- UI checkpoints (R2 banner, R3) run the H3 CSS sync and Bits SDK repin
  (T24b).
- The old transport stays the live default until T38a's opt-in path passes
  Mark's acceptance. T38b deletes it afterwards.
- **Two paths until T38b.** Every R task keeps the bridge path working
  exactly as B5 ships it; the raw path's behavior is added beside it,
  selected per session by T38a's setting:
  - **Readiness:** the bridge path keeps its bridge-liveness check
    (`processes.ts connected()`); the raw path's health is the control
    client's.
  - **Resizes:** the bridge path keeps resizing its bridge PTY and Screen
    from `Sessions` and the browser from session updates; the raw path
    resizes only from the ordered event log.
  - **Ended sessions:** the bridge path keeps its retained redraw bytes.
  - Every R checkpoint runs the bridge path's bridge-loss recovery and
    resize tests with the setting off, so a regression on the default path
    is caught where it was introduced.

**Branches:** `feat/terminal-md-r1-replica` → `-r2-raw-path` → `-r3-scroll`.

#### R1: bounded shadow replica (dark)

**T30: Terminal profile module** (M) — built (ce411b3; review fixes 52f4826)
- Acceptance: as built, the query, link, clipboard, colour and graphics
  policy, live-only side effects, xterm 6.0.0 workarounds, and the xterm
  pin architecture test. Review round one added:
  - nothing the emulator generates leaves a viewer (focus reports were
    escaping): only user input passes `triggerDataEvent`;
  - OSC 52 offers carry decoded UTF-8, bounded at 256 KiB decoded;
  - link reclamation roots are live extended cells plus the current pen,
    and a sweep runs only after `LINK_ORPHAN_LIMIT` new orphans;
  - mailto links open through a canvas link handler;
  - a stock-vs-patched tripwire for every workaround (D13).

**T30b: Profile owns the terminal configuration** (S) — built (52f4826)
- Acceptance:
  - The profile sets the same scrollback (10,000), Unicode provider and
    parsing options on the replica, every viewer and the verifier.
  - The Unicode provider is `@xterm/addon-unicode-graphemes` 0.4.0
    (`15-graphemes`, released with xterm 6.0.0), corrected to tmux's widths.
    Measured against tmux 3.7c, Unicode 11 diverged on the common emoji
    sequences (ZWJ, skin tones, VS16, keycaps); graphemes match them.
  - **tmux widths, generated:** the managed tmux is built with utf8proc, so
    its scalar widths are deterministic. `scripts/generate-tmux-widths.ts`
    reads tmux's own width for every codepoint (U+00A0 to plane 3, plus the
    tag plane) through its `#{w:}` format, which runs the grid's width
    function (tmux's default table, then utf8proc), compares it with the
    grapheme provider's, and records the differences
    (`lib/tmux-width-table.ts`, about 5,200 codepoints: format characters,
    spacing marks, tmux's force-wide emoji bases (☝ ✌), newer emoji, the
    Unicode 16 changes). A wrapping provider applies them: a zero-width one
    joins the previous cell at its width; another applies outside a
    grapheme cluster. A process test regenerates the table and fails when it
    is stale (a tmux or addon change).
  - **Decision (Codex-reviewed, 2026-10-28):** scalar widths only, over the
    grapheme rules. Porting tmux's combining rules into a provider cannot
    reach parity: xterm's provider sees only a packed join state that resets
    on every escape, never the cell left of the cursor tmux combines with,
    and it cannot discard a character.
  - **UTF-8 split across writes:** xterm 6.0.0's UTF-8 decoder counts the
    bytes it held by their payload, so a continuation byte with none (0x80,
    as in ZWJ `E2 80 8D`) ends the count early and the held character is
    dropped (🧑‍💻 then takes 4 cells instead of 2). `patchUtf8Decoder`
    decodes the held bytes together with the next input (found by the T32b
    fuzz; an earlier carried-tail wrapper was replaced by this root fix, so
    resets and xterm's own 128 KiB parse split behave natively). Stock
    tripwire included.
  - What tmux combines by context stays different and is pinned by the
    parity test: a skin tone after a letter, Thai SARA AM, the Hangul
    fillers tmux discards, and a modifier separated from its base by an
    escape. The replica cannot detect a layout it shares with its viewers,
    so T37 also compares the replica's cursor with tmux's.
  - The browser moves from 2k to 10k scrollback.
  - A test fails if any emulator is built outside the profile.
- Verify:
  - Architecture: identical options across emulator kinds.
  - Real tmux: `tests/width-parity.integration.test.ts` (the table is
    current, the agreements, and the pinned divergences).
  - Unit: the provider rules and every UTF-8 split point.

**T31a: Control-mode output streaming and the ordered event log** (M)
- Acceptance:
  - The control client stops attaching with `no-output`.
  - `%output` is octal-decoded per pane into an ordered log with
    `%layout-change`.
  - Notifications, output and command replies are demultiplexed. A
    command completes on ALL its reply blocks (grouped commands),
    correlated by number and flags.
  - Transport batches are ≤ 64 KiB / ≤ 16 ms at arbitrary byte boundaries;
    parser state carries across them.
  - Bounds: an 8 MiB log queue. Overflow invalidates.
  - `%exit`, EOF and too-far-behind (explicit fault injection) invalidate,
    and pending commands settle with a rejection.
- Verify:
  - Unit: decoding, demux, grouped replies (a captured row beginning
    `%end` cannot terminate).
  - Real tmux: a 40 MB burst, bounded.
  - Fault injection: `%exit`, EOF, overflow, too-far-behind, with no
    hung commands.

**T31b: Command and output coexistence on one control client** (M)
- Acceptance: these keep working while output streams:
  - `send-keys -H` input and consume-before-delivery;
  - copy-mode cancellation;
  - `resize-window`;
  - format subscriptions;
  - native-client reconciliation and admission;
  - liveness queries.

  The raw path's connection health is the control client's; the bridge
  path keeps its bridge-liveness check until T38b.
- Verify (real tmux): concurrent output with send-keys, capture, resize
  and a native attach; a disconnect between input consumption and its
  reply gives `uncertain`. No deadlock, wrong reply, duplicate delivery or
  retry.

**T31c: Reseed core** (M)
- Acceptance:
  - An atomic `SEED_CMD` captures history plus screen plus formats in one
    grouped command.
  - **The boundary is the final correlated reply of `SEED_CMD`**: every
    log event before it has been processed or is superseded by the seed
    (skipped output never appears in a tail), and output after it follows
    the seed.
  - Retries wait 100, 250, 500 and 1000 ms between the five attempts;
    each capture takes the replica's heavy-work turn, the waits do not
    (`ReseedOptions.attempt`, T32c).
  - It rebuilds a replica from tmux with bounded retry and backoff; no
    recovery loop grows memory.
  - It is used by T32c's fallback, T34a's rebase and T35's recovery.
- Verify: real tmux with a seed during continuous numbered output (no
  gap, no duplicate), and repeated failures backing off.

**T32a: Checkpoint serializer** (M) — built (f10d3ca … bfa23ac)
- Acceptance: `lib/checkpoint.ts` writes the full state per D13, without
  SerializeAddon. The format is versioned.
- Verify:
  - Spike 3's 14 named repros, plus Codex's (pending wrap, DEC graphics
    under a saved cursor, BEL inside DCS, idle prompt).
  - The underline-style raw attribute is preserved (it is not a defect).
  - Three facts no bytes can rebuild travel beside them and are set once
    the bytes are parsed: the parser's grapheme join state (any escape
    clears it — a join between 👍 and 🏽 continues exactly), the pen's
    HAS_EXTENDED bit (a link held with it clear is latent until an SGR
    revives it), and the width the alternate screen was entered at (the
    shared tab stops' rule on leaving it).

**T32b: Full-state verifier and fuzz in CI** (M) — built (c930f34 … 8459d6b)
- Acceptance:
  - The comparison covers cells (empty versus space), attributes, wrap
    flags, cursor, modes, region, saved cursor, charsets, tabs, pending
    wrap, **CSI parameter contents, OSC/DCS payloads, the UTF-8 decoder
    state and the after-print continuation state**.
  - The fuzz uses an integer PRNG. It asserts per-branch coverage, and
    covers **every join-state category from accepted checkpoints**
    (mid-CSI included) with join offsets across deciles.
  - The reference run uses different chunking.
  - History differences are exact, with no broad allowances.
  - The CI matrix: seeds 1–200 × sizes 80×24, 120×40 and 40×10, plus 30
    seeds at 2×1, with scrollback-trimming floods, CAN/SUB-cancelled
    strings and writes past xterm's 128 KiB parse split (coverage gated on
    observed behaviour). About 90 s locally in one run (114 s with
    coverage), so CI runs it as its own four-shard job (`FUZZ_SHARD=k/4`,
    about 24 s per shard locally); the coverage job skips it.
  - Two references: the output between resizes concatenated and cut
    afresh (compared at every resize boundary and the end), and an
    incremental rechunked one compared at every join.
  - The fuzz found, and T32b fixed: the UTF-8 decoder bug above; xterm's
    start-of-print clear depending on where a write boundary splits a
    printing run (`patchChunkedPrintClear`, a write-boundary rule, not the
    join state, which xterm keeps through ignored escapes); latent pen
    links; the alternate-entry width; the inactive normal cursor at an
    alternate switch; charset names learned lazily.
- Verify: clean across the matrix; teeth (a removed branch or category
  fails).

**T32c: Replica, tail, cadence and shadow mode** (M) — built (fb3aa7f,
9fbf2fa, ca90e4b; review fixes ba0f675, 5e3b4df)
- Acceptance:
  - One replica per session through the profile (`lib/replica.ts`),
    starting at a seed; the first seed after attach goes through the same
    queue as every capture.
  - Checkpoints are tried at 1 MiB of output since the last try or 2 s
    idle. At most one heavy job (a checkpoint or a capture) runs at a time
    per process, in a queue whose waits can be cancelled. A checkpoint
    runs in resumable steps (at most about 2 ms, even at 400 × 150 with
    per-cell colours) in 3 ms slices, yielding to the event loop between
    them, so input that arrives during a checkpoint is never queued behind
    it. Measured: serialize 8 ms and verify 3 ms at 120 × 40 + 10k rows
    (from 123 and 93 ms), about 50 ms per checkpoint in all, the
    restore's parse being most of it.
  - The tail has a hard bound of 4 MiB or 4096 events. Without an accepted
    checkpoint in time, the replica rebuilds from tmux (T31c's reseed).
  - **Overload** (measured, spec D13): the log tells the replica its
    waiting output at ingress (`LogConsumer.pressure`; seeds are not
    output, an event leaves the count when it is handed over); at 4 MiB
    the replica rebuilds from tmux, skipping output unparsed until the
    seed. Rebuilds start at most once a second per session while output
    keeps coming, at once after 100 ms of quiet; seeds are parsed in
    pieces; an episode lasts until a seed is applied whole and is logged
    (`Terminal replica rebuilding/rebuilt/ended`: counts and positions,
    never contents).
  - Checkpoint data stays in chunks of about 16 KiB through the restore;
    `restoreCheckpoint` has flow control (xterm discards past 50M queued
    characters).
  - **Shadow mode:** the replica runs beside today's bridge. When both
    have been quiet for a second, size, visible text and cursor are
    compared (attributes, trailing blanks, scrollback and a pending wrap
    are documented differences, `lib/shadow.ts`); a reading during which
    either side moved is discarded. Mismatches are counted and logged by
    kind and row once per session per ten minutes, never with contents.
- Verify (built):
  - Continuous printable output, an unterminated OSC/DCS and repeated
    rejection stay bounded; a waiting checkpoint is released by pressure;
    the cadence counts from a capture's start.
  - Real tmux (`replica.integration.test.ts`): the shadow agrees across
    colours, wide characters, tabs, cursor moves and the alternate screen;
    a 10 s `yes` flood never overflows, input is acknowledged at p95
    4 ms (13–17 ms during heavy work), Ctrl-C stops it in about 150 ms,
    and the replica converges and agrees with the bridge afterwards; a
    checkpoint never holds the event loop for 8 ms (local suite; the unit
    suite asserts the yielding).
  - The keystroke-*render* echo gate needs a browser: it is R2's (T33), and
    its meaning under overload is open for Mark (spec D13, Bounded load).

**T32d: Memory budget and warning** (S) — ceilings re-baselined by Mark
2026-10-28 (decision 4, spec D13 Memory budget): retained ≤ 32 MB, peak
≤ 96 MB, warning at 640 MB, from the measured 20.8 MB terminal.
- Acceptance:
  - Measured on Bun 1.4.3 on the M4, two numbers per session at 120 ×
    10,000 rows of full scrollback, both recorded with the measurement:
    - **retained** (after `Bun.gc(true)`, raw path, no shadow): the replica
      plus a bounded tail. Ceiling **32 MB** (one profile terminal measured
      20.7–20.8 MB at 120 × 10k: cell arrays 14.5 MB plus xterm's per-line
      objects);
    - **peak** (R1 shadow mode, verifier peak, full 8 MiB log and 4 MiB
      tail queues, three concurrent joins). Ceiling **96 MB**; three
      terminals (replica, bridge Screen, verifier) and the queues alone are
      about 75 MB.
    A ceiling that cannot be met changes the architecture (smaller shadow,
    streamed joins), never the number after the fact.
  - Bounded metadata: titles ≤ 4 KiB; at most one pending clipboard offer
    per session (≤ 256 KiB decoded); link entries at most
    `LINK_ORPHAN_LIMIT` orphans beyond live ones.
  - Also measured (Codex, T32c): the log's bound counts what waits, so a
    peak holds 8 MiB waiting plus the one event being handled (a seed can
    be several MB); capture replies, seed bytes and decoded text, the
    replacement terminal of a rebuild, and checkpoint data at the widest
    supported size (400 × 150 with per-cell colours: about 84M characters)
    — with simultaneous sessions, and tmux's RSS separately.
  - A warning (server log plus a Health finding) appears when the live
    sessions' retained total passes **640 MB** (20 sessions at the ceiling).
  - Browser: R3's acceptance records Safari's per-tab memory at full
    10,000-row scrollback with WebGL (evidence, not a gate).
- Verify: the measurement test against the budget, and the warning
  triggered by fixture.
- As built (R1: 27b0379, d4eae94, 5165ec7, 97d4bd3, README e2e6dbe; four Codex rounds): spec
  D13 Memory budget § As built. `lib/memory.ts` estimate and
  `MemoryWarning`; `tests/memory.test.ts` (unit) and its local
  measurement (`TERMINAL_MEMORY_TEST=1 TERMINAL_TMUX=~/.bakin/bin/tmux`,
  one fresh process per shape via `tests/helpers/memory-measure.ts`);
  the tmux cell limit in `lib/unicode-widths.ts` with a parity case;
  the title bound in the profile; link sweeps from maintenance. The 32 MB
  figure is a reference-workload target (scope change recorded in D13).

**Checkpoint R1** (`tmd/r1`): all gates; shadow comparisons logged clean on
a live session; two Codex rounds per task; docs.

#### R2: opt-in raw path

**T33: Socket protocol v2 (join)** (M)
- Acceptance:
  - A join is the checkpoint plus the tail, in ACKed chunks, behind a
    replay barrier.
  - Input is gated until the replay completes; stale epochs are isolated.
  - Resync is throttled.
  - B2's ACK windows, epochs, heartbeats and never-replayed input stay.
  - **Replica rebuilds (T32c: overload, tail bound, width):** a rebuild is
    one broadcast rebase that supersedes replay work in flight; stale ACKs
    and digests from before it are isolated; a slow viewer's queue stays
    bounded (never one seed per rebuild queued for it, never the skipped
    output); its eviction deadline is not reset by rebuilds. A join while
    the replica rebuilds waits for the seed, bounded. Established viewers
    keep their input permission through a display rebase (no join gate,
    no reset of input sequencing), so Ctrl-C always works — pending
    Mark's decision 3 (spec D13, Bounded load).
- Verify:
  - Unit: protocol.
  - Browser: joins during output, mid-escape, in alt screen, and with
    **more than 2k retained rows**.
  - Stalled-viewer isolation.

**T34a: Width-change rebase and one ordered resize source** (M)
- Acceptance:
  - On width change, T31c reseeds at its boundary, transplanting the
    replica's full state (pen, charsets, modes, DECSC slot, tabs, region,
    alt). It is broadcast as an event.
  - Row-only changes are ordered resize events with **no rebase**.
  - **On the raw path, the event log is the only resize source** for the
    replica and viewers: raw-path viewers resize on log events, not React
    session updates. The bridge path keeps `Sessions.adoptSize()` and
    session-update resizes until T38b (Phase 8R "Two paths").
  - D3's agent reads (screen, dimensions, revision) are atomic from the
    current replica.
  - Partial-region history introduced by width rebases is documented.
  - Not an overload rebuild: T32c's rebuilds skip output and are lossy;
    a width rebase consumes the whole stream before it and transplants
    the state, so it keeps its stronger promise.
- Verify:
  - Rapid resizes with markers: transient and final states, attributes and
    modes.
  - Subsequent output after restored partial parser state, saved cursor,
    charsets and regions.
  - Split UTF-8/CSI at the resize.
  - Root cause recorded for spike 2's lost character.
  - With the setting off: the bridge path's resize and bridge-loss tests
    still pass.

**T34b: Service update — `scroll-on-clear off`** (S)
- Acceptance:
  - The generated `tmux.conf` gains the option, and the fingerprint
    detects the update.
  - Today's live config is unchanged until setup.
  - Setup refuses with live or unknown panes, and records the fingerprint
    only after verified startup with the option running.
  - The drained maintenance step is scheduled **before raw-path
    acceptance** (Mark).
  - Code-only rollback is distinguished from service rollback (which
    destroys retained panes).
- Verify: unit and real tmux for detection, refusal, verified startup, and
  the running option read back.

**T35a: Recovery banner** (S, UI)
- Acceptance:
  - After a T31c rebuild, the session shows the persistent kit Banner
    (`feedback/banner.stories.tsx — CanonicalUsage`) with D13's copy. The
    details name the cause; a reconnect doesn't clear it.
  - Overload rebuilds (T32c): disclosure pending Mark's decision 1 (spec
    D13, Bounded load); if disclosed, one persistent notice per session
    with its own copy, never cleared by a reconnect or a later checkpoint,
    and durable fidelity metadata carried into the bundle (T35b). A
    session that ends while rebuilding takes a final seed, bounded, or
    records "Output not saved"; it never saves an obsolete base as
    complete.
  - `ui:conformance --quick`.
- Verify: browser after a forced replica loss; real tmux degradations
  match D13's list.

**T35b: Final bundle persistence, ended sessions and the rollback contract** (M)
- Acceptance:
  - **When a session ends,** the server persists the bundle. The control
    client's own end (`%exit`, EOF) is **not** a session end (D4): with the
    pane alive it is a replica loss and goes to recovery. The session ends
    on:
    - terminate (`finish`) and maintenance completion: after a final drain
      to a reply boundary, before the kill;
    - the program's exit (`#{pane_dead}` / the pane-died notification,
      confirmed by a liveness query): every output event already received
      is parsed first, then saved. No reply boundary is needed, and none is
      waited for once the control connection is gone.

    The bundle holds:
    - the last accepted checkpoint plus the bounded tail;
    - dimensions;
    - the profile and format version;
    - the sequence boundary;
    - recovery metadata.

    The write is atomic and idempotent.
  - **A failed save never blocks termination.** The pane is killed (the
    operator asked for it, and a retained pane leaks), and the session
    records `outputSaved: false` durably; it shows the "Output not saved"
    state, also after a restart.
  - **Ended sessions without a bundle** load without a resync loop:
    - sessions from before the raw path show their legacy retained output;
    - a session whose bundle was never written (a crash before it) shows
      the static "Output not saved" state.
  - Until T38b the bridge keeps producing the legacy retained output beside
    the bundle, so B5 can read every ended session after a rollback.
  - The bundle is deleted with history deletion, session deletion and
    retention. A rolled-back B5 cannot delete a table it doesn't know, so on
    upgrade the server deletes bundles whose session or history no longer
    exists.
  - **Rollback after T38b is narrowed, not preserved:** sessions that ran
    after the bridge's deletion have only a bundle, so a version below T38b
    shows them as ended with no output. **T38b ships behind a drained
    maintenance step** (every session ended first, as at the cutover), so no
    session is continued across the deletion with a partial bridge-era
    prefix. This is stated in the release notes; no B5-readable copy is
    kept (no shims).
- Verify:
  - Rollback B5 → new → B5 → new: legacy output, resize/rebase events,
    interrupted save, retention, and deletion while rolled back
    (reconciled on upgrade).
  - Against the post-T38b version: rollback with sessions created and
    resized after T38b, and history/session deletion while rolled back.
  - Terminate, natural exit with final output immediately before it, a
    control-client `%exit`/EOF with the pane alive (recovery, not an end),
    a failed save (and a restart after it), and a restart before
    completion.

**T37: Digest safety net** (S–M)
- Acceptance:
  - Viewers report `{epoch, seq, digest}` at periodic barriers and quiet
    points.
  - A mismatch triggers a fresh join, with bounded retries.
  - A repeated mismatch escalates to a reseed and is logged.
  - **Replica against tmux:** viewers and the replica share one layout, so
    their digests cannot see a width they all get wrong. At quiet points
    the replica's cursor is compared with tmux's (`#{cursor_x}`,
    `#{cursor_y}` in the same grouped reply as a position barrier); a
    mismatch reseeds (T31c) and is logged with the positions, dimensions
    and a diagnostic category — never the line's contents (terminal output
    can hold credentials).
  - Positions where the replica is rebuilding (no join point) are never
    compared, and reports from before a rebuild are discarded; escalation
    is bounded. Agreement after a lossy rebuild does not certify fidelity
    to tmux (viewers and replica share the degradation).
- Verify: injected divergence self-heals; no false mismatches over the
  fuzz corpus; an injected width difference (a test-only table entry) is
  caught by the tmux comparison and reseeded.

**T38a: Opt-in raw path** (M)
- Acceptance:
  - A plugin setting (default off) makes viewers render the replica stream
    (T33 joins).
  - The bridge keeps running as the default and the rollback path.
  - The input, sizing and admission contracts are unchanged.
- Verify:
  - The full Bits suite with the setting on and off.
  - Real tmux with two viewers plus a native client, and exactly one query
    answer.
  - The browser suites on Chromium and WebKit.

**Checkpoint R2** (`tmd/r2`): all gates; two Codex rounds per task; the
H3 CSS sync and repin.

#### R3: native scrollback in the canvas, then acceptance

**T36: Native scrolling, follow and gestures** (M)
- Acceptance:
  - A vertical drag, wheel or trackpad scrolls xterm's history when there
    is history, and pans otherwise; horizontal drags pan.
  - Follow per D10 (↓ Live and focus-to-type resume, with
    `scrollToBottom()`). A hidden cursor is followed vertically only.
  - Alt screen pans.
  - **Zero program input** from any gesture, including wheel when the grid
    fits and mouse-reporting applications.
- Verify (browser, Chromium and WebKit, phone and desktop, two viewers):
  - history at its boundaries;
  - an overflowing grid with history;
  - alt screen with saved normal history;
  - selection and pinch;
  - a mouse-reporting app (no input);
  - scrolling up and down while numbered output continues;
  - the other viewer unmoved.

**T36b: Clipboard offers** (S, UI)
- Acceptance:
  - The latest OSC 52 offer (decoded by the profile, one pending per
    session, live only) shows a Copy affordance in the canvas actions;
    the clipboard is written only on that tap (user activation).
  - Offers are never replayed by a join, a reconnect or a recovery.
  - Composes a kit pattern per `bakin-ui-conformance`.
- Verify (browser, Chromium and WebKit): the copied text is exact,
  nothing writes the clipboard automatically, no replayed offers, bells
  or titles, and no query-generated program input.

**Checkpoint R3 → Mark's manual end-to-end acceptance** (raw path on):
- real Claude Code, the WebGL browser and a second browser;
- Ghostty attached;
- the iPhone from the Home Screen: scroll up and down and rejoin, the key
  bar and joystick, rotation, background and resume;
- a server restart (the recovery banner);
- the T34b maintenance step done first.

**T38b: Delete the bridge** (M, after acceptance only)
- Acceptance:
  - The raw path becomes the only path.
  - It ships behind a drained maintenance step: every session is ended
    before the upgrade (T35b's rollback contract).
  - The per-viewer PTY attach bridge, its headless Screen, the setting and
    D4's bridge text are removed, along with docs.
  - D12's full-stack merge sign-off is still separate.
- Verify: the full suite, real tmux, and the browser suites.

### Phase 9 — Bits B6: attention, activity, image paste

**T21: Attention server** (M)
- Acceptance:
  - Resolve spec open questions 1 and 2 first, by inspecting the installed
    Claude Code `--settings` merge behavior and the Codex 0.160 events.
    Record the findings.
  - `lib/attention.ts`:
    - a Claude Code adapter (generated settings JSON with hooks);
    - a Codex adapter (`-c notify=[…]`);
    - a helper script with an explicit tmux path, socket and pane;
    - `@bakin_attention` subscriptions plus the `alert-bell` hook;
    - derived activity from real pane output, not redraws.
  - Attention state appears in session payloads and socket messages.
  - `~/.claude` and `~/.codex` are untouched.
- Verify:
  - `attention.test.ts` adapter fixtures.
  - Real tmux: the helper sets state, the subscription fires, and bell is
    detected.
  - `TERMINAL_CLI_TEST=1`: an installed `claude` starts with the hooks.

**T22: Attention client** (M)
- Acceptance:
  - List and detail chips.
  - A nav-badge provider for needs-you.
  - Toast and OS notifications on needs-you, turn-finished, and bell,
    deduplicated across tabs. Bells are throttled to one per 30 s per
    session.
  - Acknowledged and resolved are separate.
  - Notifications are suppressed for the session focused on this device.
- Verify: browser tests on a two-tab dedupe and suppression;
  `ui:conformance --quick`.

**T23a: Upload storage and lifecycle** (M)
- Acceptance:
  - The upload route takes PNG, JPEG, or WebP, at most 10 MB per image and
    100 MB per session.
  - Content is magic-byte validated, and decoded pixels are capped at 40 MP
    (the header parse decides).
  - Filenames are generated server-side, and files are stored under
    `<localRoot>/uploads/<sessionId>/`.
  - Ownership: only the input owner may upload, and the generation is
    rechecked at completion.
  - Uploads are deleted with session or history deletion and at retention
    expiry (`sweepUnlocked`). Abandoned uploads are swept after 24 h.
- Verify: `uploads.test.ts` covers validation, quota, the pixel cap,
  retention, and the abandoned sweep.

**T23b: Image draft UI and readability** (M)
- Acceptance:
  - Compose draft attachments come from a native picker, paste, **and
    drag-and-drop**. Each shows a thumbnail, remove, and copy path.
  - Sending happens only through Paste or Paste+Enter, with the generation
    rechecked on delivery.
  - Paths are shell-quoted in shell sessions and literal for claude and
    codex.
  - Recorded check that Claude and Codex can read the upload directory
    under their sandboxes. If they can't, stop and bring Mark options.
- Verify: browser tests cover picker, paste, drop, and the ownership-change
  race; the manual readability result goes in evidence.

**Checkpoint B6** (`tmd/cp8`)
- All gates and the real-tmux run.
- The full `bun run ui:conformance`.
- Two Codex rounds.

### Phase 10 — Completion

**T24: Docs sweep and evidence** (S)
- Acceptance:
  - The terminal README is fully current: every retired claim is gone and
    every new feature is documented.
  - The bakin `.claude/knowledge/terminal-plugin.md` is rewritten for the
    new architecture: bridge, sizing, socket, handoff, key bar, inline scrollback,
    attention, uploads.
  - The bits `CHANGELOG.md` is updated.
  - Spec status is updated.
  - New `terminal-multi-device-evidence.md` records SHAs, versions, test
    runs, and the open-question findings.
- Verify: `bun run docs:validate`; review the README against the spec section
  by section.

**T24b: Canonical host CSS (bakin H3)** (S)
- Bits UI changes can add utility classes. SDK assembly then rejects them by
  byte equality (`scripts/build-sdk-package.ts:409`).
- Acceptance:
  - An H3 PR on top of the bakin stack: `chore(ui): canonical styles for
    terminal multi-device`.
  - It regenerates the canonical host CSS and the dependent design-system
    artifacts (census, performance) against the bits stack tip.
  - Bits `BAKIN_SDK_REF` is repinned to the H3 tip.
  - Run this after **every** UI checkpoint (cp4–cp8), amending H3 by a new
    commit each time, so B-stack CI stays green throughout.
- Verify: Bits CI green on the repinned SHA; `bun run ui:conformance --quick`
  in bakin.

**T25: Final gates** (S)
- Acceptance, also including the `publish.yml` pinned-ref change (ask-first
  CI change; approved with this plan). Run sequentially:
  - Bakin: `test`, `lint`, `typecheck`, `check:cycles`, `docs:validate`,
    `ui:conformance`.
  - Bits: `test`, `typecheck`, `lint`, `build`, `ui:conformance`, and the
    real-tmux run.
  - Both stacks are pushed and CI is green, with Bits pinned to the reviewed **H3 tip**. The release then uses the rc.45 commit, which contains H3.
  - `rg` proves the retired paths are gone: `/stream`, POST write, agent
    `resize`, the Homebrew fallback.
- Verify: CI links recorded in the evidence file.

**T26: Maintenance cutover and live checklist** (Mark + Claude, with Mark's
go-ahead at each live-box step)
1. On today's main versions, Mark ends the one live session.
2. `bakin install plugin-assets`, then confirm that `~/.bakin/bin/tmux -V`
   reports 3.7c.
3. Check out the stack tips in both main checkouts. Mark restarts 3737.
4. Run **Set up service**. Verify the LaunchAgent program, the fingerprint,
   and that the conf matches the generator.
5. Mark runs the spec checklist:
   - iPhone Safari (Home Screen and tab) and desktop at the same time;
   - Ghostty in both directions;
   - pinch, pan, and follow;
   - dictation;
   - an image into Claude Code;
   - a permission-prompt notification;
   - background/foreground and network loss;
   - keyboard and rotation;
   - the key bar: keyboard dismiss/reopen, keys and the sheet, the
     joystick (drag, hold, tap), Return hiding the keyboard, pin editing;
   - scrollback (native): scroll up and down while output grows, rejoin
     with history, ↓ Live, selection/copy, an ended session;
   - zero accidental input.
6. Results go in the evidence file. Fixes go to the owning PR, then the
   affected checks re-run.

**T27: Merge and release** (with Mark)
- Run the release sequencing above.
- Smoke-test the installed artifact.
- Update memory with outcomes and lessons.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `ws` + `node:http` upgrade misbehaves under Bun 1.4.3 | High | T5/T6 first in H2; real-socket integration with teeth. If it fails, stop and bring Mark options (Bun.serve-native upgrade for the socket paths only) before B2 |
| tmux control-mode edge cases (split frames, `%exit`, paused output, too-far-behind) | High | T10 and T31a parser/demux fixtures, fault injection, and a mandatory real-tmux run per checkpoint. The raw path is opt-in (T38a) beside the bridge until Mark's acceptance; the bridge is deleted only after it (T38b) |
| xterm hidden state diverging between replica and viewers | Med | Profile shared by every emulator (T30/T30b), full-state verifier plus fuzz in CI (T32b), digest safety net (T37) |
| Checkpoint work blocking the server's event loop | Med | One at a time, time-sliced or deferred while input is active; echo p95 and Ctrl-C gates during checkpoints (T32c) |
| `client-resized` hook format expansion unsupported | Med | Verified in T16; the 1 s `list-clients` fallback is pre-approved in the spec |
| Typed CLI args break existing messaging/projects commands | Med | B0 declares args first. T1 verifies older cores ignore the key, or reorders B0 after release |
| Custom pinch conflicts with native pan or iOS gestures | Med | Browser tests plus an early live preview at cp5. Pinch is isolated in one module |
| Claude `--settings` replaces user hooks rather than merging | Med | Checked first in T21. If it replaces them, use `--settings` only for Bakin's hooks and document it; never edit `~/.claude` |
| Codex has no approval event | Low | Spec already allows `unknown` |
| Cutover discards live work | Med | The drained-only setup refuses live panes. The procedure ends the session first, with Mark doing it |
| Bits CI SHA pin orphaned by a rebase | Med | No history rewrites after a PR opens except `gh stack rebase`. Repin after any cascade |
| Two full suites run concurrently | Med | Gates run sequentially (memory) |
| 3737 restart needed for host changes | Low | Mark's call at cp5 and at T26 |

## Parallelization

- Execution is sequential. The bakin and bits stacks share contracts
  (the socket and launch types), so H1–H2 land before B1.
- Inside a phase, test-writing can overlap implementation in the same session.
- No parallel agents on the same files. Codex reviews run after each checkpoint.

## Open questions

None blocking. The spec's open questions 1–4 are resolved inside T21 and T16,
and versions are set above.

## Evidence

Filled in during execution:
- Base SHAs
- Checkpoint tag SHAs
- CI runs
- Codex rounds
- Live checklist results

- 2026-10-25 T0 base SHAs: bakin `ad2010cf3` (origin/main, v0.0.1-rc.44 prep); bits `7fa54da` (origin/main, terminal 0.3.5). B0 is a standalone PR off bits main; B1–B6 stack on bits main.
- 2026-10-25 T5 finding: Bun resolves `ws` to its built-in (npm `ws` unloadable), whose `bufferedAmount` is unobservable/stale and whose send callbacks are immediate. The host therefore declares no `ws` runtime dependency and offers no send bound or drain; the terminal's ACK windows (T12) are the bound. Spec D8 revised.
