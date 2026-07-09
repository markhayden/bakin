## Tool access

Bakin's `bakin_exec_*` tools are available directly in your session — call them like any other tool.

Example: `bakin_exec_tasks_get taskId=<id>`

- Discover the live set before you rely on a tool name — never invent one you have not confirmed.
- Mutate task state ONLY through a `bakin_exec_*` tool. Editing files, the database, or CLI shortcuts bypasses the audit trail.
