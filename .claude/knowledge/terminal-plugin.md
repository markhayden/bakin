# Terminal Plugin Core Contracts

Terminal is an official Bits plugin, not a core plugin. Its README in
`bakin-bits-official/plugins/terminal` owns operator instructions. The approved
product decisions are in `.claude/specs/terminal-plugin.md` (D1-D10).

## Caller Identity

`PluginToolContext.invocation.agentId` is supplied only by a verified host
transport. `ExecToolDefinition.requiresVerifiedAgent` rejects unverified MCP
and generic HTTP exec dispatch before the handler runs. The runtime-native
provider binds Pi's agent identity; OpenClaw provisioning adds per-agent bearer
headers to MCP configuration. A private0600 `mcp-secret` under the Bakin home
derives stable HMAC credentials. MCP checks credential and session binding on
every request, not only initialization. Ordinary unverified MCP tools retain
their existing behavior.

This is transport attribution inside the trusted single-user OS boundary, not
protection from a malicious same-user process with filesystem/HTTP access.
Never accept an input/body/query `agentId` as verified identity. Do not log
credentials or terminal output. Runtime tool results may still be retained by
the invoking agent's transcript system.

## Plugin Storage and Removal

`StorageAdapter.localRoot` is optional: scoped filesystem storage supplies the
plugin's private data directory; nonlocal adapters may omit it. Terminal fails
activation without it. The SDK testing harness exposes its own temporary root.

`beforeUninstall(ctx)` is a blocking preflight before existing teardown. A
manifest with `uninstallPreflightRequired: true` cannot be removed while its
preflight is unavailable. Unlink refuses these plugins and directs callers to
the regular remove path. Terminal uses this to require completed sessions,
reviewed worktrees and successful independent-service shutdown. `onShutdown`
is detach for restart, not permission to terminate shells or delete work.

## Git Ownership

The existing Git worktree registry supports exactly one task or session owner.
Hooks `git.prepareSessionWorktree` and `git.releaseSessionWorktree` are the plugin
boundary. Session preparation requires `repoPath`, `sessionId`, and `agent`;
release requires `sessionId` and `worktreePath`. Terminal never creates a dummy
task. Session-owned entries cannot be deleted through the generic task release
path, including force. All prepare/release mutations share serialization.

Session release checks ignored and untracked files, submodule changes, and the
actual checkout HEAD's ancestry against the recorded original base branch.
Unknown/dirty/unmerged state refuses release. Normal Git removal is used; no
force and no automatic branch deletion. Terminal additionally checks completion
and process use. A30-day age threshold is eligibility for review, not authority
to discard unfinished work.

## Verification

Focused tests cover credentials/MCP policy/session binding, OpenClaw provisioning,
runtime tools, SDK testing, Git worktrees, and plugin remove/unlink lifecycle.
Terminal unit and opt-in real process/browser tests live in Bits. Use isolated
homes and private tmux/launchd jobs; never test against the live user's sessions.
The session index uses `Page` plus `DataTable` with SDK router row activation
and session-title links; each session uses
`WorkspacePage` / `ImmersiveCanvas` with a compact Back link. There is no session
rail or navigation select. Agent assignment and paths live in the kit Popover;
session controls are right-aligned in the full and compact title rows, with
New terminal available only on the index. Flexible table cells wrap to use the
available width; explicit column constraints still permit local scrolling when
needed. Each index row has a kit menu for taking control, completing an exited
session, terminating, and deleting completed output. Confirmations retain the
target session ID and show its title, and API errors remain in the dialog for
retry. Deleting output does not delete metadata or retained worktrees.
Completion/deletion actions live in DropdownMenu, alongside Reconnect terminal
and the explicit Capture Tab checkbox. Reconnect only reattaches the
output stream; it does not restart the process. Connection and ownership status
share the title header, with no separate output toolbar. The terminal has a kit
16px inset, and xterm's theme plus unused viewport match its canvas background.
Terminal icon tools have
explanatory kit tooltips, including focusable disabled controls. The xterm surface
always fills the pane; its cell grid automatically fits on mount, resize, font
readiness, and reconnect when this browser owns input. There is no Fit control.
Read-only viewers never resize an agent-controlled PTY. Agent assignment uses
the full-width kit `AgentSelect` with registered display names, portraits, and
accent colors; terminal access policy still determines disabled choices.
The approved public workspace extension adds `viewport="visual"` and the
`WorkspacePageBody inputAccessory` slot. Its contract is exercised by
`pages/workspace-page.stories.tsx — KeyboardAwareInput` and
`recipes/terminal-input.stories.tsx — BarAndSheet` (the v2 key row and
More keys sheet, updated with the B5 redesign). No design exception
or new public export is needed. Existing workspaces retain host sizing.

## Mobile input and rendering

Terminal loads the matching xterm WebGL addon after opening the terminal.
Plain-text URLs are links through `@xterm/addon-web-links` 0.12.0; they and
OSC 8 hyperlinks open through one link handler: confirmed, in a new window
with no opener, http/https/mailto only (R1's profile owns the same
allowlist, `isAllowedLink`).
Inconsistent physical pixel measurements (including Chromium device emulation)
switch back to the DOM renderer, preventing a scaled GPU viewport from clipping
the terminal output.
Unavailable GPU contexts and context loss dispose the addon and restore the
normal renderer. Each terminal mount owns its renderer and event cleanup.

On coarse-pointer devices the key bar (spec D9 item 9, v2) follows an
editing session (idle / typing / sheet) rather than measuring the keyboard:
it shows while the operator is typing, in the always-mounted input
accessory slot. One row of iOS-style keycaps — kit Buttons drawn by the
plugin's scoped CSS — holds esc, ⇥, ⌃, ⌥, the arrow joystick (drag to
repeat, tap an edge for one step), ••• (abc while the sheet is open) and
Hide keyboard, which works even while sending is disabled. ⌃ and ⌥ are each
off, on for the next key, or locked (from the sheet's lock toggles); one
delivered key takes them and consumes a one-shot one, other text ends a
one-shot one, a paste is sent exactly, and disconnection, ownership or
session change and backgrounding clear everything, locks included. ••• puts
the keyboard down and opens a bounded sheet with the remaining keys, the
Control shortcuts with plain labels, and the lock toggles; keyboard users
get focus moved into it and Escape closes it. The sheet's Compose opens
the compose sheet (a fourth editing state): a kit Textarea for dictation,
IME and longer edits, with Paste (back to typing) and Paste + Enter (the
keyboard goes away). The page owns each session's draft (guarded
localStorage up to 64 KB, the input bound; longer ones live only while the
page is open, and the sheet says so) and clears it only when the server
accepts the paste's envelope (named by connection and sequence: sequences
restart with each connection, and a connection that ends retires its
entries) and the draft is still the revision that was sent — a refused or
uncertain one keeps it. Paste + Enter is one envelope (`paste` + `enter`):
the server sends the Return only once the paste went.
Bracketed paste is decided by tmux, not the viewer: on the bridge path a
viewer's xterm reports tmux's client mode, which tmux turns on for every
client it attaches. So a paste is explicit input — the socket's `input`
frame carries `paste: true` (xterm's own paste events and compose; each
travels alone in its envelope; only the data a paste event announced is
marked, never a key typed after it) — and the server strips any markers and
hands it to tmux as a paste (`load-buffer` from a private 0600 file, then
`paste-buffer -p -r -S -d`: tmux brackets it only if the program enabled
bracketed paste, `-r -S` keep every byte). Plain input is never
reinterpreted. Paste files and buffers are cleaned up independently of the
control connection, and leftovers from a crash go at the next process's
first paste. Cursor sequences follow
xterm's current normal/application mode. Every action uses the existing
ordered input queue and generation/ownership checks.

The kit measures the intersection of the host pane and VisualViewport, keeps
the accessory above the keyboard, and owns bottom safe-area clearance. It does
not resize the host or alter global document styles. A collapsed opted-in
workspace exposes only its compact header to assistive technology and keyboard
navigation. The full header becomes available again when scrolled into view.
The canvas has no fixed minimum height; human-owned PTYs can fit down to one
row. Read-only viewers never resize the shared PTY.

Implementation and verification: `.claude/specs/terminal-mobile-rendering-evidence.md`.
Physical iPhone Safari and Android Chrome keyboard verification remains
outstanding; automated Chromium/WebKit checks are not a native-phone result.

## Raw output path (spec D13; R2, opt-in since T38a)

Two paths run side by side until T38b deletes the bridge. A session is on
the raw path when it was created with the plugin setting `rawPath` on
(`Sessions` option `rawPathForNew()`, asked once; the record keeps
`Session.rawPath` for the session's life, so a toggle only affects new
sessions). The local preview sets it with `TERMINAL_PREVIEW_RAW=1`.

- **Server:** `lib/replica.ts` holds the session's emulator, base
  checkpoint and tail; `state()`/`cut()`/`subscribe()` give a viewer an
  immutable cut and every committed event after it. `lib/raw-display.ts`
  is one viewer's picture: `join`/`rebase` header (checkpoint side state,
  exact UTF-8 `bytes`), the checkpoint text, the tail, `barrier`, then live
  output and `layout` frames, all through one ordered sender. Credit is per
  connection (`retired` from the client counts applied and discarded
  display bytes); a replay in progress is never cancelled, an overflow or
  rebuild during it is one pending replacement from the latest cut (at most
  once a second). Input is refused until the client's first
  `replay-applied` and never re-gated by a rebase (decision 3). Raw input
  health is the control client alone (`controlConnected`).
- **Browser:** `components/raw-picture.ts` is the ordered queue (writes
  pipelined into xterm; the side state, layouts and the barrier after the
  writes before them; a new header retires every frame of the old picture
  once). The canvas mounts a fresh terminal per picture and sizes it only
  from the picture and its layouts; `restoreSideState` lives in
  `lib/side-state.ts` so the browser never imports the headless serializer.
- **Width changes (T34a):** not a rebuild. A width `layout` resizes the
  replica and asks tmux for its reflowed picture; it lands as an ordered
  `geometry` log event (cols, rows, generation, seed bytes) that
  `lib/geometry.ts installGeometry` installs into the live emulator —
  lines, cursor, region and tabs from tmux, everything else (parser, pen,
  modes, saved slots by their screen row) kept, except that under a 1049
  alternate screen the normal cursor and its return slot are tmux's. Viewers get a `geometry` header plus binary
  frames, parse them into an unopened scratch terminal and install the
  same way; a refused install reconnects (server side: a `width`
  rebuild). Raw `readScreen` reads screen, size and `sizeRevision` from
  the replica in one step; the revision counts applied dimension changes
  and `TmuxProcesses` carries it across a reattachment. Testing: after a
  width change compare with tmux's `capture-pane` (`-J -S - -E -` for
  history), never the bridge shadow, whose emulator keeps cells from the
  old width; a discriminating case keeps the cursor inside a wrapped line
  (tmux reflows it, bare xterm does not).
- **Safety net (T37):** `lib/digest.ts screenDigest` is shared by the
  replica and the browser (visible cells, cursor, modes, mouse; pinned
  6.0.0 internals for what the public API lacks). The socket places
  `digest-point` frames (RawDisplay.digestPoint, after their event);
  RawPicture answers with `digest`; a mismatch closes 4000 to rejoin, the
  third in 10 min escalates `Sessions.diverged` → `Replica.diverged()` (a
  `divergence` rebuild). `TmuxProcesses.watchCursor` compares the replica
  with tmux at quiet points (`compareCursor`, the position taken in the
  control reply's `onReply`). Testing: the fuzz corpus checks digest
  equality wherever full state is equal; `TEST_WIDTH_ENTRIES` injects a
  width difference for the tmux check.
- **Final output (T35b):** an ending session (terminate, the program's
  exit via tmux's `pane_dead` subscription, maintenance) saves a bundle —
  the replica's last cut after `drainFinal` (lib/processes.ts) — through
  `Store.saveBundle` (lib/store.ts: header + parts, sliced writes, one
  commit with the session's flag, a 250 MiB whole-bundle budget). The store
  owns `outputSaved`/`outputEvicted` once a row exists, and `session_marks`
  lets it see sessions another version wrote (rollback): those take their
  legacy output. The save runs outside the manager queue with the session
  reserved; shutdown drains every lifecycle operation before closing.
  Ended raw sessions join their bundle (lib/socket.ts `joinEnded`) or close
  4005 with why; the page shows a SystemState. Testing: `rollback.test.ts`
  runs B5's own store (from git) against the same database.
- **Recovery and the notice (T35a):** each path judges attachment health by
  its own source — the raw path by its replica and control client only, so
  a failed legacy bridge never tears down a live replica. A raw join calls
  `Sessions.ensureReplica` first (instant for a live replica; a lost one is
  reattached under the manager queue, bounded for the viewer by the join
  deadline). A replacement replica's first seed counts `recoveries` in the
  session's fidelity; `lib/fidelity-notice.ts` renders fidelity as the page's
  persistent kit Banner (causes, never counts: the Banner re-announces
  changed text). The UI conformance fixture joins raw after a recovery, so
  the banner is always checked.
- **Gates:** `tests/raw-path.browser.test.ts` (against the preview with the
  raw path forced; the overload and width-change tests also need
  `TERMINAL_PREVIEW_TMUX` and `TERMINAL_PREVIEW_ROOT`, both printed by the
  preview). Echo latency must
  be measured in the page and with keys spaced more than a second apart:
  xterm throttles its accessibility rows to one refresh a second.
