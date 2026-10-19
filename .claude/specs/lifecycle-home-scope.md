# Spec: home-scoped `bakin stop` / `bakin restart` (quick win K)

Status: CONFIRMED (owner, 2026-10-19) — r2 design after the Codex design review; decisions D-K-Q1..Q4 below. Part of #898's
batch plan (`.claude/specs/quick-wins-855-758-898-plan.md` § PR K).

## Objective

`bakin stop` and `bakin restart` must only ever act on **this home's**
server (`BAKIN_HOME` → `~/.bakin` by default) and must never signal a
process they cannot prove is that server. Today (main, `src/cli/commands/lifecycle.ts`):

- `stop` and the manual `restart` path `pgrep -f` every matching Bakin
  server on the machine and SIGTERM all of them — another home's server
  (a dev rig, a second checkout, the isolated instance) dies too.
- `restart` drives the machine-global LaunchAgent / systemd user unit
  (`SERVICE_LABEL`) whenever its FILE exists, without checking which home the
  LOADED service runs — restarting home B can restart home A and then report
  success from B's untouched server.
- the manual restart waits a fixed 2 s after SIGTERM (shutdown may take
  longer): the replacement can lose the `server.lock` race, and the
  `/api/version` verification can succeed against the dying old server.
- the lock pid is trusted after `kill(pid, 0)` only: a recycled pid after a
  crash is an unrelated process that would receive SIGTERM.

Success = every review finding J r2 #2, r3 #1–#4, r4 #1–#6 (recorded in the
plan) is either impossible by construction or covered by a test.

## Design (r2 — after the Codex design review)

### D-K1 Identity is the server's OWN answer; shutdown is a REQUEST, not a signal
- `GET /api/version` answers `{ version, pid: process.pid, bootId: getBootId(), state: 'starting'|'serving'|'stopping' }`
  — identity is process-local, NEVER read back from `server.lock` (an old
  server would otherwise report its successor). Strict client validation:
  positive integer pid, non-empty bootId, no redirects, bounded fetch+body;
  a `{version}`-only answer is an explicit "old server, unsupported
  protocol" result.
- **Stop never sends a signal to a pid it merely verified** (verify → exit →
  pid reuse → signal is a race no re-check closes). Instead:
  `POST /api/server/shutdown` on 127.0.0.1:<lock.port> with the lock's
  per-boot `cliSecret` (`X-Bakin-Cli-Secret`, already the home-operator
  proof, #895 D11) and the expected `bootId`; the server checks BOTH against
  its own memory and only then begins its normal shutdown. A different home
  on that port, a successor, or a stranger refuses — nothing is signaled.
- **Wedged server** (lock pid alive, no valid answer within the budget):
  FAIL CLOSED — report that the lock *records* pid N, ownership could not be
  verified, manual inspection is needed before any kill; non-zero exit in
  both output modes. No fallback identity heuristic (executable path + start
  time cannot tell two homes apart; `startedAt` is lock time, not process
  creation).

### D-K2 Service control only when the service OWNS this home's verified server
- States: absent · loaded-inactive · activating · active-owned ·
  active-other · deactivating · unknown. `active-owned` ⇔ the manager's PID
  (`launchctl print` pid / `systemctl show -p MainPID`) EQUALS the pid that
  just passed the D-K1 handshake for this home. Configuration (environment,
  plist, unit + drop-ins + EnvironmentFile) is never proof of the CURRENT
  process — only of the next launch.
- `launchctl print` is not an API: a conservative adapter for captured
  formats (fixtures per supported macOS version); unsupported layout,
  duplicates, truncation, permission failure or timeout ⇒ `unknown` ⇒ no
  service mutation. Never default a missing home to `~/.bakin`.
- `bakin setup` always records the absolute `BAKIN_HOME`. Restart NEVER
  auto-bootstraps a service (installation is `bakin setup`'s job).
- `server-restart.ts` (the in-process restart behind self-update) follows
  the same rule: it may drive the service only when the service owns THIS
  server; otherwise the standalone child path. The child carries the
  parent's home (absolute) and bootId and waits bounded.

### D-K3 Restart = request shutdown, prove the handoff, start, prove a NEW boot
- Handoff is generation-based: original generation still answering/alive ⇒
  wait; original gone with its lock left behind (hard exit) ⇒ stale lock,
  safe to start; a DIFFERENT live generation owns the home ⇒ reconcile with
  it, never launch a competitor. Monotonic 20 s deadline with early
  completion; separate shutdown / manager / startup budgets.
- The replacement gets the intended home as an ABSOLUTE `BAKIN_HOME`, the
  old server's port (unless `--port` given), and success requires the
  handshake of the replacement WE started (spawned child pid, or the
  manager's new MainPID) answering `state: 'serving'` with a new bootId.
  Spawn errors / early exit are observed and reported.

### D-K4 Stop is durable; others are reported, never touched
- Stopping a service-owned server stops the SERVICE (launchctl bootout /
  systemctl stop) — a KeepAlive job would otherwise respawn it; `bakin
  start` / `restart` / `setup` bring it back. Network failure alone is never
  "stopped": stop confirms the original generation is gone. Antfly cleanup
  runs only after Bakin is conclusively down.
- Other Bakin-looking processes (best-effort discovery) are listed in BOTH
  output modes, never signaled. Unknown ownership / timeouts exit non-zero.

### D-K5 Startup gaps (see Q3)
- `scripts/dev.ts` builds before the server imports; a restart child waits
  for its parent — both windows have no lock and no listener. Either (a) a
  per-home startup-intent file shared by CLI start/restart, dev and restart
  children (stop supersedes a pending start), or (b) narrow the guarantee:
  report "a start may be pending" when such a process is detected and
  refuse to launch a competitor.
- The server lock's stale sweep (read → unlink) can remove a lock a
  concurrent starter just took; fix it with the claim-then-verify pattern
  (rename aside, re-read, restore) or documented narrowing.

### D-K6 Tests
- ONE `LifecycleIo` seam (discovery, signals, fetch, launchctl/systemctl,
  spawn). Test guards fail the run on direct `process.kill`, child `.kill()`,
  real manager commands or real network. A deterministic scenario per
  finding: J r2 #2, r3 #1–#5, r4 #1–#6, and every item of the design review
  (pid reuse after handshake, loaded-inactive vs manual, active-other,
  hard-exit stale lock, late old answers, another home on the port, old
  `{version}` servers, KeepAlive respawn, relative BAKIN_HOME, output-mode
  parity).

## Commands

- Gate: `bun run typecheck`, `bun run lint`, `bun run check:cycles`, `bun run test`
- Focused: `bun test tests/cli/lifecycle*.test.ts --isolate`

## Boundaries

- Always: the handshake before any signal; loaded-service ownership before
  any service control; both output modes carry every diagnostic.
- Never: `pgrep`-and-kill; a command-line regex as proof of ownership;
  acting on `BAKIN_URL` for local lifecycle; reporting success from the old
  boot.
- Out of scope: Windows; remote servers; antfly's own service (its existing
  ownership rules stay).

## Decisions (owner, 2026-10-19)

- **Q1 Wedged server:** fail closed — report that the lock records pid N,
  ownership could not be verified, inspect before any kill; non-zero exit.
- **Q2 Shutdown mechanism:** the authenticated shutdown REQUEST
  (`cliSecret` + expected `bootId`, checked by the server against itself) —
  the CLI never signals a pid.
- **Q3 Startup gaps:** NARROW + REPORT — detect a pending dev build or
  restart child, report "a start may be pending" and refuse to launch a
  competitor; no shared startup-intent file in this PR.
- **Q4 Stop of a service-managed server:** stop the SERVICE (no KeepAlive
  respawn); `bakin start` / `restart` / `setup` bring it back.
- Handoff budget: 20 s monotonic deadline with early completion.

## Review hardening (Codex round 1, 2026-10-19)

- Stale-lock removal runs under an exclusive `server.lock.sweep` marker and
  re-reads the exact stale bytes before unlinking; the lock path is never
  renamed aside. A marker left by a dead starter fails boot closed.
- An old-protocol server's service is driven only when the loaded job runs
  the lock's pid AND is configured for this home.
- With nothing running here, only an IDLE service for this home (unloaded, or
  loaded without a pid) is started; a running job holding no lock is refused.
- Stop refuses when the service state is unreadable; a successor taking the
  home right after a stop is an error, never "stopped".
- A service restart succeeds only when the manager's own pid answers.
- A successor appearing during a manual restart is awaited, not raced.
- A restart child counts as a pending start even while the old server answers.
- Service commands carry deadlines; failures exit 1 via `process.exit`.

## Review hardening (Codex round 2)

- Service home is read only from the job's OWN launchd `environment` block
  (never `inherited`/`default environment`); a systemd unit with an
  `EnvironmentFile` has an unknowable home.
- "Idle" is the manager's plain word (`state = not running`; systemd
  `inactive`/`failed`) — a job mid-spawn / `activating` is never restarted.
- An installed service whose state can't be read refuses restart even with
  nothing running; with no unit installed (Docker/CI) the state is absent.
- Stop refuses while a restart child waits for this server to exit.

## Review hardening (Codex round 3)

- A failing manager query is unknown even when the unit file is missing (a
  loaded job outlives its plist); only systemctl's own "no user manager"
  answers (no bus / not booted with systemd / not installed) mean absent.
- launchd output without exactly one `state`, or `running` without a pid, and
  systemd `active` without a main pid, are unknown.
- Stopping an old-protocol service judges the generation captured before the
  bootout.
- Server-side kickstart/restart commands carry deadlines.
- A standalone restart inherits the caller's environment (PATH included);
  only BAKIN_HOME and PORT are pinned.
