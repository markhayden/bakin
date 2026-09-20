# Census-linked collection triage — #806

Source census: `design-system/census.json` at Bakin `de3d183321c9faca5c21705d08564f1f63d12cd5`.

This matrix annotates all 102 existing IDs without duplicating ownership/routes.
It is a source-based disposition, not a claim that every state of every surface
has passed browser verification. Detailed collection sources/findings and open
state coverage remain in [AUDIT.md](AUDIT.md). “Candidate” means recommended,
not an approved consumer migration. Delegated routes share their implementation
finding; aliases are not counted as separate collection implementations.

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
| `host-route:runtime` | Mixed | Runtime tables, capability cards, switch timeline; see runtime shared components. |
| `host-route:schedule` | Delegate | Host route delegates to matching core plugin page; do not count it as another list. |
| `host-route:settings` | Specialized + review | Keep NavList/form semantics; repeated provider settings need standardization review. |
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
| `plugin-route:messaging:/messaging/brainstorm` | Rows + specialized | Session list → separated rows; retain conversation/picker interaction. |
| `plugin-route:messaging:/messaging/calendar` | Specialized + table | Keep calendar; review collapsing list-mode table and mobile sorting. |
| `plugin-route:messaging:/messaging/plans` | Rows candidate | Plan/channel/content lists → separated rows; preserve grouping and task timeline. |
| `plugin-route:messaging:/messaging/plans/[id]` | Rows candidate | Plan/channel/content lists → separated rows; preserve grouping and task timeline. |
| `plugin-route:projects:/projects` | Rows candidate | Text-first project cards → rows; preserve progress/status/unread signals. |
| `plugin-route:projects:/projects/[id]` | Keep rows + specialized | Keep separated tasks/attachments; preserve editor, conversation and form controls. |
| `plugin-route:projects:/projects/[id]/edit` | Keep rows + specialized | Keep separated tasks/attachments; preserve editor, conversation and form controls. |
| `plugin-route:projects:/projects/new` | Alias | Delegate to destination; no independent collection. |
| `plugin-route:terminal:/terminal` | Table + specialized | Session index is tabular; terminal detail is an interactive workspace, not a card collection. |
| `plugin-route:terminal:/terminal/[sessionId]` | Table + specialized | Session index is tabular; terminal detail is an interactive workspace, not a card collection. |
| `plugin-slot:_template:home-widget` | No result collection | Status/form or single widget; section-card guidance is separate from collection migration. |
| `plugin-slot:assets:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:assets:page:/assets` | Keep cards + table | Preview/folder browsing earns cards; import/trash/table views remain deliberate. |
| `plugin-slot:assets:page:/assets/:assetId` | Review embedded lists | Version/export/reference renderers: separate history, download rows and media. |
| `plugin-slot:assets:task-assets` | Rows candidate | Attached assets → compact separated rows. |
| `plugin-slot:brands:page:/brands` | Keep cards candidate | Logo/monogram and palette earn gallery space; visually reviewed on dev instance. |
| `plugin-slot:brands:page:/brands/:brandId` | Rows + specialized | Document/material lists → separated; preserve palette/media/editor compositions. |
| `plugin-slot:brands:page:/brands/:brandId/docs` | Editor | Document editing, not a result collection. |
| `plugin-slot:brands:task-brand` | Keep rows | Compact evidence list already separated. |
| `plugin-slot:chat:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:chat:page:/chat` | Rows + specialized | Recent chats → separated; retain compact rail and conversation semantics. |
| `plugin-slot:chat:page:/chat/[chatId]` | Rows + specialized | Recent chats → separated; retain compact rail and conversation semantics. |
| `plugin-slot:chat:page:/chat/new` | Rows + specialized | Recent chats → separated; retain compact rail and conversation semantics. |
| `plugin-slot:explore:page:/explore` | Review cards/rows | Text-first catalog → row candidate; media previews and pickers judged separately. |
| `plugin-slot:health:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:health:page:/health` | Mixed | Findings/agent rows → separated candidates; keep comparison tables and real timelines; metric grids are not lists. |
| `plugin-slot:memory:page:/memory` | Table candidate | Search results: preserve relevance/navigation; narrow purpose review pending. |
| `plugin-slot:messaging:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:models:page:/models` | Mixed | Keep comparison tables and labelled form rows; aliases → separated; no forced table for editable fields. |
| `plugin-slot:projects:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:schedule:page:/schedule` | Specialized + table | Calendar remains specialized; job table narrow rows need sort/action parity. |
| `plugin-slot:tasks:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:tasks:page:/tasks` | Specialized + table/rows | Kanban stays; retain task-log dual layout and separated notes/history; verify narrow sorting. |
| `plugin-slot:team:page:/team` | Specialized | ReactFlow org canvas, not a generic card grid; TeamManager overlay → separated candidate. |
| `plugin-slot:team:page:/team/[id]` | Rows + specialized | Member/lesson lists use standard rows; retain diagnostics timeline and active-context transcript semantics. |
| `plugin-slot:team:page:/team/teams/[teamId]` | Rows + specialized | Member/lesson lists use standard rows; retain diagnostics timeline and active-context transcript semantics. |
| `plugin-slot:workflows:nav-badge-providers` | No collection | Badge provider; counts/attention, not a result-list presentation. |
| `plugin-slot:workflows:page:/workflows` | Rows candidate | Top-level workflow cards → separated rows, preserving summaries/assignments. |
| `plugin-slot:workflows:page:/workflows/[id]` | Specialized | Workflow graph/editor and node palette; do not flatten into generic result rows. |
| `plugin-slot:workflows:page:/workflows/[id]/edit` | Specialized | Workflow graph/editor and node palette; do not flatten into generic result rows. |
| `plugin-slot:workflows:page:/workflows/new` | Specialized | Workflow graph/editor and node palette; do not flatten into generic result rows. |
| `plugin-template:_template` | No result collection | Template demonstrates status/form/widget composition; not a collection choice. |
| `plugin-template:reference-plugin` | Rows candidate | Bookmark cards are text-first; migrate author example after row contract is approved. |
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
| `shared-component:packages/host/src/components/runtime/capabilities-tab` | Rows candidate | Capability cards repeat labelled status/dependencies; compare separated composition. |
| `shared-component:packages/host/src/components/runtime/extensions-section` | Keep tables | Aligned runtime facts/extensions; review narrow overflow/controls. |
| `shared-component:packages/host/src/components/runtime/overview-tab` | Keep tables | Aligned runtime facts/extensions; review narrow overflow/controls. |
| `shared-component:packages/host/src/components/runtime/runtimes-tab` | Specialized + review | Keep switch-progress timeline; inspect runtime-choice cards as selection, not generic browsing. |
| `shared-component:packages/host/src/components/runtime/shared` | Supporting composition | Entity/status helpers; defer collection choice to parent. |
| `shared-component:packages/host/src/components/search/global-search-overlay` | Specialized + review | Preserve command/search navigation; review local card layout against Grid and existing migration debt. |
| `shared-component:src/components/agent-avatar` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/conversation/reply-toast` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/conversation/use-conversation-attention` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/drawer` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/plugin-settings-renderer` | Specialized | Schema form renderer; repeated inputs/agent toggles are forms, not ordinary result rows. |
| `shared-component:src/components/provider-keys-tab` | Repeated form candidate | Hand-built bordered provider/secret groups; keep field labels, busy state and security semantics. |
| `shared-component:src/components/tasks/activity-feed` | Keep rows | Compact separated live activity with disclosures; source omitted by initial three-root scan. |
| `shared-component:src/components/ui/badge` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/button` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/dialog` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/input` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/sheet` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/skeleton` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
| `shared-component:src/components/ui/tooltip` | No collection | Primitive, feedback, overlay, identity or single-control composition; retain parent-specific collection decisions. |
