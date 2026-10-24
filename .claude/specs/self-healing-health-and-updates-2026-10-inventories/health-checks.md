# Inventory — health checks, incidents, repair actions (sweep 2026-10-23)

## Summary
- Checks: 55 registered (health 26, team 4, tasks 4, workflows 4, schedule 3, models 2, spend/assets/brands/images/git 1 each; Pi 5 or OpenClaw 1 by active runtime; core.onboarded 1) + synthetic core verification incident for crashing checks.
- Incident rows: 206 — resolution: repair 35, navigate 67, instructions 47, rerun 57. ~100 action_required raw; 18 carry a `safe` repair (cron auto-applies).
- Repair actions: 27 — 15 safe, 2 manual, 8 destructive, 2 per-item (repair-skill-drift safe|manual; repair-store safe|destructive).
- Doctor cron: `doctor.start()` src/core/doctor.ts:43-75 from src/core/server/startup-recovery.ts:81; interval `settings.doctor.intervalMs` default 30 min (packages/core/src/settings.ts:482) + 1s refresh-coordinator tick; `runCycle` (doctor.ts:27-33) = full sweep → `escalateCronIncidents` (only call site) → `reconcileRepairRequests`.
- Cron self-heals today (safe + action_required): #3 #4 #35 #72 #81 #86 #91 #95 #109 #110 #113 #121 #123 #131(safe-managed) #146 #158 #172 #173. Safe repairs NEVER auto-applied (advisory/watch): #34 #153 #154 #168.

Path legend: HC/=plugins/health/lib/system-checks/, TM=plugins/team/lib/health-checks.ts, TK=plugins/tasks/lib/health-checks.ts, WF=plugins/workflows/lib/health-checks.ts, WSD=plugins/workflows/lib/shipped-defaults.ts, SC=plugins/schedule/lib/health-checks.ts, MR=plugins/models/lib/health-checks.ts, MD=plugins/models/lib/dead-selections.ts, SP=plugins/spend/lib/health-checks.ts, AS=plugins/assets/lib/health-checks.ts, BR=plugins/brands/lib/health-checks.ts, IM=plugins/images/index.ts, GT=plugins/git/index.ts, PI=packages/adapter-pi/src/health-checks.ts, OC=packages/adapter-openclaw/src/health-checks.ts. "—" class = unstamped (policy treats as service_failure).

## Table 1: incidents
| # | check | incident key | disp | class | res | target | safety | human is told | file:line |
|---|---|---|---|---|---|---|---|---|---|
|1|health.acks|store-unreadable|watch|evidence_gap|instructions|"Repair or delete ~/.bakin/health/acks.json…"|none|fix or delete acks.json|HC/health-acks.ts:25|
|2|health.acks|invalid-records|watch|evidence_gap|instructions|"Acknowledge or snooze from Health…"|none|`bakin doctor unack <key>`|HC/health-acks.ts:54|
|3|health.media.sharp|media-store-broken|action_required|—|repair|media-install-store|safe|—|HC/media.ts:69|
|4|health.media.sharp|media-store-missing|action_required|—|repair|media-install-store|safe|—|HC/media.ts:121|
|5|health.media.sharp|unsupported-platform|advisory|unsupported_surface|instructions|sharp prebuilds…|none|supported platform|HC/media.ts:97|
|6|health.capabilities|not-ready:<capability>|action_required|—|navigate|/explore?tab=capabilities&capability=<id>|none|no steps; detail lists `bakin packages sync <id>@<ver>` / `install <id>` / add a key|HC/capabilities.ts:48|
|7|health.github-readiness|authentication-required|action_required|—|instructions|`gh auth login`|none|sign in to gh|HC/github-readiness.ts:71|
|8|health.service|plist-missing|action_required|—|instructions|`bakin setup service`|none|reinstall LaunchAgent|HC/service.ts:41,163|
|9|health.service|plist.* (5 keys)|action_required|—|instructions|`bakin setup service`|none|same|HC/service.ts:52-98,150|
|10|health.service|plist-unreadable|watch|—|rerun|—|none|rerun|HC/service.ts:106|
|11|health.service|service-unloaded|action_required|—|instructions|`bakin setup service`|none|same|HC/service.ts:125|
|12|health.runtime|unreachable|action_required|—|instructions|"Start the configured runtime gateway."|none|start gateway, creds, rerun|HC/runtime.ts:36|
|13|health.session-store|inspection-failed|watch|—|rerun|—|none|rerun|HC/session-store.ts:46|
|14|health.session-store|oversized:<agent>|action_required|—|instructions|adapter remediation|none|session cleanup|HC/session-store.ts:81|
|15|health.session-store|growing:<agent>|watch|—|instructions|same|none|same|HC/session-store.ts:101|
|16|health.session-store|orphaned:<agent>|watch|—|instructions|same|none|same|HC/session-store.ts:121|
|17|health.channel-approvals|inspection-failed|watch|evidence_gap|rerun|—|none|rerun|HC/channel-approvals.ts:33|
|18|health.channel-approvals|render-only|advisory|unsupported_surface|navigate|/tasks|none|approve gates in UI|HC/channel-approvals.ts:63|
|19|health.channel-aliases|inspection-failed|watch|evidence_gap|rerun|—|none|rerun|HC/channel-aliases.ts:41|
|20|health.channel-aliases|invalid-aliases|action_required|—|navigate|CHANNELS_SETTINGS_HREF|none|fix aliases|HC/channel-aliases.ts:92|
|21|health.delivery-discord|missing-token|action_required|service_failure|navigate|Settings → Channels|none|set bot token|HC/delivery-discord.ts:65|
|22|health.delivery-discord|missing-guild|action_required|service_failure|navigate|same|none|set guild IDs|HC/delivery-discord.ts:69|
|23|health.delivery-discord|connecting|watch|service_failure|rerun|—|none|check again|HC/delivery-discord.ts:85|
|24|health.delivery-discord|bridge-failed|action_required|service_failure|navigate|Settings → Channels|none|remediation text|HC/delivery-discord.ts:95|
|25|health.delivery-discord|bridge-disconnected|action_required|service_failure|navigate|same|none|same|HC/delivery-discord.ts:99|
|26|health.delivery-discord|guild-unjoined|action_required|service_failure|navigate|same|none|same|HC/delivery-discord.ts:104|
|27|health.delivery-discord|empty-approvers|watch|policy_denial|navigate|…approvers|none|allowlist approvers|HC/delivery-discord.ts:119|
|28|health.delivery-discord|empty-inbound-allowlist|watch|policy_denial|navigate|…allowFrom|none|allowlist senders|HC/delivery-discord.ts:135|
|29|health.restart-recovery|stale-tasks|action_required|—|navigate|/tasks|none|review stranded tasks|HC/restart-recovery.ts:53|
|30|health.restart-recovery|inspection-failed|watch|—|rerun|—|none|rerun|HC/restart-recovery.ts:76|
|31|health.execution-safety|ledger-unavailable|action_required|—|instructions|ledger path/permissions|none|fix ledger|HC/execution-safety.ts:43|
|32|health.execution-safety|audit-unreadable|watch|—|rerun|—|none|rerun|HC/execution-safety.ts:70|
|33|health.execution-safety|duplicates-suppressed|watch|—|instructions|inspect audit.jsonl|none|trace duplicate source|HC/execution-safety.ts:109|
|34|health.dispatch.run-dirs|no-sweep-yet|advisory|cleanup_backlog|repair|sweep-run-dirs|safe|—|HC/run-dirs.ts:34|
|35|health.dispatch.run-dirs|over-budget|action_required|cleanup_backlog|repair|sweep-run-dirs|safe|impact says another sweep won't free space|HC/run-dirs.ts:57|
|36|health.context.startup-size|runtime-unavailable|watch|—|rerun|—|none|rerun|HC/context-report.ts:41|
|37|health.context.startup-size|main-agent-unavailable|watch|—|rerun|—|none|rerun|HC/context-report.ts:64|
|38|health.context.startup-size|over-budget:<agent>|watch|—|navigate|/team/<agent>?tab=diagnostics|none|review context|HC/context-report.ts:93|
|39|health.spend.policy-available|policy-unavailable|action_required|service_failure|instructions|check server log, restart Bakin|none|restart Bakin|HC/spend-policy.ts:24|
|40|health.spend.policy-available|policy-invalid|action_required|service_failure|instructions|fix spend.json|none|fix spend.json|HC/spend-policy.ts:62|
|41|health.spend.policy-available|policy-unanswered|watch|service_failure|rerun|—|none|rerun|HC/spend-policy.ts:86|
|42|health.usage.agent-burn|token-metering-incomplete|watch|evidence_gap|rerun|—|none|rerun|HC/agent-burn.ts:57|
|43|health.usage.agent-burn|cost-aggregate-unrepresentable|watch|evidence_gap|rerun|—|none|rerun|HC/agent-burn.ts:82|
|44|health.usage.agent-burn|ledger-unavailable|action_required|service_failure|instructions|ledger path|none|fix ledger|HC/agent-burn.ts:131|
|45|health.usage.agent-burn|evaluation-failed|watch|evidence_gap|rerun|—|none|rerun|HC/agent-burn.ts:151|
|46|health.usage.agent-burn|transcript-coverage-incomplete|advisory/watch|evidence_gap|rerun|—|none|wait or rerun|HC/agent-burn.ts:208|
|47|health.usage.agent-burn|interactive-usage:<agent>|advisory|usage_anomaly|navigate|/team/<agent>?tab=diagnostics|none|review|HC/agent-burn.ts:269|
|48|health.usage.agent-burn|unexplained-usage:<agent>|watch|unattributed_usage|navigate|same|none|review|HC/agent-burn.ts:290|
|49|health.usage.agent-burn|runaway-usage:<agent> (downgraded)|watch|runaway_usage|navigate|same|none|review|HC/agent-burn.ts:314|
|50|health.usage.agent-burn|runaway-usage:<agent>|action_required|runaway_usage|navigate|same|none|investigate|HC/agent-burn.ts:329|
|51|health.usage.agent-burn|unusual-burn:<agent>|watch|usage_anomaly|navigate|same|none|review|HC/agent-burn.ts:352|
|52|health.search|search-disabled|action_required→advisory|policy_denial|instructions|`bakin settings set search.settings.enabled true`|none|enable Search|HC/search.ts:30|
|53|health.search|supervision-unknown|watch|—|rerun|—|none|rerun|HC/search.ts:59,152|
|54|health.search|service-ownership|action_required|policy_denial|instructions|refusal detail; install/configure/retry|none|stop other Bakin, `bakin install search`|HC/search.ts:69|
|55|health.search|binary-missing|action_required|—|instructions|`bakin install search`|none|install|HC/search.ts:89|
|56|health.search|service-unprovisioned|action_required|—|instructions|`bakin install search`|none|provision|HC/search.ts:124|
|57|health.search|engine-unavailable|action_required|—|instructions|"restart Bakin… `bakin install search`… antfly.log… `search:reset`"|none|restart Bakin etc.|HC/search.ts:182|
|58|health.search|connection-unknown|watch|—|rerun|—|none|rerun|HC/search.ts:207|
|59|health.search|text-embedder-disabled|advisory|unsupported_surface|instructions|re-enable embedder|none|re-enable, reindex|HC/search.ts:248|
|60|health.search|media-embedder-disabled|advisory|unsupported_surface|instructions|re-enable visual embedder|none|same|HC/search.ts:270|
|61|health.search|embedder-caps-unknown|watch|evidence_gap|rerun|—|none|rerun|HC/search.ts:292|
|62|health.search|indexes-unavailable|watch|—|rerun|—|none|rerun|HC/search.ts:328,436|
|63|health.search|no-indexes|watch|—|rerun|—|none|rerun|HC/search.ts:344|
|64|health.search|table-scars|advisory|cleanup_backlog|repair|search-scar-rebuild|destructive|—|HC/search.ts:381|
|65|health.search|table-health|watch|—|rerun|—|none|rerun|HC/search.ts:411|
|66|health.search|journal-unknown|watch|—|rerun|—|none|rerun|HC/search.ts:456|
|67|health.search|quarantined-writes|action_required|—|repair|search-outbox-revive|manual|—|HC/search-outbox.ts:39|
|68|health.search|stale-backlog|watch|—|instructions|restore the engine|none|restore engine|HC/search-outbox.ts:67|
|69|health.search-consistency|availability-unknown|watch|evidence_gap|rerun|—|none|rerun|HC/search-consistency.ts:169|
|70|health.search-consistency|migration-parked:<table>|action_required|service_failure|repair|search-consistency-rebuild|destructive|—|HC/search-consistency.ts:204|
|71|health.search-consistency|migration-running:<table>|watch|—|rerun|—|none|rerun|HC/search-consistency.ts:224|
|72|health.search-consistency|table-unreadable:<table>|action_required|service_failure|repair|search-consistency-restart|safe|—|HC/search-consistency.ts:253|
|73|health.search-consistency|table-unknown:<table>|watch|evidence_gap|rerun|—|none|rerun|HC/search-consistency.ts:273,312|
|74|health.search-consistency|table-missing:<table>|action_required|service_failure|repair|search-consistency-rebuild|destructive|—|HC/search-consistency.ts:290|
|75|health.search-consistency|engine-table-sweep-failed|watch|cleanup_backlog|rerun|—|none|retry|HC/search-consistency.ts:347|
|76|health.search-consistency|unclaimed-tables|advisory|cleanup_backlog|instructions|drop stale tables by hand|none|manual drop|HC/search-consistency.ts:388|
|77|health.search-consistency|tombstones-remain|watch|cleanup_backlog|rerun|—|none|retry|HC/search-consistency.ts:410|
|78|health.search-consistency|deep-sweep-failed|watch|evidence_gap|rerun|—|none|retry|HC/search-consistency.ts:427|
|79|health.search-spin|backfill-spin|action_required|service_failure|repair|search-spin-rebuild|destructive|—|HC/search-spin.ts:161|
|80|health.search-spin|spin-status-unknown|watch|—|rerun|—|none|rerun|HC/search-spin.ts:278|
|81|health.search-canary|search-dark|action_required|service_failure|repair|search-canary-restart|safe|—|HC/search-engine-watch.ts:217|
|82|health.search-canary|search-dark-first-sample|watch|—|rerun|—|none|rerun|HC/search-engine-watch.ts:239|
|83|health.search-canary|query-degraded|watch|service_failure|instructions|`bakin search:stats`|none|inspect load|HC/search-engine-watch.ts:257|
|84|health.search-canary|canary-unknown|watch|evidence_gap|rerun|—|none|rerun|HC/search-engine-watch.ts:549|
|85|health.search-canary/engine-burn|engine-watch-state-unknown|watch|evidence_gap|instructions|move engine-watch.json aside|none|move file|HC/search-engine-watch.ts:524|
|86|health.search-engine-burn|engine-wedged|action_required|service_failure|repair|search-engine-burn-restart|safe|—|HC/search-engine-watch.ts:342|
|87|health.search-engine-burn|wedge-first-sample|watch|—|rerun|—|none|rerun|HC/search-engine-watch.ts:364|
|88|health.search-engine-burn|sustained-cpu|watch|service_failure|instructions|`bakin search:stats`|none|confirm load|HC/search-engine-watch.ts:380|
|89|health.search-engine-burn|engine-burn-unknown|watch|evidence_gap|rerun|—|none|rerun|HC/search-engine-watch.ts:566|
|90|health.skill|inspection-failed|watch|—|rerun|—|none|rerun|HC/sync-skill.ts:29|
|91|health.skill|outdated/missing|action_required|—|repair|sync-skill|safe|—|HC/sync-skill.ts:54|
|92|health.plugin-assets|inspection-failed|watch|—|rerun|—|none|rerun|HC/plugin-assets.ts:26,127|
|93|health.plugin-assets|plugin-bins-invalid|action_required|—|instructions|`bakin plugins upgrade <id>`|none|upgrade/reinstall|HC/plugin-assets.ts:58|
|94|health.plugin-assets|user-edited-drifted / skill-source-invalid|watch|—|instructions|keep edit or delete .userEdited + `install plugin-assets`|none|keep or restore|HC/plugin-assets.ts:83|
|95|health.plugin-assets|assets-out-of-sync|action_required|—|repair|install-plugin-assets|safe|—|HC/plugin-assets.ts:112|
|96|health.plugin-artifacts|directory-unreadable|watch|—|rerun|—|none|rerun|HC/plugin-artifacts.ts:100|
|97|health.plugin-artifacts|needs-update:<id> (upgrade offered)|action_required|—|repair|upgrade-plugin-artifact|manual|—|HC/plugin-artifacts.ts:142,174|
|98|health.plugin-artifacts|needs-update:<id> (no compatible release)|action_required|—|instructions|author must publish|none|wait|HC/plugin-artifacts.ts:144|
|99|health.plugin-artifacts|needs-update (unknown) / invalid:<id>|action_required|—|instructions|`bakin plugins upgrade <id>`|none|upgrade/reinstall|HC/plugin-artifacts.ts:152|
|100|health.plugin-registry|registry-unavailable|watch|—|rerun|—|none|rerun|HC/plugin-registry.ts:16|
|101|health.plugin-registry|activation-failed:<id>|action_required|—|instructions|`bakin plugins list --check`|none|update/reconfigure/remove, restart|HC/plugin-registry.ts:48|
|102|team.routing|task-board|watch|—|rerun|—|none|rerun|TM:67|
|103|team.routing|runtime-credentials (unknown)|watch|—|rerun|—|none|rerun|TM:91|
|104|team.routing|runtime-credentials (error)|action_required|—|navigate|/runtime|none|add LLM creds|TM:107|
|105|team.agent-roster|roster-read|watch|—|rerun|—|none|rerun|TM:135|
|106|team.agent-roster|missing-id-<n>|action_required|—|navigate|/team|none|fix roster|TM:154|
|107|team.agent-roster|duplicate-<id>|action_required|—|navigate|/team|none|fix duplicates|TM:169|
|108|team.personas|roster-read|watch|—|rerun|—|none|rerun|TM:205|
|109|team.personas|directory-missing|action_required|—|repair|create-personas|safe|—|TM:222|
|110|team.personas|missing-<agent>|action_required|—|repair|create-personas|safe|—|TM:246|
|111|team.agent-sync|scan|watch|—|rerun|—|none|rerun|TM:348|
|112|team.agent-sync|structural|action_required|—|navigate|/team|none|"Review agents" (hints not surfaced)|TM:382|
|113|team.agent-sync|local-drift|action_required|—|repair|sync-agents|safe|—|TM:400|
|114|team.agent-sync|migration|action_required|—|repair|migrate-agent-blocks|destructive|—|TM:416|
|115|team.agent-sync|user-edited|advisory|—|navigate|/team|none|review|TM:432|
|116|team.agent-sync|advisory|advisory|—|navigate|/team|none|review|TM:450|
|117|tasks.taskboard|store-unreadable|action_required|—|rerun|—|none|retry|TK:58|
|118|tasks.task-consistency|unknown-agent:<task>|action_required|—|navigate|/tasks|none|reassign|TK:94|
|119|tasks.task-consistency|progress-missing:<task>|advisory|—|navigate|/tasks|none|review|TK:110|
|120|tasks.task-consistency|overloaded:<agent>|advisory|—|navigate|/tasks|none|review workload|TK:128|
|121|tasks.task-consistency|orphaned-dependency:<task>|action_required|—|repair|clear-done-depends-on|safe|—|TK:145|
|122|tasks.task-consistency|verification-failed|watch|—|rerun|—|none|rerun|TK:173|
|123|tasks.order-integrity|order-invalid|action_required|—|repair|reorder-columns|safe|—|TK:291|
|124|tasks.order-integrity|verification-failed|watch|—|rerun|—|none|rerun|TK:310|
|125|tasks.session-death-incidents|audit-unavailable|watch|—|rerun|—|none|rerun|TK:406|
|126|tasks.session-death-incidents|recent-session-deaths|watch|—|navigate|/health?tab=activity|none|review|TK:436|
|127|workflows.skills|frontmatter-<file>|action_required|—|navigate|/workflows|none|add frontmatter|WF:83|
|128|workflows.skills|output-schema-<file>|action_required|—|navigate|/workflows|none|add output_schema|WF:94|
|129|workflows.skills|unreadable-<file>|watch|—|navigate|/workflows|none|review|WF:104|
|130|workflows.skills|skills-directory|watch|—|rerun|—|none|rerun|WF:118|
|131|workflows.skills|drift-<skill> (repairable)|action_required|—|repair|repair-skill-drift|safe|manual|—|WF:131|
|132|workflows.skills|drift-<skill> (not repairable)|advisory|—|navigate|/workflows|none|review|WF:131|
|133|workflows.definitions|schema-<wf>-<n>|action_required|—|navigate|/workflows|none|fix YAML keys|WF:279|
|134|workflows.definitions|skill-<wf>-<step>-<skill>|action_required|—|navigate|/workflows|none|fix missing skill|WF:292|
|135|workflows.definitions|nested-<wf>-<step>-<child>|action_required|—|navigate|/workflows|none|fix missing workflow|WF:303|
|136|workflows.definitions|nested-map-<wf>-<step>|advisory|—|navigate|/workflows|none|review|WF:315|
|137|workflows.definitions|parallel-skill-…|action_required|—|navigate|/workflows|none|fix missing skill|WF:328|
|138|workflows.definitions|definitions-scan|watch|—|rerun|—|none|rerun|WF:343|
|139|workflows.stale-instances|instances-scan|watch|—|rerun|—|none|rerun|WF:399|
|140|workflows.stale-instances|orphan-<task>|action_required|—|repair|remove-orphan-instances|destructive|—|WF:410|
|141|workflows.stale-instances|stale-<task>|watch|—|navigate|/workflows|none|review|WF:419|
|142|workflows.shipped-defaults|shipped-defaults-pending|watch|—|rerun|—|none|rerun|WSD:45|
|143|workflows.shipped-defaults|shipped-defaults-missing|action_required|—|navigate|/workflows|none|upgrade build|WSD:71|
|144|workflows.shipped-defaults|shipped-default-<id>|watch|—|navigate|/workflows|none|review|WSD:90|
|145|schedule.schedule-sync|runtime-cron|watch|—|rerun|—|none|rerun|SC:75|
|146|schedule.schedule-sync|orphan-<job>|action_required|—|repair|track-runtime-cron|safe|—|SC:111|
|147|schedule.schedule-cutover|cutover-verification|watch|—|rerun|—|none|rerun|SC:139|
|148|schedule.schedule-cutover|lingering-<job>|action_required|—|repair|complete-cutover|destructive|—|SC:161|
|149|schedule.schedule-prompts|unrunnable-<job> (not paused)|action_required|cleanup_backlog|repair|remove-unrunnable-jobs|destructive|—|SC:359,373|
|150|schedule.schedule-prompts|unrunnable-<job> (paused)|watch|cleanup_backlog|repair|remove-unrunnable-jobs|destructive|—|SC:372|
|151|models.routing|routes-model-clamped|watch|—|navigate|/models?ref=route:relay|none|authorize overrides|MR:75|
|152|models.routing|route-thinking-clamped-<wc>|watch|—|navigate|/models?ref=route:<wc>|none|adjust level|MR:93|
|153|models.routing|unrouted-system-classes|advisory|—|repair|apply-recommended-routes|safe|—|MR:127|
|154|models.routing|premium-on-cheap-<wc> (routable)|advisory/watch>$5|—|repair|apply-recommended-routes|safe|—|MR:178,186|
|155|models.routing|premium-on-cheap-<wc> (on purpose)|advisory/watch|—|navigate|/models?ref=route:<wc>|none|change route|MR:188|
|156|models.routing|premium-on-cheap-<wc> (no cheaper seen)|advisory/watch|—|navigate|/models|none|prove cheap model|MR:189|
|157|models.dead-selections|evidence:<source>|watch|evidence_gap|navigate|/models|none|review|MD:66|
|158|models.dead-selections|dead-selection:<ref> (proposal)|action_required|service_failure|repair|apply-model-proposal|safe|—|MD:95,102|
|159|models.dead-selections|dead-selection:<ref> (no proposal)|action_required|service_failure|navigate|/models?ref=<ref>|none|choose a model|MD:103|
|160|spend.budget|dispatch-paused|action_required|budget_block|instructions|`bakin budget resume`|none|resume|SP:155|
|161|spend.budget|policy-invalid|action_required|service_failure|rerun|—|none|rerun only|SP:192|
|162|spend.budget|policy-unavailable|watch|service_failure|rerun|—|none|rerun|SP:207|
|163|spend.budget|open-incidents|action_required|budget_block|navigate|/spend|none|resolve holds|SP:252|
|164|spend.budget|incidents-unavailable|watch|evidence_gap|rerun|—|none|rerun|SP:291|
|165|spend.budget|spend-ledger-unavailable|action_required|service_failure|instructions|ledger path|none|fix ledger|SP:315|
|166|spend.budget|audit-unavailable|watch|evidence_gap|rerun|—|none|rerun|SP:355|
|167|spend.budget|cap-reached|action_required|budget_block|navigate|/spend|none|review caps|SP:484|
|168|spend.budget|spend-evidence-incomplete (pricing gap)|watch|evidence_gap|repair|spend-evidence-refresh-pricing|safe|—|SP:536,555|
|169|spend.budget|spend-evidence-incomplete (old unattributed)|advisory|evidence_gap|repair|accept-unattributed-history|destructive|—|SP:567|
|170|spend.budget|spend-evidence-incomplete (settling)|advisory|evidence_gap|instructions|no action needed|none|wait|SP:573|
|171|spend.budget|approaching-cap|watch|budget_block|navigate|/spend|none|review|SP:592,613|
|172|assets.assets|store-missing|action_required|—|repair|repair-store|safe|—|AS:246|
|173|assets.assets|directory-missing-<dir>|action_required|—|repair|repair-store|safe|—|AS:257|
|174|assets.assets|directory-invalid-<dir>|action_required|—|navigate|/assets|none|fix by hand|AS:266|
|175|assets.assets|directory-unreadable-<dir>|watch|—|navigate|/assets|none|review|AS:274|
|176|assets.assets|unexpected-root-<dir>|advisory|—|navigate|/assets|none|review|AS:293|
|177|assets.assets|store-unreadable|watch|—|navigate|/assets|none|review|AS:302|
|178|assets.assets|invalid-shard-<shard>|advisory|—|navigate|/assets|none|review|AS:324|
|179|assets.assets|invalid-entry-<shard>-<entry>|advisory|—|navigate|/assets|none|review|AS:335|
|180|assets.assets|manifest-missing-<asset>|action_required|—|navigate|/assets|none|fix manifest|AS:346|
|181|assets.assets|current-version-<asset>|action_required|—|navigate|/assets|none|fix manifest|AS:357|
|182|assets.assets|version-file-<asset>-<v>|action_required|—|navigate|/assets|none|restore file|AS:368|
|183|assets.assets|thumbnail-<asset>-<v>|advisory|—|navigate|/assets|none|review|AS:378|
|184|assets.assets|disk-usage|advisory|—|navigate|/assets|none|review|AS:408|
|185|assets.assets|expired-trash|action_required|—|repair|repair-store|destructive|—|AS:419|
|186|assets.assets|unimported|advisory|—|navigate|/assets|none|import or ignore|AS:85|
|187|assets.assets|enrichment-coverage|advisory|—|navigate|/assets|none|retries itself|AS:205|
|188|assets.assets|enrichment-engine|advisory|—|navigate|/assets|none|configure engine|AS:224|
|189|brands.integrity|integrity|action_required|—|navigate|/brands|none|fix references|BR:65|
|190|brands.integrity|stale-drafts|advisory|—|navigate|/brands|none|review|BR:83|
|191|images.readiness|assets-unavailable|action_required|—|navigate|/assets|none|review|IM:145|
|192|images.readiness|profiles-missing|action_required|—|instructions|restore plugin files, restart|none|restore|IM:156|
|193|images.readiness|providers-unavailable|advisory|—|navigate|/settings?tab=integrations|none|add keys|IM:175|
|194|git.worktrees|missing.<id>|action_required|—|instructions|release worktree (Terminal variant)|none|release with Git tool|GT:598|
|195|git.worktrees|registry-unreadable|watch|—|rerun|—|none|rerun|GT:625|
|196|pi.home / pi.agents-root|installation|action_required|—|instructions|install Pi (`pi`)|none|install/run Pi|PI:61,119,175|
|197|pi.home|agent-registry|action_required|—|instructions|inspect registry JSON|none|restore registry|PI:139|
|198|pi.auth / pi.models|provider-configuration|action_required|—|instructions|run Pi and sign in|none|sign in|PI:82,192,216|
|199|pi.models|model-registry|action_required|—|instructions|inspect model config|none|fix config|PI:233|
|200|pi.extensions|extension-approval|action_required|—|navigate|/runtime?tab=runtimes|none|approve extensions|PI:286|
|201|pi.extensions|extension-discovery|watch|—|rerun|—|none|rerun|PI:308|
|202|openclaw.override-authorization|unverified|advisory|—|instructions|send a turn or restart|none|send a turn|OC:74|
|203|openclaw.override-authorization|routes unreadable|advisory|—|instructions|rerun when models available|none|rerun|OC:104|
|204|openclaw.override-authorization|override-authorization|action_required|—|instructions|grant operator.admin + restart|none|grant scope|OC:125|
|205|core.onboarded|onboarding-required|action_required|—|instructions|`bakin onboard`|none|onboard|src/core/doctor-execution.ts:71|
|206|core:verification:<checkId> (check crashed)|<checkId>|watch|—|instructions|fix what the error names|none|fix or report|src/core/doctor-checks.ts:157|

## Table 2: repair actions (27)
| action id | owner | safety | what it does | file:line |
|---|---|---|---|---|
|sweep-run-dirs|health|safe|bounded sweep of expired run workspaces|HC/run-dirs.ts:71 (plugins/health/index.ts:1059)|
|install-plugin-assets|health|safe|reinstall missing/drifted plugin skills + pinned bins|HC/plugin-assets.ts:143 (index.ts:1141)|
|upgrade-plugin-artifact|health|manual|preview then upgrade stranded plugins to a compatible release, activate|HC/plugin-artifacts.ts:238 (index.ts:1150)|
|media-install-store|health|safe|download+install pinned sharp store|HC/media.ts:135 (index.ts:1168)|
|search-outbox-revive|health|manual|revive quarantined journal rows, nudge pump|HC/search-outbox.ts:94|
|search-consistency-rebuild|health|destructive|blue/green rebuild of parked/missing tables|HC/search-consistency.ts:449|
|search-spin-rebuild|health|destructive|blue/green rebuild of spinning tables|HC/search-spin.ts:185|
|search-scar-rebuild|health|destructive|blue/green rebuild of scarred tables|HC/search.ts:481|
|search-canary-restart|health|safe|`restartEngine()` + canary check (2-min debounce)|HC/search-engine-watch.ts:420,499|
|search-engine-burn-restart|health|safe|same restart|HC/search-engine-watch.ts:503|
|search-consistency-restart|health|safe|same restart (dead shard)|HC/search-engine-watch.ts:513|
|sync-skill|health|safe|write Bakin SKILL.md to the runtime|HC/sync-skill.ts:69|
|create-personas|team|safe|persona stubs|TM:261|
|sync-agents|team|safe|refresh role context + `syncAllAgents({fetch:false})`; plans only warn+autoFixable|TM:463|
|migrate-agent-blocks|team|destructive|backup then migrate legacy packages|TM:536|
|clear-done-depends-on|tasks|safe|clear dependsOn on done tasks|TK:186|
|reorder-columns|tasks|safe|renumber orders|TK:321|
|remove-orphan-instances|workflows|destructive|delete instance files whose task is gone|WF:435|
|repair-skill-drift|workflows|safe|manual|re-project drifted workflow skills|WF:149|
|complete-cutover|schedule|destructive|cutover migration removing runtime cron|SC:172|
|track-runtime-cron|schedule|safe (runtime has cron)|track orphan runtime crons|SC:229|
|remove-unrunnable-jobs|schedule|destructive|remove frozen unrunnable job ids|SC:383|
|apply-recommended-routes|models|safe|write recommender route proposals|MR:229|
|apply-model-proposal|models|safe|repoint dead selections (revision-checked)|MD:134|
|spend-evidence-refresh-pricing|spend|safe|force-refresh pricing cache|SP:~653|
|accept-unattributed-history|spend|destructive|write acceptUnattributedBefore|SP:~721|
|repair-store|assets|safe|destructive|create store dirs, purge expired trash|AS:472|

No repair action from adapters, core, capability packs, or for search engine install/re-provision.

## Evidence/resources useless to a human
- team.agent-sync (TM:333-458): `agents`/resources from `finding.agentId`; `role-context-stale`, `bin-manifest-invalid`/`source-missing` from packs, and "failed to list runtime agents" carry no agentId → `agents: []`, no resources; the scanner's `hint` (fix command) never copied into the incident.
- team.personas directory-missing (TM:217): `{agents: []}` on empty roster yet action_required.
- brands.integrity (BR:69): empty resources when only manifests invalid.
- health.channel-approvals render-only (HC/channel-approvals.ts:57): no resources with zero channels.
- models.routing routes-model-clamped (MR:73): `workClasses: []` when only tag overrides clamped.
- health.search no-indexes (HC/search.ts:342): all zeros.
- health.media.sharp (all), images profiles-missing: no resources.
- core verification incident (src/core/doctor-checks.ts:164): resource kind always `plugin`.
- assets.*/workflows.* warnings: no evidence beyond resource id.

## Answers
1. health.capabilities (HC/capabilities.ts:48-58): one incident per pack, unclassified; detail = engine `missing[]` lines (src/core/agent-packages/capability-readiness.ts:156-256). Navigate fits secret/prereq/platform legs; but skill/npm/model legs say `bakin packages sync <key>`, bin missing/drifted and invalid manifest say `bakin packages install <id>` — machine-fixable yet the same navigate. Commit 166281425 gives no reason. NO pack repair action exists; engine to wrap: `POST /api/packages/{id}/sync` → `syncPack` (packages/host/src/api/packages/dynamic.ts:5,65). Navigate target weak: Explore never reads `capability=` (explore-page.tsx:137 only `tab`); Capabilities grid filters `!entry.installed` (:266) so the not-ready pack is not shown; only in HubSkillsSection "Installed" list. Cron turns it into a health-navigate approval task.
2. team.agent-sync structural (TM:367,374-390): severity error types in src/core/agent-packages/sync-scanner.ts: source-missing (:414), file-missing (:431 runtime list failure; :475 when package-owned), block-broken (:489), skill-missing (:586), bin-manifest-invalid (:635), asset-missing bins (:646)/disk (:663). bin-manifest-invalid produced at :633-643 via `verifyPackBin` (:103-115) ← `readInstalledPackBins` bin-verify.ts:76-92 (manifest missing/unreadable/safeParse fail; also bin undeclared or platform without download). Hint `bakin packages install <id>` dropped; packs have no agentId → empty resources. Same root cause also reported by health.capabilities. Gap: skill-missing, asset-missing, owned file-missing are autoFixable but severity error → structural navigate; `sync-agents` plans only `severity==='warn'` (TM:369,477).
3. health.search engine-unavailable (HC/search.ts:176-199) = instructions. Restart primitive `SearchAdapter.restartEngine?()` (packages/core/src/adapters/search/index.ts:55) = antfly `restartService` (packages/adapter-antfly/src/service.ts:512), undefined in guest/child. Used only by the three restart actions (HC/search-engine-watch.ts:420-515; assume running engine; apply checks `available()` + canary within 30s). Core background bounces: src/core/search-registry-core.ts:521-590 (dead-shard, wedge watchdogs). Re-provision = `searchEngineReinstallOperation` (src/core/updates/apply.ts:197-219), an updates op not a repair action. Inference why unwired: launchd KeepAlive already restarts; a dark engine is likely a crash loop; guest/child have no restart; ownership refusal forbids mutations. Fix: wire a safe restart / `bakin install search` ("safe to run repeatedly") — escalation degrades repair-type failures to operator-review.
4. Doctor cron: see Summary.
