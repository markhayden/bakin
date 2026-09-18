# Terminal Plugin

Status: Approved for implementation. MacOS-first core and official Bits implementations
are on isolated `feat/terminal-plugin` branches. See the implementation record in
`terminal-plugin-plan.md`; production installation/publishing is not included.
Started: 2026-09-08

## Objective

Give Bakin's user and agents access to terminal sessions through an installable
plugin, with a Terminal navigation item and xterm.js browser rendering. Enable
interactive use of installed programs, including Claude Code and Codex CLIs.

This replaces the SMS exploration as the active project.

## Confirmed Requirements

- Build a terminal plugin using xterm.js.
- Provide terminal access for both the user and agents.
- Support the intended use of Claude Code and Codex CLIs.
- Follow the Bakin kickoff interview, specification, plan, and verification process.
- Target Bakin's single-user, single-machine architecture.
- Shared interactive sessions that agents can operate and the human can observe
  and take over, with one active input owner per session (D1).

## Accepted Decisions

### D1: Shared Interactive Sessions

Approved 2026-09-08. The human and agents access the same live terminal sessions.
An agent can launch and operate an interactive CLI while the human observes and
can take over. Enforce one active input owner per session to prevent conflicting
commands. Takeover and return-of-control semantics are defined in D2.

### D2: Explicit Human Takeover

Approved 2026-09-08. An explicit Take Control action transfers input ownership
to the human and blocks further agent input until the human explicitly hands
control back. Merely viewing a session does not change ownership. Taking control
does not interrupt the running program; interruption is a separate action.

The backend must enforce ownership on input, including stale or queued agent
requests that arrive after takeover. Input already delivered to the PTY cannot
be recalled, and a CLI already working may continue executing its own actions.
Takeover must therefore never be presented as pausing the running CLI.

### D3: General Shell and Coding CLI Launchers

Approved 2026-09-08. Provide a general-purpose shell with convenient launch options
for Claude Code and Codex. Both the human and authorized agents can use sessions
for ordinary shell work, including tests, file inspection, and Git operations.
Processes run on the Bakin host with the filesystem permissions of Bakin's
operating-system account. Selecting a working directory is not a sandbox.
Directory selection defaults and credential/environment handling remain to be
specified; this decision does not authorize changing CLI permission settings.

### D4: Preserve Sessions Across Bakin Restarts

Approved as a feasibility-dependent requirement on 2026-09-08. Sessions should
survive browser navigation, refresh, and disconnects, and Bakin server restarts
or updates. Machine reboot survival is not required. Prove restart survival
before committing to an implementation that claims it.

Candidate: a plugin-private tmux server holds the shell/CLI processes; Bakin
attaches to and detaches from those sessions. Upstream documents detached
sessions continuing in the background, but the actual Bakin service supervisor's
process cleanup behavior must be tested. A detached child alone is not proof
of survival under launchd or systemd restarts.

Discovery: `command -v tmux` did not find tmux on the current PATH. Installation,
service supervision, private socket ownership, and plugin removal behavior are
unresolved. Existing pinned binary provisioning belongs to capability packs;
do not assume plugins already have that manifest contract. No dependency was
installed and no restart-survival test has run.

Acceptance must cover reconnecting to the same process, preserving human input
ownership across restart, and reporting exited sessions honestly without
automatically replaying commands. Keep plugin sessions separate from any
unrelated user tmux sessions.

### D5: Per-Agent Enablement

Approved 2026-09-08. Terminal access is enabled individually for agents rather
than automatically available to every agent. Enforce this policy at the backend
for plugin operations; hiding tools or controls alone is insufficient.

Cross-agent session visibility and handoff rules are defined in D6.
During technical discovery, verify how each runtime supplies trustworthy caller
identity to plugin tools; do not trust a caller-supplied `agentId` as authorization.
This policy controls plugin access, not OS-level isolation between processes
running under the same user account (D3).

### D6: Session Assignment and Visibility

Approved 2026-09-08. The human can view all terminal sessions. An enabled agent
can see only sessions assigned to that agent. The human may explicitly hand a
session to another enabled agent, transferring access while preserving the
single-input-owner rule.

Apply assignment checks to session listing, output reads/subscriptions, input,
and other session operations. On reassignment, revoke the former agent's plugin
access, including active subscriptions and pending writes. Keep agent assignment
distinct from current input ownership so human takeover and hand-back remain
well defined. These are plugin-level controls, not filesystem isolation (D5).

### D7: Isolated Coding Worktrees by Default

Approved 2026-09-08. Coding sessions default to a separate Git worktree with its
own branch and working files. Offer an explicit option to use an existing
checkout. General shell sessions open in a chosen directory.

Reuse Bakin's Git ownership and isolation conventions. Inspection of
`plugins/git/index.ts` shows that preparation currently requires a `taskId` and
its registry is task-scoped. Session-owned worktrees therefore require a vetted
contract extension or another supported ownership path; do not invent task IDs
or create dummy tasks to satisfy that interface. The existing release operation
refuses dirty worktrees unless explicitly forced. Retention and cleanup
requirements are recorded in D8.

### D8: Bounded Worktree Retention and Cleanup

Approved 2026-09-08: stopping a terminal preserves its work, but the plugin must
automatically clean eligible worktrees and bound accumulation. The user accepted
the completion-based cleanup and configurable cap, adding a recurring review of
work that has sat for 30 days or more.

Accepted policy:
- Distinguish ending a process from explicitly marking a session complete.
- Automatically remove a completed session's plugin-created worktree once no
  live session uses it, it has no tracked or untracked changes, and all commits
  are reachable from the intended integration branch. Cleanup must also account
  for ignored files, submodules, and other local content before deletion; ordinary
  `git status` being clean is not sufficient evidence that nothing will be lost.
- Retain incomplete, changed, or unmerged worktrees and surface the reason.
- Limit retained plugin-created worktrees to 10 by default, configurable.
  At the limit, attempt eligible cleanup, then refuse new isolated worktrees
  until space is freed or the limit is raised. Never evict unfinished work.
- Keep existing-checkout sessions outside automatic worktree cleanup.

Thirty-day sweep:
- Periodically find plugin-created worktrees with no meaningful activity for
  at least 30 days. Evaluate them against the same cleanup safeguards.
- Clean eligible completed worktrees automatically; surface stale unfinished,
  changed, or unmerged work for explicit completion or discard decisions.
- Age alone does not authorize discarding work or terminating live processes.
  Revalidate active use and filesystem state at cleanup time.
- The implementation plan must define meaningful activity, sweep cadence,
  restart catch-up, and how cleanup findings appear without repeated noise.

Technical follow-ups:
- Preserve branches initially; branch pruning needs a separately verified policy.

Implementation must coordinate cleanup with session launch/reattach so a worktree
cannot be removed while becoming active. Integration ancestry and squash-merge
handling require explicit technical rules; uncertainty retains the worktree.

### D9: Optional Task and Project Links

Approved 2026-09-08. Sessions may optionally link to a Bakin task or project;
standalone sessions remain supported. Linked sessions should make their work
and branch discoverable and help coordinate cleanup when task work finishes.
Task completion does not override D8's active-process and work-preservation
checks. Specify link validation, deleted-reference behavior, and completion
eligibility in the implementation plan using existing task/project interfaces.

### D10: Bounded Output History

Approved 2026-09-08. Retain bounded terminal output for 30 days after session
completion, with manual deletion available. Output remains reviewable after
the associated worktree is cleaned up. Do not separately record keystrokes.
Shell-echoed input is still terminal output; this is not a guarantee that
commands or sensitive output never appear in retained history.

Define byte limits, truncation markers, active-session rotation, retention
expiry, and deletion in the implementation plan. Apply the same assignment
and access checks to retained output as to live sessions.

## Working Assumptions

These are proposals for discussion, not accepted decisions:

- Ship an installable plugin; determine its source repository during discovery.
- Proposed source: `bakin-bits-official/plugins/terminal`, using its public template.
- Use Bun's PTY support for the session backend and xterm.js for the browser.
- Treat first-class coding runtime integration as a separate scope decision.

## Verified Foundation

- Local Bun is 1.3.13 and exposes `Bun.Terminal`.
- A short `/bin/sh` probe confirmed terminal stdin/stdout with exit code 0 and
  output `PTY_OK`. This did not test interactive CLI compatibility.
- Both `claude` and `codex` executables resolve in the current shell. Availability
  and authentication under the running Bakin service still need verification.
- Plugin manifests support navigation, browser routes, server routes, and tools.
- The inspected plugin HTTP route contract has no WebSocket registration member.
  Transport choice and any required host extension remain unresolved.
- `.claude/knowledge/plugin-system.md` describes plugin installation and lifecycle.
- `.claude/knowledge/adapter-architecture.md` distinguishes runtime capabilities
  from persistent Bakin-side services. Terminal tooling must respect that boundary.
- Plugin exec handlers receive an `agent` argument separately from tool params.
  Pi's tool bridge binds it from the runtime turn. The inspected MCP entrypoint
  initially reads identity from the URL's `agent` parameter; that alone is not
  authenticated identity. Review transport authorization and HTTP tool paths
  before claiming D5/D6 enforcement across runtimes.
- `packages/host/src/api/exec-tools/[toolName].ts` also accepts a body-supplied
  agent identity. Sensitive tools need a verified invocation context or must
  reject that path; otherwise per-agent checks are bypassable over HTTP.
- `packages/host/src/api/_adapter.ts` streams Web Response bodies and forwards
  disconnects through `Request.signal`. Evaluate session-scoped output streaming
  plus ordered input POSTs before adding a WebSocket contract. Shared activity
  SSE must not carry terminal content.
- Bakin's launchd/systemd service definitions live in
  `src/cli/commands/lifecycle.ts`. The terminal process owner must have a lifetime
  independent of that service; test supervised restarts, not just a killed client.
- The sibling `bakin-bits-official` repository has an installable-plugin template
  including `bakin.ui-test.ts` and `tests/ui.fixture.tsx`. It is the proposed
  terminal source location. No files there have been modified.

Sources:
- https://bun.sh/reference/bun/Spawn/SpawnOptions/terminal
- https://xtermjs.org/docs/guides/security/
- https://developers.openai.com/codex/cli/
- https://code.claude.com/docs/en/cli-usage
- https://github.com/tmux/tmux/wiki

## UI Working Contract

Selected page reference: `storybook/public/pages/workspace-page.stories.tsx`,
`FullBleedWorkspace`, with `CanonicalUsage` establishing the composition contract.

Proposed composition: `WorkspacePage`, `WorkspacePageHeader`, and
`WorkspacePageBody` from `@makinbakin/sdk/patterns`; standard controls from
`@makinbakin/sdk/ui`; route and selection state through
`@makinbakin/sdk/navigation`. xterm.js occupies the plugin-owned workspace body.

Validate xterm.js stylesheet containment, sizing, focus, keyboard escape, and
accessibility before treating this composition as proven. Cover empty, starting,
running, disconnected/reconnecting, exited, failed, and input-owned-by-another
states, plus narrow screens and long output. Any required system extension or
deviation follows the UI conformance skill's explicit approval process.

## Decision Queue

Resolve these one at a time; explore repository-answerable details directly.

1. Resolved in D1: shared interactive sessions with one active input owner.
2. Takeover/access/assignment resolved in D2/D5/D6; browser-viewer details remain.
3. Shell/launchers resolved in D3 and coding directories in D7; environment remains.
4. Restart survival recorded in D4, pending feasibility; termination/removal remain.
5. Agent observation: bounded output, screen state, waiting, and interruption.
6. Transport: existing plugin HTTP/streaming facilities versus a host extension.
7. Packaging: source repository, installation, supported operating systems.
8. History retention resolved in D10; technical limits and CLI validation remain.

Remaining technical decisions are assigned to the feasibility checkpoint in
`terminal-plugin-plan.md`. Any material product tradeoff returns to the user;
routine implementation details follow the accepted decisions and repo contracts.

## Verification and Boundaries

Use TypeScript strict mode, Zod at input boundaries, and the SDK's public plugin
contracts. Match the official plugin template: kebab-case files, named handlers,
inferred schema types, and focused SDK imports. For example:

```ts
import { z } from 'zod'

export const SessionLinkSchema = z.object({
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
})

export type SessionLink = z.infer<typeof SessionLinkSchema>
```

Test sessions must use temporary directories and controlled subprocesses. Mock
runtime services so automated tests never trigger real agent work. Verify process
cleanup, reconnect output continuity, input ownership, resize, interruption,
bounded buffering, and access enforcement as their contracts are agreed.

Host commands, when applicable:

```sh
bun run typecheck
bun run lint
bun run ui:conformance --quick
bun run ui:conformance --full
bun run test
bun run build
```

The implementation plan will name exact focused tests and the external plugin's
build and `bun run test:ui` fixture commands after selecting its repository.
Browser validation must exercise real PTY output, reconnects, desktop/mobile
layout, and installed interactive CLI behavior in an isolated working directory.

Always preserve provider CLI permission controls. Define terminal authorization,
request-origin checks, environment handling, and input/output retention explicitly;
an ordinary working-directory choice does not sandbox a shell. Never record
credentials in specifications, fixtures, or audit metadata.

## Plan and Commit Strategy

See `terminal-plugin-plan.md` for architecture candidates, feasibility gates,
ordered implementation slices, verification, and rollback checkpoints. Production
implementation follows validated feasibility and approval of the resolved plan.

## Current Verification

Discovery only. The local PTY probe passed in the preceding exploration.
The existing `bun run ui:conformance --quick` suite passed after preparing this
spec and plan: 227 UI architecture tests passed and TypeScript passed. This
validates the current repository baseline, not an implemented terminal plugin.
No terminal plugin code, interactive CLI session, browser fixture, or build has run.
