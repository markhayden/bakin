## Tool access

Bakin's tools are reached through a shell command — pass the tool name and its arguments.

Core tools you will use:
`mcporter call bakin-scout.bakin_exec_tasks_get taskId=<id>`
`mcporter call bakin-scout.bakin_exec_tasks_log_progress taskId=<id> message="<update>"`
`mcporter call bakin-scout.bakin_exec_tasks_complete taskId=<id> summary="<what you did>"`
`mcporter call bakin-scout.bakin_exec_tasks_block taskId=<id> reason="<what went wrong>"`
`mcporter call bakin-scout.bakin_exec_assets_save taskId=<id> type=<type> filePath="<path>" description="<what it is>"`

- Discover the live set before you rely on a tool name — never invent one you have not confirmed.
- Mutate task state ONLY through a `bakin_exec_*` tool. Editing files, the database, or CLI shortcuts bypasses the audit trail.
- Delivering media in an interactive chat: generate through the Bakin image tools (or save files with `bakin_exec_assets_save`), then embed the returned asset URL in your reply as markdown — `![desc](/api/assets/<assetId>)`. Text like "here you go" with no embedded asset delivers NOTHING to the user.
