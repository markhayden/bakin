# Pi Ecosystem — Task List

See PLAN.md for acceptance criteria. One PR per workstream; live-test before merge.

## WS1 — bits release fix (PR 1)
- [x] T1.1 strip `entry`/`tests` from bits `plugins/_template/` (bits 0464ffb)
- [x] T1.2 published (projects-v0.7.0 + messaging-v0.7.1; also repaired the publish pipeline: SDK assembled from Bakin clone via BAKIN_SDK_DIR — bits a382b48; ambient SDK types caught up to declarative routes — bits 0b9602c)
- [x] T1.3 fresh-home resolver verification: both artifacts resolve + packaged manifests pass readPluginManifestJson (live 0.6.0 local installs left untouched)

## WS2 — pack legs + packs (PR 2) — MERGED #674 + #675; #671 closed
- [x] T2.1 manifest schema: requires.npm/models/prereqs + platforms (+ tar.gz bin archives, optional prereqs)
- [x] T2.2 requirements-installer (npm payloads + models), ONE entry point at all lifecycle sites + boot model-env injection
- [x] T2.3 readiness legs + hub rendering + CLI consent preview
- [x] T2.4 youtube-transcript 1.0.1 (v2 lib — 1.0.4 silently broken vs current YouTube; verified live end-to-end)
- [x] T2.5 transcribe (tarball bin + 940MB pinned model + PARAKEET_CPP_MODEL_PATH env; darwin-arm64; authored + validated, live install awaits Mark's consent to the download)
- [x] T2.6 browser-tools (pruned dep set, Chrome prereq; authored + validated)
- [x] T2.7 capability-packs.md + public authoring docs

## WS3 — images completion (PR 3) — MERGED #676; #627 closed
- [x] T3.1 direct-shim input-images (openai /images/edits multipart + gemini inline_data)
- [x] T3.2 adapter-pi providers()/edit() completion + plugin reference-gate relax
- [x] T3.3 codex lane live battery PASS (create/edit/multi-ref, real PNGs); key lanes covered by fake-endpoint suites (no metered keys on this box — 3×3 completes when keys are added)
- [x] T3.4 pi-adapter.md updated; #627 closes with the PR

## WS4 — extension trust lane (PR 4)
- [x] T4.1 extensions? contract member + .extensions!. arch ban
- [x] T4.2 inert discovery + default flip all→allowlist + exact-match predicate + live-settings getter (no-restart trust changes)
- [x] T4.3 REST + `bakin runtime extensions {list,allow,revoke}` (live round-trip verified)
- [x] T4.4 hub Extensions section (ConfirmDialog + disclosure) + pi.extensions doctor warn
- [x] T4.5 docs updated; #670/#626 close with the PR
