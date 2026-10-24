# Re-homing table — all 206 incident types (spec §3.9), 2026-10-23

Produced read-only from `health-checks.md` Table 1 + spec rev 7 rules. Rows marked "(split)" contain more than one variant. Effects: D = deletesUserContent, S = spendsMoney, W = widensAuthorization, R = restartsService, none = all false. AR = action_required. Subject kind `record:` is used for asset, brand, workflow and spend records (spec §3.1 amended to add `record`). PR hints: 6a search / 6b packs+plugins / 6c team+tasks+workflows+schedule / 6d models+spend+assets+brands+images+git / 6e adapters+service+channels+core. Judgement calls recorded in the plan: #158 is W/one-click per spec D2 (an earlier exception was overruled by the plan review); #114 is D; #39/#192 are core.diagnose.

| # | check | incident key | subject | NEW resolution | effects → mode | human control (exists?) | disposition | PR |
|---|---|---|---|---|---|---|---|---|
|1|health.acks|store-unreadable|record:health/acks.json|repair NEW `health-acks-reset`|none → self-heal|—|advisory; file moved aside, not deleted|6e|
|2|health.acks|invalid-records|record:health/acks.json|repair NEW `health-acks-prune`|none → self-heal|—|advisory|6e|
|3|health.media.sharp|media-store-broken|system:media-store|repair `media-install-store`|none → self-heal|—|AR → fixing|6d|
|4|health.media.sharp|media-store-missing|system:media-store|repair `media-install-store`|none → self-heal|—|AR → fixing|6d|
|5|health.media.sharp|unsupported-platform|system:media-store|observation (platform)|—|—|advisory|6d|
|6|health.capabilities|not-ready:<cap> (split)|package:<packId>|skill/npm/model legs → repair NEW `package-sync`; bin missing/drifted or invalid manifest → repair NEW `package-reinstall`; secret leg → human credential; prereq → human external-install; platform → observation|none (W on non-empty consent delta → one-click via authorizeMutation) → self-heal|Secret: pack secret-slot field on Explore (NEW: Explore ignores `capability=` and hides installed packs). Prereq: external handoff copy block (NEW).|AR only while an agent declares the capability, else advisory|6b|
|7|health.github-readiness|authentication-required|system:github-cli|human credential|—|Terminal-session handoff `gh auth login`, else copy block; rerun on sign-in (NEW)|AR while gh is used|6e|
|8|health.service|plist-missing|service:bakin-launchagent|repair NEW `service-setup` (wraps `bakin setup service`)|R=bakin → self-heal|—|AR → fixing|6e|
|9|health.service|plist.* (5 keys)|service:bakin-launchagent|repair NEW `service-setup`|R=bakin → self-heal|—|AR → fixing|6e|
|10|health.service|plist-unreadable|service:bakin-launchagent|observation (core.diagnose after the §3.1 bound)|—|—|watch|6e|
|11|health.service|service-unloaded|service:bakin-launchagent|repair NEW `service-setup`|R=bakin → self-heal|—|AR → fixing|6e|
|12|health.runtime|unreachable (split)|runtime:<active>|repair NEW `runtime-restart`, then core.diagnose; auth-failure variant → human credential|R=runtime → self-heal|Credential: /runtime exists, field deep-link NEW|AR|6e|
|13|health.session-store|inspection-failed|agent:<id>|observation|—|—|watch|6e|
|14|health.session-store|oversized:<agent>|agent:<id>|repair NEW `session-store-prune`|D → one-click|—|AR|6e|
|15|health.session-store|growing:<agent>|agent:<id>|observation|—|—|watch|6e|
|16|health.session-store|orphaned:<agent>|agent:<id>|observation (detail may offer `session-store-prune`)|—|—|watch|6e|
|17|health.channel-approvals|inspection-failed|channel:approvals|observation|—|—|watch|6e|
|18|health.channel-approvals|render-only|channel:approvals|observation (unsupported surface)|—|—|advisory|6e|
|19|health.channel-aliases|inspection-failed|setting:notifications.channelAliases|observation|—|—|watch|6e|
|20|health.channel-aliases|invalid-aliases|setting:notifications.channelAliases|human decision, field `channels-field-aliases`|—|Exists; href must add `&field=` (small NEW)|AR while an alert/workflow addresses the alias, else advisory|6e|
|21|health.delivery-discord|missing-token|channel:discord|human credential, field `secret-slot-discord-botToken`|—|exists|AR while `integrations.discord.enabled`|6e|
|22|health.delivery-discord|missing-guild|channel:discord|human decision, field `channels-field-guilds`|—|exists|AR while enabled|6e|
|23|health.delivery-discord|connecting|channel:discord|observation|—|—|watch|6e|
|24|health.delivery-discord|bridge-failed (split)|channel:discord|repair NEW `discord-bridge-reconnect`; auth/invalid-token lastError → human credential `discord.botToken`|none → self-heal|Token field exists|AR → fixing; red only for the credential variant|6e|
|25|health.delivery-discord|bridge-disconnected|channel:discord|repair NEW `discord-bridge-reconnect`|none → self-heal|—|AR → fixing|6e|
|26|health.delivery-discord|guild-unjoined|channel:discord|human decision: invite the bot, or remove the id from `channels-field-guilds`|—|Remove exists; invite OAuth-URL handoff NEW|AR while a configured channel lives in that guild|6e|
|27|health.delivery-discord|empty-approvers|setting:integrations.discord.approvers|observation (detail links `channels-field-approvers`)|—|—|advisory|6e|
|28|health.delivery-discord|empty-inbound-allowlist|setting:integrations.discord.inbound.allowFrom|observation (detail links `channels-field-inbound-allow`)|—|—|advisory|6e|
|29|health.restart-recovery|stale-tasks|task:<id>|repair NEW `requeue-stranded-tasks`|S (re-runs turns) → one-click|—|AR while the task is open|6c|
|30|health.restart-recovery|inspection-failed|system:restart-recovery|observation|—|—|watch|6c|
|31|health.execution-safety|ledger-unavailable|system:execution-ledger|core.diagnose|none → fallback lane|—|AR|6c|
|32|health.execution-safety|audit-unreadable|system:execution-ledger|observation|—|—|watch|6c|
|33|health.execution-safety|duplicates-suppressed|system:execution-ledger|observation|—|—|watch|6c|
|34|health.dispatch.run-dirs|no-sweep-yet|system:run-dirs|repair `sweep-run-dirs`|none → self-heal|—|advisory → fixing|6c|
|35|health.dispatch.run-dirs|over-budget|system:run-dirs|repair `sweep-run-dirs`; if nothing freed → core.diagnose|none → self-heal|—|AR → fixing|6c|
|36|health.context.startup-size|runtime-unavailable|agent:main|observation|—|—|watch|6c|
|37|health.context.startup-size|main-agent-unavailable|agent:main|observation|—|—|watch|6c|
|38|health.context.startup-size|over-budget:<agent>|agent:<id>|observation (detail links `/team/<id>?tab=diagnostics`)|—|—|watch|6c|
|39|health.spend.policy-available|policy-unavailable|plugin:spend|core.diagnose|none → fallback lane|—|AR|6d|
|40|health.spend.policy-available|policy-invalid|record:spend.json|human decision|—|`/spend?recover=1` raw editor, failing key highlighted (NEW)|AR (spend fails closed)|6d|
|41|health.spend.policy-available|policy-unanswered|plugin:spend|observation|—|—|watch|6d|
|42|health.usage.agent-burn|token-metering-incomplete|system:usage-ledger|observation|—|—|watch|6d|
|43|health.usage.agent-burn|cost-aggregate-unrepresentable|system:usage-ledger|observation|—|—|watch|6d|
|44|health.usage.agent-burn|ledger-unavailable|system:usage-ledger|core.diagnose|none → fallback lane|—|AR|6d|
|45|health.usage.agent-burn|evaluation-failed|system:usage-ledger|observation|—|—|watch|6d|
|46|health.usage.agent-burn|transcript-coverage-incomplete|system:usage-ledger|observation|—|—|advisory/watch|6d|
|47|health.usage.agent-burn|interactive-usage:<agent>|agent:<id>|observation|—|—|advisory|6d|
|48|health.usage.agent-burn|unexplained-usage:<agent>|agent:<id>|observation|—|—|watch|6d|
|49|health.usage.agent-burn|runaway-usage (downgraded)|agent:<id>|observation|—|—|watch|6d|
|50|health.usage.agent-burn|runaway-usage:<agent>|agent:<id>|human decision|—|`/team/<id>?tab=diagnostics` exists; "Pause agent dispatch" containment button NEW|AR only while still burning, else advisory|6d|
|51|health.usage.agent-burn|unusual-burn:<agent>|agent:<id>|observation|—|—|watch|6d|
|52|health.search|search-disabled|setting:search.settings.enabled|observation|—|—|advisory|6a|
|53|health.search|supervision-unknown|service:search-engine|observation|—|—|watch|6a|
|54|health.search|service-ownership|service:search-engine|human decision: "Claim search for this home" (NEW `search-engine-claim`) or "Use that engine as a guest" (writes guest URL)|—|both NEW|AR while search is enabled|6a|
|55|health.search|binary-missing|service:search-engine|repair NEW `search-engine-install`|R=search-engine → self-heal|—|AR → fixing|6a|
|56|health.search|service-unprovisioned|service:search-engine|repair NEW `search-engine-install`|R=search-engine → self-heal|—|AR → fixing|6a|
|57|health.search|engine-unavailable|service:search-engine|repair NEW `search-engine-restart` (attempt 2 = `search-engine-install`)|R=search-engine → self-heal|—|AR → fixing|6a|
|58|health.search|connection-unknown|service:search-engine|observation|—|—|watch|6a|
|59|health.search|text-embedder-disabled|setting:search embedder|observation|—|—|advisory|6a|
|60|health.search|media-embedder-disabled|setting:search visual embedder|observation|—|—|advisory|6a|
|61|health.search|embedder-caps-unknown|service:search-engine|observation|—|—|watch|6a|
|62|health.search|indexes-unavailable|service:search-engine|observation|—|—|watch|6a|
|63|health.search|no-indexes|service:search-engine|observation|—|—|watch|6a|
|64|health.search|table-scars|table:<t>|repair `search-scar-rebuild` (blue/green)|none (was destructive) → self-heal|—|advisory → fixing|6a|
|65|health.search|table-health|table:<t>|observation|—|—|watch|6a|
|66|health.search|journal-unknown|service:search-engine|observation|—|—|watch|6a|
|67|health.search|quarantined-writes|service:search-engine|repair `search-outbox-revive`|none (was manual) → self-heal|—|AR → fixing|6a|
|68|health.search|stale-backlog|service:search-engine (outbox)|fold → service:search-engine, resolvedBy `search-engine-restart` (§3.8 drain on recovery)|—|—|watch|6a|
|69|health.search-consistency|availability-unknown|service:search-engine|observation|—|—|watch|6a|
|70|health.search-consistency|migration-parked:<t>|table:<t>|repair `search-consistency-rebuild`|none (was destructive) → self-heal|—|AR → fixing|6a|
|71|health.search-consistency|migration-running:<t>|table:<t>|observation|—|—|watch|6a|
|72|health.search-consistency|table-unreadable:<t>|table:<t>|repair `search-consistency-restart` (alias of `search-engine-restart`)|R=search-engine → self-heal|—|AR → fixing|6a|
|73|health.search-consistency|table-unknown:<t>|table:<t>|observation|—|—|watch|6a|
|74|health.search-consistency|table-missing:<t>|table:<t>|repair `search-consistency-rebuild`|none → self-heal|—|AR → fixing|6a|
|75|health.search-consistency|engine-table-sweep-failed|service:search-engine|observation|—|—|watch|6a|
|76|health.search-consistency|unclaimed-tables|service:search-engine|human decision|—|NEW "Drop unclaimed tables" (`search-drop-unclaimed-tables`) and "Keep"|advisory (never red)|6a|
|77|health.search-consistency|tombstones-remain|service:search-engine|observation|—|—|watch|6a|
|78|health.search-consistency|deep-sweep-failed|service:search-engine|observation|—|—|watch|6a|
|79|health.search-spin|backfill-spin|table:<t>|repair `search-spin-rebuild`|none (was destructive) → self-heal|—|AR → fixing|6a|
|80|health.search-spin|spin-status-unknown|service:search-engine|observation|—|—|watch|6a|
|81|health.search-canary|search-dark|service:search-engine|repair `search-canary-restart` (alias of `search-engine-restart`)|R=search-engine → self-heal|—|AR → fixing|6a|
|82|health.search-canary|search-dark-first-sample|service:search-engine|observation|—|—|watch|6a|
|83|health.search-canary|query-degraded|service:search-engine|observation (`search:stats` snapshot attached)|—|—|watch|6a|
|84|health.search-canary|canary-unknown|service:search-engine|observation|—|—|watch|6a|
|85|health.search-canary/engine-burn|engine-watch-state-unknown|record:search/engine-watch.json|repair NEW `search-engine-watch-reset`|none → self-heal|—|watch → fixing|6a|
|86|health.search-engine-burn|engine-wedged|service:search-engine|repair `search-engine-burn-restart` (alias of `search-engine-restart`)|R=search-engine → self-heal|—|AR → fixing|6a|
|87|health.search-engine-burn|wedge-first-sample|service:search-engine|observation|—|—|watch|6a|
|88|health.search-engine-burn|sustained-cpu|service:search-engine|observation|—|—|watch|6a|
|89|health.search-engine-burn|engine-burn-unknown|service:search-engine|observation|—|—|watch|6a|
|90|health.skill|inspection-failed|runtime:<active>|observation|—|—|watch|6e|
|91|health.skill|outdated/missing|runtime:<active>|repair `sync-skill`|none → self-heal|—|AR → fixing|6e|
|92|health.plugin-assets|inspection-failed|plugin:<id>|observation|—|—|watch|6b|
|93|health.plugin-assets|plugin-bins-invalid|plugin:<id>|repair `plugin-upgrade` when offered, else NEW `plugin-reinstall`|none (W on delta) → self-heal|—|AR → fixing|6b|
|94|health.plugin-assets|user-edited-drifted / skill-source-invalid (split)|plugin:<id>|user-edited-drifted → human decision; skill-source-invalid → repair NEW `plugin-reinstall`|Restore item: D → one-click|NEW "Keep my edit" / "Restore shipped" (`install-plugin-assets` item stamped D)|advisory|6b|
|95|health.plugin-assets|assets-out-of-sync|plugin:<id>|repair `install-plugin-assets`|none → self-heal|—|AR → fixing|6b|
|96|health.plugin-artifacts|directory-unreadable|system:plugins-dir|observation|—|—|watch|6b|
|97|health.plugin-artifacts|needs-update (upgrade offered)|plugin:<id>|repair `plugin-upgrade` (renames `upgrade-plugin-artifact`)|none, W on delta → self-heal (one-click on delta)|—|AR → fixing|6b|
|98|health.plugin-artifacts|needs-update (no compatible release)|plugin:<id>|human decision (upstream-blocked: containment "Disable plugin", or wait)|—|Explore toggle exists; card containment button NEW|AR while enabled and referenced|6b|
|99|health.plugin-artifacts|needs-update (unknown) / invalid:<id>|plugin:<id>|repair NEW `plugin-reinstall` (`plugin-upgrade` if offered)|none (W on delta) → self-heal|—|AR → fixing|6b|
|100|health.plugin-registry|registry-unavailable|system:plugin-registry|observation|—|—|watch|6b|
|101|health.plugin-registry|activation-failed:<id>|plugin:<id>|repair `plugin-upgrade` when the updates record offers one, else core.diagnose (activation error in the brief)|none → self-heal|—|AR → fixing|6b|
|102|team.routing|task-board|system:task-board|observation|—|—|watch|6c|
|103|team.routing|runtime-credentials (unknown)|runtime:<active>|observation|—|—|watch|6c|
|104|team.routing|runtime-credentials (error)|runtime:<active>|human credential|—|/runtime exists; provider-credential field id + highlight NEW|AR|6c|
|105|team.agent-roster|roster-read|record:team roster|observation|—|—|watch|6c|
|106|team.agent-roster|missing-id-<n>|agent:roster-<n>|human decision|—|`/team?recover=1` roster editor at the failing entry (NEW)|AR|6c|
|107|team.agent-roster|duplicate-<id>|agent:<id>|human decision|—|same NEW roster editor|AR|6c|
|108|team.personas|roster-read|record:team roster|observation|—|—|watch|6c|
|109|team.personas|directory-missing|system:personas|repair `create-personas`|none → self-heal|—|AR → fixing|6c|
|110|team.personas|missing-<agent>|agent:<id>|repair `create-personas`|none → self-heal|—|AR → fixing|6c|
|111|team.agent-sync|scan|system:agent-sync|observation|—|—|watch|6c|
|112|team.agent-sync|structural (split by finding)|agent:<id> / package:<pack>|skill-missing, asset-missing, owned file-missing (autoFixable) → repair `sync-agents` (planner extended to severity-error autoFixable); bin-manifest-invalid → fold → package:<pack>, resolvedBy `package-reinstall`; block-broken / source-missing → core.diagnose; runtime agent-list failure → observation|none → self-heal|—|AR → fixing|6c (+6b fold)|
|113|team.agent-sync|local-drift|agent:<id>|repair `sync-agents`|none → self-heal|—|AR → fixing|6c|
|114|team.agent-sync|migration|agent:<id>|repair `migrate-agent-blocks`|D (full overwrite, tarball backup) → one-click|—|AR|6c|
|115|team.agent-sync|user-edited|agent:<id>|observation|—|—|advisory|6c|
|116|team.agent-sync|advisory|agent:<id>|observation|—|—|advisory|6c|
|117|tasks.taskboard|store-unreadable|record:tasks store|core.diagnose (the board cannot load)|none → fallback lane|—|AR|6c|
|118|tasks.task-consistency|unknown-agent:<task>|task:<id>|human decision (reassign)|—|Drawer assignee field exists; deep link `/tasks?taskId=<id>&field=assignee` NEW|AR while the task is open|6c|
|119|tasks.task-consistency|progress-missing:<task>|task:<id>|observation|—|—|advisory|6c|
|120|tasks.task-consistency|overloaded:<agent>|agent:<id>|observation|—|—|advisory|6c|
|121|tasks.task-consistency|orphaned-dependency:<task>|task:<id>|repair `clear-done-depends-on`|none → self-heal|—|AR → fixing|6c|
|122|tasks.task-consistency|verification-failed|system:task-board|observation|—|—|watch|6c|
|123|tasks.order-integrity|order-invalid|system:task-board|repair `reorder-columns`|none → self-heal|—|AR → fixing|6c|
|124|tasks.order-integrity|verification-failed|system:task-board|observation|—|—|watch|6c|
|125|tasks.session-death-incidents|audit-unavailable|system:session-audit|observation|—|—|watch|6c|
|126|tasks.session-death-incidents|recent-session-deaths|system:session-audit|observation|—|—|watch|6c|
|127|workflows.skills|frontmatter-<file>|record:workflows/skills/<file>|human decision|—|`/workflows?recover=1&skill=<file>` editor at the frontmatter (NEW)|AR only while an in-use definition references it, else advisory|6c|
|128|workflows.skills|output-schema-<file>|record:workflows/skills/<file>|human decision|—|same NEW editor at output_schema|AR only while in use|6c|
|129|workflows.skills|unreadable-<file>|record:workflows/skills/<file>|observation|—|—|watch|6c|
|130|workflows.skills|skills-directory|system:workflow-skills|observation|—|—|watch|6c|
|131|workflows.skills|drift-<skill> (repairable)|record:workflows/skills/<skill>|repair `repair-skill-drift` (per item)|untouched: none → self-heal; user-edited: D → one-click|—|AR → fixing|6c|
|132|workflows.skills|drift-<skill> (not repairable)|record:workflows/skills/<skill>|observation|—|—|advisory|6c|
|133|workflows.definitions|schema-<wf>-<n>|record:workflows/<wf>|human decision|—|`/workflows/<wf>?recover=1` with failing key highlighted (editor exists; recover mode + highlight NEW)|AR only while scheduled or running, else advisory|6c|
|134|workflows.definitions|skill-<wf>-<step>-<skill>|record:workflows/<wf>|human decision|—|same NEW recover editor|AR only while in use|6c|
|135|workflows.definitions|nested-<wf>-<step>-<child>|record:workflows/<wf>|human decision|—|same NEW recover editor|AR only while in use|6c|
|136|workflows.definitions|nested-map-<wf>-<step>|record:workflows/<wf>|observation|—|—|advisory|6c|
|137|workflows.definitions|parallel-skill-…|record:workflows/<wf>|human decision|—|same NEW recover editor|AR only while in use|6c|
|138|workflows.definitions|definitions-scan|system:workflow-definitions|observation|—|—|watch|6c|
|139|workflows.stale-instances|instances-scan|system:workflow-instances|observation|—|—|watch|6c|
|140|workflows.stale-instances|orphan-<task>|task:<id> (instance)|repair `remove-orphan-instances`|D → one-click|—|advisory (an orphan blocks nothing)|6c|
|141|workflows.stale-instances|stale-<task>|task:<id>|observation|—|—|watch|6c|
|142|workflows.shipped-defaults|shipped-defaults-pending|system:workflow-defaults|observation|—|—|watch|6c|
|143|workflows.shipped-defaults|shipped-defaults-missing|system:workflow-defaults|fold → system:bakin (resolvedBy Bakin update/convergence); on the current release → core.diagnose|—|—|AR while not folded|6c|
|144|workflows.shipped-defaults|shipped-default-<id>|record:workflows/<id>|observation|—|—|watch|6c|
|145|schedule.schedule-sync|runtime-cron|system:schedule|observation|—|—|watch|6c|
|146|schedule.schedule-sync|orphan-<job>|system:schedule job <job>|repair `track-runtime-cron`|none → self-heal|—|AR → fixing|6c|
|147|schedule.schedule-cutover|cutover-verification|system:schedule|observation|—|—|watch|6c|
|148|schedule.schedule-cutover|lingering-<job>|system:schedule job <job>|repair `complete-cutover`|D (removes runtime cron) → one-click|—|AR|6c|
|149|schedule.schedule-prompts|unrunnable-<job> (not paused)|system:schedule job <job>|repair `remove-unrunnable-jobs`|D → one-click|—|AR (job active)|6c|
|150|schedule.schedule-prompts|unrunnable-<job> (paused)|system:schedule job <job>|repair `remove-unrunnable-jobs`|D → one-click|—|advisory|6c|
|151|models.routing|routes-model-clamped|setting:models.routes|observation|—|—|watch|6d|
|152|models.routing|route-thinking-clamped-<wc>|setting:models.route.<wc>|observation|—|—|watch|6d|
|153|models.routing|unrouted-system-classes|setting:models.routes|repair `apply-recommended-routes`|W (routing) → one-click|—|advisory|6d|
|154|models.routing|premium-on-cheap-<wc> (routable)|setting:models.route.<wc>|repair `apply-recommended-routes`|W → one-click|—|advisory/watch|6d|
|155|models.routing|premium-on-cheap (on purpose)|setting:models.route.<wc>|observation|—|—|advisory|6d|
|156|models.routing|premium-on-cheap (no cheaper seen)|setting:models.route.<wc>|observation|—|—|advisory|6d|
|157|models.dead-selections|evidence:<source>|system:model-catalog|observation|—|—|watch|6d|
|158|models.dead-selections|dead-selection:<ref> (proposal)|setting:models.selection.<ref>|repair `apply-model-proposal`|W (routing change — spec D2; plan r1 Codex #5 overruled the earlier exception) → one-click|—|AR while in use|6d|
|159|models.dead-selections|dead-selection:<ref> (no proposal)|setting:models.selection.<ref>|human decision (choose a model)|—|`/models?ref=<ref>` exists|AR while in use|6d|
|160|spend.budget|dispatch-paused|system:dispatch|repair NEW `budget-resume` (wraps `bakin budget resume`)|S → one-click|—|AR|6d|
|161|spend.budget|policy-invalid|record:spend.json|fold → record:spend.json (#40's human action; one card)|—|—|AR via owner|6d|
|162|spend.budget|policy-unavailable|plugin:spend|observation|—|—|watch|6d|
|163|spend.budget|open-incidents|system:spend-incident:<id>|human decision (raise / ack / resume)|—|routes + Spend toasts exist; Health card buttons NEW|AR while a hold blocks dispatch|6d|
|164|spend.budget|incidents-unavailable|plugin:spend|observation|—|—|watch|6d|
|165|spend.budget|spend-ledger-unavailable|system:spend-ledger|core.diagnose|none → fallback lane|—|AR|6d|
|166|spend.budget|audit-unavailable|plugin:spend|observation|—|—|watch|6d|
|167|spend.budget|cap-reached|setting:spend cap <rule>|human decision (raise cap / ack)|—|raise route + toast exist; card button NEW|AR while dispatch is blocked|6d|
|168|spend.budget|spend-evidence-incomplete (pricing gap)|system:pricing-cache|repair `spend-evidence-refresh-pricing`|none → self-heal|—|watch → fixing|6d|
|169|spend.budget|spend-evidence-incomplete (old unattributed)|setting:spend.acceptUnattributedBefore|repair `accept-unattributed-history`|W (policy write) → one-click|—|advisory|6d|
|170|spend.budget|spend-evidence-incomplete (settling)|system:usage-ledger|observation|—|—|advisory|6d|
|171|spend.budget|approaching-cap|setting:spend cap <rule>|observation|—|—|watch|6d|
|172|assets.assets|store-missing|record:assets store|repair `repair-store` (dir-creation item)|none → self-heal|—|AR → fixing|6d|
|173|assets.assets|directory-missing-<dir>|record:assets/<dir>|repair `repair-store` (directory item)|none → self-heal|—|AR → fixing|6d|
|174|assets.assets|directory-invalid-<dir>|record:assets/<id>|human decision|—|`/assets/<id>?recover=1` (NEW)|AR only while referenced by a task/brand, else advisory|6d|
|175|assets.assets|directory-unreadable-<dir>|record:assets/<dir>|observation (core.diagnose after the bound)|—|—|watch|6d|
|176|assets.assets|unexpected-root-<dir>|record:assets/<dir>|observation|—|—|advisory|6d|
|177|assets.assets|store-unreadable|record:assets store|observation (core.diagnose after the bound)|—|—|watch|6d|
|178|assets.assets|invalid-shard-<shard>|record:assets index|observation|—|—|advisory|6d|
|179|assets.assets|invalid-entry-<shard>-<entry>|record:assets index|observation|—|—|advisory|6d|
|180|assets.assets|manifest-missing-<asset>|record:assets/<id>|human decision|—|"Rebuild manifest from files" on `/assets/<id>?recover=1` (NEW)|AR only while in use|6d|
|181|assets.assets|current-version-<asset>|record:assets/<id>|human decision|—|same NEW recover page|AR only while in use|6d|
|182|assets.assets|version-file-<asset>-<v>|record:assets/<id>|human decision|—|NEW "Restore a version from an export" / "Detach references"|AR only while in use|6d|
|183|assets.assets|thumbnail-<asset>-<v>|record:assets/<id>|observation|—|—|advisory|6d|
|184|assets.assets|disk-usage|record:assets store|observation|—|—|advisory|6d|
|185|assets.assets|expired-trash|record:assets trash|repair `repair-store` (purge item)|D → one-click|—|advisory (was AR)|6d|
|186|assets.assets|unimported|record:assets store|observation|—|—|advisory|6d|
|187|assets.assets|enrichment-coverage|record:assets store|observation|—|—|advisory|6d|
|188|assets.assets|enrichment-engine|setting:assets enrichment engine|observation|—|—|advisory|6d|
|189|brands.integrity|integrity|record:brands/<id>|human decision|—|"Detach" on `/brands/<id>?recover=1` (page exists; recover mode NEW)|AR only while in use|6d|
|190|brands.integrity|stale-drafts|record:brands/<id>|observation|—|—|advisory|6d|
|191|images.readiness|assets-unavailable|plugin:images|fold → plugin:assets (resolvedBy its activation repair)|—|—|AR via owner|6d|
|192|images.readiness|profiles-missing|plugin:images|core.diagnose (built-in files ship with the binary)|none → fallback lane|—|AR|6d|
|193|images.readiness|providers-unavailable|setting:integrations keys|observation (detail links `/settings?tab=integrations`)|—|—|advisory|6d|
|194|git.worktrees|missing.<id> (split)|task:<id>|task variant → repair NEW `git-release-worktree`; terminal-session variant → human decision|none → self-heal|session variant: Terminal session link (exists when Terminal is installed)|AR → fixing|6d|
|195|git.worktrees|registry-unreadable|record:git worktree registry|observation|—|—|watch|6d|
|196|pi.home / pi.agents-root|installation|runtime:pi|human external-install|—|Terminal-session handoff with the install command, else copy block; re-check on session end (NEW)|AR while Pi is active|6e|
|197|pi.home|agent-registry|runtime:pi|core.diagnose|none → fallback lane|—|AR|6e|
|198|pi.auth / pi.models|provider-configuration|runtime:pi|human credential (Pi `/login`)|—|Terminal-session handoff naming provider + home (NEW)|AR|6e|
|199|pi.models|model-registry|runtime:pi|core.diagnose|none → fallback lane|—|AR|6e|
|200|pi.extensions|extension-approval|runtime:pi|human decision (allow extensions)|—|`/runtime?tab=runtimes` Allow exists|AR only while something needs the extension|6e|
|201|pi.extensions|extension-discovery|runtime:pi|observation|—|—|watch|6e|
|202|openclaw.override-authorization|unverified|runtime:openclaw|observation|—|—|advisory|6e|
|203|openclaw.override-authorization|routes unreadable|runtime:openclaw|observation|—|—|advisory|6e|
|204|openclaw.override-authorization|override-authorization|runtime:openclaw|human credential (grant `operator.admin`)|—|Terminal handoff with grant + restart command and return verification (NEW)|AR while model overrides are configured|6e|
|205|core.onboarded|onboarding-required|system:onboarding|repair NEW `core.onboard` (wraps `bakin onboard` components)|W (first-run choices) → one-click|—|AR|6e|
|206|core:verification:<checkId>|<checkId> (check crashed)|the check owner's subject|core.diagnose|none → fallback lane|—|watch, escalates per §3.4|6e|

## New repair actions (id — effects/mode — what)
- `search-engine-restart` (health) — R=search-engine, self-heal — `restartEngine()` + canary; attempt 2 = `search-engine-install`; `search-canary-restart`, `search-engine-burn-restart`, `search-consistency-restart` become aliases.
- `search-engine-install` (health) — R=search-engine, self-heal — wraps `bakin install search` / `searchEngineReinstallOperation`.
- `search-engine-claim` (health) — R=search-engine, decision-card only — claims search for this home.
- `search-drop-unclaimed-tables` (health) — decision-card only — drops engine tables Bakin does not own.
- `search-engine-watch-reset` (health) — none, self-heal — moves `engine-watch.json` aside.
- `package-sync` (packages) — none / W on delta, self-heal — wraps `packageSyncOperation` for skill/npm/model legs.
- `package-reinstall` (packages) — none / W on delta, self-heal — same-commit reinstall from the manifest staged at the recorded sha.
- `plugin-upgrade` (plugins) — none / W on delta, self-heal — `upgrade-plugin-artifact` renamed, wraps `plugins upgrade`.
- `plugin-reinstall` (plugins) — none / W on delta, self-heal — reinstall the same identity.
- `service-setup` (core) — R=bakin, self-heal — wraps `bakin setup service`.
- `runtime-restart` (adapters) — R=runtime, self-heal — restart the gateway where supported, else core.diagnose.
- `session-store-prune` (adapters) — D, one-click — adapter session cleanup.
- `discord-bridge-reconnect` (delivery) — none, self-heal — restart the bridge connection.
- `requeue-stranded-tasks` (tasks) — S, one-click — requeue restart-stranded tasks.
- `budget-resume` (spend) — S, one-click — wraps `bakin budget resume`.
- `git-release-worktree` (git) — none, self-heal — release a stale task-worktree registry entry.
- `health-acks-reset` / `health-acks-prune` (health) — none, self-heal.
- `core.onboard` (core) — W, one-click — wraps onboarding components.
- `core.diagnose` (core) — none — the fallback lane (spec §3.1/§3.4).

Existing actions whose effects change: three search rebuilds destructive → none (self-heal); `search-outbox-revive` manual → none; `apply-recommended-routes`, `accept-unattributed-history` → W (one-click); `migrate-agent-blocks`, `remove-orphan-instances`, `complete-cutover`, `remove-unrunnable-jobs`, `repair-store` purge item → D (one-click); `sync-agents` planner extended to severity-error autoFixable findings; `install-plugin-assets` gets a per-item D "restore shipped"; `apply-model-proposal` → W (one-click), per spec D2.

## New human controls to build (17)
1 Explore pack card honours `capability=`, shows installed not-ready packs, secret-slot field links, prereq copy block (#6). 2 Terminal-session sign-in handoff with return verification, copy block fallback (#7, #196, #198, #204). 3 /runtime provider-credential field id + highlight (#12, #104). 4 channel-aliases href `&field=` (#20). 5 Discord bot invite OAuth handoff (#26). 6 search service-ownership card with two executable choices (#54). 7 unclaimed-tables card Drop/Keep (#76). 8 plugin-assets drift card Keep/Restore (#94). 9 stranded-plugin "Disable plugin" containment (#98). 10 `/spend?recover=1` (#40, #161). 11 runaway-usage "Pause agent dispatch" (#50). 12 `/team?recover=1` roster editor (#106, #107). 13 task assignee deep link (#118). 14 `/workflows?recover=1&skill=` and `/workflows/<id>?recover=1` (#127–137). 15 spend incident/cap buttons on the Health card (#163, #167). 16 `/assets/<id>?recover=1` (#174, #180–182). 17 `/brands/<id>?recover=1` Detach (#189).

## Counts (206 rows)
Self-heal repair 43 · core.diagnose 9 · one-click 14 (incl. #158) · human 33 · observation 103 · fold 4.
