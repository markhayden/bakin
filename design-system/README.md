# Bakin design-system evidence

This directory contains the machine-readable evidence used to plan and verify
the UI migration. It does not contain the design-system implementation itself.

## Core UI census

`census.json` is generated; do not edit it by hand. The official census
accounts for:

- every host route definition, using the explicit route paths from the recent
  TanStack routing work;
- every core plugin page or embedded slot, proven against both
  `bakin-plugin.json` and the matching `registerPlugin({ slots })` binding;
- shared TSX component units in the legacy SDK/host locations; and
- every named public export from `@makinbakin/sdk/components`, including its
  resolved implementation source;
- every official Bits runtime route from Messaging and Projects, including
  redirect-only aliases and the exact bound client component;
- official Bits page/embedded slots; and
- the official plugin author template.

Stable entry IDs and discovery evidence allow migration metadata, stories, and
tests to refer to a surface without copying scanner-owned facts. Full mode
requires official Bits input through the same `BAKIN_DOCS_EXTERNAL_SOURCES`
root used by `docs:check`, falling back to the sibling checkout locally.

```sh
bun run ui:census:generate  # intentionally refresh census.json
bun run ui:census:check     # fail when the checked-in census is stale/incomplete
bun run ui:census:check --core-only
                            # explicitly partial local check; never an official gate
```

The checked-in document must satisfy `census.schema.json`. Unsupported route,
registration, or public-export syntax fails loudly so a new surface cannot be
silently omitted.

`compatibility.json` records the exact Bakin and official Bits Git refs, SDK
workspace/fixture versions, plugin versions and Bakin ranges, route totals,
redirect aliases, and slots used by the official check. It deliberately names
both core and official Bits as first-party consumers. CI and docs deployment
checkout the recorded Bits ref rather than whatever happens to be at the tip
of its default branch.

## Legacy style ratchet

`migrations.json` is the generated, path-pinned migration ledger for current
browser styling debt across the host, shared SDK UI, core plugins, the Bakin
reference plugin, and official Bits. Each path records exact per-rule ceilings,
its owner, a valid census entry, intended migration task/archetype, target, and
temporary `legacy-allowed` status. It covers raw palette values, arbitrary
sizes, hand-built controls, inline styles, generic tokens, unscoped plugin CSS,
and private plugin imports.

The gate is monotonic: unchanged or reduced counts pass; a new path/rule or an
increase fails. A completed migration slice deletes its replaced styling and
then regenerates the ledger so the lower ceiling is reviewed and committed.
The checked-in document must satisfy `migrations.schema.json`.

```sh
bun run ui:legacy-styles:generate  # intentionally refresh reviewed ceilings
bun run ui:legacy-styles:check     # official core + Bits CI/release gate
```

Both commands resolve official Bits through the same
`BAKIN_DOCS_EXTERNAL_SOURCES`/sibling-checkout contract used by the census and
docs. Missing Bits input fails rather than silently weakening coverage.

## Browser baseline

See [`baseline/README.md`](baseline/README.md) for the versioned pre-revamp
screenshots, raw style-debt counts, and artifact-size evidence.
