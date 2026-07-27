# Plan — PDF Chat Attachment Tooling + OCR Capability (Issue #742)

**Spec:** `SPEC.md` (approved). **Branch:** `feat/pdf-attachments-742` in the MAIN
checkout (test-live-before-merge rule: Mark tests on 3737 before any merge).

## Dependency graph

```
T0 spike (compiled-binary render) ─ informs T1/T3 wording, blocks nothing
T1 engine + fixtures
  ├─→ T2 assets delegation
  ├─→ T3 exec tools ────────────────┐
  └─→ T4 turn-engine file lane ──┬──┼─→ T7 docs sweep
                                 ├─→ T5 chat web lane
                                 └─→ T6 channel-inbound delegation
CP-1: full gate + live test + PR + merge
Phase 2 (after CP-1): P2-T1 binary → P2-T2 pack (bits repo) → P2-T3 bakin guidance
CP-2: E2E pack install + OCR; file deferred issues; close #742
```

Verticality note: T1+T3 is the issue's core path (agent reads a PDF) and is shippable
after T3 alone; T4→T5/T6 is the ingestion path; each task lands green independently.

## Phase 1 — bakin repo (one PR)

### T0 — Spike: `getScreenshot` inside a compiled binary  [no commit]
The one novel runtime risk: `@napi-rs/canvas` native addon under `bun build --compile`.
- Scratchpad script (repo root cwd so `pdf-parse` resolves): load a fixture PDF,
  `getScreenshot({partial:[1], desiredWidth: 400})`, write the PNG, print byte size.
- Run once under `bun run` (baseline), then `bun build --compile` it and run the binary.
- **Outcome A (works):** note in PR body; nothing changes.
- **Outcome B (fails):** render still ships (live box runs from the repo tree); add a
  clear runtime error message for the compiled-binary case + a `.claude/knowledge` note.
  Do NOT block the initiative on it.
- Caution: if `bun run build` is ever run, do not commit `generated-version.ts` (memory).
- **Verify:** both invocations print a >0-byte PNG (A) or the failure mode is recorded (B).

### T1 — Shared PDF engine + fixtures  [commit 1]
`feat(core): shared PDF engine — extract, info, render behind one module`
- `tests/fixtures/pdf/text.pdf` (2 pages, known strings) + `scanned.pdf` (image-only
  pages, no text layer). Generate once with pdf-lib/pdf-parse tooling in a scratch
  script; commit the binaries (small, <100 KB each).
- `src/core/pdf/limits.ts`: `MAX_PDF_PAGES=100`, `MAX_CHARS=50_000`,
  `RENDER_MAX_PAGES=10`, `RENDER_WIDTH=1568`, `SCANNED_TEXT_THRESHOLD` (chars/page).
- `src/core/pdf/engine.ts`: lazy-import `pdf-parse`; `%PDF` magic sniff; typed errors
  (`not_found | not_a_pdf | parse_failed`, encrypted PDFs surface as `parse_failed`
  with the parser's message unless pdf-parse distinguishes them cleanly);
  `getPdfInfo`, `extractPdfText` (per-page, `partial` selection, truncation markers,
  `likelyScanned` per page), `renderPdfPages` (`mkdtemp('bakin-pdf-render-')`,
  `desiredWidth: RENDER_WIDTH`, ≤`RENDER_MAX_PAGES` per call, honest over-limit error).
  CID-font rationale comment moves here from the assets extractor.
- Tests `tests/core/pdf/engine.test.ts` (--isolate): happy paths on both fixtures, page
  selection order, truncation, caps, magic-byte rejection of a renamed .txt, not_found,
  render output dir shape + dimensions, likelyScanned true on scanned fixture / false on
  text fixture. Standard logger mock; engine takes explicit paths (temp-dir fixtures).
- **Verify:** `bun test tests/core/pdf/engine.test.ts --isolate` green.

### T2 — Assets delegation  [commit 2]
`refactor(assets): delegate PDF extraction to the core engine`
- `plugins/assets/lib/content-extractor.ts`: delete `extractPdfText` + pdf-parse import;
  PDF branch calls the core engine; `MAX_CHARS`/`MAX_PDF_PAGES` import from
  `src/core/pdf/limits.ts`. Public surface (`canExtractAssetContent`,
  `extractAssetContent`) unchanged. No shims.
- **Verify:** existing assets/content-extractor + search-doc + enrichment tests green;
  `grep -rn "pdf-parse" plugins/` returns nothing.

### T3 — Exec tools  [commit 3]
`feat(core): bakin_exec_pdf_read + bakin_exec_pdf_render exec tools`
- `src/core/exec-tools/tools/pdf.ts`: two `addExecTool()` registrations, `succeed`/
  `fail` helpers, zod params (`path: string`, `pages?: number[]` int ≥1). `pdf_read`
  returns `{info, pages:[{page,text,likelyScanned}], truncated?, guidance?}` — guidance
  present when any page likelyScanned ("render with <renderToolCall(...)> and view the
  PNGs"). `pdf_render` returns `{files:[{page,path,width,height}], note}`.
- Import the module in `src/core/mcp-server.ts` beside the other built-ins.
- Tests `tests/core/exec-tools/pdf.test.ts`: registration present, param validation,
  fixture happy paths, caps message, fail() shapes, guidance appears only for scanned.
- **Verify:** tool tests green; `bun run docs:generate` diff shows both tools in
  `exec-tools.mdx` (commit the regenerated file here).

### T4 — Turn-engine file lane  [commit 4]
`feat(core): kind-aware attachments + file-lane notes in the turn engine`
- `src/core/conversation-turns.ts`: split `attachments` by raster-vs-other (mime set,
  same table the chat serving route uses). Images → existing downscale+stream path.
  Others → NEVER into `messaging.stream` attachments; instead append file-lane note
  line(s) to the runtime content: `[file <name> saved at <path> — inspect it with
  <renderToolCall('bakin_exec_pdf_read', agent)>]` for PDFs, generic "your file tools"
  wording otherwise. Note generation is THE single generator (exported helper).
- Placeholder (`conversation-turns.ts:403`) becomes kind-aware: "See the attached
  file."/"image."/mixed.
- Tests: mixed image+PDF split (runtime mock asserts only images in `attachments`,
  note present in content), placeholder wording, note formatting via a mocked
  tool-access renderer.
- **Verify:** `bun test tests/core/conversation-turns*.test.ts --isolate` green
  (extend the existing suite file(s), don't fork a parallel one).

### T5 — Chat web lane  [commit 5]
`feat(chat): PDF attachments in web chat`
- `plugins/chat/lib/routes.ts:203`: allowlist + `application/pdf` (comment updated —
  the SVG guard reasoning stays). Serving route unchanged (PDF already falls into the
  octet-stream+attachment branch).
- Composer gating decouples from imageInput: `plugins/chat/components/chat-view.tsx`
  passes `enabled: true` always, plus a new `acceptImages` flag off
  `useAgentImageInput`; `src/components/conversation/composer.tsx` accept becomes
  `image/*,application/pdf` (images filtered out of paste/drop/picker with the existing
  disabledReason surfaced as a toastless title when !acceptImages; PDFs always pass).
- File chips: `composer.tsx` attachment strip + `user-message.tsx` +
  `queued-message-list.tsx` render non-image attachments as name+size chip
  (click = download via the serve URL) instead of `<img>`.
- Tests: route test (PDF accepted, SVG still rejected, oversize rejected); component
  tests for chip rendering + PDF-only attach when imageInput=false (rtl-settle rules).
- **Verify:** `bun test tests/plugins/chat/ --isolate` green.

### T6 — Channel-inbound delegation  [commit 6]
`refactor(chat): channel-inbound file lane delegates to the turn engine`
- `plugins/chat/lib/channel-inbound.ts` `adoptAttachments`: non-raster files return as
  attachments (not hand-rolled notes); the turn engine's splitter generates the note.
  Keep: sniff-vs-content-type logic, no-imageInput raster note (that case is about
  images, stays local or moves — whichever leaves ONE generator), adoption error note.
- Update inbound tests to assert delegation (note text now comes from the engine
  helper; Discord provenance stays in message body).
- **Verify:** `bun test tests/plugins/chat/ tests/core/ --isolate` green.

### T7 — Docs sweep  [commit 7]
`docs(knowledge): PDF attachment tooling + file-lane notes`
- `.claude/knowledge/chat-plugin.md` (attachment section: PDF lane, decoupled gating,
  chips), `conversation-kit.md` (kind split + note generator), `delivery-bridge.md`
  (inbound delegation), `assets-plugin.md` (extractor delegates to core engine).
- `CLAUDE.md`: touch the chat bullet's attachment sentence + add the pdf engine to the
  relevant Key Patterns line (minimal diff).
- README check: expected no-op; confirm.
- **Verify:** docs mention no retired behavior (`grep -rn "image/\* only\|images-only"
  .claude/knowledge/` sanity pass); `bun run docs:check` green.

### CP-1 — Phase 1 gate (checkpoint)
1. `bun run test` (full, CI parity) · 2. `bun run lint` · 3. `bun run check:cycles`
4. `/verify` skill: isolated server — upload text.pdf to a chat via HTTP, send message,
   assert the persisted user row carries the attachment + the turn content carries the
   note; GET the attachment (octet-stream + disposition).
5. Mark live-tests on 3737 (branch serves from main checkout; nothing merged before
   approval — standing rule).
6. Open PR "feat: PDF chat attachment tooling (#742 Phase 1)"; body includes T0
   outcome. Merge after approval.

## Phase 2 — OCR capability pack (after CP-1)

### P2-T1 — Vision CLI binary  [bits repo]
- Evaluate `ocrit` (license, output format, arm64 release). Fits → pin its release.
  Doesn't → author `tools/ocr/` Swift CLI in bakin-bits-official (~50 lines, Vision
  framework, `ocr <image>... --json`, `--version`), build arm64, attach to a bits
  release.
- **Verify:** binary OCRs a rendered `scanned.pdf` page correctly on this machine;
  sha256 recorded.

### P2-T2 — `packs/ocr/`  [bits repo]
- `bakin-package.json`: `kind: skill-pack`, `capability: "ocr"`, `runtimes: ["*"]`,
  `requires.bins[0]` = darwin-arm64 URL + sha256 + `verifyArgs: ["--version"]`
  (fixture `capability-pack.json` is the canonical shape). Version `0.1.0`.
- `skills/ocr/`: bash lane for any image; mentions pdf flow (render → ocr).
- **Verify:** bits CI manifest validation; `bakin packages install <path>` on a dev
  instance → binary lands in `~/.bakin/bin`, readiness green.

### P2-T3 — Bakin guidance + catalog  [bakin repo, small PR, commit 8]
`feat(core): ocr capability guidance + curated-catalog entry`
- `pdf_read` guidance string: when capability readiness reports `ocr` installed, append
  the bash lane ("or run `ocr <png>` for text"). Readiness check mocked in tests
  (installed/absent).
- `packages/host/src/data/curated-catalog.json`: `ocr` entry
  (`github:markhayden/bakin-bits-official#packs/ocr`).
- Docs: `capability-packs.md` example row; `chat-plugin.md` scanned-PDF paragraph.
- **Verify:** guidance tests green; catalog zod validation green; full gate again.

### CP-2 — Ship (checkpoint)
1. Install the pack live via Explore; agent E2E: Discord or web PDF (scanned) →
   pdf_read → render → `ocr` → correct text in reply.
2. File deferred issues (each referencing #742): linux-x64 OCR leg;
   scanned-PDF search via assets-enrichment page rendering; (optional) docx/xlsx note.
3. Close #742 with a summary comment. Delete `SPEC.md`/`tasks/` per repo convention
   (specs graduate to `.claude/knowledge` content added in T7/P2-T3).

## Commit strategy (rollback design)

- One task = one conventional commit; **every commit leaves the full suite green** —
  `git revert <sha>` of any single commit is a safe rollback to the previous checkpoint.
- Rollback granularity: revert 8→ pack guidance gone (pack still installable, inert);
  revert 6→ inbound returns to hand-rolled notes; revert 5→ web lane back to
  images-only; revert 4→ file lane gone (but 5/6 depend on it — revert as a range
  6..4); revert 3→ tools gone (engine stays); revert 2→ assets standalone again;
  revert 1→ clean slate. Dependent ranges are contiguous by design.
- No merge commits inside the branch; PR merges per repo default.
- Bits-repo commits mirror the same discipline (binary pin and pack manifest are
  separate commits; a bad binary pin reverts without losing the pack).
