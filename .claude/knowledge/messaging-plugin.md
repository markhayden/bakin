# Messaging Plugin

Messaging is no longer a Bakin core plugin. Its source, tests, and plugin-owned documentation live in `bakin-bits-official/plugins/messaging`.

Core Bakin keeps only the stable host surface for installed plugins:
- client route slots for `/messaging/calendar` and `/messaging/brainstorm`
- `/api/plugins/messaging/*` dispatch through the plugin route registry after installation
- runtime-discovered CLI commands from the plugin manifest
- scoped storage under `plugin-data/messaging/`

Planning sessions are plugin-owned durable records. The plugin stores visible user, assistant, and `activity` timeline entries under `messaging/sessions/<id>.json`, plus proposals. Runtime conversation continuity is adapter-owned: session message routes and exec tools pass a stable SDK-built `threadId` (`messaging:${sessionId}:${agentId}`) through `ctx.runtime.messaging`, rather than replaying prior stored messages into every prompt. Search indexes user/assistant planning text and proposal summaries; tool activity stays available in the UI timeline but is excluded from `message_body`.

Live runtime turns can be scoped per request with `RuntimeMessageArgs`:
`toolsMode`, `toolsAllow`, and `toolsDeny`. Use this on
`ctx.runtime.messaging.send()` or `.stream()` when a planning/prep turn needs a
hard tool boundary, for example `toolsMode: 'none'` for text-only planning. This
is separate from cron `toolsAllow`, plugin manifest permissions, and workflow
step ownership.

The official plugin must use task-backed scheduling for production work:

- Plans hold concrete `channels`, not core-owned state.
- Activating a Plan creates one Deliverable and one scheduled board task per
  channel.
- The task has `availableAt`, `dueAt`, and `source.pluginId = "messaging"`.
- Workflow-backed Deliverables start `planned`; bare-task Deliverables start
  `in_prep` because agents can only mark `in_prep` or `changes_requested`
  Deliverables ready for review.
- Messaging must not register cron jobs, sweep hooks, or Schedule-owned jobs
  for content prep/publish polling.
- Failed Deliverables recover through explicit web/API actions owned by the
  official plugin. Workflow-backed recovery must call Workflow hooks such as
  `workflows.loadInstance` and `workflows.reopenFromStep`; it must not read or
  write Workflow instance files directly.
- Workflow completion publish failures must stay visible on the task board.
  The official plugin creates or reuses a blocked task with
  `source.purpose = "publish-failure"` when publish validation or runtime
  channel delivery fails after workflow completion.

Do not restore `plugins/messaging/`, `tests/plugins/messaging/`, `src/core/messaging-cron.ts`, `~/.bakin/messaging.json`, or a top-level `~/.bakin/messaging/` data path in this repo.

## Brand integration (#419, external milestone)

Plans gain `brandId`; activation stamps it onto every spawned deliverable task
(top-level field, NOT `source` — a plan is the brand decision point, and tasks
whose plan sets no brand still inherit via project). Lives in
bakin-bits-official; the core contract (task brandId + dispatch injection) is
already in place.
