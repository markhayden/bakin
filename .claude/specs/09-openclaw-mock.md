# OpenClaw Development Mock

## Context

Bakin can only be developed on machines with a full OpenClaw installation. This blocks development on other machines and makes it hard to seed/test sessions without live API keys and real agent calls. The mock creates a self-contained OpenClaw substitute that provides the HTTP gateway, CLI commands, and filesystem layout that Bakin depends on — nothing more.

**Safety rule:** If a real OpenClaw installation is detected, the mock refuses to start.

**Bonus:** OpenClaw's own test harness (`test-env.ts`, `gateway-e2e-harness.ts`) already uses `OPENCLAW_HOME` env var + temp directories for test isolation. We're following the same pattern.

## Two-Part Approach

### Part 1: `OPENCLAW_HOME` env var support (production code cleanup)

Create a single utility module that centralizes all `~/.openclaw/` path resolution. All 17 production files that hardcode these paths get updated to use it. This is a clean refactor that benefits production code regardless of the mock.

### Part 2: Mock server + fixtures (dev tooling)

A standalone dev tool under `dev/imitation-crab/` that seeds an `OPENCLAW_HOME` directory with fixture data, runs a mock HTTP gateway, and provides a CLI shim.

---

## Part 1: `getOpenClawHome()` Utility

### New file: `packages/core/src/openclaw-home.ts`

```typescript
import { join } from 'path'
import { homedir } from 'os'

/** Resolve the OpenClaw home directory. Respects OPENCLAW_HOME env var. */
export function getOpenClawHome(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

/** Resolve a path within the OpenClaw home directory. */
export function getOpenClawPath(...segments: string[]): string {
  return join(getOpenClawHome(), ...segments)
}
```

### Files to update (17 production files)

Each file replaces its hardcoded `join(homedir(), '.openclaw', ...)` with `getOpenClawPath(...)`:

| # | File | Current Pattern | Change |
|---|------|----------------|--------|
| 1 | `packages/core/src/main-agent.ts:13` | `const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')` | `getOpenClawPath('openclaw.json')` |
| 2 | `packages/core/src/settings.ts:134` | `const OPENCLAW_JSON_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json')` | `getOpenClawPath('openclaw.json')` |
| 3 | `packages/core/src/vault.ts:38-41` | `path.join(process.env.HOME \|\| '~', '.openclaw', 'openclaw.json')` | `getOpenClawPath('openclaw.json')` |
| 4 | `packages/core/src/vault.ts:81-87` | `path.join(process.env.HOME \|\| '~', '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json')` | `getOpenClawPath('agents', 'main', 'agent', 'auth-profiles.json')` |
| 5 | `src/core/models.ts:15` | `const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')` | `getOpenClawPath('openclaw.json')` |
| 6 | `src/core/agent-usage.ts:12` | `const OPENCLAW_AGENTS_DIR = join(homedir(), '.openclaw', 'agents')` | `getOpenClawPath('agents')` |
| 7 | `src/core/doctor.ts` (lines 66, 175, 198, 379, 653, 662, 1274-1282) | Multiple inline `join(...)` calls | Replace each with `getOpenClawPath(...)` |
| 8 | `plugins/team/lib/openclaw-adapter.ts:22-23` | `const OPENCLAW_ROOT = join(homedir(), '.openclaw')` | `getOpenClawHome()` and `getOpenClawPath('openclaw.json')` |
| 9 | `plugins/models/index.ts:17` | `const OPENCLAW_JSON = join(homedir(), '.openclaw', 'openclaw.json')` | `getOpenClawPath('openclaw.json')` |
| 10 | `plugins/tasks/lib/flow-store.ts:26` | `join(homedir(), '.openclaw', 'flows', 'registry.sqlite')` | `getOpenClawPath('flows', 'registry.sqlite')` |
| 11 | `plugins/schedule/lib/jobs-reader.ts:13-17` | `join(process.env.HOME \|\| '~', '.openclaw', 'cron', 'jobs.json')` | `getOpenClawPath('cron', 'jobs.json')` |
| 12 | `plugins/schedule/lib/runs-reader.ts:12-16` | `join(process.env.HOME \|\| '~', '.openclaw', 'cron', 'runs')` | `getOpenClawPath('cron', 'runs')` |
| 13 | `plugins/memory/index.ts:23-26` | `path.join(os.homedir(), '.openclaw', 'workspace')` | `getOpenClawPath('workspace')` / `getOpenClawPath('workspaces', agentId)` |
| 14 | `plugins/calendar/index.ts:330` | `join(homedir(), '.openclaw', 'openclaw.json')` | `getOpenClawPath('openclaw.json')` |
| 15 | `src/app/api/plugins/memory/workspace/route.ts:7-14` | Hardcoded map with `join(homedir(), '.openclaw', ...)` per agent | Build map dynamically using `getOpenClawPath(...)` |
| 16 | `cli/bakin.ts:21, 412` | `join(process.env.HOME \|\| '~', '.openclaw', ...)` | `getOpenClawPath(...)` |
| 17 | `scripts/lib/post-discord.ts:31`, `scripts/lib/generate-image.ts:52` | Inline path to openclaw.json | `getOpenClawPath('openclaw.json')` |

**Test files** (5 files) can optionally be updated but already work via `homedir()` mocking.

---

## Part 2: Mock Server + Fixtures

### Directory structure

```
dev/imitation-crab/
  index.ts              — Orchestrator: safety check → seed → start gateway → launch Bakin
  safety.ts             — Detects real OpenClaw (binary, real ~/.openclaw/, running gateway)
  seed.ts               — Creates mock OPENCLAW_HOME with all fixture data
  gateway.ts            — HTTP server on :18789 (health, chat, tools)
  cli-shim.ts           — Node script handling `openclaw cron|message|gateway` commands
  cli-shim.sh           — Shell wrapper: exec npx tsx .../cli-shim.ts "$@"
  fixtures/
    openclaw.json       — Agent roster, gateway auth, channel tokens, skills
    auth-profiles.json  — Fake Anthropic API key profile
    jobs.json           — Sample cron jobs (daily-brief, weekly-review)
    runs/               — Sample .jsonl run history files
    workspace/          — Main agent: SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md
    workspaces/         — Subagent workspace dirs (pixel, rolo, chef, explorer, trainer, coach, patch)
    seed.sql            — flow_runs table DDL + sample task rows
```

### Safety Gate (`safety.ts`)

Checks three signals:
1. **Binary**: Does `/opt/homebrew/bin/openclaw` (or `$OPENCLAW_PATH`) exist and is executable?
2. **Config**: Does the default `~/.openclaw/openclaw.json` exist? (checks real home, not OPENCLAW_HOME)
3. **Running gateway**: Does `http://127.0.0.1:18789/health` respond?

If ANY passes → clear error message, exit 1. Override with `OPENCLAW_MOCK_FORCE=1` for CI.

### Filesystem Seeder (`seed.ts`)

Creates a mock home directory at a well-known dev path (e.g., `~/.imitationcrab/`) and copies fixture data into it. The orchestrator sets `OPENCLAW_HOME` to point there.

Seeded structure:
```
~/.imitationcrab/
  openclaw.json              — 8 agents with identities and models
  workspace/                 — Main agent workspace files (Crab 🦀 in the mock)
  workspaces/{id}/           — Subagent workspaces (7 agents)
  cron/jobs.json             — Sample scheduled jobs
  cron/runs/{jobId}.jsonl    — Sample run history
  agents/main/agent/auth-profiles.json  — Fake Anthropic profile
  flows/registry.sqlite      — Real SQLite with seed tasks
```

The seeder is **idempotent** — if `~/.imitationcrab/` already exists, it skips seeding (use `--force` to re-seed). This means fixture data persists between dev sessions, so you can make changes in the UI and they stick.

### Mock HTTP Gateway (`gateway.ts`)

`http.createServer` on port 18789. Endpoints:

| Endpoint | Behavior |
|---|---|
| `GET /health` | `200 { "status": "ok", "mock": true }` |
| `POST /v1/chat/completions` | Reads `x-openclaw-agent-id` header. Returns `{ choices: [{ message: { content: "[mock:{agent}] Acknowledged." } }] }` |
| `POST /tools/invoke` | Logs tool call to stdout, returns `{ ok: true }` |

Also handles calendar plugin's direct call (extra headers `x-openclaw-session-key`, model `openclaw:main`).

All requests logged to stdout. Chat mode configurable via `OPENCLAW_MOCK_CHAT_MODE`: `canned` (default), `echo`, `error`.

### CLI Shim (`cli-shim.ts` + `cli-shim.sh`)

Handles exact CLI commands from `plugins/schedule/lib/openclaw-cron.ts`:

| Command | Mock Behavior |
|---|---|
| `openclaw cron list --all --json` | Read & return `$OPENCLAW_HOME/cron/jobs.json` |
| `openclaw cron add --name X ...` | Generate UUID, append to jobs.json, print `{ "id": "..." }` |
| `openclaw cron edit <id> ...` | Update entry in jobs.json |
| `openclaw cron rm <id>` | Remove from jobs.json |
| `openclaw cron run <id>` | Append run entry to `cron/runs/{id}.jsonl` |
| `openclaw message send ...` | Log to stdout, exit 0 |
| `openclaw gateway restart` | Log "Gateway restarted (mock)", exit 0 |

### Orchestrator (`index.ts`)

```
1. Run safety gate → abort if real OpenClaw found
2. Run seed → create ~/.imitationcrab/ with fixtures (if not exists)
3. Set env: OPENCLAW_HOME=~/.imitationcrab/
4. Set env: OPENCLAW_PATH=~/.imitationcrab/bin/openclaw (CLI shim)
5. Start mock gateway on :18789
6. With --with-bakin flag: spawn `npm run dev` as child with modified env
7. On shutdown (SIGINT/SIGTERM): kill child processes
```

No symlinks. No cleanup required on crash. `OPENCLAW_HOME` is only set for child processes.

### npm Scripts

```json
"dev:mock": "npx tsx dev/imitation-crab/index.ts --with-bakin",
"mock:start": "npx tsx dev/imitation-crab/index.ts",
"mock:seed": "npx tsx dev/imitation-crab/seed.ts"
```

---

## Implementation Order

### Phase 1: Path centralization (production code)
1. Create `packages/core/src/openclaw-home.ts` — the `getOpenClawHome()` / `getOpenClawPath()` utility
2. Update all 17 production files to use the new utility (mechanical find-and-replace)
3. Verify: `npm run dev` still works on a machine with real OpenClaw (no behavior change when `OPENCLAW_HOME` is unset)

### Phase 2: Mock foundation
4. `dev/imitation-crab/safety.ts` — safety gate
5. `dev/imitation-crab/fixtures/openclaw.json` — canonical agent fixture config
6. `dev/imitation-crab/fixtures/auth-profiles.json` — fake credentials
7. `dev/imitation-crab/seed.ts` — filesystem seeder
8. `dev/imitation-crab/gateway.ts` — HTTP mock server
9. `dev/imitation-crab/index.ts` — orchestrator

### Phase 3: CLI + fixtures
10. `dev/imitation-crab/cli-shim.ts` + `cli-shim.sh`
11. `dev/imitation-crab/fixtures/workspace/` — main agent workspace files (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md)
12. `dev/imitation-crab/fixtures/workspaces/` — subagent workspace dirs
13. `dev/imitation-crab/fixtures/jobs.json` + `fixtures/runs/` — cron fixture data
14. `dev/imitation-crab/fixtures/seed.sql` — SQLite seed for flow_runs

### Phase 4: Integration + polish
15. Add npm scripts to `package.json`
16. Create sample `/tmp/openclaw/openclaw-{date}.log` for gateway log viewer
17. End-to-end: `npm run dev:mock` → Bakin boots, pages render, data shows up

---

## Key Design Decisions

- **`OPENCLAW_HOME` env var, not symlinks** — Clean, crash-safe, follows OpenClaw's own test pattern. Requires updating 17 files but centralizes path logic permanently.
- **Single utility module** — `getOpenClawPath()` replaces 20+ different path constructions. DRY, testable, consistent.
- **Real SQLite** — Seed creates actual `registry.sqlite` with real schema, matching existing test patterns in `tests/plugins/tasks/flow-store.test.ts`.
- **Fixture files in repo** — Version-controlled under `dev/imitation-crab/fixtures/`. Copied to `~/.imitationcrab/` by seeder. All devs get the same baseline.
- **Idempotent seeder** — First run creates everything. Subsequent runs skip (preserving dev state). `--force` resets.
- **No `if (mock)` branches** — Production code only knows about `OPENCLAW_HOME`. The mock concept is invisible to it.

## Additional Mock Surfaces

1. **Gateway logs** — Memory plugin reads `/tmp/openclaw/openclaw-{date}.log`. Seeder creates a sample log for today.
2. **LaunchAgent plist** — Doctor checks `~/Library/LaunchAgents/com.openclaw.mc.plist`. Fails gracefully, reports warning. No mock needed.
3. **Calendar plugin** — Hardcodes `http://localhost:18789`. Works because mock gateway is on the same port.

## Verification

1. **Phase 1 smoke test**: `npm run dev` with real OpenClaw → no behavior change (OPENCLAW_HOME unset, falls back to `~/.openclaw/`)
2. **Safety**: `npm run dev:mock` on machine WITH OpenClaw → prints error, exits
3. **Boot**: `npm run dev:mock` on machine WITHOUT OpenClaw → Bakin starts on :3737
4. **Team page**: `http://localhost:3737/team` → shows 8 agents from fixtures
5. **Schedule page**: `http://localhost:3737/schedule` → shows sample cron jobs
6. **Task board**: `http://localhost:3737/tasks` → shows seed tasks across columns
7. **Health page**: `http://localhost:3737/health` → gateway shows as reachable
8. **Tests**: Existing test suite still passes (`npm test`)

## Critical Files

**New:**
- `packages/core/src/openclaw-home.ts` — path resolution utility

**Modified (Part 1 — 17 files):**
- `packages/core/src/main-agent.ts`
- `packages/core/src/settings.ts`
- `packages/core/src/vault.ts`
- `src/core/models.ts`
- `src/core/agent-usage.ts`
- `src/core/doctor.ts`
- `plugins/team/lib/openclaw-adapter.ts`
- `plugins/models/index.ts`
- `plugins/tasks/lib/flow-store.ts`
- `plugins/schedule/lib/jobs-reader.ts`
- `plugins/schedule/lib/runs-reader.ts`
- `plugins/memory/index.ts`
- `plugins/calendar/index.ts`
- `src/app/api/plugins/memory/workspace/route.ts`
- `cli/bakin.ts`
- `scripts/lib/post-discord.ts`
- `scripts/lib/generate-image.ts`

**New (Part 2 — mock tooling):**
- `dev/imitation-crab/index.ts`
- `dev/imitation-crab/safety.ts`
- `dev/imitation-crab/seed.ts`
- `dev/imitation-crab/gateway.ts`
- `dev/imitation-crab/cli-shim.ts`
- `dev/imitation-crab/cli-shim.sh`
- `dev/imitation-crab/fixtures/*`
