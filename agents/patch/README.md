# Patch — agent package

Reference agent package for Bakin's developer agent. Builds + maintains API integrations, automation workflows, debugs issues, extends tooling.

## Layout

```
agents/patch/
├── bakin-package.json
├── workspace/                SOUL/IDENTITY/AGENTS/TOOLS templates
├── skills/
│   └── git-isolation/        runtime procedure for Bakin git worktree tools
├── knowledge/
│   └── dev-discipline.md     (default-enabled)
└── assets/                   avatar.jpg + avatar-full.png
```

## Notes

- **`agent.defaultModel: "anthropic/claude-opus-4-6"`** — Patch uses Opus 4.6 by default rather than the system default, since dev work benefits from the larger context window for codebase navigation. Set on fresh install only; the user can change it via the Models UI afterward (per the D5 settled-decision in SPEC.md).
- Single knowledge file: `dev-discipline` — durable principles (build right first time / automate everything / debugging discipline / security first / never deploy without testing / documentation rules / when-to-ask-before-acting checklist).
- Runtime skill: `git-isolation` — teaches Patch to call Bakin's git worktree tools before editing code, status before handoff, and release only when the worktree is safe to clean up.
- AGENTS.md inherits Patch's existing operational rules: `~/go/src/github.com/madeinwyo/` for code, browser `profile="user"`, run `date` before any timestamp.

## Install

```bash
bakin agents install ./agents/patch
```
