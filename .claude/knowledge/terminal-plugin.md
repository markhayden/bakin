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
The session index uses `Page` plus route-backed `ListRows`; each session uses
`WorkspacePage` / `ImmersiveCanvas` with a compact Back link. There is no session
rail or navigation select. Agent assignment and paths live in the kit Popover;
completion/deletion actions live in DropdownMenu. Terminal icon tools have
explanatory kit tooltips, including focusable disabled controls. Fit resizes
only a session owned by this browser. No public API or design exception was
added. Shared kit fixes cover fractional-height compact-header activation,
viewport-bounded tooltips, and conformance of focusable disabled buttons.
