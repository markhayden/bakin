# Terminal Plugin Plan

Status: Approved and implemented in isolated core/Bits development checkouts.
The original plan below is retained as planning history; the implementation
record is authoritative for concrete paths and verified limitations.

## Implementation Record (2026-09-09)

- Core: `/private/tmp/bakin-terminal-core`, branch `feat/terminal-plugin`.
- Bits: `/private/tmp/bakin-terminal-bits`, branch `feat/terminal-plugin`.
- Source is `plugins/terminal` in Bits, not a built-in Bakin plugin. No production
  installation, restart, publishing, release tagging, or paid agent work occurred.
- Chosen process path: launchd-supervised private tmux 3.7c, Bun PTY attachment,
  xterm.js 6 browser and headless screen parser. HTTP pull-based SSE and ordered
  POST input satisfy the terminal transport; no WebSocket host extension.
- Chosen storage: plugin-private SQLite/WAL, bounded output payloads and parser
  queues, retained ownership metadata. Restart detaches the host attachment only.
- Verified caller context is passed by Pi; OpenClaw receives per-agent HMAC
  bearer credentials through MCP provisioning. Protected tools reject plain
  agent names and generic HTTP exec. Credentials are checked on every request.
- Worktrees use the existing Git registry with explicit session ownership,
  serialized mutation, actual-HEAD ancestry checks, ignored/untracked checks,
  and conservative in-use detection. Branches are not automatically deleted.
- Required preflight blocks remove/unlink from stranding persistent resources.
- Idle review is hourly (plus startup/completion/capacity checks), default30days;
  live processes and unfinished work always prevent deletion. Output expires
  30 days after completion; payload caps are10MiB/session and250MiB total.
- Project IDs are optional navigation metadata, not validated project ownership;
  task IDs are validated. Project/task status does not authorize deletion.
- macOS service setup only. Reboot/server failure does not preserve processes.
  CLI profiles retain their normal permissions/authentication; cwd is no sandbox.

### Verification Recorded

- Isolated launchd host restart retained the shell PID, counter, resize and
  interrupt behavior (`probes/session-survival.ts`).
- Real tmux integration passes manager restart, shell input, resize, termination,
  plus opt-in Claude Code/Codex interactive startup without submitting prompts.
- Playwright live preview passes shell creation/input/reconnect/termination,
  desktop/mobile screenshots and zero browser runtime errors.
- Public SDK Terminal UI fixture passes; pattern is `FullBleedWorkspace`, focused
  `/patterns`, `/ui`, `/navigation`; no UI contract extension or exception.
- Ownership, retained work, history expiry, output limits, UTF-8/alternate screen,
  required removal preflight, MCP binding and protected HTTP denial have focused
  passing regression tests. Bits builds all three plugins against the real SDK.
- Broad checks and exact final gate status are recorded in the handoff/evidence
  document. Initial sandbox full-suite failures include local server bind errors;
  a later duplicate broad run was cancelled to remove resource contention.

### Known Release Gates

- Publish/version the matching core/SDK prerequisites before releasing Terminal;
  the old numerical manifest minimum alone does not establish compatibility.
- Broad full-suite/full-conformance checks must be green or explicitly reviewed
  before merge. No baseline, API freeze, or performance allowance is loosened.
- No Linux service support or multi-user/hostile-agent sandbox is claimed.

## Original Approved Plan

Product contract: [terminal-plugin.md](terminal-plugin.md), decisions D1-D10.

## Proposed Architecture

- Source: `bakin-bits-official/plugins/terminal`, following `plugins/_template`.
  Core prerequisites live in Bakin. Use isolated branches/checkouts for each
  repository, preserving existing working-tree changes.
- UI: Terminal navigation item and routed session workspace. Compose the
  `FullBleedWorkspace` story through the focused SDK entrypoints named in the
  spec. xterm.js is the plugin-owned terminal renderer, not a replacement shell.
- Process owner: a plugin-private tmux server supervised independently of the
  Bakin service is the leading candidate. Bakin attaches through Bun's PTY
  support. Investigate tmux control mode for output, screen capture, and resize;
  choose one canonical process/output path after the spike, not two registries.
- Browser transport: first evaluate session-scoped HTTP output streaming plus
  ordered input POSTs. This fits existing plugin routes. Carry opaque byte data
  and explicit stream cursors/generations; never replay ambiguous input on retry.
  Use a scoped WebSocket extension only if measurements or semantics require it.
- Session manager: plugin-owned metadata, assignment, input ownership, terminal
  dimensions, process references, optional task/project links, and bounded output.
  Keep manager secrets and sockets outside browser-served assets.
- Agent surface: create/list/read-screen/read-output/write/interrupt/complete
  operations over the same session manager. Reads are bounded, waits have timeouts,
  and tool results report cursor gaps and process exits explicitly. Agents do not
  parse browser DOM or receive an unbounded raw escape-sequence dump.
- Access: verified caller context plus per-agent enablement and assignment.
  Human takeover advances an ownership generation so stale writes fail. Treat
  browser attachments as distinct writers; viewing does not claim control.
- Git: extend existing worktree ownership to represent terminal sessions as well
  as tasks. No dummy tasks. Terminal retention outlives dispatch runs, so their
  cleanup lifetimes must remain distinct. Existing Git state remains authoritative.
- Storage: scoped plugin data with atomic metadata writes and bounded output
  files. Retain completed output 30 days. Do not send terminal contents to shared
  activity streams, audit logs, search, or exception logs.

## Working Defaults to Validate

These are engineering proposals, not additional accepted product decisions.

- Ten retained plugin-created worktrees, as agreed; initially ten live terminal
  sessions independently of that limit, configurable without deleting sessions.
- Output: retain a rolling 10 MiB per session, 250 MiB aggregate ceiling, with
  visible truncation. Rotate active output too; completion starts the 30-day TTL.
  Keep only bounded screen/scrollback state needed for reconnection.
- Maintenance: check on startup and daily, plus on completion and capacity checks.
  Last meaningful activity derives from input and repository changes, not merely
  a spinner or periodic terminal redraw. Live process use always prevents cleanup.
- Completion is a distinct verb; a linked task completion may request eligibility
  evaluation but never terminate a process or discard work on its own.
- Keep CLI permission modes intact. Use installed local CLI profiles; do not
  copy credentials into plugin storage or forward all of Bakin's injected secrets.
  Verify the launch environment under the actual service identity.
- macOS is the first live acceptance target. Linux support requires corresponding
  service lifecycle evidence; do not claim it from mock tests alone.
- Uninstall must explicitly address persistent processes and retained work before
  its existing destructive teardown. Determine whether the current uninstall hook
  can support this or whether a preflight contract is needed. Restart is detach;
  uninstall is not silently treated as restart.

## Phase A: Feasibility and Contract Checkpoint

This phase resolves core architectural decisions before production code. Use
temporary homes, sockets, repositories, ports, and an isolated service label.
Do not restart the user's running Bakin or invoke production agent work.

### A1: Restart Survival

- Build a disposable tmux/Bun probe and record the exact installation method and
  version. Prove the shell PID and a running counter survive browser disconnect,
  attachment-process death, and restart of an isolated Bakin-shaped launchd job.
- Verify reconnection, resize, interrupts, process exit, and complete teardown of
  only the probe's service and socket. Explicitly exercise process-group cleanup.
- Files: probe, focused process test, and evidence document (at most three).
- Verify: `bun test tests/terminal/session-survival.test.ts --isolate` in the
  isolated probe, plus the documented launchd reproduction commands.
- Acceptance: demonstrated process continuity under service restart, no leaked
  probe process, and a supported install path without ad hoc unpinned downloads.

### A2: Caller Identity and Ownership

- Trace Pi invocation, OpenClaw MCP provisioning, generic HTTP exec, and browser
  requests. Define the smallest verified invocation-context contract required.
- Specify how credentials bind to agent identity where transport needs them;
  plain query/body agent names cannot authorize terminal access. Missing verified
  identity fails closed. Preserve the single-OS-user trust limits stated in D5.
- Define atomic takeover, stale-write rejection, reassignment, disabling an agent,
  and browser disconnect/reconnect behavior. Retain human ownership on disconnect.
- Files: contract proposal and focused transport/ownership probes, at most five.
- Acceptance: a reviewed contract and tests demonstrating that forged agent names
  and stale ownership cannot invoke protected terminal operations.

### A3: Terminal Rendering and Transport

- Render xterm.js inside the existing plugin UI fixture. Check stylesheet scoping,
  keyboard escape, accessibility support, narrow layout, font metrics, and resize.
- Compare HTTP streaming with the required interactive behavior: typing, large
  paste, high-volume output, reconnect, alternate screen, cursor redraw, and Unicode
  split across chunks. Bound slow consumers and stop subscriptions on disconnect.
- Files: probe fixture, browser test, package dependency declaration/lockfile,
  evidence document. Keep it disposable until the public composition is verified.
- Acceptance: evidence of correct interactive rendering and reconnect at desktop
  and mobile widths; choose one transport and record why it satisfies the contract.
- Any design-system gap must have the exact story/mismatch explanation and
  explicit approval before a deviation or public extension is implemented.

### A4: Git and Installation Contracts

- Define explicit task/session worktree ownership and plugin-facing hooks using
  the existing Git implementation; review effects on task dispatch and diagnostics.
- Validate cleanup eligibility with untracked/ignored files, nested repos,
  submodules, and unmerged commits. Squash merges require evidence or explicit
  review; never treat uncertain ancestry as permission to discard a checkout.
- Inspect official plugin installation and uninstall preflight, and settle how
  tmux/helper dependencies and the independent service are provisioned.
- Files: contract proposal, isolated Git fixtures/tests, and evidence (at most five).
- Acceptance: no duplicate Git registry, no fake task IDs, no deletion of existing
  checkouts, and a reviewable install/restart/uninstall lifecycle.

### Checkpoint A

Rewrite the technical spec and remaining plan from the evidence. Every core
decision must be resolved before production implementation. If a candidate
fails, report the concrete product tradeoff and resolve it with the user.

Commit: `docs: specify terminal session contracts and feasibility evidence`.
Verification: all probe criteria above, reviewed sources, no credentials or
production paths in fixtures. This is the first natural rollback checkpoint.

## Subsequent Implementation Slices

Finalize exact file lists and commands at Checkpoint A. Each slice is a separate
commit with its tests; split any slice exceeding roughly five files before coding.
New paths below are proposed, not existing test targets.

| Slice | Scope and Likely Files | Acceptance and Verification |
| --- | --- | --- |
| B1 | Bakin: exec-tool invocation types, provider, focused tests | Verified principal can reach protected handlers; ordinary tools retain their behavior. Run focused provider tests and typecheck. |
| B2 | Bakin: MCP/HTTP dispatch, adapter provisioning, focused tests; split by transport | Agent names alone cannot authorize protected tools; supported runtime transports pass parity tests. |
| B3 | Bakin: `plugins/git/index.ts`, `tests/core/git-worktree.test.ts`, Git docs; split contract extraction if needed | Task and session owners work without changing dispatch cleanup semantics. Dirty/unmerged preservation tests pass. |
| B4 | Bakin SDK and Bits test SDK: export only approved new contracts, with contract tests | Plugin builds against public SDK; no imports from host internals. Version/dependency requirements reflect the new contract. |
| C1 | Bits `plugins/terminal`: manifest, package, server entry, schemas, isolated test | Installable server-only foundation validates settings and starts no process on import. |
| C2 | Terminal `lib/service.ts`, `lib/processes.ts`, installation/health tests | Explicit setup creates the independent process owner; boot/restart/health/removal satisfy A1/A4. |
| C3 | Terminal `lib/store.ts`, `lib/ownership.ts`, corresponding tests | Atomic metadata, per-agent checks, takeover and reassignment persist correctly across reconnect/restart. |
| C4 | Terminal `lib/sessions.ts`, `lib/transport.ts`, route modules, focused tests | Create, stream, input, resize, interrupt, and terminate work through one manager with bounded buffers. |
| C5 | Terminal worktree/link modules and tests | Default isolated coding checkout, explicit existing-checkout path, valid optional links, and cap enforcement work end to end. |
| D1 | Terminal client registration, manifest nav/routes, workspace component and tests | Terminal nav opens the existing WorkspacePage composition; lazy loading and route selection work. |
| D2 | Terminal xterm component, connection hook, domain styles, browser tests | Real terminal interaction, reconnect, narrow view, keyboard escape, and status states pass fixture checks. |
| D3 | Terminal agent tools, ownership controls, focused tests | Enabled assigned agents use the same sessions; takeover rejects delayed agent writes; reads return bounded useful screen/output. |
| E1 | Terminal history/maintenance modules and tests | Output survives completion, expires after 30 days, supports deletion, and never grows past configured bounds. |
| E2 | Terminal cleanup/health modules and tests | Completion/daily/startup sweeps preserve unfinished work, identify 30-day stale work, and enforce the worktree cap. |
| E3 | Terminal CLI launch configuration and integration tests | Shell, Claude Code, and Codex launch in intended directories under service identity with permissions intact. |
| F1 | Plugin README, affected core knowledge, fixture/configuration docs, release readiness evidence | Installation and lifecycle are documented; full acceptance matrix and quality review pass. |

## Commit and Rollback Strategy

1. Checkpoint A commits only the resolved contract and evidence. Remove disposable
   probes or promote useful isolated regression tests deliberately.
2. B1-B4 land as independent core prerequisites, each with focused tests. Protect
   all existing task/runtime consumers. Do not consume unpublished SDK changes
   by importing repository internals from the plugin.
3. C1-C5 establish a verified service/API path. Plugin shutdown detaches; sessions
   and worktrees are not treated as disposable build artifacts on rollback.
4. D1-D3 deliver the browser and agent workflow. Commit UI evidence with each
   affected slice; do not defer keyboard/reconnect verification to the end.
5. E1-E3 complete bounded retention, cleanup, and real CLI acceptance.
6. F1 is the merge-ready checkpoint. Reverting plugin code preserves retained
   work; service removal and data discard are explicit lifecycle operations.

No publishing, release tagging, or production installation is included in this
draft approval. Test installation uses an isolated Bakin home.

## Verification Commands

Bakin, narrow prerequisites first:

```sh
bun test tests/core/exec-tool-provider.test.ts --isolate
bun test tests/core/mcp-server.test.ts --isolate
bun test tests/core/git-worktree.test.ts --isolate
bun test tests/api/web-adapter.test.ts --isolate
bun run typecheck
bun run lint
bun run ui:conformance --quick
```

Official Bits, with its required DOM preload through the test script:

```sh
bun run test plugins/terminal/tests
bun run typecheck
bun run lint
bun run build
```

Add the template-derived terminal UI fixture and its `test:ui` script, then run
`bun run test:ui` from `plugins/terminal` and inspect
`test-results/bakin-ui/index.html`. The exact fixture command must be confirmed
against the installed public SDK at Checkpoint A, not invented from older docs.

Before merge-ready handoff, run Bakin's `bun run test`, `bun run build`, and
`bun run ui:conformance --full`, plus the affected Bits full checks. Use existing
runtime conformance tests when changing invocation/provisioning boundaries.
Review with `code-review-and-quality`; use `shipping-and-launch` if the user
extends the task to a PR or release.

## Acceptance Evidence

- Real shell and interactive coding CLI sessions, isolated from production work.
- Browser disconnect and actual isolated service restart preserve process identity.
- Disable/reassign/takeover races and forged-identity requests cannot write or read
  through protected plugin paths; already delivered commands are not undone.
- Reconnect restores valid terminal state, including alternate-screen programs.
- Streaming and history limits are enforced under a noisy subprocess and slow reader.
- Worktree cleanup never runs on a live, changed, or unmerged checkout.
- Thirty-day maintenance and history expiry use a controlled clock in tests.
- Desktop/mobile screenshots, DOM/console/network checks, and keyboard checks pass.
- Installation, health diagnostics, uninstall behavior, and restart semantics agree.
