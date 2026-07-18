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

## Browser UI performance baseline

`performance.json` records monotonic production-payload ceilings for the one
canonical design-system stylesheet, initial host JavaScript, current and
focused SDK UI entries (including their statically reachable chunks), every
vendor chunk, every core plugin client, and every official Bits client. Existing
payload is baselined; a reduction passes, while an increase or new artifact
requires explicit review and regeneration. Stable vendor files are pinned
individually; content-hashed `sdk-shared-*` chunks are pinned as an aggregate so
a size-reducing rebuild is not mistaken for a new artifact.

The same architecture gate rejects a transitive chart or conversation import
from base `@makinbakin/sdk/ui` and rejects a plugin-bundled copy of the canonical
stylesheet. Official Bits clients are built in a temporary directory, so these
measurements never modify the Bits checkout. Bun's generated checkout-path
module-label comments are excluded from Bits byte counts so the same pinned
source measures identically locally and in CI; all executable code and bundled
dependencies remain counted.

```sh
bun run build:css && bun run build:vendors && bun run build:plugins && bun run build:host-shell
bun run ui:performance:generate  # intentionally refresh reviewed ceilings
bun run ui:performance           # core + official Bits payload gate
bun run size:report              # full artifact report including UI payloads
```

The checked-in baseline must satisfy `performance.schema.json`. The UI budget
extends the existing size report and issue #423; it does not replace that
issue's whole-binary and release-artifact ownership.

## Browser baseline

See [`baseline/README.md`](baseline/README.md) for the versioned pre-revamp
screenshots, raw style-debt counts, and artifact-size evidence.
