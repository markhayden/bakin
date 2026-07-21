# Bakin agent instructions

Read `CLAUDE.md` for repository architecture, safety rules, and test conventions.

## Browser UI conformance — mandatory

For every change that creates, modifies, reviews, or documents browser UI, load
and follow `.agents/skills/bakin-ui-conformance/SKILL.md` before planning or
editing. This includes host pages, core plugins, official Bits plugins, SDK UI,
CSS, stories, routing presentation, and UI tests.

Use a defined public Storybook pattern by default. If none can satisfy the
requirement, explain the closest pattern and the concrete mismatch to the user
and obtain explicit approval before implementing a system extension or
exception. Never silently diverge from the design system.
