# Implementation Plan: Pre-Launch Battle-Hardening

**Spec:** `./SPEC.md` (approved 2026-07-09). Requirement ids (R1–R32, R5b, R22b) refer to it.
**Checklist:** `tasks/todo.md` mirrors task status.

## Overview

Six PRs across four workstreams. Every task is one or two conventional commits; **every commit passes `bun run test` + typecheck and is a named rollback checkpoint**. All work happens in worktrees (never flip the main checkout); PRs merge to `main` in dependency order. Execution uses `/agent-skills:build` per task and `/agent-skills:test` for coverage passes; docs (`.claude/knowledge/`, `docs/`, README) ship in the same PR as the change they describe.

## Architecture Decisions (carried from spec + one new)

- Gateway push events are the ONLY liveness source post-WS1; trajectory files are forensics-only (SPEC R8).
- Chunk taxonomy = the turn-output normalization contract; `TurnOutputView` = the one client renderer (R5b/R22b).
- **New (D-plan-1): dispatch liveness rides a typed `MessageArgs.onActivity?: (chunk: ChatChunk) => void` tap on `messaging.send`,** implemented by both adapters (OpenClaw: gateway frames; Pi: session events). Rationale: dispatch keeps its send/settle shape (no switch to `stream()`), the tap reuses the R5b chunk model, and the conformance suite can pin it. Live task activity is **ephemeral** — SSE broadcast only, never persisted (the timeline's durable spine stays ledger+audit).
- One canonical plugin layout (root `index.ts`/`client.tsx`); `manifest.entry` deleted (R10).
- PR order: 1a → [live flip] → 1b; 2a → 2b in parallel worktree; 3 after 1a **and** 2b (shares the chunk contract and the test-helper source of truth); 4 anytime.

## Dependency Graph

```
PR 1a (event plumbing + chunk taxonomy + streaming + abort + mock frames)
  ├─→ [USER: runtime flip to OpenClaw — live validation soak]
  ├─→ PR 1b (onActivity tap → dispatch liveness → delete activity tail)
  └─→ PR 3 (conformance suite pins the new contracts)  ←─ also needs PR 2b (sdk/testing)
PR 2a (golden path)  →  PR 2b (testing SDK + types + TurnOutputView + reference plugin)
PR 4 (cleanup) — independent
```

---

## Phase 1 · PR 1a — `feat/openclaw-push-streaming`

### Task 1: Gateway frame fixtures + OQ2 resolution (spike)
**Description:** Record real gateway event frames from the installed OpenClaw 2026.6.11 (dockerized rig or a throwaway gateway) for one text-only turn and one tool-using turn; land them as test fixtures. Resolve SPEC OQ2: whether `chat` frames alone carry streaming text (preferred) or `agent` assistant-stream frames must be merged.
**Acceptance:**
- [ ] Fixture JSONL of ack + event frames for both turn shapes checked in under `tests/fixtures/openclaw-gateway-frames/`
- [ ] OQ2 answered in SPEC.md (edit the Open Questions section) with the frame evidence cited
**Verify:** fixtures parse against the zod schemas written in Task 2 (retro-check); `bun run test` green.
**Dependencies:** none. **Files:** `tests/fixtures/openclaw-gateway-frames/*`, `SPEC.md`. **Size:** S.
**Commit:** `test(adapter-openclaw): gateway event-frame fixtures (OQ2 resolved)`

### Task 2: Event-frame plumbing in gateway-rpc
**Description:** Connect params gain `caps: ["tool-events"]`; assert gateway protocol ≥ 4 with an actionable failure; surface the `accepted` ack (`runId`, `sessionKey`) to callers instead of swallowing it; add zod schemas + typed `subscribe` helpers for `agent`/`chat` event frames (unknown frames ignored, never crash).
**Acceptance:**
- [ ] Ack payload reaches the `agent`-RPC caller via a typed callback/return
- [ ] Protocol < 4 → connect fails with "upgrade OpenClaw" error naming the found version
- [ ] Frame schemas validate the Task 1 fixtures
**Verify:** unit tests on ack surfacing, protocol gate, frame parsing; `bun run test`.
**Dependencies:** T1. **Files:** `packages/adapter-openclaw/src/gateway-rpc.ts`, new `gateway-frames.ts`, tests. **Size:** M.
**Commit:** `feat(adapter-openclaw): event-frame plumbing — caps, ack surfacing, protocol gate`

### Task 3: Normalized chunk taxonomy + streaming contract (R5, R5b)
**Description:** Enrich `ChatChunk` in `packages/core/src/adapters/runtime/concepts.ts`: format hint on text chunks (`'markdown' | 'plain' | 'code'`, default markdown), structured tool fields (promote `RuntimeToolActivity` usage), and write the behavioral contract into doc comments (granularity may vary; `done` exactly once; tool/status best-effort; terminal error = `error` chunk AND typed rejection). Update **Pi's** emission to comply (it's closest already) and the SDK re-export types.
**Acceptance:**
- [ ] `ChatChunk` type carries `format` on text chunks; tool chunks carry structured fields, no pre-rendered junk
- [ ] Contract doc comments cover the four R5 behaviors
- [ ] Pi integration turn test asserts classified chunks + exactly-one `done`
**Verify:** `bun test tests/integration/pi/turn.test.ts --isolate`; full suite.
**Dependencies:** none (parallel with T2). **Files:** `packages/core/src/adapters/runtime/concepts.ts`, `packages/adapter-pi/src/messaging.ts`, `packages/sdk/src/types/runtime.ts`, tests. **Size:** M.
**Commit:** `feat(core,adapter-pi): normalized turn-chunk taxonomy + streaming contract`

### Task 4: OpenClaw streamChat rewrite
**Description:** Replace the await-full-turn one-blob yield (`runtime.ts:1462-1466`) with real streaming: immediate `status:'thinking'` from the ack, `chat` deltas (per OQ2 resolution) reconciled against cumulative text (`dropIfSlow` tolerance), tool/lifecycle activity from `agent` frames, strict `runId` keying, seq-gap handling, `done` exactly once. Emit the R5b-classified chunks.
**Acceptance:**
- [ ] First chunk (`thinking`) yielded on ack receipt; text chunks stream before turn end
- [ ] Frames from other runs/heartbeats never leak into the stream
- [ ] Dropped-delta scenario recovers via cumulative text (fixture-driven test)
**Verify:** unit tests on the frame→chunk state machine using T1 fixtures; full suite.
**Dependencies:** T2, T3. **Files:** `packages/adapter-openclaw/src/runtime.ts`, new `stream-events.ts`, tests. **Size:** M.
**Commit:** `feat(adapter-openclaw): true streaming via gateway push events`

### Task 5: Server-side abort via accepted run ids
**Description:** Abort uses `chat.abort { sessionKey, runId }` from the ack (owning connection), expects `{aborted:true}` + terminal `aborted` frames; the wrong comment at `runtime.ts:1546` is deleted. Task-delete abort path verified end-to-end.
**Acceptance:**
- [ ] Abort of an in-flight turn settles the stream with the `aborted` terminal state and `kind:'aborted'` on the send path
- [ ] No fire-and-forget abort remains; result is checked and audited
**Verify:** mock-backed integration test (after T6, retro-run); unit test on abort args; full suite.
**Dependencies:** T2, T4. **Files:** `packages/adapter-openclaw/src/runtime.ts`, tests. **Size:** S.
**Commit:** `feat(adapter-openclaw): server-side abort via accepted run ids`

### Task 6: Imitation Crab event frames + streaming e2e
**Description:** `dev/imitation-crab/gateway.ts` emits accepted ack + `agent`/`chat` frames (matching Task 1 fixtures' shape, incl. coalescing + a seq-gap scenario) so CI covers streaming + abort without Docker.
**Acceptance:**
- [ ] Integration test: chat turn against the mock streams ≥2 text chunks before `done`; tool chip appears mid-turn
- [ ] Integration test: abort mid-turn ends stream with `aborted` and the mock confirms server-side stop
**Verify:** new `tests/integration/openclaw-streaming.test.ts` green; `bun run dev:mock` manual chat shows live text.
**Dependencies:** T4, T5. **Files:** `dev/imitation-crab/gateway.ts`, `harness.ts`, new integration test. **Size:** M.
**Commit:** `feat(dev): imitation-crab gateway event frames + streaming e2e`

### Task 7: WS1a docs
**Description:** Update `.claude/knowledge/{session-forensics,adapter-architecture,chat-plugin}.md`: push events as sole liveness source, chunk taxonomy as normalization contract, abort semantics, protocol-4 floor; add the Turn Output Formatting rule stub. CLAUDE.md key-patterns bullets touched where they describe the old behavior.
**Acceptance:** docs describe the shipped behavior, no references to the activity tail remain in WS1a-touched docs.
**Verify:** grep the knowledge docs for stale claims; `bun run test`.
**Dependencies:** T4–T6. **Files:** knowledge docs, `CLAUDE.md`. **Size:** S.
**Commit:** `docs(knowledge): push-streaming architecture`

### Checkpoint 1a (PR merge gate)
- [ ] Full suite + typecheck green; streaming e2e green; `dev:mock` manual chat streams
- [ ] PR `feat/openclaw-push-streaming` reviewed (`/code-review`) and merged

### 🔶 USER CHECKPOINT: Runtime flip (ask-first, user runs/witnesses)
- [ ] `bakin runtime use openclaw` on the box (settings backup is the rollback; Pi worktree stays intact until initiative close)
- [ ] Live validation: chat turn streams within ~TTFT; tool chips live; task-delete abort stops the gateway run (tokens stop)
- [ ] Box **stays on OpenClaw** (spec decision) — begin soak

---

## Phase 2 · PR 1b — `feat/dispatch-live-activity`

### Task 8: `onActivity` tap on messaging.send (D-plan-1)
**Description:** Add typed `MessageArgs.onActivity?: (chunk: ChatChunk) => void` to the contract with doc comments (best-effort, no ordering guarantee vs settle). OpenClaw feeds it from the same frame subscription as T4; Pi from its session events.
**Acceptance:**
- [ ] Both adapters invoke the tap for tool + status activity during a `send` turn
- [ ] Contract doc comment specifies best-effort semantics
**Verify:** adapter unit tests (mock frames / fake provider); full suite.
**Dependencies:** PR 1a merged. **Files:** `concepts.ts`, `adapter-openclaw/src/runtime.ts`, `adapter-pi/src/messaging.ts`, tests. **Size:** M.
**Commit:** `feat(core,adapters): turn-activity tap on messaging.send`

### Task 9: Live task activity on board + timeline
**Description:** Dispatch passes `onActivity`; chunks broadcast ephemerally over SSE (task-scoped plugin event; never persisted). Board task cards and the team timeline "live" region render the chips via existing SSE hooks.
**Acceptance:**
- [ ] A running task shows tool/status chips live in the UI (mock-backed integration test asserts the SSE frames)
- [ ] Nothing is written to task metadata/audit for these chunks; heartbeat turns emit nothing (R9)
**Verify:** integration test on SSE emission; manual `dev:mock` check; full suite.
**Dependencies:** T8. **Files:** `src/core/dispatch-turns.ts`, SSE event wiring, `plugins/tasks/components/*`, `plugins/team/components/*`. **Size:** M.
**Commit:** `feat(tasks,team): live turn activity chips`

### Task 10: Delete the trajectory activity tail
**Description:** Delete `session-activity.ts`'s live polling tail + `mergeChatStreams` (`runtime.ts:1442-1460`) and every consumer; trajectory machinery remains only in forensics (death watch, post-mortem, lost-frame recovery). Confirm forensics still has what it needs without the tail's shared code (extract shared readers into `trajectory-forensics.ts` if any).
**Acceptance:**
- [ ] `OPENCLAW_SESSION_ACTIVITY_POLL_MS` and the activity-tail code path no longer exist
- [ ] Forensics tests (death detection, post-mortem, lost-frame) still green untouched in behavior
**Verify:** grep for deleted identifiers; forensics test files green; full suite.
**Dependencies:** T8, T9 (liveness replacement live first). **Files:** `packages/adapter-openclaw/src/session-activity.ts` (deleted/reduced), `runtime.ts`, tests. **Size:** M.
**Commit:** `refactor(adapter-openclaw): delete trajectory activity tail — forensics only`

### Task 11: WS1b docs
**Description:** `.claude/knowledge/dispatch.md` (onActivity + ephemeral SSE liveness), `session-forensics.md` (tail removal), `agent-health-diagnostics.md` if the timeline live region is described.
**Verify:** doc grep for stale poll references. **Dependencies:** T10. **Size:** S.
**Commit:** `docs(knowledge): dispatch live activity`

### Checkpoint 1b
- [ ] Full suite green; live box shows dispatch activity chips during a real task turn
- [ ] PR merged; WS1 success criteria 1 fully met (spec Success Criteria #1)

---

## Phase 3 · PR 2a — `fix/sdk-golden-path` (parallel worktree; may start alongside Phase 1)

### Task 12: Delete `manifest.entry`, single root layout
**Description:** Remove `entry` from the manifest zod schema, SDK manifest types, validation, and all doc examples; builders keep (now truthful) root-path expectation. Delete the dead manifest `tests` field + its doc reference in the same sweep (R15).
**Acceptance:**
- [ ] Manifest schema rejects unknown `entry`/`tests` keys; no doc or type mentions them
- [ ] All 13 core plugins + doc snippet still build/activate
**Verify:** full suite; `bun run build:plugins` clean.
**Dependencies:** none. **Files:** `packages/sdk/src/types/manifest.ts`, validate-manifest, `docs/**`, `.claude/knowledge/plugin-system.md`. **Size:** M.
**Commit:** `refactor(sdk,host)!: single root plugin layout — delete manifest entry/tests fields`

### Task 13: Scaffold rewrite
**Description:** `plugin-scaffold.ts` emits the root layout with correct registration comments (`routes:`, `ctx.hooks.register`), `tsconfig.json`, `contributes` + permission examples, a starter test, and a real resolved SDK version (never `^0.0.0-dev`).
**Acceptance:**
- [ ] Scaffolded plugin typechecks standalone (`bun x tsc --noEmit` in the scaffold dir)
- [ ] Template contains no references to nonexistent APIs
**Verify:** scaffold unit test asserting file set + content markers; T14's integration test.
**Dependencies:** T12. **Files:** `src/core/plugin-scaffold.ts`, tests. **Size:** S.
**Commit:** `fix(cli): scaffold emits installable root-layout plugin`

### Task 14: Golden-path integration test + tutorial fix
**Description:** Integration test drives scaffold → `bakin plugins install .` → activation → route responds. Fix `docs/.../build.md`: root layout; exec tool renamed to `bakin_exec_<id>_score` and declared in `contributes.execTools`.
**Acceptance:**
- [ ] CI test fails if scaffold and builder ever drift again
- [ ] Tutorial code blocks pass the docs snippet check
**Verify:** new test green; `bun run docs:check` (or equivalent) green.
**Dependencies:** T13. **Files:** new `tests/integration/plugin-golden-path.test.ts`, `docs/src/content/docs/extending/plugins/build.md`. **Size:** M.
**Commit:** `test(plugins): scaffold→install→activate golden-path gate + tutorial fix`

### Task 15: Host/SDK semver gate
**Description:** Enforce the manifest `bakin` range at install (reject with actionable message) and activation (refuse + surface in `bakin plugins list` / plugins UI state).
**Acceptance:**
- [ ] Incompatible range → install fails naming required vs actual version; activation refusal shows in list output
**Verify:** unit tests both gates; full suite.
**Dependencies:** T12. **Files:** `validate-manifest.ts`, `plugin-registry.ts`, `src/cli/commands/plugins.ts`, tests. **Size:** S.
**Commit:** `feat(plugins): enforce manifest bakin semver range`

### Task 16: Symmetric contributes enforcement + sync-manifest
**Description:** Declarative routes validate against `contributes.apiRoutes` exactly as legacy routes did (user plugins only, as today); `bakin plugins sync-manifest` loads the plugin in a sandbox and regenerates `contributes` (routes, execTools, nav, slots).
**Acceptance:**
- [ ] Undeclared declarative route → activation error naming the manifest key (same UX as exec tools)
- [ ] `sync-manifest` on the reference scaffold produces a manifest that passes enforcement
**Verify:** unit tests for both; golden-path test extended to run sync-manifest.
**Dependencies:** T13, T15. **Files:** `plugin-registry.ts`, new `src/cli/commands/` surface in plugins.ts, tests. **Size:** M.
**Commits:** `fix(plugins): validate declarative routes against manifest` → `feat(cli): bakin plugins sync-manifest`

### Checkpoint 2a
- [ ] Golden path verbatim-works on a fresh checkout; PR merged

---

## Phase 4 · PR 2b — `feat/sdk-testing-and-types`

### Task 17: `@makinbakin/sdk/testing`
**Description:** New SDK entry exporting `createTestContext`/`activatePlugin`/`callRoute`/`callTool` + mock runtime + temp content-dir isolation, `bun:test`-native (no `vi`), self-contained per `assertNoForbiddenImports`. Add `./testing` to `SDK_EXPORTS`.
**Acceptance:**
- [ ] A sample external-style test (fixture in `tests/`) passes using only the published entry's API
- [ ] npm build self-containment guard green
**Verify:** `bun run build` SDK step; new tests.
**Dependencies:** PR 2a merged (manifest shape final). **Files:** `packages/sdk/src/testing/*` (new), `scripts/build-sdk-package.ts`, tests. **Size:** M.
**Commit:** `feat(sdk): @makinbakin/sdk/testing`

### Task 18: In-repo tests consume sdk/testing
**Description:** `tests/plugins/test-helpers.ts` becomes a thin re-export/adapter over the SDK testing module — one source of truth.
**Acceptance:** [ ] tests/plugins suites green with no behavior-relevant duplication left.
**Verify:** full suite. **Dependencies:** T17. **Size:** S.
**Commit:** `refactor(tests): plugin helpers ride @makinbakin/sdk/testing`

### Task 19: Type tightening (breaking, two commits)
**Description:** (a) Contract: `BakinPlugin.routes`, closed `DefinePluginInput`, exec-tool param inference from Zod shape, delete legacy `ctx.registerRoute` + legacy `APIRoute`, non-optional `ctx.log`/storage methods. (b) Fallout sweep: remove the 13 plugins' `as unknown as BakinPlugin` casts and any `?.` on now-required members.
**Acceptance:**
- [ ] Zero `as unknown as BakinPlugin` remains; typo'd `definePlugin` keys fail typecheck (negative-type test)
- [ ] Exec-tool handlers get inferred param types (compile-time assertion test)
**Verify:** typecheck + full suite after each commit.
**Dependencies:** T18 (helpers stable first). **Files:** `packages/sdk/src/types/*`, `packages/core/src/routing/define.ts`, `plugin-registry.ts`, all `plugins/*/index.ts`. **Size:** L → split as two commits.
**Commits:** `refactor(sdk)!: tighten plugin type surface, delete legacy route API` → `refactor(plugins): adopt tightened SDK types`

### Task 20: Uniform duplicate-throw + `/internal` split + `pluginFetch`
**Description:** All registration collisions throw (skills/workflows/node-types/notification-channels align with routes/tools); host-side plumbing moves from the root barrel to `@makinbakin/sdk/internal` (host imports updated); `pluginFetch(pluginId, path, init?)` ships in hooks/utils and is adopted in two plugins as the exemplar.
**Acceptance:**
- [ ] Duplicate skill registration now throws (test); root barrel exports author API only
- [ ] `pluginFetch` used by chat + one other plugin
**Verify:** full suite; grep root barrel for host-only symbols.
**Dependencies:** T19. **Files:** `plugin-registry.ts`, `packages/sdk/src/{index.ts,internal/*}`, host imports, tests. **Size:** M.
**Commits:** `refactor(sdk)!: internal entry + uniform duplicate-throw` → `feat(sdk): pluginFetch helper`

### Task 21: `TurnOutputView` (R22b)
**Description:** One SDK component rendering normalized chunks (markdown text → `MarkdownContent`; plain/code → mono block; tool → chip with structured fields; status/error states). Migrate `chat-view.tsx` and `step-output-viewer.tsx`. No visual redesign.
**Acceptance:**
- [ ] Chat + step output render through `TurnOutputView`; snapshots unchanged (or intentionally-trivial diffs documented)
- [ ] Component consumes only R5b chunk fields — no per-surface format guessing left in the two migrated call sites
**Verify:** component tests; manual `dev:mock` chat + task step check.
**Dependencies:** T19 (types), PR 1a merged (chunk taxonomy). **Files:** `packages/sdk/src/components/turn-output-view.tsx` (new), `plugins/chat/components/chat-view.tsx`, `plugins/tasks/components/step-output-viewer.tsx`. **Size:** M.
**Commit:** `feat(sdk): TurnOutputView — single turn-chunk renderer`

### Task 22: Reference plugin (in-tree) + CI gate
**Description:** `examples/reference-plugin/` written ONLY against `@makinbakin/sdk/*`: routes, exec tool, settings, search content type, health check, SSE events (`ctx.events.emit` ↔ `usePluginEvent`), storage, `TurnOutputView`-consuming page where sensible. CI installs + activates it.
**Acceptance:**
- [ ] `grep -r "@bakin/\|src/core" examples/reference-plugin` → empty; CI test installs + activates + hits a route and the exec tool
**Verify:** new integration test green.
**Dependencies:** T17, T19–T21. **Files:** `examples/reference-plugin/*` (new), integration test. **Size:** M.
**Commit:** `feat(examples): reference plugin + CI install gate`

### Task 23: Starter-repo mirror (🔶 ask-first: repo name/visibility — OQ1)
**Description:** Release-pipeline step mirrors `examples/reference-plugin/` to the standalone starter repo on stable releases (pattern: the existing homebrew-tap update step).
**Acceptance:** [ ] Dry-run of the step against a scratch repo succeeds; step is no-op on pre-releases.
**Verify:** workflow lint + dry run.
**Dependencies:** T22, user answer on OQ1. **Files:** `.github/workflows/release.yml`, `scripts/` mirror script. **Size:** S.
**Commit:** `ci(release): mirror reference plugin to starter repo`

### Task 24: Public docs sweep (R22)
**Description:** Author docs gain: SSE pattern, storage scoping (plugin-data jail), public search-plugin guide port, invocable-hook catalog, full settings field types; align on `bakin plugins link` as the primary dev verb.
**Acceptance:** [ ] Each listed topic has a docs page/section; snippet checks green.
**Verify:** docs build + snippet check.
**Dependencies:** T17–T22 (document what shipped). **Files:** `docs/src/content/docs/extending/plugins/*`. **Size:** M.
**Commit:** `docs(plugins): SSE, storage scoping, search guide, hooks catalog`

### Checkpoint 2b
- [ ] Spec Success Criteria #2, #3, #6 met; PR merged

---

## Phase 5 · PR 3 — `feat/runtime-conformance` (after 1a AND 2b)

### Task 25: Conformance suite skeleton + first pins
**Description:** `tests/integration/runtime-conformance/conformance.ts` mirroring the search-conformance pattern: parameterized over dev mock, Pi (via `tests/integration/pi/fake-provider.ts`), Imitation Crab-backed OpenClaw. First pins: threaded send returns `metadata.sessionId`; abort → `kind:'aborted'`; messaging errors are typed `RuntimeError`s.
**Acceptance:** [ ] Suite runs 3 targets in CI; an intentionally-broken adapter fixture fails it.
**Verify:** suite green ×3.
**Dependencies:** PR 1a, PR 2b. **Files:** new suite dir, harness glue. **Size:** M.
**Commit:** `test(adapters): runtime conformance suite — messaging pins`

### Task 26: Stream + capability + provisioning pins
**Description:** Pin R5/R5b (`done` exactly-once, classified chunks with format hints, no post-`done` chunks, error chunk + rejection), `onActivity` best-effort firing, provisioning idempotency, and capability honesty (declared mode ⇒ probe of that surface succeeds).
**Acceptance:** [ ] All three targets green; honesty pin FAILS against current OpenClaw sessions stub (drives T28).
**Verify:** suite ×3 (sessions pin temporarily scoped to Pi+mock until T28, with a tracked TODO-test that flips on).
**Dependencies:** T25. **Size:** M.
**Commit:** `test(adapters): stream/capability/provisioning conformance pins`

### Task 27: Mock default flip
**Description:** `createMockRuntimeAdapter` defaults to minimal (no `channels`/`cron`, honest capability set); explicit opt-in flags restore them. Fix all plugin/core tests that legitimately need the surfaces; tests that were masking bare derefs get the deref fixed instead.
**Acceptance:**
- [ ] Default mock has no `channels`/`cron`; a bare-deref regression test demonstrates failure mode
- [ ] Full suite green after the opt-in sweep
**Verify:** full suite.
**Dependencies:** T25 (suite guards behavior during the sweep). **Files:** `packages/core/src/adapters/runtime/testing.ts`, `tests/plugins/**`, `tests/core/**`. **Size:** M (mechanical breadth).
**Commit:** `refactor(core)!: mock runtime defaults to minimal capability shape`

### Task 28: Implement OpenClaw sessions.list/get
**Description:** Read OpenClaw's session store (adapter-private paths) so `sessions.list`/`get` return real data matching Pi's semantics; flip on the sessions honesty pin from T26.
**Acceptance:** [ ] Conformance sessions pin green on all 3 targets; memory-plugin tier + diagnostics behavior verified on OpenClaw mock.
**Verify:** suite ×3; targeted memory-plugin test.
**Dependencies:** T26. **Files:** `packages/adapter-openclaw/src/runtime.ts` (or new `sessions.ts`), tests. **Size:** M.
**Commit:** `feat(adapter-openclaw): real sessions list/get`

### Task 29: Contract semantics — ping/restart/toolsAllow/oversizedOutputBytes
**Description:** Doc-comment + implement: `ping()` = cheap can-serve-a-turn probe (Pi does an auth/registry read); `restart()` = re-read durable config; `toolsAllow`/`toolsDeny` unified to exec-tool scope on BOTH adapters (OpenClaw stops forwarding them as native policy); `oversizedOutputBytes` becomes a typed `MessageArgs` field (metadata-bag read deleted); conformance pins each.
**Acceptance:**
- [ ] Pi ping fails when auth is broken (test); OpenClaw toolsAllow no longer reaches gateway native policy (test)
- [ ] Dispatch passes the typed field; Pi honors it in diagnoses (no more hardcoded `oversizedOutput:false`)
**Verify:** suite ×3 + adapter unit tests; full suite.
**Dependencies:** T26. **Files:** `concepts.ts`, both adapters, `src/core/dispatch-turns.ts`, tests. **Size:** M.
**Commit:** `fix(adapters): specified ping/restart/toolsAllow/oversizedOutputBytes semantics`

### Task 30: Dead surface + error taxonomy + arch-test ban
**Description:** Delete `updatePermissions` and `tools.invoke` (contract, adapters, plugin facade, docs); rename/document `updateAllowlist` as the subagent-dispatch allowlist. Extend `RuntimeError` (+`not_found` kind) to agents/skills/cron surfaces on both adapters. Arch test gains the error-message string-matching ban (with intentional-violation fixture).
**Acceptance:**
- [ ] Deleted members absent from contract + facade; CRUD errors are typed (spot tests)
- [ ] Arch test fails on a seeded string-match violation
**Verify:** full suite + arch tests.
**Dependencies:** T25. **Files:** `concepts.ts`, both adapters, `src/lib/plugin-context-services.ts`, `tests/architecture/adapter-boundary.test.ts`. **Size:** M.
**Commit:** `refactor(core,adapters)!: delete dead contract surface, typed CRUD errors, arch ban`

### Task 31: Provider-leak fixes + WS3 docs
**Description:** UI/health copy derives names from `runtime.name`; session-store remediation moves into an adapter-provided health check; `media://` scheme constant behind the media surface; `turn-parser.ts` session-file convention moves behind the adapter. Update `.claude/knowledge/{runtime-capabilities,adapter-architecture}.md` + CLAUDE.md bullets.
**Acceptance:** [ ] Grep for hardcoded provider strings at the audited sites → clean; docs current.
**Verify:** full suite; arch tests.
**Dependencies:** T30. **Files:** `plugins/health/*`, `plugins/memory/lib/tier-parsers/turn-parser.ts`, `plugins/images/lib/tools.ts`, `src/components/provider-keys-tab.tsx`, `plugins/schedule/lib/health-checks.ts`, knowledge docs. **Size:** M.
**Commit:** `fix(plugins,core): provider-neutral copy + conventions` → `docs(knowledge): conformance + contract semantics`

### Checkpoint 3
- [ ] Spec Success Criteria #4 met; suite is the documented acceptance gate for adapter #3; PR merged

---

## Phase 6 · PR 4 — `chore/cleanup-sweep` (anytime; schedule during WS1 soak)

### Task 32: Rig off mcporter
**Description:** Dockerized rig provisions Bakin tools via the production `provisionToolAccess` native-MCP path; mcporter leaves the Dockerfile; `scripts/instance/mcporter.ts` + its test deleted; `lifecycle.ts` rewired.
**Acceptance:** [ ] `bun run instance up` agents reach `bakin_exec_*` over native MCP (rig smoke); no mcporter in image or scripts.
**Verify:** rig smoke run; `bun run test`.
**Dependencies:** none. **Files:** `dev/docker/Dockerfile`, `scripts/instance/{lifecycle.ts,mcporter.ts→deleted}`, `tests/scripts/instance/`. **Size:** M.
**Commit:** `refactor(dev): dockerized rig rides native-MCP provisioning — delete mcporter`

### Task 33: Fixtures, comments, doc drift
**Description:** Imitation Crab `pixel` fixture → native-MCP invocation style; reword the two mcporter-era comments; fix knowledge-doc drift (manifest shape, `PluginToolContext` fields, `PermissionSchema`, `SettingsField`, file-backed-search boot-reconcile docstring, hit-renderer `meta`).
**Acceptance:** [ ] `grep -ri mcporter` live code/fixtures → only historical docs/CHANGELOG; audited doc-drift items closed.
**Verify:** full suite; doc greps.
**Dependencies:** T32 (fixture style matches rig). **Files:** `dev/imitation-crab/fixtures/`, two comment sites, knowledge docs, `packages/sdk/src/types/services.ts`. **Size:** S.
**Commits:** `chore(dev): native-MCP fixtures + comment cleanup` → `docs(knowledge): close audit drift items`

### Task 34: SDK primitive adoption sweep (absorbed from the retired sdk-gaps effort)
**Description:** Finish the migrations the earlier `feat/sdk-gaps` effort shipped primitives for but never completed: (a) `useJsonFetch` replaces the ~11 remaining `let cancelled` fetch clusters (team ×4, health, workflows ×2, models, assets, host ×2); (b) `ConfirmDialog` replaces the hand-rolled delete dialogs (tasks, schedule, workflows, team ×2, chat, assets); (c) `formatDuration`/`formatDateTime` land in SDK utils and the health/team reimpls migrate; (d) `useAvailableModels` relocates INTO the SDK proper (the hooks barrel currently re-exports it from `@bakin/models/...` — an SDK→plugin dependency wart); (e) finish `toneBadgeClass` adoption where trivially applicable.
**Acceptance:**
- [ ] `grep -rn "let cancelled" plugins packages/host/src` → empty; no hand-rolled delete-confirm dialogs remain at the listed sites
- [ ] SDK barrels import nothing from `@bakin/{plugin}` paths
**Verify:** full suite; `dev:mock` spot-check of two migrated dialogs; npm-build self-containment guard.
**Dependencies:** PR 2b merged (barrel reorganization first, to avoid double-touching `packages/sdk/src/index.ts`). **Files:** `packages/sdk/src/{hooks,utils}`, listed plugin components, `packages/host/src`. **Size:** M (mechanical breadth).
**Commits:** `refactor(plugins,host): adopt useJsonFetch + ConfirmDialog everywhere` → `refactor(sdk): formatDuration/DateTime utils + useAvailableModels relocation`

### Checkpoint 4 (initiative close)
- [ ] Spec Success Criteria #5 met; all six criteria re-verified against `main`
- [ ] WS1 soak reviewed with user → Pi worktree daily-driver setup retired
- [ ] SPEC.md marked complete; memory updated

---

## Commit-Level Rollback Map

Every commit above is atomic + green — `git revert <sha>` (or resetting a branch to any checkpoint commit) restores a working system. The three commits marked `!` (T12, T19a, T20a, T27, T30) are the breaking ones; each confines its breakage + fallout-fix to a single PR so reverting the PR reverts the break. The runtime flip's rollback is the switch's settings backup + `bakin runtime use pi` (Pi worktree intact until Checkpoint 4).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Live gateway frames differ from Appendix A / dist reading | High | T1 records real frames FIRST; everything downstream builds on fixtures, fail-fast before any rewrite |
| Deleting activity tail regresses liveness if events drop | Med | 1b ordering (tap live before deletion); RPC final + forensics still guarantee settle/diagnosis; mock seq-gap test |
| Mock default flip breaks a wide test surface | Med | Mechanical sweep in one commit, conformance suite already green as the behavior guard |
| Type tightening fallout across 13 plugins | Med | Two-commit split (contract, then adoption); typecheck gates each |
| Runtime flip disrupts daily driver | Med | User-run checkpoint, settings backup, Pi worktree kept until close |
| `sync-manifest` sandbox executes plugin code | Low | Dev-time command on code the author wrote; never runs during install/consent |
| Starter-repo mirror step misfires on release | Low | Dry-run against scratch repo; no-op on pre-releases |

## Parallelization

- Worktree A: PR 1a → flip → PR 1b. Worktree B: PR 2a → PR 2b. PR 4 fits during the WS1 soak window.
- PR 3 starts only after 1a and 2b are both on `main` (contract + helper dependencies).
- Within PRs, tasks are sequential (each commit builds on the last — that's the rollback ladder).

## Open Questions (carried)

- OQ1: starter-repo name/visibility — blocks only T23.
- OQ2: chat-frames-only vs merged text sources — resolved by T1 before any streaming code.
- OQ3: conformance pin list beyond v1 — revisit at Checkpoint 3 with what T25/T26 learned.
