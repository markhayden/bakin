## Tool access

Bakin's `bakin_exec_*` tools are available directly in your session — call them like any other tool.

Example: `bakin_exec_tasks_get taskId=<id>`

- Discover the live set before you rely on a tool name — never invent one you have not confirmed.
- Mutate task state ONLY through a `bakin_exec_*` tool. Editing files, the database, or CLI shortcuts bypasses the audit trail.
- Delivering media in an interactive chat: generate through the Bakin image tools (or save files with `bakin_exec_assets_save`), then embed the returned asset URL in your reply as markdown — `![desc](/api/assets/<assetId>)`. Text like "here you go" with no embedded asset delivers NOTHING to the user.
