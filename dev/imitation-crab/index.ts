/**
 * Imitation Crab — OpenClaw mock orchestrator for Bakin development.
 *
 * Usage:
 *   npx tsx dev/imitation-crab/index.ts              # Start mock only
 *   npx tsx dev/imitation-crab/index.ts --with-bakin  # Start mock + Bakin dev server
 *
 * Sets OPENCLAW_HOME to the configured mock home and OPENCLAW_PATH to the CLI
 * shim, then starts the mock HTTP gateway.
 */
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chmodSync, copyFileSync, mkdirSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'

import { checkSafety, printSafetyError } from './safety'
import { seed, getMockHome } from './seed'
import { startGateway } from './gateway'
import { getGatewayUrl } from './env'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')
const withBakin = process.argv.includes('--with-bakin')
const forceSeed = process.argv.includes('--force')

let bakinProcess: ChildProcess | null = null

function installCliShim(): string {
  const mockHome = getMockHome()
  const binDir = join(mockHome, 'bin')
  mkdirSync(binDir, { recursive: true })

  const shimSrc = join(__dirname, 'cli-shim.sh')
  const shimDest = join(binDir, 'openclaw')
  copyFileSync(shimSrc, shimDest)
  chmodSync(shimDest, 0o755)

  return shimDest
}

async function main(): Promise<void> {
  console.log('')
  console.log('🦀 Imitation Crab — OpenClaw Mock for Bakin')
  console.log('')

  // 1. Safety check
  const safety = await checkSafety()
  if (!safety.safe) {
    printSafetyError(safety.reasons)
    process.exit(1)
  }

  // 2. Seed filesystem
  seed(forceSeed)

  // 3. Install CLI shim
  const shimPath = installCliShim()
  const mockHome = getMockHome()

  // 4. Set environment for child processes
  const env = {
    ...process.env,
    BAKIN_HOME: mockHome,
    OPENCLAW_HOME: mockHome,
    OPENCLAW_PATH: shimPath,
    PATH: `${join(mockHome, 'bin')}:${process.env.PATH}`,
  }

  console.log('')
  console.log(`  BAKIN_HOME = ${mockHome}`)
  console.log(`  OPENCLAW_HOME = ${mockHome}`)
  console.log(`  OPENCLAW_PATH = ${shimPath}`)
  console.log('')

  // 5. Start mock gateway
  await startGateway()

  // 6. Optionally start Bakin
  if (withBakin) {
    console.log('')
    console.log('[bakin] Starting dev server...')
    bakinProcess = spawn('npx', ['tsx', 'server.ts'], {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'inherit',
    })

    bakinProcess.on('exit', (code) => {
      console.log(`[bakin] Dev server exited with code ${code}`)
      process.exit(code || 0)
    })
  } else {
    console.log('')
    console.log('Mock gateway is running. Start Bakin in another terminal with:')
    console.log('')
    console.log(`  BAKIN_HOME=${mockHome} OPENCLAW_HOME=${mockHome} OPENCLAW_PATH=${shimPath} OPENCLAW_BASE_URL=${getGatewayUrl()} npm run dev`)
    console.log('')
  }
}

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n[mock] Shutting down...')
  if (bakinProcess) bakinProcess.kill('SIGTERM')
  process.exit(0)
})

process.on('SIGTERM', () => {
  if (bakinProcess) bakinProcess.kill('SIGTERM')
  process.exit(0)
})

main().catch((err) => {
  console.error('[mock] Fatal error:', err)
  process.exit(1)
})
