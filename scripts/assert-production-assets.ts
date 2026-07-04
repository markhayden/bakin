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
  const devRuntimeImports = scannedJs.filter((file) => readFileSync(file, 'utf-8').includes('react/jsx-dev-runtime'))

  const failures: string[] = []
  for (const file of sourceMaps) {
    failures.push(`${relative(rootDir, file)} should not be emitted by production host builds`)
  }
  for (const file of devRuntimeImports) {
    failures.push(`${relative(rootDir, file)} imports react/jsx-dev-runtime`)
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
