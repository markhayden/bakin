/**
 * Tests for the update flow (Phase E-7).
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-updater-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []
mock.module('@bakin/core/openclaw-config', () => ({
  readOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => openClawAgents,
  getAgentIds: () => openClawAgents.map((a) => a.id),
  findAgentById: (id: string) => openClawAgents.find((a) => a.id === id) ?? null,
}))

import { installPackage } from '../../src/core/agent-packages/installer'
import { updatePackageById } from '../../src/core/agent-packages/updater'
import { readLockfile } from '../../packages/core/src/agent-packages/lockfile'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  openClawAgents = []
})

function seedAgentPackage(opts: { id?: string; version?: string; soulBody?: string } = {}): string {
  const id = opts.id ?? 'pixel'
  const version = opts.version ?? '0.1.0'
  const dir = join(testDir, `${id}-pkg-${version}`)
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'knowledge'), { recursive: true })

  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id,
      kind: 'agent',
      name: id,
      version,
      agent: { identity: { name: id } },
      install: { writeWorkspaceFiles: true, enableKnowledge: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        knowledge: ['knowledge/style.md'],
      },
    }),
  )
  const soul = opts.soulBody ?? `# Soul ${id}\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`
  writeFileSync(join(dir, 'workspace', 'SOUL.md'), soul)
  writeFileSync(
    join(dir, 'knowledge', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nv${version} body.`,
  )
  return dir
}

describe('updatePackageById — happy paths', () => {
  it('returns changed=true and bumps the version when source content changes', async () => {
    const v1Src = seedAgentPackage({ version: '0.1.0' })
    await installPackage({ source: v1Src })

    const lockBefore = readLockfile()
    expect(lockBefore.packages.pixel.version).toBe('0.1.0')

    // Simulate an upstream version bump by writing a new manifest at the
    // SAME source path (local sources have empty commitSha — updater
    // re-projects unconditionally for those).
    const v2Manifest = JSON.parse(readFileSync(join(v1Src, 'bakin-package.json'), 'utf-8'))
    v2Manifest.version = '0.2.0'
    writeFileSync(join(v1Src, 'bakin-package.json'), JSON.stringify(v2Manifest))
    writeFileSync(
      join(v1Src, 'knowledge', 'style.md'),
      `---\ntitle: Style\ndefaultEnabled: true\n---\n\nv0.2.0 body.`,
    )

    const result = await updatePackageById({ packageId: 'pixel' })
    expect(result.changed).toBe(true)
    expect(result.toVersion).toBe('0.2.0')

    const lockAfter = readLockfile()
    expect(lockAfter.packages.pixel.version).toBe('0.2.0')

    // Knowledge content updated
    const soul = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'SOUL.md'), 'utf-8')
    expect(soul).toContain('v0.2.0 body.')
    expect(soul).not.toContain('v0.1.0 body.')
  })

  it('preserves the original installedAt timestamp on update', async () => {
    const v1Src = seedAgentPackage({ version: '0.1.0' })
    await installPackage({ source: v1Src })
    const installedAt = readLockfile().packages.pixel.installedAt

    await new Promise((r) => setTimeout(r, 5))
    await updatePackageById({ packageId: 'pixel' })

    expect(readLockfile().packages.pixel.installedAt).toBe(installedAt)
  })

  it('with refreshTemplate=true, rewrites workspace files from source', async () => {
    const v1Src = seedAgentPackage({ version: '0.1.0' })
    await installPackage({ source: v1Src })

    // Simulate the agent editing its own SOUL.md
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    writeFileSync(soulPath, '# agent rewrote everything\n')

    // Source bumps version with a new SOUL template
    const newManifest = JSON.parse(readFileSync(join(v1Src, 'bakin-package.json'), 'utf-8'))
    newManifest.version = '0.2.0'
    writeFileSync(join(v1Src, 'bakin-package.json'), JSON.stringify(newManifest))
    writeFileSync(
      join(v1Src, 'workspace', 'SOUL.md'),
      `# Refreshed template\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
    )

    await updatePackageById({ packageId: 'pixel', refreshTemplate: true })

    // Soul rewritten from new template
    const after = readFileSync(soulPath, 'utf-8')
    expect(after).toContain('# Refreshed template')
    expect(after).not.toContain('agent rewrote everything')
  })
})

describe('updatePackageById — refuse paths', () => {
  it('throws on unknown package id', async () => {
    expect(async () => {
      await updatePackageById({ packageId: 'never-installed' })
    }).toThrow(/not installed/)
  })

  it('throws when the updated manifest id has changed', async () => {
    const src = seedAgentPackage({ id: 'pixel' })
    await installPackage({ source: src })

    // Mutate the manifest to a different id
    const m = JSON.parse(readFileSync(join(src, 'bakin-package.json'), 'utf-8'))
    m.id = 'pixel-renamed'
    writeFileSync(join(src, 'bakin-package.json'), JSON.stringify(m))

    expect(async () => {
      await updatePackageById({ packageId: 'pixel' })
    }).toThrow(/does not match installed id/)
  })
})
