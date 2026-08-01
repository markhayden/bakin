# Add Component

This is a compatibility command for requests phrased as “add a component.” It
does not define a second component architecture.

Before planning or editing, load and follow
`.claude/skills/bakin-ui-conformance/SKILL.md` in full.

1. Find the closest public Storybook pattern and named focused SDK export.
2. Prefer composition from that contract.
3. If the requirement is broadly reusable but missing, propose the public
   Storybook/API extension and obtain any required approval before implementation.
4. If it is domain-specific, use supported composition plus narrowly scoped
   domain presentation.
5. If neither path works, use the conformance skill's concrete deviation and
   explicit-approval protocol. Never create a private primitive merely because
   doing so is faster.
6. Add the story, interaction/accessibility coverage, documentation, and
   conformance evidence required by the selected path.

Do not copy old files from `src/components/ui`, import private `packages/ui`
paths, add a consumer of `@makinbakin/sdk/components`, or invent styling from
generic tokens. The public Storybook and focused SDK entrypoints are the
authoring contract.
