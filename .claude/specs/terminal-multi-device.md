# Terminal: Multi-Device Sessions, Native Handoff, and Mobile Quality

Status: APPROVED by Mark on 2026-10-25, including the "Your turn"
(turn-finished) notifications. The interview was completed the same day.
Every decision below was reviewed by Claude and Codex CLI and then chosen by
Mark.
Started: 2026-10-25
Repositories: `bakin` (host + SDK + CLI) and `../bakin-bits-official`
(`plugins/terminal`).
Implementation plan: `terminal-multi-device-plan.md` (to be written next).
Predecessors: `terminal-plugin.md` (D1–D10), `terminal-mobile-rendering.md`.

## Objective

Mark uses Terminal from his iPhone over Tailscale, mostly to drive Claude Code
and Codex, and also from his desktop and Ghostty. This initiative has three parts:

1. **Multi-device sizing (must-have, ships first).** Viewing a session on
   one device must never re-lay out another device. Today every human browser
   tab counts as the input owner and resizes the single shared PTY
   (`terminal-canvas.tsx` `resizeToViewport`, `tmux resize-window`). As a
   result, a phone forces a desktop down to 49×54. Sizing becomes an explicit,
   server-side claim. Other viewers render the real grid locally, using font
   fitting, pinch zoom, and panning.
2. **Native handoff.** Start a session in Bakin and continue it in Ghostty or
   any terminal app (`bakin terminal attach`). Or start in a terminal app
   (`bakin terminal new`) and pick it up from the phone later.
3. **Mobile quality.** This part comes from research into xterm.js, tmux, and
   phone-agent tools. It covers a reconnect baseline, a compose sheet, a
   History view, links and tap-to-copy, attention plus activity status, emoji
   width, WebSocket transport, and image paste.

Priority: reduce tech debt. Single user, single machine. No backwards
compatibility, no shims, and no fallbacks for retired paths.

### Assumptions (confirmed during the interview)

1. A session has exactly **one real grid**. No tool gives each viewer of a TUI
   its own reflowed layout (`tmux` crops, and xterm reflows only the normal
   buffer). "Fitted to each device" therefore means local rendering of the one
   grid, never per-viewer PTYs.
2. tmux remains the process host: the private launchd-supervised server and
   the `terminal-<uuid>` session names stay. The plugin uses the **managed**
   tmux 3.7c from `requires.bins` only.
3. xterm.js stays pinned at **6.0.0 stable** (6.1 exists only as betas; #6108
   is open). Touch scrolling of history does not depend on xterm. It lives in
   the History view.
4. Ghostty 1.3.x has no tmux control mode (`-CC`). Native handoff is a plain
   `tmux attach` client. Moving a process from another tmux server into Bakin
   is impossible on macOS, so it is out of scope.

## Decisions

### D1 Scope
The work is one initiative in three workstreams. Sizing ships first. Every
research item in D9 was selected by Mark.

### D2 Sizing authority is an explicit claim
- Exactly one **sizing authority** exists per session. These count as claims:
  "Fit to this device" in a browser, creating a session (the creating viewer
  holds authority), and `bakin terminal attach` (the native client holds it).
- The authority keeps following its own pane or window size. Browser changes
  are debounced: rows apply immediately, columns after 100 ms, and an
  unchanged size is never re-sent. It keeps authority until another claim.
- Typing, viewing, mounting, rotating, or showing the keyboard on another
  device never resizes anything. When the authority disconnects, the last
  size stays frozen.
- Authority is separate from input ownership. A human may claim size while
  an agent drives input. Take and Return control never change size.
- There are two operations and two counters, both independent of the
  ownership `generation`:
  - **claim** (any human viewer, or an admitted native client) sets
    `sizeAuthority = { viewer, kind: 'browser'|'native' }` and bumps
    **`sizeEpoch`**.
  - **resize** is accepted only from the current authority with the current
    `sizeEpoch`. Anything else is rejected as stale (409). Each applied
    dimension change bumps **`sizeRevision`**, which is what agents see.
- Resize order and failure handling:
  1. tmux `resize-window` runs first. It is the source of truth.
  2. Then the bridge PTY, the headless `Screen`, and the stored `cols`/`rows`
     are updated.
  3. The whole sequence runs inside the session's command queue, so input
     from every viewer waits until it settles. If tmux refuses, the actual
     `#{window_width}×#{window_height}` is read back and applied to the
     other three.
  4. If they still cannot be made to agree (tmux unreachable, the record
     unwritable), the attachment is dropped: input is refused before its
     sequence is consumed, viewers resync, and every fresh attachment adopts
     tmux's actual window first. (Built 2026-10-25 in place of a persisted
     `sizeState: 'reconciling'`: the queue already gives the pause.)
- Policy lives on the server. The session window is `window-size manual`,
  and only the server calls `resize-window`, because tmux's `latest`,
  `largest`, and `smallest` cannot express explicit authority. The bridge and
  control clients attach `ignore-size`.
- **How a native authority's size is observed:**
  - A `client-resized` hook (also fired on `client-attached`) sets the
    session user option `@bakin_client_size` to
    `#{client_pid} #{client_width}x#{client_height}`.
  - The control connection subscribes to it (`refresh-client -B`).
  - When the pid is the authoritative native client, the server applies the
    size as a resize.
  - `client-detached` with that pid freezes the size.
  - The build verifies the hook's format expansion on tmux 3.7c before
    relying on it; if it fails, the fallback is a 1 s `list-clients` poll
    while a native authority exists.
- Validation floor: 40×10. A pane smaller than the floor clamps the grid to
  40×10 and pans locally. This includes an authoritative phone with its
  keyboard open.

### D3 Agents and size
- The agent `resize` operation is **removed** from `bakin_exec_terminal_session`.
- Agent-created sessions start at the plugin setting **`defaultSize`**
  (default 200×60).
- The session menu offers **"Use this size as the default for new sessions"**,
  which captures the current grid.
- Human-created sessions start at the creating pane's size. That includes
  sessions created from a phone.
- Creation resolves the dimensions **before** spawning, so the program starts
  at the intended width (`sessions.ts` currently hard-codes 100×30).
- Agent `screen` responses include `cols`, `rows`, and `sizeRevision`, all
  captured together with the text. The tool description tells agents to
  re-read after a revision change before doing anything that depends on layout.

### D4 Bridge: hybrid
- **Output:** keep the PTY `attach-session` client per session. It is now
  attached with `-f ignore-size`, and its PTY is sized to the window. Its
  redraw stream stays the output source, because it provides redraw-based
  recovery and makes tmux copy-mode visible.
- **Input and commands:** add one persistent **control-mode client** (`tmux -C`)
  per session. It carries
  - `send-keys -H` (hex),
  - `resize-window`,
  - queries (`list-clients`, `#{pane_in_mode}`, `#{pane_dead}`),
  - format subscriptions (`refresh-client -B`),
  - hooks.

  Each command awaits its correlated `%end`/`%error`.
- `Sessions.run()` serialization stays. So do consume-before-delivery and
  never-auto-retry.
- Browser input arriving while the pane is in copy-mode **cancels copy-mode
  first**, then delivers.
- Browser input bypasses tmux key tables, so native prefix bindings (D7) never
  fire from the browser.
- `%exit` means the control client ended, not the program. Process liveness
  uses `#{pane_dead}`.
- Output is pushed to subscribers as it arrives. The 100 ms poll is retired.

### D5 Native attach mechanism (host)
- Plugin `cliCommands` gain an **interactive launch mode** on the existing
  `apiRoute` dispatch:
  `dispatch: { type: 'apiRoute', method, path, launch: { bin: 'tmux' } }`.
- The route prepares the session and returns typed launch arguments. The
  executable is taken **only** from the manifest's `launch.bin`, which must name
  one of that plugin's `requires.bins`. The core CLI resolves it in
  `~/.bakin/bin` and spawns it without a shell. The child inherits stdio and
  the environment (including `TERMINFO`; never `env -i`), and its exit code
  propagates.
- The CLI requires a TTY and a reachable local server, both checked before
  anything is created. `launch.refuseEnv` names the binary's own nesting
  marker (`TMUX`); the CLI refuses when it is set, also before anything is
  created (the route cannot see the caller's environment).
- The route receives `{ params, caller: { cwd, cols, rows } }` and answers
  `{ args, confirm?, recovery? }`. `recovery` is for a route that already did
  work: the CLI adds it to a spawn or confirm failure and prints it on a
  non-zero exit. (Added during B4.)
- Principal: operator provenance (`--as human`, `src/cli/identity.ts`).
  Agent contexts are refused in the CLI **and** in the route.
- Not a sandbox: `requires.bins` is trusted installed-plugin execution, so
  the contract stays deliberately small.
- Cleanups in the same change:
  - Dispatch uses the contributing plugin's id, not the typed command word
    (`plugin-dispatch.ts:125`).
  - cliCommand arguments get declared types. Unknown flags and extra
    positionals are rejected, and `"true"` and comma-joined strings are no
    longer coerced.

### D6 CLI surface
- `bakin terminal new [--title <t>] [--program shell|claude|codex] [--worktree] [--agent <id>]`
  - The working directory is the current directory.
  - The program defaults to `shell`, with `checkout: 'existing'` passed
    explicitly.
  - `--worktree` creates an isolated worktree for **every** program, shells
    included. Today `Sessions.create` silently skips isolation for shells.
  - The title defaults to the basename of the current directory.
  - `--agent` assigns a Bakin agent. It does not select the program and does
    not transfer input ownership.
  - The command creates the session through `Sessions.create`, claims size,
    and attaches.
- `bakin terminal attach <ref>` claims size.
  - `<ref>` is a full id, a unique id prefix of at least 8 characters, or an
    exact title.
  - An exact full id wins. Otherwise, if prefix and title matching is
    ambiguous, the command lists the candidates and exits non-zero.
- `bakin terminal ls` lists sessions with these columns:
  - short id
  - title
  - program
  - owner
  - state
  - size
  - cwd or worktree
  - count of native clients (Bakin's bridge and control clients are excluded)
- Both verbs require a TTY and refuse when `$TMUX` is set.
- `new` starts the program at the caller's terminal size.
- If `new` creates the session but attaching fails, the session is kept and
  the command prints its id and the attach command, then exits non-zero. It
  never retries. (Before the launch the route says so; after it, the CLI
  prints the launch answer's `recovery` line.)
- `ls` answers a preformatted table, which the host prints verbatim.
- No `detach`, `kill`, or `--detach` verbs.
- Web UI:
  - The Details popover shows the short id and the attach command
    `bakin terminal attach <full-id> --as human` with the kit `CopyButton`
    (the kit's one copy affordance for CLI commands), rather than a session
    menu item.
  - The list and detail views show an "Open in a terminal app" indicator
    while native clients are attached.

### D7 Native tmux experience (generated `tmux.conf`)
- The prefix is `C-b`, with a **minimal prefix table**:
  - `d` detaches.
  - `C-b` passes Ctrl-B through (send-prefix).
  - `[` opens copy-mode.
  - `]` pastes.
  - `?` shows help.

  The default table is cleared, so splits, windows, session switching,
  renaming, and the command prompt are unavailable. One pane per session
  remains an invariant.
- Options:
  - `history-limit 50000`
  - `extended-keys on`
  - `terminal-features` adds `xterm-ghostty:hyperlinks:extkeys`
  - `set-clipboard on`
  - `allow-passthrough off`
  - `status off`
  - `set-titles on` with `set-titles-string 'Bakin · #{@bakin_title}'`.
    `@bakin_title` is set on creation and on recovery.
- `mouse` stays `off`. History moved to D9's History view.
- On attach, tmux shows `Detach: Ctrl-b d · Scrollback: Ctrl-b [ · Closing the window also detaches`
  in its status line for 5 s (a `display-message` chained after the attach),
  where it is visible; text the CLI printed would sit behind tmux's screen.
- Native attach to an **agent-owned** session is refused ("Take control
  first"). There is no read-only fallback, because read-only clients cannot
  enter copy-mode.
- **Attach admission is a reservation handshake**, serialized with ownership
  transitions:
  1. The launch route mints a single-use reservation bound to session +
     `generation`, with a 15 s TTL, and returns the attach arguments.
  2. The CLI spawns tmux and posts the child pid back to confirm.
  3. The server hears every client attach, resize and leave on the control
     connection (`%client-session-changed`, `%client-detached`, and a
     subscription to `@bakin_client`, which a `client-resized` hook sets),
     then reads `list-clients`. A client that matches no reservation for
     the current `generation` is detached immediately. This also catches a
     hand-typed raw `tmux attach` and any foreign `tmux -C` client.
     Bakin's bridge and control clients are recognised by process.
  4. The app attaches read-only (`-f read-only`) and becomes writable only
     once its size claim and resize succeed; then the confirm resolves.
     If they cannot be reconciled the admission is revoked (detached,
     confirm refused). While a confirm is pending, other terminal clients
     are held read-only; a reservation lapses on its own 15 s timer.
- Take, Return, and assign invalidate outstanding reservations, refusing a
  waiting confirm.
- Return control detaches every non-Bakin client (admitted or held) and
  waits for it before granting agent ownership. Bridge and control clients
  are left in place.
- Admission state is in memory: a Bakin restart detaches attached terminal
  apps.

### D8 Transport: WebSocket (host capability + terminal)
**Host side:**
- New plugin capability **socket routes**: manifest `contributes.socketRoutes`
  plus SDK types.
- It uses the `node:http` `upgrade` event. `Bun.serve` is not used.
  - `ws` resolves to **Bun's built-in implementation**; Bun refuses every npm
    `ws` subpath. So there is no `ws` runtime dependency, only `@types/ws`.
    This revises the original "host-owned `ws` dependency", which was found
    to be unloadable during T5.
- Origin is validated against the server's own host before the upgrade, and
  the route's `admit(request)` may then refuse.
- Messages are typed.
- **No host send bound or drain.** This revises "bounded sends with drain";
  it was measured during T5 on Bun 1.4.3 against a client that stops
  reading:
  - `bufferedAmount` reads 0 for ~18 MiB, then grows;
  - it stays stale after the client has read everything;
  - send callbacks fire immediately.

  No reliable backlog is observable, so the terminal's application-level
  ACK windows (below) are the bound.
- Sockets close when the plugin is disabled, reloaded (hot reload), or shut
  down.
- Terminal client identity is **not** part of the host contract.

**Terminal side:** one socket per viewer.
- Output is sent as binary frames. Control messages (snapshot, session, size
  revision, attention) are JSON.
- **Input** arrives as JSON envelopes `{generation, viewerSeq, data}`.
  `viewerSeq` is monotonic per connection epoch. The server assigns the
  session-global `inputSequence` inside `Sessions.run()`, so several writable
  human viewers never collide.
  - Agents keep their explicit `sequence` on the exec tool.
  - Every envelope gets a correlated result: `accepted`, `rejected` (definite:
    nothing delivered) or `uncertain` (consumed, delivery unknown).
  - On `rejected`, the client drops its queued input for that generation and
    shows "Input not sent".
  - On `uncertain`, it shows "May have been delivered". Input is never
    re-sent.
- **Input coalescing:** while an envelope is in flight, keystrokes batch into
  the next envelope. A batch flushes on the in-flight result, after 8 ms, or
  at 4 KiB, whichever comes first. Order is preserved, and a batch never
  spans a generation change.
- The viewer identity is bound by a validated first message, since a
  browser WebSocket cannot set `x-bakin-terminal-client`.
- **Flow control:** the client ACKs after xterm's write callback, every
  16 KiB or 50 ms, whichever comes first.
  - Above 256 KiB unacked, the server pauses that viewer's feed.
  - Above 2 MiB, or after 10 s paused, the viewer is evicted with a
    `resync` close and re-snapshots on reconnect.
  - Ingestion and other viewers are never blocked.
  - The per-viewer send queue is bounded at 2 MiB.
- **Heartbeat:** a ping every 15 s; 30 s of silence closes the connection.
- Reconnect:
  - It mints a new connection epoch, and the old epoch is invalidated.
  - The server sends an atomic sync bundle: snapshot plus output cursor,
    ownership `generation`, consumed input sequence, dimensions, and size
    revision.
  - Input is enabled only after sync. Input is never replayed, and sizing
    authority is never reclaimed automatically.
- Heartbeats detect half-open connections.
- The SSE `/stream` route and browser POST `write`/`resize`/`interrupt` are
  **deleted**. No fallback remains.

### D9 Mobile quality (all selected)
1. **Reconnect baseline.**
   - When the page becomes visible or comes to the foreground: recover the
     socket (D8), take a fresh sync, revalidate ownership and size, and repaint.
   - WebGL is recreated only after a context loss (the existing fallback stays).
2. **Compose sheet.**
   - A native `<textarea>` for dictation, IME, and paste.
   - Two actions: **Paste** and **Paste + Enter**.
   - Bracketed paste is honored only when the app enabled it.
   - Each session keeps its own draft.
   - `autocomplete="off"` is set on xterm's helper textarea.
3. **History view ("Terminal scrollback").**
   - Opened by a header button on any device. It is viewer-local and never
     moves anyone else's screen.
   - Each open or Refresh takes one immutable capture, `capture-pane -p -e -J`,
     bounded at 50,000 physical rows and 8 MiB.
   - It shows the last 5k rows first. **Load earlier** reveals more of the
     same snapshot, up to the 50k history limit.
   - Rendering: escaped text, with only recognized SGR rendered as DOM spans
     in a `<pre>`. Content is never treated as HTML.
   - Native selection, copy, and find work. An in-sheet search covers the
     captured text.
   - Also: a wrap toggle, **Download text**, and a **Current screen** option
     for full-screen apps.
   - A final bounded capture is persisted **before termination**, including on
     the maintenance completion path. It is deleted with output retention.
4. **Links and tap-to-copy.**
   - Add the `@xterm/addon-web-links` addon.
   - When iOS blocks a clipboard write, a tap-to-copy prompt appears instead.
   - OSC 52 is not included until its delivery through the bridge is verified.
5. **Attention and activity.**
   - **Semantic state:** a pane user option `@bakin_attention` with values
     `needs-you | turn-finished | working | unknown`, set by per-program
     adapters.
   - **Claude Code adapter:** Bakin launches Claude Code with
     `--settings <plugin-generated json>`. The hooks map:
     - permission and question prompts → `needs-you`;
     - `idle_prompt` is **not** treated as needs-you;
     - `Stop` → `turn-finished`;
     - resume, cancel, and exit clear the state.
   - **Codex adapter:** `notify` on agent-turn-complete → `turn-finished`.
     Approval stays `unknown` until a verified structured hook exists.
   - **Shell:** no semantic state.
   - The helper receives an explicit managed tmux path, socket, and pane
     target, because `env -i` strips `TMUX`.
   - Mark's `~/.claude` and `~/.codex` are never touched.
   - **Derived activity:** active, quiet, or exited, computed from real pane
     output (bridge redraws after a resize or reconnect do not count).
   - **Observation:** control-connection format subscriptions (at most one per
     second and lossy, so the state is re-read on connect) plus the
     `alert-bell` hook.
   - **Delivery:**
     - list and detail chips;
     - a host nav badge through the `nav-badge-providers` slot;
     - a toast and an OS notification on transition to `needs-you` or
       `turn-finished` ("Your turn"), and on bell. Notifications are
       deduplicated across tabs, and bells are throttled to one per session
       per 30 s;
     - acknowledged and resolved are separate states;
     - suppression is session-specific: the host helper only checks
       document focus, so the terminal adds its own per-session check.
   - Agent-owned sessions are included.
   - **Out of scope:** Home Screen Web Push for a backgrounded iPhone.
6. **Emoji width.**
   - Apply the `@xterm/addon-unicode11` provider to the browser terminal
     **and** the headless `Screen`.
   - Verify alignment against managed tmux, using its `codepoint-widths`
     overrides if needed.
7. **WebSocket transport.** See D8.
8. **Image paste.**
   - Sources: photo/file picker, paste, and drop into the compose draft. The
     draft shows a thumbnail with remove and copy-path controls.
   - Formats and limits: PNG, JPEG, and WebP; at most 10 MB per image;
     100 MB per session; 40 megapixels decoded. Content is validated and the
     server assigns filenames.
   - Images are stored plugin-private:
     `<localRoot>/uploads/<sessionId>/<uuid>.<ext>`.
   - The image is sent through Paste or Paste + Enter. The ownership
     generation is rechecked when the upload completes and again on delivery.
   - The path is shell-quoted for shell sessions and literal for claude and
     codex.
   - Images are deleted with session or history deletion, or at retention
     expiry. Abandoned uploads are swept.
   - Build-time check: Claude and Codex can read the upload directory under
     their sandboxes.
   - HEIC is deferred.

Cut: the ghostty-web renderer, the image (sixel) addon, ligatures,
unicode-graphemes, and the tmux mouse-on touch path.

### D10 Viewer rendering and zoom
- A non-authoritative viewer renders the real grid. Its font is fitted to the
  **width**, clamped to an adjustable per-device minimum (10px on touch).
- Overflow pans natively on both axes (`overflow:auto`). No CSS transforms
  are used (xterm #6023).
- **Custom pinch zoom** (Mark's choice) adjusts the local xterm font size.
  - Each device remembers its own size in `localStorage`, with try/catch
    around every read and write.
  - Pinch must coexist with native pan, which requires explicit `touch-action`
    handling.
  - "Reset view" restores fit-to-width.
- **Cursor-follow:**
  - It reveals the cursor after each completed render batch.
  - A manual pan, an active selection, or an open History sheet pauses it
    **until the user taps "Follow cursor"**.
- **Header:**
  - Normally: `200×60 · Sized by <this device | desktop | phone | terminal app> · Fit to this device`.
  - `Size frozen` once the authority has disconnected.
  - "Agent" never appears as a size authority.
- Panning never focuses the keyboard or sends input.
- `terminal-canvas.tsx` replaces its `writable` proxy with explicit
  sizing-authority state.

### D11 Rollout: maintenance cutover, managed tmux only
- tmux resolution is **managed bin only**. The Homebrew/PATH fallback in
  `TerminalService.tmux` and the README's "manual fallback" are removed.
- `tmux.conf` is generated from code and written only by setup. The running
  daemon is never patched piecemeal.
- **Service fingerprint:** the pinned asset sha256 and version, the generated
  config, and the canonical plist (excluding incidental environment).
  - It is recorded only **after** a verified startup. Missing evidence means
    "setup required".
  - The early return at `service.ts:77`, which matches on path only, is fixed.
- Setup is serialized against creation, attach, and control connections. It
  inspects every pane, names the blocking sessions, and refuses when pane
  state is unknown.
- A new Health incident, "Terminal service update available", is offered
  with the existing drained Set up service repair as a declared repair action.
- **Live-box procedure:**
  1. End the one live session on today's version.
  2. Run `bakin install plugin-assets`.
  3. Deploy the coordinated Bakin + plugin branches.
  4. Run **Set up service**.
  5. Verify the daemon's identity and config.
  6. Smoke-test in the browser and in Ghostty.

  Restarting tmux discards retained dead panes and their in-memory history.
  Output already saved in SQLite remains.

### D12 Verification and delivery gating
See Testing Strategy and Success Criteria.
- Nothing merges before Mark signs off the live checklist on the full stack.
- Order:
  1. Bakin PRs
  2. Bakin release
  3. Bits repin and floor bump
  4. Bits PRs
  5. terminal release
  6. smoke test of the installed artifacts

## Tech Stack

- **Runtime:** Bun 1.4.3, TypeScript strict, Zod 4.6 at every boundary.
- **Host (`bakin`):** `node:http` server (`server.ts`), with the request router
  in `src/core/server/request-handler.ts`. New dependency: `ws` (pinned, host
  only).
- **CLI:** `src/cli/commands/plugin-dispatch.ts` and `src/cli/identity.ts`.
- **Plugin dependencies:**
  - `@xterm/xterm` 6.0.0
  - `@xterm/headless` 6.0.0
  - `@xterm/addon-fit` 0.11.0
  - `@xterm/addon-webgl` 0.19.0
  - `@xterm/addon-serialize` 0.14.0
  - **new:** `@xterm/addon-unicode11` 0.9.0 and `@xterm/addon-web-links` 0.12.0
- **Process host:** managed tmux 3.7c in `~/.bakin/bin`, run under a launchd
  LaunchAgent.
- **UI:** the SDK focused entrypoints (`/patterns`, `/layout`, `/ui`,
  `/navigation`). Public Storybook is the contract, and every UI change
  follows `.claude/skills/bakin-ui-conformance/SKILL.md`.

## Commands

**Bakin repo (`~/go/src/github.com/markhayden/bakin`):**
```sh
bun run typecheck
bun run lint                      # zero-warning
bun run test                      # full suite (never concurrently with another full suite)
bun test tests/<path>.test.ts --isolate
bun run check:cycles
bun run ui:conformance --quick    # UI changes; full mode before merge
bun run docs:validate
```

**Bits repo (`~/go/src/github.com/markhayden/bakin-bits-official`):**
```sh
bun install                       # after test-sdk changes
bun run test plugins/terminal/tests
bun run typecheck
bun run lint
BAKIN_SDK_DIR=<assembled SDK> bun run build
bun run ui:conformance
TERMINAL_PROCESS_TEST=1 bun test plugins/terminal/tests/processes.integration.test.ts --isolate   # MANDATORY before merge
bun plugins/terminal/tests/dev-server.ts          # disposable preview
TERMINAL_PREVIEW_URL=<url> TERMINAL_BROWSER=webkit bun test plugins/terminal/tests/*.browser.test.ts --isolate
```

**Codex review:**
```sh
codex exec -s read-only -C ~/go/src/github.com/markhayden
```
At least two rounds per PR.

## Project Structure

**Bakin (host):**
```
src/cli/commands/plugin-dispatch.ts        → launch mode, typed args, plugin-id fix
src/cli/launch.ts (new)                    → TTY check, bin resolution, spawn w/ inherited stdio
src/core/server/request-handler.ts         → upgrade routing for plugin socket routes
src/core/plugins/socket-routes.ts (new)    → admission, bounded send, lifecycle cleanup
packages/sdk/src/types/…                   → SocketRoute + cliCommand launch/arg types
tests/cli/…, tests/integration/sockets/…   → contract + Bun 1.4.3 integration tests
docs/src/content/docs/extending/plugins/…  → socket routes + interactive CLI commands
.claude/knowledge/plugin-system.md, terminal-plugin.md
```

**Bits (plugin, `plugins/terminal/`):**
```
lib/contracts.ts        → Session (+ sizeAuthority, sizeEpoch, sizeRevision, sizeState, attention), settings (+ defaultSize)
lib/sizing.ts (new)     → pure claim/revision/floor policy
lib/control.ts (new)    → tmux control-mode client (%begin/%end/%error, subscriptions)
lib/processes.ts        → bridge (ignore-size) + control + native client tracking
lib/service.ts          → managed-only tmux, generated conf, fingerprint, setup exclusion
lib/sessions.ts         → claims, create dims, final history capture, native admission
lib/socket.ts (new)     → per-viewer socket protocol, flow control, epochs
lib/history.ts (new)    → capture + SGR→escaped spans
lib/attention.ts (new)  → adapters, hooks, derived activity
lib/uploads.ts (new)    → image validation, storage, retention
lib/cli.ts (new)        → launch-route handlers for new/attach/ls
components/…            → canvas (authority/pinch/pan/follow), compose sheet, history sheet, attention chips
tests/…                 → unit, process-integration, browser
README.md
```
Retired: `lib/http.ts`'s `stream`, plus the browser write/resize command paths.

## Code Style

Match the plugin's existing dense, functional style: small pure policy
modules, `TerminalError(message, status)` for every failure, and Zod schemas
next to their contracts. A comment appears only when the code can't explain
itself. Example of the intended shape for the sizing policy:

```ts
export interface SizeRequest { viewer: string; epoch: number; cols: number; rows: number }

/** Pure: only the current authority at the current epoch may resize. */
export function nextSize(session: Session, request: SizeRequest, floor = FLOOR): Pick<Session, 'cols' | 'rows' | 'sizeRevision'> {
  if (request.viewer !== session.sizeAuthority?.viewer || request.epoch !== session.sizeEpoch) {
    throw new TerminalError('Another device is sizing this session', 409)
  }
  const cols = Math.max(floor.cols, request.cols)
  const rows = Math.max(floor.rows, request.rows)
  const changed = cols !== session.cols || rows !== session.rows
  return { cols, rows, sizeRevision: session.sizeRevision + (changed ? 1 : 0) }
}
```

Bakin conventions also apply:
- kebab-case files, `const` over `let`;
- no empty catches;
- `createLogger` in host code;
- no `any` across module boundaries;
- import order per `CLAUDE.md`;
- conventional commits with scope (`feat(terminal): …`, `feat(cli): …`, `feat(plugins): …`).

## Testing Strategy

- **Unit (bun:test):**
  - sizing policy: claims, revisions, floor, stale rejection;
  - control-mode parser and `send-keys -H` encoding;
  - socket protocol: epochs, sync bundle, ACK windows, laggard eviction, no
    replay;
  - CLI ref resolution and typed args;
  - attention adapters (fixtures);
  - History capture and SGR rendering, with XSS fixtures;
  - image validation;
  - fingerprint;
  - the tmux.conf generator.
- **Host integration (Bun 1.4.3, real sockets via `Bun.fetch`/`ws`):**
  - upgrade admission and rejection (Origin, auth);
  - binary frames;
  - backpressure and drain;
  - cleanup on plugin reload and shutdown;
  - CLI launch mode under a PTY harness (stdio inheritance, exit codes, no TTY
    → refused, agent context → refused).
- **Real-tmux process integration (MANDATORY pre-merge,
  `TERMINAL_PROCESS_TEST=1`, managed tmux):**
  - a multi-viewer claim flow;
  - native attach and detach;
  - attach racing Return control;
  - Return control detaching native clients;
  - copy-mode cancel on input;
  - final history capture;
  - fingerprint recorded only after verified startup;
  - setup refusing live panes.
- **Race and failure:**
  - a stale resize after a newer claim;
  - a partial resize failure;
  - the control connection dropping after input is consumed but before its
    result;
  - reconnect during output or resize;
  - each asserting zero input replay and consistent dimensions across all
    four representations.
- **Bounded load:** run `yes` for 30 s while one viewer stops ACKing.
  - Plugin heap growth stays under 32 MiB.
  - The stalled viewer is evicted within 10 s.
  - A healthy loopback viewer's keystroke-echo p95 stays under 50 ms.
  - Ctrl-C stops the flood within 1 s.
  - The evicted viewer re-snapshots to the same screen as a healthy viewer.
- **Resize failure:** inject a failure at each of the four steps. The session
  ends with all four representations equal to tmux's actual window, and input
  paused until reconciliation finishes.
- **Native admission:**
  - A raw `tmux attach` without a reservation is detached.
  - A reservation invalidated by Return control is refused.
  - An expired reservation is refused.
- **Browser (Playwright Chromium + WebKit, desktop + iPhone emulation, against
  the disposable preview):**
  - pan, pinch, and follow;
  - the compose sheet;
  - History;
  - links and tap-to-copy;
  - attention chips;
  - image draft;
  - reconnect.
- **UI conformance:** `--quick` per UI change, full mode before merge.
- **Manual (Mark, live box after the cutover, both branches in the main
  checkouts):** this checklist covers parts the automated tests can't:
  - iPhone Safari (Home Screen + tab) and the desktop at the same time;
  - claim and fit on both;
  - Ghostty in both directions;
  - pinch, pan, and follow;
  - dictation through compose;
  - image paste into Claude Code;
  - a Claude permission prompt raising the notification;
  - background/foreground and network loss;
  - keyboard and rotation;
  - zero accidental input.

  Record the SHAs, Bun and tmux versions, and the results.
- Retired paths are verified gone: the `/stream` route, browser POST writes,
  and the agent `resize` operation.

## Boundaries

**Always:**
- Use isolated `BAKIN_HOME`, `PI_HOME`, and `OPENCLAW_HOME`, and private
  tmux/launchd jobs, in tests and previews.
- Follow the test-mock rules in `CLAUDE.md`.
- Run lint, typecheck, and tests before every commit. Run full suites
  sequentially.
- Use `bakin-ui-conformance` for UI work.
- Bump the terminal manifest and `package.json` versions together.
- Update the README, `.claude/knowledge/terminal-plugin.md`,
  `.claude/knowledge/plugin-system.md`, and the docs site in the same PR as
  the behavior change.
- Do ≥2 Codex review rounds per PR.

**Ask first:**
- Any deviation from a Storybook pattern.
- Adding dependencies beyond `ws`, `@xterm/addon-unicode11`, and
  `@xterm/addon-web-links`.
- Touching the live 3737 server, the live tmux service, or the LaunchAgent
  outside the documented cutover.
- Any merge or release.
- Changing CI workflows.

**Never:**
- Attach to, or send keys into, Mark's live sessions from tests or agents.
- Run a compiled Bakin binary against a throwaway home (it hijacks antfly).
- `env -i` the native attach client.
- Use `attach -d`.
- Accept an `agentId` from a body or query as identity.
- Log terminal output or credentials.
- Keep compatibility shims or fallbacks for retired paths.
- Commit `generated-version.ts` after a build.

## Success Criteria

1. With desktop and iPhone open on one session, neither re-lays out the other
   unless it taps "Fit to this device". The non-authority shows the real grid,
   with fit-to-width, pinch, pan, and follow, and a correct header.
2. Agent sessions start at `defaultSize` (200×60). Agents have no resize
   operation. Their screen reads carry `cols`, `rows`, and `sizeRevision`.
3. `bakin terminal new` in Ghostty creates a Bakin session that appears in
   the web UI immediately and can be driven from the phone. `bakin terminal
   attach <ref>` resumes a web-started session in Ghostty. `Ctrl-b d` detaches.
   Splits and windows are unavailable.
4. Return control detaches native clients before the agent gets input.
   Native attach to an agent-owned session is refused.
5. The terminal runs over one WebSocket per viewer. The SSE `/stream` and the
   POST write paths are gone. Keystroke echo involves no polling. A stalled
   viewer never affects the others.
6. The compose sheet, the History view (including on ended sessions), links
   and tap-to-copy, attention plus activity status with notifications, emoji
   alignment, and image paste all pass their automated tests and Mark's
   iPhone checklist.
7. The live box runs managed tmux with a verified fingerprint. Health raises
   "Terminal service update available" on any drift.
8. Both repos' CI is green (Bits pinned to a reviewed Bakin candidate SHA).
   The README, knowledge docs, and docs site are updated. The installed
   release artifacts pass the smoke test.

## Open Questions

1. The Codex CLI 0.160 approval hook: is there a structured approval event?
   If not, approval stays `unknown`. The build verifies this against the
   installed Codex.
2. Whether Claude Code's `--settings` merges hooks with the user's settings,
   or replaces them, on the installed version. The build verifies this before
   relying on it.
3. Exact `xterm-ghostty` behavior for extended keys and hyperlinks through
   tmux 3.7c, verified during the live checklist.
4. Version numbers: terminal **0.4.0** (breaking: transport and the removed
   resize operation), plus the next Bakin rc. Confirmed in the plan.
