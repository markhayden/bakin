# Gate Approvals & Discord Notifications — Live Validation Runbook

Validates end-to-end that workflow approval gates notify Discord and accept
decisions from Discord buttons, the fallback decision page, and the Bakin UI.
Driven by `scripts/validate-gates.ts` against the **live** server with **real
templates and real agents** — the operator must be present to click Discord.

Spec + acceptance criteria: `SPEC.md` (US1–US7). Plan: `tasks/gate-discord/plan.md`.

## Prerequisites

1. **Server** running the branch/build under test on port 3737 (`bakin status`).
   Server code is not hot-reloaded — restart after checking out new code.
2. **Settings** (`~/.bakin/settings.json`) — the approvals alias MUST use the
   `channel:` prefix or OpenClaw's native approval prompts fall back to
   approver DMs (its origin resolver requires an explicit `channel:`/`group:`
   prefix on `turnSourceTo`; bare ids are ignored):
   ```json
   "notifications": {
     "channel": "discord",
     "target": "channel:<general channel id>",
     "channelAliases": { "approvals": "discord:channel:<approvals channel id>" }
   }
   ```
   The `channel:` prefix applies to `target` too — OpenClaw rejects bare
   Discord ids as ambiguous ("for channels use channel:<id>"), which breaks
   the watchdog's gate alert and anything using the synthesized `general`
   alias.
3. **Workflows plugin settings** (`~/.bakin/plugin-settings/workflows.json`):
   `approvalChannelAlerts: true`, `approvalChannel: "approvals"`,
   `requireRejectReason: true`.
4. **OpenClaw Discord channel** configured with `execApprovals.enabled: true`
   (native buttons need the interactive-approval capability).
5. **Prompt routing:** where native approval prompts land is decided by
   OpenClaw (`extensions/discord/src/approval-native.ts`), not Bakin:
   - The prompt posts into a channel only when the request's `turnSourceTo`
     carries an explicit `channel:`/`group:` prefix — hence the alias format
     above. Bare ids silently fall back to approver DMs.
   - `channels.discord.execApprovals.target` (`dm` | `channel` | `both`)
     then controls whether the approvers also get a DM copy.
   - `approvals.plugin.{enabled,mode,targets}` is a separate
     forwarded-message pipeline and is NOT needed for native button prompts.
   Native buttons render as OpenClaw's "Allow once"/"Don't allow" (labels not
   customizable); "Always allow" is suppressed via `allowedDecisions`.
5. Operator watching the Discord approvals channel.

## Scenario matrix

| Scenario | Spec stories | What it proves | Cost |
|---|---|---|---|
| `delivery` | US1 | Gate → approval record → Discord message with fallback link | 1 agent turn |
| `approve` | US1, US2, US6 | Native button approve → advance → decision mirrored → real publish | ~2 agent turns + 1 real Discord post |
| `reject` | US3 | Button reject auto-fills default reason → rewind → agent revises → re-gate → fallback-page reject with typed reason → rewind → approve | ~3 agent turns |
| `ui-approve` | US4 | Bakin REST/UI approve resolves the pending Discord approval | 1–2 agent turns |
| `nested` | US5, US6 | image-social-post nested workflow gates + publish | agent turns + **billed image generation** |

```bash
bun scripts/validate-gates.ts --scenario approve --agent main
bun scripts/validate-gates.ts --all --report docs/validation/report-$(date +%Y%m%d).md
```

Flags: `--agent` (assignee for `$assigned` steps, default `main`), `--workflow`
(default `text-social-post-copy`), `--rewind-step` (default `write-copy`),
`--report <file>`. `us1..us6` are accepted scenario aliases.

The script machine-checks instance state transitions, durable approval records,
and delivery refs under `~/.bakin/workflows/approvals/`; human-visible facts
(message arrived, buttons rendered, decision mirrored, post published) are y/n
prompts recorded as `operator confirmation` in the report.

## Semantics being validated (post-hardening contract)

- `approvalChannel` may be an alias — resolved through
  `notifications.channelAliases` (same resolver as `bakin_exec_post_channel`).
  Resolution failure is an **error** log and no delivery; the durable approval
  record still exists so rehydration can retry after the config is fixed.
- Native buttons render even when `requireRejectReason: true`. A button reject
  records the default reason `Rejected via runtime channel (no reason
  provided)`. Typed reasons are collected by the fallback decision page and
  the Bakin UI, which enforce them unconditionally.
- Approval-store GC runs at boot rehydration: resolved records older than 30
  days are deleted; pending records whose instance moved on are cancelled as
  orphaned. Boot log line: `Rehydrated pending workflow approvals`.

## Cleanup checklist (after every session)

1. **Tasks**: archive or delete the `[validation]` tasks the report lists
   (`bakin tasks list`, then move/delete via UI or CLI). Blocking a
   workflow-backed task cancels its instance.
2. **Discord**: delete the test posts published to the general channel and
   (optionally) the approval/summary messages in the approvals channel — manual.
3. **Assets**: delete image assets generated by the `nested` scenario
   (Assets UI or `bakin assets` — they are billed artifacts, keep if useful).
4. **Approvals dir**: `ls ~/.bakin/workflows/approvals/` — only current
   records should remain; resolved validation records age out via GC (or
   delete now).
5. Verify the board has no leftover `pending_approval` validation instances:
   `curl -s $BAKIN_URL/api/plugins/workflows/gates/pending`.
