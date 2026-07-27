---
name: commit-messages
description: Write conventional commit messages from a staged diff. Use when the user asks for a commit message.
---

# Commit Messages

Read the staged diff. Produce a single conventional-commit line
(`type(scope): summary`), then a short body only when the change is non-obvious.
Never invent scope names — reuse the ones in `git log`.
