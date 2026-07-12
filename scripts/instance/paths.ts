/**
 * Filesystem layout for the disposable dev/onboarding rig.
 *
 * Pure: derives every path from the repo root + mode. All instance state lives
 * under the gitignored `dev/` tree so `reset` can never reach `~/.bakin`,
 * `~/.openclaw`, or `~/.pi`. No I/O here — callers do the wiping.
 */
import { join } from 'node:path'

import type { Mode } from './args'

export interface InstancePaths {
  repoRoot: string
  /** Shared OpenClaw home (bind-mounted into the container). */
  openclawHome: string
  /**
   * Pi home for this mode. Host modes share one (host path strings inside
   * registry/sessions); sandbox gets its own — its state records container
   * paths (/home/node/.pi/…) a host-mode boot must never read.
   */
  piHome: string
  /**
   * Rig-managed antfly child data (isolated mode) — INSIDE the throwaway home
   * at the adapter-conventional `{BAKIN_HOME}/antfly`, so a home's blue/green
   * table state and its engine data live and die together (boot makes zero
   * engine calls when state matches; a home reattaching to an empty engine
   * would query missing tables forever — found live in the T10 E2E).
   */
  antflyDataDir: string
  /** Host BAKIN_HOME for this mode, or null when Bakin uses its real home / runs in-container. */
  bakinHome: string | null
  composeFile: string
  shim: string
  /** Committed op:// reference template. */
  secretsTemplate: string
  /** Directories `reset` is allowed to delete — always inside dev/. Runtime-blind. */
  resetTargets: string[]
}

export function instancePaths(repoRoot: string, mode: Mode): InstancePaths {
  const dev = join(repoRoot, 'dev')
  const dockerDir = join(dev, 'docker')
  const openclawHome = join(dev, 'openclaw-home')
  const piHome = mode === 'sandbox' ? join(dev, 'pi-home-sandbox') : join(dev, 'pi-home')
  const isolatedBakinHome = join(dev, 'bakin-instances', 'isolated', 'home')
  const antflyDataDir = join(isolatedBakinHome, 'antfly')

  // native → real ~/.bakin; sandbox → Bakin lives in the container; isolated → throwaway host home.
  const bakinHome = mode === 'isolated' ? isolatedBakinHome : null

  const resetTargets = [openclawHome, piHome]
  // antflyDataDir lives inside the home — the home wipe covers it.
  if (mode === 'isolated') resetTargets.push(isolatedBakinHome)

  return {
    repoRoot,
    openclawHome,
    piHome,
    antflyDataDir,
    bakinHome,
    composeFile: join(dockerDir, 'docker-compose.yml'),
    shim: join(dockerDir, 'openclaw-shim.sh'),
    secretsTemplate: join(dockerDir, 'secrets.op.env'),
    resetTargets,
  }
}
