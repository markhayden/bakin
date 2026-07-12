# Dev rig (dual-runtime)

Deep reference for the `instance` rig (`scripts/instance.ts` + `scripts/instance/*`).
User-facing walkthrough: `dev/docker/README.md`.
Formerly `dockerized-openclaw-rig.md` (OpenClaw-only era) — renamed when `--runtime pi` landed.

## Goal & shape

One command → a fresh, fully-configured dev instance of either agent runtime, so
Bakin can be developed on this machine without contaminating `~/.openclaw`, `~/.pi`,
`~/.bakin`, or any machine-global OS service. A TS orchestrator (pure, testable
modules; shells out to `docker compose` + `op` + the pinned Pi SDK CLI) drives
everything; all state is in the gitignored `dev/openclaw-home/`, `dev/pi-home/`,
`dev/pi-home-sandbox/`, `dev/bakin-instances/`.

The rig is provider-specific dev tooling at the adapter layer, so `scripts/instance*`
is exempt from the provider-boundary rules (per-rule `isDevRig` in
`tests/architecture/adapter-boundary.test.ts` — OpenClaw, Pi, AND antfly-identifier
rules; wholesale in the edit-time hook).

## The (mode × runtime) matrix

`--runtime openclaw|pi` (default openclaw) on every verb except `reset`/`down`
(runtime-blind: they act on the whole mode). `modes.ts` resolves six cells:

| cell | docker | Bakin runs | key env | search |
|---|---|---|---|---|
| native×oc | gateway container | host, real `~/.bakin` | OPENCLAW_HOME/PATH, BAKIN_URL + BAKIN_MCP_BASE_URL (host.docker.internal), BAKIN_AGENT_PATH_MAP | real antfly (3738) |
| isolated×oc | gateway container | host, throwaway BAKIN_HOME | + BAKIN_HOME, BAKIN_SEARCH_SERVICE_MODE=child | rig child on 3838 |
| sandbox×oc | `sandbox` profile | in-container | (compose env) | in-container child |
| native×pi | **none** | host, real `~/.bakin` | BAKIN_RUNTIME_ADAPTER=pi, PI_HOME=dev/pi-home — NO OPENCLAW_*/BAKIN_URL/BAKIN_MCP_BASE_URL | real antfly (3738) |
| isolated×pi | **none** | host, throwaway BAKIN_HOME | pi keys + BAKIN_HOME + belt | rig child on 3838 |
| sandbox×pi | `sandbox-pi` profile | in-container | (compose env: PI_HOME, PI_CODING_AGENT_DIR, BAKIN_RUNTIME_ADAPTER, BAKIN_SEARCH_SERVICE_MODE=child) | in-container child |

Pi is **in-process** (no daemon): "pi in the rig" = a throwaway `PI_HOME` wherever
Bakin runs. Host pi modes need no docker at all — `up --runtime pi` runs no
compose, no `op`, no device pairing. Host modes share `dev/pi-home`; sandbox gets
`dev/pi-home-sandbox` because its registry/sessions record container path strings
(`/home/node/.pi/…`) a host boot must never read.

## Modules

- `args.ts` — pure arg parsing (verbs, modes, runtimes, cross-flag validation:
  `--runtime` rejected on reset/down; `--preconfigure` sandbox+openclaw only;
  `--source installed` invalid for pi host modes)
- `paths.ts` — instance layout under `dev/`; reset targets (runtime-blind, both
  runtimes' homes + the isolated antfly data dir) never reach real homes
- `modes.ts` — the 6-cell plan matrix; `RIG_ANTFLY_PORT = 3838` + `rigAntflySearchUrl()`
- `lifecycle.ts` — `up` dispatches: shared `wipeIfFresh`/`applySettingsPatch`,
  then `upOpenClaw` (unchanged bootstrap: onboard/bind=lan/dev token/codex/secrets)
  or `upPi` (agent dir → [sandbox: compose up] → TUI /login when unauthenticated →
  routing.defaultModel, warn-don't-fail)
- `pi.ts` — Pi paths/env/argv + `defaultModelFromAuth` + `patchPiSettings`
- `throwaway-settings.ts` — settings.json merge-patch for isolated homes
- `antfly-child.ts` — rig-managed engine child for isolated mode
- `op-resolve.ts` / `env-file.ts` — secrets + rig env (openclaw path only)
- `openclaw-config.ts`, `codex.ts`, `device-approve.ts`, `agent-paths.ts`,
  `sandbox.ts` (service-parameterized: `sandbox` | `sandbox-pi`) — unchanged
  OpenClaw provisioning (see the sections below)
- `record-gateway-frames.ts`, `validate.ts` — OpenClaw validation tooling (unchanged)

## Pi specifics (hard-won)

- **The pinned SDK has NO `pi login` subcommand.** Subscription auth is the
  interactive TUI's `/login` slash command. The rig spawns the TUI
  (`node packages/adapter-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`)
  and the user drives it; **the only success evidence is auth.json existing
  afterwards** (exit code proves nothing) — `upPi` re-checks and throws actionably.
- **Env alignment:** Bakin's `PI_HOME` is the home ROOT; the SDK's
  `PI_CODING_AGENT_DIR` **is the agent dir**. The rig sets
  `PI_CODING_AGENT_DIR=$PI_HOME/agent` so both resolve the same auth.json.
- **Default model:** the seeded `main` agent has no model; `upPi` derives
  `provider/model` from auth.json providers + the SDK's own
  `defaultModelPerProvider` table (dynamic-imported by path — the SDK is a
  workspace dep of adapter-pi, not hoisted) and writes `routing.defaultModel`
  into `$PI_HOME/agent/settings.json` unless one is already set. Never fatal.
- **ChatGPT `/login` alone gives Pi image generation + editing** — the
  `openai-codex` OAuth drives the hosted image tool (see pi-adapter.md).
- Adapter selection rides `BAKIN_RUNTIME_ADAPTER` (applied inside `getSettings()`
  at the cache chokepoint) — the rig NEVER writes the real `~/.bakin/settings.json`.
  Throwaway (isolated) homes also get `runtime.adapter` written into their own
  settings.json so the home is self-consistent.

## Search isolation — the launchd-clobber guard

**History:** antfly's LaunchAgent (`io.bakin.antfly`) + port 3738 are machine
singletons, and the unit file is a byte-compared fingerprint of `getBakinPaths()`.
On 2026-07-11 a rig isolated boot reached `ensureProvisioned` and REWROTE the real
unit to point at `dev/bakin-instances/isolated/home/antfly`. Three layers now make
that structurally impossible:

1. **Guest-URL settings patch** (isolated, both runtimes): the throwaway home's
   `search.settings.url` = `http://127.0.0.1:3838` — any non-default URL is guest
   mode (`isLocalDefaultUrl`), which never provisions, spawns, or touches disk.
   Re-applied by `instance dev` after onboarding (onboard can rewrite settings.json).
2. **Rig-managed antfly child**: `instance dev --mode isolated` spawns the engine
   itself on 3838 (health 3839 — the real instance owns 3738/3739), data under
   `dev/bakin-instances/isolated/antfly`, machine-wide binary + models read-only
   (`ANTFLY_PATH`/`ANTFLY_HOME` overrides honored). Killed in `finally` with the
   server. Argv pins the adapter's `buildServiceArgv` shape minus `--preload-model`
   (dev accepts a first-embed cold load). Working search, zero OS-service paths.
3. **Env belt** `BAKIN_SEARCH_SERVICE_MODE=child`: if the patch is ever lost, the
   accepted override values (launchd|systemd|child — 'guest' is URL-derived only)
   mean worst case is a strict child failing to bind 3738 — degraded search, never
   a plist write.

Guard pinned by `tests/scripts/instance/throwaway-settings.test.ts` (imports the
adapter's real `isLocalDefaultUrl`). Sandbox containers run
`BAKIN_SEARCH_SERVICE_MODE=child` — Linux, container-local 3738, no conflict.

## Asset saves from container agents (BAKIN_AGENT_PATH_MAP)

OpenClaw rig agents write deliverables under `/home/node/.openclaw/workspace/…`
and pass that container path to `bakin_exec_assets_save`, which reads host-side.
The openclaw home is bind-mounted, so the rig exports
`BAKIN_AGENT_PATH_MAP=/home/node/.openclaw=<repo>/dev/openclaw-home` and the
save/image-reference paths translate before the read
(`packages/core/src/agent-path-map.ts`; applied in assets exec-tools + images
reference inputs; the translated path is also the dedup `source.path`, so
re-saves upsert correctly). Production shares one filesystem — unset, identity.
Pi host modes need no map (workspaces are host paths under `dev/pi-home`).

## Hot reload

`instance dev` delegates to `scripts/dev.ts` (env-driven; imports the server
in-process, so `plan.hostEnv` flows through) — real HMR for BOTH runtimes.
(Historical note: it previously ran bare `server.ts serve` with no watchers while
the README claimed hot reload.)

## OpenClaw specifics (unchanged, hard-won — don't re-derive)

- **Gateway needs config to start** — empty home → exits "Missing config". Bootstrap
  runs `onboard --non-interactive --accept-risk --mode local --auth-choice skip --skip-health`.
- **`bind=lan` is required** for the host to reach the gateway via the docker
  port-forward, and bind=lan refuses auth=none — the gateway uses a pinned dev token
  (`gateway.auth.token == gateway.remote.token`).
- **`rm -rf` of a bind-mounted dir poisons Docker Desktop's cache** — reset wipes
  *contents* in place (`emptyDir`), never the dir.
- **Cross-agent dispatch needs `operator.write`** via a paired device identity:
  ed25519 challenge signing (signature covers the gateway shared token), a
  pre-approved pairing record written by `device-approve.ts` (bootstrap
  chicken-egg), and `plugins.allow=["discord"]` (prevents host-path workspace
  writes). `OPERATOR_SCOPES` carries read/write/admin/pairing; `ensureApprovedDevice`
  widens REUSED rig state in place.
- **host ↔ container paths** — `openclaw-shim` translates host→container in CLI
  args; `agent-paths.ts` normalizes stored host paths pre-gateway (symptom of
  stale paths: `EACCES mkdir '/Users'`, #467). `BAKIN_AGENT_PATH_MAP` (above) is
  the reverse direction for reads.
- **`BAKIN_URL`** = the container's callback URL (`host.docker.internal:3737`);
  host CLI uses `localhost:3737` (`instance run`/`shell` override). Per-agent MCP
  entries bake `BAKIN_MCP_BASE_URL` at Bakin boot; non-default ports need a
  re-provisioning restart.
- **Image tag pinned** (`OPENCLAW_DEFAULT_IMAGE_TAG`, Dockerfile/compose/lifecycle
  share it) — bump alongside the Mac mini.

## Secret handling

Secrets are `op://` references in `secrets.op.env` (committed), resolved host-side
at `up` (openclaw only) and injected only into the disposable home; `redactSecrets`
masks values in rig logs. Accepted residuals (single-user loopback rig): the
Discord token transiently in `docker exec` argv, and Codex `auth.json` + device
key + **Pi `auth.json`** in cleartext under gitignored `dev/` homes until `reset`.
Exclude `dev/openclaw-home/`, `dev/pi-home*/` from backups.

## Known limitations

- Pi `/login` inside sandbox needs a real TTY (`docker compose exec -it`); if the
  TUI misbehaves in-container, hand-write auth.json per the SDK's providers doc.
- sandbox-pi search needs the Linux engine in-container: run
  `bakin install search` inside (`instance shell` → onboard); the host binary is
  a Mach-O and cannot be mounted in.
- The rig antfly child skips embedder preloads — first semantic query after a
  cold start may be slow.

## Validation campaign

`bun run scripts/instance/validate.ts` (rig up first, openclaw) — unchanged:
gateway sanity, real-turn e2e + forensics, concurrency probes, benchmarks,
restart drill, retention probe, and the abort workaround re-verify (R7) — the
real-wire owner of the `openclaw#TBD-abort-registration` workaround pin. **Run
after every OpenClaw version bump**; deletion checklist in
`tests/dev/openclaw-workaround-regressions.test.ts`. Standalone probes:
`abort-ladder-probe.ts`, `abort-workaround-probe.ts` (share `frame-sanitize.ts`
with the frame recorder).
