# Channel Readiness & Recovery (#908) — Plan

Spec: `.claude/specs/channel-readiness/SPEC.md` (v3, approved 2026-10-06).
Tracking: `.claude/specs/channel-readiness/TODO.md`.

## Context

On margo (rc.35, Pi) Discord was enabled with a guild and allowlists but the
Bakin bot token was absent. The post tool said "no channel layer", `bakin
check channels` said "no channel layer, by design", and only the doctor said
"missing token" — through a generic "Health repair: N incidents" task buried
in an escalation loop. The bridge boots only at server start, so even a found
fix needed a terminal. This work gives Bakin ONE readiness engine, a hot
reconciling bridge that converges on the latest config, typed delivery
errors, a Channels settings tab, and CLI/health/switch surfaces that all read
the same snapshot.

## Spec v3 amendments (T0 — apply before commit 1)

These were forced by the two plan reviews and the reconciliation design; the
spec file is edited first so code never diverges from it.

1. **§4.1 projection vs. observation.** Add `ProjectedChannelState =
   'native' | 'disabled' | 'missing_token' | 'missing_guild' | 'ready_to_connect'`
   and `projectChannelReadiness(facts)` (no bridge input). `classifyChannelReadiness`
   takes a NON-null `BridgeStatus`; add explicit rows: `bridge.state === 'degraded'`
   ⇒ `degraded`; `bridge.attempt` present ⇒ `connecting`; `idle` with no
   attempt after boot ⇒ `failed` with kind `not_connected` ("never attempted"
   copy). The switch report's `projectedState` is the projected type; a
   configured, unprobed target reads "ready to connect after restart", never a
   failure.
2. **§4.1 `BridgeStatus`** gains `attempt?: { generation, startedAt }`.
3. **D11 / §4.2 token change detection.** The secret subscription compares a
   hash of the resolved token value (env or store), not presence, so A→B
   rotation reconnects.
4. **D7 / §4.5 operator semantics.** `reconcile('operator')` JOINS a running
   loop (no new attempt, no discard); when nothing is running it bumps and
   forces a fresh attempt even with identical config (that is what the
   Reconnect button means). The returned promise always settles for the
   latest generation.
5. **§4.5 reconnect exit codes** add `disabled` / `missing_token` /
   `missing_guild` ⇒ exit 2 with the copy-table remediation (nothing to
   connect; not an error, not success).
6. **§4.6 order of operations.** policy → **identical-retry memo lookup**
   (signature over agent, normalized REQUESTED channel, content, embed, asset
   ids, repost, taskId, testMode — no `list()` call; the memoized result
   stores the resolved channel) → pre-flight → alias resolution → once-per-task
   asset guard → chunks. A completed or partially completed post retried while
   the bridge is down returns the saved result, never a fresh readiness
   failure.
7. **§4.3 classification** adds: a REST 401 from `GET /gateway/bot` during
   connect ⇒ `auth_failed` (a bogus token never reaches close 4004).
8. **§4.9 / D2 runtime reconcile.** `reconcileDeliveryBridge(runtime,
   'runtime')` is called by `switchRuntime` after the real switch's
   `createAppServices()` and in `restore()`; dry runs never call it. Native
   target ⇒ immediate teardown (no double-handling); Pi target ⇒ bridge up
   now, with the report noting plugin-bound surfaces follow at restart.
9. **§10 tests.** "No live Discord in tests" is satisfied by an env-gated fake
   transport (`BAKIN_DELIVERY_TRANSPORT=fake`, see T12), mirroring the
   `BAKIN_RUNTIME_ADAPTER` and `BAKIN_CHANNEL_TEST_MODE` precedents.
10. **§4.10 CLI** adds `--json` to `bakin check <target>` and `check all`.
11. **§4.11** ID list editors are text-entry + Add + removable rows, not a
    Combobox; `approvals.requireRejectReason` is named explicitly as staying.

## Architecture decisions (pinned)

- Neutral types, classifier, projector in `packages/core/src/delivery/readiness.ts`;
  app-side collector in `src/core/delivery/readiness.ts`. Native precedence FIRST.
- `boot()` → `reconcile(reason)` desired-generation loop (design below).
- `DeliveryError { kind, detail }` in `packages/core/src/delivery/errors.ts`;
  R28 already scans `src/` for message-text classification.
- Secret-slot registry `packages/core/src/secrets/slots.ts`; status public,
  value private (not on the `@bakin/core` root barrel).
- Pi: `channels` surface permanent when a bridge handle is threaded.
- SSE push `{ type: 'plugin-event', event: 'channels.readiness', readiness }`
  (only `plugin-event` reaches `usePluginEvent`).
- Targeted health rerun = `runTargetedDiagnostics(ids)` (`src/core/doctor-execution.ts`).
  Ids: `health.delivery-discord`, `health.channel-aliases`, `health.channel-approvals`.
- `/api/channels*` dispatched in `src/core/server/request-handler.ts` via
  `dispatchWebHandler(req, res, channelsRoute.handler)` (startsWith, like
  `/api/exec-tools/`).
- Alias map written with replace semantics (`replaceSettingsValue`).
- Host tab in `src/components/channels-tab.tsx` (census entry via
  `ui:census:generate`; zero raw-scale classes; no public story). Shared
  secret field in `src/components/secret-slot-field.tsx` (same rules).
- CLI module `src/cli/commands/channels.ts`; case in `cli/bakin.ts`; help rows
  in `src/core/cli/registry.ts`; reachability via `isServerConnectionError`.

## Reconciliation design (reviewed)

Empirical facts from the review (verified with the installed `@discordjs/ws@2.0.4`):

- `WebSocketManager.connect()` calls REST `GET /gateway/bot` before opening a
  socket; a bogus token rejects there as `DiscordAPIError{status:401}`.
- With no `error` listener on the manager, `shard.emit('error')` throws out of
  the forwarding listener, `gateway.connect()` never resolves, and `onClose`
  never destroys the shard. Today's sequential `await gateway.connect(); await
  ready` leaves the first await unguarded by the 30 s timer.
- `shard.destroy()` emits `closed` with the destroy code only when the socket
  was open, so our own teardown echoes `closed 1000`.

**Transport (`discord/client.ts`).** `DiscordTransport` gains
`connect({ signal })`, idempotent `destroy()` (disposed flag; ALWAYS calls
`gateway.destroy()`), `status(): TransportStatus { phase, botUser,
readyGuildIds, lastCloseCode, lastError }`, `subscribe(listener)` emitting
`ready | resumed | closed{code,fatal} | error{DeliveryError}`. Listeners for
`Closed`, `Error`, `Ready`, `Resumed` are attached at construction. `connect`
races `gateway.connect()` against a READY gate that is rejected early by a
fatal close (`4004`→`auth_failed`, `4013/4014`→`intents`), by the timer
(`timeout`), or by abort; on any failure it destroys the manager and throws
the classified `DeliveryError` (`classifyConnectFailure`: typed passthrough,
fatal close code, REST 401 → `auth_failed`, abort/other → `transport`;
messages sanitized of the token). READY stores `data.guilds[].id`.

**Bridge (`src/core/delivery/index.ts`).** Module state: `desiredGeneration`,
`appliedGeneration`, `stopped`, `armed`, `runtimeDeliveryMode | null`,
`current: Applied | null`, `inFlight: { generation, abort }`, `loop:
Promise | null`, `pendingReasons[]`, `status: BridgeStatus`, `subscribers`.
Handler sets (`approvalHandlers`, `inboundHandlers`) stay module-level.

- `reconcile(reason)`: `'boot'` resets `stopped` and arms the settings/secret
  subscriptions once (server-driven only, so CLI processes never start a
  loop); `'operator'` while `loop` runs ⇒ join (push reason, return `loop`);
  otherwise bump (`desiredGeneration++`, abort in-flight) and start/return the
  shared loop promise.
- `runLoop`: while `!stopped && applied !== desired`: read config
  (`readDiscordConfig()` + cached `runtimeDeliveryMode`); `shouldRun()` in
  precedence `stopped > runtime_unknown > native > disabled > missing_token >
  missing_guild`; non-run ⇒ `teardown(gen, reason)` (destroy current, ONE
  `log.info('Delivery bridge idle', { reason })`, publish `idle`); identical
  snapshot key (settings block JSON + sha256(token) + mode) while healthy and
  no operator/boot/runtime reason ⇒ apply generation silently; else audit
  `delivery.reconciling { reasons, generation }` once and `attempt()`.
- `attempt(gen, cfg)`: publish `connecting` (+`attempt`); memoized
  `loadDiscordModules()`; `isCurrent()` after EVERY await; connect with the
  abort signal; per-guild `cache.refresh()` (never throws); build surfaces
  whose fan-out is guarded by `current?.transport === transport`; swap
  `current` only after the new transport is fully built, then destroy the
  replaced one (no send gap); publish `connected`/`degraded` with
  `joinedGuildIds` + `guildResults`; audit `delivery.connected`; fire-and-
  forget memoized, abort-aware `registerGlobalCommands`. Catch: if still
  current ⇒ publish `failed` + audit `delivery.connect_failed { kind }`; stale
  ⇒ publish nothing. Finally: destroy any transport that is not `current`.
- Transport events are accepted only from `current.transport`: non-fatal
  `closed` ⇒ `disconnected` (guild fields kept); `resumed`/`ready` ⇒ back to
  `connected`/`degraded` recomputed; fatal `error` ⇒ `current = null`,
  destroy, `failed`, audit.
- `publish()` resets `since` only when `state` changes (connecting→connecting
  keeps it); subscribers are individually try/caught.
- `shutdown()`: `stopped = true`, abort in-flight, await loop (its trailing
  teardown destroys current), audit `delivery.disconnected { reason:
  'shutdown' }`.
- `requireApplied()` throws `DeliveryError('not_configured' | 'not_connected',
  …, { state })` from the idle reason / status.
- `reconcileDeliveryBridge(runtime, 'boot' | 'runtime')` reads
  `capabilities().delivery.mode` once (Pi's `capabilities()` probes models;
  never call it per settings write) and calls `bridge.reconcile`. Callers:
  `server.ts` (boot), `runtime-switch.ts` real path + `restore()`.
- `isDeliveryBridgeConnected()` is retired with the health rewrite in T5
  (T3 keeps it as `state ∈ {connected, degraded}` so T3 compiles alone).

## Dependency graph

```
T0 spec v3
└─ T1 core types/classifier/projector/errors/slots/subscriptions
    ├─ T2 secrets API + known-slot UI + shared field
    ├─ T3 bridge status + reconciliation + per-guild cache + ALL ChannelBridge fixtures migrated
    │    └─ T4 readiness collector + /api/channels + SSE + fake transport gate
    │         ├─ T5 health projection + dependents + onboarding (both modes)
    │         ├─ T6 post-channel memo-first/pre-flight/mapping + alias resolver
    │         ├─ T7 adapter-pi behavior + conformance pin + teeth
    │         ├─ T8 CLI channels + check --json          (needs T5)
    │         └─ T9 switch report + runtime page          (needs T7)
    └─ T10 Channels tab (needs T2, T4, T5, T9)
T12 readiness-agreement integration test (needs T5, T6, T8)
T11 docs (last)
```

## Task list

### Phase 0

#### T0 Spec v3 amendments
Apply the eleven amendments above to `.claude/specs/channel-readiness/SPEC.md`;
bump status to "v3 — approved plan"; copy this plan to `PLAN.md` and the task
list to `TODO.md`. **Verify:** `rg -n "ready_to_connect|requireRejectReason|BAKIN_DELIVERY_TRANSPORT" .claude/specs/channel-readiness/SPEC.md`. **Size.** XS.

### Phase 1 — Foundations

#### T1 Core types, classifier, projector, errors, slots, change subscriptions
**Files.** NEW `packages/core/src/delivery/readiness.ts`, NEW `errors.ts`,
`packages/core/src/delivery/index.ts`, NEW `packages/core/src/secrets/slots.ts`
(+ `./secrets` export in `packages/core/package.json`), `packages/core/src/media/secret-store.ts`
(`subscribeSecretChanged`), `packages/core/src/settings.ts` (`subscribeSettingsChanged`,
`replaceSettingsValue`), `src/core/secret-env.ts`, `src/core/delivery/config.ts`,
tests `tests/core/delivery/{readiness-classify,errors}.test.ts`,
`tests/core/secrets/slots.test.ts`, `tests/core/settings-subscriptions.test.ts`,
`tests/architecture/adapter-boundary.test.ts` (root-barrel assertion for `readSecretSlotValue`).
**Acceptance.**
- [ ] Classifier matrix covers every precedence row including `bridge.state 'degraded'`, `attempt` pending, idle-never-attempted; native with enabled+no token ⇒ `native`.
- [ ] Projector matrix: configured Pi target ⇒ `ready_to_connect`; native target ⇒ `native`; token-less ⇒ `missing_token`.
- [ ] `DeliveryError` carries `kind` + `detail`, `name === 'DeliveryError'`.
- [ ] `SECRET_SLOT.discordBotToken` / `braveApiKey`; status prefers env; value reader absent from the root barrel.
- [ ] `updateSettings`/`replaceSettingsValue` notify with top-level keys; secret set/unset notify `(provider, name)`; `replaceSettingsValue` deletes omitted map keys.
**Verify.** the test files `--isolate`; `bun run typecheck`; `bun run lint`.
**Deps.** T0. **Size.** M.

#### T2 Secrets API slots + known-slot rows + shared secret field
**Files.** `packages/host/src/api/secrets.ts`, NEW `src/components/secret-slot-field.tsx`,
`src/components/provider-keys-tab.tsx`, `tests/api/secrets.test.ts`,
`tests/components/provider-keys-tab.test.tsx`, NEW `tests/components/secret-slot-field.test.tsx`,
`design-system/census.json` (regenerate).
**Patterns.** `storybook/public/primitives/input-group.stories.tsx — LocalSubmitAction`
(password input + inline Set), `feedback/status-badge.stories.tsx — CanonicalUsage`,
`lists/list-rows.stories.tsx — InteractiveRows` (known-slot rows). Contract:
`@makinbakin/sdk/ui`, `/patterns`, `/layout`.
**Acceptance.**
- [ ] `GET /api/secrets` returns `slots[]` `{provider,name,label,description,envVar?,owner,status}`; never a value.
- [ ] Rows show Not set / Bakin store / Environment; env-sourced hides Set with the explanation; Set/Clear round-trip and refetch.
- [ ] Custom add under a collapsed section still works; keyboard reaches input → Set → Clear; Enter submits.
**Verify.** the three tests `--isolate`; `bun run ui:conformance --quick`; `bun run ui:census:check`; `bun run ui:legacy-styles:check`.
**Deps.** T1. **Size.** M.

### Checkpoint A — commits 1–2
- [ ] lint, typecheck, touched tests, conformance quick.

### Phase 2 — Bridge and readiness (risk first)

#### T3 Bridge status, reconciliation loop, per-guild cache, classification, fixture migration
**Files.** `packages/core/src/delivery/bridge.ts` (`status/reconcile/subscribe/shutdown/channels`; `boot` removed),
`src/core/delivery/index.ts`, `src/core/delivery/discord/client.ts`,
`src/core/delivery/discord/channel-cache.ts` (`guildResults()`, never throws on one guild),
`src/core/delivery/discord/send.ts` (REST wrapping 401/403/404/4xx/5xx),
`src/core/delivery/audit.ts` (`connect_failed`, `reconciling`), `server.ts`,
`src/core/runtime-switch.ts` (`reconcileDeliveryBridge(..., 'runtime')` real + restore),
`src/core/lifecycle.ts`, **every `ChannelBridge` implementer/fixture:**
`tests/adapter-pi/channel-bridge-delegation.test.ts` `fakeBridge` (adds the three members, drops `boot`; behavior assertions unchanged here),
`tests/integration/runtime-conformance/*` mock bridges if any, `tests/core/delivery/{reconcile,status,send,boot-gating,channel-cache}.test.ts`,
`tests/plugins/health/delivery-discord-check.test.ts` (mock keeps `isDeliveryBridgeConnected`).
**Acceptance.**
- [ ] Six race scenarios (spec §4.2) pass with the fake transport factory (`mock.module('…/discord/client')`): A→B, disable mid-connect, token cleared mid-connect, shutdown mid-reconcile, native boot with configured bridge then `'runtime'` to Pi connects, operator joins in-flight; plus: operator on a healthy identical config forces a reconnect with no send gap.
- [ ] Transport tests with a fake manager: close 4004 before READY rejects in ms with `auth_failed`; 4014 ⇒ `intents`; REST 401 ⇒ `auth_failed`; timer ⇒ `timeout`; own destroy echoes nothing; manager `error` never throws.
- [ ] One failing guild (403) ⇒ `degraded`, `guildResults[i].error.kind === 'forbidden'`, `list()` still serves the others.
- [ ] `send.ts`: 401→`auth_failed`, 403→`forbidden`, 404→`target_not_found`, other 4xx→`rejected` (no retry), 5xx→`transport` after 3.
- [ ] Exactly one idle log line per non-run reason at boot; `delivery.reconciling` once per attempt start.
- [ ] `bun run typecheck` green with the migrated fixtures.
**Verify.** `bun test tests/core/delivery tests/adapter-pi --isolate`; `/verify` boot with Discord disabled shows the idle line.
**Deps.** T1. **Size.** L (one subsystem).

#### T4 Readiness collector, `/api/channels` routes, SSE, fake transport gate
**Files.** NEW `src/core/delivery/readiness.ts`, NEW `src/core/delivery/copy.ts`,
NEW `src/core/delivery/discord/fake-transport.ts` (scenario from
`BAKIN_DELIVERY_FAKE=ready:<guildIds>|reject-401|hang`; selected by
`loadDiscordModules()` only when `BAKIN_DELIVERY_TRANSPORT=fake`, with a loud
boot warning; never bundled into the compiled binary's default path),
NEW `packages/host/src/api/channels.ts`, `src/core/server/request-handler.ts`,
`tests/core/delivery/readiness-collect.test.ts`, `tests/api/channels.test.ts`,
`tests/core/delivery/fake-transport.test.ts`.
**Acceptance.**
- [ ] `getChannelReadiness()` sync after boot; refresh collects native list under 2 s with stale-beats-broken; `since` stable across refreshes; coalesced refreshes.
- [ ] GET snapshot (`?refresh=1`); reconnect 409 `owner_is_runtime` / 202 / join / `?wait=1`; verify 409 while connecting, item matrix per state, mocked send surface proves nothing sent, ends with targeted reruns; routing PUT replace semantics with add/rename/delete/reload.
- [ ] Every publish broadcasts the `plugin-event`.
- [ ] Fake transport honors each scenario and is refused without the gate env.
**Verify.** the tests `--isolate`; `/verify` boot: `curl /api/channels` ⇒ `disabled`; flip `enabled` via `POST /api/settings` ⇒ `missing_token` with no restart.
**Deps.** T3. **Size.** L.

### Checkpoint B — commits 3–4
- [ ] delivery + api suites, typecheck, lint; isolated boot flip proven.

### Phase 3 — Consumers

#### T5 Health projection, readiness-aware dependents, targeted reruns, two-mode onboarding
**Files.** `plugins/health/lib/system-checks/{delivery-discord,channel-aliases,channel-approvals}.ts`,
`plugins/health/index.ts` (subscribe → `runTargetedDiagnostics([...3])`, 1 s debounce),
`src/core/onboarding/credentials.ts` (server mode via `apiGet('/api/channels')` guarded by `isServerConnectionError`; config-only mode labeled),
`src/core/delivery/index.ts` (retire `isDeliveryBridgeConnected`),
tests `tests/plugins/health/{delivery-discord-check,channel-aliases-check,channel-approvals-check}.test.ts`, `tests/core/onboarding/channels-check.test.ts`.
**Acceptance.**
- [ ] delivery-discord: native-first branch order, keys per §4.7; native + token-less bridge block ⇒ healthy `idle`.
- [ ] aliases/approvals: not-applicable with the delivery-unavailable copy for bridge states ∉ {connected, degraded}; hrefs → `/settings?tab=channels`.
- [ ] Reproduction ⇒ exactly one incident across the three; a transition reruns all three within ~1 s; recovery ⇒ zero.
- [ ] Onboarding: server mode mirrors the snapshot; config-only mode labeled, never claims connected or "no channel layer".
**Verify.** tests `--isolate`; `/verify` boot → doctor report shows the single incident.
**Deps.** T4. **Size.** M.

#### T6 Post-channel memo-first, pre-flight, classified failures, outcome memo; alias resolver
**Files.** `src/core/exec-tools/tools/post-channel.ts`, `src/core/channel-aliases.ts`,
`src/core/delivery/copy.ts`, `tests/core/exec-tools/post-channel.test.ts`, `tests/core/channel-aliases.test.ts`.
**Acceptance.**
- [ ] Order: policy → memo lookup (signature without `list()`) → pre-flight → alias → once-per-task → chunks.
- [ ] A completed post AND a partial post (chunk 1 ok, chunk 2 `auth_failed`) retried verbatim while the bridge is `disconnected` return the saved result with `deduped: true`; no readiness error, no re-send.
- [ ] Pre-flight failure never memoized; retry after fix succeeds; every kind maps to its copy; results carry `chunksDelivered/chunkCount`.
- [ ] Alias resolver propagates `DeliveryError`; on `degraded` resolves against joined guilds; "no channel layer" only when the surface is absent.
**Verify.** tests `--isolate`.
**Deps.** T4. **Size.** M.

#### T7 adapter-pi behavior + conformance pin + teeth
**Files.** `packages/adapter-pi/src/runtime.ts`, `tests/adapter-pi/channel-bridge-delegation.test.ts` (behavior assertions),
`tests/integration/runtime-conformance/conformance.ts` (pin: threaded bridge ⇒ surface present), `teeth.conformance.test.ts`.
**Acceptance.**
- [ ] Unconfigured: surface present, `unavailable`, `list()` throws `not_configured`; configured+connected: `shimmed`, `credentialStatus().channels` lists labels.
- [ ] Teeth prove the new pin bites.
**Verify.** `bun test tests/adapter-pi tests/integration/runtime-conformance --isolate`; `bun run check:cycles`.
**Deps.** T4. **Size.** S.

#### T8 CLI `bakin channels` + `check --json`
**Files.** NEW `src/cli/commands/channels.ts`, `cli/bakin.ts`, `src/core/cli/registry.ts`
(rows, group `'Setup and config'`), `src/cli/commands/onboarding.ts` (`--json` for
`check <target>` and `check all`: structured `{ name, status, message, remediation?, details? }`
/ array; exit codes unchanged), NEW `tests/cli/channels-command.test.ts`,
`tests/cli/onboarding-check-json.test.ts`.
**Acceptance.**
- [ ] `status`/`verify`/`reconnect` outputs + exit codes per §4.5 incl. the three non-run states ⇒ 2.
- [ ] `check channels --json` and `check all --json` print JSON only; exit codes preserved.
- [ ] Unreachable server ⇒ standard "Cannot connect" path, never a local guess.
**Verify.** tests `--isolate`; `bun run cli/bakin.ts --help` lists the group.
**Deps.** T4, T5. **Size.** S.

#### T9 Switch report channels section + runtime page
**Files.** `src/core/runtime-switch.ts` (`channels` on `RuntimeSwitchResult` via the projector; both paths),
`src/core/switch-report.ts` (ownership copy), `packages/host/src/components/runtime/types.ts`
(`channels?`; stop narrowing `credentials.channels`), `runtimes-tab.tsx` (attention line + section; fallback payload `channels: null`),
`overview-tab.tsx` (row shows live state via `useJsonFetch('/api/channels')` + `usePluginEvent('channels.readiness')`, `PluginLink` to the tab),
tests `tests/core/switch-report.test.ts`, `tests/integration/runtime-switch-dryrun*.test.ts`, RTL for runtimes-tab/overview-tab.
**Patterns.** `runtimes-tab.tsx` ResultCards; `feedback/banner.stories.tsx — TonesAndActions`; `lists/key-value.stories.tsx — CanonicalUsage`.
**Acceptance.**
- [ ] Dry-run + real results carry `channels` with both-direction copy; `setup` non-empty when the target projects `missing_token`; `ready_to_connect` reads as "after restart".
- [ ] Runtimes tab section + Overview row render and link.
**Verify.** tests `--isolate`; `bun run ui:conformance --quick`.
**Deps.** T4, T7. **Size.** M.

### Checkpoint C — commits 5–9
- [ ] All touched suites; lint; typecheck; cycles.

### Phase 4 — Channels tab

#### T10 Channels settings tab, routing fields moved, browser fixture
**Files.** NEW `src/components/channels-tab.tsx` (+ `src/components/channels/*.tsx` subcomponents),
`packages/host/src/routes/settings.tsx` (bucket in `groupAndSortSchemas`, `RESERVED_CATEGORY_IDS`, synthetic entry, render branch with `highlightKey={fieldParam}`, `valuesUrl` skip),
`src/components/system-settings.ts` (REMOVE: `integrations.discord.*` ×7, `notifications.channel`, `approvals.channelAlerts`, `approvals.channel`; KEEP `approvals.requireRejectReason`; shrink `CSV_LIST_KEYS`),
`packages/host/src/components/runtime/capabilities-tab.tsx` (link → channels),
NEW `packages/host/tests/channels-tab.ui.fixture.tsx` (renders the tab in every readiness state at 375 px with 80-char names and snowflake ids through `PluginUiFixtureHost`),
`scripts/ui/verify-plugin-conformance.ts` (a host fixture entry — the runner is plugin-keyed today; extend the entry shape to allow a host fixture with a label; if that proves invasive, fallback = a Playwright spec in `tests/ui/browser/channels-tab.browser.pw.ts` driving an isolated server with `page.route` mocks for `/api/channels` — decision recorded in TODO at task start),
tests `tests/components/{channels-tab,settings-sort,settings-route-url-state,system-settings,settings-route-save}.test.*`,
`design-system/census.json` (regenerate).
**Patterns.** `recipes/settings-dashboard-pages.stories.tsx — SettingsCategories` (sections/rhythm),
`feedback/banner.stories.tsx — TonesAndActions`, `feedback/system-state.stories.tsx — StateMatrix / ScopeAndRecovery`,
`feedback/status-badge.stories.tsx — CanonicalUsage`, `lists/key-value.stories.tsx — CanonicalUsage` (status facts),
`lists/data-table.stories.tsx` (channel table), **ID list editors:** `primitives/input-group.stories.tsx — LocalSubmitAction`
(text entry + Add) composed with `lists/list-rows.stories.tsx — InteractiveRows` (rows with Remove buttons, `aria-label="Remove <id>"`),
`forms/form-composition.stories.tsx — SubmissionWorkflow` (settings form + `FormActions`), `primitives/select` for channel pickers
(options = enumerated channels; free-text `Input` fallback when `channels.source !== 'bridge'`).
Contract: `@makinbakin/sdk/ui`, `/patterns`, `/layout`, `/navigation` (`useQueryState`, `PluginLink`), `/hooks` (`useJsonFetch`, `usePluginEvent`).
**Acceptance.**
- [ ] Six sections per §4.11; StateMatrix RTL test renders every readiness state incl. native (runtime-owned list, idle annotation).
- [ ] Reconnect/Verify busy + disabled states; Verify rows link to owning fields via `?field=`.
- [ ] ID editors accept never-seen ids; alias add/rename/delete via `PUT /api/channels/routing`; settings save shows "reconnecting…" then the SSE-settled state.
- [ ] Browser fixture: keyboard traversal, 375 px no horizontal scroll, long identifiers truncate with full value on title/copy; axe clean.
- [ ] System & Alerts no longer shows the moved fields; deep links re-pointed; legacy-styles check passes with no new allowance.
**Verify.** RTL `--isolate`; `bun run ui:conformance --quick`; `bun run ui:test:conformance` (fixture) and inspect `test-results/bakin-ui/index.html`; `bun run ui:census:check`; `bun run ui:legacy-styles:check`; then `bun run ui:conformance` full.
**Deviation.** none expected; any gap gets the deviation template before implementation.
**Deps.** T2, T4, T5, T9. **Size.** L (one surface).

### Phase 5 — Proof and docs

#### T12 Readiness-agreement integration test (deterministic)
**Files.** NEW `tests/integration/channels/readiness-agreement.test.ts`, NEW `tests/helpers/isolated-server.ts`
(spawn `bun run server.ts serve` with temp `BAKIN_HOME` (`runtime.adapter: 'pi'`, discord enabled + one guild, guest search URL), temp `PI_HOME`, `BAKIN_SKIP_ONBOARDING_CHECK=1`, free port, `BAKIN_DELIVERY_TRANSPORT=fake`, `DISCORD_BOT_TOKEN` unset; kill by port).
**Runs.**
1. No token: `GET /api/channels` ⇒ `missing_token`; `POST /api/exec-tools/bakin_exec_post_channel` ⇒ missing-token copy; doctor ⇒ exactly `missing-token`; `bakin check channels --json` and `bakin channels status --json` spawned with `BAKIN_URL` and a DIFFERENT env (dummy `DISCORD_BOT_TOKEN` set) ⇒ the server's `missing_token`.
2. Same server, `BAKIN_DELIVERY_FAKE=reject-401`: POST a token to `/api/secrets` ⇒ poll until `failed`/`auth_failed`; incident `bridge-failed`; zero alias/approval incidents; `bakin channels reconnect` exits 1.
3. Fresh server with `BAKIN_DELIVERY_FAKE=ready:<guild>` and a stored token: `connected`; verify all-pass; zero incidents; `check channels --json` ⇒ ok.
**Risk.** Pi adapter construction in a throwaway home; if it needs auth, switch the temp settings to the dev-rig mock runtime via `BAKIN_RUNTIME_ADAPTER` if one is server-selectable, else record and fall back to in-process `createRequestHandler` with the plugin registry initialized (still real handlers, still spawned CLI processes).
**Verify.** `bun test tests/integration/channels --isolate`.
**Deps.** T5, T6, T8. **Size.** M.

#### T11 Docs sweep
**Files.** `.claude/knowledge/delivery-bridge.md`, `.claude/knowledge/pi-adapter.md` (channels + createThread/editMessage rows),
`.claude/knowledge/adapter-architecture.md`, `CLAUDE.md` (Discord bullet, `secrets.json` in the data-dir map), `docs/src/content/docs/using/essentials.md`,
regenerate `docs/src/content/docs/reference/generated/settings.md` (`bun run docs:generate`), `.claude/specs/discord-bridge/TODO.md`, README (none).
**Acceptance.** No doc still says the Pi surface is omitted when unconfigured, that a restart enables the bridge, or that `bakin check channels` runs locally.
**Verify.** `rg -n "OMITTED unless|restart the server|no channel layer" .claude/knowledge CLAUDE.md docs/src`; `bun run docs:check`.
**Deps.** all. **Size.** S.

### Checkpoint D — merge-ready
- [ ] `bun run test` full; then `bun run ui:conformance` full (sequential); lint; typecheck; cycles.
- [ ] Owner live runbook on 3737 (spec §10: token moved to the store, server relaunched without the env var; restore at the end).
- [ ] PR opened; merge after approval.

## Commit map (branch `feat/channel-readiness`)

| # | Commit | Tasks |
|---|---|---|
| 1 | `docs(spec): channel readiness v3 amendments + plan` | T0 |
| 2 | `feat(core): readiness types/classifier/projector, DeliveryError, secret-slot registry, change subscriptions` | T1 |
| 3 | `feat(secrets): slot status in /api/secrets, known-slot rows, shared secret field` | T2 |
| 4 | `feat(delivery): bridge status model, reconciliation loop, per-guild cache, error classification` | T3 |
| 5 | `feat(delivery): readiness collector, /api/channels, SSE, fake transport gate` | T4 |
| 6 | `feat(health): readiness projection, readiness-aware channel checks, targeted reruns, two-mode check` | T5 |
| 7 | `feat(exec-tools): post-channel memo-first retries, pre-flight, classified failures` | T6 |
| 8 | `feat(adapter-pi): permanent channels surface, credential channels, conformance pin` | T7 |
| 9 | `feat(cli): bakin channels + check --json` | T8 |
| 10 | `feat(runtime): channels section in the switch report + runtime page` | T9 |
| 11 | `feat(host): Channels settings tab, routing fields moved, browser fixture` | T10 |
| 12 | `test(integration): readiness agreement across API, tool, health, CLI` | T12 |
| 13 | `docs(delivery): channel readiness` | T11 |

Rollback: revert dependents in reverse order; never merge partially.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Unhandled manager `error` throws / hung `gateway.connect()` | High | Listeners at construction; race connect vs. gate; fake-manager tests |
| Stale attempt applies after a newer config | High | Generation per attempt, `isCurrent()` after every await, destroy-not-current in `finally`; A→B test |
| Bogus token classified `transport` not `auth_failed` | Med | REST 401 branch in `classifyConnectFailure`; unit test |
| Pi init in T12's throwaway home needs auth | Med | Fallbacks recorded in T12 |
| Host fixture entry unsupported by the conformance runner | Low | Playwright fallback named in T10 |
| Our own settings write re-triggers the watcher refresh | Low | Collector coalesces; bridge snapshot-key no-op |
| Raw-scale classes in new host files | Low | layout primitives only; `ui:legacy-styles:check` |
| Full suite + conformance concurrently wedges a worker | Med | Sequential only |

## Verification (end-to-end)

1. Per-task suites `--isolate`.
2. `/verify` isolated boots after T4 and T5 (flip `enabled`, watch the doctor).
3. T12 proves cross-surface agreement with two CLI processes and a deterministic transport.
4. Full `bun run test` → `bun run ui:conformance` full → cycles/lint/typecheck.
5. Owner live runbook on 3737.
