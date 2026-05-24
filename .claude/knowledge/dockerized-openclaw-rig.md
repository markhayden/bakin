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
- `mcporter.ts` — write per-agent `bakin-<agent>` MCP config into the agent container
- `device-approve.ts` — generate + pre-approve the gateway device (dispatch)

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
- **host ↔ container paths** — the `openclaw-shim` translates the host openclaw-home
  prefix → `/home/node/.openclaw` in CLI args, so path-passing commands (agents add)
  target the container. Stored config paths (agent workspaces) are the gap the
  `plugins.allow` fix closes.
- **`BAKIN_URL`** = the container's callback URL (`host.docker.internal:3737`); the
  host-run Bakin CLI uses `localhost:3737` instead (`instance run`/`shell` override it).

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
