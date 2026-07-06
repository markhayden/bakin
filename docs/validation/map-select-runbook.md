# Multi-Image Select / map_workflow validation runbook (#203)

Live end-to-end validation of the `map_workflow` engine + the
`image-multi-select` workflow on the dockerized OpenClaw rig, with Discord
gate approvals and real (cheap) image generations. Operator-present: you
click Discord buttons and confirm what you see; the harness machine-checks
everything else.

Harness: `bun scripts/validate-map-select.ts --scenario <name> --report <file>`
Scenarios: `happy`, `reject-prompt`, `retry-child`, `cancel-parent`.

## 1. Rig bring-up (isolated mode — never native for tests)

```bash
bun run instance up --mode isolated        # OpenClaw container + pre-approved device
bun run instance dev --mode isolated       # Bakin from source, BAKIN_HOME=dev/bakin-instances/isolated/home
```

Requirements (see `dev/docker/README.md`):
- Docker running, `op` CLI installed, `OP_SERVICE_ACCOUNT_TOKEN` in `dev/docker/.env`.
- Discord secrets present in 1Password (`discord-bot-token`, `discord-guild-id`,
  `discord-user-id-*` refs in `dev/docker/secrets.op.env`) — their presence is
  what wires the Discord channel into the container.
- Codex OAuth completes in the browser during `instance up` on a fresh home.

## 2. Bakin-side notification config (gate approvals → Discord)

In the ISOLATED home (`dev/bakin-instances/isolated/home`), mirror the
gate-discord runbook config:

`settings.json`:
```json
{
  "notifications": {
    "channel": "discord",
    "target": "channel:<general-channel-id>",
    "channelAliases": { "approvals": "discord:channel:<approvals-channel-id>" }
  }
}
```
The `discord:channel:` prefix on the approvals alias is REQUIRED — bare ids
fall back to approver DMs (`.claude/knowledge/workflow-approvals.md`).

`plugin-settings/workflows.json`:
```json
{ "approvalChannelAlerts": true, "approvalChannel": "approvals", "requireRejectReason": true }
```

Set `BAKIN_URL` to a hostname reachable from your Discord devices (Tailscale
name) if you want fallback decision links to work off-box.

## 3. Image-generation credentials

Try Codex-served OpenAI FIRST — confirmed working on the main instance with
Codex auth alone. Pre-flight before any billed run:

- `bakin check all` / the images health check should show a usable route, or
- ask the rig agent to run `bakin_exec_images_recommend` (surface
  `instagram-feed-portrait`, quality `draft`) and confirm it returns a route
  with `servedBy: runtime`.

Fallback if routing fails: uncomment the `OPENAI_API_KEY` op:// ref in
`dev/docker/secrets.op.env`, re-run `bun run instance up --mode isolated`, and
confirm the key reaches the gateway (`docker exec` env or the images health
check flipping to configured).

Cost control is in the workflow itself: quality `draft`, small surface, 3
variants per run, and the prompt gate blocks generation until you approve.

## 4. Known rig gaps that affect this validation

- **Asset bytes over HTTP:** `select-best` downloads variants from
  `{BAKIN_URL}/api/assets/<assetId>`. From inside the container the host is
  `http://host.docker.internal:3737`. Pre-flight: after any asset exists,
  `docker exec <gateway> curl -sI http://host.docker.internal:3737/api/assets/<id>`
  → 200. There is no auth layer on the API.
- **`bakin_exec_assets_save` container-path gap** (rig doc §95-101) does NOT
  apply here: the images tools persist server-side, and consolidation is a
  server-side exec tool. If an agent tries to hand-save files instead of using
  the tools, that's a prompt-compliance failure, not a rig failure.
- Discord buttons expire if Bakin restarts mid-run — use the fallback decision
  page linked in the message, or the Bakin UI.

## 5. Run order

1. `happy` — full journey; proves fan-out ids/context, ordered join,
   consolidation end state (1 asset / 3 versions / winner current / losers
   trashed), both Discord gates (selection approval must record
   `source: 'channel'`).
2. `reject-prompt` — spend guard: rejection rewinds with ZERO children spawned.
3. `retry-child` — per-child cancel via route → join blocks → retry reuses the
   childTaskId → join completes ordered.
4. `cancel-parent` — parent cancel sweeps every live child.

```bash
bun scripts/validate-map-select.ts --scenario happy --report docs/validation/map-select-happy.md
```

Each scenario exits non-zero if any machine check or operator confirmation
failed; reports go next to this runbook. Record results in
`.claude/specs/map-workflow-and-multi-image-select.md` (#385 precedent).

## 6. Cleanup

Validation tasks are titled `[validation] multi-image-select ...` — block or
delete them from the board (deleting also aborts in-flight turns and the
watchdog force-releases orphans). Generated assets live only in the isolated
home; `bun run instance reset` wipes the rig state entirely.
