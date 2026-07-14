# Pi Runtime Adapter (`packages/adapter-pi`)

The second `AgentRuntimeAdapter` (after OpenClaw), driving the Pi coding agent (https://pi.dev) **in-process** via the pinned `@earendil-works/pi-coding-agent` SDK — no gateway, no subprocess, no MCP hop. Selected with `settings.runtime.adapter: 'pi'`. Spec + decision record: `.claude/specs/adapter-pi/`.

## Architecture in one paragraph

Pi is a minimal single-session coding harness — it has no agent roster, channels, cron, MCP, or daemon. The adapter supplies the multi-agent layer itself: a zod registry (`<pi-home>/agent/bakin-agents.json`) with per-agent dirs (`agents/<id>/workspace/` = the session cwd, `agents/<id>/sessions/` = the session store). Every turn opens (or resumes) one Pi `AgentSession` in-process, runs it, and disposes it; the session JSONL file on disk carries conversation state across turns.

## Module map (`packages/adapter-pi/src/`)

| Module | Owns |
|---|---|
| `home.ts` | `getPiHome()`: `PI_HOME` env → `~/.pi` (Bakin-side convention; SDK constructors always get EXPLICIT paths, never env/defaults) |
| `registry.ts` | Agent roster CRUD, atomic serialized writes, path-safe ids, loud corrupt-file failure |
| `main-agent.ts` | Seeds `main` (orchestrator) at `provisionToolAccess()` when the registry is empty — `initialize()` is write-free by conformance pin (read-only consumers like `bakin check` and the switch dry-run initialize without mutating `~/.pi`) |
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
| `images.ts` | route: codex-native primary; explicit keyed routes (openai/google) ride the shared shim with full generate/edit/multi-ref support (WS3) |
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
- **Auto-compaction is ON by default** (SDK settings default; long tasks compact, not die). The per-turn construction is `createTurnSettingsManager` (messaging.ts, exported) and `tests/adapter-pi/session-settings.test.ts` PINS the enabled default — an SDK flip fails the pin and forces an explicit override.

## Core seams added for Pi (adapter-neutral, OpenClaw unaffected)

- **`AdapterInitOpts.execTools: RuntimeExecToolProvider`** (`src/core/exec-tools/provider.ts`): core hands the live exec-tool registry across the boundary as JSON-Schema descriptors; `invoke()` carries the same usage-recording + `exec.*` audit the MCP path does. Pi registers them as first-class session tools; OpenClaw reaches the same registry over its native MCP client.
- **`describeToolAccess(): RuntimeToolAccess`**: dispatch prompts + the AGENTS.md tool-access section render tool calls per the active runtime — bare `bakin_exec_*` calls for Pi (`in-process`), `bakin-<agent>.`-prefixed native MCP calls for OpenClaw (`mcp`). `resolveToolAccess()` in `dispatch-prompts.ts` keeps measurement == production; everything renders through `src/core/tool-access.ts` (`renderToolCall`).
- **Onboarding gating**: `OnboardingComponent.supportedAdapters` — `openclaw-integration` is `['openclaw']`; everything else adapter-generic (Pi answers the credential checks via `credentialStatus()` — auth.json provider names, presence-only).

## Degradation matrix (MVP, per spec D3/AD6)

| Surface | Behavior on Pi |
|---|---|
| channels | `list() → []`; sends/approvals throw typed `runtime_failed` ("not supported by the pi runtime"); the Chat plugin is the conversational surface. Pending workflow gates are NEVER silent: the workflows nav badge + toast/OS notification (`nav-badge-providers` slot) deliver approval attention in-app on every runtime |
| cron | omitted entirely (optional contract member — consumers feature-detect). Agents self-schedule via `bakin_exec_schedule_*` (Bakin-owned scheduler); a switch OFF a cron-bearing runtime can adopt its native jobs into Bakin schedules (`--adopt-cron`, opt-in) |
| images | **FULLY SUPPORTED, ZERO KEYS** (`images.ts` + `codex-images.ts`): the existing openai-codex OAuth drives the ChatGPT backend's hosted `image_generation` tool (gpt-image-2) — generation AND edits with input images (probed live 2026-07-07; full create/edit/multi-ref battery re-verified 2026-07-14, pi-ecosystem WS3). `providers()` reports `openai-codex` configured → plugin routes `servedBy: 'runtime'`. Explicit `provider: openai/google` routes ride the shared direct-provider shim with a Bakin key — since WS3 the shim takes input images too (OpenAI `/v1/images/edits` multipart, Gemini inline_data parts), so the keyed lane has FULL parity: generate, edit, multi-reference. `providers()` advertises the keyed rows (model ids mirror the plugin catalog) so the routing engine routes to them; the plugin's reference gate accepts `servedBy: 'shim'`. Caveats: the hosted tool takes no size params (`sizingHonored: false` — plugin probes real dims, exports own geometry); the endpoint is reverse-engineered (`chatgpt.com/backend-api/codex/responses`), so failures classify typed and the shim remains the keyed escape hatch |
| media / createThread / editMessage | members genuinely absent — callers skip |
| per-agent subagent models | `routingSupport().perAgentSubagentModel` stays FALSE (Pi has no native subagents) — but a switch onto Pi PRESERVES carried values in agent metadata (`carriedSubagentModel`, reconciler-owned) and restores them on the switch back; report line "preserved (not active on pi)" |
| web search / browser / per-turn capabilities | capability packs (skill-packs) via agent-packages — see `.claude/knowledge/capability-packs.md`; Bakin ships no tool wrappers |

Fast-follows on record: Discord bridge (reuse existing bot token), in-app approval channel.

## Codex image generation — burn + stability

The codex image path bills against the **ChatGPT subscription's rolling usage window**, and image turns burn it **~3-5x faster than chat turns**. Controls in place:

- **Cheap carrier by default.** Each image call is a carrier chat turn that only EMITS the `image_generation` tool call — the backend's gpt-image-2 does the rendering, so carrier quality is irrelevant to the image. Default carrier is `gpt-5.4-mini` (cheapest the ChatGPT account accepts; `gpt-5.3-codex-spark` is rejected for image calls). Override: `settings.runtime.settings.images.carrierModel`.
- **No double-bill.** The images plugin wraps every generate/edit in `runBilledImageCall` (execution-ledger dedup, first-write-wins, no TTL) ABOVE the adapter — a client timeout/retry with the same call key never re-bills, on any runtime.
- **Tight request.** `parallel_tool_calls: false`, `tool_choice: auto`, `text.verbosity: low`, no reasoning effort, instructions pinning "call the tool exactly once" — the carrier does no extra work.
- **No failed-retry loops.** Image exec tools ship a `surface` zod enum (valid ids in the schema) so the model can't guess a bad surface and retry; codex-primary routing removes the old keyless "no key" bounce.

**Stability caveat (no more official path exists — researched 2026-07-07):** the public OpenAI Images/Responses APIs are API-key-only (platform-billed); keyless subscription image gen is available ONLY through `chatgpt.com/backend-api/codex/responses` (the undocumented subscription mirror of the Responses API — the same path OpenAI's own Codex CLI, pi-codex-image-gen, and the codex-imagen skill all use). The `/codex` path segment is load-bearing: the legacy `/backend-api/responses` was retired ~2026-04 and now 403s. Failures classify typed (403 endpoint-moved → runtime_failed; 429 window-exhausted → provider_cooldown) and the keyed direct-provider shim is the escape hatch if the backend breaks. Do not power a public/multi-user image service off one subscription token — against OpenAI usage policy.

## Testing

- `tests/adapter-pi/*` — module suites under temp `PI_HOME` (set env vars BEFORE imports; call `resetPiHome()` + `resetModelRegistry()`).
- `tests/integration/pi/*` — REAL SDK sessions against `fake-provider.ts`, a ~130-line canned OpenAI-compatible streaming server (zero tokens). Gotchas baked in: restore `globalThis.fetch` from Bun (happy-dom preload breaks sockets) and use the captured NATIVE `Response` for `Bun.serve` (happy-dom's is rejected).
- Boundary: `~/.pi`, `PI_HOME`, `getPiHome/getPiPath`, `@earendil-works` are banned upstream; `@bakin/adapter-pi` imports are factory-only; `pi.dev` URL factory-only (arch test + eslint + edit hook).

## Live operation on this box

Flip: `~/.bakin/settings.json` → `"runtime": { "adapter": "pi" }` → restart (or process-scoped: the `BAKIN_RUNTIME_ADAPTER` env override, applied at the `getSettings()` cache chokepoint — never persisted). Rollback is the same edit in reverse. Pi auth lives in `~/.pi/agent/auth.json`, written by the **pi TUI's `/login` slash command** — there is NO `pi login` subcommand; the SDK's own home override is `PI_CODING_AGENT_DIR` and it points at the AGENT dir (`…/agent`), not the home root. Doctor surfaces `pi.home`/`pi.auth`/`pi.models` checks.

## Dev loop (rig)

`bun run instance up --runtime pi && bun run instance dev --runtime pi` — Pi in-process on the host against a throwaway `PI_HOME` under `dev/pi-home` (state isolation; agent tools execute on this Mac inside dev-scoped workspaces), real HMR, no docker. `--mode sandbox --runtime pi` runs Bakin+Pi fully in-container (execution sandboxing). The rig drives the TUI `/login` at `up` and seeds `routing.defaultModel` from auth.json + the SDK's `defaultModelPerProvider`. A ChatGPT `/login` alone unlocks codex image gen/edit in the rig. Deep reference: `.claude/knowledge/dev-rig.md`.
