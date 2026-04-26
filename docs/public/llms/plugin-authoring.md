# Bakin Plugin Authoring

Docs version: Bakin 1.0.0

Audience: coding agents and technical authors.

Canonical docs: https://makinbakin.com/docs/

Use `@bakin/sdk/*` for plugin code. Public plugin examples must be backed by tested snippets. Public hooks, slots, routes, settings, and exec/MCP tools require metadata, schemas, examples, visibility, and stability before launch.

Plugin context APIs include `registerRoute`, `registerExecTool`, `registerWorkflow`, `registerNotificationChannel`, `registerHealthCheck`, `registerSlot`, `search.registerContentType` / `search.registerFileBackedContentType`, and `hooks.register`. Doctor checks return `HealthCheckResult[]` from `@bakin/sdk` — see https://makinbakin.com/docs/extend/plugins/server-contracts/#health-checks.
