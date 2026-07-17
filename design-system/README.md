# Bakin design-system evidence

This directory contains the machine-readable evidence used to plan and verify
the UI migration. It does not contain the design-system implementation itself.

## Core UI census

`census.json` is generated; do not edit it by hand. It currently accounts for:

- every host route definition, using the explicit route paths from the recent
  TanStack routing work;
- every core plugin page or embedded slot, proven against both
  `bakin-plugin.json` and the matching `registerPlugin({ slots })` binding;
- shared TSX component units in the legacy SDK/host locations; and
- every named public export from `@makinbakin/sdk/components`, including its
  resolved implementation source.

Stable entry IDs and discovery evidence allow migration metadata, stories, and
tests to refer to a surface without copying scanner-owned facts. The only
non-visual route currently classified by the scanner is the `/` redirect.
Official Bits coverage and cross-repository refs are added in T3.

```sh
bun run ui:census:generate  # intentionally refresh census.json
bun run ui:census:check     # fail when the checked-in census is stale/incomplete
```

The checked-in document must satisfy `census.schema.json`. Unsupported route,
registration, or public-export syntax fails loudly so a new surface cannot be
silently omitted.

## Browser baseline

See [`baseline/README.md`](baseline/README.md) for the versioned pre-revamp
screenshots, raw style-debt counts, and artifact-size evidence.
