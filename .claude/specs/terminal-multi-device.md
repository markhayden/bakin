# Terminal: Multi-Device Sessions, Native Handoff, and Mobile Quality

Status: APPROVED by Mark on 2026-10-25, including the "Your turn"
(turn-finished) notifications. The interview was completed the same day.
Every decision below was reviewed by Claude and Codex CLI and then chosen by
Mark.
Started: 2026-10-25
Repositories: `bakin` (host + SDK + CLI) and `../bakin-bits-official`
(`plugins/terminal`).
Implementation plan: `terminal-multi-device-plan.md`.
Amended 2026-10-27 after the first live test (Mark): D9 item 3 (inline
scrollback replaces the History sheet), D9 item 9 (key bar), D10 controls.
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
   phone-agent tools. It covers a reconnect baseline, a key bar, a compose sheet,
   native scrollback, links and tap-to-copy, attention plus activity status, emoji
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
   is open). Touch scrolling of history does not depend on xterm. It is the
   native scrollback (D9 item 3, D13).
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
     are updated. On D13's raw path the replica and its viewers take the
     size from the ordered event log instead; until the bridge is deleted
     (T38b) the bridge path keeps updating its PTY and `Screen` this way.
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

### D4 Bridge: hybrid (output superseded by D13, 2026-10-28)
> **Amended 2026-10-28:** once D13's cutover gate passes, output comes from
> the same control client (`%output`), and the per-viewer PTY attach
> bridge is removed. Until then, the bridge below stays the live path and
> D13's replica runs in shadow beside it.

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
- `mouse` stays `off`. History is native xterm scrollback (D9 item 3, D13).
- `scroll-on-clear off` (D13).
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
- Reconnect (after D13's cutover, the sync bundle's snapshot is D13's
  **join**: the latest proven checkpoint plus the bounded raw tail since
  it, in ACKed chunks behind a replay barrier):
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
   - **As built (T18, 2026-10-28):** a viewer cannot tell whether the app
     enabled bracketed paste — tmux turns it on for every client it
     attaches, so a viewer's xterm always reports it on the bridge path,
     and browser input reached the pane past tmux's paste handling. Every
     browser paste (xterm's and compose) is therefore explicit input
     (`paste`, and `enter` for Paste + Enter: one envelope, Return only
     once the paste went), delivered by `paste-buffer -p -r -S`: tmux
     brackets it only if the program enabled it, byte for byte. The draft
     clears only when the server accepts that paste.
3. **Scrollback: native, through the raw-output transport (amended
   2026-10-28; replaces the 2026-10-27 snapshot design, which never built).**
   Mark: "in a normal terminal i can scroll up and down, no issues at all.
   we want that." Three Codex-reviewed spikes showed the snapshot design
   could not be seamless, and that the raw-output transport (D13) can.
   - **What it is:** each viewer's xterm keeps **real scrollback** fed by
     the program's own output, so history *is* the terminal. It looks the
     same and selects/copies natively. Scrolling up and down is the normal
     xterm viewport, with no separate view, boundary or Refresh.
   - **Viewer-local:** every viewer scrolls its own copy; nobody else moves.
     tmux copy-mode is never used.
   - **On join:** a viewer receives the replica's history (D13 checkpoint +
     tail), so history from before it connected is there.
   - **Depth:** 10,000 lines by default on the server and every viewer
     (≤ 24 MB retained per session, measured in T32d). More needs incremental
     checkpoints (a later task).
   - **Full-screen programs** (vim, less, htop) have no scrollback, as in
     any terminal; the grid pans as today.
   - **Ended sessions:** D13's final bundle (the last accepted checkpoint
     plus the bounded tail), written when the session ends — terminate,
     maintenance completion or a natural exit — atomically and
     idempotently. A failed save never blocks termination; the session
     durably shows "Output not saved". Sessions from before the raw path
     show their legacy output. The bundle is deleted with history deletion,
     session deletion and output retention. Format changes are versioned.
   - **Reading tools (later):** Search and Download over xterm's buffer, in
     the session header's output menu and the key bar's sheet.

4. **Links and tap-to-copy.**
   - Add the `@xterm/addon-web-links` addon. **Built (T20):** plain-text
     URLs and OSC 8 links open through one handler — confirmed, no opener,
     http/https/mailto.
   - When iOS blocks a clipboard write, a tap-to-copy prompt appears instead.
     **Open decision 6, for Mark (kit gap):** nothing in B5 writes the
     clipboard yet (copying a selection on a phone needs an action), the
     kit's public copy action is `CopyButton` (a 24 px icon button,
     below the 44 px touch target), and `copyToClipboard` is no longer
     public (#875). A touch-sized copy action is a public-API extension
     (a `CopyButton` size, or re-exporting the helper) that needs his
     approval; R3's T36b (OSC 52 offers, copied on a tap) needs the same.
   - OSC 52 clipboard writes are never automatic: D13's profile decodes them
     into offers, and the latest offer is copied only on the operator's tap,
     live only (T36b).
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
6. **Emoji width.** Owned by D13's terminal profile (2026-10-28): Unicode 15
   with grapheme clusters (`@xterm/addon-unicode-graphemes` 0.4.0) on every
   emulator. Unicode 11 diverged from tmux 3.7c on every emoji sequence;
   the remaining divergences are pinned by a real-tmux parity test.
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

9. **Key bar v2 (2026-10-27, after v1 failed the live iPhone test; Mark chose
   direction A + the C2 sheet; Codex-reviewed; canvas "Terminal mobile key
   bar", row 2).** Replaces the always-on Esc/Tab/Ctrl/More/arrows row.
   - **Shown while typing, not by measuring the keyboard.** WebKit offers no
     keyboard API (no `interactive-widget`, no VirtualKeyboard) and Safari
     26's floating toolbar sits outside the visual viewport, so v1's
     occlusion heuristic missed open keyboards. A touch device (primary
     pointer coarse) shows the bar in an explicit **editing session**:
     `idle → typing` (the terminal input is focused, or focus is inside the
     bar or sheet) `→ sheet` (••• opened) `→ typing` (abc) `→ idle` (hide
     keyboard). A corner keyboard button (top-right, beside ↓ Live) starts
     typing from idle; it hides while the sheet is open. Return on the
     on-screen keyboard sends the line and ends the session (keyboard away)
     so the response has the screen (Mark, 2026-10-28). It does not collapse:
     - for a Return that continues the line (`\` + Return, or Return with
       the bar's ⌃/⌥);
     - for an IME key (229);
     - for a hardware Enter (a physical key code and an uncovered screen);
     - when neither signal is clear (a floating keyboard, a zoomed page):
       the keyboard simply stays.

     Known limit: a hardware keyboard used while the on-screen keyboard is
     also showing (iOS normally hides it) looks like the on-screen one. The
     browser cannot tell which keyboard a key came from.
   - **Placement:** the workspace's `inputAccessory` slot, which the kit
     already bounds to the visual viewport (one geometry owner; no second
     transform). The slot stays mounted for any live session; only its
     content changes, because toggling the slot remounts the terminal. In a
     Safari tab the bar sits above Safari's pill (accepted); as a Home
     Screen app (Mark's usage) it is flush with the keyboard.
   - **One row of iOS-style keycaps:** filled, no outlines, about 9 px
     radius, 40 px caps with ≥ 44 px hit targets, system glyphs, kit tokens.
     The row holds `esc`, `⇥`, `⌃`, `⌥`, an **arrow joystick**, `•••`
     (`abc` while the sheet is open), a divider, and **hide keyboard**,
     which is always present and works even while sending is disabled.
     Phones narrower than 370 px use 38 px caps with widened hit areas.
   - **Modifiers:** ⌃ and ⌥ are each off / one-shot (tap) / locked
     (long-press, or the lock toggles in the sheet). Escape sequences:
     - Ctrl: as xterm 6.
     - ⌥ (terminal Meta, never Command): ESC-prefixes text and keys.
     - Modified cursor keys and Home/End: `CSI 1;m X` (m = 1 + alt·2 + ctrl·4).
     - Modified tilde keys: `CSI n;m ~`.
     - Unmodified application-cursor mode keeps SS3.

     The contract is about what is sent, not which input path produced it.
     xterm delivers typing through keypress, IME commits (deferred, or
     flushed by the next key) and Android's composition path alike, and
     these can't be told apart reliably (four Codex rounds showed it). So:
     - one key takes the modifiers and consumes a one-shot one, however it
       arrived (a locked Control makes every key Control+key). This is a
       transformation per delivered chunk, not a held key: a dictated or
       predicted single letter is one key too;
     - other text (words, autocorrect, dictation, CJK commits) is sent as
       typed and ends a one-shot modifier;
     - paste is sent exactly as pasted;
     - a typed DEL stays a plain Backspace (it may be an autocorrect
       deletion or a hardware Ctrl+8); the sheet's ⌫ takes the modifiers;
     - ESC sequences that are not keys (xterm's focus reports, answers and
       mouse reports) are untouched and never consume; `CSI 1;m R` counts as
       a reply, because a modified F3 is the same bytes;
     - bar keys arrive encoded and never take a modifier twice;
     - disconnection, ownership or session change and backgrounding clear
       everything.
   - **Arrow joystick:** one captured pointer, `touch-action: none`, 12 px
     dead zone, directional hysteresis. Entering a direction sends one step;
     holding repeats after 350 ms at 100 ms intervals. Cancel, lost capture,
     unmount or disable stops it, and the trailing click is suppressed. A
     quick tap off-centre sends one step that way. With keyboard focus, the
     arrow keys send arrows. The four ordinary arrow buttons are in the
     sheet, for VoiceOver.
   - **••• sheet:** a bounded bottom sheet in the accessory slot (the
     keyboard is dismissed first; no keyboard-height matching in v2). It
     holds:
     - **Keys:** Esc, Tab, ⇧Tab, Enter, ← ↓ ↑ →, Home, End, PgUp, PgDn, ⌫,
       Del, `|`, `~`, `/`, `-`;
     - **Control**, with plain labels: ^C Interrupt, ^D End input,
       ^R Search history, ^L Clear screen, ^A Line start, ^E Line end,
       ^U Delete line, ^W Delete word, ^K Delete to end, ^Z Suspend;
     - Ctrl lock and Option lock toggles.

     Literal keys go through a gated text path. Keyboard users get focus
     moved into the sheet, Escape closes it, and focus returns.
   - **Accessibility:** spoken names (Control, Option, Hide keyboard).
     "Armed once" and "locked" are announced and shown by shape, not colour
     alone. Focus is visible.
   - **Kit:** the public recipe `recipes/terminal-input.stories.tsx` is
     updated to this pattern (Mark: "kit updated after redesign"); no
     exception record.
   - **Later:** pin editing and customisation; a seamless keyboard-height
     sheet (only if the device checkpoint shows it is worth it).
   - **Open decision 5, for Mark:** the plan still carries pin editing as
     T19b in B5 ("Edit pinned keys in •••… capped at 12"), while this item
     says Later, and the v2 row has no room for pins at 320 px. Claude
     recommends deferring T19b (the sheet is where keys are added) unless
     Mark wants pins as a sheet group; not built until he decides.
   - Desktop (fine primary pointer) shows no key bar.

Cut: the ghostty-web renderer, the image (sixel) addon, ligatures, and the
tmux mouse-on touch path. (unicode-graphemes was cut here, then adopted by
D13's profile on 2026-10-28 after measuring tmux 3.7c's widths.)

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
  - Three states: **following**, **panned** (a manual pan), and **reading
    history** (scrolled up in xterm's own scrollback, D9 item 3); an active
    selection inhibits following in any state. Following resumes only on a
    deliberate return: tapping "↓ Live" (which also calls
    `scrollToBottom()`), or focusing the terminal to type. Reaching the bottom by itself does not resume it,
    so a horizontal pan at the bottom is never undone. "↓ Live" reveals the
    **cursor**, which may be above the last row.
  - **Vertical scrolling** (one-finger drag, wheel, trackpad) scrolls
    xterm's history when there is history to scroll, and pans the grid
    otherwise. Horizontal drags pan the grid. A hidden cursor (DECTCEM off,
    e.g. Claude Code) is followed vertically only.
  - **Controls (amended 2026-10-27):** "↓ Live" is a small 32 px pill in the
    pane's **top-right** corner (touch target ≥ 44 px), with Reset view as a
    32 px icon beside it. It is anchored to the viewport wrapper, outside
    the scrolling content, shown only when not following, and keeps
    terminal focus on tap. Cursor reveal leaves clearance so the cursor is
    never under it. Nothing floats over the bottom rows, where the
    program's input line is.
- **Header:**
  - Normally: `200×60 · Sized by <this device | desktop | phone | terminal app> · Fit to this device`.
  - `Size frozen` once the authority has disconnected.
  - "Agent" never appears as a size authority.
- Panning never focuses the keyboard or sends input.
- `terminal-canvas.tsx` replaces its `writable` proxy with explicit
  sizing-authority state.

### D13 Raw-output transport (2026-10-28; spikes 1–3, Codex-reviewed) — status: conditional, acceptance pending
Viewers render the **program's own output** (tmux control mode `%output`),
not tmux's attach redraws. That gives real scrollback (D9 item 3) and one
ordered stream for every viewer. Evidence: scratchpad spikes 1–3 and four
Codex reviews.

- **One control client per session** (D4's) carries output, layout,
  input and queries.
  - Output is an **ordered event log**: decoded `%output` bytes,
    `%layout-change` resizes, and rebase events.
  - Replies are framed by their `%begin`/`%end` number plus flags; pane
    text can never fake a terminator.
  - No `pause-after`: it discards output.
- **Server replica:** one headless xterm per session, fed by the log in
  order. Writes are queued, never awaited per chunk, with a hard bound.
  `%exit`, EOF, overflow or a too-far-behind exit invalidates the replica
  and goes to recovery.
  - **Overload (measured 2026-10-28, T32c):** tmux delivers a `yes` flood
    at about 40 MB/s; the replica parses about 21 MB/s (27 without the
    profile), so a sustained flood would overflow the log in half a
    second. tmux cannot apply backpressure while any normal client (the
    bridge until T38b, any terminal app) is attached: it keeps reading
    the pane and holds our unread output (`server_client_check_pane_buffer`).
    So the log tells the replica its waiting output at ingress, and at
    4 MiB the replica **rebuilds from tmux**: base and tail are dropped,
    output is skipped unparsed until the next seed (it is superseded,
    never in a tail), and a seed is asked for. Rebuilds start at most
    once a second per session while output keeps coming, at once after
    100 ms of quiet, one heavy job (checkpoint or capture) at a time in
    the process. An overload rebuild is **lossy** (the seed is tmux's
    reconstruction: the measured degradations), unlike T34a's
    state-preserving width rebase. Log overflow stays the last safeguard
    (recovery). Lossless backpressure (pausing reads when Bakin's control
    client is the server's only attached client) is a follow-up after
    T38b, not built.
- **Shared terminal profile** (one module, used by the replica, every
  viewer and the checkpoint verifier; the same xterm release is pinned on
  both sides, enforced by an architecture test):
  - **Query policy:** every query or report is swallowed, so tmux is the
    pane's only responder. Enforced at xterm's one exit: nothing the
    emulator generates (replies, focus reports) leaves a viewer; only user
    input does.
  - **Links:** OSC 8 is limited to http, https and mailto; the browser
    opens them through a link handler with the same allowlist.
  - **Clipboard:** OSC 52 never writes it; its decoded UTF-8 text is
    offered, bounded at 256 KiB decoded.
  - **Character widths:** Unicode 15 with grapheme clusters
    (`@xterm/addon-unicode-graphemes`), corrected to tmux's scalar widths
    by a table generated from the managed tmux (utf8proc, deterministic);
    a write split inside a UTF-8 codepoint is carried over so chunking
    never changes layout. What tmux combines by context (the cell left of
    the cursor) cannot be mirrored by a width provider; those cases are
    pinned by a real-tmux parity test, and the replica's cursor is checked
    against tmux's.
  - **Colours and windows:** palette and dynamic-colour changes are
    swallowed; window operations do nothing.
  - **Graphics and strings:** sixel, kitty graphics, APC, PM and SOS are
    never drawn.
  - **Side effects fire only live, never on replay:** bells, titles and
    clipboard offers.
  - **xterm 6.0.0 workarounds:**
    - ED 1 erase-above (shipped first, f347056);
    - inactive alt-buffer capacity;
    - stale combined/extended maps on reflow;
    - link entries, reclaimed when no live extended cell or the current
      pen references them, in batches. Never deleting is not acceptable;
    - one set of tab stops across alternate-screen switches (as tmux);
    - the UTF-8 decoder dropping a held character whose continuation byte
      carries no payload (a ZWJ split across writes);
    - the start-of-print clear when a write boundary splits a printing run
      (chunking must never change layout).

    Each has a test that fails once upstream fixes it.
- **Checkpoint + bounded tail** (a join never waits on future output):
  - **The serializer:** Bakin's own, not SerializeAddon. It covers lines
    with wrap flags, empty cells, links, the DECSC slot, the inactive alt
    buffer, tabs, scroll region, charsets, pending wrap, pen, modes,
    cursor style, mouse and cursor visibility.
  - **Accepting a checkpoint:** only when xterm's parser is quiescent
    **and** restoring it into a scratch terminal reproduces the full state.
    What bytes cannot carry travels beside them and is set after they are
    parsed: the grapheme join state, the pen's HAS_EXTENDED bit (a latent
    link) and the width the alternate screen was entered at.
  - **Cadence:** tried at 1 MiB of output since the last try or after 2 s
    idle, in resumable steps (one row, or 16 KiB of restore, at most about
    2 ms) run in 3 ms slices that yield to the event loop, one checkpoint
    at a time in the process; overload abandons a running or waiting one.
    About 50 ms of work at 120 × 40 + 10k rows. The tail has a **hard
    bound**: 4 MiB or 4096 events.
  - **When no checkpoint can be accepted in time** (an unterminated
    string, a persistently unserializable state), the replica is rebuilt
    from tmux (the same path as overload). It is never an unbounded tail.
  - **A join:** checkpoint plus tail, in ACKed chunks behind a replay
    barrier. Input is gated until the replay completes, and stale epochs
    are isolated.
- **Width change → rebase:** tmux reflows history and the cursor line, and
  xterm doesn't, so after a width change the replica is rebuilt from tmux
  (`SEED_CMD`, one atomic grouped command). The boundary is its final
  correlated reply: every earlier log event has been parsed, and output
  after it follows the seed.
  - The event log is the only resize source for the replica and viewers.
  - D2's sizing contracts (claims, epochs, revisions, floors) stand; only
    their implementation moves onto the log.
  - It preserves the replica's full terminal state: pen, charsets, modes,
    DECSC slot, tabs, region and alt screen. Continuation fidelity is
    tested with split UTF-8/CSI, saved cursor, charsets, regions and alt
    screens, comparing attributes and modes, not only text.
  - It is broadcast as an event, so every viewer resets to it.
  - Row-only changes are ordered resize events with no rebase.
- **tmux config:** `set -g scroll-on-clear off` (a service update), so
  `clear` leaves no stale history on either side.
- **Recovery contract** (replica lost, e.g. server restart):
  - The rebuild from tmux is one atomic command.
  - The view shows a persistent banner (kit `feedback/banner`): "Terminal
    view recovered with limitations. Some earlier output may be missing or
    differ. Formatting and terminal behavior may remain incorrect until
    the application resets or redraws." The details name the cause. A
    reconnect does not clear it.
  - Measured degradations: the current pen, the DECSC slot, charsets,
    cursor style, focus mode, a program paused mid-escape, partial-region
    scroll-offs, empty cells normalised to spaces, and after-print
    combining/REP behaviour.
  - Width rebases carry the same partial-region history (tmux keeps lines
    that scroll out of a partial region).
- **Digest safety net:**
  - At matching `{epoch, seq}` positions (periodic barriers, and quiet
    points), each viewer reports a digest of its screen, cursor and modes.
  - A mismatch triggers a fresh join for that viewer, with bounded retries;
    a repeated mismatch escalates to a replica rebuild and is logged.
  - Viewer digests cannot see a layout the replica shares, so at quiet
    points the replica's cursor is also compared with tmux's; a mismatch
    reseeds and is logged.
  - It is detection, not a guarantee.
- **Memory budget** (T32d, per session at 120 × 10k): retained after GC
  ≤ 24 MB on the raw path; peak ≤ 64 MB with R1's shadow screen, verifier,
  full queues and three joins. The server warns past 480 MB retained (20
  sessions). Not covered by that figure and to be measured in T32d: a
  wide, densely coloured session (400 × 150 with per-cell colours
  serializes to about 84M characters, 1.1 s of sliced work), seeds and
  capture replies in flight.
  - **Measured (2026-10-28): neither ceiling can be met as the
    architecture stands.** One profile terminal at 120 × 10k is
    20.7–20.8 MB, not the 14.5 MB the ceilings assumed (xterm's per-line
    objects add about 0.6 KB a line). A replica with its base and an empty
    tail is 22–27 MB; a full 4 MiB tail adds 4.2 MB; per-cell truecolour
    makes the base 24.4M characters (about 55 MB). The R1 peak holds three
    such terminals (replica, bridge Screen, verifier scratch: about 62 MB)
    before the 8 MiB log and any join. The plan forbids moving the number,
    so this is **open decision 4, for Mark** (both views below).
    - Codex: keep exact replay (checkpoint + tail), move it out of the
      heap: an immutable file-backed checkpoint streamed through the
      verifier, the tail as ordered records on disk, a resident cache of
      about 512 KiB, joins reading bounded windows of a pinned generation,
      quotas and deadlines; and for the peak either a much smaller bridge
      history (an explicit change to B5's bridge snapshots, which do
      include their scrollback) or a compact verifier. It rejects
      on-demand join checkpoints (they lose exact joins in states no bytes
      rebuild, and at session end), sampling verification, and excluding
      the shadow from the gate. T32d becomes an L task.
    - Claude: agrees with the analysis and that on-demand checkpoints
      lose too much. Since the ceilings rest on a measured-wrong premise,
      the honest alternatives are (a) Codex's file-backed storage plus a
      smaller bridge history for R1, or (b) Mark re-baselining the
      ceilings from the measured terminal cost (for example retained
      ≤ 32 MB, peak ≤ 96 MB, warning at 640 MB) and keeping the resident
      design. Recommends (b) for R1–R3, with file-backed storage recorded
      as the follow-up if the live sessions' totals ever approach the
      warning: one user, ten sessions at most (`maxSessions`).
- **Ended sessions:** the final bundle (last accepted checkpoint plus the
  bounded tail, dimensions, profile/format version, sequence boundary and
  recovery metadata) is persisted when the session ends: after a final
  drain, before the kill, on terminate and maintenance completion; on the
  program's exit (`#{pane_dead}`, confirmed), after every received output
  event is parsed. The control client's own `%exit`/EOF is not an end: with
  the pane alive it is recovery. A failed save never blocks termination
  and is recorded durably ("Output not saved"). Sessions without a bundle
  load without resync: legacy output for pre-raw sessions, the static
  "Output not saved" state otherwise.
- **Two paths until the bridge is deleted:** the bridge path keeps its
  readiness check, its resizes and its legacy retained output exactly as B5
  ships them, so a rollback to B5 reads every ended session. After T38b,
  which ships behind a drained maintenance step, that guarantee narrows:
  sessions that ran afterwards have only a bundle, and an older version
  shows them with no output (no B5-readable copy is kept). Bundles a rolled-back version could not delete are reconciled on
  upgrade.
- **Delivery and rollback** (additive PRs on top of B5; the built B0–B5
  history is not rewritten):
  1. **Crash fix** (done).
  2. **R1, bounded shadow replica:** dark, beside the bridge. Its screen is
     compared with the bridge's in logs, allowing for documented semantic
     differences.
  3. **R2, opt-in raw path:** socket v2, rebase, recovery, persistence and
     digest, behind a setting that is off by default.
  4. **R3, native scrolling** in the canvas, then Mark's acceptance: real
     Claude Code, the WebGL browser, a second browser, Ghostty and his
     iPhone.
  5. **Only after acceptance** is the bridge deleted (T38b). D12's
     full-stack merge sign-off stays separate.

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
  - **new:** `@xterm/addon-unicode-graphemes` 0.4.0 and `@xterm/addon-web-links` 0.12.0
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
lib/sessions.ts         → claims, create dims, final bundle, native admission
lib/socket.ts (new)     → per-viewer socket protocol, flow control, epochs
lib/terminal-profile.ts (new) → the one terminal profile (D13): options, query/report policy, links, clipboard, widths
lib/xterm-fixes.ts (new)      → xterm 6.0.0 workarounds, each with an upstream tripwire
lib/checkpoint.ts (new)       → checkpoint serializer + full-state verifier (D13)
lib/attention.ts (new)  → adapters, hooks, derived activity
lib/uploads.ts (new)    → image validation, storage, retention
lib/cli.ts (new)        → launch-route handlers for new/attach/ls
components/…            → canvas (authority/pinch/pan/follow, native scrollback), key bar, compose sheet, attention chips
tests/…                 → unit, process-integration, browser
README.md
```
Retired: `lib/http.ts`'s `stream`, plus the browser write/resize command paths;
after acceptance, the per-viewer attach bridge and its headless `Screen` (T38b).

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
  - D13: control-mode decoding and reply framing; the checkpoint serializer
    and full-state verifier (named repros plus the integer-PRNG fuzz with
    asserted branch coverage and join offsets across the stream); tail
    bounds; rebase continuation fidelity; the terminal profile's policy
    and xterm workarounds; digest comparison;
  - key bar: encoding against xterm 6, the modifier contract, the editing
    session, the joystick, Return-hides;
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
  - D13 against real tmux: late joiners mid-escape/UTF-8/OSC/DCS/alt/region;
    rapid resizes with markers (transient and final states); recovery
    during output; `%exit`/EOF/overflow fault injection; two viewers plus
    a native client with exactly one query answer;
  - final bundle persistence (no-scrollback session, terminate, natural
    exit, maintenance completion, a write failure and a restart after it,
    sessions without a bundle);
  - fingerprint recorded only after verified startup;
  - setup refusing live panes.
- **Race and failure:**
  - a stale resize after a newer claim;
  - a partial resize failure;
  - the control connection dropping after input is consumed but before its
    result;
  - reconnect during output or resize;
  - each asserting zero input replay and consistent dimensions across every
    representation: tmux, the stored size, and the path's own (the bridge
    PTY and `Screen`, or the raw replica fed by the log).
- **Bounded load:** run `yes` for 30 s while one viewer stops ACKing.
  - Plugin heap growth stays under 32 MiB.
  - The stalled viewer is evicted within 10 s.
  - A healthy loopback viewer's keystroke-echo p95 stays under 50 ms.
  - Ctrl-C stops the flood within 1 s.
  - The evicted viewer re-snapshots to the same screen as a healthy viewer.
  - Measured in R1 (T32c, shadow replica, 10 s flood): no overflow (worst
    backlog 4.3 MB), input acknowledged by tmux at p95 4 ms (13–17 ms
    while heavy work runs), Ctrl-C stopped it in about 150 ms, and the
    replica converged and agreed with the bridge afterwards. Input ACK is
    not keystroke-to-render; the visible echo gate is R2's.
  - **Open for Mark before T33** (Claude and Codex agree on the
    mechanism; these are product calls):
    1. *Is an overload rebuild disclosed?* Codex: yes, one persistent,
       non-modal notice per affected session ("High output caused the
       terminal view to refresh from tmux. Some output or terminal state
       may be missing…"), never cleared by a reconnect or a later
       checkpoint, separate from a transient "catching up" indicator.
       Claude: agree that silence is not honest (lost pen, saved cursor or
       charset changes affect later output); recommend the notice.
    2. *What does the echo gate mean during overload?* A rebuild cadence
       of 1 s means the display can lag a flood by up to a second by
       design. Codex: either keep the 50 ms gate and treat this design as
       insufficient, or split it into normal-operation echo (50 ms) and
       overload input responsiveness (Ctrl-C within 1 s, input never
       queued behind replica work) plus display freshness. Claude:
       recommend the split; no browser can render 40 MB/s anyway.
    3. *Established viewers during a rebuild:* keep their input
       permission (no join gate on a display rebase) so Ctrl-C always
       works. Both recommend this.
- **Resize failure:** inject a failure at each resize step. The session ends
  with every representation equal to tmux's actual window, and input paused
  until reconciliation finishes.
- **Native admission:**
  - A raw `tmux attach` without a reservation is detached.
  - A reservation invalidated by Return control is refused.
  - An expired reservation is refused.
- **Browser (Playwright Chromium + WebKit, desktop + iPhone emulation, against
  the disposable preview):**
  - pan, pinch, and follow;
  - the key bar (shown only with the keyboard up, strip scroll vs tap,
    arrow hold-to-pick and its cancellations, ••• menu, pin editing,
    focus kept, exactly one input per activation);
  - the compose sheet;
  - native scrollback (scroll up and down while numbered output continues,
    join with history, other viewers unmoved, no input/claim/resize from
    scrolling, ↓ Live, full-screen programs pan);
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
- Adding dependencies beyond `ws`, `@xterm/addon-unicode-graphemes`, and
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
6. The key bar, the compose sheet, native scrollback (including on ended sessions), links
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
