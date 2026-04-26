---
title: Messaging
description: Use Bakin messaging for content calendar items, planning sessions, approvals, and proposals.
---

Messaging supports content planning and approval workflows. It tracks items, planning sessions, messages, proposals, approvals, and rejections.

## Common Commands

```sh
bakin messaging list --status=draft
bakin messaging create "Launch post" patch --channels=discord
bakin messaging approve item-123
bakin messaging reject item-123 "Needs a clearer CTA"
bakin messaging sessions --status=open
bakin messaging message session-123 "Draft three options"
```

## Operator Notes

- Use planning sessions when the final item needs discussion or proposals.
- Approve items only when they are ready to schedule or publish.
- Use rejection notes to create useful context for agents and future review.

## Reference

- [CLI Reference](/reference/generated/cli/)
- [Exec and MCP Tool Reference](/reference/generated/exec-tools/)
