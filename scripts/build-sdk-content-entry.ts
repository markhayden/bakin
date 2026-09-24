/**
 * Builds the packed `@makinbakin/sdk/content` entry.
 *
 * Rich content is a BROWSER entry: vfile swaps its Node-only process/URL
 * helpers through the `browser` field, so a Bun-targeted bundle breaks every
 * downstream plugin browser build (#916). But the browser target also picks
 * `decode-named-character-reference`'s DOM build, which runs
 * `document.createElement('i')` at import — so rc.36's published content
 * entry threw `ReferenceError: document is not defined` under plain Node/Bun
 * and failed the post-publish SDK smoke. The package's universal build (a
 * static table — what the bun/node conditions resolve) works everywhere, so
 * pin it while keeping the browser target for everything else.
 *
 * Bun's `bun build` CLI has no plugin hook, hence the JS API. This lives in
 * its own script and is spawned by scripts/build-sdk-package.ts so the build
 * never runs inside a test process (an in-process Bun.build inherits the test
 * preload's module mocks; CI shards saw EISDIR on real files).
 *
 *   bun run scripts/build-sdk-content-entry.ts --entry <wrapper.ts> --outfile <out.js> [--external <spec>]...
 */
import { basename, dirname } from 'node:path'

const UNIVERSAL_CHARACTER_REFERENCE_PACKAGE = 'decode-named-character-reference'

function parseArgs(argv: string[]): { entry: string; outfile: string; external: string[] } {
  let entry = ''
  let outfile = ''
  const external: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--entry' && next) { entry = next; i++ } else if (arg === '--outfile' && next) { outfile = next; i++ } else if (arg === '--external' && next) { external.push(next); i++ } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  if (!entry || !outfile) throw new Error('Usage: --entry <file> --outfile <file> [--external <spec>]...')
  return { entry, outfile, external }
}

export async function buildContentEntry(opts: { entry: string; outfile: string; external: string[] }): Promise<void> {
  const result = await Bun.build({
    entrypoints: [opts.entry],
    outdir: dirname(opts.outfile),
    naming: basename(opts.outfile),
    target: 'browser',
    format: 'esm',
    // Same minify posture as the CLI entries: syntax + whitespace only, never
    // identifier mangling (Bun 1.3's mangler once collided two helpers on Linux).
    minify: { syntax: true, whitespace: true, identifiers: false },
    define: { 'process.env.NODE_ENV': '"production"' },
    external: opts.external,
    plugins: [{
      name: 'pin-universal-decode-named-character-reference',
      setup(build) {
        build.onResolve({ filter: /^decode-named-character-reference$/ }, (args) => {
          // Runtime resolution (bun/node/default conditions) yields index.js,
          // the DOM-free build; the `browser` condition the bundler would
          // apply yields index.dom.js. Resolve from the importer: the package
          // is nested under micromark, not hoisted to the repo root.
          const path = Bun.resolveSync(UNIVERSAL_CHARACTER_REFERENCE_PACKAGE, dirname(args.importer))
          if (path.endsWith('index.dom.js')) {
            throw new Error(`${UNIVERSAL_CHARACTER_REFERENCE_PACKAGE} resolved to its DOM build (${path}); the content entry must stay importable without a DOM`)
          }
          return { path }
        })
      },
    }],
  })
  if (!result.success) {
    throw new Error(`content entry build failed:\n${result.logs.map((log) => String(log)).join('\n')}`)
  }
}

if (import.meta.main) {
  buildContentEntry(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
