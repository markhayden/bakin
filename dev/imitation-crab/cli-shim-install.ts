import { chmodSync, copyFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { getMockHome } from './env'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function installCliShim(mockHome = getMockHome()): string {
  const binDir = join(mockHome, 'bin')
  mkdirSync(binDir, { recursive: true })

  const shimSrc = join(__dirname, 'cli-shim.sh')
  const shimDest = join(binDir, 'openclaw')
  copyFileSync(shimSrc, shimDest)
  chmodSync(shimDest, 0o755)

  return shimDest
}
