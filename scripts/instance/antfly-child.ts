/**
 * Rig-managed antfly child for isolated mode.
 *
 * The machine's real antfly is OS-supervised on 3738 (health 3739), and its
 * launchd unit is a byte-compared singleton — a rig home must NEVER reach the
 * adapter's provisioning path (see the guest-URL settings patch in modes.ts).
 * Instead the rig spawns its own engine on RIG_ANTFLY_PORT against the
 * instance's data dir, sharing the machine-wide binary + models READ-ONLY.
 *
 * Argv mirrors the adapter's buildServiceArgv token-for-token (pinned by
 * test) minus --preload-model: a dev instance accepts a first-embed cold
 * load rather than depending on which models are pulled.
 *
 * Spawned by `instance dev` (lives with the server, killed in finally) —
 * never by `up`. Boundary: dev-rig module, exempt via isDevRig.
 */
import { join } from 'node:path'

export function antflyRoot(env: Record<string, string | undefined>, homeDir: string): string {
  return env.ANTFLY_HOME || join(homeDir, '.antfly')
}

export function antflyBinary(env: Record<string, string | undefined>, homeDir: string): string {
  return env.ANTFLY_PATH || join(antflyRoot(env, homeDir), 'bin', 'antfly')
}

export function antflyModelsDir(env: Record<string, string | undefined>, homeDir: string): string {
  return join(antflyRoot(env, homeDir), 'inference', 'models')
}

export function antflyChildArgs(binary: string, port: number, dataDir: string, modelsDir: string): string[] {
  return [
    binary, 'swarm',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--health-port', String(port + 1),
    '--data-dir', dataDir,
    '--models-dir', modelsDir,
  ]
}

export interface AntflyChildDeps {
  spawn: (argv: string[]) => { kill: (signal: string) => void; exited: Promise<number> }
  fetchOk: (url: string) => Promise<boolean>
  mkdirp: (path: string) => Promise<void>
  exists: (path: string) => boolean
  sleep: (ms: number) => Promise<void>
  log: (message: string) => void
}

export interface AntflyChildSpec {
  binary: string
  port: number
  dataDir: string
  modelsDir: string
}

const READY_RETRIES = 30 // ~30s; engine opens tables before listening

export async function startAntflyChild(
  spec: AntflyChildSpec,
  deps: AntflyChildDeps,
): Promise<{ stop: () => Promise<void> }> {
  if (!deps.exists(spec.binary)) {
    throw new Error(
      `antfly binary not found at ${spec.binary} — run \`bakin install search\` (or set ANTFLY_PATH) for rig search`,
    )
  }
  await deps.mkdirp(spec.dataDir)
  deps.log(`starting rig antfly on 127.0.0.1:${spec.port} (data: ${spec.dataDir})…`)
  const child = deps.spawn(antflyChildArgs(spec.binary, spec.port, spec.dataDir, spec.modelsDir))

  for (let i = 0; i < READY_RETRIES; i++) {
    if (await deps.fetchOk(`http://127.0.0.1:${spec.port}/`)) {
      deps.log('rig antfly ready')
      return {
        stop: async () => {
          child.kill('SIGTERM')
          await child.exited
        },
      }
    }
    await deps.sleep(1000)
  }
  child.kill('SIGTERM')
  await child.exited
  throw new Error(`rig antfly did not become ready on port ${spec.port} — check ${spec.dataDir}.log`)
}
