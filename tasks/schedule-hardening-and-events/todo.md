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
- [ ] T6 Delete dead 'every' kind (XS)
- [ ] T7 Engine: kind-aware eval, 'at' fires once, auto-disable + completed state (M)
- [ ] T8 Server creation paths: NL parse, routes, exec tools, past-instant rejection (M)
- [ ] T9 UI: one-time mode in schedule-input/job-form, completed display (M)
- [ ] T10 Docs + schedule manifest bump (XS)
- [ ] CHECKPOINT: live one-shot end-to-end → Mark approves → merge

## PR3 — refactor(schedule): server-computed occurrences feed the calendars
- [ ] T11 Occurrences endpoint (kind-aware, past/future annotated, ledger disposition, DST-pinned) (M)
- [ ] T12 Calendars consume endpoint; delete client cron parsing; consolidate agent colors (L)
- [ ] CHECKPOINT: calendars eyeballed live → Mark approves → merge

## PR4 — feat(schedule): plugin-contributed scheduled domain events
- [ ] T13 SDK ScheduledDomainEvent type + server-side zod schema (S)
- [ ] T14 Hook fan-in on occurrences endpoint (2s timeout, honest droppedProviders) (M)
- [ ] T15 tasks.scheduledEvents provider + change events (M)
- [ ] T16 Calendar rendering: distinct event chips + popover + deep links (M)
- [ ] T17 Reschedule verb: ConfirmDialog date picker + tasks.rescheduleEvent (M)
- [ ] T18 Docs (external-author guide, knowledge doc, CLAUDE.md blurb) + manifest bumps (S)
- [ ] CHECKPOINT: #191 acceptance criteria verified live → Mark approves → merge → close #191

## Phase 5 — bakin-bits-official
- [ ] T19 Reconcile projects hot-patch → messaging + projects adopt contract → live verify (M)
- [ ] CHECKPOINT: all SPEC success criteria checked
