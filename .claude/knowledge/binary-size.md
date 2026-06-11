# Binary Size & Dependency Decisions

Decision record for #424 (audit optional heavy server dependencies in
compiled binaries). Spec: `.claude/specs/binary-and-vendor-size-debt.md`.

## How to measure

`bun run size:report` (scripts/report-sizes.ts) prints:

1. **Artifact sizes** — vendor bundles, plugin client bundles, host shell,
   compiled binaries (whatever is built on disk).
2. **Server bundle graph** — bundles `server.ts` with `bun build
   --target=bun --metafile` into a throwaway dir and attributes source
   bytes per node_modules package (app code grouped by top-level dir).
   This answers "is dependency X actually in the binary, and how big".

Run it before and after any dependency or build-boundary change.

## Baseline (2026-06-10, pre-#424 cleanup)

Binaries: darwin-arm64 71.0 MB, linux-x64 107.9 MB, linux-arm64 107.4 MB.
Server-graph total: 11.93 MB source bytes across 84 packages/groups.
The binary is dominated by the embedded Bun runtime + embedded browser
assets; total optimizable dependency source is ~3 MB (~3-4% of binary).

## Per-dependency decisions

| Dependency | Bundled source | Decision | Rationale |
|---|---|---|---|
| pdfjs-dist (+pdf-parse) | 942 KB + 77 KB | **Keep** | PDF text extraction for asset search. Already runtime-lazy (`plugins/assets/lib/content-extractor.ts:90`) — zero startup cost; bytes are disk-only. |
| react-reconciler + yoga-layout + ink + @inkjs/ui | ~1.12 MB | **Keep** | CLI TUI rendering. Already lazy behind TTY-conditional dynamic imports (`src/core/cli.ts`). Server mode never loads it. |
| react-devtools-core (+ shell-quote, ws@7) | 608 KB+ | **Keep (bundling-forced); direct dep removed** | Zero direct import sites; only ink's *optional* peer. Removed from `dependencies` (manifest hygiene), but Bun auto-installs optional peers, so it still lands in the bundle. `--external react-devtools-core` on `--compile` was tested and REJECTED: the compiled binary fails at startup on every command (`Cannot find package 'react-devtools-core' from '/$bunfs/root/...'`) — compiled binaries resolve externals eagerly. Stub-override of ink's peer would be a hidden workaround; not acceptable. |
| iconv-lite | 315 KB | **Keep (transitive, not ours)** | Pulled by express/body-parser via `@modelcontextprotocol/sdk` (declares `express ^5.2.1`). Confirmed in the bundle. Goes away only if the MCP SDK drops express. |
| sharp | 213 KB JS | **Keep** | Image dimensions + thumbnails. Runtime-lazy with graceful degradation (`plugins/assets/lib/asset-service.ts:90`, `plugins/images/lib/tools.ts:72`); in devDependencies. |
| zod | 700 KB | **Keep (core)** | Schema validation at every API/MCP boundary (77 import sites). Architectural. |

## Explicit non-goals

**No optionalization.** Fetch-on-demand dependencies, feature-gated
installs, or externalized packages would break the self-contained binary
guarantee and recreate the hidden-runtime-dependency failure mode #267
exists to remove. The ~3 MB ceiling (~3-4% of binary) does not justify
that risk. The lazy-loading patterns above already eliminate the runtime
cost; the remaining cost is disk bytes only, because `bun build --compile`
bundles literal dynamic imports.

**Do not "clean up" the lazy-import patterns.** The dynamic `import()`
calls for pdf-parse / sharp / ink and the TTY gates in `src/core/cli.ts`
are intentional load-time optimizations, not stylistic quirks.

## Post-cleanup numbers (2026-06-10, after dep hygiene)

Binary sizes unchanged (71.0 / 107.9 / 107.4 MB) — expected: the only
bundle-relevant removal (react-devtools-core) is reinstalled by Bun as
ink's optional peer regardless of our manifest. The cleanup's value is an
honest manifest + the measurement tooling + this decision record.

For the SDK vendor-bundle dedup work (browser payload, not binary), see
#422 and the vendor-layout notes in `repo-architecture.md`.
