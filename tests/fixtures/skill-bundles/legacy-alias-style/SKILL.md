---
name: reddit-readonly
description: >-
  Browse and search Reddit in read-only mode using public JSON endpoints.
  Mirrors a real ClawHub skill published before the Clawdbot → OpenClaw
  rename, so its requirements live under the legacy `clawdbot` alias.
metadata: {"clawdbot":{"emoji":"🔎","requires":{"bins":["node"],"env":["REDDIT_RO_USER_AGENT"]}}}
---

# Reddit Readonly

Run `scripts/reddit-readonly.mjs` to list posts. Read-only; never posts or votes.
