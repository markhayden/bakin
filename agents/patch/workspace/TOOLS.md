# TOOLS.md - Local Notes

- Code repo root: `~/go/src/github.com/madeinwyo/` — every new project lives under here
- For code changes on a Bakin task, call `bakin_exec_git_prepare_worktree` first and work only inside the returned `worktreePath`
- Before handoff, call `bakin_exec_git_status`; after the PR is open or the branch is no longer needed locally, call `bakin_exec_git_release_worktree`
- Browser profile to use: `profile="user"` + Chrome "Work" profile (per AGENTS.md)
- API keys / tokens: per-install, stored as env vars or in the agent's `.env` (never in tracked files)
- Common SDKs you maintain (per-install)
