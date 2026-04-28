/**
 * Smoke test for `bakin check agent-assets` and `bakin install agent-assets`
 * (Phase F-3).
 *
 * Pattern lifted from tests/cli/install-plugin-assets.test.ts — exercises
 * the underlying onboarding component (which the CLI dispatcher resolves
 * to) rather than booting the full CLI process.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-cli-agent-assets-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { installFilesystemRuntimeAppServices } from '../helpers/runtime-app-services'

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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []
mock.module('@bakin/adapter-openclaw/config', () => ({
  readOpenClawConfig: () => ({ agents: { list: openClawAgents } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => openClawAgents,
  getAgentIds: () => openClawAgents.map((a) => a.id),
  findAgentById: (id: string) => openClawAgents.find((a) => a.id === id) ?? null,
}))

import { agentAssetsComponent } from '../../src/core/onboarding/agent-assets'
import { installPackage } from '../../src/core/agent-packages/installer'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  openClawAgents = []
  installFilesystemRuntimeAppServices({
    openClawDir,
    agents: () => openClawAgents,
    onCreateAgent: (agent) => {
      openClawAgents = [...openClawAgents.filter((existing) => existing.id !== agent.id), { id: agent.id, identity: { name: agent.name } }]
    },
  })
})

const NON_INTERACTIVE = {
  interactive: false,
  autoApprove: true,
  json: false,
  checkOnly: false,
  force: false,
}

function seedAgentPackage(): string {
  const dir = join(testDir, 'pixel-pkg')
  mkdirSync(join(dir, 'workspace'), { recursive: true })
  mkdirSync(join(dir, 'knowledge'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: 'pixel',
      kind: 'agent',
      name: 'Pixel',
      version: '0.1.0',
      agent: { identity: { name: 'Pixel' } },
      install: { writeWorkspaceFiles: true, enableKnowledge: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        knowledge: ['knowledge/style.md'],
        assets: ['assets/avatar.jpg'],
      },
    }),
  )
  writeFileSync(
    join(dir, 'workspace', 'SOUL.md'),
    `# Soul Pixel\n\n<!-- bakin:knowledge-catalog:start -->\n<!-- bakin:knowledge-catalog:end -->\n`,
  )
  writeFileSync(
    join(dir, 'knowledge', 'style.md'),
    `---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle body.`,
  )
  writeFileSync(join(dir, 'assets', 'avatar.jpg'), 'jpg-bytes')
  return dir
}

describe('agent-assets onboarding component — check()', () => {
  it('returns ok with 0 projections when no packages installed', async () => {
    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('0 agent-package projections')
  })

  it('returns ok when all projections match the lockfile', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toMatch(/All \d+ agent-package projection/)
  })

  it('returns warn when a projection target is missing', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // Runtime workspace projections are checked by the runtime adapter.
    // Simulate a missing filesystem-owned projection instead.
    rmSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'))

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('missing')
    expect(result.remediation).toContain('bakin install agent-assets')
  })

  it('returns warn when a non-template projection has drifted (sha mismatch)', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // Workspace files are templateOnly — exempt from sha checks. Use an
    // asset (avatar) instead, since assets are NOT agent-mutable.
    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    writeFileSync(avatar, 'someone-else-overwrote-this')

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('drifted')
  })

  it('does NOT flag agent-edited workspace files as drift (templateOnly exemption)', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // Simulate the agent expanding SOUL.md (preserving the bakin: markers
    // so the knowledge-marker projections still resolve). Pure file-sha
    // drift on a templateOnly projection should NOT trigger warn.
    const soulPath = join(openClawDir, 'workspaces', 'pixel', 'SOUL.md')
    const { readFileSync } = await import('fs')
    const existing = readFileSync(soulPath, 'utf-8')
    writeFileSync(soulPath, existing + '\n\n## Agent-added section\n\nNew prose.\n')

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('ok')
  })

  it('reports user-edited files separately from drift', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const avatar = join(testDir, 'agents', 'pixel', 'avatar.jpg')
    writeFileSync(avatar, 'user-overrode-avatar')
    const { markUserEdited } = await import('../../packages/core/src/agent-packages/markers')
    markUserEdited(avatar)

    const result = await agentAssetsComponent.check()
    expect(result.status).toBe('ok') // userEdited isn't drift; it's a deliberate user lock
    expect(result.message).toContain('user-edited, locked')
  })
})

describe('agent-assets onboarding component — install()', () => {
  it('returns noop when nothing needs repair', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    const result = await agentAssetsComponent.install(NON_INTERACTIVE)
    expect(result.status).toBe('noop')
  })

  it('returns noop with no projections', async () => {
    const result = await agentAssetsComponent.install(NON_INTERACTIVE)
    expect(result.status).toBe('noop')
    expect(result.message).toContain('0 agent-package projections')
  })
})

describe('agent-assets onboarding component — shape', () => {
  it('exposes the OnboardingComponent contract', () => {
    expect(agentAssetsComponent.name).toBe('agent-assets')
    expect(typeof agentAssetsComponent.check).toBe('function')
    expect(typeof agentAssetsComponent.install).toBe('function')
  })
})
