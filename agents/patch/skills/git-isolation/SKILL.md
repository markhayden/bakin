---
name: git-isolation
description: Use before making code changes for a Bakin task so work happens in an isolated git worktree instead of the shared repo checkout.
---

# Git Isolation

Use this skill whenever you will edit code, run formatters that may rewrite files, or prepare a PR for a Bakin task.

## Procedure

1. Before editing, call `bakin_exec_git_prepare_worktree` with:
   - `repoPath`: the repository you will change
   - `taskId`: the Bakin task or issue id
   - `branch`: optional; use a clear `bakin/<task>-<summary>` branch when you know the branch name
   - `baseRef`: optional; defaults to `HEAD`
2. If preparation fails, stop and report the error. Do not edit the shared checkout.
3. Move into the returned `worktreePath` and do all code reads, writes, tests, commits, pushes, and PR work from there.
4. Before handoff, call `bakin_exec_git_status` for the task and confirm the worktree state matches what you are about to report.
5. After the PR is opened or the branch is no longer needed locally, call `bakin_exec_git_release_worktree`.

## Guardrails

- Never continue code edits in the original repo after a worktree has been prepared for the task.
- Never use `force=true` on release to hide unfinished work. Only force release when the user explicitly asks to discard local changes or when a missing worktree needs to be cleared from the registry.
- If the worktree is dirty at handoff, explain exactly what is uncommitted and why it remains.
- If multiple agents are working on nearby code, each agent must have its own prepared worktree and branch.
