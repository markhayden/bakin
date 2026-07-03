# SPEC: Zero-Config Enrichment — Runtime-Turn Fallback

**Status:** Draft — awaiting approval
**Date:** 2026-07-03
**Follows:** `.claude/specs/search-asset-rebuild.md` (D8 enrichment is live; this extends it)
**Driver ask:** "support all of the above, but in a perfect world it wouldn't take a ton of custom configuration."

## 1. Objective

Asset enrichment (captions/OCR/tags/summaries) should work **out of the box on any Bakin machine**, using whatever capability already exists, in this order of preference — with configuration only ever *overriding*, never *required*:

```
auto (default):
  1. Direct vision API key          → direct-vision-provider (today's path)
     (env → secret store; haiku → gemini-flash → sonnet/gpt-4o → gemini-pro)
  2. No key, runtime vision-capable → ONE-SHOT AGENT TURN through ctx.runtime
     (the runtime's own auth pays — ChatGPT OAuth, Claude sub, whatever it has)
  3. Neither                        → skipped with reason (today's behavior)
```

A Bakin box always has a configured runtime (that's what Bakin is), so step 2 makes enrichment effectively zero-config. The direct path stays preferred when a key exists: it's cheaper per call, faster, structurally validated, and doesn't consume agent-subscription quota.

## 2. Why this respects the adapter boundary

Bakin **never touches runtime credentials**. The runtime-turn path sends a message through `ctx.runtime.chat.send()` and parses the reply — the runtime owns its OAuth tokens, refresh, and model routing, exactly as it does for every other agent turn. (Directly borrowing OpenClaw's ChatGPT OAuth token for platform-API calls is explicitly rejected: different auth system, ToS-gray, breaks on rotation, crosses the boundary.)

## 3. The upstream gate: image input

`MessageArgs` (packages/core/src/adapters/runtime/concepts.ts:63) is **text-only**. The runtime path needs the image to reach the agent's model. Two transports, in preference order:

- **T1 — native attachments (preferred):** `MessageArgs` gains optional `attachments?: Array<{ path: string; mimeType: string }>`; the OpenClaw adapter maps them to OpenClaw's message-attachment mechanism. **Requires an upstream OpenClaw feature if none exists — Phase 0 verifies what OpenClaw supports today and files the ask if needed.** Contract-level change is adapter-neutral (any runtime can implement).
- **T2 — agent-tool ingestion (fallback):** the prompt hands the agent the absolute file path and instructs it to view the image with its own tooling (OpenClaw agents with vision models + a read-image tool can do this today, machine-dependent). Works with zero upstream changes where the tooling exists; brittle where it doesn't. Ships only behind the capability probe (below) and only if Phase 0 shows T1 is far away.

**Capability probe:** `RuntimeAdapter` gains `capabilities(): { imageInput: boolean; audioInput: boolean }` (adapter-declared, conservative-false default). The resolution ladder consults it; the doctor's enrichment check reports it ("runtime path: available via main / unavailable — no image input"). No heuristics, no guessing from model names in core (D17 discipline applies to the runtime adapter too).

## 4. Bakin architecture

- **One engine interface, two implementations.** `plugins/assets/lib/enrichment/engine.ts`: `EnrichmentEngine = (input: { mediaPath?, mimeType, extractedText?, kind }) => Promise<AssetEnrichmentResult>`. `direct.ts` wraps today's `direct-vision-provider`; `runtime.ts` is new. The queue, triggers, manifest apply-chokepoint, idempotency guard (`done + forVersion`), retry policy, and `userEdited` protection are **unchanged** — engines are interchangeable below the queue.
- **Runtime engine mechanics:** one-shot `ctx.runtime.chat.send({ agentId, threadId: 'enrich:<assetId>:v<version>', message, attachments? })` — a fresh thread per asset+version (no context pollution, idempotent replays land on the same thread). The prompt demands **pure JSON** matching the existing Zod schema (`{caption, ocrText, suggestedTags, summary?, transcript?}`), same OUTPUT-DISCIPLINE style the dispatch prompts use. Reply → strip fences → Zod parse. Parse failure = ONE corrective re-ask ("reply with only the JSON object"), then `failed` — never fabricated.
- **Agent selection:** the runtime's main/default agent (`getMainAgentId()` — the resolver exists). Optional `enrichmentAgent` setting overrides. No new required config.
- **Settings surface (unchanged shape, one new value):** `enrichmentProvider: 'auto' (default) | 'anthropic' | 'openai' | 'google' | 'runtime' | 'off'`. `auto` = the ladder above; explicit values pin one path (and `runtime` lets a keyed machine still prefer subscription usage if the user wants).
- **Audio:** stays direct-provider-only (Gemini) unless the runtime declares `audioInput`. Skipped-with-reason otherwise, as today.

## 5. Cost & quota guardrails

Runtime turns spend the user's **subscription quota** and are much slower than API calls (a full agent turn each). Rules:
- Organic enrichment (asset created/edited): fine, one turn per asset, queue already serializes.
- **Backfill (`bakin assets enrich --all`) over the runtime path:** print an up-front notice (`N assets via agent turns on <agent> — this uses your subscription quota and takes ~Xs each; ctrl-c to abort, or add an API key for the fast path`), process serially, show progress. No parallelism ever.
- `recordUsage({ name: 'assets.enrich', meta: { engine: 'direct' | 'runtime', model } })` so telemetry distinguishes the paths.
- Doctor enrichment check reports which engine is active and why.

## 6. Testing

- Engine-contract tests shared across both implementations (same fixture → same schema out); runtime engine tested against a mocked `ctx.runtime.chat.send` (happy JSON, fenced JSON, garbage → corrective re-ask → failed).
- Ladder tests: key present → direct; no key + capability → runtime; neither → skipped(reason).
- Capability plumbing: mock runtime adapter with/without `imageInput`.
- NO live agent calls in tests (same rule as billed provider calls).
- The dockerized OpenClaw rig is the pre-ship integration check for T1 once upstream support exists.

## 7. Phases

- **P0 — feasibility (small):** inspect OpenClaw's current message/attachment + image-tool surface (source + dockerized rig); decide T1-now vs upstream-ask vs T2-interim; file the upstream issue if needed. *Everything below gates on this verdict.*
- **P1 — plumbing:** `RuntimeAdapter.capabilities()` (+ OpenClaw impl, conservative), engine interface extraction (pure refactor of the direct path), `enrichmentProvider: 'runtime' | 'auto'` ladder with runtime step returning "unavailable" until P2.
- **P2 — runtime engine:** transport per P0's verdict, structured-output parse + corrective re-ask, backfill quota notice + serial progress, doctor/telemetry engine reporting.
- **P3 — polish:** docs (`assets-versioning.md`, `search-plugin-guide` enrichment section, CLAUDE.md one-liner), settings UI copy explaining the ladder.

## 8. Boundaries

**Always:** runtime path goes through `ctx.runtime` only; manifest writes through the existing apply-chokepoint; skipped/failed states carry reasons.
**Ask first:** shipping T2 (tool-ingestion) as anything other than a stopgap; any change to backfill parallelism.
**Never:** reading `~/.openclaw` credentials from Bakin; fabricating enrichment fields; silent quota consumption (the backfill notice is mandatory); model-name heuristics in core.

## 9. Open items (resolved in P0)

- What OpenClaw's message API actually accepts today (attachment? image tool? neither).
- Whether `chat.send` one-shot threads bypass agent memory/journaling in a way that would pollute the agent's session history (if so: a dedicated utility-thread convention or a runtime "ephemeral turn" flag joins the upstream ask).
- Per-turn latency on this machine's agents (informs the backfill ETA display).
