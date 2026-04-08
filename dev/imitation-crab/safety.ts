/**
 * Safety gate — prevents the mock from running on machines with real OpenClaw.
 * Checks three independent signals. If ANY pass, the mock refuses to start.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface SafetyResult {
  safe: boolean
  reasons: string[]
}

export async function checkSafety(): Promise<SafetyResult> {
  if (process.env.OPENCLAW_MOCK_FORCE === '1') {
    console.log('[safety] OPENCLAW_MOCK_FORCE=1 — skipping safety checks')
    return { safe: true, reasons: [] }
  }

  const reasons: string[] = []

  // 1. Check for binary
  const binaryPath = process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw'
  if (existsSync(binaryPath)) {
    reasons.push(`Found binary: ${binaryPath}`)
  }

  // 2. Check for real config (not our mock)
  const realConfigPath = join(homedir(), '.openclaw', 'openclaw.json')
  if (existsSync(realConfigPath)) {
    reasons.push(`Found config: ${realConfigPath}`)
  }

  // 3. Check for running gateway
  try {
    const res = await fetch('http://127.0.0.1:18789/health', {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      reasons.push('Gateway responding on :18789')
    }
  } catch {
    // Not running — good
  }

  return { safe: reasons.length === 0, reasons }
}

export function printSafetyError(reasons: string[]): void {
  console.error('')
  console.error('╔══════════════════════════════════════════════════════════════╗')
  console.error('║  SAFETY: Real OpenClaw detected — mock will NOT start.     ║')
  console.error('╚══════════════════════════════════════════════════════════════╝')
  console.error('')
  for (const reason of reasons) {
    console.error(`  ✗ ${reason}`)
  }
  console.error('')
  console.error('The mock is only for machines WITHOUT OpenClaw installed.')
  console.error('To override: OPENCLAW_MOCK_FORCE=1 npm run dev:mock')
  console.error('')
}
