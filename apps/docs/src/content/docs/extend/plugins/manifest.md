---
title: Plugin Manifest
description: Define the public plugin metadata Bakin uses to install, load, validate, and document a plugin.
---

Every plugin starts with `bakin-plugin.json`. Bakin reads this file before loading plugin code, so keep it boring, explicit, and stable.

The tested manifest fixture for these docs lives at `apps/docs/snippets/plugin-basic/bakin-plugin.json`.

<!-- docs:snippet plugin-basic-manifest -->
Source: `apps/docs/snippets/plugin-basic/bakin-plugin.json`

```json
{
  "id": "docs-basic",
  "name": "Docs Basic",
  "version": "0.1.0",
  "bakin": ">=0.1.0",
  "description": "Minimal plugin used by the public Bakin docs.",
  "entry": {
    "server": "index.ts",
    "client": "client.tsx"
  },
  "permissions": [
    "routes:read"
  ]
}
```
<!-- /docs:snippet -->

## Required Fields

| Field | Meaning |
| --- | --- |
| `id` | Stable machine id. Use lowercase letters, numbers, dashes, and underscores. |
| `name` | Human-readable plugin name. |
| `version` | Plugin version. Use SemVer. |
| `bakin` | Compatible Bakin version range. |
| `description` | Short public summary. |
| `entry.server` | Server entry loaded by the plugin runtime. |

## Optional Fields

| Field | Meaning |
| --- | --- |
| `entry.client` | Client entry loaded into the Bakin shell. |
| `contentFiles` | Files the plugin contributes to Bakin content. |
| `secrets` | Secret names the plugin expects. |
| `tests` | Plugin-local test command. |
| `dependencies` | Runtime package dependencies. |
| `permissions` | Capability labels used for review and future policy enforcement. |

## Authoring Rules

- Treat `id` as permanent once users install the plugin.
- Keep entries relative to the plugin root.
- Declare permissions before adding new routes, exec tools, or external integrations.
- Do not rely on undocumented host files. Import supported APIs from `@bakin/sdk` and `@bakin/sdk/*`.

## Validation

Launch docs require every public plugin example to be backed by a snippet fixture. `bun run docs:check` verifies the docs snippets exist and that JSON manifests parse cleanly.
