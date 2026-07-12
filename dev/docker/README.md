# Dev rig (OpenClaw in Docker · Pi in-process)

One command spins up a fresh, fully-configured dev instance of **either agent
runtime** so you can develop Bakin on this machine without contaminating your
host `~/.openclaw`, `~/.pi`, `~/.bakin`, or any OS service — and exercise
onboarding + the full agent-orchestration loop against a clean slate.

Contributor/dev setup. End-user install lives in the
[public docs](https://makinbakin.com/docs/start/install/).

Driven by `bun run instance …` (`scripts/instance.ts`). All state lives under
the gitignored `dev/openclaw-home/`, `dev/pi-home*/`, `dev/bakin-instances/`.
Deep reference: `.claude/knowledge/dev-rig.md`.

## Runtimes

| | OpenClaw (`--runtime openclaw`, default) | Pi (`--runtime pi`) |
|---|---|---|
| Where it runs | gateway daemon in Docker | in-process inside Bakin (no daemon, no container for host modes) |
| Auth | Codex ChatGPT device-code OAuth at `up` | the pi TUI opens at `up` — type `/login` (ChatGPT login also unlocks image gen), then exit |
| Prereqs | Docker, `op` CLI + `OP_SERVICE_ACCOUNT_TOKEN` | none — the pinned SDK ships the `pi` CLI |

## Quickstart

```bash
bun run build:plugins && bun run build:host   # first time only

# OpenClaw (as always)
bun run instance up
bun run instance dev                          # Bakin + hot reload → http://localhost:3737

# Pi
bun run instance up --runtime pi              # opens the pi TUI: /login, then exit
bun run instance dev --runtime pi
```

- **Bakin UI** → http://localhost:3737
- **OpenClaw dashboard** (openclaw runs only) → http://127.0.0.1:18789

`instance dev` runs the real dev loop (`scripts/dev.ts`): plugin HMR, shell
reload, CSS swap — same as `bun run dev`, pointed at the instance.

## Modes

Modes choose where Bakin runs and which state it sees; `--runtime` chooses the
agent runtime. All six combinations work.

| Mode | Bakin runs | Best for |
|------|-----------|----------|
| `native` (default) | on your Mac (real `~/.bakin`) | everyday hot-reload dev |
| `isolated` | on your Mac, throwaway `BAKIN_HOME` under `dev/` | replaying onboarding cleanly |
| `sandbox` | inside the container (`--source repo`/`installed`) | clean-box tests, sandboxed agent execution |

```bash
bun run instance up --mode isolated --runtime pi
bun run instance dev --mode isolated --runtime pi
```

Isolated instances get their **own search engine** on `127.0.0.1:3838` (spawned
with `dev`, data under `dev/bakin-instances/isolated/antfly`) — the machine's
real antfly service on 3738 is never touched, never re-provisioned. Requires the
engine binary (`bakin install search` once, machine-wide).

## Commands

```
instance up     [--mode …] [--runtime openclaw|pi] [--fresh] [--source repo|installed] [--preconfigure]
instance dev    [--mode …] [--runtime …]   # Bakin + hot reload → :3737 (onboards if needed)
instance run    [--mode …] [--runtime …] -- <bakin args>
instance shell  [--mode …] [--runtime …]   # subshell with instance env (sandbox: into the container)
instance status | env [--mode …] [--runtime …]
instance down                              # stop containers (state preserved)
instance reset  [--mode …]                 # stop + wipe state for the mode — BOTH runtimes
```

OpenClaw CLI: `./dev/docker/openclaw-shim.sh <args>` (e.g. `mcp list`, `models status`).

## Assets from container agents

OpenClaw rig agents write deliverables inside the container; the rig exports
`BAKIN_AGENT_PATH_MAP` so `bakin_exec_assets_save` (and image reference inputs)
translate those paths to the bind-mounted `dev/openclaw-home/` before reading —
agent-created assets land for real in every mode. Pi agents write host paths
directly; no translation involved.

## Pi sandbox (`--mode sandbox --runtime pi`)

Bakin + Pi fully in-container (clean Linux box, sandboxed agent execution):

```bash
bun run instance up --mode sandbox --runtime pi    # compose up + in-container /login
bun run instance shell --mode sandbox --runtime pi # then: bakin onboard --yes
bun run instance run --mode sandbox --runtime pi -- doctor --json
```

In-container search: run `bakin install search` inside the container once (the
host's macOS binary can't be mounted in). Onboarding is manual by design
(`--preconfigure` is openclaw-only).

## Installing agent packages

```bash
bun run instance run --mode isolated -- agents install ../bakin-bits-official/agents/pixel
```

The shim translates the host openclaw-home path → the container path, so the
agent workspace lands correctly inside the container (openclaw runtime).

## Cross-agent dispatch (openclaw — how it works)

Bakin (the operator) dispatches through the gateway, which requires
`operator.write`. The rig wires this automatically: device identity (signed
connect challenge), a pre-approved pairing record written into the disposable
home, and `plugins.allow` so `agents add` doesn't write host workspace paths.
Pi needs none of this — dispatch is an in-process call.

## Teardown

```bash
bun run instance down            # stop containers, keep state
bun run instance reset           # stop + wipe state (next up is fresh + re-auths)
docker compose -f dev/docker/docker-compose.yml --profile sandbox down --rmi local  # remove images too
```

> **Credentials at rest:** `up` writes resolved secrets (Brave/Discord) into
> `dev/openclaw-home/openclaw.json`, Codex auth under `dev/openclaw-home/codex/`,
> and Pi auth under `dev/pi-home*/agent/auth.json` — all gitignored cleartext.
> `down` preserves them; only `reset` scrubs. Exclude `dev/openclaw-home/` and
> `dev/pi-home*/` from Time Machine / backups, and `reset` when you're done.

## Troubleshooting

- **`403 Service Account Deleted` / op auth errors** — a *stale* `OP_SERVICE_ACCOUNT_TOKEN`
  exported in your shell overrides `.env`. Run with `env -u OP_SERVICE_ACCOUNT_TOKEN bun run instance up`.
- **brave-search ref fails** — vault names with spaces: try the vault ID form in
  `secrets.op.env` (commented there).
- **Discord "access not configured" + pairing code** — DMs are gated by `commands.ownerAllowFrom`;
  `up` sets it from `DISCORD_USER_ID`. Manual approval: `./dev/docker/openclaw-shim.sh pairing list discord`
  then `… pairing approve discord <code>`.
- **Codex auth (openclaw)** — `up` runs the device-code login: open the printed URL, enter the code.
  Only `reset`/`--fresh` forces re-auth.
- **Pi auth** — `up --runtime pi` opens the TUI; you MUST complete `/login` before exiting
  (the rig verifies `auth.json` appeared and refuses to continue otherwise). Re-run `up` to retry.
- **Pi model** — the rig writes `routing.defaultModel` from your authed provider; if it
  warns instead, pick a model in the pi TUI or the Bakin UI.
- **Rig search engine missing** — isolated modes need the machine-wide engine:
  `bakin install search` (or set `ANTFLY_PATH`).
- **Image tag (openclaw)** — defaults are PINNED (Dockerfile/compose/lifecycle share one tag);
  bump alongside the Mac mini, override per-run via `OPENCLAW_IMAGE_TAG=<tag>` in `.env`.

## Other dev modes

| Command | Runtime | Best for |
|---------|---------|----------|
| `bun run instance dev` | Containerized OpenClaw (real) | integration, agent work, dispatch |
| `bun run instance dev --runtime pi` | In-process Pi (real) | pi integration, zero-docker agent work |
| `bun run dev:mock` | Imitation Crab (mock) | UI dev, offline, zero API cost |
