/**
 * Guard release/static browser assets from accidentally shipping dev output.
 */
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { walkFiles as walkFileTree } from '../packages/core/src/storage/walk'

const REPO_ROOT = resolve(import.meta.dir, '..')

export interface ProductionAssetAssertionOptions {
  rootDir: string
}

const DEVELOPMENT_ONLY_UI_TOOLING = [
  '@storybook/',
  'storybook/internal/',
  '__STORYBOOK_',
  'from "vite"',
  "from 'vite'",
  '/node_modules/vite/',
  '/@vite/',
] as const

// Dirent-based (symlinks not followed) — fine here: these are build-output
// trees (dist/vendor) that contain no symlinks.
function walkFiles(dir: string): string[] {
  return Array.from(walkFileTree(dir), (file) => file.path)
}

export function assertProductionAssets(opts: ProductionAssetAssertionOptions): void {
  const rootDir = resolve(opts.rootDir)
  const hostDist = join(rootDir, 'packages/host/dist')
  const vendorDir = join(rootDir, 'packages/host/public/vendor')
  const pluginsDir = join(rootDir, 'plugins')

  const scannedJs = [
    ...walkFiles(hostDist).filter((file) => file.endsWith('.js')),
    ...walkFiles(vendorDir).filter((file) => file.endsWith('.js')),
    ...walkFiles(pluginsDir).filter((file) => file.endsWith('/dist/client.js')),
  ]
  const sourceMaps = walkFiles(hostDist).filter((file) => file.endsWith('.map'))
  const browserSources = scannedJs.map((file) => ({ file, source: readFileSync(file, 'utf-8') }))
  const devRuntimeImports = browserSources
    .filter(({ source }) => source.includes('react/jsx-dev-runtime'))
    .map(({ file }) => file)

  const failures: string[] = []
  for (const file of sourceMaps) {
    failures.push(`${relative(rootDir, file)} should not be emitted by production host builds`)
  }
  for (const file of devRuntimeImports) {
    failures.push(`${relative(rootDir, file)} imports react/jsx-dev-runtime`)
  }
  for (const { file, source } of browserSources) {
    for (const dependency of DEVELOPMENT_ONLY_UI_TOOLING) {
      if (source.includes(dependency)) {
        failures.push(
          `${relative(rootDir, file)} contains development-only UI workbench dependency ${dependency}`,
        )
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Production asset assertion failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  }
}

async function main(): Promise<void> {
  assertProductionAssets({ rootDir: REPO_ROOT })
  console.log('Production asset assertions passed')
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
