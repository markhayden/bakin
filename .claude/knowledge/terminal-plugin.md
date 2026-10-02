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
`recipes/terminal-input.stories.tsx — CompactAndExpanded`. No design exception
or new public export is needed. Existing workspaces retain host sizing.

## Mobile input and rendering

Terminal loads the matching xterm WebGL addon after opening the terminal.
Unavailable GPU contexts and context loss dispose the addon and restore the
normal renderer. Each terminal mount owns its renderer and event cleanup.

Narrow and touch-capable layouts reserve a persistent Esc/Tab/Ctrl/arrow strip.
More expands an in-place, bounded panel with editing, navigation, and common
Ctrl combinations. Kit buttons preserve existing editor focus on pointer taps;
keyboard activation remains native. Ctrl is one-shot and cancellable. Paste,
IME composition, focus leaving the interaction, disconnection, and session or
ownership changes reset it; routine resize does not. Cursor sequences follow
xterm's current normal/application mode. Every action uses the existing ordered
input queue and generation/ownership checks.

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
