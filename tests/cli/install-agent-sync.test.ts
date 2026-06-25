/**
 * Smoke test for `bakin check agent-sync` and `bakin install agent-sync`
 * (layered-context spec, C7 — supersedes the agent-assets component).
 *
 * Exercises the underlying onboarding component (which the CLI dispatcher
 * resolves to) rather than booting the full CLI process.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-cli-agent-sync-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({ invoke: async () => undefined }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({ invoke: async () => undefined }),
}))

let openClawAgents: Array<{ id: string; identity?: { name?: string } }> = []

import { agentSyncComponent } from '../../src/core/onboarding/agent-sync'
import { installPackage } from '../../src/core/agent-packages/installer'
import { getGlobalContextPath } from '../../src/core/team-context'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  // A real roster always carries the main orchestrator — without it the
  // main-agent heuristic resolves differently at install vs scan time.
  openClawAgents = [{ id: 'main', identity: { name: 'Roscoe' } }]
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
  mkdirSync(join(dir, 'lessons'), { recursive: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(
    join(dir, 'bakin-package.json'),
    JSON.stringify({
      id: 'pixel',
      kind: 'agent',
      name: 'Pixel',
      version: '0.1.0',
      agent: { identity: { name: 'Pixel' } },
      install: { writeWorkspaceFiles: true, enableLessons: ['style'] },
      contributions: {
        workspaceFiles: ['workspace/SOUL.md'],
        lessons: ['lessons/style.md'],
        assets: ['assets/avatar.jpg'],
      },
    }),
  )
  writeFileSync(join(dir, 'workspace', 'SOUL.md'), `# Soul Pixel`)
  writeFileSync(join(dir, 'lessons', 'style.md'), `---\ntitle: Style\ndefaultEnabled: true\n---\n\nStyle body.`)
  writeFileSync(join(dir, 'assets', 'avatar.jpg'), 'jpg-bytes')
  return dir
}

describe('agent-sync onboarding component — check()', () => {
  it('flags only the unmanaged main agent after a fresh install, then ok after repair', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })

    // pixel's blocks/projections are in sync from the install; main is
    // unmanaged and has never been synced, so its context block is pending.
    const before = await agentSyncComponent.check()
    expect(before.status).toBe('warn')
    expect(before.message).toContain('file-missing')

    await agentSyncComponent.install(NON_INTERACTIVE)
    const after = await agentSyncComponent.check()
    expect(after.status).toBe('ok')
    expect(after.message).toContain('in sync')
  })

  it('returns warn with attribution after a context-layer edit', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- Be excellent')

    const result = await agentSyncComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('block-stale')
    expect(result.remediation).toContain('bakin install agent-sync')
  })

  it('returns error when a projected asset goes missing', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })
    rmSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'))

    const result = await agentSyncComponent.check()
    expect(result.status).toBe('error')
    expect(result.message).toContain('asset-missing')
  })
})

describe('agent-sync onboarding component — install()', () => {
  it('returns noop when everything is already in sync', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })
    await agentSyncComponent.install(NON_INTERACTIVE) // first sync settles main

    const result = await agentSyncComponent.install(NON_INTERACTIVE)
    expect(result.status).toBe('noop')
  })

  it('repairs stale blocks via a local sync', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })
    writeFileSync(getGlobalContextPath(), '# House Rules\n\n- Be excellent')

    const result = await agentSyncComponent.install(NON_INTERACTIVE)
    expect(result.status).toBe('installed')

    const after = await agentSyncComponent.check()
    expect(after.status).toBe('ok')
    const agentsMd = readFileSync(join(openClawDir, 'workspaces', 'pixel', 'AGENTS.md'), 'utf-8')
    expect(agentsMd).toContain('Be excellent')
  })

  it('restores a missing projected asset', async () => {
    const src = seedAgentPackage()
    await installPackage({ source: src })
    rmSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'))

    const result = await agentSyncComponent.install(NON_INTERACTIVE)
    expect(result.status).toBe('installed')
    expect(readFileSync(join(testDir, 'agents', 'pixel', 'avatar.jpg'), 'utf-8')).toBe('jpg-bytes')
  })
})
