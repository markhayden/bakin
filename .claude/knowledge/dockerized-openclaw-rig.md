# Dockerized OpenClaw dev rig

Deep reference for the `instance` rig (`scripts/instance.ts` + `scripts/instance/*`).
User-facing walkthrough: `dev/docker/README.md`.

## Goal & shape

One command → a fresh, fully-configured OpenClaw container, so Bakin can be
developed on the Mac without contaminating `~/.openclaw`. Replaced the old
bash `dev/docker/setup.sh` + `cmd/setup`. A TS orchestrator (pure, testable
modules; shells out to `docker compose` + `op`) drives everything; all state is
in the gitignored `dev/openclaw-home/` + `dev/bakin-instances/`.

The rig is OpenClaw-specific dev tooling at the adapter layer, so
`scripts/instance*` is exempt from the provider-boundary rules (per-rule in
`tests/architecture/adapter-boundary.test.ts`, wholesale in the edit-time hook).

## Modules

- `args.ts` — pure arg parsing (verbs, modes, cross-flag validation)
- `paths.ts` — instance layout under `dev/`; reset targets never reach `~/.bakin`/`~/.openclaw`
- `op-resolve.ts` — resolve `op://` refs from `dev/docker/secrets.op.env`; only resolved values enter the container
- `env-file.ts` — load `dev/docker/.env` (e.g. `OP_SERVICE_ACCOUNT_TOKEN`); real shell exports win
- `openclaw-config.ts` — build OpenClaw CLI argv (brave-search via `mcp set`; discord)
- `codex.ts` — fresh browser OAuth detection/flow (never stored)
- `modes.ts` — mode → execution plan (native/isolated/sandbox)
- `lifecycle.ts` — up/reset/down/status; the bootstrap + ordering live here
- `sandbox.ts` — exec-into-container helpers
- `mcporter.ts` — write per-agent `bakin-<agent>` MCP config into the agent container. **STALE (runtime-capabilities post-α addendum):** agents are now instructed to use native MCP entries provisioned by the adapter, which bake `http://localhost:<port>` — container-unreachable. The rig needs re-plumbing onto `BAKIN_MCP_BASE_URL` + adapter provisioning before it can validate OpenClaw tool access again.
- `device-approve.ts` — generate + pre-approve the gateway device (dispatch)
- `record-gateway-frames.ts` — standalone gateway frame recorder (WS1a T1):
  drives an `agent` RPC against any gateway (reuses the adapter's device-auth)
  and captures every wire frame, sanitized, to JSONL — the source of
  `tests/fixtures/openclaw-gateway-frames/`; re-record instructions in that
  dir's README

## Hard-won knowledge (non-obvious)

These cost real debugging; don't re-derive them.

- **Gateway needs config to start** — empty home → exits "Missing config". Bootstrap
  runs `onboard --non-interactive --accept-risk --mode local --auth-choice skip --skip-health`.
- **`bind=lan` is required** for the host to reach the gateway via the docker
  port-forward (a loopback bind isn't reachable that way). And **`bind=lan` refuses
  `auth=none`** — so the gateway uses `auth.mode=token` with a pinned dev token
  (`gateway.auth.token == gateway.remote.token`) so the loopback CLI authenticates.
- **`rm -rf` of a bind-mounted dir poisons Docker Desktop's cache** (container sees a
  stale/empty mount). Reset wipes *contents* in place (`emptyDir`), never the dir.
- **Cross-agent dispatch needs `operator.write`**, which the gateway grants only to a
  **paired device identity** — not a shared token. The full solution:
  1. Bakin's gateway client signs the connect challenge with an ed25519 device key
     (`adapter-openclaw/device-auth.ts`, v3 payload). **The signature covers the
     gateway shared token, not the device token** (the subtle bit).
  2. The operator-pairing approval is a bootstrap chicken-egg (approving needs
     `operator.pairing`). The rig sidesteps it by writing a pre-approved pairing
     record directly into the disposable home (`device-approve.ts`).
  3. `plugins.allow=["discord"]` — without it the "plugins.allow is empty" warning
     makes `agents add` look failed, and the adapter falls back to writing a **host**
     workspace path that breaks in-container dispatch (`EACCES mkdir /Users`).
  Reference clients: OpenClaw's own `packages/gateway-client` + `clippy/src/lib/device-identity.ts`.
- **Operator scopes must include `operator.admin` + `operator.pairing`** — OpenClaw
  2026.5.28's `cron add/list` CLI requests them on top of read/write; with only the
  old read/write pair every cron command dies on "scope upgrade pending approval"
  (the same pairing chicken-egg as above, #467). `OPERATOR_SCOPES` in
  `device-approve.ts` carries all four, and `ensureApprovedDevice` reconciles
  REUSED rig state in place (`widenDeviceScopes` unions into `scopes`,
  `approvedScopes`, `tokens.operator.scopes`; keypair/token untouched) — no
  `instance reset`, no lost Codex auth. Runs before the gateway starts.
- **host ↔ container paths** — the `openclaw-shim` translates the host openclaw-home
  prefix → `/home/node/.openclaw` in CLI args, so path-passing commands (agents add)
  target the container. Stored config paths are the other half: `plugins.allow`
  prevents the bad host-path write at the source, and `instance up` normalizes any
  already-stored host `agentDir`/`workspace` values back to the container home
  (`agent-paths.ts`, runs pre-gateway; symptom of stale paths: dispatch fails with
  `EACCES: mkdir '/Users'`, #467).
- **`BAKIN_URL`** = the container's callback URL (`host.docker.internal:3737`); the
  host-run Bakin CLI uses `localhost:3737` instead (`instance run`/`shell` override it).
  The per-agent mcporter `bakin-<agent>` configs **bake this URL in at `up` time** —
  running Bakin on a non-default port for testing means rewiring those configs in the
  container (and reverting after); a plain server restart on 3737 needs nothing.

## Secret handling

Secrets are `op://` references in `secrets.op.env` (committed), resolved host-side
at `up` and injected only into the disposable home. `redactSecrets` masks resolved
values in every rig log line. Two accepted residuals on this single-user loopback
rig: the resolved Discord token transiently appears in the `docker exec … config
set channels.discord.token <token>` argv (visible via `ps` for that command's
lifetime — argv is not a safe channel; prefer stdin/env if OpenClaw's CLI grows
support), and the Codex `auth.json` + device private key sit in cleartext under the
gitignored `dev/openclaw-home/` until `reset`. Both are documented in
`dev/docker/README.md`; exclude `dev/openclaw-home/` from backups.

## Known limitation

Cross-agent dispatch is wired + verified, but relies on the rig pre-approving the
device + `plugins.allow`. The clean re-auth path (`--fresh`) re-triggers interactive
Codex OAuth. Native vs sandbox differ only in where Bakin runs; both can dispatch.

**Asset-save path gap (native/isolated modes):** the agent runs in the container
and writes deliverables under `/home/node/.openclaw/workspace/…`, but
`bakin_exec_assets_save` executes host-side and can't read container paths — the
agent will (correctly) block the task with a path explanation. Production is
unaffected (Bakin + OpenClaw share one filesystem on the Mac mini). Observed
live during the 2026-06-04 ladder smoke; if rig-level asset saving is ever
needed, mount the workspace or translate paths like the openclaw-shim does.

## Validation campaign

`bun run scripts/instance/validate.ts` (rig up first) runs the session-death
hardening validation: gateway sanity, real-turn e2e + forensics against live
trajectories, same/cross-agent concurrency probes, benchmarks, a
gateway-restart failure drill, a session-retention probe, and the **abort
workaround re-verify (R7)** — the real-wire owner of the
`openclaw#TBD-abort-registration` workaround pin (threaded sends carry
`sessionKey` alongside `sessionId`; the CI pin only tests the Imitation Crab
mirror). **Run the campaign after every OpenClaw version bump**; if R7.2
reports the sessionId-only defect gone, follow the deletion checklist in
`tests/dev/openclaw-workaround-regressions.test.ts`. Standalone probes:
`scripts/instance/abort-ladder-probe.ts` (defect) and
`scripts/instance/abort-workaround-probe.ts` (fix shape), sharing the
`frame-sanitize.ts` redaction pass with the frame recorder. See
`.claude/knowledge/session-forensics.md` for the system it validates.
