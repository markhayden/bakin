# Spec: Pre-Launch Battle-Hardening

**Source:** 2026-07-09 architecture audit (adapter architecture, plugin SDK DX, turn-notification latency, mcporter sweep).
**Status:** COMPLETE (2026-07-11). All 34 tasks shipped across PRs #632-#644; six success criteria verified against main (suite 6511/0; live validation: streaming/abort/chips/latency confirmed by user on the production box).
**Companion:** `PLAN.md` (task breakdown + commit strategy detail) follows approval of this spec.

## Objective

Harden Bakin's two developer-facing architectures — the runtime adapter boundary and the plugin SDK — before the production launch invites external users and plugin authors. Four workstreams, in priority order:

1. **WS1 — OpenClaw push-streaming integration.** Replace the await-the-whole-turn + 200ms trajectory-poll integration with the gateway's native push events (`agent` + `chat` frames), giving OpenClaw true streaming chat, live dispatch-turn activity, and working server-side abort. This closes the perceived snappiness gap vs Pi, which the audit proved is a Bakin integration artifact, not OpenClaw process weight.
2. **WS2 — SDK launch blockers.** Fix the broken golden path (scaffold → install), ship a public testing story, tighten the type surface, and make the docs/templates truthful so an external developer can succeed without reading Bakin source.
3. **WS3 — Adapter conformance hardening.** Convert the adapter boundary's discipline-based guarantees into executable ones: a runtime conformance suite, an honest default mock, specified behavioral contracts, honest capabilities, and deletion of dead contract surface.
4. **WS4 — Cleanup sweep.** Finish the mcporter removal (dev rig), fix provider-name copy leaks, and correct knowledge-doc drift.

**User:** this machine's owner (single user) now; external plugin authors and runtime-adapter authors at launch.
**Success looks like:** an OpenClaw chat turn shows first text within provider TTFT (not full-turn duration); `bakin plugins scaffold` → `install .` → activate works verbatim; a third adapter could be built against a green conformance suite instead of reverse-engineering two adapters; `grep -ri mcporter` in live code returns nothing.

## Standing Directives (from kickoff)

- **Priority is tech-debt reduction.** No backwards compatibility, no shims, no dual code paths, no deprecation windows. Dead surface is deleted, not renamed.
- Single-user machine: breaking changes to manifests, SDK types, mocks, and settings are acceptable without migration paths (a one-time local fixup is fine).
- Every PR lands with `.claude/knowledge/*` updated in the same PR; public `docs/` and `README.md` checked for impact.
- Detailed commit strategy required (see Commit & PR Strategy below); every commit is a green-tests rollback checkpoint.

## Tech Stack

Bun ≥1.2 (runtime/bundler/tests), TypeScript strict, Zod at boundaries, React 19 + TanStack Router (client), SQLite via `packages/core/src/storage/db.ts` (sole `bun:sqlite` importer). OpenClaw pinned floor: **2026.6.11, gateway protocol 4** (WS1 asserts this at connect). No new external dependencies expected; adding one is an ask-first.

## Workstream Requirements

### WS1 — OpenClaw push-streaming (2 PRs)

**Protocol facts** (verified against installed `openclaw@2026.6.11` dist — see Appendix A; these are load-bearing and not otherwise documented in-repo):

- The gateway pushes `{type:'event', event, payload, seq}` frames over the existing WS. `agent` events (`stream ∈ lifecycle|tool|assistant|thinking|error|item|…`, keyed by `runId`, per-run monotonic `seq`) and `chat` events (`state ∈ delta|final|aborted|error`, `deltaText` + full cumulative text, 150ms server-side coalescing) are broadcast to operator-scoped clients — Bakin's existing connect qualifies except for `tool`-stream events, which require `caps: ["tool-events"]` in the connect params.
- The `agent` RPC answers twice on one request id: an `accepted` ack carrying `{runId, sessionKey}` (currently swallowed at `gateway-rpc.ts:319`), then the final.
- `chat.abort {sessionKey, runId}` aborts backend runs server-side when given the ack's exact ids from the owning connection. The contrary comment at `runtime.ts:1546` is wrong for this dist and dies in this PR.

**PR 1a — gateway event plumbing + streaming chat + abort:**
- R1. `gateway-rpc.ts` connect params gain `caps: ["tool-events"]`; connect asserts gateway protocol ≥ 4 and fails with an actionable "upgrade OpenClaw" error below it.
- R2. The `accepted` ack is surfaced to callers (runId + sessionKey), not swallowed; `messaging.stream` emits an immediate `status: 'thinking'` chunk from it.
- R3. `messaging.stream` yields real deltas: subscribe to `agent` (assistant/thinking text, tool phases, lifecycle) and `chat` (delta/final/aborted/error) frames filtered by the accepted `runId`. Handle per-run `seq` gaps (server injects a synthetic error event) and the `dropIfSlow` delta semantics by reconciling against the cumulative text carried on `chat` deltas.
- R4. Abort uses `chat.abort {sessionKey, runId}` from the ack, expects `{aborted: true}` + the terminal `aborted` frames; task-delete abort actually stops the server-side run.
- R5. The streaming behavioral contract is written into the runtime contract's doc comments (`concepts.ts`): chunk granularity may vary by adapter; `done` exactly once; tool/status chunks best-effort; terminal errors surface as an `error` chunk AND a typed rejection — one specified behavior both adapters implement.
- R5b. **Chunk taxonomy is the turn-output normalization contract** (see Turn Output Formatting below): `ChatChunk` is enriched with a content-format hint on text chunks (`markdown` default; `plain`/`code`) and structured tool fields (name, args summary, output preview, duration, exit code — already mostly present on `RuntimeToolActivity`, now mandatory-where-known). Adapters emit classified, structured chunks only — never pre-rendered HTML/ANSI/raw-JSON junk; stripping runtime-specific noise is the adapter's job.
- R6. Imitation Crab emulates the ack + `agent`/`chat` event frames so the full streaming path is CI-testable without Docker.

**PR 1b — dispatch liveness + activity-tail deletion:**
- R7. Dispatch turn monitoring consumes the same event subscription: running tasks surface live tool/status activity (board + team timeline) keyed by the dispatch run's `runId`.
- R8. `session-activity.ts`'s live polling tail and the `mergeChatStreams` merge are **deleted**. Trajectory-file machinery survives only for forensics: death detection, post-mortem diagnosis, lost-frame recovery.
- R9. Filtering is strict: broadcast frames for heartbeats (`isHeartbeat`), channel chats, and other runs are ignored by `runId` keying, and heartbeats never appear as activity.

**Out of scope for WS1:** `sessions.subscribe` fleet-wide events for the health dashboard (post-launch follow-up).

### WS2 — SDK launch blockers (2 PRs)

**PR 2a — golden path:**
- R10. **One plugin layout.** The manifest `entry` field is deleted from the schema, docs, and scaffold. Canonical layout: `index.ts` + `client.tsx` at plugin root (what all 13 core plugins and `docs/snippets/plugin-basic/` already use). `buildUserPlugin`/whiskit keep their root-path expectation, now truthful.
- R11. Scaffold emits the root layout with: correct registration comments (`routes:`, `ctx.hooks.register` — not the nonexistent `pages:`/`registerHook`), a `tsconfig.json`, a `contributes` example, a permission example, a working test, and a real SDK version (never `^0.0.0-dev`).
- R12. An integration test drives scaffold → install → activate; the `build.md` tutorial is corrected (root layout; exec tool renamed to satisfy the enforced `bakin_exec_<id>_` rule + declared in `contributes.execTools`).
- R13. Host/SDK compatibility: the manifest's `bakin` semver range is enforced at install and at activation with an actionable error, surfaced in `bakin plugins list`.
- R14. Declare-twice becomes symmetric + assisted: declarative routes are validated against `contributes.apiRoutes` exactly like legacy routes were, and `bakin plugins sync-manifest` regenerates `contributes` by loading the plugin in a sandbox — authors never hand-mirror.
- R15. The dead `bakin plugins test` doc reference and the manifest `tests` field are deleted.

**PR 2b — testing SDK + types + reference plugin:**
- R16. `@makinbakin/sdk/testing` ships `createTestContext`/`activatePlugin`/`callRoute`/`callTool` + the mock runtime + temp content-dir isolation, `bun:test`-native (no `vi` global). In-repo `tests/plugins/test-helpers.ts` becomes a consumer of it (one source of truth).
- R17. Type tightening, breaking freely: `BakinPlugin` gains `routes` (kills the `as unknown as BakinPlugin` cast); `definePlugin` input is closed to known keys; exec-tool handlers infer params from their Zod shape; the legacy `ctx.registerRoute` API and legacy `APIRoute` type are **deleted** (zero core-plugin users); always-present context members (`ctx.log`, storage methods) become non-optional.
- R18. Registration collision semantics are uniform: duplicates throw, everywhere (routes, tools, skills, workflows, node types, notification channels).
- R19. Root SDK barrel is author-only; host-side plumbing moves to `@makinbakin/sdk/internal`.
- R20. `pluginFetch(pluginId, path, init?)` client helper removes hand-built `/api/plugins/<id>/…` strings.
- R21. **Reference plugin, both homes:** `examples/reference-plugin/` in-tree, written ONLY against `@makinbakin/sdk/*`, exercising routes + exec tool + settings + search + health check + SSE events + storage, installed + activated by a CI integration test; mirrored to a standalone starter repo (`markhayden/bakin-plugin-starter`) by a release-pipeline step.
- R22. Public docs additions: the SSE pattern (`ctx.events.emit` ↔ `usePluginEvent`), storage scoping (user plugins are jailed to `plugin-data/<id>/`), a public port of the search-plugin guide, the invocable-hook catalog, and the full settings field types.
- R22b. **`TurnOutputView` SDK component** — the single client-side renderer for normalized turn chunks (R5b), wrapping today's behaviors (MarkdownContent for markdown text, mono block for plain/code, tool chip for tool activity). Chat (`chat-view.tsx`) and the tasks step-output viewer migrate to it; no visual redesign in this initiative. Team's raw transcript dumps and all beautification are explicitly deferred.

### WS3 — Adapter conformance hardening (1 PR)

- R23. **Runtime conformance suite** (pattern: `tests/integration/search-conformance/`): one parameterized suite run against OpenClaw (Imitation Crab), Pi (fake-provider harness), and the dev mock. v1 pins: send/stream semantics per R5, abort → `kind: 'aborted'`, typed-error taxonomy on the messaging path, `MessageResult.metadata.sessionId` presence, provisioning idempotency, capability honesty (declared mode ⇒ working surface), ping/restart semantics per R26. The suite is the acceptance gate for any future adapter.
- R24. `createMockRuntimeAdapter` defaults to the minimal shape — `channels`/`cron` **absent** — with explicit opt-in; plugin tests that bare-deref optional members now fail. Existing tests are fixed to opt in where they legitimately need those surfaces.
- R25. **OpenClaw sessions get implemented** (`sessions.list`/`get` read the real session store) so the declared `native` mode is honest and session browsing/memory tiers/diagnostics work identically on both runtimes.
- R26. Contract semantics written + enforced: `ping()` = "can serve a turn, cheaply probed" (Pi's becomes a real auth/registry probe, not `initOpts !== null`); `restart()` = "re-read all durable config"; `toolsAllow`/`toolsDeny` are unified to Bakin-exec-tool scope on both adapters (native tool policy stays adapter-private via `toolsMode`); `oversizedOutputBytes` is promoted from the metadata bag to a typed optional `MessageArgs` field.
- R27. Dead surface deleted: `updatePermissions`, `tools.invoke`. `updateAllowlist` is renamed/documented as the subagent-dispatch allowlist.
- R28. `RuntimeError` extends to the agents/skills/cron CRUD surfaces (add a `not_found` kind); the architecture test gains a ban on error-message string matching upstream of adapters.
- R29. Provider leaks fixed: UI/health copy derives runtime names from `runtime.name`; session-store remediation strings move into adapter-provided health checks; the `media://` scheme gets a constant behind the media surface; `turn-parser.ts`'s hardcoded `${sessionId}.jsonl` convention moves behind the adapter.

### WS4 — Cleanup sweep (1 PR)

- R30. Dockerized rig migrates off mcporter to the production `provisionToolAccess` native-MCP path; `mcporter` leaves the Docker image; `scripts/instance/mcporter.ts` + its test are deleted.
- R31. Imitation Crab's `pixel` workspace fixture switches to native-MCP invocation examples; the two mcporter-era comments (`runtime-switch.ts:262`, `tool-access-provisioning.ts:29`) are reworded.
- R32. Knowledge-doc drift fixed: `plugin-system.md` manifest shape / `PluginToolContext` fields / `PermissionSchema` / `SettingsField`; the SDK docstring still promising a boot reconcile for file-backed search; hit-renderer `meta` field; one primary dev-loop verb in docs (`bakin plugins link`).

## Turn Output Formatting (forward architecture)

Turn feedback is currently formatted ad hoc per surface (chat → `MarkdownContent`; step-output viewer → per-string markdown-vs-raw heuristics; team agent detail → raw `whitespace-pre-wrap font-mono` dumps; tool `outputPreview` → unclassified strings). The standing architecture rule this initiative establishes, so the future chat-beautification pass is a restyle rather than a refactor:

- **Two seams, no third.** (1) Server: adapters normalize runtime output into the classified chunk taxonomy (R5b) — per-runtime formatting differences are absorbed here, invisibly to the UI. (2) Client: `TurnOutputView` (R22b) is the ONE component that turns chunks into pixels — per-chunk-kind and per-turn-type presentation policy lives behind it.
- **New rule for all future turn-output surfaces:** consume normalized chunks through `TurnOutputView`; never hand-roll raw dumps or per-surface format heuristics. Recorded in `.claude/knowledge/` (chat-plugin + adapter-architecture docs) as part of WS1/WS2b.
- **Deferred deliberately:** visual redesign, per-runtime/persona styling, a formatter registry with plugin extensibility — build these inside the two seams when beautification has real requirements.

## Commands

```
Full test suite:      bun run test                  (never bare `bun test` — preload required)
Single file:          bun test tests/path/foo.test.ts --isolate
Typecheck:            bun run typecheck
Build (all):          bun run build                 (never commit generated-version.ts afterwards)
Dev loop:             bun run dev                   (bun run dev:mock for Imitation Crab)
Dockerized OpenClaw:  bun run instance up | instance dev
Isolated e2e server:  /verify skill (throwaway BAKIN_HOME; do NOT set OPENCLAW_HOME for it)
Runtime switch:       bakin runtime use <adapter>   (server restart required after)
```

## Project Structure (touched areas)

```
packages/adapter-openclaw/src/     WS1: gateway-rpc, runtime, session-activity(-), trajectory-forensics; WS3: sessions
packages/adapter-pi/src/           WS3: ping, toolsAllow scope
packages/core/src/adapters/        WS3: contract doc comments (concepts.ts), testing.ts mock default, shared.ts
packages/sdk/src/                  WS2: types, testing entry (new), internal entry (new), register, barrels
packages/host/src/plugin-host/     WS2: user-plugin-builder (entry-field removal)
src/core/                          WS1: dispatch liveness; WS2: plugin-scaffold, plugin-registry, whiskit; WS3: tool-access, runtime factories
plugins/*/                         WS3: health-check copy, mock opt-ins; WS2: none (already declarative)
examples/reference-plugin/         WS2: new
dev/imitation-crab/                WS1: event-frame emulation; WS4: fixture
dev/docker/, scripts/instance/     WS4: mcporter removal
tests/integration/runtime-conformance/  WS3: new suite
docs/, .claude/knowledge/          every PR: same-PR updates
```

## Code Style

Repo conventions in `CLAUDE.md` govern (strict TS, Zod at boundaries, `createLogger`, kebab-case files, no empty catches, `const` over `let`). One addition for this initiative — event-frame handling follows the existing typed-taxonomy discipline:

```typescript
// Classify pushed frames by schema, never by message text (mirrors RuntimeError.kind rule)
const frame = AgentEventFrameSchema.safeParse(raw)
if (!frame.success) return          // unknown frames are ignored, never crash the stream
if (frame.data.payload.runId !== runId) return   // strict per-run keying — broadcasts include other runs
```

## Testing Strategy

- Framework: `bun:test` via `bun run test`; every test file mocks BOTH content-dir resolvers + OpenClaw home per CLAUDE.md (the mock-checker hook enforces).
- WS1: unit tests on frame parsing/merging; Imitation Crab-backed integration tests for stream/abort end-to-end; byte fixtures (`tests/fixtures/dispatch-prompts/`) re-pinned if prompt bytes move.
- WS2: scaffold→install→activate integration test; reference plugin installed+activated in CI; `@makinbakin/sdk/testing` self-tested by porting `tests/plugins/` suites onto it; npm build keeps `assertNoForbiddenImports`.
- WS3: the conformance suite IS the deliverable — three adapters green; arch-test additions (string-matching ban) with intentional-violation fixtures.
- WS4: rig smoke (`bun run instance up` reaches exec tools over native MCP).
- Live validation: **the production box flips back to OpenClaw via `switchRuntime` at WS1 validation and stays there** (streaming gets real-world soak; the Pi-worktree daily-driver setup ends). Rollback: the switch's settings backup + the Pi worktree remains intact until the initiative closes.

## Commit & PR Strategy

Six PRs, dependency-ordered; **every commit compiles and passes `bun run test`** — each is a named rollback checkpoint. Conventional commits with scope; one logical change per commit. Sketch (PLAN.md refines to task level):

| PR | Branch | Checkpoint commits (illustrative) |
|----|--------|-----------------------------------|
| 1a | `feat/openclaw-push-streaming` | `feat(adapter-openclaw): surface accepted ack` → `feat(adapter-openclaw): subscribe agent/chat frames in messaging.stream` → `feat(adapter-openclaw): abort via runId+sessionKey` → `feat(dev): imitation-crab event frames` → `docs(knowledge): session-forensics + dispatch updates` |
| 1b | `feat/dispatch-live-activity` | dispatch consumption → `refactor(adapter-openclaw): delete session-activity tail` → docs |
| 2a | `fix/sdk-golden-path` | entry-field removal → scaffold rewrite → build.md fix + integration test → semver gate → sync-manifest |
| 2b | `feat/sdk-testing-and-types` | testing entry → in-repo helpers consume it → type tightening → legacy route API deletion → reference plugin → starter-repo release step → docs |
| 3  | `feat/runtime-conformance` | suite skeleton → per-surface pins → mock default flip + test fixes → sessions impl → semantics fixes → dead-surface deletion → leak fixes |
| 4  | `chore/cleanup-sweep` | rig migration → fixture/comments → knowledge-doc drift |

Ordering: 1a → 1b; 2a → 2b; 3 after 1a (conformance pins the new stream contract); 4 anytime. 2a/2b may run in parallel with WS1 in separate worktrees. Merge via PR to `main`; work only in worktrees (never flip the main checkout); verify `HEAD` before commits; never commit `generated-version.ts`.

## Boundaries

**Always:**
- Green `bun run test` + typecheck before every commit; docs (`.claude/knowledge`, `docs/`, README) updated in the same PR as the change they describe.
- Feature-detect optional runtime members; classify by `kind`, never message text; keep provider identifiers behind adapters (arch tests enforce).
- Work in worktrees; kill any background dev instance and verify 3737 free before ending a session.

**Ask first:**
- Any new external dependency; any change to the execution ledger, budget/spend engine, or search outbox semantics (adjacent but out of scope); creating the `bakin-plugin-starter` repo + its release-pipeline step; the moment of the production runtime flip (user runs/witnesses it).

**Never:**
- Compatibility shims, deprecation aliases, or dual code paths (single-user machine, tech-debt priority).
- Write to real `~/.bakin` or `~/.openclaw` from tests; hardcode home paths; parallel spend/stat/scheduling systems.
- Blind retries on turn failures (recovery-ladder discipline stands); fabricate model or protocol metadata — protocol facts come from Appendix A or a fresh probe of the installed dist.

## Success Criteria

1. **Streaming:** on the live box (OpenClaw), a no-tool chat reply begins rendering within ~provider TTFT + ≤500ms of overhead; tool chips appear as tools fire without the trajectory poll; deleting a running task stops the run server-side (gateway confirms, tokens stop burning). `session-activity` live tail no longer exists in the codebase.
2. **Golden path:** `bakin plugins scaffold demo && cd demo && bakin plugins install .` activates cleanly, verbatim, on a fresh checkout; the tutorial's code works unmodified; CI has a test proving it.
3. **Testing SDK:** an external-style test using only `@makinbakin/sdk/testing` runs green outside `tests/plugins/` internals; in-repo plugin tests consume the same module.
4. **Conformance:** one suite, three targets green (OpenClaw-mock, Pi-fake, dev mock); a bare `ctx.runtime.channels.` deref in a plugin now fails its tests; capabilities are honest (no declared-native stub remains).
5. **Cleanup:** `grep -ri mcporter` matches only historical docs/CHANGELOG; the rig exercises native-MCP provisioning.
6. **Formatter seam:** chat and step-output render through `TurnOutputView`; text chunks carry format hints end-to-end from both adapters; no turn-output surface added in this initiative hand-rolls formatting.
7. Full suite green, arch tests extended and green, docs drift items from the audit (L1–L4, M2) closed.

## Open Questions

- OQ1. Starter-repo name/visibility (`markhayden/bakin-plugin-starter`, public?) — ask-first item when PR 2b reaches the release step.
- OQ2. **RESOLVED (2026-07-09, T1 spike — fixtures in `tests/fixtures/openclaw-gateway-frames/`): `chat` frames alone suffice for streaming text; `agent` frames are needed only for tool/lifecycle.** Evidence: every `agent` `stream:'assistant'` frame is mirrored 1:1 by a `chat` `state:'delta'` frame at the same coalescing cadence and the same seq number (`abort-turn.jsonl` lines 7–12: three delta pairs, identical text), and `chat` deltas carry BOTH `deltaText` and the full cumulative text (`message.content[0].text`), so dropped `dropIfSlow` deltas self-heal from the next frame's cumulative text without consulting `agent` assistant frames. Text sources never disagreed across all three recordings. Use `chat` for text (delta/final/aborted/error) + `agent` for lifecycle/tool/item/command_output. Spike divergences from Appendix A that R3 must absorb: (1) `runId` echoes the client-supplied `idempotencyKey`; (2) only `stream:'tool'` is caps-gated — `item`/`command_output` broadcast regardless, and a missing `tool-events` cap manifests as SILENT per-run seq gaps (no synthetic seq-gap error frame was observed); (3) after `chat.abort`, a second lifecycle emitter reuses the same `runId` with seq restarting at 1 — per-run seq is not monotonic across the abort boundary; (4) the post-abort RPC final is `status:'timeout', summary:'aborted', stopReason:'aborted'` (classify aborts by `stopReason`/local abort state, never `status`); (5) `chat.abort` from the owning backend connection DID stop the run server-side (`{ok:true, aborted:true, runIds:[…]}` + terminal `chat state:'aborted'`) — the contrary `runtime.ts:1546` comment is confirmed wrong for 2026.6.11.
- OQ3. Exact conformance-suite surface list beyond R23's v1 pins — PLAN.md finalizes after the suite skeleton exists.

## Appendix A — OpenClaw 2026.6.11 gateway protocol facts (from the 2026-07-09 dist probe)

> **Live-verified 2026-07-09** against a real gateway (T1 spike; fixtures in `tests/fixtures/openclaw-gateway-frames/`, recorder `scripts/instance/record-gateway-frames.ts`). Five corrections are recorded in the OQ2 resolution above — most importantly: `runId` echoes the client `idempotencyKey`; only `stream:'tool'` is caps-gated (`item`/`command_output` broadcast regardless); NO synthetic seq-gap error frames exist (gaps are silent); per-run seq resets across the abort boundary; the post-abort RPC final is `status:'timeout'` (classify by `stopReason`). Where this appendix and the fixtures disagree, the fixtures win.

Load-bearing identifiers verified in `/opt/homebrew/lib/node_modules/openclaw/dist/`:
- `EventFrameSchema` (`schema-JKCmgTCB.d.ts:5835`): `{type:'event', event, payload, seq}`.
- `AgentEventPayload` (`agent-events-CxC-24IA.d.ts`): `{runId, seq, stream, ts, data, sessionKey?, agentId?, spawnedBy?, isHeartbeat?}`; `stream ∈ lifecycle|tool|assistant|error|item|plan|approval|command_output|patch|compaction|thinking`; assistant/thinking `data = {text (cumulative), delta}`, coalesced 150ms/run/stream (`sendOrBufferAgentTextEvent`, `server-chat-CS2WoL4B.js:630`).
- `ChatEventSchema` (`schema-JKCmgTCB.d.ts:5935`): `state ∈ delta|final|aborted|error`, keyed `runId`+`sessionKey`+`seq`; `delta` carries `deltaText` (+ optional `replace:true`) and full cumulative text; throttled 150ms (`emitChatDelta`, `server-chat-CS2WoL4B.js:416`); delta frames are `dropIfSlow`.
- Scope gate: `EVENT_SCOPE_GUARDS = {agent:[operator.read], chat:[operator.read]}`; `mode:'backend'` irrelevant to event delivery. Bakin connects with `role:'operator'`, `scopes:['operator.read','operator.write']` (`packages/adapter-openclaw/src/runtime.ts:1739`).
- `tool`-stream events only reach the requesting connection **iff** connect params declared `caps:["tool-events"]` (`GATEWAY_CLIENT_CAPS.TOOL_EVENTS`, `client-info-CcqJJIan.js:40`; recipients `agent-CtFDOo4w.js:1633-1641`), or `sessions.subscribe` subscribers as `session.tool`.
- `agent` RPC: no streaming flag; responds twice on one id — `{runId, sessionKey, status:'accepted', acceptedAt}` (`agent-CtFDOo4w.js:1822-1846`) then the final. `agent.wait {runId, timeoutMs}` re-attaches after reconnect.
- Abort: `chat.abort {sessionKey, runId?}` (`chat-DFeIryVW.js:2024`) aborts backend runs (`chatAbortControllers`, `agent-CtFDOo4w.js:1752-1771`); auth = admin scope OR requester connId/deviceId matches run owner; sessionKey must be the canonical stored key — use the ack's values.
- Seq gaps: server injects synthetic `stream:'error', data.reason:'seq gap'`. Slow consumers: droppable frames dropped; non-droppable backpressure can close the socket `1008 slow consumer`.
- `PROTOCOL_VERSION = 4` (`version-51ymduTn.js`); latest published stable is 2026.6.11; 2026.7.1-beta.1/2 contain no gateway streaming changes.
