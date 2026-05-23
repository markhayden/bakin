# Dockerized OpenClaw dev rig

One command spins up a fresh, fully-configured **OpenClaw in Docker** so you can
develop Bakin on this machine without contaminating your host `~/.openclaw`, and
exercise onboarding + the full agent-orchestration loop against a clean slate.

Contributor/dev setup. End-user install lives in the
[public docs](https://makinbakin.com/docs/start/install/).

Driven by `bun run instance …` (`scripts/instance.ts`). All state lives under
the gitignored `dev/openclaw-home/` + `dev/bakin-instances/`.

## Prerequisites

- Docker Desktop (or OrbStack)
- Bun >= 1.2.0
- **1Password CLI (`op`)** + a service-account token. Put it in the gitignored
  `dev/docker/.env` (the rig auto-loads it):
  ```
  OP_SERVICE_ACCOUNT_TOKEN=ops_…
  ```
- 1Password items the rig resolves (references live in `dev/docker/secrets.op.env`):
  - `brave-search` (required) — the one default tool
  - `discord-bot-token` / `discord-guild-id` / `discord-user-id-…` (optional)

Codex is **not** a stored secret — each fresh instance mints its own via a
browser OAuth flow.

## Quickstart

```bash
bun run build:plugins && bun run build:host   # first time only
bun run instance up                            # provision OpenClaw (codex OAuth on first/fresh run)
bun run instance dev                           # run Bakin → http://localhost:3737
```

- **Bakin UI** → http://localhost:3737
- **OpenClaw dashboard** → http://127.0.0.1:18789

`instance up` brings up a configured OpenClaw container — fresh Codex OAuth,
brave-search (from 1Password), Discord (if its token is in the template), a
pre-approved gateway device (for dispatch), and Bakin's MCP tools wired in.
`instance dev` onboards the home if needed and runs Bakin with hot reload.

## Modes

The OpenClaw container is identical across modes; they differ in where Bakin runs.

| Mode | Bakin runs | Best for |
|------|-----------|----------|
| `native` (default) | on your Mac (real `~/.bakin`) | everyday hot-reload dev |
| `isolated` | on your Mac, throwaway `BAKIN_HOME` under `dev/` | replaying onboarding cleanly |
| `sandbox` | inside the container (`--source repo`/`installed`) | clean-box onboarding tests |

```bash
bun run instance up --mode isolated
bun run instance dev --mode isolated
```

## Commands

```
instance up [--mode …] [--fresh] [--source repo|installed] [--preconfigure]
instance dev [--mode …]          # run Bakin → :3737 (onboards if needed)
instance run -- <bakin args>     # Bakin CLI in-context
instance shell [--mode …]        # subshell with the instance env (sandbox: into the container)
instance status | env
instance down                    # stop containers (state preserved)
instance reset [--mode …]        # stop + wipe state (fresh next up)
```

OpenClaw CLI: `./dev/docker/openclaw-shim.sh <args>` (e.g. `mcp list`, `models status`).

## Installing agent packages

```bash
bun run instance run --mode isolated -- agents install ../bakin-bits-official/agents/pixel
```

The shim translates the host openclaw-home path → the container path, so the
agent workspace lands correctly inside the container.

## Cross-agent dispatch (how it works)

Bakin (the operator) dispatches to agents through the gateway, which requires
the `operator.write` scope. The rig wires this automatically:

1. **Device identity** — Bakin's gateway client signs the connect challenge with
   a device key (`adapter-openclaw/device-auth.ts`). Without it the gateway
   strips `operator.write`.
2. **Pre-approval** — `instance up` writes a pre-approved pairing record into the
   disposable home (`device-approve.ts`), beating the operator-pairing bootstrap.
3. **`plugins.allow`** — set when installing the Discord plugin, so `agents add`
   doesn't fall back to writing a host workspace path that breaks in-container.

Net: ask Penelope in Discord to "create a Bakin task for Pixel" and it dispatches
through the task board to Pixel.

## Teardown

```bash
bun run instance down            # stop containers, keep state
bun run instance reset           # stop + wipe state (next up is fresh + re-auths codex)
docker compose -f dev/docker/docker-compose.yml --profile sandbox down --rmi local  # remove images too
```

## Troubleshooting

- **`403 Service Account Deleted` / op auth errors** — a *stale* `OP_SERVICE_ACCOUNT_TOKEN`
  exported in your shell overrides `.env`. Run with `env -u OP_SERVICE_ACCOUNT_TOKEN bun run instance up`.
- **brave-search ref fails** — vault names with spaces: try the vault ID form in
  `secrets.op.env` (commented there).
- **Codex re-auth** — only `reset`/`--fresh` wipes the home; that forces a new browser OAuth.
- **`:latest` drift** — pin via `OPENCLAW_IMAGE_TAG=<tag>` in `.env`.

## Other dev modes

| Command | OpenClaw | Best for |
|---------|----------|----------|
| `bun run instance dev` | Containerized (real) | integration, agent work, dispatch |
| `bun run dev:mock` | Imitation Crab (mock) | UI dev, offline, zero API cost |
