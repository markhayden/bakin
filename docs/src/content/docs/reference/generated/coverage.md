---
title: Generated Coverage
description: Coverage report for generated Bakin documentation surfaces.
---

| Surface | Source | Status |
| --- | --- | --- |
| CLI commands | `src/core/cli/registry.ts` | Active: 59 commands, 60 examples |
| HTTP routes | `src/core/api-docs.ts` and route metadata | Active: 17 routes, 0 input schemas, 0 output schemas, 0 routes with examples |
| Plugin routes | Runtime route registration metadata | Partial: 0 documented plugin routes |
| Hooks | Source scan for `hooks.register(...)` | Audited: 43 registrations |
| Slots | SDK slot contract plus source scan | Documented: 6 public slot names, 1 audited registrations |
| Exec/MCP tools | Source scan for `registerExecTool(...)` | Audited: 106 tools |
| Core plugins | `plugins/*/bakin-plugin.json` | Active: 8 plugin manifests |
| Settings | `packages/core/src/settings.ts` | Active: 49 flattened settings |
| Runtime paths | `packages/core/src/content-dir.ts` | Active: documented path contract |
| SDK exports | `packages/sdk/package.json` and barrel files | Audited: 8 subpaths |
| Agent package kinds | `packages/core/src/agent-packages/manifest.ts` | Active: agent, skill-pack, workflow-pack, knowledge-pack |
| Tested snippets | `docs/snippets` | Active: 4 required fixtures |
| LLM docs | `docs/public/llms*` | Active: 11 public bundles |

## Launch Gates

These generated surfaces are in CI through `bun run docs:check`:

- generated docs and LLM bundles exist
- Markdown pages have title and description frontmatter
- required snippet fixtures exist
- snippet JSON parses cleanly
- the Starlight site builds with Pagefind search and sitemap output

## Remaining Contract Debt

The current generated docs distinguish active structured metadata from audited source scans. Audited surfaces are public enough to document, but still need stronger contract objects before they should be considered final:

- hooks need explicit kind, schemas, examples, visibility, and stability
- exec/MCP tools need explicit metadata and output shape coverage
- plugin routes should use the same route metadata helpers as core routes
- SDK exports need complete TSDoc and stability annotations

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Apr 29, 2026 · Bakin 1.0.0</span>
</aside>
