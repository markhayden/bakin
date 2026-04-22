/**
 * Build vendor bundles for the browser import map.
 *
 * Produces standalone ESM bundles that the shell + every plugin resolves to
 * at runtime via the import map emitted in packages/host/public/index.html
 * (TD3). One copy of each externalized module lives under
 * `packages/host/public/vendor/` and is served by the static file handler.
 *
 * The paths here match exactly the `imports` map keys in index.html — any
 * change to the naming here requires an index.html update.
 *
 * Phase G embeds these in the binary via `Bun.embeddedFiles`. For dev + this
 * phase we write to disk.
 */
import { rmSync, mkdirSync } from 'node:fs'

const VENDOR_DIR = './packages/host/public/vendor'

rmSync(VENDOR_DIR, { recursive: true, force: true })
mkdirSync(VENDOR_DIR, { recursive: true })

interface VendorTarget {
  /** Module specifier the import map will redirect (e.g. 'react'). */
  specifier: string
  /** Output filename under vendor/ (without the .mjs). */
  name: string
  /** Path to an entry module to build. Must be a file path or bare specifier
   *  that Bun.build can resolve from the repo root. */
  entrypoint: string
}

// Resolve bare specifiers to absolute paths via Bun.resolveSync so the
// subprocess below doesn't need to figure out subpath exports or deal
// with tsconfig path-mapping. (Bun 1.3 had an intermittent "FileNotFound
// opening root directory" failure when passing bare specifiers like
// `react-dom/client` as entrypoints to `bun build` from a subpath of the
// workspace — resolving to absolute paths up-front avoids it.)
const targets: VendorTarget[] = [
  { specifier: 'react', name: 'react', entrypoint: Bun.resolveSync('react', process.cwd()) },
  { specifier: 'react-dom', name: 'react-dom', entrypoint: Bun.resolveSync('react-dom', process.cwd()) },
  { specifier: 'react-dom/client', name: 'react-dom-client', entrypoint: Bun.resolveSync('react-dom/client', process.cwd()) },
  { specifier: 'react/jsx-runtime', name: 'jsx-runtime', entrypoint: Bun.resolveSync('react/jsx-runtime', process.cwd()) },
  { specifier: 'react/jsx-dev-runtime', name: 'jsx-dev-runtime', entrypoint: Bun.resolveSync('react/jsx-dev-runtime', process.cwd()) },
  { specifier: '@bakin/sdk', name: 'sdk-index', entrypoint: './packages/sdk/src/index.ts' },
  { specifier: '@bakin/sdk/ui', name: 'sdk-ui', entrypoint: './packages/sdk/src/ui/index.ts' },
  { specifier: '@bakin/sdk/hooks', name: 'sdk-hooks', entrypoint: './packages/sdk/src/hooks/index.ts' },
  { specifier: '@bakin/sdk/components', name: 'sdk-components', entrypoint: './packages/sdk/src/components/index.ts' },
  { specifier: '@bakin/sdk/slots', name: 'sdk-slots', entrypoint: './packages/sdk/src/slots/index.tsx' },
  { specifier: '@bakin/sdk/types', name: 'sdk-types', entrypoint: './packages/sdk/src/types/index.ts' },
  { specifier: '@bakin/sdk/utils', name: 'sdk-utils', entrypoint: './packages/sdk/src/utils/index.ts' },
]

// Use subprocess per target — Bun.build() in-process state has trouble
// with N serial invocations under certain module-resolution patterns
// (see notes in README). Subprocess isolation avoids it entirely.
for (const t of targets) {
  console.log(`  building ${t.specifier} → ${t.name}.js`)
  const externalArgs = t.specifier.startsWith('@bakin/sdk')
    ? ['--external', 'react', '--external', 'react-dom', '--external', 'react-dom/client', '--external', 'react/jsx-runtime', '--external', 'react/jsx-dev-runtime']
    : []

  const proc = Bun.spawn([
    'bun', 'build',
    t.entrypoint,
    '--outdir', VENDOR_DIR,
    '--target', 'browser',
    '--format', 'esm',
    '--entry-naming', `${t.name}.[ext]`,
    ...externalArgs,
  ], { stdout: 'pipe', stderr: 'pipe' })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const err = await new Response(proc.stderr).text()
    console.error(`Failed to build vendor bundle for ${t.specifier}:`)
    console.error(err)
    process.exit(1)
  }
}

console.log(`packages/host/public/vendor: ${targets.length} bundles built`)

export {}
