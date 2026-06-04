/**
 * Guard release/static browser assets from accidentally shipping dev output.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')

export interface ProductionAssetAssertionOptions {
  rootDir: string
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      out.push(...walkFiles(path))
    } else if (stat.isFile()) {
      out.push(path)
    }
  }
  return out
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
