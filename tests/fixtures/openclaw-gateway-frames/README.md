# OpenClaw gateway frame fixtures

Real gateway frames recorded from the locally installed **OpenClaw 2026.6.11 (e085fa1)**,
**gateway protocol 4** (`hello-ok.payload.protocol: 4` — see line 3 of any fixture).
Captured 2026-07-09 for the prelaunch-hardening WS1 spike
(`.claude/specs/prelaunch-hardening/SPEC.md` Appendix A / OQ2).

## Files

| File | Turn | Notes |
|------|------|-------|
| `text-turn.jsonl` | "Reply with exactly: The quick brown fox…" | Text-only turn; single coalesced `chat` delta + mirroring `agent` assistant frame |
| `tool-turn.jsonl` | "Run `ls` … then reply DONE" | One `exec` tool call: `agent` streams `tool` (caps-gated) + `item` + `command_output`, then assistant text |
| `abort-turn.jsonl` | "Count slowly from 1 to 50…" + `chat.abort` after 2.5s | Multi-delta streaming, then server-side abort: `chat.abort` res `{aborted:true}`, `chat` `state:'aborted'`, lifecycle `aborted:true` frames, final RPC res `status:'timeout', summary:'aborted', stopReason:'aborted'` |

## Line format

One JSON object per line: `{ ts, dir, frame }`.
- `dir: 'in'` — frame received from the gateway, verbatim (after sanitization).
- `dir: 'out'` — frame the recorder sent (connect / agent / chat.abort requests).
- `dir: 'note'` — recorder bookkeeping (why capture ended).

Sanitization replaces secrets with placeholders, preserving structure:
`<redacted-token>`, `<redacted-device-token>`, `<redacted-signature>`,
`<redacted-public-key>`, `<redacted-nonce>`, `<redacted-device-id>`, and RFC1918
LAN addresses as `<redacted-lan-ip>` (shared pass: `scripts/instance/frame-sanitize.ts`).
Everything else (runIds, sessionKeys, seq, timestamps, payload text) is verbatim.

## Capture setup (re-recording)

Recorded by `scripts/instance/record-gateway-frames.ts` against a **throwaway**
OpenClaw home + gateway on an uncommon port — never the production `~/.openclaw`:

1. Bootstrap a throwaway home (NOTE the CLI treats `OPENCLAW_HOME` as `$HOME` and
   appends `.openclaw`; Bakin's adapter uses it directly — pass `<tmp>` to the CLI,
   `<tmp>/.openclaw` to the recorder):
   ```sh
   export OPENCLAW_HOME=<tmp>
   openclaw onboard --non-interactive --accept-risk --mode local --auth-choice skip --skip-health
   openclaw config set gateway.auth.token <dev-token>
   openclaw config set gateway.remote.token <dev-token>
   openclaw config set gateway.port 39400
   printf '%s' "<provider-token>" | openclaw models auth paste-token --provider anthropic --profile-id anthropic:default
   openclaw models set anthropic/claude-haiku-4-5
   openclaw agents add recorder --non-interactive --workspace <tmp>/.openclaw/workspaces/recorder --model anthropic/claude-haiku-4-5
   ```
2. Pre-approve the device identity (pairing chicken-and-egg sidestep) via
   `ensureApprovedDevice(<tmp>/.openclaw, Date.now(), <dev-token>)` from
   `scripts/instance/device-approve.ts`.
3. Start the gateway: `OPENCLAW_HOME=<tmp> openclaw gateway --port 39400`.
4. Record (once per fixture; add `--abort-after-ms 2500` for the abort probe):
   ```sh
   OPENCLAW_HOME=<tmp>/.openclaw bun scripts/instance/record-gateway-frames.ts \
     --url ws://127.0.0.1:39400 --token <dev-token> --agent recorder \
     --message "…" --out tests/fixtures/openclaw-gateway-frames/<name>.jsonl
   ```
5. Kill the gateway when done.

The recorder connects with `mode:'backend'`, `role:'operator'`,
`scopes:['operator.read','operator.write']`, `caps:['tool-events']` and signed
v3 device auth (reuses `packages/adapter-openclaw/src/device-auth.ts`), then
sends one `agent` RPC (`deliver:false`, random `idempotencyKey`) and records
every frame until the final RPC response + a 3s grace window.

## Key observations (OQ2 evidence — full analysis in SPEC.md)

- The `agent` RPC answers twice on one request id: `{runId, sessionKey, status:'accepted', acceptedAt}` then the final. **`runId` echoes the client-supplied `idempotencyKey`.**
- `chat` `state:'delta'` frames carry `deltaText` AND the full cumulative text (`message.content[0].text`); `agent` `stream:'assistant'` frames duplicate the same text at the same cadence (`data.text` cumulative + `data.delta`). Either stream alone suffices for text; `chat` is the cooked source (OQ2 → chat-only for text).
- `chat.payload.seq` mirrors the run's `agent`-side seq numbering (not an independent counter).
- Only `agent` `stream:'tool'` frames are gated behind `caps:['tool-events']`; `stream:'item'` and `stream:'command_output'` are broadcast to operator connections regardless (verified by a no-caps control run). Missing caps therefore shows up as **silent per-run seq gaps** — no synthetic seq-gap error frame was observed.
- After `chat.abort`, a second lifecycle emitter re-uses the same `runId` with seq restarting at 1 (`finishing`/`end`, `stopReason:'aborted'`, no `sessionId`) — per-run seq is NOT globally monotonic across the abort boundary.
- Broadcast noise on an operator connection: `health` and `tick` events (no `isHeartbeat` agent frames observed in these captures).

## Abort fixtures (2026-07-09, post-incident)

- `abort-explicit-session.jsonl` — **the upstream defect**: an `agent` RPC run started
  with an explicit `sessionId` param (production Bakin dispatch shape pre-fix). The
  accepted ack omits `sessionKey`; the run is never registered in the gateway's
  chat-abort registry, so ALL abort surfaces miss while the run is mid-flight:
  `chat.abort` → `{aborted:false, runIds:[]}`, `sessions.abort {runId}` and
  `sessions.abort {key}` → `{abortedRunId:null, status:"no-active-run"}`. The run
  streams to natural completion. (OpenClaw 2026.6.11; upstream: openclaw#TBD-abort-registration —
  file + backfill the real issue number; tracked in tasks/todo-prelaunch-hardening.md.)
- `abort-sessionkey-addressed.jsonl` — **the fix shape**: the same run sent with BOTH
  `sessionId: <uuid>` and `sessionKey: agent:<agent>:explicit:<uuid>`. The ack carries
  the sessionKey, the run is registered, `chat.abort {sessionKey, runId}` returns
  `{aborted:true}`, lifecycle ends `stopReason:'aborted'`, and the RPC final settles
  `status:'timeout' / stopReason:'aborted'`. The sessions store maps the key to the
  SAME sessionId (trajectory file names preserved — forensics unaffected). Session
  continuity across turns on one key was separately verified (two-turn recall probe).

Re-record the abort fixtures with the committed probes — `scripts/instance/abort-ladder-probe.ts`
(the defect: sessionId-only shape, full abort ladder) and
`scripts/instance/abort-workaround-probe.ts` (the fix shape: sessionId + sessionKey) —
against a throwaway gateway home, never the production `~/.openclaw`. The dockerized-rig
validation campaign (`bun run scripts/instance/validate.ts`, phase R7) re-runs both checks
against the rig gateway; run it after every OpenClaw version bump — if the defect probe
reports the run WAS aborted, upstream fixed registration: delete the workaround pin
(`tests/dev/openclaw-workaround-regressions.test.ts`) and the mock's defect mirror.
