# Terminal Plugin

Terminal is an official Bits plugin (`bakin-bits-official/plugins/terminal`),
not a core plugin. Code is the source of truth; the plugin README owns
operator-facing behavior; the design record is
`.claude/specs/terminal-multi-device.md` (D1–D13 plus "As built" notes; where
it and the code disagree, the code wins — see the end of this doc). The
original product decisions are `.claude/specs/terminal-plugin.md`.

macOS only (launchd). Requires Bakin/SDK `>=0.0.1-rc.45` (`useFullscreen`).

## Map

`index.ts` wires routes, the `/socket` socket route, settings, Health, the
hourly maintenance and minute memory reading, and the agent tool.
`lib/sessions.ts` (`Sessions`) is the one serialized queue (`run()`) for
lifecycle, ownership, input, sizing, native admission, attention, uploads and
sweeps. Server modules live in `lib/`, browser modules in `components/`
(`terminal-page.tsx` is the index + session workspace, `terminal-canvas.tsx`
the xterm mount). Files are named per concern below.

## Core contracts (Bakin side)

**Caller identity.** `PluginToolContext.invocation.agentId` is set only by a
verified host transport. `ExecToolDefinition.requiresVerifiedAgent` rejects
unverified MCP and generic HTTP exec before the handler runs. Pi binds its
in-process identity; OpenClaw provisioning adds per-agent bearer headers
derived (HMAC) from a private 0600 `mcp-secret` (`src/core/mcp-credentials.ts`),
checked on every MCP request. This is attribution inside the single-user OS
boundary, not protection from a same-user process. Never accept a
body/query `agentId` as identity; never log terminal output.

**Storage and removal.** Terminal fails activation without
`StorageAdapter.localRoot` (dir forced to 0700). `uninstallPreflightRequired:
true` makes `beforeUninstall` a blocking preflight (completed sessions,
reviewed worktrees, successful service bootout); unlink refuses such plugins.
`onShutdown` detaches, never kills shells.

**Git ownership.** Hooks `git.prepareSessionWorktree` (`repoPath`,
`sessionId`, `agent`) and `git.releaseSessionWorktree` (`sessionId`,
`worktreePath`, optional `teardown`) in `plugins/git/index.ts`. Normal release
(maintenance `clean()`) refuses dirty/untracked/ignored/submodule changes or
HEAD not merged into the recorded base; no force, branches kept. **Session
delete passes `teardown: true`**, which force-removes the checkout (branch
kept) best-effort — a git failure never blocks deleting the record. Coding
programs default to `checkout: 'isolated'`, shells to `'existing'`.

**Host capabilities used.** Plugin socket routes
(`src/core/server/upgrade-handler.ts`: live route → same-origin → `admit`;
Bun's built-in `ws`, no send bound — Terminal does its own credit), and
`cliCommands` `launch: { bin: 'tmux', refuseEnv: ['TMUX'] }`
(`src/cli/launch.ts`).

## The tmux service

- **Managed tmux only:** `TerminalService.tmux` is `$BAKIN_HOME/bin/tmux`
  (default `~/.bakin/bin/tmux`)
  (manifest `requires.bins`, tmux 3.7c universal, sha256-pinned incl. the
  archive member). No PATH/Homebrew fallback. Missing → 503 pointing at the
  plugin-assets repair; a repaired binary is picked up without restart.
- Private server: socket `/tmp/bakin-terminal-<uid>-<hash(root)>/tmux.sock`,
  LaunchAgent `io.bakin.terminal.<hash>` (`RunAtLoad`, `KeepAlive`), run as
  `tmux -D -S <sock> -f <root>/tmux.conf`. Service and shells get a stripped
  env (`terminalEnvironment()`: no Bakin-injected provider secrets; PATH
  prepends `$BAKIN_HOME/bin`). Programs start via `/usr/bin/env -i …`.
- **Config** is `tmuxConfig()` in `lib/tmux-config.ts`, the ONE source:
  `window-size manual`, `remain-on-exit on`, `exit-empty off`,
  `history-limit 50000`, `mouse off`, `status off`, `scroll-on-clear off`,
  `allow-passthrough off`, `extended-keys`, Ghostty terminal-features,
  `set-clipboard on`, titles from `@bakin_title`, a `client-resized` hook
  setting `@bakin_client` to `<pid> <w>x<h>`, and a minimal native-only
  prefix table (`C-b`: `d` detach, `C-b` send-prefix, `[` copy-mode, `]`
  paste, `?` help; everything else unbound — one pane per session is an
  invariant). It ends with `set -g @bakin_config <CONFIG_STAMP>`.
- **Fingerprint** = pin version + extracted sha + config + canonical plist
  without its env dict. Recorded in `<root>/service.json` only after the
  restarted daemon reports `VERIFIED_OPTIONS` (`@bakin_config`,
  `scroll-on-clear`). Mismatch → `updateRequired()` → "Terminal service update
  available" (Health: `setup-service` repair when nothing is live, otherwise a
  human incident pointing at Terminal's Apply update dialog, which ends exactly
  the sessions the operator was shown — `applyServiceUpdate`). Setup drains
  pending commands, rejects new ones, refuses any live pane or unknown pane
  state. Never patch the running daemon piecemeal; a config change is a
  service update.

## Output path (D13) — the only path

There is **no bridge/PTY stream** any more: T38b deleted the per-viewer PTY
attach, its server Screen, the shadow comparison, the `output`/`cursors`/
`sizes`/`session_marks` tables and the SSE/POST write/resize routes. Don't
reintroduce a second Bakin client on a session.

1. **Control client** (`lib/control.ts`): one `tmux -C attach-session -f
   ignore-size` per session, attached once (`Sessions.attached` set; a lost
   one is detached first). Carries `send-keys -H` input (bypasses key tables;
   copy-mode is cancelled first), `resize-window`, queries, `refresh-client -B`
   subscriptions (`bakin-client`, `bakin-dead` = `#{pane_dead}`,
   `bakin-attention`, `bakin-bell`) and `%output`. Replies are framed by
   `%begin/%end` number. `%exit` means the control client ended, not the
   program. `Processes.connected(id)` is input health.
2. **OutputLog** (`lib/output-log.ts`): ordered events (output, layout,
   geometry, seeds), bounded 8 MiB / 4096 queued; overflow or a lost
   connection invalidates → recovery.
3. **Replica** (`lib/replica.ts`): one `@xterm/headless` per session, profile
   from `lib/terminal-profile.ts` (scrollback 10,000; queries swallowed — tmux
   is the only responder; OSC 52 → offers ≤256 KiB; OSC 8 http/https/mailto;
   Unicode 15 graphemes corrected by the generated `lib/tmux-width-table.ts`;
   side effects live only, never on replay). Holds a base checkpoint
   (`lib/checkpoint.ts`, Bakin's own serializer, accepted only when a restore
   reproduces full state; sliced, never blocks input) plus a tail (4 MiB /
   4096 events). `state()/cut()/subscribe()` give immutable cuts.
   **Overload:** tmux floods faster than xterm parses; at 4 MiB backlog the
   replica skips output and rebuilds from tmux (lossy seed, ≤1/s while the
   flood lasts). Rebuild causes are recorded in `fidelity` (quiet — no banner;
   the pane only gets `data-recoveries`). Overload seeds are screen-only;
   after `HISTORY_QUIET_MS` (1 s) of quiet with the log drained, one full seed
   restores retained history (`restoreHistory`). Log overflow still
   invalidates the replica → recovery.
4. **Width changes** are not rebuilds: a `geometry` event (tmux's reflowed
   lines/cursor/region/tabs) is installed into the live emulator by
   `lib/geometry.ts installGeometry`, keeping parser/pen/modes. A refused
   install is a `width` rebuild. Row-only changes are plain `layout` events.
5. **RawDisplay** (`lib/raw-display.ts`): per viewer — `join`/`rebase` header,
   checkpoint text, tail, `barrier { epoch, throughSeq }`, then live binary
   output, `layout`, `geometry`, `rebuilding`, `digest-point`. One ordered
   sender; a replay is never cancelled, overflow/rebuild during it becomes one
   pending replacement from the latest cut.
6. **Browser** `components/raw-picture.ts` queues writes into a fresh xterm per
   picture; side state via `lib/side-state.ts` (the browser never imports the
   headless serializer).

**Socket protocol** (`lib/socket.ts` header comment is canonical): client
`hello { clientId }` first (a browser WS can't set headers), `input
{ generation, viewerSeq, data, paste?, enter?, uploads? }`, `claim`, `resize
{ epoch }`, `restore-size { epoch }`, `retired { bytes }`, `replay-applied
{ epoch }`, `digest`, `pong`. Server: display frames, `session`, `presence
{ sizeFrozen, nativeClients }`, `result { viewerSeq, accepted|rejected|
uncertain }`, `size-refused`, `ping`, `error`. Credit: sending pauses once
unretired bytes reach `ACK_WINDOW` (256 KiB; the last frame may overshoot by
one frame), per connection, never reset by a rebase; paused >10 s → close.
Heartbeat 15 s, 30 s silence closes. Close codes: 4000 resync, 4001
superseded, 4002 silent, 4003 protocol, 4004 not found, 4005 unavailable
(ended, reason `not-saved|evicted|unreadable`; final, the page shows a
SystemState). Input is refused until the first `replay-applied`, never
re-gated by a rebase; the server assigns `inputSequence` inside the queue;
input is never replayed (`uncertain` = "May have been delivered").

**Pastes** are explicit input: `paste: true` → `load-buffer` from a private
0600 file + `paste-buffer -p -r -S -d`, so tmux brackets only if the program
enabled bracketed paste. `enter` sends Return only after the paste went.

**Safety net:** `lib/digest.ts screenDigest` shared by replica and browser; a
mismatch closes 4000; the third in 10 min escalates `Sessions.diverged` →
replica rebuild. `TmuxProcesses.watchCursor` compares the replica cursor with
tmux at quiet points. Logs carry positions/counts, never contents.

**Recovery:** `Sessions.ensureReplica` before every join (instant when live;
otherwise reattach in the queue, bounded by the join deadline).

## Sizing (D2/D3, `lib/sizing.ts`)

- One real grid per session, one **size authority** `{ viewer, kind:
  'browser'|'native', device? }`. Claims: creating the session (browser
  `POST /sessions size`, or `bakin terminal new`), **Fit to this device**,
  and native admission. Each claim bumps `sizeEpoch`; `resize` is accepted
  only from the authority at the current epoch (else 409); each applied
  dimension change bumps `sizeRevision`. Independent of ownership
  `generation`: Take/Return never resize.
- The authority follows its pane (rows at once, cols after 100 ms) or its
  terminal window (`@bakin_client` subscription → `reconcileClients`). When
  it disconnects the size is **frozen** (`presence.sizeFrozen`, snowflake
  icon); the authority persists, so fitting resumes when that viewer
  reconnects (same `clientId` — a module-level per-page id, so a reload is a
  new screen) or another screen claims. Floor 40×10, max 400×150 (`clampSize`); smaller panes pan.
- `claimSize` remembers `previousSize { cols, rows, authority }`;
  `restoreSize(epoch)` ("Back to desktop/phone/terminal app") is a toggle and
  refuses a stale epoch.
- tmux `resize-window` first, then the record; if they can't agree the
  attachment is dropped and the next one adopts tmux's window.
- Non-authorities render the real grid: font fitted to width, clamped to a
  per-device minimum (`MIN_FONTS` 8/10/12/14, default 10 touch / 8 fine,
  chooser in the size popover), native two-axis pan, pinch / Ctrl-wheel zoom
  remembered in localStorage, Reset view. "Agent" is never an authority.
- Agents never size. Agent-created sessions start at `defaultCols`×
  `defaultRows` (200×60); the session menu's **Use this size as the default**
  writes both (`operation: 'default-size'`).

## Native terminal handoff (D5–D7, `lib/cli.ts`)

- `bakin terminal new|attach <ref>|ls --as human` → `/cli/new`, `/cli/attach`,
  `/cli/ls`. `operator()` requires `operator-declared` provenance and refuses
  agent contexts (the core CLI also refuses TTY-less, `$TMUX`, agent shells,
  remote `BAKIN_URL`). `new`: cwd, `shell` by default, `checkout: existing`
  unless `--worktree` (any program), title = cwd basename, `--agent` assigns
  without handing control, starts at the caller's size; on attach failure the
  session is kept and a `recovery` line names the attach command. `<ref>`:
  full id, or unique ≥8-char id prefix or exact title among running sessions.
- `reserveAttach` (human-owned sessions only: "Take control first") mints a
  single-use token bound to session + generation, 15 s TTL, and returns
  `attachArgs`: `attach-session -f read-only` chained with a 5 s
  `display-message` hint. The CLI spawns tmux and posts the pid to
  `/cli/confirm`.
- `reconcileClients` (runs on every client attach/resize/detach signal):
  a client with a confirmed reservation stays read-only until its claim +
  resize succeed, then becomes writable; while a confirm is pending other
  terminal clients are held read-only; everything else — including a
  hand-typed `tmux attach` and any foreign `tmux -C` — is detached.
  Take/Return/assign drop reservations; Return detaches all native clients
  before the agent drives. Admission is in memory: a Bakin restart detaches
  apps.

## Mobile and viewer UI

- Session page: `WorkspacePage mode="immersive" viewport="visual"`; the
  `WorkspacePageBody inputAccessory` slot stays mounted for any live session
  (toggling it remounts the terminal). Index: `Page` + `DataTable`, views
  `?view=active|review|completed|all` (Active = not completed; Needs review
  only while some session has `cleanupReason`), sortable columns via
  `?sort=` (default `activity:desc`); row menu Drive / Mark ended /
  Terminate / Delete session / Delete output only.
- **Ownership in the page** (`terminal-page.tsx`): human ownership is the
  operator, not the tab (`authorize()` in `lib/contracts.ts`) — every human
  client may type while the human owns it. Typing while watching an agent
  prompts "Take over" (`handleClaim`; confirmation remembered 15 min in
  localStorage). While the human drives a session with an assigned agent,
  the page hands back after 2 idle minutes + a 20 s "Keep driving" warning,
  and on navigating away/unmount.
- **Reopen** (ended sessions): `POST /sessions` with the same cwd, program,
  agent, task and project and `checkout: 'existing'` — a new process, never a
  second worktree.
- **Key bar v2** (coarse pointer only; `key-bar.tsx`, `editing-session.ts`
  idle → typing → sheet/compose, `joystick.ts`, `modifier-input.ts`: ⌃/⌥
  off/one-shot/locked, one delivered key takes them, text/paste untouched,
  cleared on disconnect/ownership change/backgrounding).
- **Compose sheet** (`compose-sheet.tsx`): Paste / Paste + Enter; per-session
  drafts in guarded localStorage ≤64 KB (`compose-drafts.ts`), cleared only
  when the server accepts the paste and the draft is still the sent revision.
  Storage failure leaves text in memory only. Draft images live in page
  memory (survive closing the sheet, not a reload); each accepted paste's
  parts leave the draft individually (`delivered()`), the rest stay.
  Desktop opens it when an image is dropped/pasted on the terminal or via
  Session actions › Compose…; Escape closes and keeps the draft.
- **Scroll routing** (`components/scroll-route.ts`, pure): vertical scroll goes
  to xterm history first, then pans. Wheels are taken in capture phase except
  for a full-screen program that enabled SGR mouse tracking
  (`programScrolls()`), which gets xterm's own one-report-per-event wheel after
  the pane's pan room. Touch never produces mouse clicks. Following pauses in
  history/pan/selection; only ↓ Live or focusing to type resumes.
- **Copy text…** (`copy-text-sheet.tsx`, `lib/copy-text.ts`): shows the
  newest text within 2,000 lines and 400,000 UTF-16 units; Copy all copies the
  whole snapshot (replica history ≤10,000 rows; tmux itself keeps 50,000). **OSC 52 offers** appear live only, with kit
  `CopyButton size="touch"`; only that tap writes the clipboard. **Full
  screen** is the host's `useFullscreen()` (`@makinbakin/sdk/hooks`).
- WebGL with DOM fallback (`terminal-renderer.ts`); plain URLs and OSC 8 open
  through one confirmed, no-opener, http/https/mailto handler.

## Attention (`lib/attention.ts`, `components/attention*.ts(x)`)

- States `needs-you | turn-finished | working`, or unset (= unknown). Set by
  the program's own hooks as pane option `@bakin_attention`, read through the
  control client's `bakin-attention` subscription. Shells have none.
- **Claude Code:** `--settings <root>/attention/claude-settings.json` (merges
  with user/project/plugin hooks). **Codex:** `-c hooks.<Event>=…` overrides;
  Codex runs them only after the operator trusts them once in Codex's review
  screen — Bakin never bypasses hook trust; until then the state stays
  unknown. `~/.claude` / `~/.codex` are never touched.
- Every hook runs `<root>/attention/bakin-terminal-attention <state> <scope>`
  (`HELPER_SCRIPT`, prints `{}`), targeting the session through env vars
  `BAKIN_TERMINAL_TMUX`/`_SOCKET`/`_SESSION` so the hook command line is
  identical in every session (Codex trusts by definition hash). Scopes:
  `always`, `main` (ignored when the hook input has a top-level `agent_id` —
  subagents), `stale` (clears only `working`/`needs-you`; Claude's idle prompt).
- Each new state is a numbered **occurrence** (`attentionSeq`);
  `acknowledge { occurrence }` marks only the one shown.
- **Bells:** a per-session `alert-bell` hook (set at create and on attach, not
  in the config — no service update) increments `@bakin_bell`; the session
  persists `bellCount` so any different count rang; `bellAt` at most once per
  30 s.
- **Activity:** active (output in the last 5 s) / quiet / exited, from real
  `%output` only.
- **Delivery:** server emits `terminal.attention { sessionId }` only.
  `TerminalAttentionProvider` (in `nav-badge-providers`) re-reads
  `GET /attention` on the event, on `bakin.reconcile`, and every 60 s (newest
  read wins) and derives announcements from the diff (`announcements()`), so a
  change missed while disconnected is told on the next read. Nav badge counts
  unacknowledged needs-you/turn-finished. Toast only in visible tabs; one OS
  notification across tabs of the same browser via an IndexedDB transaction
  (`claimOnce` — Web Locks need a secure origin; Bakin is often plain HTTP on
  a tailnet; without IndexedDB it fails open, every tab sends its own) and
  none while another Bakin tab has focus; the host's notification permission
  and focus rules still apply. Per-tab localStorage keys
  (`bakin-terminal-watching:<tab>`, `bakin-terminal-focused:<tab>`) suppress
  announcements for a session open and focused on this device; that tab
  acknowledges instead.

## Uploads / image paste (`lib/uploads.ts`)

- `POST /upload?id=&generation=` with raw bytes; PNG/JPEG/WebP by header
  sniffing (`sniffImage`, lengths checked), ≤10 MB (body read capped), ≤40 MP
  from the header (never decoded), ≤100 MB per session, ≤4 bodies read at
  once. Stored at `<root>/uploads/<sessionId>/<uuid>.<ext>` (0700/0600),
  recorded in the store. Ownership + generation checked before and again in
  the queue after the body arrives; `remove-upload` is generation-checked too.
- Sends (`composePastes` / `PasteSequence`): Claude/Codex get each image path
  as its own literal paste (they attach a path only when it is the whole
  paste), then the text; a shell gets one paste of text + shell-quoted paths.
  Pastes go strictly one after another; a paste names its uploads and they're
  marked sent once it went. ≤20 images per send.
- Retention: deleted with the session or its history; never-sent uploads (and
  orphan files) swept after 24 h; a draft naming a swept image is refused.
- Thumbnails use the SDK's `ComposerAttachmentTray`
  (`@makinbakin/sdk/conversation`) with a copy-path item action.

## Agent tool

`bakin_exec_terminal_session` (`requiresVerifiedAgent`): `list`, `create`,
`screen`, `output`, `write`, `interrupt`, `complete`, `terminate`. Agents see
only sessions assigned to them while in `enabledAgents` (default `['main']`;
empty = off). `write` needs `generation` and `sequence = inputSequence + 1`
(≤64 KiB; never retry). `screen` reads the replica (503 until seeded) and
returns `cols`/`rows`/`sizeRevision` from one step; `output` is history then
screen as plain lines (`lines` keeps the last N; an ended session's comes from
its bundle). No resize operation.

## Lifecycle and retention

- Ending a session (terminate, program exit via `pane_dead`, maintenance)
  saves a **final bundle**: the replica's last cut after `drainFinal`
  (bounded by `FINAL_CUT_MS` 3 s) via `Store.saveBundle` (sliced parts, one
  commit with the session flag, 250 MiB whole-bundle budget, oldest evicted).
  The save runs outside the queue with the session reserved (input refused);
  `Sessions.publishExit` registers it before the exit is visible, so an ended
  join waits (`finalSaved`) rather than showing "not saved". Best effort: a
  failed or timed-out save sets `outputSaved: false` (maintenance retries it),
  and the ended view says not saved / removed / unreadable
  (`lib/unavailable-notice.ts`). Shutdown drains accepted lifecycle work.
- **Maintenance** (`sweep()`, at activation, hourly, and on
  `tasks.statusChanged → done`): retry failed final saves first; sweep
  abandoned uploads; an exited session idle `idleDays` (default 30) is
  completed (pane killed); completed sessions get worktree `clean()`
  (otherwise `cleanupReason` → Health "worktrees need review"); history
  (bundle + uploads) is deleted 30 days after completion (hardcoded).
- Caps: `maxSessions` 10 live, `maxWorktrees` 10 retained.
- Health check `terminal.service`: service unavailable, maintenance failure,
  retention, service update, memory (>640 MB retained, structure-based
  estimate from `lib/memory.ts`, clears below 600 MB).
- **Rollback below T38b is destructive:** an older version opening the store
  deletes every bundle. T38b required a drained cutover.

## Testing

- Unit tests, from the Bits repo root:
  `FUZZ_SHARD=skip bun test --isolate --preload ./test/setup-dom.ts plugins/terminal/tests`
  (`FUZZ_SHARD=skip` leaves the checkpoint fuzz matrix to CI's shards;
  `FUZZ_SHARD=k/n` runs one shard; unset runs it all — slow).
- Real-tmux process tests (`*.integration.test.ts`, skipped otherwise):
  `TERMINAL_PROCESS_TEST=1 TERMINAL_TMUX=$HOME/.bakin/bin/tmux` + the same
  command. `TERMINAL_CLI_TEST=1` also starts installed Claude Code/Codex
  (no prompts submitted); `TERMINAL_MEMORY_TEST` gates the memory
  measurements. launchd survival probe: `bun probes/session-survival.ts`.
- Live preview: `bun plugins/terminal/tests/dev-server.ts` (Bits root;
  `TERMINAL_TMUX` or PATH tmux, `TERMINAL_PREVIEW_PORT` optional). Disposable
  root, own tmux server, only `patch` enabled, no Git hooks (use Existing
  checkout). It prints the URL, `tmux` and `root`.
- Browser tests (`tests/*.browser.test.ts`, `browser.integration.test.ts`),
  from the plugin dir: `TERMINAL_PREVIEW_URL=<url>`; handoff, attention,
  images and viewer overload/width tests also need `TERMINAL_PREVIEW_TMUX`
  (and `TERMINAL_PREVIEW_ROOT` where used); `TERMINAL_BROWSER=webkit` repeats on
  WebKit. Stop the preview to stop its shells.
- `bun run ui:conformance` (Bits root, `scripts/verify-plugin-ui.ts`) installs
  the real assembled SDK and runs the plugin's typecheck and tests against it
  (`verification: 'installed-package'`), plus the UI fixtures
  (`bun run test:ui` → `test-results/bakin-ui/index.html`). The root test run
  uses the ambient test SDK, so a green unit run is not SDK conformance.
- Never test against the live user's sessions; isolated roots only.

## Gotchas

- xterm is pinned at 6.0.0 on both sides (`tests/xterm-pin.test.ts`);
  `lib/xterm-fixes.ts` patches 6.0.0 internals, each with a test that fails
  once upstream fixes it. Bump replica and browser together.
- After a width change, compare with tmux's `capture-pane -J -S - -E -`; a
  discriminating case keeps the cursor inside a wrapped line.
- Echo latency must be measured in the page with keys >1 s apart: xterm
  throttles its accessibility rows to one refresh a second.
- Browser client ids use `crypto.getRandomValues` (HTTP LAN/Tailscale
  origins), never `randomUUID`. Browser HTTP routes require same origin and
  `X-Bakin-Terminal-Client` (`lib/http.ts human()`); the WebSocket (same
  origin enforced by the host upgrade handler) supplies `clientId` in its
  first `hello` instead.
- Viewers never answer terminal queries; tmux does. Don't let an emulator's
  generated reply leave a viewer.
- A request failure never implies the service needs installation.
- Physical iPhone/Android keyboard behavior is not proven by Chromium/WebKit
  emulation.

## Where the spec and code disagree

- D2 names the native size option `@bakin_client_size`; code (and D7) use
  `@bakin_client`, and detach is observed via `%client-detached` →
  `reconcileClients`, not a separate freeze rule.
- D9 item 5 lists an `unknown` attention value; code has three states and
  treats unset as unknown.
- D3 calls the setting `defaultSize`; the settings are `defaultCols`/
  `defaultRows`, mapped to `defaultSize` in `terminalSettings()`.
- The spec describes 30-day idleness as making work "cleanup-eligible";
  code auto-completes an exited session idle `idleDays` and deletes its
  history 30 days after completion (fixed, not `idleDays`).
- Session delete force-removes a retained worktree (`teardown: true`), unlike
  the no-force maintenance release.
