# Pi Parity — Task Checklist

Plan: `PLAN.md` · Spec: `SPEC.md` · One PR per phase, one commit per task.

## P0 — Spike & adjudication ✅ (2026-07-12)
- [x] Web-search spike end-to-end on Pi (task 890d957f, PASS)
- [x] Compaction adjudication (SDK default ON — no gap; pin test in T3.5)
- [x] Model fallback adjudication (explicit non-goal)

## P1 — feat/integration-secrets
- [x] T1.1 Named secrets in secret store (old shape stays valid — OQ2)
- [x] T1.2 Masked REST + Integrations & Keys tab
- [x] T1.3 Boot env + `~/.bakin/bin` PATH injection
- [x] Gate: suite green (PR #662 merged; live masked round-trip after next server restart)

## P2 — feat/capability-packs
- [x] T2.1 Manifest + catalog schema extensions (capability/runtimes/requires.bins/secretSlot)
- [x] T2.2 Pinned binary installer (`ProjectionKind 'bin'`, rollback-safe)
- [x] T2.3 Readiness engine + doctor check + `bakin check capabilities` (OQ3: health system-checks)
- [x] T2.4 CLI: catalog-name install + consent + key prompt (story 3)
- [x] T2.5 Explore Capabilities shelf + install-dialog key step (story 2)
- [x] T2.6 Onboarding recommended-capabilities component (story 1)
- [x] T2.7 web-search-brave pack in bits + catalog entry + live cutover (replace spike skill)
- [x] Gate: CLEAN-home rig validation done (stories 1–3 real pack/binary/key ladder; story 4 dispatch at post-merge live cutover)

## P3 — feat/pi-task-parity
- [x] T3.1 Pending-approval attention provider (story 6)
- [x] T3.2 Subagent model preservation across switches (per OQ1 decision)
- [x] T3.3 gh readiness check + agent context guidance
- [x] T3.4 Switch-time cron adoption, opt-in `--adopt-cron` (story 7)
- [x] T3.5 Pin tests: compaction default + schedule-tools dispatch context
- [ ] Gate: live gate badge/toast + switch e2e → open PR

## P4 — feat/runtime-hub
- [x] T4.1 Hub shell + Overview tab (legend, credential tiles)
- [x] T4.2 Capabilities tab (readiness chips + remediation links)
- [x] T4.3 Switch tab (dry-run preview, ConfirmDialog, grouped result cards)
- [x] Gate: RTL all tabs green + rig visual review (all three tabs screenshotted) → PR

## P5 — chore/pi-parity-docs
- [x] T5.1 Knowledge/extending/CLAUDE.md/README docs
- [x] T5.2 Task-parity battery 5/5 recorded (spec acceptance 8)
- [x] T5.3 Close-out: memory, spec → SHIPPED, follow-up issues (Discord bridge, extension trust, fast-follow packs)

## Open questions (resolve before their tasks)
- [ ] OQ1: subagent-model scope — recommend preservation-only (T3.2)
- [x] OQ2: secrets.json compat — schema widening, zero migration code (T1.1)
- [ ] OQ3: readiness check owner — recommend health system-checks (T2.3)
