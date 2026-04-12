# SPEC: First-run onboarding — granular commands + aggregated `bakin onboard`

**Status:** Draft — awaiting confirmation
**Branch:** `feat/first-run-onboarding` (created off `main` at `8e59e40`)
**Author:** Mark + Claude
**Date:** 2026-04-12
**Predecessor work:** `feat/multimodal-search` (PR #77, merged) — introduced the Termite models, search migration, and exposed the onboarding gap this spec fixes

---

## 1. Objective

A new user clones Bakin (or installs the future binary) and follows the README. Their machine has **nothing**: no OpenClaw, no Antfly, no Termite models, no `~/.bakin/`, no credentials. They run one command and either (a) have a fully working Bakin, or (b) see a clear list of exactly what they need to do next and why.

This spec adds:

1. **Granular single-purpose commands** — one per piece of first-run work (`bakin mkdir`, `bakin install antfly`, `bakin install models`, etc.). Users can run any one on its own to update, repair, or install a specific component.
2. **An aggregated `bakin onboard` command** that runs the whole chain interactively, with sensible defaults, clear progress, and actionable error messages for anything it can't auto-fix.
3. **A `.onboarded` marker file** persisting "this machine has been through first-run setup" state, versioned so future updates can require re-onboarding.
4. **Doctor integration** — `bakin doctor` (periodic health check) refuses to run its normal checks and returns a single blocking error if the `.onboarded` marker is missing. Controlled by `settings.doctor.requireOnboard`.

**Non-goals — explicitly deferred:**

- **Managing OpenClaw itself.** OpenClaw is a hard prerequisite. Bakin detects its presence and prints `OpenClaw is required. Install it from https://openclaw.ai/` if missing, then exits. No automated install, no managing `~/.openclaw/openclaw.json`, no prompting for Discord tokens / Anthropic keys / guild IDs — all that is OpenClaw's own setup territory.
- **Interactive credential entry.** Bakin reads LLM keys and messaging channel config from OpenClaw's existing files. It verifies at least one provider / one channel is present and warns if not, but does not prompt users to paste secrets.
- **LaunchAgent / systemd service install.** The commented-out `bakin setup service` path stays commented out. Separate spec if/when that happens.
- **Windows support.** macOS + Linux. Windows is a future concern.

## 2. Target audience

Two distinct audiences — the spec must serve both:

1. **Cloner / developer (today).** Runs `pnpm install && pnpm cli onboard` from the repo. Knows what a terminal is, may not know what Termite is. Expects each step to either work or tell them exactly how to fix it.
2. **Binary user (future).** Runs `bakin onboard` from a system-installed binary. Has no checked-out repo, no `pnpm`, no dev tooling. Same command, same UX, same outcome.

The code must run in both contexts. That means:
- No reliance on `pnpm` / `npm run` to invoke subcommands (shell out to external binaries by absolute path)
- No reliance on the repo layout (resolve paths via `getContentDir()` / `getBakinPaths()`, never `./plugins/...`)
- Interactive prompts via Node `readline` stdlib — no `inquirer` / `prompts` deps to bundle

## 3. Command surface

### 3.1 Granular commands (top-level, flat)

| Command | Purpose | Modifies system? |
|---|---|---|
| `bakin mkdir` | Create/verify `~/.bakin/` directory tree. Idempotent. Replaces the existing `bakin init` (kept as a deprecation-warning alias). | ✅ Creates dirs under `~/.bakin/` |
| `bakin settings init` | Seed `~/.bakin/settings.json` with current defaults if missing or empty. | ✅ Writes `settings.json` |
| `bakin check openclaw` | Detect OpenClaw binary + `~/.openclaw/openclaw.json`. Print install URL if missing. Read-only. | ❌ |
| `bakin check llm` | Verify at least one LLM provider is configured in `~/.openclaw/agents/main/agent/auth-profiles.json`. Warn if none. Read-only. | ❌ |
| `bakin check channels` | Verify at least one messaging channel (Discord, Telegram, Slack, …) is configured in `~/.openclaw/openclaw.json#channels`. Warn if none. Read-only. | ❌ |
| `bakin check all` | Run every check in order, report status for each, exit 0 if ready / 1 if broken / 2 if degraded. No side effects. | ❌ |
| `bakin install antfly` | Install Antfly binary via `brew install --cask antflydb/antfly/antfly`. Replaces existing `bakin setup antfly`. | ✅ Runs brew |
| `bakin install models` | Pull Termite models (BGE, CLIP, mxbai-rerank) via `antfly termite pull`. | ✅ ~1.5GB download to `~/.termite/models/` |
| `bakin install mcporter` | Install mcporter globally + sync per-agent config. Replaces existing `bakin setup mcporter`. | ✅ `npm install -g`, writes `~/.mcporter/mcporter.json` |
| `bakin onboard` | Interactive aggregated flow. Runs all of the above in order with prompts. | ✅ All of the above |
| `bakin onboard --check` | Non-destructive — equivalent to `bakin check all` with the same exit codes. | ❌ |
| `bakin onboard --yes` | Non-interactive — auto-approve every `[Y/n]` prompt. For CI and scripted installs. | ✅ All of the above, no prompts |
| `bakin onboard --json` | Machine-readable output (each step's status as a line of JSON). Pairs with `--yes`. | ✅ |

### 3.2 Flow of `bakin onboard`

```
┌────────────────────────────────────────────────────────────────────┐
│ bakin onboard                                                       │
│                                                                     │
│  STEP 1 — Prerequisites check (blocking)                            │
│    ✓ check openclaw                                                 │
│      └─ MISSING → print "OpenClaw is required. https://openclaw.ai/"│
│                   exit 1. No further steps.                         │
│                                                                     │
│  STEP 2 — Bakin state (auto, no prompt)                             │
│    ✓ mkdir          — creates ~/.bakin/* directory tree             │
│    ✓ settings init  — writes default settings.json if empty         │
│                                                                     │
│  STEP 3 — Search infrastructure (prompt per component)              │
│    ⚠ install antfly — "Install Antfly via brew? ~25MB [Y/n]"       │
│      └─ declined → warn, skip model pull, continue                  │
│    ⚠ install models — "Download 1.5GB of ML models to              │
│                        ~/.termite/? [Y/n]"                          │
│      └─ declined → warn, skip, continue                             │
│                                                                     │
│  STEP 4 — Agent infrastructure (prompt per component)               │
│    ⚠ install mcporter — "Install mcporter globally via npm [Y/n]" │
│      └─ declined → warn, skip, continue                             │
│                                                                     │
│  STEP 5 — Configuration verification (warn-only)                    │
│    ✓ check llm       — "At least one LLM provider configured?"     │
│      └─ none         → warn: "Configure at least one LLM via       │
│                                OpenClaw. Docs: …"                   │
│    ✓ check channels  — "At least one messaging channel configured?"│
│      └─ none         → warn: "Configure Discord/Telegram/etc via  │
│                                OpenClaw. Docs: …"                   │
│                                                                     │
│  STEP 6 — Finalize                                                  │
│    ✓ Write .onboarded state file with version + timestamp +         │
│      per-component status                                           │
│    ✓ Print success banner + next step (`pnpm dev` / `bakin start`)  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### 3.3 Exit codes (for scripts)

| Exit | Meaning |
|---|---|
| `0` | Everything green. Bakin is ready to run. |
| `1` | Hard failure. OpenClaw missing, `~/.bakin/` not writable, user declined a required step. |
| `2` | Degraded. All required components present, but one or more warnings (no LLM configured, no channels configured, user declined Antfly install, etc.). Bakin will start but features may be missing. |

`bakin onboard --check` uses the same exit codes.

### 3.4 The `.onboarded` marker file

**Path:** `~/.bakin/.onboarded` (or `$BAKIN_HOME/.onboarded` — uses `getContentDir()`)

**Shape:**
```json
{
  "version": 1,
  "completedAt": "2026-04-12T03:14:15.926Z",
  "bakinVersion": "1.0.0",
  "components": {
    "mkdir": "ok",
    "settings": "ok",
    "openclaw": "ok",
    "antfly": "ok",
    "models": "ok",
    "mcporter": "ok",
    "llm": "warn",
    "channels": "warn"
  }
}
```

**Behavior:**
- `bakin onboard` writes this file on completion — even if some components are `warn` or `skipped`, as long as nothing is `error`.
- If a component is `error`, the file is NOT written. User must fix and re-run.
- `version` is bumped in code when onboarding requirements change. On next run, if stored version < current version, `bakin onboard` reports "onboarding is out of date, re-run" rather than "already done."
- `bakinVersion` is the Bakin release the marker was written by. Informational only — we don't gate on it.

## 4. Doctor integration

### 4.1 Read the marker at check time

`src/core/doctor.ts` gains a new first-priority check: does `~/.bakin/.onboarded` exist and have `version >= ONBOARDING_VERSION`?

```
if (settings.doctor.requireOnboard) {
  if (!isOnboarded()) {
    return [{
      check: 'onboarded',
      status: 'error',
      message: 'Bakin is not onboarded on this machine. Run `bakin onboard` to complete first-run setup.',
      autoFixable: false,
    }]
  }
}
```

If this check fails, doctor **returns early** with just the one error. It does not run its existing checks — they'd all be noise because nothing is set up yet. This keeps doctor fast in the common case (onboarded = proceed, not onboarded = one error).

### 4.2 Config flag

New setting: `settings.doctor.requireOnboard: boolean` (default `true`).

Power users who know what they're doing and don't want the onboard gate can set this to `false`. Doctor reverts to its current behavior.

The flag lives in the `doctor` subtree of settings, joining the existing `doctor.intervalMs` and `doctor.autoFixSkill`.

### 4.3 Performance division

The user's guidance: **doctor is lightweight and logs; setup is heavy-handed and interactive.** After this spec:

| Concern | Doctor | Setup |
|---|---|---|
| Runs on a timer (every 30min) | ✅ | ❌ |
| Non-interactive | ✅ | ❌ (onboard is interactive; check is non-interactive) |
| Fast (< 1s) | ✅ | ❌ (model pull can take minutes) |
| Writes files | Minimal (persona stubs, skill sync) | Yes (dirs, settings, models, marker) |
| Shells out to package managers | ❌ | ✅ |
| Used for daily health monitoring | ✅ | ❌ |
| Used for one-time installation | ❌ | ✅ |

Doctor is the "is everything still OK?" loop. Setup is the "fix what isn't OK yet" tool.

## 5. Component checklist

Each component is a separate module with a `check()` function (non-destructive diagnostic) and an `install()` function (destructive remediation where applicable).

| # | Component | Detect by | Remediation | Module |
|---|---|---|---|---|
| 1 | `mkdir` | `existsSync(getContentDir())` + key subdirs | Call `initBakinHome()` | `src/core/onboarding/mkdir.ts` |
| 2 | `settings` | `existsSync(settings.json)` + JSON parses + not empty | Write deep-merged defaults | `src/core/onboarding/settings.ts` |
| 3 | `openclaw` | Binary in `$OPENCLAW_PATH` / `/opt/homebrew/bin/openclaw` / etc. AND `~/.openclaw/openclaw.json` parseable | **None.** Print install URL + exit 1 if run alone, or mark as `error` and skip remaining steps if run via `onboard`. | `src/core/onboarding/openclaw.ts` |
| 4 | `antfly` | Binary via existing `findBinary()` in `antfly-server.ts` | Shell `brew install --cask antflydb/antfly/antfly` with prompt. Fall back to printing the command if brew is missing. | `src/core/onboarding/antfly.ts` |
| 5 | `models` | `existsSync()` for `~/.termite/models/embedders/BAAI/bge-small-en-v1.5/`, `.../openai/clip-vit-base-patch32/`, `~/.termite/models/rerankers/mixedbread-ai/mxbai-rerank-base-v1/` | Shell `antfly termite pull <model>` for each missing, with progress streamed | `src/core/onboarding/models.ts` |
| 6 | `mcporter` | `which mcporter` + per-agent config entries in `~/.mcporter/mcporter.json` | Shell `npm install -g mcporter` + sync config (reuses existing `mcporter.ts` logic) | `src/core/onboarding/mcporter.ts` |
| 7 | `llm` | Parse `~/.openclaw/agents/main/agent/auth-profiles.json`, check for at least one provider entry with a non-empty key | **None.** Warn with a pointer to OpenClaw's LLM config docs. | `src/core/onboarding/credentials.ts` |
| 8 | `channels` | Parse `~/.openclaw/openclaw.json`, check for at least one entry in `channels.*` with a non-empty `token` / `apiKey` / equivalent | **None.** Warn with a pointer to OpenClaw's channel config docs. | `src/core/onboarding/credentials.ts` |

**Not included (intentionally):**

- Persona stubs — `doctor` already auto-creates these on first boot. Leaves doctor's existing autofix logic untouched.
- SQLite `flow_runs` table — OpenClaw-managed, not Bakin's concern.
- `~/.openclaw/openclaw.json` content — OpenClaw's own setup populates this.
- Discord bot registration — the user creates the bot in Discord's developer portal, OpenClaw stores the token.
- LLM API keys — same, user enters these via OpenClaw.
- Plugin settings (`~/.bakin/plugin-settings/*.json`) — auto-created on first plugin use.
- LaunchAgent service install — separate spec.
- Vault initialization — vault reads from files populated by OpenClaw, no separate init needed.

## 6. Architecture

### 6.1 File layout

```
src/core/onboarding/
  index.ts              — public API: runOnboard(), checkAll(), loadState(), saveState()
  state.ts              — .onboarded marker file I/O, ONBOARDING_VERSION constant
  types.ts              — CheckResult, InstallResult, OnboardingComponent interfaces
  prompts.ts            — tiny readline wrappers: askYesNo(), readLine(), spinner()
  mkdir.ts              — component 1
  settings.ts           — component 2
  openclaw.ts           — component 3
  antfly.ts             — component 4
  models.ts             — component 5
  mcporter.ts           — component 6
  credentials.ts        — components 7 & 8

cli/bakin.ts            — add top-level subcommands that import from src/core/onboarding
                          and wire TTY I/O
```

### 6.2 Component interface

Every component module exports:

```ts
import type { CheckResult, InstallResult, OnboardingOptions } from './types'

export const name: string  // 'mkdir', 'antfly', etc.

export async function check(): Promise<CheckResult>
export async function install(opts: OnboardingOptions): Promise<InstallResult>
```

Where:

```ts
interface CheckResult {
  name: string
  status: 'ok' | 'missing' | 'broken' | 'warn' | 'error'
  message: string
  remediation?: string  // human-readable next step
  details?: Record<string, unknown>  // for --json output
}

interface InstallResult {
  name: string
  status: 'installed' | 'skipped' | 'failed' | 'noop'
  message: string
  error?: unknown
  durationMs: number
}

interface OnboardingOptions {
  interactive: boolean   // if false, never prompts — auto-approve or auto-skip based on defaults
  autoApprove: boolean   // --yes flag — skip confirmation prompts
  json: boolean          // --json flag — emit structured output instead of TTY
  skipInstall?: string[] // component names to check-only
}
```

The aggregate `runOnboard(opts)` in `src/core/onboarding/index.ts` is a pure orchestrator. It calls each component's `check()`, decides whether to call `install()`, aggregates results, writes the state file. All TTY I/O happens via `prompts.ts` helpers, which can be stubbed for tests.

### 6.3 Why this design

- **Shared detection code between doctor and setup.** `doctor.ts` imports and calls the same `check()` functions that `cli/bakin.ts` does. No duplication, no drift.
- **Unit-testable.** Each component is a pure module that takes filesystem and process state, returns a result. Mock `fs` and `child_process.spawn` and you test the whole thing without brew or npm.
- **Binary-future ready.** Nothing in `src/core/onboarding/` depends on pnpm, the repo layout, or the monorepo structure. When Bakin ships as a single binary, this module bundles cleanly.
- **Extensible.** Adding a new component (e.g., `redis`, `ollama`) is one new file in `src/core/onboarding/` plus one entry in the orchestrator's component list. No changes to existing components.

## 7. Acceptance criteria

1. **Fresh machine onboarding works.**
   - Starting from a machine with no `~/.bakin/`, no Antfly, no `~/.termite/`, and no mcporter, running `bakin onboard` (with `--yes` for non-interactive) completes successfully and leaves Bakin bootable via `pnpm dev`.
   - First `pnpm dev` after `bakin onboard --yes` boots cleanly with no `[search-migration]` errors, no `ANTFLY_PATH not found`, no `Termite models missing` warnings, no `mcporter not installed` warnings.

2. **Granular commands run independently.**
   - `bakin mkdir` on a machine where `~/.bakin/` already exists is a no-op, exits 0, prints "Already initialized."
   - `bakin install antfly` on a machine where Antfly is already installed exits 0 with "Antfly is already installed at /opt/homebrew/bin/antfly."
   - `bakin install models` re-run with all three models present exits 0 with "All 3 models present."

3. **OpenClaw missing is a hard stop.**
   - `bakin check openclaw` with OpenClaw missing prints the install URL and exits 1.
   - `bakin onboard` with OpenClaw missing prints the same URL, does NOT run any other steps, does NOT write `.onboarded`, exits 1.

4. **LLM and channels missing are warnings, not errors.**
   - With `~/.openclaw/` present but no LLM provider configured, `bakin onboard` completes and writes `.onboarded` with `components.llm: "warn"`. Exit code 2.
   - Same for channels.

5. **`.onboarded` marker is accurate.**
   - Written only when all components are `ok`, `warn`, or `skipped`. Not written if any component is `error`.
   - Contains the exact per-component statuses from the run.
   - On re-run when `version` matches, `bakin onboard` exits 0 with "Already onboarded on 2026-04-12. Re-run with `--force` to onboard again."

6. **Doctor respects the marker.**
   - With `settings.doctor.requireOnboard: true` and no `.onboarded` marker, `bakin doctor` returns exactly one diagnostic: `{ check: 'onboarded', status: 'error', message: '...' }` and none of its other checks run.
   - With the marker present, doctor runs its existing checks unchanged.
   - With `settings.doctor.requireOnboard: false` and no marker, doctor runs its existing checks unchanged (regression protection).

7. **Non-interactive mode works for CI.**
   - `bakin onboard --yes --json` emits one line of JSON per component with no prompts.
   - Exit code reflects the worst status across components.
   - Can be scripted end-to-end on a fresh macOS runner.

8. **All tests pass.**
   - New unit tests for each component's `check()` and `install()` with mocked fs + spawn.
   - New integration test for `runOnboard()` with mocked components.
   - Existing `doctor` tests updated to cover the onboarded-gate behavior.
   - Existing `bakin init` tests renamed / updated for `bakin mkdir`.

9. **README updated.**
   - New first-run section lists exactly `pnpm install && pnpm cli onboard && pnpm dev` as the happy path.
   - References the individual commands for users who want to run them piecemeal.

10. **CLAUDE.md updated.**
    - New "Onboarding" section explains the command structure so future agents know to use `bakin onboard` when setting up a fresh machine.

## 8. Project structure (files we'll touch or add)

### Add

```
src/core/onboarding/
  index.ts                                 — public API (runOnboard, checkAll, state I/O)
  state.ts                                 — .onboarded file I/O, ONBOARDING_VERSION
  types.ts                                 — CheckResult, InstallResult, etc.
  prompts.ts                               — readline helpers
  mkdir.ts
  settings.ts
  openclaw.ts
  antfly.ts
  models.ts
  mcporter.ts
  credentials.ts

tests/core/onboarding/
  index.test.ts                            — orchestrator unit tests
  state.test.ts                            — marker file I/O
  mkdir.test.ts
  settings.test.ts
  openclaw.test.ts
  antfly.test.ts
  models.test.ts
  mcporter.test.ts
  credentials.test.ts
```

### Modify

```
cli/bakin.ts                               — add new subcommands, deprecate bakin init
packages/core/src/settings.ts              — add doctor.requireOnboard setting
src/core/doctor.ts                         — import onboarding check, gate on .onboarded
src/core/mcporter.ts                       — expose install logic as a reusable function
src/core/antfly-server.ts                  — expose findBinary() for onboarding.antfly
README.md                                  — first-run section
CLAUDE.md                                  — onboarding reference
```

### Deprecate

- `bakin init` — aliased to `bakin mkdir` for one release with a deprecation warning, then remove
- `bakin setup antfly` — aliased to `bakin install antfly`
- `bakin setup mcporter` — aliased to `bakin install mcporter`

## 9. Testing strategy

### Unit tests (mocked fs + child_process.spawn)

- **Each component's `check()`** — covers `status: 'ok' | 'missing' | 'broken' | 'warn' | 'error'` paths by mocking filesystem state
- **Each component's `install()`** — mocks `spawn()` to simulate brew/npm/antfly subprocess success and failure
- **State file I/O** — writes and reads roundtrip, handles missing file (returns null), handles corrupt JSON (returns null + warns)
- **Orchestrator `runOnboard()`** — mocks all components, verifies:
  - Hard fail on OpenClaw missing stops the flow
  - Warn-only components don't block completion
  - Partial status aggregates correctly
  - `.onboarded` written at the right time
  - `--yes` skips prompts
  - `--check` never calls any `install()`
  - Dependency order: mkdir → settings → openclaw → antfly → models → mcporter → credentials

### Doctor integration tests

- `requireOnboard: true` + no marker → single error, no other checks run
- `requireOnboard: true` + marker → existing checks run
- `requireOnboard: false` + no marker → existing checks run
- Marker version older than code → treat as not onboarded

### Manual smoke test (me, before merging)

Run on a freshly-created Mac user account (or a `nuke-bakin-state.sh` script that wipes `~/.bakin/`, `~/.termite/`, and uninstalls Antfly):

```bash
# 1. Start from nothing
rm -rf ~/.bakin ~/.termite
brew uninstall antfly

# 2. Install Bakin dependencies
pnpm install

# 3. Run aggregated onboard
pnpm cli onboard

# 4. Verify each step prompted or auto-ran with clear feedback
# 5. Verify ~/.bakin/.onboarded is written
# 6. Start Bakin
pnpm dev

# 7. Verify search works (reindex + query for a body term from a dropped PDF)
```

Same run on a machine that has OpenClaw missing — expect exit 1 with the https://openclaw.ai/ message.

### Mandatory test hygiene

Every new test mocks `getContentDir()`, `logger`, `watcher`, `openclaw-client` per `CLAUDE.md` rules. No test touches the real `~/.bakin/`.

## 10. Code style

Inherits all `CLAUDE.md` conventions. Specific notes:

- **Logger per module.** `const log = createLogger('onboarding:antfly')`, etc.
- **No `any` across module boundaries.** Component check/install return types are strictly typed.
- **Pure functions where possible.** The check functions should be easy to stub in tests — take explicit `{ contentDir, env }` parameters rather than reading from module-level globals.
- **Shell out via `child_process.spawn`, not `exec`.** Stream stdout/stderr to the logger and, in interactive mode, to the TTY. Never use `shell: true` — pass args as an array.
- **Never `shell: true`.** Security and arg-escaping.
- **TTY detection.** `process.stdout.isTTY` determines whether interactive prompts are valid. In non-TTY contexts (CI, scripts), default to `--yes --json` behavior.
- **No new third-party dependencies.** Use Node stdlib only — `readline`, `child_process`, `fs`, `path`, `os`. The whole `onboarding/` module should add zero lines to `package.json`.

## 11. Boundaries

### Always do
- Honor the OpenClaw Adapter Principle. We detect OpenClaw but never write to `~/.openclaw/`.
- Use `getContentDir()` / `getBakinPaths()` for every filesystem path.
- Stream subprocess output in real time so users see progress during long pulls.
- Make every component idempotent — re-running is always safe, no side effects beyond the first successful run.
- Write the `.onboarded` marker only after all non-error components complete.

### Ask first
- Before running any destructive command (`brew install`, `npm install -g`, `antfly termite pull`), the interactive flow prompts `[Y/n]` with default `Y`. In `--yes` mode, auto-approves. In `--check` mode, never runs them.
- Before adding a new component beyond the 8 listed above.
- Before touching files outside `~/.bakin/`, `~/.termite/`, `~/.mcporter/`, or user-approved brew/npm targets.

### Never do
- Touch `~/.openclaw/*`. Read-only, and only for `check llm` / `check channels`.
- Auto-install OpenClaw itself. Print the install URL and stop.
- Prompt for secrets (Anthropic keys, Discord tokens) via the CLI.
- Write the `.onboarded` marker if any component errored.
- Use `shell: true` in `child_process.spawn`.
- Add new runtime dependencies for interactive prompts.
- Run setup logic during `pnpm install` / `npm install` (no `postinstall` hooks). Setup is always explicit.

## 12. Commit strategy

**Branch:** `feat/first-run-onboarding` (already created)

**Commits — one per vertical slice, in order:**

1. `feat(onboarding): add src/core/onboarding skeleton and .onboarded marker` — empty module structure, state file I/O, types, orchestrator stub, state tests
2. `feat(onboarding): add mkdir component wrapping initBakinHome` — first real component, simplest check/install
3. `feat(onboarding): add settings component` — writes default settings.json
4. `feat(onboarding): add openclaw detection and install-message component` — check-only, no install side
5. `feat(onboarding): add antfly component and reuse findBinary from antfly-server` — shells out to brew
6. `feat(onboarding): add models component for termite pull` — shells out to antfly termite pull
7. `feat(onboarding): add mcporter component by extracting install logic` — refactor mcporter.ts to expose reusable install function
8. `feat(onboarding): add credentials component for LLM and channels` — warn-only
9. `feat(onboarding): implement runOnboard orchestrator with dependency order and TTY prompts` — ties everything together
10. `feat(cli): add granular bakin commands for each onboarding component` — mkdir, install antfly, install models, install mcporter, check *, settings init
11. `feat(cli): add bakin onboard aggregated command with --check, --yes, --json flags` — the top-level wizard
12. `feat(cli): deprecate bakin init, bakin setup antfly, bakin setup mcporter as aliases` — backward compat for one release
13. `feat(doctor): gate normal checks on .onboarded marker when requireOnboard is true` — doctor integration
14. `docs(onboarding): README first-run section, CLAUDE.md onboarding reference` — docs

Each commit is independently buildable with tests green. PR opens after commit 14 with a checklist mirroring §7 acceptance criteria.

## 13. Open questions (answer before `/agent-skills:plan`)

1. **Command naming: `bakin install antfly` vs `bakin antfly install`?** Proposed: `install <thing>` for consistency (`install antfly`, `install models`, `install mcporter`). Alternative: `<thing> install` for discoverability under `bakin <thing> --help`. Lean: `install <thing>`.
2. **`settings.doctor.requireOnboard` default: `true` or `false`?** Proposed: `true` — strict by default, power users opt out. Rationale: new users are the ones who'd hit this and the error message is the whole point.
3. **Keep `bakin init` as an alias or just rename?** Proposed: keep as deprecation-warning alias for one release. Cost is ~5 lines, prevents breaking any existing scripts.
4. **Model pull progress display.** `antfly termite pull` writes progress bars to stderr. Proposed: pipe directly to the TTY when interactive, swallow when `--json`. Worth flagging because it affects whether the command is "silent" in CI logs.

## 14. Lifecycle

```
spec-driven-development (this doc)
  → planning-and-task-breakdown    (/agent-skills:plan)
    → incremental-implementation   (/agent-skills:build)
      → test-driven-development    (/agent-skills:test)
        → code-review-and-quality  (/agent-skills:review)
          → git-workflow           (PR + merge to main)
            → docs                 (bundled into commit 14)
```

## 15. Related

- **`feat/multimodal-search` (PR #77, merged)** — introduced the Termite models that this spec now automates installing. Also exposed the onboarding gap when the user had to run `antfly termite pull ...` from memory.
- **[#72 Antfly upstream fixes](https://github.com/markhayden/bakin/issues/72)** — upstream bugs we worked around in the multimodal branch. Not blocking here, but if any resolve they simplify the setup story.
- **`.claude/knowledge/search-system.md`** — the search-system doc that now has a clean migration story (§Schema Migration). Onboarding uses the same state-file pattern.
- **`.claude/specs/multimodal-search.md`** — template for this spec's structure.
