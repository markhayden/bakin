/**
 * Seed the H'enrich utility agent from the local bakin-bits-official checkout
 * (#586 — curated catalog, default-selected on onboarding).
 *
 * Replicates what `bakin agents install github:…#agents/enrich` produces:
 * roster entry in openclaw.json, workspace files, persona (seed-once),
 * avatar, the installed-package tree, and a lockfile entry. Skips with a
 * warning when the bits repo isn't checked out next to this one — same
 * graceful degradation as the plugin symlink step.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readLockfile, writeLockfile } from '../../packages/core/src/agent-packages/lockfile'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..', '..')

export function seedEnrichAgent(mockHome: string): void {
  const bitsDir = process.env.BAKIN_BITS_DIR || join(PROJECT_ROOT, '..', 'bakin-bits-official')
  const pkgSrc = join(bitsDir, 'agents', 'enrich')
  if (!existsSync(join(pkgSrc, 'bakin-package.json'))) {
    console.warn(`[seed] bakin-bits-official enrich package not found at ${pkgSrc} — skipping H'enrich`)
    return
  }

  const manifest = JSON.parse(readFileSync(join(pkgSrc, 'bakin-package.json'), 'utf-8')) as {
    id: string
    version: string
    agent: { identity: { name: string; emoji?: string }; defaultModel?: string }
  }
  const agentId = manifest.id
  const version = manifest.version

  // 1. Roster entry — mirrors the installer's runtime-agent creation.
  const configPath = join(mockHome, 'openclaw.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    agents?: { list?: Array<{ id: string }> }
  }
  config.agents ??= {}
  config.agents.list ??= []
  if (!config.agents.list.some((a) => a.id === agentId)) {
    config.agents.list.push({
      id: agentId,
      identity: manifest.agent.identity,
      ...(manifest.agent.defaultModel ? { model: { primary: manifest.agent.defaultModel } } : {}),
    } as { id: string })
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  }

  // 2. Workspace files → workspaces/<id>/ (subagent layout).
  const workspaceSrc = join(pkgSrc, 'workspace')
  if (existsSync(workspaceSrc)) {
    cpSync(workspaceSrc, join(mockHome, 'workspaces', agentId), { recursive: true })
  }

  // 3. Persona (seed-once) + avatar.
  const persona = join(pkgSrc, 'persona.md')
  if (existsSync(persona)) {
    const dest = join(mockHome, 'team', 'personas', `${agentId}.md`)
    mkdirSync(dirname(dest), { recursive: true })
    if (!existsSync(dest)) cpSync(persona, dest)
  }
  const avatar = join(pkgSrc, 'assets', 'avatar.webp')
  if (existsSync(avatar)) {
    const destDir = join(mockHome, 'agents', agentId)
    mkdirSync(destDir, { recursive: true })
    cpSync(avatar, join(destDir, 'avatar.webp'))
  }

  // 4. Installed-package tree + lockfile entry.
  const installDir = join(mockHome, 'packages', 'agents', `${agentId}@${version}`)
  cpSync(pkgSrc, installDir, { recursive: true })
  const lockPath = join(mockHome, 'packages', 'lock.json')
  const lock = readLockfile(lockPath)
  lock.packages[agentId] = {
    kind: 'agent',
    version,
    source: pkgSrc,
    ref: '',
    commitSha: '',
    installedAt: new Date().toISOString(),
    state: 'managed',
    agentId,
    lessonsEnabled: [],
    projections: [],
  }
  writeLockfile(lock, lockPath)

  console.log(`[seed] H'enrich agent seeded (${agentId}@${version} from bits checkout)`)
}
