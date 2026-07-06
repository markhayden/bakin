# Implementation Plan: Pi Runtime Adapter + Chat Core Plugin

Companion to [SPEC.md](./SPEC.md) (objective, decisions D1–D7, boundaries, success criteria).
Three PRs: **PR-1** this plan (docs only) → **PR-2** Chat plugin (`feat/chat-plugin`) → **PR-3** the adapter mega PR (`feat/adapter-pi`). PR-2 and PR-3 are built in worktrees; main stays clean until each is proven.

## Overview

Implement `packages/adapter-pi` — a full `AgentRuntimeAdapter` driving Pi in-process via `@earendil-works/pi-coding-agent` — plus the minimal core seams Pi needs that OpenClaw got out-of-band (exec-tool delivery, tool-usage prompt text), plus a runtime-agnostic Chat plugin as the conversational surface replacing channels for MVP. Everything Pi-specific stays behind the factory; upstream consumes capabilities only.

## Research Facts the Plan Stands On (verified 2026-07-05)

1. **Pi SDK runs under Bun on this box** — real auth found 4 openai-codex models; in-memory `createAgentSession()` works. (Scratchpad smoke test.)
2. **Contract inventory** — `packages/core/src/adapters/runtime/concepts.ts:578-711`; `createMockRuntimeAdapter` (`testing.ts`) is the exhaustive method checklist. Optional members (`workspaceFileStats?`, `storeStats?`, `createThread?`, `editMessage?`, `capabilities?`, `images?`, `media?`) may be omitted → callers skip.
3. **No tool seam exists today.** OpenClaw agents reach `bakin_*` tools out-of-band: Bakin's HTTP MCP server (`src/core/mcp-server.ts`, `/mcp?agent=<name>`) injected via `syncOpenClawMcpConfig()` + mcporter CLI config. `AdapterInitOpts` is only `{ contentDir, settings?, logger?, audit? }` — the seam must be added (Phase 2).
4. **Dispatch prompt bakes in mcporter syntax.** `src/core/dispatch-prompts.ts` renders `mcporter call bakin-<agent>.<tool>` strings and OUTPUT DISCIPLINE references `bakin_exec_*` names. Needs an adapter-aware tool-access section; byte fixtures at `tests/fixtures/dispatch-prompts/` will change (Phase 2).
5. **Usage scan contract**: a memory tier with `metadata.sourceKind === 'session_jsonl'`; entries must be JSONL with `{type:'session', id, timestamp}` and `{type:'message', timestamp, message:{role:'assistant', model, usage:{input, output, cacheRead, cacheWrite, totalTokens, cost:{input, output, cacheRead, cacheWrite, total}}}}` (`src/core/agent-usage.ts:24,67,224`). Pi records per-message usage+cost natively → pure transform, no core change.
6. **`tools.invoke` has zero production callers** (plugin facade throws by design) → minimal honest implementation.
7. **Browser streaming pattern** = global SSE bus (`broadcast()` → `/api/events` → `useSSE`), NOT per-request streams. Chat follows it.
8. **Core plugin #12 checklist**: `plugins/chat/` + `src/lib/core-plugin-ids.ts` + `src/lib/plugin-static-imports.ts` must agree (enforced by `tests/architecture/core-plugin-ids.test.ts`); embedded-assets tests cover dist allowlisting.
9. **Onboarding**: `runtime`/`llm`/`channels` components are adapter-generic but read OpenClaw-shaped raw-config keys (`agents.<main>.authProfiles`, `channels`); `mcporter` + `openclaw-integration` components are OpenClaw-only → per-adapter gating needed (Phase 5).
10. **`RuntimeAgent`** = `{id, name, role?, model?, status?, metadata?}`; onboarding integrity requires an agent resolving as `main` with a workspace under `metadata.workspace`.
11. **Pi custom providers are HTTP endpoints** (OpenAI-compatible) → the fake test provider is a tiny in-test Bun server; no Imitation-Crab-scale mock needed.

## Architecture Decisions

- **AD1 — Exec-tool seam is contract-level, adapter-neutral.** `AdapterInitOpts.execTools?: RuntimeExecToolProvider` = `{ list(): ExecToolDescriptor[]; invoke(name, params, agentId): Promise<ExecToolResult> }` (types in `packages/core`; `ExecToolDefinition` already lives in `packages/core/src/plugin-types.ts`). `src/core/app-services.ts` passes a provider backed by `getAllExecTools()`. OpenClaw ignores it (keeps MCP); Pi wraps each tool via `defineTool()` per session. Rationale: no HTTP hop for an in-process runtime; the MCP server remains for OpenClaw unchanged; plugin-registered exec tools (incl. hot-reloaded ones) appear because the provider reads the live registry at session build time.
- **AD2 — Tool-access prompt text comes from the adapter.** Optional contract member `describeToolAccess?(agentId): Promise<RuntimeToolAccessHint | null>` (a short structured descriptor: invocation style + example call). `dispatch-prompts.ts` renders the mcporter text when absent/OpenClaw, native-tool text for Pi. Measurement path == production path (context-report uses the same renderer). Byte fixtures updated once, deliberately.
- **AD3 — One Pi session per Bakin threadId.** `threadId` (`task:<id>:d<seq>`, `chat:<uuid>`) maps deterministically to a session file under the agent's session dir (`~/.pi/agent/agents/<id>/sessions/`). Sessions open lazily, dispose after the turn settles; disk persistence gives resume-for-free. Concurrency is bounded upstream by `dispatch.maxConcurrentTurns` — the adapter adds no second limiter.
- **AD4 — Registry is a single zod-validated JSON file** (`~/.pi/agent/bakin-agents.json`) + per-agent dirs. Writes are atomic (tmp+rename) and serialized through one writer, mirroring the assets-manifest pattern. First `initialize()` seeds `main` (orchestrator) if the registry is empty — satisfies onboarding integrity with zero manual steps.
- **AD5 — Workspace fidelity**: session cwd = agent workspace dir (Pi auto-loads `AGENTS.md`); SOUL/IDENTITY/TOOLS/etc. append to the system prompt in a stable labeled order (`system-prompt.ts`). `workspaceFileStats` reports exactly the files that entered context (names+sizes only, #357 discipline).
- **AD6 — Honest-empty surfaces** live in one module (`unsupported.ts`): channels (empty list; typed `runtime_failed`-family unsupported errors on send/approval), cron (empty lists; typed errors on mutation), `tools.invoke` (typed unsupported), `images`/`media`/`createThread`/`editMessage` omitted entirely.
- **AD7 — Chat persistence is Bakin-owned UI data** at `~/.bakin/chat/<chatId>.jsonl` + `index.json` (runtime session remains the provider-side source of truth; the plugin persists the chunks it streamed — no re-reading provider files, no boundary crossing).

## Dependency Graph

```
PR-1 plan docs
PR-2 chat plugin (OpenClaw, adapter-agnostic)          — independent of PR-3, lands first
PR-3 mega PR:
  Phase 2 core seams (settings enum, factory, execTools seam, prompt seam, boundary tests)
      └── Phase 3 adapter foundation (home, registry, agents, main seeding, config, models, skills)
              └── Phase 4 the turn path (sessions, tool-bridge, system-prompt, messaging, errors)
                      └── Phase 5 observability + degradation (memory/usage, health, onboarding gating, unsupported)
                              └── Phase 6 integration harness + e2e + docs
                                      └── Phase 7 live validation + box flip
```

High-risk work sits earliest inside each phase (registry atomicity, event→ChatChunk mapping, usage transform).

---

## PR-2 — Chat Core Plugin (`feat/chat-plugin`)

Vertical slices; each leaves main green. Built and verified against OpenClaw on this box.

### Task C1: Plugin skeleton + registration triple
**Description:** `plugins/chat/` scaffold (manifest, `index.ts` activate, `client.tsx` registerPlugin with nav item, `types.ts`) wired into `core-plugin-ids.ts` + `plugin-static-imports.ts`.
**Acceptance:** server boots with plugin active; `/chat` nav item renders an empty page; `tests/architecture/core-plugin-ids.test.ts` green.
**Verify:** `bun run test tests/architecture/ --isolate`; manual `bun run dev` nav check.
**Files:** `plugins/chat/{bakin-plugin.json,package.json,index.ts,client.tsx,types.ts}`, `src/lib/core-plugin-ids.ts`, `src/lib/plugin-static-imports.ts`. **Size:** M.

### Task C2: Chat store + REST surface
**Description:** `~/.bakin/chat/` store (zod `index.json` + per-chat JSONL, atomic writes) and routes: list/create/get/delete chats, list messages. `getBakinPaths()` gains `chat` (update every `getBakinPaths` mock the tests touch).
**Acceptance:** CRUD round-trips via `callRoute` tests in temp dirs; no real-home writes.
**Verify:** `bun test tests/plugins/chat/store.test.ts --isolate`.
**Files:** `plugins/chat/lib/{store.ts,routes.ts}`, `packages/core/src/content-dir.ts`, tests. **Size:** M.

### Task C3: Send + stream slice (the core of the feature)
**Description:** `POST .../chats/:id/messages` → append user message → `runtime.messaging.stream({agentId, content, threadId: chat:<id>})` → persist chunks → `broadcast({type:'chat.chunk', chatId, chunk})` per chunk + `chat.done`/`chat.error`. Typed-error mapping to an honest error row. One in-flight turn per chat (409 otherwise).
**Acceptance:** with a mocked runtime stream, chunks land in store + SSE broadcast mock in order; error path persists an error row; concurrent send rejected.
**Verify:** `bun test tests/plugins/chat/stream.test.ts --isolate`.
**Files:** `plugins/chat/lib/{send.ts,stream-bridge.ts}`, routes. **Size:** M.

### Task C4: Chat UI
**Description:** ChatList (per-agent filter via `FacetFilter`, new-chat with agent picker), ChatView (message list, streamed text via `useSSE` on `chat.chunk`, tool-activity chips, error rows), Composer. URL state: `?chat=<id>&agent=<id>` via `useQueryState`; `<Suspense>` wrapping; SDK components only.
**Acceptance:** full flow in dev against OpenClaw: create chat → streamed reply renders live → resume after reload from history; deep link opens the same chat.
**Verify:** manual dev-loop session + component test for reducer/assembly logic.
**Files:** `plugins/chat/components/{chat-list.tsx,chat-view.tsx,composer.tsx,use-chat-stream.ts}`, `client.tsx`. **Size:** L (UI-only; split render vs stream-hook commits).

### Task C5: Docs + polish checkpoint
**Description:** `.claude/knowledge/chat-plugin.md`; CLAUDE.md + README plugin count 11→12 and blurb; bump manifest version; `bun run test` full pass.
**Acceptance:** docs accurate; suite green; PR opened referencing SPEC D4.
**Files:** knowledge doc, CLAUDE.md, README.md. **Size:** S.

**Checkpoint PR-2:** live OpenClaw chat demo on this box (agent creates a task mid-chat via its existing MCP tools) → merge.

---

## PR-3 — Adapter Mega PR (`feat/adapter-pi`)

### Phase 2: Core seams (everything upstream of the package)

### Task P1: Runtime name + factory plumbing
**Description:** `RuntimeAdapterName = 'openclaw' | 'pi'` (both settings.ts); factory `case 'pi'` → `createPiRuntimeAdapter()` (package stub exporting a not-yet-functional adapter is acceptable at this commit); `RUNTIME_ADAPTER_SUPPORT.pi` (pi.dev URLs).
**Acceptance:** typecheck green (Record forces the support entry); `createRuntimeAdapter('pi')` returns the stub; default stays `'openclaw'`.
**Verify:** `bun run test tests/core/ tests/architecture/ --isolate` targeted.
**Files:** `packages/core/src/settings.ts`, `src/core/settings.ts`, `src/core/runtime-adapter-factory.ts`, `packages/adapter-pi/{package.json,src/index.ts}` stub. **Size:** S.

### Task P2: Boundary hardening for Pi
**Description:** extend `tests/architecture/adapter-boundary.test.ts` DENYLIST: `@bakin/adapter-pi` import factory-only; `~/.pi`, `PI_HOME`, `getPiHome`, `getPiPath`, `@earendil-works` banned upstream; `pi.dev` URL factory-only. Mirror in ESLint rule + `.claude/hooks/check-adapter-boundary.mjs` if pattern-based.
**Acceptance:** a deliberate violation fixture fails; clean tree passes.
**Verify:** boundary test run.
**Files:** the arch test, eslint config, hook. **Size:** S.

### Task P3: Exec-tool seam (AD1)
**Description:** add `RuntimeExecToolProvider` types to `packages/core`; extend `AdapterInitOpts`; `app-services.ts` supplies the live-registry provider at `initialize()`. OpenClaw adapter: accept & ignore.
**Acceptance:** contract types compile; mock adapter + OpenClaw unaffected (full suite green); provider reflects late plugin registrations (test with a fake registry).
**Verify:** `bun run test` (this touches the contract — run everything).
**Files:** `packages/core/src/adapters/shared.ts`, `packages/core/src/plugin-types.ts` (re-exported descriptor), `src/core/app-services.ts`, test. **Size:** M.

### Task P4: Adapter-aware tool-access prompt seam (AD2)
**Description:** optional `describeToolAccess?` on the contract; OpenClaw returns the mcporter descriptor (moving the hardcoded text's *transport* half behind the adapter); `dispatch-prompts.ts` + context-report render from it; regenerate byte fixtures once.
**Acceptance:** OpenClaw prompt bytes identical in content (fixture diff reviewed deliberately); measurement==production asserted by existing budget test.
**Verify:** `bun test tests/fixtures/dispatch-prompts/ tests/core/dispatch*.test.ts --isolate` + full suite.
**Files:** `concepts.ts`, `adapter-openclaw/src/runtime.ts` (+ small module), `src/core/dispatch-prompts.ts`, `src/core/context-report.ts`, fixtures. **Size:** M.

**Checkpoint α (commit 4):** suite green, OpenClaw behavior provably unchanged — the revert-line if the seams are wrong.

### Phase 3: Adapter foundation

### Task P5: home + registry + agents vertical
**Description:** `home.ts` (PI_HOME→`~/.pi`), `registry.ts` (zod file, atomic serialized writes, dir scaffolding `agents/<id>/{workspace,sessions}/`), `agents.ts` (list/get/create/update/remove, workspace file CRUD, `workspaceFileStats`, permissions/allowlist as recorded no-ops in registry metadata), `main-agent.ts` seeding on first `initialize()`.
**Acceptance:** full agents.* CRUD under temp PI_HOME; `selectRuntimeMainAgent` resolves seeded `main`; remove deletes dirs; stats report names+sizes only.
**Verify:** `bun test tests/adapter-pi/{registry,agents}.test.ts --isolate`.
**Files:** 4 adapter modules + 2 test files. **Size:** M.

### Task P6: config + models + skills vertical
**Description:** `config.ts` (get/replace/raw over `~/.pi/agent/settings.json`; synthesize onboarding keys: `agents.<id>.authProfiles` from `~/.pi/agent/auth.json` presence (never secrets), `channels` → `{}`), `models.ts` (ModelRegistry → `RuntimeAvailableModel[]`; `capabilities()` from model `input` flags), `skills.ts` (global `~/.pi/agent/skills/` + per-agent `<workspace>/.pi/skills/`).
**Acceptance:** raw-config gate reads work for the three allowlisted onboarding reasons; models map id/context/images correctly from a fixture registry; skills CRUD round-trips both scopes.
**Verify:** module tests.
**Files:** 3 modules + tests. **Size:** M.

**Checkpoint β (commit 6):** adapter passes a first slice of mock-contract conformance (identity + config + models), no messaging yet.

### Phase 4: The turn path (highest risk — do first inside phase: event mapping)

### Task P7: sessions + errors
**Description:** `sessions.ts` (threadId→session file mapping, lazy AgentSession pool with settle-then-dispose, `sessions.list/get` + `storeStats` from session dirs), `errors.ts` (full taxonomy: aborted/provider_cooldown/timeout/transport/session_death/runtime_failed + `RuntimeTurnError` diagnosis construction for mid-turn deaths).
**Acceptance:** same threadId reuses one session file across turns; distinct threadIds isolate; every fabricated SDK failure shape maps to exactly one kind (table-driven test).
**Verify:** module tests.
**Files:** 2 modules + tests. **Size:** M.

### Task P8: tool bridge + system prompt
**Description:** `tool-bridge.ts` (ExecToolDescriptor → `defineTool()`; zod shape → Pi Type schema; bind agentId; ExecToolResult → tool output; errors → tool-error not turn-death), `system-prompt.ts` (canonical workspace files → labeled sections, stable order, byte-measurable).
**Acceptance:** a fake exec tool invoked by a scripted session round-trips params/results; schema conversion covers the shapes used by real exec tools (string/number/bool/enum/array/object/optional); prompt assembly deterministic.
**Verify:** module tests (SDK session with fake provider optional here; unit-level acceptable).
**Files:** 2 modules + tests. **Size:** M.

### Task P9: messaging.send/stream — the adapter's heart
**Description:** `messaging.ts`: assemble session (agent workspace cwd, system prompt, tools, model/thinking overrides) → `prompt()` → event subscription mapped to `ChatChunk`s (`text`/`tool`/`status`/`done`/`error`), `send()` aggregates final text + `MessageUsage` (from Pi per-message usage) + `metadata.sessionId`; AbortSignal → SDK abort → `kind:'aborted'`; all failures through `errors.ts`.
**Acceptance:** against the fake provider: send returns text+usage; stream yields ordered chunks ending in `done`; abort mid-stream settles `aborted`; provider 429 → `provider_cooldown`; tool-call turn executes bridge tool and continues.
**Verify:** `bun test tests/adapter-pi/messaging.test.ts tests/integration/pi/turn.test.ts --isolate`.
**Files:** `messaging.ts`, `runtime.ts` composition root, integration harness first-use. **Size:** L → split commits: (a) fake-provider harness, (b) send, (c) stream+abort.

**Checkpoint γ (commit ~10):** a real Pi SDK turn with tools works under test. This is the go/no-go gate for the whole architecture — everything after is breadth, not risk.

### Phase 5: Observability + honest degradation

### Task P10: memory tiers + usage transform
**Description:** `memory.ts` (tiers: `pi-session-jsonl` with `sourceKind:'session_jsonl'`, `pi-durable` over workspace files; listEntries/getEntry/statEntry/readEntryRange/resolvePath/watchPaths/search-minimal), `usage-transform.ts` (Pi session entries → the exact agent-usage JSONL contract, fixture-locked).
**Acceptance:** `scanUsageHistory` against a fixture Pi session produces correct token/cost rows in a temp usage.db; memory plugin indexer enumerates tiers without error.
**Verify:** `bun test tests/adapter-pi/{memory,usage-transform}.test.ts tests/integration/pi/usage-scan.test.ts --isolate`.
**Files:** 2 modules + fixtures + tests. **Size:** M.

### Task P11: unsupported surfaces + health checks
**Description:** `unsupported.ts` (channels/cron/tools.invoke per AD6 — typed, audited once, never throwing raw), `health-checks.ts` (pi auth present, sessions dir writable, registry parses, SDK model probe), `ping()`/`restart()`/`shutdown()` semantics (restart = dispose session pool).
**Acceptance:** schedule plugin renders empty cron list without error (route test); watchdog notification path degrades to log-only; doctor shows Pi checks.
**Verify:** module tests + targeted plugin route tests.
**Files:** 2 modules + tests. **Size:** M.

### Task P12: onboarding per-adapter gating
**Description:** component applicability by adapter (`mcporter`, `openclaw-integration` → OpenClaw-only; new lightweight `pi-integration` component verifying auth/SDK and seeding `main`); `runtime`/`llm`/`channels` components work via the synthesized config keys from P6; `bakin onboard --yes` path green for `adapter='pi'`.
**Acceptance:** onboarding component tests pass for both adapter values; no OpenClaw shell-outs when `'pi'`.
**Verify:** `bun test tests/core/onboarding* --isolate`.
**Files:** `src/core/onboarding/{index.ts,mcporter.ts,openclaw-integration.ts,pi-integration.ts}` + tests. **Size:** M.

**Checkpoint δ:** full `bun run test` green with BOTH adapters exercised by suites.

### Phase 6: Integration breadth + docs

### Task P13: dispatch e2e (fake provider) + contract conformance
**Description:** integration test: isolated app services with `adapter:'pi'` → create task → dispatch loop fires → Pi turn (fake provider) → completion in ledger → usage scanned; plus mock-contract conformance suite run against PiRuntimeAdapter; plus chat-on-Pi integration (stream path through the chat plugin).
**Acceptance:** end-to-end assertions on ledger rows, task status, usage rows, chat transcript; zero network beyond localhost.
**Verify:** `bun test tests/integration/pi/ --isolate`.
**Files:** 2–3 integration tests. **Size:** M.

### Task P14: docs sweep
**Description:** new `.claude/knowledge/pi-adapter.md` (architecture, session mapping, tool bridge, degradation matrix, testing harness); update `adapter-architecture.md` (second runtime, execTools seam, describeToolAccess), `dispatch.md` (prompt seam), `usage-recording.md` (Pi source), CLAUDE.md (runtime line, adapter list), README (runtime support matrix), docs site page if `docs/src/content/docs/` covers runtimes.
**Acceptance:** every doc claim matches shipped code; docs snippet regeneration clean.
**Files:** knowledge docs, CLAUDE.md, README.md. **Size:** M.

### Phase 7: Live validation (not merge-blocking commits; results recorded in PR)

### Task P15: isolated live smoke (real codex)
Throwaway BAKIN_HOME + real `~/.pi` (PI_HOME unset — heed the OpenClaw-home-doubling lesson: no env var when targeting the real home), OpenClaw gateway **stopped**; run: onboard → create agent → dispatch real task → chat → usage scan → doctor. Record transcript in PR description.

### Task P16: the flip (D6)
Real `~/.bakin/settings.json` → `adapter:'pi'`; restart; verify success criteria 1–8 on the daily driver; keep OpenClaw stopped. Rollback = revert the settings key + restart (documented in PR).

**Checkpoint ε (merge gate):** P15+P16 evidence attached; full suite green; boundary tests green; user approves merge.

---

## Commit Strategy (rollback checkpoints)

Conventional commits, one per task, **each leaves the tree green** (`bun run test` + typecheck). Revert granularity is the task; revert-lines are the checkpoints.

```
PR-2:
  feat(chat): scaffold chat core plugin + registration          (C1)
  feat(chat): chat store + REST surface                         (C2)
  feat(chat): stream bridge — runtime.stream → store + SSE      (C3)
  feat(chat): chat UI — list, view, composer, deep links        (C4)
  docs(chat): knowledge doc + README/CLAUDE plugin count        (C5)

PR-3:
  feat(core): add 'pi' runtime adapter name + factory stub      (P1)
  test(architecture): extend adapter boundary for pi            (P2)
  feat(core): adapter-neutral exec-tool provider seam           (P3)
  feat(core,dispatch): adapter-aware tool-access prompt seam    (P4)   ← checkpoint α
  feat(adapter-pi): home, registry, agents, main seeding        (P5)
  feat(adapter-pi): config, models, skills                      (P6)   ← checkpoint β
  feat(adapter-pi): sessions + typed error taxonomy             (P7)
  feat(adapter-pi): exec-tool bridge + system prompt assembly   (P8)
  test(adapter-pi): fake OpenAI-compatible provider harness     (P9a)
  feat(adapter-pi): messaging.send                              (P9b)
  feat(adapter-pi): messaging.stream + abort                    (P9c)  ← checkpoint γ
  feat(adapter-pi): memory tiers + usage transform              (P10)
  feat(adapter-pi): honest-empty surfaces + health checks       (P11)
  feat(onboarding): per-adapter components + pi-integration     (P12)  ← checkpoint δ
  test(integration): pi dispatch/chat/usage e2e + conformance   (P13)
  docs(adapter-pi): knowledge docs + README + CLAUDE.md         (P14)
```

Mega-PR rollback ladder: revert to δ (lose onboarding gating), γ (lose observability), α (lose the adapter, keep inert seams), or drop the branch entirely — main is never poisoned because nothing merges until checkpoint ε.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pi SDK API drift vs docs (0.80.x is young) | High | Pin exact version; SDK **types** are source of truth at build time, docs advisory; P9 is the earliest deep-SDK task and sits right after foundation |
| Pi session entry shape ≠ usage contract assumptions | Med | `usage-transform.ts` is a pure fixture-locked function; fixtures captured from a REAL local Pi session during P10 |
| In-process fault blast radius (SDK bug takes down server) | Med | try/catch walls at every adapter entry; session pool disposal on `restart()`; live smoke before flip; settings-key rollback |
| Byte-fixture churn from prompt seam (P4) destabilizes dispatch tests | Med | isolate in its own commit with reviewed fixture diff; content-identical for OpenClaw is the acceptance bar |
| Tool schema conversion gaps (zod→Pi Type) | Med | conversion table test driven by the REAL registered exec-tool schemas, not synthetic ones |
| Onboarding raw-config keys leak OpenClaw shape into Pi config semantics | Low | synthesis documented in `config.ts` as onboarding-compat facade; revisit as fast-follow to neutralize the keys upstream |
| Codex auth/quota during live smoke | Low | smoke is manual + minimal (one task, one chat); all CI deterministic |
| Blocked postinstalls (protobufjs) in SDK dep tree | Low | smoke test already passed with blocks in place; document in knowledge doc |

## Out of Scope (recorded fast-follows)

Discord bridge for Pi (D3 — reuse existing bot token; raw REST+Gateway WS vs discord.js decision deferred), in-app approval channel, chat attachments/per-turn model picker/transcript search, neutralizing onboarding credential-check key shapes, Imitation-Pi-style full mock (fake provider suffices).

## Verification (plan-level)

- [x] Every task has acceptance criteria + verification command
- [x] Dependency order bottom-up; riskiest (P9) gated by γ before breadth
- [x] No task exceeds ~5 files except C4/P9, which carry explicit split-commit instructions
- [x] Checkpoints α–ε defined with revert semantics
- [ ] Human approval of this plan (PR-1 review) → build starts
