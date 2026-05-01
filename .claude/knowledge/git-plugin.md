# Git Plugin

## Purpose

The `git` core plugin owns task-scoped worktree isolation for code-producing agents. It exists because a skill-only convention cannot prevent multiple agents from editing the shared checkout at the same time.

## Public Surface

- REST routes:
  - `GET /api/plugins/git/worktrees`
  - `POST /api/plugins/git/worktrees/prepare`
  - `POST /api/plugins/git/worktrees/release`
- MCP exec tools:
  - `bakin_exec_git_prepare_worktree`
  - `bakin_exec_git_status`
  - `bakin_exec_git_release_worktree`
- Doctor check:
  - `git.worktrees`, warning when an active tracked worktree path is missing.

## Settings

- `allowedRepoRoots`: list of `{ path }` records or strings. Defaults to `~/go/src/github.com/markhayden`.
- `worktreeRoot`: path for Bakin-created worktrees. Defaults to `~/.bakin/git-worktrees`.

The plugin resolves real paths for both requested repos and allowed roots. A repo is accepted only when both the requested path and the actual git top-level are within a configured allowed root.

## Agent Contract

Developer agents should call `bakin_exec_git_prepare_worktree` before code edits, work only inside the returned `worktreePath`, call `bakin_exec_git_status` before handoff, and call `bakin_exec_git_release_worktree` only after local cleanup is safe. Release refuses dirty worktrees unless `force=true` is explicitly provided.

Patch is the first package wired to this contract through:

- `agents/patch/bakin-package.json` tool allowlist: `bakin_exec_git_*`
- `agents/patch/skills/git-isolation/SKILL.md`
- `agents/patch/workspace/TOOLS.md`

## Deliberate Scope

This first slice does not create PRs, push branches, or auto-prepare worktrees at dispatch time. The agent calls the tool once it knows the repository path for the task. PR creation remains normal `git`/`gh` workflow from inside the prepared worktree.
