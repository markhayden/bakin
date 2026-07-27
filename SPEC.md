# SPEC — #742 Follow-ups: Scanned-PDF Search, Compiled-Binary PDF, Linux OCR

**Status:** Draft for approval
**Issues:** #747 (Phase A) · #746 (Phase B) · #745 (Phase C)
**Date:** 2026-07-27

## 1. Objective

One initiative, three sequenced phases in value order, each its own PR + gate — any
phase can stop without stranding the others.

- **Phase A (#747):** scanned/image-only PDF assets become content-searchable via the
  existing enrichment vision flow (they are `skipped: 'no extractable text'` today).
  Rider (decided): the direct-vision path starts writing `run_costs` — both enrichment
  engines land in ONE spend model.
- **Phase B (#746):** timeboxed spike on pdf-parse inside `bun build --compile`
  binaries; three pre-agreed exits (fixed / text-only partial / documented wontfix).
- **Phase C (#745):** linux-x64 OCR leg for the `ocr` pack; tesseract-first static
  build spike, `ocrs`+pinned-models fallback, park-with-findings exit.

## 2. Interview Decisions (settled)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Portfolio | One initiative, phases A→B→C by value; per-phase PRs + gates. |
| 2 | A: OCR depth | **First 3 pages**, sequential single-image vision calls (request shape unchanged at all four layers), page-labeled `ocrText` merge. Caption/tags from page 1. Any page fails ⇒ whole job fails (bounded retries, MAX_ATTEMPTS stays 2) — never silently-partial `done`. |
| 3 | A rider: metering | **Fix the direct-path gap in Phase A**: direct vision calls capture provider token usage and write the same work-class-`enrichment` `run_costs` row the runtime path writes. Never a parallel spend path. |
| 4 | B: exits | All three accepted in advance: (a) full fix (addon embeds/loads beside binary), (b) text-only in binaries via DOMMatrix polyfill stub + honest `pdf_unavailable` render, (c) documented wontfix + re-evaluate-on-future-Bun note (antfly-repin pattern). Timebox: one focused session. |
| 5 | C: engine | Tesseract-first (one-time static linux-x64 build attached to a bits mirror release), `ocrs` + `requires.models` pinning as fallback, park-with-findings as honest exit. |
| 6 | C: naming | No binary aliasing — the linux engine keeps its real name as a second platform-scoped bin entry; the skill documents per-platform commands; readiness reports `unsupported-platform` truthfully on each side. |

## 3. Design

### 3.1 Phase A — scanned-PDF enrichment (#747)

Hook point: the queue's document branch where empty extracted text currently returns
`skipped` (`plugins/assets/lib/enrichment/queue.ts:178-183`).

- New flow for `.pdf` documents with ~empty extraction: `renderPdfPages(path, [1..min(3, total)])`
  via the core engine (already 1568px = vision ceiling) → for each page, one vision
  call through the EXISTING single-image pipeline (image-kind prompt: caption/ocrText/
  tags) → merge:
  - `ocrText`: page-labeled join (`[page 1]\n…\n[page 2]\n…`), plus a visible
    `[pages 4–N not OCR'd]` marker when the doc is longer than 3 pages.
  - `caption` + `suggestedTags`: from the page-1 call only (tags stay schema-capped).
  - `summary`: from the page-1 call if the prompt returns one; never synthesized.
- Failure semantics: any page call fails ⇒ job fails (existing retry/error path).
  Partial results are never applied as `done`.
- Skip/idempotency: unchanged — `done + forVersion` guards the whole job; re-billing
  bounded by MAX_ATTEMPTS = 2. User-edited fields keep winning (apply.ts never-clobber).
- Eligibility/backfill: previously-`skipped` scanned PDFs must become eligible again —
  verify whether the self-heal pass (`incompleteEnrichmentAssetIds`) picks up `skipped`
  status; if not, the status classification changes so it does (resolved at build from
  code, not config). Render temp dirs cleaned per job. Blast radius verified at spec
  time: the live store has ZERO skipped assets (59 done) — no deploy-day billing burst.
- Non-PDF documents with empty text keep the current honest skip.

**Metering rider:** `callDirectVisionProvider` transports surface the provider's token
usage; the direct engine writes a `run_costs` row (work class `enrichment`, direct-path
run id namespace, priced from the model catalog like `agent-cost.ts` does). No new
spend math — reuse the existing recorders. The telemetry row (`assets.enrich`) is
unchanged.

### 3.2 Phase B — compiled-binary pdf-parse (#746)

Spike (scratchpad, no commits) — the ladder, in order:
1. Native addon into the binary: static import of the platform package so Bun
   bundles the `.node`; Bun compile asset embedding; loading from a directory
   shipped beside the binary.
2. TEXT-only via a minimal DOMMatrix/ImageData/Path2D polyfill stub, no canvas.
3. **`unpdf`** (canvas-less serverless pdfjs wrapper): swap the ENGINE's text path
   to it — text extraction works in compiled binaries by construction; render still
   dies (exit (b) shape). Engine churn is why this is rung 3, not the default.

- Exit (a): wire the working mechanism into the build + engine; regression = the T0
  spike script compiled and executed in CI-shape.
- Exit (b): text works in binaries (stub or unpdf), `renderPdfPages` throws
  `pdf_unavailable` with the honest message; release-pipeline knowledge doc gains
  the constraint.
- Exit (c): knowledge doc + #746 closed as constraint with a re-evaluate note.

### 3.3 Phase C — linux OCR leg (#745)

**Consumer correction (locked at spec review):** the bin installer selects the
SERVER's platform — under the Mac-hosted server a `linux-x64` leg never installs.
The real consumer is a **linux-hosted Bakin server** (the rig's `sandbox` modes run
Bakin in-container; any future linux deployment). Small audience today ⇒ this phase
is **park-lean**: the park exit is the expected outcome unless sandbox-mode
verification shows real value. Verification target = sandbox-mode rig, not
container agents under the darwin server.

Spike: produce a pinnable static linux-x64 tesseract (musl/static build once, attach
to a bits `tesseract-v<ver>` mirror release with license + `eng.traineddata`; the
traineddata rides `requires.models` or the tarball). Fallback: `ocrs` binary built
from source + models pinned via `requires.models`. Either way:

- `packs/ocr/bakin-package.json`: second bin entry (real engine name), `linux-x64`
  install key, pack `platforms` gains `linux-x64`.
- `skills/ocr/SKILL.md`: per-platform command section (`ocrit` on macOS, engine name
  on linux), honest note that linux OCR does not read PDFs directly (render first via
  `bakin_exec_pdf_render`).
- Verified on the sandbox-mode rig (`bun run instance up --mode sandbox`) before the
  bits PR merges.
- Park exit (expected default): findings recorded on #745, pack unchanged.

## 4. Commands

```bash
bun run test · bun run lint · bun run check:cycles · bun run typecheck
bun test tests/plugins/assets/ --isolate          # Phase A suites
bun run instance up --runtime pi                  # Phase C rig verification
```

## 5. Testing Strategy

- **Phase A:** extend the enrichment suites (the explorer confirmed no PDF/document
  e2e coverage exists — add it): scanned fixture → 3 rendered pages → 3 mocked vision
  calls → merged page-labeled ocrText + page-1 caption/tags + `done`; >3-page fixture
  (`many-pages.pdf` is image-free — reuse `scanned.pdf` for 2-page + a purpose-built
  fixture only if needed) asserts the not-OCR'd marker; page-2 failure ⇒ job error, no
  partial `done`; text PDF keeps the pure-text path (no render, no vision billing);
  skip guard prevents re-billing; user-edited ocrText survives re-run. Metering: direct
  engine writes the run_costs row (mocked recorder), runtime path unchanged.
- **Phase B:** spike script results recorded; exit (a)/(b) get a compiled-binary smoke
  script + engine unit tests for the stub path.
- **Phase C:** manifest schema validation (bits CI), install + `tesseract`/`ocrs` run
  on the docker rig, readiness green on linux + macOS unchanged.

## 6. Boundaries

**Always:** ONE spend engine (rider reuses existing recorders); ONE PDF engine (all
rendering through `src/core/pdf/`); honest partial markers; per-phase PRs gated on
full suite + lint + cycles; knowledge docs updated per phase (assets-plugin.md,
capability-packs.md, release-pipeline.md as touched).

**Ask first:** any new npm dependency; raising the 3-page budget; changing vision
request shapes (explicitly rejected in interview).

**Never:** multi-image request plumbing (decision #2); server-side OCR execution
(the #742 D9 rule stands — Phase A uses the vision LLM, not the ocr pack binary);
silent partial enrichment marked `done`; binary aliasing in the pack.

## 7. Deferred / exits

- Phase B exit (c) and Phase C park exit are legitimate completions, not failures —
  both close their issue with findings.
- Multi-image vision request shape — only if a second consumer ever needs it.
