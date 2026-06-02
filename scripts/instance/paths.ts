/**
 * Filesystem layout for the disposable OpenClaw dev/onboarding rig.
 *
 * Pure: derives every path from the repo root + mode. All instance state lives
 * under the gitignored `dev/` tree so `reset` can never reach `~/.bakin` or
 * `~/.openclaw`. No I/O here — callers do the wiping.
 */
import { join } from 'node:path'

import type { Mode } from './args'

export interface InstancePaths {
  /** Shared OpenClaw home (bind-mounted into the container). */
  openclawHome: string
  /** Host BAKIN_HOME for this mode, or null when Bakin uses its real home / runs in-container. */
  bakinHome: string | null
  composeFile: string
  shim: string
  /** Committed op:// reference template. */
  secretsTemplate: string
  /** Directories `reset` is allowed to delete — always inside dev/. */
  resetTargets: string[]
}

export function instancePaths(repoRoot: string, mode: Mode): InstancePaths {
  const dev = join(repoRoot, 'dev')
  const dockerDir = join(dev, 'docker')
  const openclawHome = join(dev, 'openclaw-home')
  const isolatedBakinHome = join(dev, 'bakin-instances', 'isolated', 'home')

  // native → real ~/.bakin; sandbox → Bakin lives in the container; isolated → throwaway host home.
  const bakinHome = mode === 'isolated' ? isolatedBakinHome : null

  const resetTargets = [openclawHome]
  if (mode === 'isolated') resetTargets.push(isolatedBakinHome)

  return {
    openclawHome,
    bakinHome,
    composeFile: join(dockerDir, 'docker-compose.yml'),
    shim: join(dockerDir, 'openclaw-shim.sh'),
    secretsTemplate: join(dockerDir, 'secrets.op.env'),
    resetTargets,
  }
}
