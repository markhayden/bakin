# Evidence: Enrichment Runtime-Turn Fallback — P0 Feasibility Probe

**Date:** 2026-07-03
**Spec:** `.claude/specs/enrichment-runtime-fallback.md` (Phase 0)
**Question:** Can a one-shot runtime agent turn receive an IMAGE today, and by which transport?
**Method:** Read-only inspection of the Bakin adapter, the installed OpenClaw (`/opt/homebrew/lib/node_modules/openclaw`, v2026.6.9 c645ec4, shipped `dist/` + `docs/`), `~/.openclaw` config (no secrets), and public docs/issue tracker. No messages sent, nothing started or stopped.

---

## Verdict (one paragraph)

**T1 is feasible NOW at the RPC level — the gateway's `agent` method already accepts an `attachments` array and inlines images into the model turn — but it is blocked on THIS machine by a model-catalog capability gate:** the configured agent models (`openai/gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, all via ChatGPT OAuth `openai-chatgpt-responses`) are declared `input: "text"` in the live gateway catalog, and the gateway hard-rejects image attachments for text-declared models (`"active model does not accept image inputs"`). T2 (agent-tool ingestion) exists in the form of OpenClaw's built-in `read` tool, which natively converts image files into model image blocks — but it consults the **same catalog flag** and omits the image for "non-vision" models, so T2 does not route around the gate. The unblock is either (a) a per-turn `model` override to a catalog-`text+image` model (mechanism exists, Bakin already sends per-turn models; whether ChatGPT OAuth serves e.g. `gpt-5.4-mini` is unverified), or (b) an upstream catalog fix — there are already open/closed upstream issues about exactly this gating being wrong (#51254, #66253). The upstream ask is a *catalog correction*, not a new attachments API. Bonus P0 findings: the gateway has native ephemeral-turn controls (`sessionEffects: "internal"`, `suppressPromptPersistence`) that Bakin's backend-mode connection is already authorized to use, and measured per-turn latency on this machine is **median ~35 s** (n=377 recent runs).

---

## 1. Bakin adapter message path (what exists today)

- `MessageArgs` is text-only, as the spec says: `packages/core/src/adapters/runtime/concepts.ts:63` — `{ agentId, content, threadId?, model?, thinking?, metadata? }` + tool policy. No attachment field.
- `messaging.send(args)` → `chatCompletion()` → `runOpenClawAgentGateway()` (`packages/adapter-openclaw/src/runtime.ts:412-434`, `:1164-1283`), which issues a WebSocket RPC **method `"agent"`** over `OpenClawGatewayRpcClient` (`packages/adapter-openclaw/src/gateway-rpc.ts`, frames `{type:'req', id, method, params}` to `ws://127.0.0.1:18789`).
- Params Bakin sends today (`runtime.ts:1166-1181`): `{ agentId, message, deliver: false, timeout: 600, idempotencyKey: 'bakin:<sessionKey>' | 'bakin-<uuid>', sessionId?, model?, thinking? }` + tool policy fields. **No `attachments` — Bakin simply doesn't populate a param the gateway already accepts.**
- The chat gateway client connects with `clientMode: 'backend'`, scopes `['operator.read','operator.write']`, `useDeviceAuth: true` (`runtime.ts:1338-1352`). This matters for §4.
- `threadId` → deterministic session: `openClawCliSessionId(agentId, threadId)` = SHA256-derived UUID (`packages/adapter-openclaw/src/session-activity.ts:166-169`). Each distinct `threadId` is its own OpenClaw session (own transcript + trajectory files under `~/.openclaw/agents/<id>/sessions/`).
- Unrelated-but-instructive: the **channel** send path already forwards files — `openClawMessageSendArgs()` maps `metadata.files` to CLI `--media <path>` (`packages/adapter-openclaw/src/channel-helpers.ts:34-47`). That is outbound-to-channel, not into an agent turn.
- The adapter already resolves `media://inbound/<file>` URIs to absolute paths (`runtime.ts:865-884`, `media.resolveUri`) — useful if the offload branch (below) is ever used.

## 2. OpenClaw's `agent` RPC: attachments are ALREADY accepted

Installed OpenClaw 2026.6.9 (`/opt/homebrew/bin/openclaw → /opt/homebrew/lib/node_modules/openclaw/openclaw.mjs`).

**`AgentParamsSchema`** (dist/schema-B4jrIOGE.js, "Main agent-run request accepted by the gateway") includes among others:

```
message: NonEmptyString            (required)
agentId, provider, model, thinking, sessionId, sessionKey, deliver, timeout
attachments: Type.Optional(Type.Array(Type.Unknown()))     ← EXISTS
sessionEffects: 'visible' | 'internal'
suppressPromptPersistence: boolean
promptMode: 'full' | 'minimal' | 'none';  bootstrapContextMode: 'full' | 'lightweight'
lane, label, idempotencyKey (required), disableMessageTool, extraSystemPrompt, ...
```

**Accepted attachment payload shape** (`normalizeRpcAttachmentsToChatAttachments`, dist/attachment-normalize-C8m8C0yP.js, from `src/gateway/server-methods/attachment-normalize.ts`):

```jsonc
// per item — either flat:
{ "type"?: string, "mimeType"?: string, "fileName"?: string,
  "content": "<base64>" }            // string | ArrayBuffer | TypedArray
// or Anthropic-style source block:
{ "source": { "type": "base64", "media_type": "image/png", "data": "<base64>" } }
```

**Processing in the `agent` handler** (dist/agent-ai4yJ_Jx.js — `request.attachments` → normalize → `parseMessageWithAttachments(message, atts, { maxBytes, supportsInlineImages, acceptNonImage: false })`, from `src/gateway/chat-attachments.ts`):

- `acceptNonImage: false` — the **agent entrypoint accepts only `image/*` attachments** (non-images throw `unsupported-non-image`).
- MIME is sniffed from bytes and reconciled with the declared mimeType/filename; data-URL prefixes are stripped; base64 validity + decoded size verified.
- **Inline path:** image ≤ 2,000,000 bytes (OFFLOAD_THRESHOLD_BYTES) → pushed as `{ type: 'image', data: <b64>, mimeType }` into the turn's `images`, which flow into the agent run (`ingressOpts: { message, images, imageOrder, ... }`).
- **Offload path:** image > 2 MB (hard cap 6,291,456 bytes for images; overall cap `agents.defaults.mediaMaxMb`, default 20 MB) → saved under the media store, message annotated `[media attached: media://inbound/<id>]` — pixels do NOT reach the model directly; the agent must read the file with a tool.
- **The gate:** `supportsInlineImages = await resolveGatewayModelSupportsImages({ provider, model })` (dist/session-utils-CnvO9oEi.js) — looks up the effective model in the **gateway model catalog** and checks `modelSupportsInput(entry, "image")` (with hardcoded carve-outs only for `microsoft-foundry` and `claude-cli` providers; unknown model → `false`). If false, an image attachment **throws** `UnsupportedAttachmentError("text-only-image", "attachment …: active model does not accept image inputs")` → RPC responds `INVALID_REQUEST`. (The force-offload-for-text-only-models fallback exists in `parseMessageWithAttachments` but the agent entrypoint does not pass `supportsImages:false`, so it never engages there — it's a webchat-path behavior; cf. docs/nodes/media-understanding.md:184.)
- The CLI (`openclaw agent --help`) exposes **no** attachment/image flag — attachments are gateway-RPC-only today.
- Per-turn `provider`/`model` overrides on this RPC require `resolveAllowModelOverrideFromClient(client)` = admin scope or `client.internal.allowModelOverride` (dist/agent-ai4yJ_Jx.js). Bakin already sends `params.model` for routing and it works in production, so this authorization is in place on this rig.

## 3. The blocking fact on this machine: catalog says text-only

`~/.openclaw/openclaw.json` (read-only; no secrets copied):

- Agents: `main` → `openai/gpt-5.5`, `patch` → `openai/gpt-5.5`; others inherit defaults `openai/gpt-5.4` (fallback `openai/gpt-5.3-codex`). Per-agent `tools` lists: none set. `tools.media`: **not configured** (null) — so the media-understanding `image` tool is not available. `agents.defaults.mediaMaxMb`: unset (20 MB default). A Google provider API key exists under `models.providers.google` (value not recorded here) with an empty models list.
- Live trajectory metadata confirms the main agent runs `provider: openai, modelId: gpt-5.5, modelApi: openai-chatgpt-responses` (ChatGPT OAuth; `~/.openclaw/agents/main/agent/models.json` also registers `openai-codex` → `https://chatgpt.com/backend-api`).

`openclaw models list --json` (the same catalog `resolveGatewayModelSupportsImages` consults):

| model (key) | input | tags |
|---|---|---|
| `openai/gpt-5.4` | **text** | default, configured |
| `openai/gpt-5.3-codex` | **text** | fallback#1, configured |
| `openai/gpt-5.5` | **text** (ctx 200k) | configured |
| `openai/gpt-5.4-mini` / `-nano` / `-pro`, `gpt-5.5-pro`, `gpt-5.3-chat-latest` | text+image | available |

So **every model actually configured on an agent is declared text-only**, and the effective `openai/gpt-5.5` entry (input "text", ctx 200k) contradicts OpenClaw's own bundled provider catalogs, which declare gpt-5.5 as `input: ["text","image"]` (dist/openai-provider-DO-nflDe.js: `"input": ["text","image"], mediaInput.image maxSidePx 6000, contextWindow 1e6`; dist/provider-catalog-BdolWBnQ.js: `inputModalities: ["text","image"]`). This looks like the known upstream class of catalog-resolution bugs:

- [openclaw#51254](https://github.com/openclaw/openclaw/issues/51254) — "gpt-5.4-mini is configured as image-capable but OpenClaw rejects image attachments as unsupported" (open, no fix at probe time).
- [openclaw#66253](https://github.com/openclaw/openclaw/issues/66253) — "parseMessageWithAttachments drops images … despite model declaring input [text,image]" (closed; root cause: capability check ran against the bundled registry, user/profile-registered models never loaded; fix landed via PR #65211 touching `server-model-catalog.ts` + `session-utils.ts`).

**Consequence:** a T1 attachment sent to `agent main` today would be rejected with `INVALID_REQUEST: active model does not accept image inputs` — not silently dropped, which is at least clean for the ladder ("unavailable with reason").

## 4. T2 — agent-tool ingestion: exists, gated by the same flag

- OpenClaw's built-in **`read` tool** (dist/sessions-BUqov5-Y.js, `createReadToolDefinition`) explicitly supports images: *"Supports text files and images (jpg, png, gif, webp). Images are sent as attachments."* Reading an image file base64s it, auto-resizes below the inline limit, and returns `{type:'text'}` + `{type:'image', data, mimeType}` content blocks into the model context.
- **Same gate:** `getNonVisionImageNote(ctx.model)` checks `model.input.includes("image")` — for a text-declared model the tool returns only `"[Current model does not support images. The image will be omitted from this request.]"`. So prompting the agent "read /path/to/image.png and describe it" does NOT bypass the catalog gate.
- The media-understanding **`image` tool** (docs/tools/index.md Media row; docs/nodes/media-understanding.md) would analyze via a configured vision provider — but `tools.media` is unconfigured here, and configuring it needs a provider API key, which defeats the zero-config goal (that's just the direct path with extra steps).
- Verdict on T2: **not a viable interim on this machine** — it fails the same way T1 does, with worse failure semantics (silent image omission → the agent would fabricate or refuse; our parse would see garbage). If the catalog gate is fixed/overridden, T1 is strictly better anyway (no tool round-trip, no path-permission questions).

## 5. Spec's open items

**(a) Do one-shot `chat.send` threads pollute agent session history?**
Each `threadId` maps to its own deterministic OpenClaw session (§1), so the agent's *main* conversational context is never touched — no model-context pollution. But each `enrich:<assetId>:v<n>` thread persists a session-store row + transcript + trajectory file under `~/.openclaw/agents/<id>/sessions/` (Bakin's own `sessions.storeStats` counts these; a large backfill = thousands of files). **An ephemeral-turn mechanism EXISTS upstream:** `sessionEffects: "internal"` (hides the run from the control UI — `controlUiVisible: false` — and skips visible session-store side effects like main-session state updates/rotation) and `suppressPromptPersistence: true`. Both are validated by `resolveCanUseInternalRuntimeHandoff(client)` = `client.mode === "backend"` (dist/agent-ai4yJ_Jx.js), and **Bakin's chat gateway client already connects as `clientMode: 'backend'`** (`runtime.ts:1346`) — so these flags are available to the adapter today, no upstream ask needed. Recommendation: the runtime engine's send should set `sessionEffects: 'internal'` (adapter-side, driven by e.g. `metadata.ephemeral`), keep the fresh-thread convention for idempotency, and reuse ONE thread per asset+version as specced.

**(b) Per-turn latency** (measured, read-only, from the last 15 trajectory files across agents; `session.started`→`session.ended` per runId, n=377):
min 4.0 s / **median 35.2 s** / p75 38.2 s / max 73.0 s. (The 30–40 s band is dominated by heartbeat-style turns on `gpt-5.5`; a vision+JSON enrichment turn should land in the same band.) Backfill ETA display: **~35 s per asset** is the honest number; transport budget is already 600 s + 30 s in the adapter (`OPENCLAW_AGENT_TIMEOUT_MS`, `runtime.ts:129-132`).

## 6. Phase-0 verdict per the spec

### T1 feasible now?
**Mechanically yes — the transport exists and needs zero upstream API work.** What the Bakin side must add:
1. `MessageArgs.attachments?: Array<{ path: string; mimeType: string }>` in `packages/core/src/adapters/runtime/concepts.ts` (contract-level, adapter-neutral).
2. OpenClaw adapter (`runtime.ts` `runOpenClawAgentGateway`): read each file, base64, send `params.attachments = [{ mimeType, fileName: basename, content: b64 }]`. Downscale/re-encode to keep images **≤ 2 MB** so they take the guaranteed-inline path (2–6 MB images silently degrade to a `media://` note the model can't see without tools; > 6 MB errors).
3. `RuntimeAdapter.capabilities()` per the spec: the OpenClaw impl can answer `imageInput` **without heuristics** by resolving the target agent's effective model and checking the runtime's own catalog declaration (`models.listAvailable()` already surfaces `input`; `'image' ∈ input` — the same source of truth the gateway enforces, so the probe can never disagree with the gate).
4. Optionally pass `sessionEffects: 'internal'` for utility turns (§5a).

**BUT functionally blocked at the current pin on this machine** (§3): every configured agent model is catalog-declared text-only, so `capabilities().imageInput` would honestly report `false` and the ladder lands on "skipped (runtime has no image input)". Two unblocks, in preference order:
- **Per-turn model override** in the enrichment send (`model: <a catalog text+image model>`): the RPC supports it and Bakin's override authorization already works. Open question that only a live test (dockerized rig) can answer: does the ChatGPT-OAuth profile actually serve `gpt-5.4-mini`/`gpt-5.5-pro` turns, and does the Responses backend accept the image blocks end-to-end? Also note this must not become a model-name heuristic in core — it would have to be an explicit setting (`enrichmentModel`) or an adapter-resolved "any catalog model with image input on this provider".
- **Upstream catalog fix** (below) so the *default* agent model's declaration matches reality (gpt-5.5 is multimodal per OpenClaw's own bundled catalogs).

### T1 upstream ask (draft — DO NOT FILE, for user review)

> **Title:** Effective gateway catalog declares `openai/gpt-5.5` (chatgpt-responses) as `input: text`, blocking image attachments on the `agent` RPC
>
> **What happens:** On 2026.6.9, with an agent configured as `openai/gpt-5.5` via ChatGPT OAuth (`modelApi: openai-chatgpt-responses`), `openclaw models list --json` reports `{"key":"openai/gpt-5.5","input":"text","contextWindow":200000}`. Because `resolveGatewayModelSupportsImages` gates on this entry, any `agent` RPC carrying an image attachment fails with `attachment …: active model does not accept image inputs`, and the `read` tool omits image files with "[Current model does not support images.]".
>
> **Why it looks wrong:** OpenClaw's own bundled catalogs declare gpt-5.5 as multimodal — `openai` provider catalog has `"input": ["text","image"], mediaInput.image { maxSidePx: 6000 }, contextWindow: 1e6`, and the codex provider catalog has `inputModalities: ["text","image"]`. Only the GPT-5.3 Spark synth entry is patched to `input: ["text"]`. The effective/registry entry (input text, ctx 200k) appears to come from a stale or wrongly-merged registry snapshot — same family as #51254 and #66253 (fixed for user-configured providers by PR #65211, but apparently not for the ChatGPT-OAuth profile's default models).
>
> **Ask:** make the effective catalog entry for chatgpt-responses-served gpt-5.x models carry their real input modalities (or document how a deployment should correct the declaration), so `agent`-RPC image attachments and the `read` tool's image path work for the default Codex/ChatGPT setup.
>
> **Env:** OpenClaw 2026.6.9 (c645ec4), macOS, ChatGPT OAuth (Plus/Pro), agent model `openai/gpt-5.5`.

### T2 viable interim?
**No** (§4): the only agent-side image tool that exists everywhere (`read`) is gated by the identical catalog flag, and the configured vision-analyze tool (`image`) requires provider keys (= the direct path). If Phase-0's unblock is a per-turn model override, T1 inline attachments work at the same moment T2 would — ship T1 only, keep T2 unimplemented.

### Recommended P0 disposition
1. Proceed with **P1 as specced** (capabilities probe + engine extraction) — it is correct regardless of the gate, and the probe will truthfully report `imageInput: false` today.
2. Implement **T1 attachments in the adapter** behind the probe (small, upstream-API-free).
3. **Validate on the dockerized rig** (`bun run instance up`): (a) attachment inline → vision reply on a catalog-`text+image` model, (b) whether ChatGPT OAuth serves the mini/pro variants, (c) `sessionEffects: 'internal'` behavior. This is the pre-ship integration check the spec already names.
4. Put the **catalog-correction upstream ask** (draft above) in front of the user; file only after rig validation confirms the catalog entry (not the provider) is what blocks.

---

## Appendix: file/URL citations

| Claim | Source |
|---|---|
| MessageArgs text-only | `packages/core/src/adapters/runtime/concepts.ts:63-81` |
| Bakin `agent` RPC params, no attachments | `packages/adapter-openclaw/src/runtime.ts:1164-1181` |
| Gateway RPC framing | `packages/adapter-openclaw/src/gateway-rpc.ts:82-90,235-272` |
| backend clientMode + scopes + device auth | `packages/adapter-openclaw/src/runtime.ts:1338-1352` |
| threadId → deterministic session UUID | `packages/adapter-openclaw/src/session-activity.ts:166-179` |
| channel `--media` file support | `packages/adapter-openclaw/src/channel-helpers.ts:34-47` |
| media:// resolver | `packages/adapter-openclaw/src/runtime.ts:865-884` |
| AgentParamsSchema (attachments, sessionEffects, suppressPromptPersistence, promptMode, lane, label) | `/opt/homebrew/lib/node_modules/openclaw/dist/schema-B4jrIOGE.js` |
| RPC attachment shape + inline/offload pipeline (2 MB inline, 6 MB image cap, 20 MB default max, media:// offload, text-only reject) | `/opt/homebrew/lib/node_modules/openclaw/dist/attachment-normalize-C8m8C0yP.js` (src/gateway/chat-attachments.ts + server-methods/attachment-normalize.ts) |
| `agent` handler wiring (normalize → parse → images into run; acceptNonImage:false; supportsInlineImages from catalog; model-override + internal-flags authorization) | `/opt/homebrew/lib/node_modules/openclaw/dist/agent-ai4yJ_Jx.js` |
| resolveGatewayModelSupportsImages | `/opt/homebrew/lib/node_modules/openclaw/dist/session-utils-CnvO9oEi.js` |
| backend client mode constant | `/opt/homebrew/lib/node_modules/openclaw/dist/client-info-CcqJJIan.js` (`GATEWAY_CLIENT_MODES.BACKEND = "backend"`) |
| `read` tool image support + non-vision omission note | `/opt/homebrew/lib/node_modules/openclaw/dist/sessions-BUqov5-Y.js` (`createReadToolDefinition`, `getNonVisionImageNote`) |
| gpt-5.5 bundled multimodal declarations | `/opt/homebrew/lib/node_modules/openclaw/dist/openai-provider-DO-nflDe.js`, `/opt/homebrew/lib/node_modules/openclaw/dist/provider-catalog-BdolWBnQ.js`, spark text-only patch in `/opt/homebrew/lib/node_modules/openclaw/dist/openai-chatgpt-provider-DueS_THV.js` |
| live catalog text-only entries | `openclaw models list --json` output (2026-07-03, OpenClaw 2026.6.9) |
| agent models/tools config, tools.media unset | `~/.openclaw/openclaw.json` (read-only) |
| chatgpt-responses modelApi in live turns | `~/.openclaw/agents/main/sessions/*.trajectory.jsonl` (`modelApi: "openai-chatgpt-responses"`) |
| turn latency n=377, median 35.2 s | computed from `~/.openclaw/agents/*/sessions/*.trajectory.jsonl` (last 15 files) |
| media-understanding offload note, image tool | `/opt/homebrew/lib/node_modules/openclaw/docs/nodes/media-understanding.md:184`, `/opt/homebrew/lib/node_modules/openclaw/docs/tools/index.md:91`, `/opt/homebrew/lib/node_modules/openclaw/docs/tools/media-overview.md` |
| no CLI attachment flag | `openclaw agent --help` (2026.6.9) |
| upstream issues | <https://github.com/openclaw/openclaw/issues/51254>, <https://github.com/openclaw/openclaw/issues/66253> |
| docs portal | <https://docs.openclaw.ai/> (gateway protocol: <https://docs.openclaw.ai/gateway>, images: <https://docs.openclaw.ai/nodes/images>) |
