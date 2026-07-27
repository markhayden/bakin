# Plan — #742 Follow-ups (#747 → #746 → #745)

**Spec:** `SPEC.md` (locked with amendments). Three phases, each its own branch +
PR + gate in the MAIN checkout (test-live-before-merge). Any phase can stop
without stranding the others.

## Dependency graph

```
Phase A (#747): A1 metering rider ─→ A2 scanned-PDF loop ─→ A3 docs ─→ CP-A gate/PR/merge
Phase B (#746): B1 spike ladder ─→ B2 exit implementation ─→ CP-B (after CP-A)
Phase C (#745): C1 tesseract spike ─→ DECISION GATE (park-lean) ─→ C2 pack+rig ─→ CP-C
```

A1 before A2 on purpose: the rider is independent and smallest — its revert never
touches the OCR loop. B and C have no technical dependency on A — phases are
sequenced purely to keep one thing in flight at a time.

## Phase A — scanned-PDF enrichment + metering rider (#747)
Branch: `feat/scanned-pdf-enrichment-747`

### A1 — Direct-vision path writes run_costs  [commit 1]
`feat(assets): meter direct-vision enrichment spend`
- Each transport in `packages/core/src/media/direct-vision-provider.ts` (anthropic /
  openai / google) surfaces the provider's token usage from the response it already
  parses; `DirectVisionResult` gains optional `usage {inputTokens, outputTokens}`.
- The direct engine records a `run_costs` row per billed call: work class
  `enrichment`, direct-path run id namespace, priced like `src/core/agent-cost.ts`
  does (read it at build; reuse its recorder — NEVER new spend math). Usage absent
  from a provider response ⇒ record with null tokens, never fabricate.
- Tests: transports' usage parsing (canned responses); recorder receives the row
  (mocked); runtime path untouched (existing suites stay green).
- **Verify:** `bun test tests/plugins/assets/enrichment-providers.test.ts` + spend
  suites green; typecheck.

### A2 — Scanned-PDF vision-OCR loop  [commit 2]
`feat(assets): scanned-PDF enrichment via rendered-page vision OCR`
- Fixture: `tests/fixtures/pdf/scanned-4p.pdf` (4 image-only pages, sentinels per
  page — extend the #742 generator; scanned.pdf stays 2-page).
- `queue.ts` document branch, `.pdf` + ~empty extraction (was `skipped`):
  `renderPdfPages(path, [1..min(3, total)])` → per page one vision call through the
  EXISTING image-kind pipeline → merge: `ocrText` = page-labeled join + visible
  `[pages 4–N not OCR'd]` marker; caption/tags/summary from page-1 call only.
- Any page call fails ⇒ whole job fails (existing error/retry path, MAX_ATTEMPTS 2);
  partial results NEVER applied as done. Render tmpdir cleaned per job (finally).
- Non-PDF empty documents keep the honest skip. New scanned PDFs never enter
  `skipped` (eligibility solved by the branch change itself; zero legacy skipped
  verified live — `force` backfill route covers hypotheticals).
- Idempotency: `done + forVersion` guards the whole job as today.
- Tests (extend enrichment suites; PDF/document e2e coverage is currently absent):
  scanned 2p fixture → 2 calls, labeled merge, done; 4p fixture → 3 calls + marker;
  page-2 failure ⇒ error, no partial done, no manifest write; text PDF → text path
  only (zero renders/vision calls); skip guard blocks re-bill; user-edited ocrText
  survives re-run; tmpdir cleanup.
- **Verify:** `bun test tests/plugins/assets/ --isolate` green.

### A3 — Docs  [commit 3]
`docs(knowledge): scanned-PDF enrichment + direct-path metering`
- `.claude/knowledge/assets-plugin.md` (enrichment section: scanned-PDF loop, 3-page
  budget, whole-job-fail), `models-plugin.md` (direct-vision spend now on the
  ledger), CLAUDE.md assets bullet (one-line touch). README: verify no-op.
- **Verify:** grep sweep for stale "no extractable text" claims in knowledge docs.

### CP-A — Gate
1. `bun run test` + `lint` + `check:cycles`.
2. Live test (Mark, on 3737 after restart): import/upload a scanned PDF asset →
   enrichment populates page-labeled ocrText + caption/tags → asset findable in
   search by its OCR'd words; Spend tab shows the enrichment rows.
3. PR "feat: scanned-PDF search via enrichment vision OCR (#747)" → merge on
   approval. #747 closes.

## Phase B — compiled-binary pdf-parse (#746)
Branch: `feat/compiled-pdf-746` (after CP-A)

### B1 — Spike ladder  [no commits; findings recorded in todo.md]
Timebox: one focused session. Scratchpad scripts, compiled with
`bun build --compile` from repo root:
1. Native addon in-binary: static import of `@napi-rs/canvas-darwin-arm64`; Bun
   compile asset embedding; addon dir shipped beside the binary.
2. Text-only: minimal DOMMatrix/ImageData/Path2D stub globals before pdf-parse
   import — does `getText` work with no canvas at all?
3. `unpdf` engine-swap candidate: does its serverless build extract our fixtures'
  text correctly in a compiled binary?
- Caution: `bun run build` mutates `generated-version.ts` — never commit it.

### B2 — Exit implementation  [commit(s) per exit]
- (a) `fix(core): pdf render inside compiled binaries` — wire the mechanism into
  build + engine; compiled smoke script added to repo scripts.
- (b) `fix(core): text-only pdf in compiled binaries` — stub-or-unpdf text path,
  render throws `pdf_unavailable`; release-pipeline.md documents the split.
- (c) docs-only: release-pipeline.md constraint + re-evaluate note; close #746
  with findings. **No branch/PR** — docs-only commits land on main directly
  (initiative-wrap precedent). Only (a)/(b) get the branch + PR treatment.
- **Verify:** exit-dependent; (a)/(b) ship a compiled-binary smoke test.

### CP-B — Gate
Exits (a)/(b): full suite + lint + cycles → PR → merge. Exit (c): docs commit to
main + close #746 with findings. Engine changes need no live-server test
(repo-tree unaffected).

## Phase C — linux OCR leg (#745) — PARK-LEAN
After CP-B. Consumer = linux-HOSTED Bakin server (sandbox rig / future linux box);
park exit is the expected default.

### DECISION GATE FIRST (Mark) — before any spike work
The findings that justify parking are already in hand (consumer correction: the
linux leg only ever installs on a linux-hosted server, which doesn't exist today).
Question at CP-B: **park #745 now with those findings (recommended)**, or run the
tesseract spike. No spike session is spent before this answer.

### C1 — Static tesseract spike  [no commits; only on explicit "spike"]
Timebox: one focused session. Produce a static linux-x64 tesseract + eng
traineddata that runs in the sandbox rig container; fallback candidate `ocrs`
(cargo build + models via `requires.models`). Record findings; second decision
gate on ship-vs-park with real effort numbers.

### C2 — Ship (only on explicit go after C1)
- Bits: `tesseract-v<ver>` mirror release (binary + license + traineddata),
  `packs/ocr` second bin entry (real name, linux-x64 key), pack `platforms` +=
  linux-x64, SKILL.md per-platform commands (+ "linux engine does not read PDFs —
  render first"), version bump 0.2.0. Bits PR.
- Bakin: capability-packs.md note; catalog descriptions if touched.
- **Verify:** `bun run instance up --mode sandbox --runtime pi` → pack install in
  container → readiness green → `tesseract` OCRs a rendered fixture page → rig torn
  down (`instance down`), ports clean.

### CP-C — Close #745 (shipped or parked) + initiative wrap
Update memory; delete `SPEC.md` + `tasks/{plan,todo}.md` (docs graduated); final
summary comments on all three issues.

## Commit strategy (rollback design)

- Per-phase branches; ONE task = one commit; every commit leaves the full suite
  green — single-commit `git revert` is always safe.
- Phase A revert map: 3→ docs gone; 2→ scanned loop gone (rider stands alone);
  1→ rider gone (loop depends on nothing in it — but revert 2 before 1 if both go).
- Phase B commits only exist for exits (a)/(b); exit (c) is issue-comment + docs.
- Phase C bits-repo commits mirror the discipline (release pin separate from pack
  manifest change).
- No merges between phase branches; each PRs to main independently.
