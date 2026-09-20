# Badge usage follow-ups

## Projects lifecycle states — defer until current UI updates are pushed

- [ ] In `bakin-bits-official/plugins/projects/components/project-status-badge.tsx`,
  change the explicit `StatusBadge` treatment from `soft` to `solid` for Draft,
  Active, Completed, and Archived. Preserve existing tones and sizes.
- [ ] Verify the project list/card examples and relevant plugin tests.

Mark requested recording this on 2026-09-19 and deferring implementation until
the current Bakin UI updates have been pushed. The Projects plugin belongs to
the separate `bakin-bits-official` repository; no project code was changed.
