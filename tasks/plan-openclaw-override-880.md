# Implementation Plan: OpenClaw Override-Scope Gate (#880)

**Spec:** `.claude/specs/openclaw-override-scope-880.md` (approved 2026-09-20)
**Branch:** `fix/880-override-scope`, cut from `main` in the MAIN checkout (this box
runs adapter=openclaw live on 3737 — the perfect live-test rig; Mark verifies before
merge). **Done includes prod:** deploy + RESTORE prod's cleared work-class routes.

## Dependency Graph

```
T1 capability contract (perTurnModel on RuntimeRoutingSupport + pi/mock/openclaw-static)
 ├── T2 core clamp in applyThinkingCapability (modelClamp receipt + audit)
 ├── T3 gateway-rpc: request admin, parse auth.scopes, downgrade reconnect,
 │      widen error details                        (adapter-local)
 │     └── T4 runtime.ts: dynamic perTurnModel from granted scopes +
 │            mid-session admission-rejection retry (D4)
 │           └── T5 health checks (adapter check + models.routing awareness)
 └── T6 conformance perTurnModel honesty + teeth
T7 live verify (this box) → T8 docs + gate + PR → merge → T9 prod deploy + route restore
```

## Commit Strategy

| # | Commit | Rollback note |
|---|--------|---------------|
| 1 | `feat(runtime): perTurnModel routing-support declaration` | Additive contract field; adapters static (openclaw optimistic-true) |
| 2 | `feat(core): clamp routed models the runtime refuses (modelClamp receipt)` | Depends 1; no-op while every adapter reports true |
| 3 | `feat(adapter-openclaw): request operator.admin with graceful downgrade` | Adapter-local; revert restores read+write connect |
| 4 | `feat(adapter-openclaw): dynamic perTurnModel + admission-rejection retry` | Depends 1+3 |
| 5 | `feat(adapter-openclaw): first adapter health check — override authorization` | Depends 4 |
| 6 | `test(conformance): per-turn model honesty check + teeth` | Depends 1 |
| 7 | `docs(knowledge): override-scope posture (runtime-capabilities, adapter-arch, dispatch)` | Docs only |

Rules: lint + touched tests per commit; full suite at Checkpoints A (post-T4) and B
(post-T6). Never stage generated files. Attribution lines per repo standard.

## Tasks

### T1: `perTurnModel` contract (commit 1) — S
`concepts.ts` RuntimeRoutingSupport + doc ("dynamic values allowed — OpenClaw derives
from granted scopes"); pi `models.ts` true; openclaw `runtime.ts:1061` true (static
until T4); testing mock true. Accept: typecheck-forced updates compile; conformance
targets expose the field. Verify: `bun test tests/adapter-openclaw/ tests/adapter-pi/ tests/integration/runtime-conformance/ --isolate`.

### T2: Core clamp (commit 2) — S
`model-routing.ts` `ResolvedTurn.modelClamp?: { requested: string; reason: 'override_denied' }`;
`applyThinkingCapability` clears model + stamps when `perTurnModel === false`
(fail-open on errors, same as thinking); `dispatch-turns.ts` task.routed audit gains
`requestedModel`/`modelClamped`. RED tests in `tests/core/system-route.test.ts` +
dispatch routing tests. Accept: false ⇒ model cleared + receipt for system AND
dispatch routes; true ⇒ byte-identical behavior.

### T3: Gateway client scopes + downgrade (commit 3) — M
`gateway-rpc.ts`: `scopes: [read, write, admin]` for the chat client (runtime.ts:2062);
parse hello-ok `auth.scopes` → expose `grantedScopes()`; connect failure whose code
is NOT_PAIRED (scope-upgrade shape) ⇒ one reconnect with admin removed + sticky
`overridesAuthorized=false` surface; `formatGatewayErrorDetails` keeps
missingScope/requiredScopes/requestedScopes/approvedScopes. Update device-auth signed
payload fixtures (scopes = field 6) + gateway-rpc/runtime-stream/channels scope pins.
Accept: admin in connect frame; granted set readable; downgrade path signs reduced
set; approvals client untouched.

### T4: Dynamic capability + race retry (commit 4) — M
`runtime.ts`: `routingSupport().perTurnModel` reads the chat client's authorization
state (optimistic true pre-connect; false after downgrade or admission rejection).
`runOpenClawAgentGateway`: on the override-rejection admission error with
`params.model` set — flip state, retry once without model/thinking-override…
(model only; thinking unaffected by this gate), stamp
`metadata.modelOverrideDenied: { requested }` on the result. Never retry an
admission-ACCEPTED turn. Accept: race turn succeeds with receipt; second turn clamps
pre-send (capability false); no double-send.

### CHECKPOINT A — full lint + suite

### T5: Health visibility (commit 5) — M
New `packages/adapter-openclaw/src/health-checks.ts` (+ index export; factory case
'openclaw' returns it; flip `tests/core/runtime-adapter-health.test.ts:17`):
`runtime.openclaw-override-authorization` — healthy when authorized OR no routes
configured; action_required (instructions resolution: pairing/`identityScopes`) when
routes exist + unauthorized. `plugins/models/lib/health-checks.ts`: standing
model-clamp finding when routes configured and `perTurnModel === false` (same family
as thinking clamps). Accept: check registers, fires correctly, resolution text names
both remediation paths.

### T6: Conformance honesty (commit 6) — S
`conformance.ts`: `perTurnModelHonesty` — targets reporting true must accept a turn
carrying `model`; reporting false ⇒ skip-with-reason. Teeth case. Accept: green on
mock/pi/openclaw targets; teeth bite.

### CHECKPOINT B — full suite + lint + `check:cycles`

### T7: Live verification (this box, read+real turn)
Server restart onto branch; confirm connect granted admin (log/grantedScopes);
routed chat turn with explicit model completes end-to-end (the #880 repro reversed);
health check healthy. THEN simulate no-admin (temporarily request-without-admin via
test override or unit-level only — do NOT break the live gateway pairing).

### T8: Docs + gate + PR (commit 7)
`runtime-capabilities.md` (perTurnModel + dynamic-value note), `adapter-architecture.md`
(scope posture: optimistic-admin + downgrade; never map override rejection to
model_not_supported), `dispatch.md` (modelClamp receipt), CLAUDE.md Key Patterns
touch-up if the routing bullet enumerates clamp kinds. README: no impact expected —
confirm. PR references #880 with live evidence.

### T9: Post-merge prod closeout
Prod deploy (next release or binary update), **restore prod work-class routes**
(the #880 memory workaround), confirm enrichment + routed classes stay green WITH
routing active, close #880, update memory.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Admin request breaks THIS box's live connect | High | Loopback self-pairing bypass grants unchecked (verified in 9.5 source + July probe); T7 restarts under watch; downgrade path is the safety net |
| Signed-payload drift (scopes field 6) breaks device auth | Med | device-auth fixtures updated in the same commit; live T7 exercises the real signature |
| Dynamic routingSupport surprises consumers caching it | Low | Consumers call it per-resolve today (system-route, health); no caching found in exploration |
| Retry double-bills | Med | Retry ONLY on admission rejection (pre-billing, turn never started); boundary pins it |
| Conformance check flakes installs without admin | Low | skip-with-reason keyed on the DISCOVERED capability |
