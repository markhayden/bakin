# Vendored packages

## antfly-sdk-0.2.0-rc.2.tgz

**Temporary vendor** of the new-protocol `@antfly/sdk` (targets `/db/v1` + `/ai/v1`),
pending upstream publishing it to npm — tracked ask: publish under the `next`
dist-tag, same as `@antfly/cli@0.2.0-rc.2`.

- **Provenance:** built from `antflydb/antfly` tag `v0.2.0-rc.2`
  (commit `1d9e8c040`), package `ts/packages/sdk`, via `npm install && npm run build && npm pack`.
- **Internal version says `0.0.14`** — upstream had not bumped the SDK
  `package.json` version at that tag. The filename carries the real protocol
  version; the artifact is byte-for-byte what upstream would publish from the tag.
- **SHA256:** `dd4d69c5e0e6330f8901dc64d152731138e92f5e7de3cd15b52e2be5dce2a3bf`
- **Swap-out:** when the published SDK lands, replace the `file:` dep in the
  root `package.json` with the registry version and delete this tarball + entry.
- Note: `openapi-fetch` is bundled inline by upstream's tsup config (their fix
  for the CJS/ESM interop crash Bakin previously carried as
  `patches/@antfly__sdk@0.0.14.patch`).

Spec: `.claude/specs/antfly-zig-migration.md` (decision 3).
