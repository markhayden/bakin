# Spec: Pi Runtime Adapter (`packages/adapter-pi`) + Chat Core Plugin

Status: **approved plan-phase spec** · Owner: roscoe · Date: 2026-07-05
Companion: [PLAN.md](./PLAN.md) (task breakdown, commit strategy, risks)

## Objective

Make the full Bakin app run against the **Pi agent runtime** (https://pi.dev, `@earendil-works/pi-coding-agent`) as a first-class alternative to OpenClaw, selected via `settings.runtime.adapter = 'pi'`. Pi becomes the second proof that the runtime adapter layer is real: every upstream consumer (dispatch, team, tasks, workflows, memory, usage, models, health, onboarding) works unchanged, consuming only the `AgentRuntimeAdapter` contract.

Because Pi ships no channel layer, a new **Chat core plugin** (adapter-agnostic, lands first on OpenClaw) becomes the conversational surface: start streamed chats with any agent from the Bakin UI; agents keep their `bakin_*` exec tools mid-chat.

Success looks like: this machine's daily-driver Bakin flipped to `adapter: 'pi'`, OpenClaw gateway stopped, tasks dispatching, usage/cost populating, chat working — with a deterministic test suite that never spends a token.

## Decision Record (interview outcomes, 2026-07-05)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Pi transport | **In-process SDK** (`@earendil-works/pi-coding-agent`), no RPC subprocess. Validated under Bun on this box (models + in-memory session OK). |
| D2 | Agent identity | **Adapter-owned multi-agent layer under `~/.pi`**: registry + per-agent workspace/session dirs; adapter-private `getPiHome()` (`PI_HOME` env → `~/.pi`). |
| D3 | Channels | **Honest-empty for MVP.** No Discord. `channels.list() → []`, sends/approvals fail with typed unsupported errors. Discord bridge (reusing existing bot token) is a fast-follow. |
| D4 | Chat plugin | **New core plugin #12 `chat`**, separate PR, lands first, built against OpenClaw. Multi-chat + streaming + history MVP. |
| D5 | Testing | **Fake provider + live smoke**: unit tests mock at module boundary; integration tests run real Pi sessions against a local canned OpenAI-compatible HTTP provider; one real openai-codex e2e on this box. |
| D6 | End state | **Flip this box to Pi** as the final acceptance bar (OpenClaw stays installed, one-settings-edit rollback). |
| D7 | PR shape | Plan PR (this doc) → Chat PR → **one mega PR** for the adapter (`feat/adapter-pi`), tested in isolation before merge. |

Standing constraints from the kickoff: single-user machine, **no backwards-compatibility work**, reduce tech debt, small files split logically from the start, `.claude/knowledge/` + README kept accurate.

## Tech Stack

- Bun ≥ 1.2 runtime; TypeScript strict; Zod at boundaries (registry files, settings, transformed transcripts).
- `@earendil-works/pi-coding-agent` (pin exact version; currently 0.80.x line) — the ONLY new production dependency, imported ONLY inside `packages/adapter-pi/`.
- Existing contract: `AgentRuntimeAdapter` from `@bakin/core/adapters/runtime` (`packages/core/src/adapters/runtime/concepts.ts`); typed failures via `RuntimeError`/`RuntimeTurnError` (`errors.ts`); reference implementation checklist: `createMockRuntimeAdapter` (`testing.ts`).

## Commands

```
Build:        bun run build
Dev:          bun run dev            # server restart still manual for server-side code
Test (CI):    bun run test
Single file:  bun test tests/adapter-pi/<file>.test.ts --isolate
Typecheck:    bun run typecheck      # (repo standard; verify script name before relying on it)
Boundary:     bun test tests/architecture/adapter-boundary.test.ts --isolate
Isolated e2e: /verify skill (throwaway BAKIN_HOME + PI_HOME), OpenClaw gateway stopped
Runtime flip: edit ~/.bakin/settings.json → "runtime": { "adapter": "pi" } → restart server
```

## Project Structure (new/changed surfaces only)

```
packages/adapter-pi/
  package.json                 @bakin/adapter-pi; dep: @earendil-works/pi-coding-agent (pinned)
  src/index.ts                 createPiRuntimeAdapter(options) factory export
  src/runtime.ts               PiRuntimeAdapter class — thin orchestration ONLY; delegates to modules
  src/home.ts                  getPiHome()/getPiPath(): PI_HOME env → ~/.pi (mirrors adapter-openclaw/home.ts)
  src/registry.ts              agent roster CRUD: ~/.pi/agent/bakin-agents.json (zod-validated) + dir scaffolding
  src/agents.ts                agents.* contract impl (identity, workspace file CRUD, workspaceFileStats, permissions no-ops)
  src/main-agent.ts            'main' orchestrator invariant + first-boot seeding
  src/sessions.ts              threadId → Pi session mapping; AgentSession lifecycle pool; sessions.list/get/storeStats
  src/messaging.ts             send/stream: prompt assembly, event → ChatChunk mapping, abort, usage extraction
  src/tool-bridge.ts           ExecToolDefinition[] → Pi defineTool() wrappers (zod → Type schema, agent binding)
  src/system-prompt.ts         workspace canonical files (SOUL/IDENTITY/TOOLS) → system-prompt sections; AGENTS.md via cwd
  src/errors.ts                THE one place Pi/SDK failures → RuntimeError kinds + RuntimeTurnError diagnoses
  src/memory.ts                tiers: pi-session-jsonl (sourceKind 'session_jsonl') + pi-durable (workspace files)
  src/usage-transform.ts       Pi session entries → agent-usage JSONL contract ({type:'message', message:{role,usage:{...,cost}}})
  src/models.ts                models.listAvailable via Pi ModelRegistry; capabilities() from model input flags
  src/config.ts                config.get/replace/raw over ~/.pi/agent/settings.json + onboarding key synthesis
  src/skills.ts                skills.* onto Pi native skill dirs (global + per-agent workspace .pi/skills)
  src/unsupported.ts           honest-empty: channels, cron, tools.invoke, images/media omissions
  src/health-checks.ts         adapter health checks (pi auth present, sessions dir writable, SDK/model probe)

plugins/chat/                  core plugin #12 (see PLAN.md Phase 1 for its own file map)

src/core/runtime-adapter-factory.ts     + case 'pi', RUNTIME_ADAPTER_SUPPORT.pi (pi.dev URLs — factory-only)
packages/core/src/settings.ts           RuntimeAdapterName = 'openclaw' | 'pi' (and src/core/settings.ts re-export)
packages/core/src/adapters/shared.ts    AdapterInitOpts.execTools?: RuntimeExecToolProvider (adapter-neutral seam)
src/core/app-services.ts                wire exec-tool registry provider into initialize()
src/core/dispatch-prompts.ts            adapter-aware tool-access section (native tools vs mcporter CLI)
src/core/onboarding/*                   per-adapter component gating + pi-integration component
tests/architecture/adapter-boundary.test.ts  ban ~/.pi|PI_HOME|getPiHome upstream; adapter-pi import factory-only; pi.dev factory-only
tests/adapter-pi/**                     unit + integration (fake provider) suites
dev/fake-pi-provider/ (or tests/integration/pi/harness/)  canned OpenAI-compatible local HTTP provider
```

File-size discipline: no adapter module over ~400 lines; `runtime.ts` stays a thin composition root (OpenClaw's 78KB `runtime.ts` is the anti-pattern this layout exists to avoid).

## Code Style

Repo conventions apply unchanged (CLAUDE.md): strict TS, kebab-case files, `createLogger('adapter-pi')`, no empty catches, `const` over `let`, import order (node → external → SDK → `@/*` → relative). Example of the required error-mapping style:

```typescript
// packages/adapter-pi/src/errors.ts
import { RuntimeError } from '@bakin/core/adapters/runtime'

export function toRuntimeError(err: unknown, ctx: PiErrorContext): RuntimeError {
  if (ctx.signal?.aborted) return new RuntimeError('aborted', 'turn aborted', { cause: err })
  if (isRateLimit(err)) return new RuntimeError('provider_cooldown', describe(err), { cause: err })
  // ... every Pi/SDK failure shape lands on exactly one kind; core NEVER sees message-text classification
  return new RuntimeError('runtime_failed', describe(err), { cause: err })
}
```

## Testing Strategy

Three layers (D5), all following the repo's mandatory isolation rules (temp `BAKIN_HOME`/`PI_HOME`, both content-dir mocks, logger/watcher mocks, `--isolate`):

1. **Unit** (`tests/adapter-pi/*.test.ts`) — per module against temp `PI_HOME`; SDK mocked at module boundary only where a real session isn't needed (registry, home, usage-transform, errors, config).
2. **Integration** (`tests/integration/pi/*.test.ts`) — REAL Pi SDK sessions against the **fake provider**: an in-test Bun HTTP server speaking OpenAI-completions with canned streamed responses (incl. tool-call responses to exercise the tool bridge). Zero tokens, deterministic. Covers: full send/stream turn, abort, tool-bridge round trip, session persistence, usage rows landing in the transform shape, dispatch path end-to-end via the contract.
3. **Live smoke** (manual, this box) — `/verify`-style isolated server + real openai-codex: one task dispatch, one chat, usage scan; then the real flip (D6).

Contract conformance: run the existing mock-runtime contract expectations against `PiRuntimeAdapter` where applicable (`tests/dev/mock-runtime-contract.test.ts` as the template). Architecture tests extended for Pi identifiers are part of the suite, not optional.

## Boundaries

- **Always:** keep every Pi identifier/path/SDK import inside `packages/adapter-pi/` (factory excepted); map all failures to typed `RuntimeError` kinds; honest degradation (empty lists + typed unsupported, never silent fallbacks or fabricated data); temp-dir isolation in every test; update `.claude/knowledge/` + README + CLAUDE.md in the same PR as the change; conventional commits per the checkpoint strategy in PLAN.md.
- **Ask first:** any new production dependency beyond the pinned Pi SDK; any change to the `AgentRuntimeAdapter` contract beyond the `execTools` init seam + optional tool-access descriptor; touching OpenClaw adapter behavior; expanding chat MVP scope; running destructive operations on the real `~/.bakin` or `~/.pi` before the final flip step.
- **Never:** backwards-compat shims or migration code (D-standing); channel/cron/image fabrication; core classifying errors by message text; test writes to real `~/.bakin`/`~/.openclaw`/`~/.pi`; committing `generated-version.ts` after builds; a second stat-tracking system (usage flows through the existing memory-tier scan only).

## Success Criteria

1. `settings.runtime.adapter = 'pi'` boots the server with zero OpenClaw processes running; doctor `runtime` checks green.
2. Task dispatch fires a real Pi turn: claim → typed-error-safe send → completion recorded; abort-on-task-delete works (`kind: 'aborted'`); watchdog recovery ladder receives typed diagnoses.
3. Pi agents call `bakin_*` exec tools natively (create tasks, save assets, log progress) via the in-process tool bridge — verified in integration tests and live smoke.
4. Team page lists/creates/edits Pi agents; agent-package `bakin agents sync` projects workspace files that demonstrably enter the system prompt.
5. usage.db populates from Pi sessions (tokens + cost per model/day); health dashboard effort charts render.
6. Memory dashboard shows Pi tiers; models plugin lists Pi's catalog; context-report renders for Pi agents.
7. Chat plugin (PR-2): streamed multi-chat with any agent on BOTH runtimes; transcripts under `~/.bakin/chat/`; URL-state deep links; agent creates a task mid-chat.
8. Honest degradation verified in UI: channels empty, no crons, no image generation — no crashes, no fake data.
9. `bun run test` green including new suites; adapter-boundary test extended and green; zero LLM tokens spent by CI.
10. This box runs Bakin-on-Pi as daily driver (D6).

## Open Questions (non-blocking, resolved during build or fast-follows)

- Exact SDK API names for system-prompt append & custom-provider registration in-process (SDK types are the source of truth at build time; doc examples verified conceptually).
- Whether `bakin agents context` / `context.startup-size` measurement needs a Pi-specific section labeler (measure-path parity check during Phase 4).
- Fast-follows (explicitly out of MVP): Discord bridge for Pi (D3, reuse existing bot token), chat attachments/model-picker polish, chat transcript search indexing, in-app approval channel.
