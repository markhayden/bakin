## Tool access

Bakin's tools are exposed to you as native MCP tools under the `bakin-scout` server — call them by their prefixed name.

Example: `bakin-scout.bakin_exec_tasks_get taskId=<id>`

- Discover the live set before you rely on a tool name — never invent one you have not confirmed.
- Mutate task state ONLY through a `bakin_exec_*` tool. Editing files, the database, or CLI shortcuts bypasses the audit trail.
