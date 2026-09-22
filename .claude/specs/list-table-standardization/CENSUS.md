# Census-linked collection triage — #806

Source census: current `design-system/census.json` (final local fleet sweep, 2026-09-22).

This matrix annotates all 103 existing IDs without duplicating ownership/routes.
It is a source-based disposition, not a claim that every state of every surface
has passed browser verification. Detailed collection sources/findings and open
state coverage remain in [AUDIT.md](AUDIT.md). “Candidate” means recommended,
not an approved consumer migration. Delegated routes share their implementation
finding; aliases are not counted as separate collection implementations.

2026-09-21 status update: “Local” records current consumer work, not a release
or complete state coverage. Workflows shipped through #885; Projects and the
Messaging slices remain local pending the combined rollout. See PLAN/AUDIT for
the per-slice verification boundaries and specialized follow-ups.

The subsequent table-first ruling supersedes unimplemented rows-first index
recommendations in this matrix. Re-evaluate each record index against DataTable
before migration; compact supporting rows and specialized interfaces are not
automatically tables. Brainstorm is the first local correction below.

| Census ID | Disposition | Collection decision / follow-up |
| --- | --- | --- |
| `host-route:__root` | Shell | Navigation and live activity; see shared-component findings. |
| `host-route:assets` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:assets.$assetId` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:brands` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:brands.$brandId` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:brands.$brandId.docs.$kind.$name` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:chat` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:chat.$chatId` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:chat.new` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:explore` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:health` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:index` | Alias | Delegate to destination; no independent collection. |
| `host-route:memory` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:models` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:plugin-catchall` | Delegate | Resolve installed plugin route; use each official plugin finding below. |
| `host-route:runtime` | Local tables + specialized | Capability, setup, runtime and extension inventories use shared responsive sorting; switch progress/results remain specialized. |
| `host-route:schedule` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:settings` | Reviewed forms + local table | NavList/schema form semantics retained and route/save tests pass. Integrations uses separated provider fields, a named-secret table and responsive add form; retry/locking/write-only behavior verified. See combined checkpoint in AUDIT. |
| `host-route:tasks` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:team.$id` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:team.index` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:team.teams.$teamId` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:workflows.$id.edit` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:workflows.$id.index` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:workflows.index` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:workflows.new` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `plugin-route:_template:/_template` | No result collection | Status/form or single widget; section-card guidance is separate from collection migration. |
| `plugin-route:messaging:/messaging` | Alias | Delegate to destination; no independent collection. |
| `plugin-route:messaging:/messaging/brainstorm` | Local table + specialized | Session index corrected to table-first with shared URL sorting and narrow roles. Conversation/picker branches remain specialized; not a full workspace audit. |
| `plugin-route:messaging:/messaging/calendar` | Local table + specialized | List mode uses shared narrow roles and persistent URL sorting. Real calendar layouts stay specialized; list fixture covered, not all calendar interactions. |
| `plugin-route:messaging:/messaging/plans` | Local table — approved | Date-sorted DataTable with labelled narrow rows, filters, retry and independent confirmed Delete; user visually approved. |
| `plugin-route:messaging:/messaging/plans/[id]` | Local rows + specialized | Channel/content-piece lists migrated to separated rows with existing delete/open actions; shared plan deletion, no nested main, visible panel focus. Editor/conversation/timeline remain specialized. |
| `plugin-route:projects:/projects` | Local rows — approved | Separated project rows preserve progress/status/unread signals, independent confirmed Delete and linked tasks/assets. User visually approved; combined rollout pending. |
| `plugin-route:projects:/projects/[id]` | Keep rows + specialized | Keep separated tasks/attachments; preserve editor, conversation and form controls. |
| `plugin-route:projects:/projects/[id]/edit` | Keep rows + specialized | Keep separated tasks/attachments; preserve editor, conversation and form controls. |
| `plugin-route:projects:/projects/new` | Alias | Delegate to destination; no independent collection. |
| `plugin-route:terminal:/terminal` | Local table parity | Persistent sorting, labelled separated narrow rows, full working paths and independent session menus; terminal workspace unchanged. |
| `plugin-route:terminal:/terminal/[sessionId]` | Specialized workspace | Interactive terminal, ownership controls, streaming output and keyboard capture retained; not a collection migration. |
| `plugin-slot:_template:home-widget` | No result collection | Status/form or single widget; section-card guidance is separate from collection migration. |
| `plugin-slot:assets:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:assets:page:/assets` | Keep cards + table | Preview/folder browsing earns cards; import/trash/table views remain deliberate. |
| `plugin-slot:assets:page:/assets/:assetId` | Local supporting rows + media | Version history, downloads and references use separated rows with independent preview/promote/delete actions; media preview/edit/export forms retained. |
| `plugin-slot:assets:task-assets` | Local separated rows | Linked attachments preserve independent unlink, read-only state, retry, stale-response protection and pending mutation lock. |
| `plugin-slot:brands:page:/brands` | Keep preview cards | Logo/monogram and palette earn gallery space; no text-index card conversion needed. |
| `plugin-slot:brands:page:/brands/:brandId` | Local rows + specialized | Materials, documents and lessons use separated supporting rows with wrapping names and visible actions. Palette/media/editor compositions retained. |
| `plugin-slot:brands:page:/brands/:brandId/docs` | Editor | Document editing, not a result collection. |
| `plugin-slot:brands:task-brand` | Keep rows | Compact evidence list already separated. |
| `plugin-slot:chat:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:chat:page:/chat` | Local rows + specialized | Recent conversations use separated supporting rows with wrapping titles; agent starters, navigation rail and conversation retained. |
| `plugin-slot:chat:page:/chat/[chatId]` | Specialized conversation | Conversation transcript, attachments and compact navigation remain specialized; shared recent rows migrated. |
| `plugin-slot:chat:page:/chat/new` | Specialized creation | Agent starters and composer remain specialized; shared recent rows migrated. |
| `plugin-slot:explore:page:/explore` | Local table + supporting rows | Catalog is a sortable, URL-backed DataTable with independent Details/Install and compatibility gates; installed capabilities use compact separated management rows. Preserve preview galleries and consent/pickers. Fixtures and four-width browser checks pass; see AUDIT for combined checkpoint. |
| `plugin-slot:health:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:health:page:/health` | Local tables + ordered rows | System plugin/index/check registries and Agent pulse use persistent sorting and separated narrow rows. Evidence focus targets the visible copy. Incidents/findings retain canonical priority order in separated rows; charts, timelines and disclosures retained. |
| `plugin-slot:memory:page:/memory` | Local table parity + specialized | Browse uses column-derived separated narrow rows and persistent sorting; search keeps relevance. Record URL/reload, filters and tab-panel wiring verified. Keep Scrub's grouped selection/cleanup and tier stat tiles specialized. Fixtures/four-width browser pass; combined checkpoint in AUDIT. |
| `plugin-slot:messaging:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:models:page:/models` | Excluded by user | Refactoring on another branch; no changes or completion claim in this sweep. |
| `plugin-slot:projects:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:schedule:page:/schedule` | Verified table parity | One column model, persistent URL sort and visible actions at both widths; fixtures/browser/full checks pass. Calendar unchanged; rollout pending. |
| `plugin-slot:tasks:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:tasks:page:/tasks` | Verified table parity + specialized | Task log has persistent URL sort, labelled dates, search-relevance isolation and shared current-task actions; fixtures/browser/full checks pass. Kanban/notes/history unchanged; rollout pending. |
| `plugin-slot:team:page:/team` | Local supporting rows + canvas | TeamManager and lessons use separated rows with readable identities and independent actions; ReactFlow org canvas retained. |
| `plugin-slot:team:page:/team/[id]` | Local rows + specialized | Lessons use separated rows; member rows, diagnostics timeline and active-context transcript remain specialized. |
| `plugin-slot:team:page:/team/teams/[teamId]` | Rows + specialized | Member navigation and forms retained; shared team/lesson supporting rows migrated. |
| `plugin-slot:workflows:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:workflows:page:/workflows` | Migrated — #885 merged | User approved one DataTable with Source classification/filter, five sortable headings, unified 20-row pagination and search. Preserves summaries/assignments; full local conformance passed. |
| `plugin-slot:workflows:page:/workflows/[id]` | Specialized | Workflow graph/editor and node palette; do not flatten into generic result rows. |
| `plugin-slot:workflows:page:/workflows/[id]/edit` | Specialized | Workflow graph/editor and node palette; do not flatten into generic result rows. |
| `plugin-slot:workflows:page:/workflows/new` | Specialized | Workflow graph/editor and node palette; do not flatten into generic result rows. |
| `plugin-template:_template` | No result collection | Template demonstrates status/form/widget composition; not a collection choice. |
| `plugin-template:reference-plugin` | Local DataTable | Bookmark example demonstrates table-first comparison, persistent sorting, separated narrow rows and independent outbound/Delete actions. |
| `shared-component:packages/host/src/components/layout/app-sidebar` | Navigation | Keep route selection/navigation semantics. |
| `shared-component:packages/host/src/components/layout/connection-dot` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/layout/dispatch-timer` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/layout/header` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/layout/layout-shell` | Shell | Composes navigation/activity; no separate result-list contract. |
| `shared-component:packages/host/src/components/layout/nav-badge` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/layout/notification-toggle` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/layout/sidebar-nav-item` | Navigation | Keep route selection/navigation semantics. |
| `shared-component:packages/host/src/components/layout/sidebar-promo` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/layout/toaster` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/not-found` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:packages/host/src/components/runtime/capabilities-tab` | Local DataTable | Installed capabilities compare readiness/package/dependencies with persistent sorting, narrow metadata and Settings actions. |
| `shared-component:packages/host/src/components/runtime/extensions-section` | Local table parity | Full path/SHA retained; persistent sorting, separated narrow rows and exact trust confirmation. |
| `shared-component:packages/host/src/components/runtime/overview-tab` | Local table parity | Runtime capabilities and setup checks share sorting/narrow roles; repair confirmation and evidence retained. |
| `shared-component:packages/host/src/components/runtime/runtimes-tab` | Local table + specialized | Sortable runtime roster with independent Preview switch; guided switch confirmation/progress/results retained. |
| `shared-component:packages/host/src/components/runtime/runtime-table` | Local shared composition | Host-only DataTable + Select composition; URL-backed header/selector sorting, null-last values and separated narrow rows. No new public API. |
| `shared-component:packages/host/src/components/runtime/shared` | Supporting helpers | Status/capability language helpers retained; orphaned EntityCardBody removed. |
| `shared-component:packages/host/src/components/search/global-search-overlay` | Keep specialized command search | CommandGroup/CommandItem own type grouping, active result and Enter navigation; not a generic record index. Optional preview-grid CSS remains existing style-migration debt, not a reason to replace command semantics with DataTable. |
| `shared-component:src/components/agent-avatar` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/conversation/reply-toast` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/conversation/use-conversation-attention` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/drawer` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/plugin-settings-renderer` | Specialized | Schema form renderer; repeated inputs/agent toggles are forms, not ordinary result rows. |
| `shared-component:src/components/provider-keys-tab` | Local forms + table | Separated provider forms and Integration/Secret/Remove DataTable. Visible add-field labels, global mutation lock, failed-write draft retention and read-error retry; four-width browser proof uses synthetic secrets only. |
| `shared-component:src/components/tasks/activity-feed` | Keep rows | Compact separated live activity with disclosures; source omitted by initial three-root scan. |
| `shared-component:src/components/ui/badge` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/button` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/dialog` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/input` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/sheet` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/skeleton` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/tooltip` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
