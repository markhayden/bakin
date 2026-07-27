# TODO — #742 follow-ups (#747 → #746 → #745)

Plan: `tasks/plan.md` · Spec: `SPEC.md`

## Phase A (branch feat/scanned-pdf-enrichment-747)
- [x] A1  Direct-vision path writes run_costs (usage from transports, ONE recorder)  [commit 1]
- [x] A2  Scanned-PDF vision-OCR loop (3 pages, labeled merge, whole-job-fail) + scanned-4p fixture  [commit 2]
- [x] A3  Docs — assets-plugin.md, models-plugin.md, CLAUDE.md line, README check  [commit 3]
- [ ] CP-A Gate: full suite + lint + cycles → Mark live-test (scanned PDF → searchable + Spend rows) → PR → merge → close #747

## Phase B (after CP-A; branch only for exits a/b)
- [x] B1  Spike: .node addons DO embed (r1c) but canvas loader breaks under $bunfs; TEXT works canvas-less via DOMMatrix/ImageData/Path2D stubs + PDFParse.setWorker(pdf-parse/worker getData()) — exit (b); unpdf unnecessary
- [x] B2  Exit (b) SHIPPED: canvas-less text in binaries + honest render degrade + verify:compiled-pdf smoke
- [ ] CP-B Gate: per exit — PR/merge or docs commit + close #746 with findings

## Phase C (after CP-B — PARK-LEAN, consumer = linux-hosted server)
- [x] GATE  Mark decision: PARK — #745 closed with findings + reopen criteria
- [-] C1  (n/a — parked)
- [-] C2  (n/a — parked)
- [ ] CP-C Close #745 (shipped or parked) · memory update · delete SPEC.md + tasks files · summary comments
