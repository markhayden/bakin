# Media Pipeline (sharp) & the Zero-Install Store

Issue #889 · spec `.claude/specs/media-zero-install-889.md` · shipped 2026-09.

## The problem this solves

`bun build --compile` cannot carry sharp's native prebuilds
(`@img/sharp-<platform>` + `@img/sharp-libvips-<platform>`), so compiled-binary
installs used to run silently without image processing: >2 MB enrichment
failed unrecoverably ("retry re-runs the vision call" on a call that could
never succeed), asset exports threw, thumbnails degraded to ffmpeg-or-nothing,
and the `assets_visual` search leg lost its thumbs-first `media_url`. Same
only-breaks-in-the-binary class as #886 (pi OAuth) and #837 (playwright).

## The ONE loader

`packages/core/src/media/sharp-loader.ts` — every consumer goes through
`loadSharp()`. Two legs, in order:

1. **Bundled** `import('sharp')` — dev trees / npm installs. In the compiled
   binary this fails FAST by design: `sharp` is a compile external
   (`EXTERNAL_NATIVE_MEDIA` in `scripts/build-binary.ts`, #837 posture).
2. **Media store** — a self-contained bundle at
   `~/.bakin/media/sharp/<version>/dist/index.js`, imported from disk.

Success caches forever. A cached FAILURE re-probes when a store receipt
appears (`bakin install media` ran in another process), and
`installMediaStore()` calls `resetSharpModuleCache()` after an in-process
install (doctor repair) — **fixes go live without a server restart**.

The raw imports live in `sharp-import.ts` so tests can mock availability
per-case (a `mock.module('sharp', …)` factory evaluates eagerly and the repo's
devDependency sharp would otherwise satisfy the bundled leg in every test).

Consumers (all degrade through the loader, never import sharp directly):
- `packages/core/src/media/downscale.ts` — pre-send downscale for enrichment
  AND chat attachments; throws with remediation when sharp is missing.
- `plugins/assets/lib/asset-media.ts` — thumbnails (ffmpeg fallback), dimensions.
- `plugins/assets/lib/asset-mutations.ts` — image exports; throws with remediation.
- `plugins/images/lib/tools.ts` — generated-image dimension probing.

## Why the store works in a compiled binary (spike-proven, 2026-09-20)

Compiled bun binaries CAN import plain JS files from absolute disk paths and
CAN `require()`/dlopen a `.node` by path (rpath dylib resolution included).
They CANNOT resolve bare specifiers (`require('detect-libc')`) against a disk
node_modules. Therefore the install:

1. Downloads the pinned npm tarballs (immutable registry URLs, sha256 each):
   4 platform-neutral (`sharp`, `@img/colour`, `detect-libc`, `semver`) + 2
   per platform (`@img/sharp-<p>`, `@img/sharp-libvips-<p>`), ~8 MB.
2. Extracts them into a staging `node_modules` layout.
3. **Bundles sharp's JS into ONE self-contained file** with in-binary
   `Bun.build` (target `bun`, cjs; externals only for the never-installed
   optional ids `@img/sharp-libvips-dev*` / `@img/sharp-wasm32*`).
4. Places the natives where sharp's own FIRST require candidate finds them —
   `../src/build/Release/sharp-<p>.node` relative to the bundle — and the
   libvips lib dir where the `.node`'s rpath (`@loader_path/../../
   sharp-libvips-<p>/lib`, darwin) / RUNPATH (`$ORIGIN`-symmetric, linux)
   expects it.
5. **Probe-verifies**: imports the staged bundle and runs a REAL
   decode→resize→JPEG-encode round trip. This is the tripwire for sharp
   changing its candidate paths on a future bump — a broken layout never
   commits.
6. Atomically renames staging → `~/.bakin/media/sharp/<version>/` with a
   `receipt.json` (the loader's trigger), prunes build inputs, sweeps older
   version dirs.

Store layout:
```
~/.bakin/media/sharp/<version>/
  receipt.json                          — schema, sharpVersion, platform, entry, tarballs
  dist/index.js                         — bundled sharp (all JS deps inlined)
  src/build/Release/sharp-<plat>.node   — native, via sharp's relative candidate
  src/sharp-libvips-<plat>/lib/…        — libvips, via the native's rpath/RUNPATH
```

Key modules: `packages/core/src/media/{pin,pin-data,store,installer,sharp-import,sharp-loader}.ts`.
The download/extract/verify/commit legs ride the shared primitive
`packages/core/src/net/download.ts` (also under `bin-installer` and
`requirements-installer`; the antfly installer refit is ticketed separately).

## Surfaces

- **Onboarding component `media`** (#15 in `COMPONENT_ORDER`, after
  `search-models`): ok/noop on dev trees, installs the store on binaries,
  warn/skip on unsupported platforms. `ONBOARDING_VERSION` bumped 3→4.
- **CLI:** `bakin check media`, `bakin install media`.
- **Doctor:** `media.sharp` (health plugin, System group). Missing store on a
  binary = **unclassified** incident (never demoted by sensitivity — visible
  in quiet mode), `action_required`, one-click repair `media-install-store`
  (runs the installer in-process; no restart needed). Unsupported platform =
  advisory `unsupported_surface` warning.
- **Runtime hub one-click:** `media` is in the `FIXABLE` whitelist
  (`POST /api/runtime/onboarding/install`).
- **Errors:** both sharp-missing throws name `bakin install media` / the
  Health repair.

## Platform matrix

`darwin-arm64`, `linux-x64` (glibc), `linux-arm64` (glibc) — exactly the
binary release targets in `scripts/build-binary.ts`. musl and everything else
report honestly as unsupported (component warn + advisory incident).

## Pin-bump runbook (sharp version upgrade)

1. `bun scripts/generate-media-pin.ts --sharp-version <new>` — resolves dep
   versions from sharp's OWN registry manifest (NEVER the repo's hoisted
   copies; the spike shipped a wrong semver exactly that way), downloads all
   10 tarballs, computes sha256s, rewrites `pin-data.ts`.
2. Bump the `sharp` devDependency to match (dev-tree leg parity).
3. `bun test tests/integration/media/compiled-sharp-store.test.ts --isolate`
   — the compile-and-run regression runs the REAL install path; a changed
   native-candidate layout fails HERE, not on a user's box. Run on darwin
   AND confirm the linux leg in CI before merging.
4. Existing installs self-heal: the receipt's `sharpVersion` no longer
   matches the new pin → doctor flags missing → repair reinstalls; older
   version dirs are swept post-commit.
5. `--check` mode reports drift between `pin-data.ts` and a fresh
   regeneration (manual/network — never wired into tests).

## Tests that guard this

- `tests/integration/media/compiled-sharp-store.test.ts` — #886-pattern
  compile-and-run: REAL installer (in-binary Bun.build + probe) staged from
  the repo's own node_modules (no network), REAL loader, real resize, inside
  a compiled binary; on linux CI it pins the RUNPATH placement. Plus the
  **TEETH** test: the bare sharp import in a compiled binary must KEEP
  failing — if it ever passes, bun learned to embed natives and this whole
  machinery should be deleted. Plus a source pin on the compile externals.
- `tests/core/media/installer.test.ts` — staging/layout/receipt/commit over
  loopback fake tarballs (bundle/probe seams injected). NOTE: mocks the
  `pin` MODULE, not `pin-data` — pin.ts const-captures the data at eval
  time, so a pin-data mock silently no-ops and the test downloads REAL
  tarballs (learned the hard way).
- `tests/core/media/sharp-loader.test.ts` — leg order, failure re-probe,
  cache reset.
- `tests/core/net/download.test.ts` — the shared primitive.
- `tests/core/onboarding/media.test.ts`, `tests/plugins/health/media-check.test.ts`.

## Sharp edges

- `getBakinPaths()` mocks in tests SHOULD include the `media` key (same class
  as the `db`-key rule); the store helpers tolerate a missing key only via
  join(undefined) crashes — include it.
- The store prunes its staging `node_modules` after bundling: the committed
  store is bundle + natives + receipt (~13 MB), not the full 16 MB layout.
- Install is idempotent (receipt at pin = skip) and race-tolerant for a
  single-user box (staging dirs are pid-suffixed; last rename wins).
- No lazy self-heal by DESIGN: request paths never download (interview
  decision, 2026-09-20). The gap is covered by onboarding (fresh installs)
  + doctor repair (existing installs).
