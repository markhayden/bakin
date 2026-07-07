# Pi Runtime Adapter (`packages/adapter-pi`)

The second `AgentRuntimeAdapter` (after OpenClaw), driving the Pi coding agent (https://pi.dev) **in-process** via the pinned `@earendil-works/pi-coding-agent` SDK — no gateway, no subprocess, no MCP hop. Selected with `settings.runtime.adapter: 'pi'`. Spec + decision record: `.claude/specs/adapter-pi/`.

## Architecture in one paragraph

Pi is a minimal single-session coding harness — it has no agent roster, channels, cron, MCP, or daemon. The adapter supplies the multi-agent layer itself: a zod registry (`<pi-home>/agent/bakin-agents.json`) with per-agent dirs (`agents/<id>/workspace/` = the session cwd, `agents/<id>/sessions/` = the session store). Every turn opens (or resumes) one Pi `AgentSession` in-process, runs it, and disposes it; the session JSONL file on disk carries conversation state across turns.

## Module map (`packages/adapter-pi/src/`)

| Module | Owns |
|---|---|
| `home.ts` | `getPiHome()`: `PI_HOME` env → `~/.pi` (Bakin-side convention; SDK constructors always get EXPLICIT paths, never env/defaults) |
| `registry.ts` | Agent roster CRUD, atomic serialized writes, path-safe ids, loud corrupt-file failure |
| `main-agent.ts` | Seeds `main` (orchestrator) on first `initialize()` when the registry is empty |
| `agents.ts` | agents.* contract: identity, workspace file CRUD (traversal-guarded), `workspaceFileStats` (canonical/skill/memory) |
| `sessions.ts` | threadId → session-file map (`bakin-threads.json`), per-thread turn mutex, sessions.list/get/storeStats |
| `messaging.ts` | send/stream: session assembly, event→ChatChunk mapping, usage delta, abort, terminal-failure detection, Pi extension policy (#626) |
| `tool-bridge.ts` | Exec-tool seam descriptors → Pi `defineTool()` (native tools); per-turn policy + agent allowlist filtering |
| `system-prompt.ts` | Canonical workspace files (SOUL/IDENTITY/TOOLS/…) → `appendSystemPrompt` sections; AGENTS.md rides Pi's native cwd discovery |
| `errors.ts` | THE classification point → `RuntimeError` kinds + stream-death diagnoses with salvage |
| `memory.ts` | Tiers: `pi-session-jsonl` (`sourceKind: 'session_jsonl'`) + `pi-durable` (workspace files) |
| `models.ts` | Pi `ModelRegistry` → `provider/id` catalog; `capabilities()` from model input modalities |
| `config.ts` | `<pi-home>/agent/settings.json` + onboarding raw-key synthesis (authProfiles presence-only, `channels` → `{}`) |
| `skills.ts` | Pi-native skill dirs: global `agent/skills/` + per-agent `<workspace>/.pi/skills/` |
| `unsupported.ts` | Honest-empty channels/cron/tools.invoke (typed `runtime_failed`, never silent) |
| `images.ts` | route: codex-native primary, direct-provider shim fallback for explicit keyed routes |
| `codex-images.ts` | the codex image wire: OAuth token via Pi's ModelRegistry (refresh SDK-owned), account-id from the JWT claim, SSE `image_generation_call` → temp file; carrier model gpt-5.5 (settings-overridable via images.carrierModel) |
| `health-checks.ts` | Doctor: pi home/registry, agents-root writable, auth providers, models available |

## Load-bearing SDK facts (0.80.3, probed — do not trust docs over these)

- **`session.prompt()` RESOLVES on terminal provider failure.** Failure evidence is the final `agent_end` event: last assistant message `stopReason: 'error'` + `errorMessage`, `willRetry: false` after auto-retries exhaust. `TurnObserver` in messaging.ts reads this; without it every failed turn would look successful.
- **Pi extensions load in Bakin turns per policy** (`settings.runtime.settings.piExtensions: { mode: 'none'|'allowlist'|'all', allow?: [] }`, default `'all'` — honors whatever `pi install` set up, #626). Allowlist matches extension path substrings and filters AFTER discovery (non-matching extension modules still evaluate at load; use `'none'` for a hard lockout). Extensions are arbitrary code in the server process — treat installs as trusted. Themes/prompt-templates stay TUI-only.
- No `systemPrompt` option on `createAgentSession` — system prompt goes through `DefaultResourceLoader` (`appendSystemPrompt`); **`await loader.reload()` before use**.
- No AbortSignal on `prompt()` — cancellation is `session.abort()`; the adapter wires `MessageArgs.signal` to it and maps to kind `'aborted'`.
- Tool failures are THROWN from `execute()` (no `isError` field on `AgentToolResult`; `details` is required — pass `undefined`).
- Pi's own env override is `PI_CODING_AGENT_DIR` (NOT `PI_HOME`) — irrelevant here because the adapter passes explicit paths to every constructor.
- Pi session JSONL **matches Bakin's session-usage parser contract 1:1** (`{type:'session'}` header; `{type:'message'}` with `message.usage.totalTokens` + `cost.total`) — the `pi-session-jsonl` tier serves raw file content and usage.db populates with zero core changes.
- Pi's inner auto-retry (3 attempts, exponential) is tunable via `settings.runtime.settings.retry` (`{ enabled, maxRetries, baseDelayMs }`) — Bakin's dispatch owns the outer ladder; tests disable it.

## Core seams added for Pi (adapter-neutral, OpenClaw unaffected)

- **`AdapterInitOpts.execTools: RuntimeExecToolProvider`** (`src/core/exec-tools/provider.ts`): core hands the live exec-tool registry across the boundary as JSON-Schema descriptors; `invoke()` carries the same usage-recording + `exec.*` audit the MCP path does. Pi registers them as first-class session tools; OpenClaw keeps MCP/mcporter.
- **`describeToolAccess?(): RuntimeToolAccessHint`**: dispatch prompts render tool calls per the active runtime — bare `bakin_exec_*` calls for Pi (`'native'`), `mcporter call …` for OpenClaw. `resolveToolInvocation()` in `dispatch-prompts.ts` keeps measurement == production; absent hint = legacy `'mcporter-cli'` (fixtures byte-stable).
- **Onboarding gating**: `OnboardingComponent.supportedAdapters` — `mcporter` + `openclaw-integration` are `['openclaw']`; everything else adapter-generic (Pi answers the credential-check raw keys via config synthesis).

## Degradation matrix (MVP, per spec D3/AD6)

| Surface | Behavior on Pi |
|---|---|
| channels | `list() → []`; sends/approvals throw typed `runtime_failed` ("not supported by the pi runtime"); the Chat plugin is the conversational surface |
| cron | empty reads, typed failure on mutation (Bakin-owned task scheduling unaffected) |
| images | **FULLY SUPPORTED, ZERO KEYS** (`images.ts` + `codex-images.ts`): the existing openai-codex OAuth drives the ChatGPT backend's hosted `image_generation` tool (gpt-image-2) — generation AND edits with input images (both probed live 2026-07-07). `providers()` reports `openai-codex` configured → plugin routes `servedBy: 'runtime'`. Explicit `provider: openai/google` routes still ride the shared direct-provider shim with a Bakin key (generate-only fallback). Caveats: the hosted tool takes no size params (`sizingHonored: false` — plugin probes real dims, exports own geometry); the endpoint is reverse-engineered (`chatgpt.com/backend-api/codex/responses`), so failures classify typed and the shim remains the keyed escape hatch |
| media / createThread / editMessage | members genuinely absent — callers skip |
| tools.invoke | typed failure (zero production callers) |

Fast-follows on record: Discord bridge (reuse existing bot token), in-app approval channel.

## Testing

- `tests/adapter-pi/*` — module suites under temp `PI_HOME` (set env vars BEFORE imports; call `resetPiHome()` + `resetModelRegistry()`).
- `tests/integration/pi/*` — REAL SDK sessions against `fake-provider.ts`, a ~130-line canned OpenAI-compatible streaming server (zero tokens). Gotchas baked in: restore `globalThis.fetch` from Bun (happy-dom preload breaks sockets) and use the captured NATIVE `Response` for `Bun.serve` (happy-dom's is rejected).
- Boundary: `~/.pi`, `PI_HOME`, `getPiHome/getPiPath`, `@earendil-works` are banned upstream; `@bakin/adapter-pi` imports are factory-only; `pi.dev` URL factory-only (arch test + eslint + edit hook).

## Live operation on this box

Flip: `~/.bakin/settings.json` → `"runtime": { "adapter": "pi" }` → restart. Rollback is the same edit in reverse. Pi auth lives in `~/.pi/agent/auth.json` (managed by `pi` itself — log in via the pi CLI). Doctor surfaces `pi.home`/`pi.auth`/`pi.models` checks.
