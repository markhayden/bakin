# Plan — Turn-Completion Markers & Honest Sweep (#735)

**Spec:** `.claude/specs/chat-turn-markers.md` (silo-review amendments applied 2026-07-26)
**Branch:** `feat/chat-turn-markers` off main. Gate per commit: `bun run lint && bun run typecheck && bun run check:cycles && bun run test`.

## What the operator sees (the whole UX delta)

Nothing new renders in healthy chats. Changes after a crash mid-reply:

```
  (M) Margo
  │ The 2026 National High School…        ← reply cut mid-sentence by the crash
  │ ⚠ Interrupted — the server stopped before this reply finished.
  │
  │ (queued follow-ups drain BELOW the notice, never beneath silence)
```

Plus two small honesty fixes riding along: "Try again" only appears on the FINAL turn (it always re-sends the newest message — mid-transcript buttons would resend the wrong one), and an empty-reply completed turn is no longer falsely stamped at next boot. `done` marker rows are invisible everywhere.

## M1 — `feat(conversations): terminal turn-marker rows (opt-in)`

**Files:** `src/core/conversation-turns.ts`, `packages/sdk/src/types/conversation-turns.ts`, `src/components/conversation/fold.ts`, `src/components/conversation/conversation.tsx` (retry scoping), tests (`tests/core/conversation-turns.test.ts`, `tests/sdk/conversation-fold.test.ts`, parity-pin file per the #737 chunk-taxonomy pattern).

- Row union += `{kind:'done'; ts: string; turnId?: string}`; config += `terminalMarkerRows?: boolean` (doc: "chat-style sweepable transcripts only — bounded/foreign stores must not opt in").
- `runTurn` clean-success path only (`aborted` branch keeps its own terminal): persist done row after `recorder.finish()` rows, before `onTurnComplete`.
- Fold: EARLY `continue` for `done` before the agent-side builder/turnId-split block (phantom-turn guard). `conversation.tsx`: pass `onRetry` only to the final turn.
- SDK mirror + engine↔SDK mutual-assignability parity pin.
- Tests: done row on success w/ flag (turnId, lands last); **settle-shape matrix** (success / error-chunk / thrown-mid-iteration / abort-during-stream / abort-thrown-in-drain-prefix / drained-combined — last row always terminal, never done on abort/error); no row without flag; hook-order test extended (`row:done` before `complete` before `event:done`); drained combined turn gets exactly one marker (flag-enabled queue harness); fold 3-fixture test (mid-transcript skip, trailing folds complete, `[user, done]` no phantom); retry-scoping render test (error mid-transcript → no button; final → button).
- **Acceptance:** dormant — zero behavior change for consumers without the flag (full suite proves it).

## M2 — `feat(chat): honest sweep for partial-output deaths` (closes #735)

**Files:** `plugins/chat/lib/store.ts` (schemas + markerEra + sweep v2 + append guard), `plugins/chat/lib/stream-bridge.ts` (`terminalMarkerRows: true` + in-flight predicate to sweep), `plugins/chat/index.ts` (sweep call site), `plugins/chat/components/use-chat-data.ts` + `plugins/chat/types.ts` (DTO), tests (`tests/plugins/chat/sweep.test.ts` NEW, `store.test.ts`, `stream.test.ts`, `queue.test.ts`).

- `TranscriptRowSchema`/`ChatTranscriptRow`/`TranscriptRowDto` += done kind; `ChatSummarySchema` += `markerEra: z.boolean().default(false)`, `createChat` writes `true`; `appendTranscriptRow`: done rows bump NOTHING.
- Sweep v2 (last-row-only, no run collection):
  0. skip chats with an in-flight turn (injected predicate);
  1. last row `user` → stamp turnId-less `"Interrupted — the server stopped before the agent could reply."` (any era);
  2. else if (`summary.markerEra || rows.some(done)`) AND last kind ∉ {done, aborted, error} AND last row has turnId → stamp `{kind:'error', turnId, message: 'Interrupted — the server stopped before this reply finished.'}`;
  3. turnId-less non-user tails / legacy transcripts → untouched.
- Boot ordering unchanged (sweep → restoreQueues).
- Tests: sweep matrix (a)–(j) from the spec in the new pure-fixture `sweep.test.ts` (incl. run-twice idempotency for BOTH stamp shapes, crash-mid-drain `[…, done, user, user, assistant(t)]`, broken-chat resilience, in-flight skip); store: done bumps nothing + GET serves done rows (route-level, no RTL page render); stream: happy path ends `done` (bridge-wiring pin; update exact-shape assertions), abort/error paths have no done row; queue boot test: stamp lands ABOVE drained rows; engine-row→chat-schema one-way parse pin.
- **Acceptance:** #735 criteria — partial-output deaths marked at next boot; completed turns never falsely marked (incl. the empty-reply case, now fixed in marker-era chats); boot drain always lands beneath an explicit marker in marker-era chats.

## M3 — `docs(knowledge)`

- `chat-plugin.md`: transcript schema gains `done` + `markerEra`; sweep-v2 semantics (terminal-row invariant, era gate + its sunset — transcript-scan branch removable when the last pre-upgrade chat is gone; plural legacy-miss note; swallowed-append false-stamp caveat).
- `conversation-kit.md`: row union + fold skip + `terminalMarkerRows` flag with the bounded-store warning + retry-scoping rule.
- README + docs-site check (expected: no impact). Close the #735 note in `chat-queue-pr-734` memory at wrap-up.

## Rollback

M1 dormant alone; M2 is the behavior flip (revert = old sweep; already-written markers are harmless invisible rows); M3 docs.

## Out of scope

Brands/bits sweep upgrades; retroactive backfill; ledger-based in-flight tracking; any UI for done rows.
