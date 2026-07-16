# TODO — Schedule Hardening + Scheduled Domain Events (#191)

> Detail: `tasks/schedule-hardening-and-events/plan.md` · Spec: `SPEC.md`

## PR1 — fix(schedule): harden scheduling foundation
- [x] T1 Register schedule-sync health check (S)
- [x] T2 cron_fires retention sweep — ledger verb + daily call + dedup-safety pin (M)
- [x] T3 Cron conformance coverage + teeth (M)
- [x] T4 Switch-survival integration test, both directions, ±--adopt-cron (M) — found+fixed adopted-cron tz loss
- [x] T5 Knowledge docs: audit stances (XS)
- [ ] CHECKPOINT: suite green ✔ → live 3737 → Mark approves → merge

## PR2 — feat(schedule): first-class one-shot 'at' schedules
- [x] T6 Delete dead 'every' kind (XS)
- [x] T7 Engine: kind-aware eval, 'at' fires once, auto-disable + completed state (M)
- [x] T8 Server creation paths: NL parse, routes, exec tools, past-instant rejection (M) — ParseResult now { kind, expr }
- [x] T9 UI: one-time mode in schedule-input, completed display (M)
- [x] T10 Docs (knowledge + stale README rewrite) + manifest 1.1.0 (XS)
- [ ] CHECKPOINT: live one-shot end-to-end → Mark approves → merge

## PR3 — refactor(schedule): server-computed occurrences feed the calendars
- [x] T11 Occurrences endpoint (kind-aware, past/future annotated, ledger disposition, DST-pinned) (M)
- [x] T12 Calendars consume endpoint; delete client cron parsing; consolidate agent colors; disposition dots (L)
- [ ] CHECKPOINT: calendars eyeballed live → Mark approves → merge

## PR4 — feat(schedule): plugin-contributed scheduled domain events
- [x] T13 SDK ScheduledDomainEvent type + server-side zod schema (S)
- [x] T14 Hook fan-in on occurrences endpoint (2s timeout, honest droppedProviders) (M)
- [x] T15 tasks.scheduledEvents provider + taskboard-broadcast refetch (M)
- [x] T16 Calendar rendering: distinct event chips + popover + deep links (M)
- [x] T17 Reschedule verb: POST /events/reschedule + ConfirmDialog picker + tasks.rescheduleEvent (M)
- [x] T18 Docs (external-author guide, knowledge doc, CLAUDE.md blurb) + manifests (schedule 1.2.0, tasks minor) (S)
- [ ] CHECKPOINT: #191 acceptance criteria verified live → Mark approves → merge → close #191

## Phase 5 — bakin-bits-official
- [x] T19 Bits adoption (bits PR #87, merged 2026-07-16) — no hot-patch drift existed (already reconciled); messaging.scheduledEvents + rescheduleEvent shipped (manifest 0.8.0). NOTE: projects has NO milestones (no date-bearing domain concept) — contributes nothing; spec criterion 9 is messaging-only, honestly.
- [x] CHECKPOINT: initiative complete. Bakin PRs #681 #682 #683 #685 merged (closes #191).

## Post-initiative follow-ups
- [ ] Cut a Bakin release: bits CI has been red since 2026-07-14 because plugins use SDK surface newer than the npm-published 0.1.0 (conversation-kit helpers) — a v* tag publishes @makinbakin/sdk and heals it
- [ ] After the SDK release: swap messaging's local contract types for the @makinbakin/sdk exports (noted in plugins/messaging/lib/scheduled-events.ts)
- [ ] Watch the 2s scheduled-events provider timeout (schedule:events logger logs elapsed ms on every drop)
