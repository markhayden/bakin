# Spec: OpenClaw 2026.9.5 Override-Scope Gate (#880)

**Issue:** https://github.com/markhayden/bakin/issues/880
**Status:** approved 2026-09-20 (interview complete)
**Sibling breakage:** #873 (agents.entries). **Related filed, out of scope:** #881 (search
honesty gaps), #855 (SVG enrichment).

## Objective

OpenClaw 2026.9.5 gates per-turn provider/model overrides behind `operator.admin`
scope (`resolveAllowModelOverrideFromClient`: raw `connect.scopes.includes('operator.admin')`
— no scope implication; `write` no longer suffices; `Boolean(request.provider || request.model)`
trips it, and Bakin sends `model` on every routed turn). Bakin's chat gateway client
connects with `['operator.read','operator.write']` (`adapter-openclaw/runtime.ts:2062`),
so every routed turn fails `INVALID_REQUEST` instantly. Live impact (prod,
2026-09-20): enrichment 242 err/hr → attempt-capped queue → empty captions → visual
leg starved 4/248 → asset search degraded to keyword-only garbage. Nothing surfaced
it — Health stayed green; diagnosis required grepping server.log.

Success: routed turns work again on OpenClaw; an install that CANNOT get admin
degrades to agent-default models with receipts and a Health finding instead of
failures; the class (runtime refuses overrides) can never again be invisible.

**Prod carries a workaround** (`routing.routes: []`) — restoring prod's work-class
routes after this ships is part of done.

## Ground truth (from OpenClaw 2026.9.5 bundled source + in-repo probe)

- Grant policy: a `gateway-client`+`backend` client on loopback with the shared
  token rides the **self-pairing bypass** — requested scopes are granted with NO
  scope check (`shouldSkipLocalBackendSelfPairing`). Off that path, admin is a
  pairing **scope-upgrade**: silently auto-approved when non-remote + token auth +
  `autoApproveLocal` not disabled; otherwise the CONNECT FAILS `NOT_PAIRED` until an
  operator approves (or `gateway.auth.identityScopes` grants it).
- OpenClaw's own CLI requests admin by default (`CLI_DEFAULT_OPERATOR_SCOPES`), and
  ships a reactive `callGatewayWithScopeEscalation` precedent.
- No config knob re-enables overrides for non-admin wire callers.
- The hello-ok ACK returns the authoritative granted set (`auth.scopes`) — Bakin
  currently discards it (`gateway-rpc.ts:262-279`).
- In-repo probe (tasks/evidence-enrichment-runtime.md:169, 2026-07-03): adding
  admin on the loopback device-authed connection works, no extra pairing.
- Requested scopes are FIELD 6 of the signed v3 device payload — scope changes are
  a full reconnect, never per-request.

## Design Decisions (interview-locked)

### D1 — Turn posture: clamp-and-proceed with receipt, uniform (Q1)
When per-turn model overrides are unauthorized, EVERY turn kind (dispatch + all
system classes) sends on the agent's default model with a `modelClamp` receipt —
the structural clone of the existing `thinkingClamp` (`ResolvedTurn.thinkingClamp`,
`applyThinkingCapability`, the `task.routed` audit): clamp-and-warn + audit +
standing Health escalation, never a silent drop, never a dead pipeline. Rejected
alternative (fail-fast typed): honest but brittle — a runtime policy change bricks
every routed subsystem, which is literally this incident.

### D2 — Scope acquisition: optimistic-admin with graceful downgrade (Q2 = option C)
- The chat gateway client requests `['operator.read','operator.write','operator.admin']`.
  On Bakin's default topology (loopback backend) this is granted first try — zero
  cost, empirically proven.
- If the CONNECT itself is refused over scopes (`NOT_PAIRED` scope-upgrade path):
  reconnect once WITHOUT admin and mark overrides unauthorized (sticky for the
  process; a later successful admin connect clears it). A hostile topology degrades
  to exactly today's working connection — never an outage.
- The approval-gateway client keeps `['operator.approvals']` (no overrides needed).
- Rejected: bare one-liner (connect outage risk off-loopback); reactive-only
  escalation (guaranteed failed turn + reconnect churn on the happy path).

### D3 — Granted-scope truth + dynamic capability
- `gateway-rpc` parses `auth.scopes` from hello-ok and exposes the granted set;
  `formatGatewayErrorDetails` widens to keep scope evidence
  (`missingScope`/`requiredScopes`/`requestedScopes`/`approvedScopes`).
- `RuntimeRoutingSupport` gains `perTurnModel: boolean`. Pi: `true` (static).
  OpenClaw: DYNAMIC — derived from the last connect's granted scopes, optimistic
  `true` before first connect (routing config must not be spuriously clamped at
  boot). Mock/testing shapes updated.
- Core pre-send clamp lives INSIDE `applyThinkingCapability` (double-check finding:
  both `resolveSystemRoute` AND dispatch's `resolveDispatchRouting` already funnel
  through it — zero new call sites): when `perTurnModel === false`, clear `model`
  and stamp `modelClamp: { requested, reason: 'override_denied' }` on the
  `ResolvedTurn`.
  Audited via the existing `task.routed` shape (+ requestedModel/clamped fields);
  run receipts record the ACTUAL model (already true — spend attribution unaffected).

### D4 — Mid-session race: adapter-internal single retry, no new public error kind
If a send/stream is admission-rejected with the override message while we believed
overrides were authorized (policy changed mid-session): the adapter (a) flips its
authorization state (capability now reports false → all later turns clamp pre-send
in core), (b) retries the SAME turn once without `model` — admission rejection
happens before any billing or session side effect, so the retry is safe — and
(c) stamps the clamp on the result (`metadata.modelOverrideDenied: { requested }`)
so the turn SUCCEEDS with a receipt instead of failing. Detection is
message-shaped and confined to the adapter's sanctioned interpretation site
(errors.ts / the gateway response handler).
Rejected: a new `RuntimeErrorKind` — with the retry, core never needs to classify
this; and mapping it to `model_not_supported` is explicitly forbidden (it would
write false rows into #852's model_rejections ledger for a healthy model).
Residual failures of the retry itself classify as whatever they are.

### D5 — Visibility: first OpenClaw adapter health check + models.routing awareness
- `createOpenClawHealthChecks()` (the `createPiHealthChecks` shape; factory's
  `case 'openclaw'` currently returns `[]`): a check that reports granted scopes vs
  need — `action_required` when work-class routes exist but overrides are
  unauthorized; healthy otherwise. Resolution: instructions (pair the device with
  admin / `gateway.auth.identityScopes`) — no auto-repair (pairing is a human act).
- `models.routing` health check (`buildRoutingHealthDeps`) additionally reads
  `routingSupport().perTurnModel`: routes configured + overrides unauthorized ⇒ the
  standing-clamp finding (same family as thinking clamps).
- Enrichment queue behavior needs no change (MAX_ATTEMPTS=2, no backoff): with D3/D4
  the turns SUCCEED clamped; the raw-error-string-into-activity leak dies with the
  failures.

### D6 — Conformance: per-turn-model honesty check
Mirror of `thinkingLevelHonesty`: a runtime whose `routingSupport().perTurnModel`
reports true must accept a turn carrying `model`; reports-false targets are
skipped-with-reason (an install legitimately without admin must not fail
conformance). Would have caught #880 at conformance time. Runs against mock, Pi,
and the OpenClaw target; teeth file proves it bites.

## Tech Stack / Commands / Structure

Existing only. `bun run lint`, `bun run test` (CI `test:ci`), single file
`bun test <path> --isolate`, conformance `bun test tests/integration/runtime-conformance/ --isolate`.

Files: `packages/adapter-openclaw/src/{gateway-rpc,device-auth,runtime,errors}.ts`,
new `packages/adapter-openclaw/src/health-checks.ts` (+ index export),
`packages/core/src/adapters/runtime/concepts.ts` + `packages/core/src/adapters/runtime/testing.ts`
(verified: RuntimeRoutingSupport has NO SDK mirror — zero SDK/public-api churn), `packages/adapter-pi/src/models.ts`
(perTurnModel: true), `src/core/system-route.ts` + `src/core/model-routing.ts`
(modelClamp), `src/core/dispatch-turns.ts` (audit fields),
`src/core/runtime-adapter-factory.ts`, `plugins/models/lib/health-checks.ts`,
`tests/integration/runtime-conformance/conformance.ts`, tests per below.
NO changes to: installer, enrichment queue, search plugins (#881 is separate).

## Code Style

Repo conventions. Anchor — the pre-send model clamp mirrors the thinking clamp:

```ts
// src/core/system-route.ts (sibling of applyThinkingCapability)
if (route.model && !support.perTurnModel) {
  log.warn('Model route clamped: runtime refuses per-turn overrides', { workClass, requested: route.model })
  const next: ResolvedTurn = { ...route, modelClamp: { requested: route.model, reason: 'override_denied' } }
  delete next.model
  return next
}
```

## Testing Strategy

- **gateway-rpc** (`tests/adapter-openclaw/gateway-rpc.test.ts`): connect frame
  carries admin; hello-ok `auth.scopes` parsed + exposed; scope-refused connect
  (`NOT_PAIRED` scope-upgrade shape) → one downgrade reconnect without admin +
  unauthorized state; details widening keeps `missingScope`.
- **device-auth** (`device-auth.test.ts`): signed-payload fixture updates (scopes
  are field 6); downgrade path signs the reduced set.
- **runtime**: admission-rejection race → capability flip + single retry without
  model + `metadata.modelOverrideDenied`; no double-send when the retry succeeds;
  `routingSupport().perTurnModel` reflects granted scopes (true when admin, false
  after downgrade, optimistic before connect).
- **core clamp** (`tests/core/system-route.test.ts` + dispatch routing tests):
  perTurnModel=false clears model + stamps modelClamp for system routes AND
  dispatch; audit carries requested/clamped; perTurnModel=true is a no-op.
- **health**: openclaw adapter check registers (flip
  `tests/core/runtime-adapter-health.test.ts:17` from `[]`); action_required when
  routes exist + unauthorized; models.routing standing-clamp finding.
- **conformance**: perTurnModel honesty check + teeth; skip-with-reason for
  reports-false targets; scope-set pins in runtime-stream/channels tests updated.
- **Live (this box, openclaw active):** routed turn carries model end-to-end after
  the scope change (the #880 repro reversed); then PROD: deploy, restore work-class
  routes, confirm enrichment stays green WITH routes restored.

## Boundaries

- **Always:** provider-string interpretation only in adapter errors.ts/response
  handling; clamps always leave a receipt + audit; granted scopes are the only
  authorization truth (never assume); lint + suite before push.
- **Ask first:** requesting scopes beyond admin; any auto-repair that touches
  OpenClaw pairing state; changes to enrichment queue behavior.
- **Never:** map override rejection to `model_not_supported` (poisons the #852
  rejection ledger); silent clamps (no receipt); retry an admission-ACCEPTED turn
  (double-bill risk — only admission REJECTIONS retry); break the approvals client.

## Success Criteria

1. On this box (loopback OpenClaw): connect granted admin; a routed turn with an
   explicit model completes; `routingSupport().perTurnModel === true`.
2. Simulated no-admin install: connect succeeds via downgrade; routed turns
   complete on agent defaults with modelClamp receipts + audit; Health shows
   action_required with pairing remediation; nothing retries in a loop.
3. Mid-session policy flip: the in-flight turn succeeds via single adapter retry
   with `metadata.modelOverrideDenied`; subsequent turns clamp pre-send.
4. Conformance: perTurnModel honesty green on mock/pi/openclaw; teeth bite.
5. Prod after deploy: work-class routes RESTORED, enrichment + routed classes green
   with routing active (the #880 memory workaround retired).
6. Full suite + lint green; zero changes outside the listed files.

## Open Questions

None blocking. Deferred: #881 (search honesty), #855 (SVG enrichment), upstream
attachment-gate quirks noted in tasks/evidence-enrichment-runtime.md.
