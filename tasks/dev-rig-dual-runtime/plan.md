# PLAN — Dual-runtime dev rig (SPEC.md, 2026-07-11)

Status: awaiting approval. Spec: `/SPEC.md`. Todo ledger: `./todo.md`.

## Context

The rig (`bun run instance …`) is OpenClaw-only and has three verified defects the
spec targets: (1) no Pi support at all; (2) agent-written deliverables in the
container can't be saved as assets host-side; (3) rig homes can — and on this
machine already DID — rewrite the machine-global `io.bakin.antfly` LaunchAgent to
point at a throwaway dev home. Additionally, exploration proved `instance dev` has
**no hot reload** (it runs bare `server.ts serve`; the README claim is false).

Exploration corrections baked into this plan (vs the original spec draft):
- **No `pi login` subcommand exists.** Auth = the interactive TUI's `/login` slash
  command. Env: `PI_CODING_AGENT_DIR` must point at `$PI_HOME/agent` (it IS the
  agent dir). Auth success is verified by re-checking `auth.json` exists after the
  TUI exits (exit code proves nothing).
- A Pi turn needs auth + a resolvable model → rig writes `routing.defaultModel`
  into `$PI_HOME/agent/settings.json` from a provider→model map, warn-don't-fail
  (mirrors the openclaw `models set` step).
- The antfly guard + rig child key off **isolated mode, both runtimes** (the live
  clobber fired in isolated×openclaw).
- ChatGPT `/login` alone gives rig Pi full image gen+edit (`openai-codex` OAuth).

## Design (agreed)

### The 6-cell plan matrix (modes.ts `resolvePlan`)

| cell | docker | hostEnv | antfly child | settings patch |
|---|---|---|---|---|
| native×oc | gateway | OPENCLAW_HOME, OPENCLAW_PATH, BAKIN_URL, BAKIN_MCP_BASE_URL | – | – |
| isolated×oc | gateway | + BAKIN_HOME, BAKIN_SEARCH_SERVICE_MODE=child (belt) | port 3838 | adapter=openclaw, searchUrl=127.0.0.1:3838 |
| sandbox×oc | sandbox profile | {} (container env) | – (in-container child via compose env) | – |
| native×pi | **none** | BAKIN_RUNTIME_ADAPTER=pi, PI_HOME — NO OPENCLAW_*/BAKIN_MCP_BASE_URL/BAKIN_URL | – | – (real home never written) |
| isolated×pi | **none** | pi keys + BAKIN_HOME + belt | port 3838 | adapter=pi, searchUrl=127.0.0.1:3838 |
| sandbox×pi | sandbox-pi profile | {} (container env) | – (in-container child) | – |

Key mechanics:
- `InstancePlan` gains `runtime`, `docker: DockerPlan | null`, `antflyChild`,
  `settingsPatch`. `InstancePaths` gains `piHome` (host modes share `dev/pi-home`;
  sandbox gets `dev/pi-home-sandbox` — container path strings must never be read
  by a host boot), `antflyDataDir` (`dev/bakin-instances/isolated/antfly`); both
  join `resetTargets`. `instancePaths` signature unchanged (reset is runtime-blind).
- `lifecycle.up` becomes a thin dispatcher: shared `wipeIfFresh` +
  `applySettingsPatch`, then `upOpenClaw` (today's body, untouched) or `upPi`
  (mkdir agent dir → [sandbox: compose up] → interactive TUI `/login` when
  auth.json missing, re-check after exit → default-model write warn-don't-fail).
  `preflight` splits: docker-only / op-only; pi host modes call neither.
- Guard layering for the LaunchAgent hazard (isolated, both runtimes):
  1. throwaway settings patch: `search.settings.url = http://127.0.0.1:3838` →
     `isLocalDefaultUrl` false → **guest mode** → adapter never provisions/spawns;
  2. `instance dev` re-applies the patch AFTER onboarding (onboard may rewrite
     settings.json);
  3. env belt `BAKIN_SEARCH_SERVICE_MODE=child` (accepted values are
     launchd|systemd|child — NOT guest): if the patch is ever lost, worst case is
     a strict child that fails to bind 3738 — degraded search, **no plist write**.
- Rig-managed antfly child (isolated): spawned by `instance dev` (lives with the
  server, killed in `finally`), port 3838/health 3839 (real antfly owns
  3738/3739), data under `dev/bakin-instances/isolated/antfly`, binary from
  `ANTFLY_PATH` env or `~/.antfly/bin/antfly` (shared machine cache, read-only),
  models dir `~/.antfly/inference/models`. Argv duplicated from the adapter's
  `buildServiceArgv` shape and pinned by test — the rig must NOT import
  `@bakin/adapter-antfly` (arch rule: concrete-adapter imports are factory-only).
- `instance dev` now spawns `bun run scripts/dev.ts` (env-driven, imports the
  server in-process) instead of `server.ts serve` → **real HMR for both
  runtimes**. Health gate per runtime: openclaw = gateway healthz; pi = auth.json
  exists.
- New modules (pure, existing rig style): `pi.ts` (paths/env/argv builders,
  `defaultModelFromAuth`, `patchPiSettings`), `throwaway-settings.ts`
  (`mergeThrowawaySettings` deep-merge preserving unknown keys),
  `antfly-child.ts` (argv builder + start/stop with injected deps).
- `sandbox-pi` compose service: same custom image (has bun), `sleep infinity`
  entrypoint (main process must not be the gateway — it exits on empty home),
  ports 3737 only, mounts repo + `../pi-home-sandbox:/home/node/.pi`, env
  `PI_HOME`/`PI_CODING_AGENT_DIR`/`BAKIN_RUNTIME_ADAPTER=pi`/
  `BAKIN_SEARCH_SERVICE_MODE=child`, profile `sandbox-pi`. `sandbox.ts` exec
  helpers gain a `service` param. In-container search engine via
  `bakin install search` inside the container (Linux binary; documented step).
- Production changes (exactly two, both inert when unset):
  1. `BAKIN_RUNTIME_ADAPTER` applied inside `getSettings()`
     (`packages/core/src/settings.ts` — after deepMerge ~:481, before the cache
     set at :483), validated against `getSupportedRuntimeAdapterNames()`, with a
     one-time warn when it shadows the stored adapter (runtime-switch interplay).
  2. Path translation: helper `translateAgentPath(path)` reading
     `BAKIN_AGENT_PATH_MAP` (`from=to[;from=to]`, pass-through when unset or
     unmatched), applied at (a) `plugins/assets/lib/exec-tools.ts:156`
     (`assets_save` filePath before `upsertFromSource` — keeps the dedup
     `source.path` consistent), (b) `plugins/images/lib/tools.ts:~300` (agent
     reference-image inputs). Explicitly NOT applied to: assets_import
     (content-dir-relative), assets_open (store reads), salvage (host text
     write), the `assets.saveFromSource` hook (host paths pass through
     unchanged anyway). Rig sets `/home/node/.openclaw=<repo>/dev/openclaw-home`
     in openclaw-mode hostEnv.
- Arch test: rename `isOpenClawDevRig` → `isDevRig` in
  `tests/architecture/adapter-boundary.test.ts` and add `allow: isDevRig` to the
  Pi rule (lines 45-50) and the antfly-identifier rule. Regexes never weakened.
  The edit-time hook already exempts `scripts/instance/` wholesale.
- args validation: `--runtime` invalid on `reset`/`down`; `--preconfigure`
  stays sandbox-only AND openclaw-only; `--source installed` invalid for pi host
  modes. Every mode×runtime cell valid.

## Tasks

Each task = one commit (conventional, scoped), suite green before commit.
Branch: `feat/dev-rig-dual-runtime` off `main`.

### T1 — docs(specs): land spec + plan, archive predecessor
SPEC.md (updated with /login correction), tasks/dev-rig-dual-runtime/{plan,todo}.md,
`git mv` of old SPEC.md → tasks/gate-discord/SPEC.md (already staged).
**Accept:** committed on the branch; no code changes.

### T2 — feat(core): BAKIN_RUNTIME_ADAPTER override
`packages/core/src/settings.ts` chokepoint + validation + shadow-warn.
Tests: extend the existing settings suite (temp-home mocks per CLAUDE.md rules):
override wins over file + default; invalid value ignored with warn; cache
consistency; absence = current behavior byte-identical.
**Accept:** all consumers (boot factory, onboarding `componentApplies`,
request-handler status) see the override via `getSettings()`; suite green.
**Rollback point A** (with T3): core knobs only, zero rig changes.

### T3 — feat(assets): BAKIN_AGENT_PATH_MAP translation
Helper (likely `src/lib/agent-path-map.ts`) + apply at the two call sites +
unit tests (parse, multi-mapping, pass-through, prefix-boundary safety — `/home/node/.openclawX` must NOT match) + integration test saving a real asset
from a translated path into a temp content dir.
**Accept:** unset env = byte-identical behavior; translated save lands an asset
whose `source.path` is the translated host path; suite green.

### T4 — feat(instance): (mode × runtime) matrix
`args.ts` (`--runtime`, validation), `paths.ts` (piHome per mode, antflyDataDir,
resetTargets), `modes.ts` (`DockerPlan | null`, `antflyChild`, `settingsPatch`,
hostEnv per cell incl. BAKIN_AGENT_PATH_MAP for openclaw cells + belt env for
isolated), arch-test predicate rename + Pi/antfly rule allows, `.gitignore`
entries (`dev/pi-home/`, `dev/pi-home-sandbox/`).
Tests: args/paths/modes matrix exhaustive (assert env ABSENCE in pi cells).
**Accept:** `instance up/dev` behavior unchanged for openclaw cells (lifecycle
untouched); `--runtime pi` parses and plans; suite green incl. arch tests.

### T5 — feat(instance): pi lifecycle + dev delegation
`lifecycle.ts` dispatcher split (upOpenClaw byte-preserving), `pi.ts`,
`throwaway-settings.ts`, `instance.ts` verbs (dev → `scripts/dev.ts` + per-runtime
health gates + post-onboard patch re-apply; run/shell/env/status per runtime).
Tests: lifecycle ordering via fake deps (pi host = zero docker/op argv; login
skip/idempotence; auth re-check throws actionably; model-write warns), pi.ts
builders, throwaway-settings merge.
**Accept:** live `instance up --runtime pi && instance dev --runtime pi --mode
isolated` boots Bakin-on-Pi with HMR (manual /login once); openclaw `instance
dev` gains HMR; suite green.
**Rollback point B**: Pi host dev fully usable.

### T6 — feat(instance): rig antfly child + LaunchAgent guard
`antfly-child.ts` + `instance dev` wiring (start before server, stop in finally)
+ readiness probe (main-port poll; verify empirically, health-port fallback).
Tests: argv pinned to adapter shape, binary resolution, start/stop ordering,
missing-binary error; guard test asserting `rigAntflySearchUrl()` fails
`isLocalDefaultUrl` (imported from adapter — tests aren't arch-scanned) ⇒ guest.
**Accept:** isolated instance has working search on 3838 while real antfly on
3738 is untouched (plist byte-compare pinned in live E2E); suite green.

### T7 — feat(instance): sandbox-pi
Compose service + `sandbox.ts` service param + sandbox login exec +
`--preconfigure` rejection message + docs note for in-container
`bakin install search`.
**Accept:** `instance up --mode sandbox --runtime pi` → `instance shell` →
`bakin onboard --yes` → server serves :3737 on Pi in-container; suite green.
**Rollback point C**: full matrix implemented.

### T8 — fix(rig): remediate the live LaunchAgent clobber  [operational + audit]
Coordinated with Mark (his isolated dev server is running): stop it, re-provision
`io.bakin.antfly` back to real `~/.bakin` (boot real-home Bakin or
`bakin install search`), verify plist + running argv point at `~/.bakin/antfly`,
then bring the isolated instance back up on the NEW rig (child on 3838) and
verify no plist drift. Any additional audit findings surfaced during T2–T7 land
here as separate `fix(…)` commits (ask-first if production-side).
**Accept:** `launchctl` + plist show real-home paths; isolated rig runs
concurrently with working search; before/after plist hash captured in todo.md.

### T9 — docs: full sweep
Rename `.claude/knowledge/dockerized-openclaw-rig.md` → `dev-rig.md` (rewrite
dual-runtime; update inbound refs: CLAUDE.md, repo-architecture.md, any skills),
rewrite `dev/docker/README.md` (both runtimes; REMOVE the false hot-reload claim,
document the now-true one), CLAUDE.md rig/Pi bullets, pi-adapter.md rig section,
assets-versioning.md (path-map knob), search-system.md (rig guest-mode note),
CONTRIBUTING.md/README.md if they reference the rig.
**Accept:** no doc describes the rig as OpenClaw-only; knowledge doc rename has
zero dangling references (`grep -r dockerized-openclaw-rig`).

### T10 — test: full verification (with /agent-skills:test)
Automated: `bun run test` + `bun test tests/dev/` explicitly + arch suites.
Live E2E matrix (user-assisted, evidence pasted into todo.md):
1. native×oc: dispatch → container-written deliverable → asset saved via
   translation → indexed in real search.
2. isolated×oc: same flow + search on 3838 + plist byte-identical.
3. isolated×pi: /login once → dispatch → asset (host paths, no translation) →
   search on 3838.
4. native×pi: boot + turn smoke (real ~/.bakin, PI_HOME under dev/).
5. sandbox×pi: onboard + turn smoke in-container.
6. `scripts/instance/validate.ts` campaign (openclaw, unchanged).
7. reset scoping: `instance reset --mode isolated` wipes only dev/ targets;
   `~/.bakin|~/.openclaw|~/.pi|~/.antfly` + plist untouched (hash compare).
**Accept:** SPEC.md §5 criteria all check off; failures → fix commits → re-run.

## Commit strategy summary

`main` ← PR from `feat/dev-rig-dual-runtime`:
T1 docs → T2 core (A) → T3 assets (A) → T4 rig matrix → T5 pi lifecycle (B) →
T6 antfly child → T7 sandbox-pi (C) → T8 fixes → T9 docs → T10 evidence.
Every commit suite-green; revert granularity = one task; checkpoints A/B/C are
the safe partial-landing points.

## Risks / watch items

- `/login` TUI inside `docker exec -it` needs a real TTY — verified pattern
  matches the existing codex login exec; if the TUI misbehaves in-container,
  fallback is documented manual auth.json (SDK docs providers.md:83-100).
- Default-model map may drift with SDK model ids — warn-don't-fail keeps `up`
  usable; UI/TUI can set the model.
- `scripts/dev.ts` delegation changes the openclaw dev loop (in-process server,
  build steps at startup) — verify dispatch/MCP still work under it in T5 live
  check before committing.
- Host `node_modules` used in-container (sandbox) already true today for
  `--source repo`; pi CLI is pure JS — low risk, verify in T7.
- Port 3838/3839 assumed free — `antfly-child` errors actionably if bound.
