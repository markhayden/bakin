# Pi Ecosystem — Task List

See PLAN.md for acceptance criteria. One PR per workstream; live-test before merge.

## WS1 — bits release fix (PR 1)
- [x] T1.1 strip `entry`/`tests` from bits `plugins/_template/` (bits 0464ffb)
- [x] T1.2 published (projects-v0.7.0 + messaging-v0.7.1; also repaired the publish pipeline: SDK assembled from Bakin clone via BAKIN_SDK_DIR — bits a382b48; ambient SDK types caught up to declarative routes — bits 0b9602c)
- [x] T1.3 fresh-home resolver verification: both artifacts resolve + packaged manifests pass readPluginManifestJson (live 0.6.0 local installs left untouched)

## WS2 — pack legs + packs (PR 2)
- [ ] T2.1 manifest schema: requires.npm/models/prereqs + platforms
- [ ] T2.2 npm-installer + model-installer, wired at all four lifecycle sites
- [ ] T2.3 readiness legs + hub rendering
- [ ] T2.4 pack: youtube-transcript (bits + catalogs)
- [ ] T2.5 pack: transcribe (bits + catalogs)
- [ ] T2.6 pack: browser-tools (bits + catalogs)
- [ ] T2.7 knowledge + authoring docs

## WS3 — images completion (PR 3)
- [ ] T3.1 direct-shim input-images (openai edit + gemini) in core media
- [ ] T3.2 adapter-pi providers()/edit() completion (openai-by-key + google)
- [ ] T3.3 codex lane verification + 3×3 live battery
- [ ] T3.4 docs; close #627

## WS4 — extension trust lane (PR 4)
- [ ] T4.1 neutral `extensions?` contract member + arch tests
- [ ] T4.2 adapter discovery + default flip all→allowlist + containment fixtures
- [ ] T4.3 REST + CLI (list/allow/revoke)
- [ ] T4.4 hub UI (approve via ConfirmDialog + disclosure) + `pi.extensions` doctor check
- [ ] T4.5 docs; close #670 + #626
