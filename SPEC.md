# SPEC — PDF Chat Attachment Tooling + OCR Capability (Issue #742)

**Status:** Draft for approval
**Issue:** https://github.com/markhayden/bakin/issues/742
**Date:** 2026-07-26

## 1. Objective

Agents receiving a PDF (via web chat upload or Discord/channel inbound) can inspect it
through a blessed, auditable tool path — no shelling out to unavailable system utilities,
no ad-hoc `qlmanage`/`sips` fallbacks.

- Text PDFs → readable extracted text via one exec-tool call.
- Scanned/visual PDFs → rendered page PNGs the agent views with its native image-capable
  `read` tool, AND real OCR text once the OCR capability pack is installed (Phase 2).
- Web chat composer accepts PDFs (today it hard-rejects everything but 4 raster types).
- ONE shared PDF engine — the existing assets extractor logic is promoted to core and
  consumed by both assets and the new tools. No parallel engines, no shims.

**Target user:** the single operator of this machine + their agents (both runtimes).

**North star (context, not scope):** robust agent file-reading across common file types,
delivered incrementally. PDFs are the beachhead (this initiative); audio already has the
`transcribe` pack; OCR (this initiative, Phase 2) is a generic power that also serves
image attachments and screenshots; docx/xlsx/pptx are future initiatives that follow the
same pattern (in-core engine when a pure-JS dep exists, capability pack when a pinned
binary is the right tool).

## 1.1 Phasing

- **Phase 1 — bakin repo:** PDF engine, exec tools, chat ingestion lanes, docs, tests.
  Shippable alone; scanned pages covered by render + vision guidance.
- **Phase 2 — bakin-bits-official + bakin integration:** `ocr` capability pack pinning an
  Apple Vision-framework CLI (darwin-arm64) + a skill teaching the bash lane
  (`ocr <image>` for any image/screenshot/rendered page). Bakin-side: `pdf_read`'s
  scanned-page guidance mentions the binary when readiness reports it installed, plus a
  curated-catalog entry. Guidance-only — no server-side OCR execution.

## 2. Interview Decisions (settled)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Mechanism | Built-in core exec tools backed by `pdf-parse` v2 (already a dependency; `@napi-rs/canvas` native binary already in tree). NOT a capability pack, NOT server-side inline extraction. |
| 2 | Ingestion | Web chat upload lane accepts `application/pdf` (in addition to the 4 raster types). Discord file lane keeps working; both lanes converge on the same file-lane handling. |
| 3 | Tool shape | Two tools: `bakin_exec_pdf_read(path, pages?)` → metadata + per-page text; `bakin_exec_pdf_render(path, pages?)` → PNG paths. |
| 4 | Render output | Per-call `mkdtemp` under OS tmpdir (`bakin-pdf-render-*`), absolute paths returned. No GC system. |
| 5 | Limits | read: 100 pages / 50k chars, honest truncation markers. render: fixed `desiredWidth: 1568` (the vision-model input ceiling — pdf-parse has no dpi; higher res is wasted pixels), ≤10 pages per call. No size knob. |
| 6 | Scanned PDFs | Phase 1: render + vision `read`, with self-guiding low-text detection in `pdf_read`. Phase 2: OCR capability pack (in this initiative, not deferred). |
| 7 | OCR engine | Apple Vision-framework CLI (tiny Swift tool or existing e.g. `ocrit`), single sha256-pinned darwin-arm64 binary hosted off a bakin-bits-official release. Tesseract rejected for macOS dylib packaging pain + lower quality. |
| 8 | Linux OCR | **File a follow-up issue**: linux-x64 leg (tesseract or similar) added to the same pack manifest later. End state is both platforms; Apple is the priority. Server-side OCR paths run on the Mac regardless. |
| 9 | OCR depth | **Guidance-only composition** — the pack ships binary + skill; `pdf_read`'s scanned-page guidance mentions the `ocr` binary when capability readiness reports it installed; the agent composes render→ocr in bash. NO server-side OCR integration. Scanned-doc *search* is a separate deferred issue: assets enrichment renders PDF pages for its existing vision-LLM OCR — no pack dependency. |

## 3. Design

### 3.1 Shared PDF engine — `src/core/pdf/`

New module (server-side, side-effectful tier). Lazy-imports `pdf-parse` (same pattern the
assets extractor uses today — the ~2 MB dep never loads at startup).

```
src/core/pdf/
  engine.ts     — extractPdfText(path|buffer, {pages?}) → { pages: [{n, text}], truncated, meta }
                  getPdfInfo(...)  → { pageCount, title?, author?, dimensions, encrypted?, version? }
                  renderPdfPages(path, {pages?, dpi?}) → { files: [{page, path, width, height}], outDir }
  limits.ts     — MAX_PDF_PAGES=100, MAX_CHARS=50_000, RENDER_MAX_PAGES=10,
                  RENDER_DEFAULT_DPI=150, RENDER_MAX_DPI=300
```

- Source of truth for extraction moves FROM `plugins/assets/lib/content-extractor.ts`
  (its PDF half is deleted; the plain-text half stays in assets and the file delegates
  PDF work to the core engine). The CID-font rationale comment moves with the code.
- `renderPdfPages` uses `PDFParse.getScreenshot()`; output dir via
  `mkdtempSync(join(tmpdir(), 'bakin-pdf-render-'))` (mirrors `media/downscale.ts`).
- Input validation: file exists, size cap (100 MB pre-slurp), `%PDF` magic-byte sniff
  (never trust extension alone), clear typed errors (`not_found`, `not_a_pdf`,
  `parse_failed`, `over_limit`, `pdf_unavailable`; encrypted PDFs surface as
  `parse_failed` with the parser's message — no dedicated kind).
- Page selection: array of 1-indexed page numbers (zod `number[]`), plus text-form
  support is NOT needed — agents can pass arrays.
- **Low-text page detection (Phase 1):** pages whose extracted text falls under a small
  threshold are flagged `likelyScanned: true` and the `pdf_read` response carries
  guidance: "pages N–M appear to be scanned — render them with `bakin_exec_pdf_render`
  and view the PNGs" (tool name rendered per-runtime). The tool never dead-ends.
- **OCR guidance (Phase 2, guidance-only):** when capability readiness reports the `ocr`
  pack installed, the scanned-page guidance additionally mentions the bash lane
  (`ocr <png>`). The ENGINE never spawns the binary — no server-side OCR integration,
  by decision #9. The agent composes render→ocr itself.
- Rendering is fixed at `desiredWidth: 1568` px (`ParseParameters.desiredWidth`) — the
  vision-model input ceiling; no size parameter is exposed.

### 3.2 Exec tools — `src/core/exec-tools/tools/pdf.ts`

Two built-ins, registered via `addExecTool()` at module scope, imported from
`src/core/mcp-server.ts` alongside the other 11 built-ins (this makes them reach Pi
in-process AND OpenClaw over MCP with zero extra wiring, and they auto-appear in the
rendered tool-access sections of dispatch prompts / AGENTS.md).

- `bakin_exec_pdf_read` — params `{ path: string, pages?: number[] }`.
  Returns `{ ok, info: {pageCount, title, ...}, pages: [{page, text}], truncated? }`.
  One call answers "what is this file" — no separate info tool.
- `bakin_exec_pdf_render` — params `{ path: string, pages?: number[] }`.
  Returns `{ ok, files: [{page, path, width, height}], note }` where `note` tells the
  agent to view the PNGs with its file/image tools. Caps enforced with honest
  over-limit messages (never silent clamping without saying so).
- Failures use the shared `fail()` helper → Pi bridge converts to a throw; MCP returns
  the error payload. Output previews in audit/tool rows stay clipped (existing exec
  audit plumbing — no document content in logs beyond the standard clipped preview).

### 3.3 Assets refactor

`plugins/assets/lib/content-extractor.ts` keeps its public surface
(`canExtractAssetContent`, `extractAssetContent`) but its `extractPdfText` implementation
is deleted in favor of the core engine. Limits import from `src/core/pdf/limits.ts` so
assets and the exec tools can never drift. `bakin_exec_assets_open` behavior unchanged.

### 3.4 Chat ingestion — web lane

- `plugins/chat/lib/routes.ts` upload allowlist: add `application/pdf`. The
  #669 SVG guard stays intact — this is an explicit single-type addition, not `*`.
  Size cap stays 25 MB, max 8 attachments.
- Serving route: PDFs keep the existing non-raster behavior — `application/octet-stream`
  + `Content-Disposition: attachment` + nosniff (download-on-click; no inline viewer;
  conservative against PDF-borne content).
- Composer (`src/components/conversation/composer.tsx`): accept becomes
  `image/*,application/pdf`; paste/drop filters allow PDFs. **PDF attach is NOT gated on
  `imageInput`** — any agent with tools can read a PDF. When `imageInput` is false the
  composer now allows PDF-only attach (images still blocked with the existing reason).
- Message/staged-attachment rendering: non-image attachments render as a file chip
  (name + size, click = download) instead of an `<img>` thumb.

### 3.5 File-lane unification — turn engine

`src/core/conversation-turns.ts` `runTurn` currently assumes every `TurnAttachment` is a
raster image (downscale → `messaging.stream` attachments — a PDF there would make Pi
throw). Change: split attachments by kind.

- Raster images → existing downscale + stream-attachment path, unchanged.
- Non-image (PDF) → appended **file-lane note** on the turn content:
  `[file <name> saved at <path> — inspect it with <rendered tool call>]`, where the tool
  reference is rendered via `src/core/tool-access.ts` `renderToolCall()` so Pi sees
  `bakin_exec_pdf_read` and OpenClaw sees `bakin-<agent>.bakin_exec_pdf_read` (the two
  surfaces cannot drift).
- `plugins/chat/lib/channel-inbound.ts` file lane: its hand-rolled note for non-raster
  files is replaced by passing the saved file as a `TurnAttachment` and letting the turn
  engine generate the note — ONE note generator, both lanes symmetric. Discord
  provenance ("from Discord") may ride the message body as today.
- Attachment-only send placeholder ("See the attached image.") becomes kind-aware
  ("See the attached file." when non-image present).

### 3.6 OCR capability pack (Phase 2 — spans repos)

**bakin-bits-official** (`packs/ocr/`):
- `bakin-package.json`: `kind: skill-pack`, `capability: "ocr"`, `runtimes: ["*"]`,
  `requires.bins[0]` = the Vision CLI (`darwin-arm64` URL + sha256 + `verifyArgs`),
  hosted as a bakin-bits-official release artifact (the established `bx` pattern).
- Binary: a small Swift CLI over the Vision framework (adopt `ocrit` if its output and
  license fit; otherwise author a ~50-line tool in the bits repo — takes image path(s),
  emits recognized text to stdout, JSON mode preferred). Exact choice resolved at pack
  authoring; pinning + `verifyArgs: ["--version"]` either way.
- `skills/ocr/`: teaches agents the direct lane — OCR any image/screenshot/rendered page
  via bash (`ocr <image>`); mentions the PDF flow is automatic via `bakin_exec_pdf_read`.
- Catalog: add an `ocr` entry to `packages/host/src/data/curated-catalog.json` (bakin
  repo) so Explore can install it.

**bakin repo integration:** readiness-aware guidance string in `pdf_read` (§3.1),
catalog entry, docs. No new readiness machinery — `requires.bins` + `capability`
already light up `GET /api/packages/capabilities`, the doctor, and
`bakin check capabilities`.

### 3.7 Docs

- `.claude/knowledge/chat-plugin.md` — attachment section: PDF lane, non-gated attach,
  file chip, note generation moved to turn engine.
- `.claude/knowledge/conversation-kit.md` — TurnAttachment kind split + file-lane note.
- `.claude/knowledge/delivery-bridge.md` — inbound file lane now delegates to the engine.
- `.claude/knowledge/assets-plugin.md` — content-extractor delegates PDF to core engine.
- `docs/src/content/docs/reference/generated/exec-tools.mdx` — regenerate (script-owned).
- `CLAUDE.md` — one-line touch in the chat bullet if the attachment sentence changes.
- README: no impact expected (verify at ship).

## 4. Commands

```bash
bun run test                      # full suite (CI parity)
bun test tests/core/pdf/engine.test.ts --isolate      # engine unit tests
bun test tests/core/exec-tools/pdf.test.ts --isolate  # tool tests
bun test tests/plugins/chat/ --isolate                # chat lane tests
bun run lint                      # part of the gate (standing rule)
bun run check:cycles              # import-cycle check (standing rule)
bun run dev                       # manual verification loop
```

## 5. Testing Strategy

- **Fixture:** one tiny in-repo generated PDF fixture (text) + one scanned-style
  (image-only) fixture under `tests/fixtures/pdf/`; generated small, committed as files.
- **Engine unit tests** (`tests/core/pdf/engine.test.ts`): info/text/render happy paths,
  page selection, truncation markers, caps, `not_a_pdf` magic-byte rejection,
  `not_found`, render tmpdir shape. Standard content-dir/OpenClaw-home mocks per
  CLAUDE.md testing rules (engine itself is path-pure, but tool tests touch context).
- **Exec tool tests** (`tests/core/exec-tools/pdf.test.ts`): param validation, cap
  enforcement messages, fail() on bad input, registration presence
  (`getAllExecTools()` contains both names).
- **Chat route tests**: upload accepts `application/pdf`, still rejects SVG; serving
  stays octet-stream; send-path validation unchanged.
- **Turn engine tests**: mixed image+PDF attachment split, file-lane note content +
  `renderToolCall` formatting, placeholder text kind-awareness, Pi never receives a
  non-image in `attachments`.
- **channel-inbound tests**: existing file-lane tests updated to assert delegation
  (note now comes from the turn engine).
- **Assets regression**: existing content-extractor tests keep passing against the
  delegating implementation.
- **Phase 2 — OCR guidance**: `pdf_read` guidance string tested with readiness mocked
  installed/absent (mentions `ocr` bash lane only when installed). `likelyScanned`
  detection tested against the image-only fixture. Pack manifest validated against
  `AgentPackageManifestSchema` in bits-repo CI (existing pattern). No engine OCR tests —
  there is no engine OCR code.

## 6. Boundaries

**Always:**
- One PDF engine (`src/core/pdf/`) — assets, exec tools, and any future consumer import it.
- Lazy-import `pdf-parse`; startup cost stays zero.
- Honest limits: every truncation/clamp is visible in the tool response.
- Follow repo test isolation rules (temp dirs, both content-dir mocks, logger mock).
- `bun run lint` + `check:cycles` before push.

**Ask first:**
- Any new runtime dependency (none expected — pdf-parse + @napi-rs/canvas are in-tree).
- Widening the upload allowlist beyond `application/pdf`.
- Changes to the exec-tool audit/preview clipping behavior.

**Never:**
- No back-compat shims — the assets extractor's PDF code is deleted, not wrapped.
- No PDF as a model image block / stream attachment (Pi would throw; the file lane is the path).
- No inline browser PDF viewing (serving stays octet-stream + attachment disposition).
- No content leakage: document text never lands in audit logs beyond standard clipped previews.

## 7. Explicitly Deferred (file issues at ship time)

- **Linux OCR leg** — add `linux-x64` (tesseract or similar) to the `ocr` pack manifest.
  End state is both platforms, Apple priority. **File a GitHub issue referencing #742.**
- **Scanned-PDF search indexing** — assets enrichment renders PDF pages into its
  existing vision-LLM OCR flow (`ocrText`), closing the search gap with no pack
  dependency and no engine OCR code. **File a GitHub issue referencing #742.**
- **Other common file types** (docx/xlsx/pptx readers) — future initiatives following
  the same in-core-engine-or-capability-pack pattern. Issue optional, note in #742 close.
- Inline PDF preview in the chat UI.
- PDF support in the composer for non-chat conversation surfaces beyond what the shared
  composer gives for free.
