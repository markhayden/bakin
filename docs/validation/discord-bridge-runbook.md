# Discord Delivery Bridge — Live Validation Runbook (Checkpoint 1)

Branch: `feat/discord-bridge` (Phase A — delivery). Spec:
`.claude/specs/discord-bridge/SPEC.md`. Run on the live box with the real
guild. Phase B (inbound chat) has its own checkpoint later.

## Preconditions (done by setup, verify anyway)

- [ ] `discord.botToken` present: Settings → Integrations & Keys shows
      integration `discord` / secret `botToken` (never the value).
- [ ] `~/.bakin/settings.json` has `integrations.discord` (enabled, guild
      1483917789918920714, approvers + inbound allowFrom = your user id).
      Backup: `~/.bakin/settings.json.bak-discord-bridge`.
- [ ] OpenClaw daemon STOPPED (same-token double-handling). `ps aux | grep
      openclaw` is empty.
- [ ] Server restarted from the branch (server code is not hot-reloaded):
      kill the running dev server, `bun run dev` from the repo tree.

## Checks

1. **Boot** — server log shows `Discord delivery bridge connected`;
   `audit.jsonl` gains `delivery.connected`.
2. **Doctor** — Health page (or `bakin check all`): `Discord delivery
   bridge` check is healthy (guilds/approvers evidence). Channel-aliases
   check now validates against bridge channels.
3. **Notification send** — trigger any alert path or use
   `bakin_exec_post_channel` / a workflow notify step to
   `discord:channel:1492965013642543205` — message arrives once, chunked
   correctly if long.
4. **Gate card round-trip (approve)** — run a gated workflow (or
   `scripts/validate-gates.ts` pattern from the gate-discord initiative):
   card renders in the approvals channel with Approve/Reject + "Review in
   Bakin" link; clicking Approve records the decision (task resumes, card
   buttons strip, decision summary edits in, `gate.approved` audit with
   your Discord actor id).
5. **Gate card round-trip (reject + modal)** — Reject opens a modal;
   typed reason lands in the durable approval record + step history
   (NOT the canned "no reason provided" default).
6. **Unauthorized click** — from a second account (or temporarily remove
   yourself from `approvers` via System & Alerts): click is ephemeral-denied,
   `delivery.approval_denied` audited, gate stays pending.
7. **DM send** — deliver to `discord:user:202168845362921483` — arrives as
   a DM from the bot.
8. **Oversize fallback** — deliver an asset > 25 MB — message arrives with
   the honest "too large to attach" note instead of an error.
9. **Restart idempotency** — restart the server mid-pending-gate: the
   pending approval re-renders (rehydration) WITHOUT double-posting a
   decision; clicking a button on the OLD card still resolves (footer
   carries the approvalId).
10. **Exactly-once** — throughout: the bot answers/acts exactly once per
    event (daemon check).

## Sign-off

Owner approves → open PR 1 (`feat/discord-bridge` → main), merge, then
branch `feat/discord-inbound-chat` for Phase B.
