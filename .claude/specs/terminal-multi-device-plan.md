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
                                   B5 compose + History + links/copy + emoji width
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
| `tmd/cp7` | B5 | Mobile reading and input |
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
  - Data stays readable. Session JSON only gains fields, and the
    history-capture and upload tables are additive.
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
6. Merge the bits stack bottom-up (B1 → B6, with merge commits).
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
- terminal: B1 `0.4.0-dev.1`, then B2 `dev.2` and so on through B6, and the
  final floor commit sets `0.4.0`. `index.ts`, `package.json` and
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
      or History until "Follow cursor" is tapped.
  - The header shows the size line, "Fit to this device", and "Size frozen".
  - Panning never focuses the keyboard. Kit patterns follow
    `bakin-ui-conformance`; any deviation goes to Mark first.
- Verify:
  - Browser tests on desktop and iPhone emulation, Chromium and WebKit:
    claim/fit, pan, pinch, follow pause/resume, and no input from pans.
  - `ui:conformance --quick`.

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

**T18: Compose sheet** (M)
- Acceptance:
  - A native textarea sheet with Paste and Paste+Enter. It uses bracketed
    paste only when the app enables it, read from xterm's mode.
  - Per-session drafts are kept in guarded `localStorage`.
  - `autocomplete="off"` is set on the helper textarea.
  - Input enters through the same socket queue.
- Verify: unit tests for paste encoding; WebKit iPhone-emulation browser tests.

**T19: History view** (M)
- Acceptance:
  - A server capture route returns one immutable snapshot, at most 50k
    physical rows and 8 MiB.
  - A final capture is persisted before termination, in both `finish` and
    the maintenance completion path. It is deleted with output retention.
  - The client sheet:
    - renders SGR as escaped DOM spans in a `<pre>`, opening on the last 5k
      rows, with Load earlier;
    - offers search, a wrap toggle, Download text, Current screen, and
      Refresh;
    - pauses cursor-follow while open.
- Verify:
  - `history.test.ts`: SGR parsing and XSS fixtures.
  - Real tmux: capture, then the final capture after terminate.
  - A browser test.

**T20: Links, tap-to-copy, emoji width** (S)
- Acceptance:
  - `@xterm/addon-web-links` 0.12.0 is added.
  - When iOS rejects `writeText`, a tap-to-copy prompt appears.
  - `@xterm/addon-unicode11` 0.9.0 is active on the browser and on the
    headless `Screen`.
  - Width alignment is verified against managed tmux with an emoji fixture,
    with `codepoint-widths` overrides added only if needed.
- Verify:
  - `screen.test.ts` width fixture.
  - Real tmux: a capture comparison.
  - Browser test: link and copy.
  - The package and lockfile diff is reviewed.

**Checkpoint B5** (`tmd/cp7`): all gates, the real-tmux run, and two Codex rounds.

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
    new architecture: bridge, sizing, socket, handoff, attention, History,
    uploads.
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
| tmux control-mode edge cases (split frames, `%exit`, paused output) | High | T10 parser fixtures plus a mandatory real-tmux run per checkpoint. Output stays on the PTY redraw stream (hybrid), which limits exposure |
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
