# TODO — #742 PDF attachments + OCR pack

Plan: `tasks/plan.md` · Spec: `SPEC.md`

## Phase 1 (branch feat/pdf-attachments-742)
- [ ] T0  Spike: getScreenshot under bun build --compile (record outcome, no commit)
- [ ] T1  Engine + fixtures — src/core/pdf/{engine,limits}.ts, tests/fixtures/pdf/  [commit 1]
- [ ] T2  Assets delegation — content-extractor uses core engine, PDF code deleted  [commit 2]
- [ ] T3  Exec tools — pdf_read/pdf_render + mcp-server import + docs:generate  [commit 3]
- [ ] T4  Turn-engine kind split + file-lane note generator + placeholder  [commit 4]
- [ ] T5  Chat web lane — allowlist, composer decoupled gating, file chips  [commit 5]
- [ ] T6  Channel-inbound delegates notes to the engine  [commit 6]
- [ ] T7  Docs sweep — knowledge files, CLAUDE.md, README check  [commit 7]
- [ ] CP-1 Gate: bun run test + lint + check:cycles + /verify + Mark live-test → PR → merge

## Phase 2 (after CP-1)
- [ ] P2-T1  Vision CLI binary (ocrit or in-repo Swift) + bits release + sha256
- [ ] P2-T2  packs/ocr manifest + skill (bits repo), install verified on dev instance
- [ ] P2-T3  Bakin: readiness-aware pdf_read guidance + catalog entry + docs  [commit 8]
- [ ] CP-2  Live E2E scanned-PDF OCR · file deferred issues (linux leg, enrichment
        indexing, docx/xlsx note) · close #742 · remove SPEC.md + tasks/plan.md/todo.md
