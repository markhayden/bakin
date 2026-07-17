# Spec: Bakin Browser UI Design System and Full-Surface Revamp

**Status:** Approved for implementation\
**Owners:** Bakin maintainers\
**Approved:** 2026-07-16\
**Last updated:** 2026-07-16

## Objective

Create one authoritative, concrete, testable browser UI design system for
Bakin, expose its supported patterns through `@makinbakin/sdk`, and migrate
every first-party browser surface to it through small, independently
reviewable changes.

The system must make the consistent path the easiest path for both Bakin
maintainers and external plugin authors. It will replace contradictory or
stale styling guidance, document complete component and page patterns, and
add automated checks that detect visual, responsive, accessibility, and
plugin-integration regressions.

## Users

- People using the Bakin browser application.
- Bakin maintainers building the shell and first-party plugins.
- External plugin authors building browser UI through `@makinbakin/sdk`.
- Reviewers evaluating intentional and accidental UI changes.

## Scope

### Included

- Browser shell, navigation, global overlays, settings, and runtime surfaces.
- Every first-party plugin browser surface, including plugins shipped from the
  Bakin core repository and official plugins maintained in
  `bakin-bits-official`.
- Shared UI primitives and higher-level patterns.
- The public SDK styling, component, token, and plugin-CSS contract.
- The reference plugin and plugin starter examples.
- Public documentation that teaches or references browser UI and SDK usage.
- Component workbench, accessibility checks, visual regression, responsive
  verification, and real-host plugin conformance testing.
- Migration and deletion of superseded browser UI patterns.

### Excluded

- The Astro/Starlight documentation site's own visual chrome.
- CLI and terminal UI visual systems.
- Unrelated server, runtime, storage, and plugin behavior.

Relevant documentation-site content remains in scope when browser UI or SDK
contracts change.

## Guiding Constraints

- Complete migration is the destination; no permanent legacy styling tier.
- Prefer deletion and consolidation over compatibility shims.
- Preserve Bakin's recognizable brand anchors while allowing every exact
  visual token and structural UI rule to be reconsidered.
- Existing user-visible behavior must remain intact unless the approved spec
  explicitly changes that behavior.
- Migration work lands in focused, rollback-friendly pull requests and
  atomic commits.
- Public SDK interfaces are designed intentionally; raw implementation details
  are not promoted merely because existing code uses them.
- The design system is a product and compatibility contract, not only a
  screenshot gallery or prose document.

## Existing Foundation

- React 19, Tailwind CSS 4, Base UI, shadcn-derived primitives, CVA, and CSS
  custom properties.
- `@makinbakin/sdk/ui` exposes base primitives.
- `@makinbakin/sdk/components` exposes Bakin-specific compound patterns.
- `.claude/knowledge/style-guide.md` contains a preliminary system and a
  first migration census.
- `.claude/knowledge/design-system.md`, `shared-ui-patterns.md`,
  `ui-patterns.md`, and component-authoring guidance contain useful but
  partially contradictory or stale rules that must be reconciled.
- Playwright is used by targeted verification scripts and documentation
  screenshots, but there is no shared component catalog or general visual
  regression suite.
- The routing-overhaul initiative shipped in PRs #692, #693, and #695 on
  2026-07-16. `.claude/specs/routing-overhaul.md` and
  `.claude/knowledge/url-state-deep-linking.md` are the authoritative routing
  baseline; this initiative must consume that work rather than replace it.

## Decisions

1. **Coverage:** The initiative covers the complete browser product and
   plugin-author browser surface. Documentation-site chrome and CLI/TUI
   visuals are separate initiatives.
2. **Design versus rebrand:** This is a comprehensive UX and design-system
   redesign, not a brand replacement. Preserve the recognizable Bakin logo
   and the roles of the warm dark foundation, green primary action, pink
   signal/accent, and yellow highlight. Exact color values, typography,
   spacing, density, surface hierarchy, radii, elevation, layout, motion, and
   component treatments remain open to revision when usability, contrast,
   hierarchy, or consistency improve.
3. **Density:** Use one canonical compact-professional density. Controls,
   repeated rows, tables, and operational data remain efficient to scan;
   pages and major sections retain enough separation to make hierarchy
   obvious. Do not add user-selectable density modes or maintain parallel
   density variants while establishing the system.
4. **Responsive contract:** Optimize the product for desktop operation while
   keeping every primary workflow functional at 320px. Components respond to
   their available container, with required verification at 1024, 720, 480,
   and 320px. Narrow layouts may stack content, collapse secondary chrome, or
   place wide tables and canvases in bounded internal scrollers; primary
   actions, navigation, and state remain available, and pages must not create
   document-level horizontal overflow.
5. **Theme scope:** Deliver one intentional dark theme. All styling uses
   semantic tokens and components must not assume literal palette values, so
   a future theme can be introduced without rewriting component structure.
   A light theme and user-facing theme selector are not deliverables for this
   initiative. The dark theme must independently satisfy the approved
   accessibility and contrast requirements.
6. **Accessibility:** WCAG 2.2 Level AA is a hard acceptance gate for every
   design-system component, canonical SDK/plugin example, and migrated
   first-party browser surface. Adopt compatible AAA practices when they do
   not undermine the canonical compact density. The contract includes:
   keyboard-equivalent operation; visible and unobscured focus; semantic
   names, roles, values, headings, labels, and live feedback; non-color state
   communication; compliant text and non-text contrast; at least 24 by 24 CSS
   pixel pointer targets or conforming spacing/equivalence; reduced-motion
   behavior; usable 200% text resizing; reflow without lost functionality;
   and non-drag alternatives wherever dragging is not essential.
7. **Authoritative UI workbench:** Storybook is the executable catalog and
   source of truth for design tokens, base primitives, compound components,
   component states, page archetypes, and plugin recipes. Starlight remains
   the curated teaching and task-oriented documentation layer. Playwright
   enforces stable visual and browser contracts against Storybook and against
   representative real-host flows. The installed reference plugin verifies
   that public SDK examples behave correctly inside Bakin rather than only in
   isolation.
8. **Catalog audiences:** Publish a public Storybook containing only supported
   SDK tokens, primitives, components, patterns, and recipes. The local
   maintainer catalog may additionally contain stories for host-internal and
   migration-only components, but they must be explicitly tagged `internal`
   and excluded from the public build. Publication alone must never turn an
   internal component into a plugin-author contract.
9. **Public styling surface:** Arbitrary Tailwind utility strings emitted by
   the host are not part of the supported plugin SDK contract. Plugin authors
   build from SDK components, semantic component props, SDK layout
   primitives, documented recipes, and namespaced semantic CSS variables.
   Domain-specific styling may ship as plugin-owned CSS scoped beneath the
   plugin's host-provided root. Replace public helpers that return Tailwind
   implementation strings with components, typed variants, or stable
   token-backed CSS interfaces. A `className` escape hatch does not make the
   host's generated Tailwind vocabulary a compatibility promise.
10. **Plugin CSS containment:** The host wraps every plugin-owned page and
    every individual slot contribution in an identifiable plugin root such
    as `data-bakin-plugin="<plugin-id>"`. Plugin builds automatically validate
    CSS and reject selectors that escape that root or target global document,
    shell, or other-plugin surfaces. First-party plugins obey the same rule.
    Keyframes, portals, overlays, and other exceptional cases require explicit
    system-owned handling rather than an undocumented global-selector escape.
    This is a visual consistency and collision boundary, not a security
    sandbox; plugin JavaScript still executes in the shared browser runtime.
11. **Plugin visual autonomy:** Plugin application chrome always inherits the
    Bakin design system. Buttons, inputs, typography, spacing, surfaces,
    interaction states, focus treatment, navigation, feedback, and status
    semantics use supported Bakin contracts. Domain-owned data may retain its
    own meaningful visual identity—for example brand palettes, agent colors,
    workflow categories, asset media, and chart series—provided accessibility
    and non-color communication remain intact. Domain expression must not
    become a parallel plugin theme.
12. **Token namespace and source:** Replace generic public CSS variables such
    as `--background`, `--accent`, and `--radius` with an intentional
    namespaced `--bakin-*` contract. Maintain tokens in one canonical source
    that generates or validates runtime CSS custom properties, Tailwind
    mappings used by Bakin implementation code, Storybook specimens, and
    public reference documentation. Migrate all owned consumers and remove
    obsolete generic aliases rather than retaining an indefinite compatibility
    layer.
13. **First-party SDK dogfooding:** Every first-party plugin builds browser UI
    exclusively through the same supported SDK imports available to external
    plugin authors. Direct browser imports from host internals or another
    plugin fail automated architecture checks. The host shell may own clearly
    internal components; any UI capability a plugin needs must be reviewed and
    promoted into the SDK before plugin use. First-party plugin migrations are
    therefore continuous integration tests of the public authoring contract.
14. **Compatibility baseline:** The initiative may make intentional breaking
    changes to current SDK UI exports, token names, helpers, components, and
    props in order to establish a clean first stable design-system baseline.
    Owned first-party consumers and canonical examples migrate in the same
    program; obsolete surfaces are deleted rather than shimmed. After the
    redesigned SDK is declared stable, subsequent public changes follow
    semantic versioning, explicit deprecation, migration documentation, and
    host/plugin compatibility requirements.
15. **Public component maturity:** The public SDK exposes stable components,
    not a separate public experimental tier. New components and patterns
    incubate through tagged internal stories and graduate only after they have
    complete canonical states and responsive coverage, WCAG 2.2 AA
    verification, behavioral and selected visual tests, clear usage guidance,
    and a demonstrated need through at least one real official consumer. An
    official consumer may live in the core repository or in
    `bakin-bits-official`; repository location does not affect first-party
    status.
16. **Layout contract:** Provide an intentionally small public layout
    vocabulary so routine composition does not require arbitrary Tailwind or
    custom plugin CSS. It includes an opinionated plugin page shell and the
    minimum primitives needed for canonical vertical rhythm, inline wrapping,
    responsive grids, sections, and bounded overflow. Choose the final set
    from a complete core-plus-`bakin-bits-official` usage census; do not grow a
    generic layout DSL or expose one-off arrangements as permanent APIs.
17. **Implementation ownership:** Create a private internal `packages/ui`
    package as the source of truth for tokens, base primitives, layout
    components, and presentation-only patterns. The host and SDK consume that
    package; external plugin authors continue to import only through
    `@makinbakin/sdk/*`, so no second public UI package is created. Components
    that inherently depend on Bakin routing, runtime data, registries, or
    plugin APIs remain in the SDK/application-aware layer. Local Storybook may
    develop internal package sources, while public stories import through the
    SDK to verify the supported contract.
18. **Focused SDK entrypoints:** Replace the overloaded public
    `@makinbakin/sdk/components` barrel with focused subpaths whose dependency
    directions and stability can be understood independently. Expected
    categories include base UI, layout, reusable application patterns,
    charts/data visualization, and conversation UI; the final names and
    membership come from the full component census. Remove the legacy barrel
    after owned consumers migrate instead of preserving a compatibility
    re-export.
19. **Published stylesheet:** Publish the exact compiled design-system CSS as
    an explicit SDK artifact such as `@makinbakin/sdk/styles.css`. The Bakin
    host loads one runtime copy; public Storybook, plugin-starter development,
    and external test harnesses import the same artifact to reproduce the host
    styling environment. Installed plugin bundles must not embed duplicate
    copies of the design-system stylesheet.
20. **Canonical token format:** Store source tokens as DTCG 2025.10-compatible
    JSON. A small deterministic repository-owned generator validates the
    source and emits namespaced CSS custom properties, internal Tailwind
    mappings, TypeScript token metadata/types, Storybook specimens, and public
    reference documentation. Do not introduce a heavyweight token
    transformation framework unless requirements exceed this intentionally
    narrow pipeline.
21. **Token layering:** Use three token layers. Internal reference tokens hold
    raw palette values, numeric scales, and font metrics. Public semantic
    tokens express canvas, surface, text, action, status, focus, layout
    spacing, typography, radius, elevation, and motion intent. Internal
    component aliases map semantic intent onto specific implementations such
    as buttons, cards, and fields. Plugins receive semantic tokens and
    documented structural scales, not raw brand values or component internals;
    expose a component-specific token only after external CSS demonstrates a
    durable need.
22. **Motion language:** Motion is restrained and functional. Use a small
    semantic duration and easing vocabulary to explain state changes,
    loading, hierarchy, or spatial relationships. Avoid ornamental entrance
    effects, bouncing controls, and ambient continuous motion; reserve
    repetition for genuinely live activity. `prefers-reduced-motion` removes
    all nonessential animation while retaining clear state communication.
23. **Content-first composition:** Page and section hierarchy comes from
    typography, spacing, surface shifts, and subtle dividers rather than a
    card around every region. Reserve cards for genuinely bounded objects
    such as actionable or persistent entities, overlays, and coherent grouped
    data. Stacks of nested bordered cards are an anti-pattern.
24. **Typography contract:** Official product UI and plugin chrome use one
    shared, bundled typography system: a UI sans plus a mono face for code,
    identifiers, and technical data. Plugins cannot replace chrome typefaces;
    rendered domain content and branded integration previews are exempt. Pick
    the exact faces by comparing realistic Bakin specimens for hierarchy,
    compact-density legibility, numerals, and code/data rendering rather than
    retaining the current fonts by default.
25. **Icon contract:** Lucide is the single icon vocabulary for product and
    plugin chrome. SDK components own common semantic icons, sizes, and
    alignment; builders may use Lucide directly where no semantic component
    applies. New custom chrome icons require central design-system review,
    while logos and domain-specific imagery are exempt. Icons cannot be the
    sole carrier of meaning, and icon-only controls require accessible names
    and discoverable descriptions.
26. **Form contract:** First-party forms and the recommended third-party path
    use SDK field and control primitives rather than hand-styled native
    controls. The contract standardizes labels, descriptions,
    required/optional indicators, validation messages, disabled, read-only,
    loading and submission states, focus behavior, and form spacing. Unusual
    domain interfaces may use raw controls only through an explicit,
    documented exception that still satisfies accessibility and token rules.
27. **System-state contract:** Every asynchronous or data-driven surface
    explicitly designs its loading, initial-empty, filtered-no-results, error,
    permission-denied, and success-feedback states. SDK patterns and guidance
    define when to use skeletons, progress, inline notices, banners, toasts,
    or full-page states. Each state exposes an accessible explanation and a
    clear recovery or next action whenever one exists; these states are part
    of story, accessibility, and migration acceptance coverage.
28. **Canonical page archetypes:** Core and plugin pages compose from a small
    shared set of archetypes, initially expected to cover list/index, detail,
    settings/form, dashboard/overview, conversation, inspector, and
    workflow/action surfaces. The final inventory follows the page census.
    Each archetype documents hierarchy, headers and actions, responsive and
    scrolling behavior, system states, and reusable composition recipes
    without imposing a single rigid template. A new one-off structure must
    demonstrate why the existing archetypes cannot express its requirements.
29. **Routing integration, not reinvention:** The design system adopts the
    shipped routing-overhaul contract unchanged: paths identify pages; query
    parameters identify overlays, tabs, filters, search, pagination, and
    other composable view state. Internal navigation uses `PluginLink`, the
    SDK router hooks, or host-internal TanStack links and never introduces a
    hard reload. Archetype guidance documents when state belongs in the URL,
    including clean defaults, history behavior, scroll restoration, and
    Suspense/loading treatment, while the existing routing tests and lint
    rules remain authoritative. Any proposed URL or router change is a
    separate routing decision, not incidental design-system work.
30. **Browser-test matrix:** Playwright runs behavior, keyboard,
    responsive-overflow, and accessibility smoke coverage in Chromium,
    Firefox, and WebKit. Deterministic pixel-diff baselines are Chromium-only
    at the approved desktop and mobile viewports; the other engines do not
    duplicate the full screenshot matrix unless evidence later identifies a
    browser-specific rendering risk.
31. **Visual-coverage scope:** Every stable public SDK story and every
    official routable browser surface in both Bakin core and
    `bakin-bits-official` has a deterministic Chromium visual baseline at one
    approved desktop and one approved mobile viewport. Coverage expands by
    risk rather than by every possible permutation: high-risk components and
    pages additionally capture relevant loading, empty, error, overflow,
    focused, and open-overlay states. Fixtures freeze data, time, animation,
    fonts, and other nondeterministic inputs.
32. **Catalog hosting and visual review:** Build the public SDK-only Storybook
    as a static site and publish it alongside the existing Astro/Starlight
    documentation through the current Cloudflare Pages deployment, from the
    same release ref. Playwright's repository-owned baselines, HTML reports,
    traces, and expected/actual/diff artifacts remain the visual enforcement
    source of truth. Do not build a custom visual-approval service. Chromatic
    is explicitly deferred and may be reconsidered only if measured review
    friction justifies its recurring dependency and snapshot cost.
33. **Baseline ownership and approval:** Commit approved Chromium visual
    baselines to Git and generate them only in a pinned Playwright Linux
    environment. CI never auto-accepts a changed image. A baseline-updating PR
    identifies the affected surfaces and intended design change and exposes
    expected, actual, and diff artifacts for explicit review. Local host-OS
    screenshots are diagnostic only and cannot replace canonical baselines.
34. **Accessibility verification layers:** Run automated accessibility checks
    against every stable story and official page, keyboard and focus
    interaction tests against every interactive pattern, and manual
    screen-reader review for each page archetype and complex component before
    graduation. Repeat manual review when semantics or interaction materially
    change, not for purely cosmetic edits. Record outcomes, tested workflows,
    and any known limitations alongside the relevant pattern documentation.
35. **Plugin UI conformance harness:** Ship a documented SDK command and
    fixture host that mounts plugin-owned pages and slot contributions inside
    the real published Bakin stylesheet, plugin scope wrappers, layout
    constraints, routing context, and deterministic data environment. The
    harness checks CSS-scope escapes, duplicate or missing host styles,
    horizontal overflow, accessibility violations, console errors, and basic
    desktop/mobile rendering. It is runnable locally and in third-party CI;
    every official core and Bits plugin must pass the same harness.
36. **Conformance enforcement boundary:** Plugin packaging or installation
    rejects only deterministic contract violations that threaten isolation or
    compatibility, including CSS escaping its plugin scope, prohibited token
    access, or a bundled duplicate of the host stylesheet. Broader visual and
    compositional findings remain actionable conformance-test failures rather
    than runtime load blockers. The complete visual and accessibility suite is
    nevertheless a hard CI and release gate for every official core and Bits
    plugin.
37. **Machine-readable UI census:** The foundation phase inventories every
    browser surface and shared component across core and Bits with ownership,
    route or slot identity, page archetype, current implementation and
    violations, target SDK patterns, migration status, and visual-test
    coverage. Generate inventory fields from routes, manifests, registrations,
    exports, stories, and tests wherever possible; keep human-authored fields
    focused on decisions and ownership. The census drives a migration and
    coverage dashboard, and CI detects newly added or silently omitted
    surfaces.
38. **Migration sequence:** Establish tokens, primitives, layout recipes,
    Storybook, testing, and the conformance harness first; then migrate small
    vertical slices by page archetype across both core and Bits rather than
    completing one repository or plugin at a time. Each slice proves the
    pattern against varied official use cases and includes its stories, tests,
    documentation, and census updates. The final phase deletes legacy CSS,
    removed barrels, duplicate components, and temporary enforcement
    allowlists.
39. **Migration behavior boundary:** Surface-migration PRs preserve feature
    logic, data behavior, permissions, and the shipped routing/URL contracts
    unless a separate approved specification changes them. Accessibility
    corrections, responsive reflow, and adoption of approved system patterns
    may change presentation and interaction details. Larger workflow or
    product-behavior opportunities discovered during the audit become linked
    follow-up specs rather than incidental migration changes.
40. **Coordinated SDK stabilization:** Keep the redesigned UI SDK on exact
    prerelease versions while core and the full official Bits fleet migrate.
    Track compatibility across the two repositories explicitly and link
    dependent changes. Cut the first stable UI-contract release only after
    every official consumer passes visual, accessibility, and plugin-harness
    gates; normal semantic-versioning and deprecation policy begins from that
    proven baseline.
41. **Incremental coexistence on `main`:** Migrated and unmigrated surfaces
    may coexist temporarily while small, production-ready PRs land on `main`.
    The census and CI ratchets make legacy usage decrease monotonically and
    prohibit new code from adopting old patterns. Each completed surface
    deletes its replaced implementation; do not use a long-lived mega-branch,
    a duplicate application behind a feature flag, or compatibility wrappers
    to conceal migration state.
42. **Browser-native design-direction checkpoint:** Before finalizing token
    values or production component styling, build a small set of coded visual
    alternatives from realistic Bakin content and the actual rendering stack.
    Cover representative dense list/data, detail/form, and
    conversation/workflow pressure cases at desktop and 320px, including
    typography, spacing, hierarchy, brand color roles, focus, system states,
    and domain content. Approve and document one direction before scaling
    implementation.
43. **Content-design contract:** The system includes shared guidance for
    button and menu labels, sentence case, terminology, dates, times, numbers,
    statuses, destructive confirmations, validation messages, empty and error
    copy, and accessible names. SDK examples provide strong adaptable defaults
    without hard-coding product-specific language, and official core and Bits
    plugins use one maintained terminology glossary.
44. **Runtime performance and size budgets:** Establish measured baselines,
    then ratchet production design-system CSS, initial shell JavaScript,
    focused SDK entrypoint payloads, representative route load time, and
    interaction responsiveness. One host stylesheet copy is allowed;
    Storybook and test dependencies must never enter production bundles, and
    base UI entrypoints must not pull chart, conversation, or other heavy
    domains transitively. Integrate browser-asset measurements with the
    existing `size:report` infrastructure and open issue #423, which continues
    to own whole-binary and release-artifact budgets. Preserve the completed
    SDK vendor-deduplication outcome from issue #422. Set numeric thresholds
    from the audited post-foundation baseline, not arbitrary guesses, and
    require explicit review for any budget increase.

## Commands

The foundation PR introduces these stable repository commands. Individual
scripts may call lower-level tools, but contributors and CI use this surface:

```sh
bun run ui:dev                    # local maintainer Storybook, public + internal
bun run ui:build                  # production maintainer Storybook build
bun run ui:build:public           # SDK-only catalog for docs deployment
bun run ui:tokens:check           # schema, generation, and clean-tree check
bun run ui:census:check           # inventory completeness and migration ratchets
bun run ui:test:stories           # render, interaction, and automated a11y checks
bun run ui:test:visual            # canonical Chromium image comparisons
bun run ui:test:visual:update     # update in the pinned Linux environment only
bun run ui:test:browsers          # Chromium, Firefox, and WebKit behavior smoke
bun run ui:test:conformance       # reference and official plugin-host checks
bun run ui:performance            # browser payload and runtime budget checks
bun run ui:check                  # complete design-system gate
```

Generated plugin starters expose `bun run test:ui`, which invokes the pinned
SDK conformance harness without requiring authors to memorize its internal
entrypoint. Exact lower-level invocation remains an SDK implementation detail.

These existing repository checks remain required:

```sh
bun run lint
bun run typecheck
bun run test
bun run docs:check
bun run build:css
bun run build:vendors
bun run build:plugins
bun run build:host-shell
```

`docs:check` builds and validates the public Storybook into the combined docs
artifact. The canonical screenshot-update script runs in a Microsoft
Playwright Linux image whose tag exactly matches the repository Playwright
package; upgrading one requires upgrading the other in the same PR.

## Project Structure

The target layout is:

```text
design-system/
  census.json                     generated surface/component inventory
  migrations.json                 ownership, archetype, target, and status
  terminology.md                  shared product-language glossary
  manual-a11y/                    archetype and complex-pattern review records

packages/ui/                      private; never a plugin import target
  tokens/                         DTCG JSON reference + semantic token sources
  src/primitives/                 presentation-only base components
  src/layout/                     page shell and minimal layout vocabulary
  src/patterns/                   presentation-only shared patterns
  src/styles/                     generated/runtime CSS assembly

packages/sdk/src/
  ui/                             public base UI entrypoint
  layout/                         public layout entrypoint
  patterns/                       app-aware reusable patterns
  charts/                         isolated data-visualization entrypoint
  conversation/                   isolated conversation entrypoint
  testing/                        plugin fixture/conformance APIs
packages/sdk/styles.css           published generated stylesheet artifact

.storybook/                       shared React/Vite workbench configuration
storybook/public/                 stories importing only public SDK paths
storybook/internal/               tagged host/private/migration stories
storybook/fixtures/               deterministic data, time, fonts, and states

scripts/ui/
  generate-tokens.ts              validate and emit every token artifact
  census.ts                       scan core and Bits routes, slots, and exports
  validate-plugin-css.ts          containment and duplicate-style checks
  verify-generated.ts             fail on stale generated outputs
  performance.ts                  payload/runtime budget collection

tests/ui/
  stories/                        story render, interaction, and axe checks
  visual/                         Storybook and official-surface Playwright specs
  browser/                        cross-engine functional/responsive smoke
  conformance/                    real-host plugin page and slot harness
  architecture/                   import, CSS, token, and catalog-publication gates
  snapshots/                      canonical Linux Chromium baselines

docs/src/content/docs/extending/ui/
                                   curated author guidance and recipes
docs/dist/ui/                     public Storybook in the deployed artifact
```

Stories and deterministic fixtures change atomically with their supported
components. The workbench has two explicit build audiences: the local
maintainer build includes tagged internal stories; the deployed build accepts
only the public story roots and verifies that every story imports through
`@makinbakin/sdk/*`.

`bakin-bits-official` owns corresponding conformance configuration, fixtures,
and census metadata for its plugins. Bakin CI continues the existing sibling
clone pattern to verify the released/default Bits fleet; coordinated
prerelease work records the exact Bakin and Bits refs in the compatibility
matrix.

## Code Style

Follow the repository's TypeScript, React, naming, and import conventions plus
these UI rules:

- Public examples import only focused `@makinbakin/sdk/*` entrypoints and the
  published stylesheet; private `packages/ui` imports fail outside the host
  and SDK implementation.
- Components expose typed semantic variants and states. CVA and Tailwind may
  implement private styling, but generated class strings are not public APIs.
- Use semantic `--bakin-*` tokens. Raw palette utilities, undocumented pixel
  values, generic public CSS variables, and arbitrary text sizes fail owned
  code checks unless a path-specific migration allowance exists.
- Use the SDK layout vocabulary for routine composition. Plugin-owned CSS is
  reserved for genuine domain presentation and is nested under the injected
  `data-bakin-plugin` root.
- `className` is a constrained escape hatch, not the primary variant API.
  Inline styles are limited to runtime domain values such as measured geometry
  or user/data-owned colors and must retain accessible non-color meaning.
- Interactive primitives expose semantic HTML, accessible names, visible
  focus, keyboard operation, `data-state` where appropriate, and deterministic
  test hooks without encoding visual assertions into product logic.
- Loading, empty, no-results, error, permission, disabled, read-only, and
  success states are implemented with the approved system-state patterns, not
  improvised local markup.
- Product copy follows the maintained terminology and content-design guide.
- Canonical examples demonstrate supported composition and include misuse
  guidance where an attractive but incorrect alternative is likely.

## Testing Strategy

### Static and unit checks

- Validate DTCG token schema, references, allowed public layers, deterministic
  output, and a clean working tree after regeneration.
- Verify focused SDK export maps and dependency direction; base UI cannot
  transitively import app-aware, chart, or conversation modules.
- Scan host, core plugins, and Bits for forbidden imports, generic/raw tokens,
  new legacy patterns, unscoped CSS, duplicate host styles, raw internal
  anchors, and hand-built controls without an approved exception.
- Generate the census from routes, slots, manifests, exports, and stories and
  compare it with reviewed migration metadata. Unknown or omitted surfaces
  fail CI.
- Unit-test token generation, CSS selector analysis, census parsing, variant
  mappings, and other pure behavior with `bun:test`.

### Story and component checks

- Every stable public component has deterministic stories for canonical
  variants, interactive states, content stress, narrow containers, and the
  relevant system states.
- Story render and `play` tests verify behavior using roles and accessible
  names. The Storybook accessibility addon/axe runs with violations configured
  as errors; any suppression is narrow, documented, and manually verified.
- Existing Testing Library component tests remain appropriate for logic that
  benefits from isolated assertions; story interaction tests avoid duplicating
  the same behavior without reason.

### Playwright visual and browser checks

- Canonical Chromium baselines run in pinned Linux at `1440x900` and
  `320x800` for every stable public story and official route. High-risk states
  add focused/open overlays, loading, empty, error, long-content, and bounded
  overflow captures.
- Responsive assertions run at container widths 1024, 720, 480, and 320 CSS
  pixels and fail on document-level horizontal overflow, missing primary
  actions, inaccessible navigation, or clipped focus indicators.
- Chromium, Firefox, and WebKit run keyboard, focus, routing, system-state,
  console-error, and responsive smoke suites. Pixel baselines stay
  Chromium-only unless a demonstrated browser-specific risk adds a targeted
  snapshot.
- Fixtures freeze dates, timers, random IDs, animation, network responses,
  fonts, viewport, color scheme, and data. Dynamic regions are stabilized at
  their source; masking is a reviewed last resort.
- PR CI uploads the self-contained Playwright HTML report, trace, and
  expected/actual/diff artifacts on failure. It never updates baselines.

### Plugin conformance

- Mount the reference plugin, every core plugin, and every Bits plugin through
  the public SDK inside the real host stylesheet, route/slot wrappers, router,
  overlays, and deterministic runtime fixtures.
- Validate page and per-slot containment, portal behavior, missing/duplicate
  styles, accessibility, console errors, responsive overflow, and representative
  navigation at desktop and mobile sizes.
- The generated starter's `bun run test:ui` exercises the same harness with a
  sample page, slot contribution, form, system states, and domain CSS example.

### Accessibility and human verification

- Automated checks cover every stable story and official page; keyboard and
  focus workflows cover every interactive pattern.
- Before graduation, manually verify each archetype and complex component with
  representative screen-reader/browser combinations and record the workflow,
  result, and limitations in `design-system/manual-a11y/`.
- Manually verify 200% text zoom, 320 CSS-pixel reflow, reduced motion, target
  size/spacing, high-content stress, and non-drag alternatives where relevant.

### Performance and CI cadence

- Capture production CSS, host initial JS, focused SDK entrypoint, and official
  plugin-client sizes through the existing size-report pipeline; fail ratcheted
  budget increases.
- Run representative cold/warm navigation and interaction smoke measurements
  against dense desktop and mobile fixtures. Establish numeric thresholds only
  after repeatability is proven in CI.
- Any PR touching tokens, UI packages, public SDK UI, styles, stories, host
  shell, or plugin browser code runs the full affected visual gate; uncertain
  dependency impact expands to the full suite. `main`, prerelease, and stable
  release gates run the complete core-plus-Bits matrix.
- Storybook, Vite, Playwright reporters, and accessibility tooling are
  development-only. Production build assertions prove they are absent from
  shipped host, SDK, and plugin bundles.

## Boundaries

### Always

- Build browser UI from supported SDK primitives and patterns first.
- Update the authoritative specification and knowledge documentation when a
  design-system decision changes.
- Preserve or improve keyboard access, focus behavior, responsive behavior,
  and meaningful loading, empty, error, and disabled states.
- Update the census, stories, tests, public guidance, and manual review record
  that correspond to a changed supported contract.
- Measure production asset and interaction budgets for every migration slice.
- Delete the replaced implementation within the same completed surface slice.
- Verify each migration slice before its checkpoint commit.

### Ask First

- Product behavior changes unrelated to presentation or interaction
  consistency.
- New hosted services or recurring costs.
- A trust-boundary change such as rendering plugins in iframes.
- Scope expansion into documentation-site chrome or CLI/TUI design.
- A new public entrypoint, page archetype, component-specific public token, or
  raw-control exception.
- Any visual baseline update, accessibility suppression, CSS-scope exception,
  or performance-budget increase.

### Never

- Maintain two permanent implementations of the same UI pattern.
- Treat a visual snapshot as proof of usability or accessibility by itself.
- Expose host-internal imports as plugin-author contracts.
- Grant first-party plugins private UI import paths unavailable to external
  builders.
- Approve unscoped plugin CSS as the long-term extension contract.
- Let one plugin override global shell or another plugin's visual tokens and
  selectors through its stylesheet.
- Auto-accept visual baselines or use host-OS screenshots as canonical output.
- Load remote fonts or let a plugin replace product-chrome typography.
- Ship Storybook, Vite, visual-test, or accessibility-test dependencies in a
  production browser bundle.
- Add new uses of an allowlisted legacy pattern while the migration is active.

## Success Criteria

1. The coded design-direction checkpoint is approved at desktop and 320px and
   records the chosen typography, token values, hierarchy, and composition
   principles before production component styling scales.
2. The machine-readable census accounts for 100% of browser routes, page
   slots, individual slot contributions, shared UI components, and public SDK
   UI exports across Bakin and `bakin-bits-official`; CI fails on an unknown or
   silently omitted surface.
3. One DTCG token source deterministically generates namespaced runtime CSS,
   internal Tailwind mappings, TypeScript metadata/types, Storybook specimens,
   and public reference docs. Regeneration produces no uncommitted diff.
4. The public Storybook contains every and only stable SDK UI contract, imports
   exclusively through public SDK paths, passes render and automated
   accessibility tests, and deploys with the same release ref under the
   existing docs/Cloudflare site. Internal stories cannot enter that build.
5. Every stable public component documents and tests its supported variants,
   states, content stress, keyboard behavior, and responsive contract. Every
   official route and slot contribution has deterministic desktop/mobile
   coverage, with risk-based additional state captures.
6. Playwright's complete Chromium baseline suite is green in the pinned Linux
   environment; Chromium, Firefox, and WebKit behavior suites are green; no
   migrated page produces document-level horizontal overflow from 1024 down to
   320 CSS pixels.
7. Every component, archetype, canonical example, and migrated official
   surface satisfies WCAG 2.2 AA acceptance. Automated checks have no
   unapproved violations, interactive patterns pass keyboard/focus tests, and
   required manual screen-reader/reflow/reduced-motion records are complete.
8. The public plugin conformance harness runs through one documented starter
   command and detects seeded failures for CSS escape, duplicate/missing host
   CSS, overflow, accessibility, and console errors. The reference plugin,
   every core plugin, and every Bits plugin pass it.
9. Static architecture checks prove official plugins use only supported SDK
   UI paths; no owned plugin imports host internals or another plugin, escapes
   its CSS root, hand-rolls a standard control without an approved exception,
   or relies on arbitrary host-generated Tailwind classes.
10. The host loads exactly one published design-system stylesheet. Generic
    token aliases, the legacy `/components` barrel, duplicate primitives,
    replaced helpers, and completed migration allowances are deleted.
11. Production design-system CSS, initial host JS, focused SDK entrypoints,
    official plugin clients, representative route loading, and interaction
    measurements remain within audited ratcheted budgets. Storybook/testing
    dependencies are absent from production artifacts, and issue #423's size
    reporting can consume the browser-asset results.
12. The SDK starter, public Storybook, Starlight teaching docs, generated API
    reference, terminology guide, page-archetype guidance, and migration notes
    describe the same supported contract and pass `docs:check`.
13. Every census item is marked migrated with its replacement stories, tests,
    documentation, and owner accepted; legacy-usage ratchets reach zero and
    their scanners/allowlists are replaced by permanent no-regression rules.
14. Core and the entire official Bits fleet pass the compatibility matrix on
    the same exact SDK prerelease. Only then is the first stable redesigned UI
    SDK released and normal semantic-version/deprecation policy activated.
15. Existing product test, lint, typecheck, docs, CSS, vendor, plugin, and host
    builds remain green, and the shipped routing-overhaul contracts continue
    to pass unchanged.

## Open Questions

None blocking specification approval.

Exact font faces, token values, final archetype membership, and numeric
performance budgets are outputs of explicitly gated census, coded-specimen,
and measurement tasks. They require evidence and approval at those checkpoints
and cannot be chosen responsibly from the preliminary audit alone.

## Standards and Primary References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Design Tokens Community Group Format 2025.10](https://www.designtokens.org/TR/2025.10/format/)
- [Storybook React/Vite](https://storybook.js.org/docs/get-started/frameworks/react-vite/)
- [Storybook testing](https://storybook.js.org/docs/writing-tests)
- [Storybook accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- [Playwright Docker guidance](https://playwright.dev/docs/docker)
- [Playwright reporters](https://playwright.dev/docs/test-reporters)
- [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
- [Cloudflare Pages monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/)
