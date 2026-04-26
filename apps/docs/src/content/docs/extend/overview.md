---
title: Extend Bakin
description: Overview of Bakin extension points for plugin authors, agent authors, and SDK consumers.
---

# Extend Bakin

Bakin is designed to be extended through documented contracts, not internal imports.

Extension authors use:

- `@bakin/sdk/*` for plugin-facing code.
- plugin manifests for package metadata.
- server routes for plugin APIs.
- client pages and slots for UI.
- hooks for cross-plugin contracts.
- exec/MCP tools for agent-facing operations.
- agent packages for reusable agent behavior.

## Extension Rules

- Prefer SDK components and helpers.
- Do not import host internals.
- Do not import another plugin's internals.
- Public extension points require metadata, schemas, examples, visibility, and stability.
- Examples must be tested or explicitly marked illustrative.
