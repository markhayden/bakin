---
title: Development
description: "Task-scoped git worktrees for agents doing code work."
---

Bakin's Git plugin gives agents a controlled way to do code work without sharing the same checkout. An agent asks Bakin for a task worktree, receives a branch and path, works there, then releases the worktree when the PR or handoff is complete.

This is intentionally a small surface. It does not try to replace `git`, `gh`, or your normal review flow. It enforces the part that matters for concurrent agents: every code task gets its own working tree and Bakin keeps track of what is still active.

## How it works

1. The agent calls `bakin_exec_git_prepare_worktree` with a repo path and task id.
2. Bakin verifies the repo lives under an allowed root.
3. Bakin creates or reuses a worktree under the configured worktree root.
4. The agent runs edits, tests, commits, pushes, and PR commands from that returned path.
5. The agent calls `bakin_exec_git_status` before handoff.
6. When local cleanup is safe, the agent calls `bakin_exec_git_release_worktree`.

Release refuses to remove a dirty worktree unless `force=true` is supplied. That keeps unfinished local work visible instead of silently deleting it.

## Settings

<!-- docs:settings git -->
<div class="settings-table">

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| Allowed repo roots | `list` | `[]` | Directories agents may prepare git worktrees from (also gates dispatch repo binding). Empty = disabled until configured. |
| Worktree root | `string` | `~/.bakin/${DEFAULT_WORKTREE_DIR}` | Directory where Bakin-created worktrees are stored. |

</div>
<!-- /docs:settings -->

## For agents

Patch ships with the `git-isolation` runtime skill and is allowed to call the Git exec tools. Other developer agents should get the same tool allowlist and a similar procedure before they do code work.

<!-- docs:exec-tools git -->
- `bakin_exec_git_prepare_worktree`: Create or reuse an isolated git worktree for a task. Call this before editing code for a Bakin task.
- `bakin_exec_git_release_worktree`: Release a tracked git worktree. Refuses dirty removal unless force=true.
- `bakin_exec_git_status`: List Bakin-tracked git worktrees and their dirty state.
<!-- /docs:exec-tools -->

HTTP API surface for this plugin: see the [API reference](/docs/reference/generated/api/#git).

## Related

- [Team](/docs/using/team/): install and manage the Patch package.
- [Package Manifest](/docs/extending/agents/packages/): declare tool allowlists and runtime skills for agent packages.
- [Health](/docs/using/health/): doctor shows stale tracked worktrees if a path disappears outside Bakin.
