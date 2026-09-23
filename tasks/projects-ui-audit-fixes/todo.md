# Projects audit fixes — execution checklist

Plan: [implementation, validation and rollback](plan.md).
Spec: [approved scope](../../.claude/specs/projects-ui-audit-fixes.md).

- [x] Repositories switched to main and pulled; local work preserved in named stash.
- [x] Audit investigated; eight product decisions approved.
- [x] Specification approved by the user.
- [x] ConversationPanel handle forwarding explicitly approved (Q9).
- [x] Detailed implementation plan and dependency/rollback review drafted.
- [x] User approves this plan and its local checkpoint commits ("approve").

Implementation started on the approved feature branches. Record checkpoint hashes and verification
evidence when checking an item; a written plan is not a passing test.

- [x] T01: Establish isolated baseline and execution records
- [ ] T02: Reproduce detail diagnostics and risky write behavior
- [x] T02b: Make scoped plugin replacement writes atomic
- [x] T03: Implement AgentSelect's approved appearance contract
- [x] T04: Preserve full Markdown context through managed sections
- [x] T05: Add bounded, accessible Markdown comparison
- [x] T06: Correct shared composer focus behavior
- [x] T07: Correct contained conversation keyboard scrolling
- [x] T07b: Forward the existing composer handle through ConversationPanel
- [ ] T08: Publish shared contract evidence and docs
- [x] T09: Centralize detail requests and honest load states
- [x] T10: Propagate corrupt/unavailable history honestly
- [ ] T11: Unify history loading and retry presentation
- [x] T12: Implement atomic expected-value project writes
- [x] T13: Persist replay-safe checklist add operations
- [x] T14: Recover promotion without duplicate board tasks
- [x] T15: Decouple lifecycle from checklist progress
- [ ] T16: Implement project draft state independently of rendering
- [ ] T17: Connect the staged project form
- [ ] T18: Compose explicit field conflict resolution
- [ ] T19: Own independent checklist mutations and drafts
- [ ] T20: Make checklist editing and progress accessible
- [ ] T21: Coordinate all drafts with the shared exit guard
- [ ] T22: Compact optional mobile brainstorm without losing state
- [ ] T23: Finish detail layout, headings, labels and asset feedback
- [ ] T24: Consume canonical Markdown comparison in Projects
- [ ] T25: Make detail behavior a required browser gate
- [ ] T26: Coordinate exact SDK package, canonical CSS and CI pin
- [ ] T27: Finish docs and finding-by-finding closure
- [ ] T28: Final review, conformance and PR handoff

- [x] Exact 12 shared foundation visual candidates approved and verified; any later candidates require their own approval.
- [ ] All audit findings closed with linked evidence.
- [ ] Both PRs pass checks at their final heads.
- [ ] Handoff includes Core host prerequisite, exact SDK pin and rollback order.

Merge, release and production installation require separate user instruction.
