# Spec: Model Availability Reflects Account-Callable Reality (#852)

**Issue:** https://github.com/markhayden/bakin/issues/852
**Status:** approved 2026-09-19 (interview complete)
**Prior remediation:** #854 (SDK bump) fixed the instance, not the class. This spec fixes the class.

## Objective

A retired model (`openai-codex/gpt-5.4-mini`) stayed "available" for 10 days while four
subsystems failed, because the Pi adapter's `listAvailable()` stamps `available` from
provider-level OAuth (`hasConfiguredAuth`) over a static SDK catalog — nothing anywhere
observes a real call. Post-#854, the routing recommender *still* proposed the dead model.

We make availability reflect what the account can actually call, via three layers:

1. **Mark-on-rejection (core):** a typed model-rejection error, recorded durably, flips
   the model unavailable everywhere (health check, recommender, UI) — passively, on first
   real failure.
2. **Probe-on-refresh (opt-in, manual-only):** a 1-token probe per configured-provider
   model, fired only on explicit request. Zero scheduled runs — passive detection is the
   always-on layer; probing answers "is this model I'm *not* using still callable?"
3. **Resilient image carrier:** `codex-images` falls back configured → default instead of
   hard-failing billed calls, and rejections are attributed to the carrier (not
   `gpt-image-2`) and recorded as evidence.

Success looks like: the next model retirement is visible in Health within one failed turn,
is never proposed by the recommender, never hard-fails image generation on rung one, and
can be confirmed on demand with one click.

**Priorities:** single-user box, no backwards-compat shims, reduce tech debt, rock-solid
not overkill.

## Tech Stack

Existing stack only — Bun 1.3.13 (pinned), TypeScript strict, Zod at boundaries,
`bun:sqlite` via the ledger (sole importer rule). No new dependencies.

## Design Decisions (interview-locked)

### D1 — New `RuntimeErrorKind: 'model_not_supported'`
- Added to the union in `packages/core/src/adapters/runtime/errors.ts:11`. Semantics: the
  provider deterministically rejected the *model id* for this account. **Non-retryable /
  structural** — retrying a retired model is waste.
- `providerInfo.model` carries the **qualified** rejected id (`openai-codex/gpt-5.4-mini`).
- Compile-forced edits (exhaustive switches): `src/core/dispatch-failures.ts`
  (`classifyDispatchError` → structural; `classifyDispatchFailureDetail` → new
  `DispatchFailureReasonCode: 'model_not_supported'`; `formatSanitizedRuntimeFailure`),
  retry policy in `src/core/dispatch-state.ts` (non-retryable).
- Classification is **Pi-only** for now: new ladder branch in
  `packages/adapter-pi/src/errors.ts` (the one sanctioned string-sniffing site), inserted
  after the 401/403 branch, before transport — HTTP 400 + model-not-supported message
  shape. OpenClaw's classifier is untouched (its CLI already reports per-model `missing`;
  no verified rejection pattern to sniff — guessing risks false positives). Ambiguous
  errors keep falling to `runtime_failed` and never touch the rejection table.
- Side-fix A: Pi stream path (`packages/adapter-pi/src/messaging.ts:762`) must pass
  `model` into `toRuntimeError` (send path already does) **and** the terminal error
  chunk must carry the model: `data: { kind, model }`. Streams surface failures as
  chunks, not throws — `providerInfo` never crosses the boundary there, so without the
  chunk field the D3 wrapper would see a rejection it cannot attribute. Additive to the
  pinned chunk contract ("terminal error chunk carries the typed kind").
- Side-fix B: `codex-images.ts` error construction attributes rejections to the
  **carrier** model (qualified), not `CODEX_IMAGE_MODEL`.

### D2 — Durable store: `model_rejections` ledger table (migration v9)
In `packages/core/src/execution/ledger.ts`, sibling of `budget_incidents` (mirror its
pattern: UNIQUE-as-debounce, open/resolve lifecycle, partial index on live status):

```sql
CREATE TABLE model_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,                    -- qualified: provider/id
  provider TEXT NOT NULL DEFAULT '',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  detail TEXT,                            -- bounded provider-message excerpt
  status TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'resolved'
  resolved_at INTEGER,
  resolution TEXT,                        -- 'model_succeeded' | 'probe_succeeded' | 'manual'
  UNIQUE(model)
)
```

- **One row per model** (UNIQUE(model), reopen-on-conflict like `openBudgetIncident`);
  episode history lives in audit.
- Domain verbs in `ledger.ts`, re-exported through the `src/core/execution-ledger.ts`
  facade: `recordModelRejection`, `resolveModelRejection`, `listModelRejections({ openOnly })`.
- **Lifecycle self-heals:** any successful turn with that model auto-resolves
  (`model_succeeded`); probe success resolves (`probe_succeeded`); manual resolve exists
  but is never required.
- **Fail-open:** ledger unavailable ⇒ no models marked unavailable (opposite of the
  budget gate's fail-closed). Coordination facts only — never content.
- Flip threshold is **1 occurrence** — the verdict is deterministic and self-healing;
  requiring N delays detection.

### D3 — Single recording chokepoint: runtime facade wrapper
`createRuntimeAdapter()` in `src/core/runtime-adapter-factory.ts` is the verified single
composition point (covers `AppServices.runtime` AND every plugin `ctx.runtime` — same
instance). Wrap `messaging.send`, `messaging.stream`, `images.generate`, `images.edit`,
and `models.probe` (D5):

- **Rejection edge:** thrown `RuntimeError` with `kind === 'model_not_supported'` &&
  `providerInfo.model` — or, for streams, a terminal error chunk with
  `data: { kind: 'model_not_supported', model }` (see D1 side-fix A) ⇒ fire-and-forget
  `recordModelRejection` + `appendAudit('model.rejected', …)`; rethrow / pass the chunk
  through untouched (callers see today's error exactly).
- **Success edge:** call with an **explicit** model succeeds (send resolves / stream
  reaches done without an error chunk) ⇒ resolve-if-open (single cheap UPDATE; no
  happy-path write amplification) + `appendAudit('model.rejection_resolved', …)` when a
  row actually flipped. Inherit-model calls (no `args.model`) are not attributable — the
  actual model is adapter-private on success. Accepted: routed system classes and
  dispatch pass explicit models (the surfaces that burned), and probe covers the rest.
- Wrapper reads only the neutral contract (`kind`, `providerInfo`) — adapter boundary
  clean. Recording failures never mask or amplify the original error.
- No per-call-site recording anywhere else (dispatch, chat, six system-route call sites,
  images all inherit the wrapper).

### D4 — Availability overlay in the models plugin: flip, don't filter; never cached
In `plugins/models/lib/available-models.ts` (`fetchAvailableModels` /
`loadConfiguredModelsFromRuntime`), on **every read including cache-served reads**
(exactly the `withFreshTiers` precedent):

- Overlay open rejections: set `available: false` and stamp rejection info
  (reason/last-seen/occurrences) into the row's existing free-form `metadata` — **no new
  SDK `AvailableModel` field, no public-api churn**.
- **Flip, not filter:** consumers already gate on `available !== false`; the row stays
  visible so the UI can badge "rejected by account on <date>" and
  `includeUnavailable` consumers still see it.
- **Never persisted** into `available.json` or the in-memory cache — the ledger is the
  sole rejection truth; overlay recomputes per read. Ledger down ⇒ overlay skipped
  (fail-open, D2).
- Layering precedent verified: `plugins/models/lib/routes.ts:22` and `budget-routes.ts`
  already import ledger verbs from `src/core/execution-ledger`.
- Implementation notes (verified against code): the existing
  `available !== false` filter at `available-models.ts:49` drops **runtime-reported**
  unavailable rows before the merge (OpenClaw `missing`) and stays as-is — the overlay
  applies after the merge, so rejected rows survive with `available: false`. The
  `POST /refresh` handler (which bypasses `fetchAvailableModels`) must write caches
  pre-overlay and return the response post-overlay. The Available Models tab has never
  rendered an `available: false` row — the badge work handles that state explicitly.
- Free downstream effects: recommender (`recommendRoutes`) can no longer propose a
  rejected model (fixes the post-#854 `skill-mapping` regression); both
  `buildRoutingHealthDeps` wirings inherit the truth unchanged.
- Rejected placement alternative (core-level `listAvailable` wrap): worse — the plugin
  cache would freeze the overlay for up to 1h in both directions.

### D5 — Probe-on-refresh: manual-only, optional contract method
- **Trigger:** `POST /api/plugins/models/refresh` grows `{ probe?: boolean }`, default
  false. The UI background auto-refresh-on-stale path and the
  `models.refreshAvailableModels` hook stay probe-free. UI: explicit "Verify
  availability" action on the Available Models tab. **No scheduler, no cadence knob,
  zero automatic runs.**
- **Surface:** optional `models.probe(modelId)` on the runtime contract
  (`packages/core/src/adapters/runtime/concepts.ts` + SDK type) — OPTIONAL member,
  consumers feature-detect (same pattern as `channels`/`cron`; `.probe!.` banned). Pi
  implements via a minimal 1-token completion; OpenClaw omits. Probe outcomes ride the
  D3 wrapper — one evidence pipeline.
- **Scope:** only models whose provider has configured auth; bounded concurrency (2–3);
  short per-probe timeout; refresh response reports per-model
  `verified | rejected | skipped` honestly.
- **Accepted gap (documented, not engineered around):** probe usage (~1 token, manual)
  writes no `run_costs` row; it lands in usage.db's unattributed bucket.

### D6 — Health surface: sharpen only, no new repair
- `route-model-missing-${workClass}` (already `action_required`) now also fires when the
  routed model is account-rejected; evidence distinguishes **"not in catalog"** vs
  **"rejected by account (N failures, last …)"** with the ledger row's facts.
- No `reroute-dead-model` repair action — routing replacement is a judgment call; the
  navigate resolution to `/models?tab=routing` stands, and the recommender there is now
  trustworthy.

### D7 — Carrier fallback ladder (codex-images)
On `model_not_supported` from the carrier — and **only** that kind (never 429/401/5xx,
which risk double-billing a billed call):

1. Configured `settings.runtime.settings.images.carrierModel` (if set)
2. `DEFAULT_CARRIER_MODEL` (`gpt-5.6-luna`)
3. Stop — fail typed, correctly attributed, recorded via D3.

Each rejected rung records evidence. `metadata.carrierModel` (exists) is the receipt for
which carrier ran — silent-with-receipt is honest because carrier choice doesn't affect
the rendered image (`codex-images.ts:33-35`). Deliberately **no** registry-derived third
rung: the registry is the component that lied; two explicit rungs are predictable, and
both dying is an SDK-repin event that should fail loudly.

## Commands

```
Typecheck+lint:  bun run lint
Full suite:      bun run test           (CI: bun run test:ci)
Single file:     bun test tests/path/foo.test.ts --isolate
Dev server:      bun run dev            (server-side changes need manual restart)
Verify e2e:      /verify skill (isolated server; never the live 3737)
```

## Project Structure (files touched)

```
packages/core/src/adapters/runtime/errors.ts     — kind union + docs
packages/core/src/adapters/runtime/concepts.ts   — optional models.probe
packages/core/src/execution/ledger.ts            — migration v9 + verbs
packages/sdk/src/types/runtime.ts                — probe on the SDK runtime type
src/core/execution-ledger.ts                     — facade re-exports
src/core/dispatch-failures.ts                    — switches + reason code
src/core/dispatch-state.ts                       — non-retryable policy
src/core/<runtime facade composition>            — D3 observation wrapper (new module
                                                   src/core/model-availability.ts)
packages/adapter-pi/src/errors.ts                — classification branch
packages/adapter-pi/src/messaging.ts             — stream-path model attribution
packages/adapter-pi/src/models.ts                — probe implementation
packages/adapter-pi/src/codex-images.ts          — attribution + carrier ladder
packages/adapter-pi/src/images.ts                — ladder wiring
plugins/models/lib/available-models.ts           — rejection overlay
plugins/models/lib/health-checks.ts              — sharpened evidence
plugins/models/lib/routes.ts                     — refresh probe param
plugins/models/components/*                      — Verify action + rejected badge
tests/…                                          — see Testing Strategy
.claude/knowledge/…                              — see Docs Coverage
```

## Code Style

Repo conventions apply (strict TS, zod at boundaries, `createLogger`, no empty catch,
kebab-case files). Style anchor for the recording edge — best-effort, never masking:

```ts
// src/core/model-availability.ts
export function observeTurnFailure(err: unknown): void {
  if (!(err instanceof RuntimeError) || err.kind !== 'model_not_supported') return
  const model = err.providerInfo?.model
  if (!model) return
  try {
    recordModelRejection({ model, provider: err.providerInfo?.provider ?? '', detail: bounded(err.message) })
    appendAudit(getContentDir(), 'model.rejected', 'system', { model, provider: err.providerInfo?.provider })
  } catch (recordErr) {
    log.warn('model rejection not recorded (ledger unavailable?)', { model }, recordErr)
  }
}
```

## Testing Strategy

bun test, `--isolate`, standard content-dir/OpenClaw-home/logger mocks per CLAUDE.md.
Ledger tests call `closeDb()` before temp-dir cleanup.

- **Pi classification** (`tests/adapter-pi/`): `toRuntimeError` gets its first direct
  coverage — the 400 model-not-supported shape → `model_not_supported` + qualified
  `providerInfo.model`; ambiguous 400 stays `runtime_failed`; stream terminal error
  chunk carries `data: { kind, model }` (check the runtime-conformance suite's stream
  assertions for additive impact).
- **Ledger verbs** (`tests/core/`): record/reopen (UNIQUE debounce, occurrences++),
  resolve-on-success, fail-open on unavailable ledger.
- **Facade wrapper**: rejection recorded + rethrown identically; success resolves open
  row; recording failure never alters the surfaced error.
- **Dispatch classification** (`tests/core/dispatch-error-classification.test.ts`):
  structural + non-retryable + sanitized formatting for the new kind.
- **Overlay** (`tests/plugins/models/`): cache-served reads reflect a rejection recorded
  *after* the cache write (the `withFreshTiers`-style test at
  `models-cache.test.ts:134` is the template); flip-not-filter; nothing persisted to
  `available.json`; ledger-down ⇒ all available.
- **Health/recommender** (`tests/plugins/models/health-checks.test.ts`): rejected model
  excluded from proposals; `route-model-missing` fires with account-rejected evidence.
- **Probe** (`tests/plugins/models/routes.test.ts` + adapter-pi): `probe: true` only
  probes configured providers; runtimes without `models.probe` report `skipped`; probe
  outcomes hit the same ledger; background-refresh path never probes.
- **Carrier ladder** (via `CodexImageOptions.fetchImpl` seam, template
  `tests/integration/pi/images-shim.test.ts`): rejection on rung 1 → rung 2 succeeds +
  `metadata.carrierModel` truthful; 429/401/5xx never ladder; both rungs rejected →
  typed failure naming the carrier.
- **Architecture**: new classification branch stays inside `packages/adapter-pi` (the
  `.message`-ban scan roots already exclude adapters); no `.probe!.` usage.

## Docs Coverage (mandatory, same PR as the code they describe)

- `.claude/knowledge/models-plugin.md` — availability truth model (catalog vs
  account-verified), rejection overlay, probe semantics, sharpened health evidence.
- `.claude/knowledge/execution-ledger.md` — `model_rejections` table + lifecycle.
- `.claude/knowledge/runtime-capabilities.md` — optional `models.probe`, feature-detect.
- `.claude/knowledge/pi-adapter.md` — classification branch, stream-path fix, carrier
  ladder.
- `.claude/knowledge/dispatch.md` — new failure reason code + retry posture.
- `CLAUDE.md` — one-line touch-ups: Models Cache + Catalog bullet (availability is
  account-verified via rejection ledger), Dispatch bullet (kind list if enumerated).
- `README.md` — reviewed; expected no impact (no user-facing install/CLI surface
  changes). Confirm during build.
- Issue #852 — close with a summary comment mapping proposals → shipped behavior.

## Boundaries

- **Always:** run `bun run lint` + full suite before push; classify on `kind` never
  message text outside adapters; ledger = coordination facts only; fail-open on ledger
  unavailability for availability truth; every rejection/resolve edge audited.
- **Ask first:** any new scheduled/automatic probe execution; adding fields to the SDK
  public API; touching OpenClaw's classifier; any additional repair action.
- **Never:** persist rejection state in the models cache; add a parallel spend/stat
  system for probes; retry billed image calls on non-rejection errors; block send paths
  on availability (advisory surfaces only); backwards-compat shims.

## Success Criteria

1. A turn failing with the provider's model-not-supported verdict produces, within that
   single failure: an open `model_rejections` row, an audit event, `available: false` on
   the models surface, and (if routed) an `action_required` health finding whose
   evidence says "rejected by account".
2. `POST /routing/recommend` can never propose a model with an open rejection.
3. A subsequent successful turn (or probe) with that model auto-resolves the row and
   restores availability with no manual step.
4. "Verify availability" probes exactly the configured-provider models, updates the
   ledger both directions, and reports per-model verdicts; no probe ever fires from
   background refresh or any schedule.
5. Image generation with a retired configured carrier succeeds via the default carrier
   with a truthful `metadata.carrierModel`; both-rungs-dead fails typed, named, recorded.
6. Ledger down ⇒ zero models marked unavailable; suite green; lint clean.

## Open Questions

None blocking — interview resolved the tree. Deferred by decision: OpenClaw rejection
patterns (no verified shape), reroute repair action (judgment call belongs to the human),
probe scheduling (passive layer covers it).
