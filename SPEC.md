# SPEC — Dual-runtime dev rig (`instance`): audit, Pi support, full-fidelity parity

Status: DRAFT — awaiting approval
Date: 2026-07-11
Owner: Mark Hayden (single-user machine; no backwards compatibility, no shims)
Process: /agent-skills:spec → /agent-skills:plan → /agent-skills:build → /agent-skills:test

## 1. Objective

The dockerized dev rig (`bun run instance …`) becomes a **dual-runtime, full-fidelity**
dev environment: one command provisions a disposable instance running either the
**OpenClaw** runtime (gateway in Docker, as today) or the **Pi** runtime (in-process,
throwaway `PI_HOME`), pre-configured end-to-end — and every core capability that works
in production works in the rig: dispatch, **asset creation from agent turns**, search
indexing, images, hot reload.

Grounding facts (verified in-code during the spec interview):

- Pi has **no daemon** — it is an SDK loaded inside Bakin's process. "Pi in the rig"
  means a throwaway `PI_HOME` wherever Bakin runs (host for native/isolated, container
  for sandbox). Nothing to containerize separately. Accepted consequence: host-mode Pi
  agents execute tools on the Mac inside dev-scoped workspaces; sandbox mode is the
  in-container-execution option.
- The runtime adapter is chosen ONLY by `settings.runtime.adapter`
  (`packages/core/src/settings.ts`, default `openclaw`). No env override exists today.
- `bakin_exec_assets_save` (`plugins/assets/lib/exec-tools.ts`) takes an absolute
  `filePath` read host-side. In native/isolated modes agents write inside the container
  (`/home/node/.openclaw/workspace/…`) — host-unreadable as-written, but the openclaw
  home is bind-mounted at `dev/openclaw-home/`, so a prefix translation closes the gap.
  (Known limitation documented in the rig knowledge doc, now `.claude/knowledge/dev-rig.md`.)
- **Live hazard (must fix):** antfly's `detectServiceMode` defaults to `launchd` on
  macOS; the LaunchAgent label (`io.bakin.antfly`) and port (3738) are singletons, and
  the unit file is a byte-compared fingerprint of `getBakinPaths()`. A rig home that
  reaches `ensureProvisioned` **rewrites the real LaunchAgent to point at the dev
  home**. **Verified already fired on this machine (2026-07-11):** the live
  `io.bakin.antfly` unit's `--data-dir` points at
  `dev/bakin-instances/isolated/home/antfly` — a past isolated-mode boot hijacked the
  machine-global service. The rig sets no search env today.
- The pinned Pi SDK (`@earendil-works/pi-coding-agent@0.80.3`, dep of
  `packages/adapter-pi`) ships the `pi` CLI (`bin: pi → dist/cli.js`); its own home
  override is `PI_CODING_AGENT_DIR` (Bakin's adapter uses `PI_HOME`). There is no
  `~/.pi` and no `pi` on PATH on this machine — fresh login is the only seeding path.
- `ANTFLY_HOME` env override exists for the engine binary/models root; the machine-wide
  binary under `~/.antfly/bin` can be shared read-only by rig children (data dirs stay
  per-instance).

## 2. Decisions (interview record, 2026-07-11)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Pi scope | `--runtime openclaw\|pi` flag on **all three modes** (default `openclaw`; current behavior unchanged). native/isolated + pi: Bakin on host, throwaway `PI_HOME` under `dev/`, **no docker services started**. sandbox + pi: Bakin + Pi inside the container. |
| D2 | Pi shape | Host Pi for hot-reload dev + sandbox option for in-container execution. No attempt to remote Pi out of process. |
| D3 | Adapter selection | New `BAKIN_RUNTIME_ADAPTER` env override in settings resolution (same family as `BAKIN_HOME`/`OPENCLAW_HOME`/`PI_HOME`). Rig passes it per-invocation; real `~/.bakin/settings.json` is never written. Throwaway homes (isolated/sandbox) additionally get `runtime.adapter` written into their own settings.json so the home is self-consistent. |
| D4 | Pi auth | Interactive auth during `instance up --runtime pi`; skipped when already authed; wiped by `reset`. No stored secrets, no auth.json synthesis. Mirrors the existing Codex OAuth flow. **Corrected during planning:** the pinned SDK has NO `pi login` subcommand — the rig spawns the interactive `pi` TUI (`PI_CODING_AGENT_DIR=$PI_HOME/agent`) where the user runs `/login`; success is verified by re-checking `auth.json` exists after the TUI exits. |
| D5 | Asset-save gap | Fix via env-configured path-prefix translation honored by `bakin_exec_assets_save` (rig sets container-home → host-mount mapping). Exact knob shape decided in plan; generic (no "openclaw"/"docker" in the name), documented, inert when unset. |
| D6 | Search | **Working search in every mode.** Isolated: rig-managed antfly child on an alternate port (e.g. 3739) sharing the machine-wide binary read-only; throwaway home's antfly URL points at it → guest mode → adapter never provisions/spawns (zero production-code risk). Sandbox: child mode in-container on 3738 (Linux, no systemd → auto). Native: real antfly as today. **In no path may a rig home render/write/restart the real launchd/systemd unit.** |
| D7 | Verification | Full live E2E on **both** runtimes (user does `pi login` once; existing OpenClaw home reused — no fresh Codex OAuth), plus the automated suite. |

## 3. Scope

### 3.1 Rig audit (find what else is broken/missing)

A systematic sweep of every production capability under each (mode × runtime) cell,
run BEFORE building — findings feed the plan as concrete tasks. Sweep list:

dispatch + recovery ladder, asset save/import/enrichment, image generation (codex path
per runtime), search indexing + rebuild + ⌘K, usage recording/usage.db, execution
ledger, budget gates, chat plugin, memory plugin (tier indexing), doctor checks,
agent packages install/sync, onboarding components against throwaway homes
(especially: which components touch **machine-global** state — the search LaunchAgent
hazard is the known instance of this class; find any others, e.g. `~/.antfly`
downloads, plugin-assets, notifications), `instance status/env/run/shell` correctness
per cell, reset scoping (all new state dirs must land in `dev/` reset targets).

### 3.2 Pi runtime support

- `--runtime openclaw|pi` in `args.ts` (validated; default `openclaw`); plan matrix in
  `modes.ts` extended to (mode × runtime).
- Pi paths in `paths.ts`: per-mode pi homes under `dev/` (host modes vs sandbox must
  NOT share one pi home — host/container path strings diverge in registry/sessions);
  all added to `resetTargets`.
- `up --runtime pi` (native/isolated): no docker, no `op` preflight, no compose. Ensure
  pi home dirs, run `pi login` if unauthed, write/patch throwaway settings (isolated),
  print env.
- `up --runtime pi --mode sandbox`: container with repo mount + bun + pi home mount;
  main process must not depend on OpenClaw config (compose service shape decided in
  plan); `pi login` exec'd into the container.
- `dev/run/shell/env/status` honor the runtime: correct env set
  (`BAKIN_RUNTIME_ADAPTER`, `PI_HOME`; no `OPENCLAW_*` for pi), correct health checks
  (gateway health only for openclaw; pi auth presence for pi).
- Runtime combinations coexist in one instance's state (separate dirs); switching =
  `up --runtime <other>` then `dev --runtime <other>`. `reset` wipes both.

### 3.3 Core changes (production code, all small + documented)

- `BAKIN_RUNTIME_ADAPTER` override in settings resolution (D3).
- Path-translation knob for `bakin_exec_assets_save` (D5).
- Whatever the audit (3.1) surfaces as *production-side* gaps — each gets its own
  decision in the plan; nothing lands unexamined.

### 3.4 Search in the rig (D6)

- Rig-managed antfly child for isolated mode (spawn/stop with instance lifecycle,
  alt port, data under `dev/bakin-instances/…`, binary from `~/.antfly/bin` /
  `ANTFLY_HOME`).
- Sandbox: engine binary availability in-container + child mode; decided in plan
  (macOS vs Linux binaries differ, so likely in-container install via
  `bakin install search`).
- Guard against the LaunchAgent clobber: rig homes must be structurally unable to
  provision OS units (guest-mode URL and/or explicit service-mode env), plus a
  regression test pinning it.
- **Remediate the existing clobber on this machine:** re-provision `io.bakin.antfly`
  back to the real `~/.bakin` paths (and verify the isolated instance gets its own
  rig-managed child instead). Sequence this so the running isolated dev server isn't
  yanked mid-session.

### 3.5 Docs (required, per kickoff)

- `.claude/knowledge/dockerized-openclaw-rig.md` → rewritten as the dual-runtime rig
  reference (rename to `dev-rig.md`; update all inbound repo references — CLAUDE.md,
  `repo-architecture.md`, skills that cite it).
- `dev/docker/README.md` — user-facing walkthrough for both runtimes.
- `CLAUDE.md` — the rig bullets under "OpenClaw Home Directory" + Pi adapter live-ops
  notes.
- `.claude/knowledge/pi-adapter.md` — add rig dev-loop section.
- `.claude/knowledge/assets-versioning.md` + `search-system.md` where the D5/D6 knobs
  touch their contracts.
- `README.md` / `CONTRIBUTING.md` — only if they reference the rig (check during build).

### 3.6 Out of scope

- Remote-Pi transport / Pi daemonization (does not exist upstream).
- Discord/channels for Pi (adapter degradation matrix is by design — the chat plugin
  is the conversational surface).
- Changing production runtime-switch (`bakin runtime use`) or onboarding flows beyond
  what the audit proves broken for rig homes.
- Multi-machine/CI generalization of the rig (single-user machine).

## 4. Commands (target surface)

```
bun run instance up     [--mode native|isolated|sandbox] [--runtime openclaw|pi] [--fresh] [--source repo|installed] [--preconfigure]
bun run instance dev    [--mode …] [--runtime …]      # host modes; onboards if needed; hot reload
bun run instance run    [--mode …] [--runtime …] -- <bakin args>
bun run instance shell  [--mode …] [--runtime …]
bun run instance status | env [--mode …] [--runtime …]
bun run instance down
bun run instance reset  [--mode …]                    # wipes ALL runtime state for the mode
```

Existing invocations (`instance up`, `instance dev --mode isolated`, …) behave exactly
as today — `--runtime` defaults to `openclaw`.

## 5. Acceptance criteria

Per cell of the support matrix (native, isolated, sandbox) × (openclaw, pi):

1. `up` from clean state completes with at most the documented interactive steps
   (Codex OAuth on fresh openclaw; `pi login` on fresh pi) and is idempotent on re-run.
2. `dev` (host modes) boots Bakin with the selected adapter (verified via
   `/api/runtime` or doctor), hot reload intact.
3. A dispatched task completes a real turn; the agent writes a deliverable file and
   `bakin_exec_assets_save` lands a **real versioned asset** (the container-path case
   included) — verified live per D7.
4. Search: the saved asset is indexed and findable via `/api/search` in every mode;
   the real `io.bakin.antfly` LaunchAgent unit file is byte-identical before/after
   any isolated/sandbox lifecycle (regression-tested + verified live).
5. `reset` returns the instance to clean state without touching `~/.bakin`,
   `~/.openclaw`, `~/.pi`, `~/.antfly` contents, or any launchd/systemd unit.
6. Full suite (`bun run test`) green; new units for the args/modes/paths matrix, path
   translation, adapter env override, rig-antfly lifecycle, LaunchAgent guard.
7. All docs in 3.5 updated; no doc refers to the rig as OpenClaw-only.

## 6. Project structure (files expected to change)

```
scripts/instance.ts                     verb handling per runtime
scripts/instance/{args,modes,paths}.ts  (mode × runtime) matrix
scripts/instance/lifecycle.ts           runtime-conditional up/reset; pi login step
scripts/instance/pi-*.ts (new)          pi home prep + login argv builders
scripts/instance/antfly-*.ts (new)      rig-managed antfly child (isolated)
dev/docker/docker-compose.yml           sandbox-pi shape (plan decides exact form)
packages/core/src/settings.ts (+ facade) BAKIN_RUNTIME_ADAPTER override
plugins/assets/lib/exec-tools.ts        path translation at the save boundary
tests/dev/** + tests/core/**            new coverage (tests/dev runs in CI only —
                                        run `bun test tests/dev/` explicitly, per memory)
docs per 3.5
```

## 7. Code style & conventions

Repo conventions apply unchanged (CLAUDE.md): strict TS, zod at boundaries, pure
argv-builder modules with injected deps (the rig's existing pattern — keep it),
kebab-case files, conventional commits with scope (`feat(instance): …`,
`fix(assets): …`). Rig modules stay exempt from provider-boundary rules
(`tests/architecture/adapter-boundary.test.ts` per-rule list) — extend the exemption
list for new `scripts/instance/*` files as needed, never weaken the rule itself.

## 8. Testing strategy

- **Unit (bulk of coverage):** args/modes/paths matrix exhaustively (every mode ×
  runtime × flag combo); lifecycle ordering via injected deps (no Docker needed);
  path-translation pure function; settings env override; antfly-child argv/lifecycle
  builders; LaunchAgent guard (rig-produced settings can never yield a provisionable
  service config).
- **Integration:** settings override honored through the `createAppServices` boot path
  (temp homes, BOTH content-dir resolver mocks per CLAUDE.md testing rules); assets
  save with a translated prefix writing a real asset into a temp content dir.
- **Live E2E (D7, user-assisted):** the acceptance-criteria matrix run for real on
  this machine, both runtimes; evidence captured in the task/PR notes. OpenClaw side
  additionally re-runs `scripts/instance/validate.ts` (campaign unchanged).
- Every new test follows the CRITICAL testing rules (temp dirs, both content-dir
  mocks, env vars before imports, `--isolate`).

## 9. Boundaries

**Always:**
- Keep all instance state under gitignored `dev/`; `reset` targets only there.
- Keep secrets flowing only through the existing op:// resolution; redact in logs.
- Keep production behavior identical when the new env knobs are unset.
- Update `.claude/knowledge/` alongside code in the same commit arc.

**Ask first:**
- Any additional production-code change the audit surfaces beyond D3/D5/D6 guards.
- Any new stored secret or credential-copying behavior.
- Bumping the pinned OpenClaw image tag or Pi SDK version.

**Never:**
- Write to real `~/.bakin`, `~/.openclaw`, `~/.pi`, or OS service units from rig code
  paths (native mode's read/onboard of `~/.bakin` in `instance dev` stays the one
  documented exception, unchanged).
- Encode provider identifiers upstream of adapter boundaries outside the rig exemption.
- Add parallel spend/usage/stat systems (existing single-engine rules).

## 10. Commit strategy (checkpoints — detailed sequencing in PLAN)

Work lands on a feature branch as an ordered arc of conventional commits, each
independently green and revertable:

1. `docs(specs)` — this spec + archived predecessor (`tasks/gate-discord/SPEC.md`).
2. `feat(core)` — `BAKIN_RUNTIME_ADAPTER` override + tests (inert alone).
3. `feat(assets)` — path-translation knob + tests (inert alone).
4. `feat(instance)` — args/modes/paths (mode × runtime) matrix + unit tests (lifecycle
   still openclaw-only; flag parses + plans correctly).
5. `feat(instance)` — pi lifecycle (home prep, login, dev/run/shell env) — Pi host
   modes usable end-to-end.
6. `feat(instance)` — sandbox-pi (compose + exec paths).
7. `feat(instance)` — rig-managed antfly child + LaunchAgent guard + tests.
8. `fix(…)` — per-audit-finding fixes, one commit each.
9. `docs(…)` — knowledge/README/CLAUDE.md sweep (folded per-arc where a change is
   doc-coupled).

Rollback points: after 2/3 (core knobs only), after 5 (Pi host dev usable), after 7
(full matrix). Nothing merges with a red suite.
