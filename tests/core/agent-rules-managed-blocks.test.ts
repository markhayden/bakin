/**
 * Regression test for src/core/agent-rules/managed-blocks.ts.
 *
 * Migrated from tests/core/doctor-managed-blocks.test.ts in #139 C9.
 * Pins the managed-context flow so the registered health checks and CLI can
 * call the same core-owned infrastructure while projecting one physical
 * AGENTS.md marker block per agent.
 *
 * Cases:
 *
 *   - Compact block missing + autoFix=true -> block appended with one blank
 *     line of separation; trailing newline; rest of file untouched
 *   - Compact block missing + autoFix=false -> no write, warn returned
 *   - Compact block present + logical sections match expected -> ok, no write
 *   - Compact block present + logical section drifted + autoFix=true ->
 *     in-place update, surrounding content preserved exactly
 *   - Compact block present + logical section drifted + autoFix=false -> warn, no write
 *   - Compact or legacy start marker without end marker -> error result, no write
 *   - Orchestrator and subagent scopes target the right AGENTS.md files
 *
 * Test isolation per CC-6: mocks app services to a temp-backed runtime
 * adapter and seeds a synthetic roster. The doctor's other checks are
 * sidestepped by calling `applyAllManagedBlocks` directly.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-doctor-blocks-${Date.now()}-${randomUUID()}`)
const runtimeDir = join(testDir, 'runtime')

const COMPACT_START = '<!-- bakin:managed-context:start -->'
const COMPACT_END = '<!-- bakin:managed-context:end -->'

function sectionMarker(blockId: string): string {
  return `<!-- bakin:managed-context:section ${blockId} -->`
}

const runtimeAgents = [
  { id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' },
  { id: 'pixel', name: 'Pixel', role: 'Image', status: 'active' },
  { id: 'rolo', name: 'Rolo', role: 'Video', status: 'active' },
]

const appRuntime = {
  agents: {
    list: async () => runtimeAgents,
    readWorkspaceFile: async (agentId: string, path: string) => {
      const fullPath = join(runtimeDir, 'workspaces', agentId, path)
      return existsSync(fullPath) ? { path, content: readFileSync(fullPath, 'utf-8') } : null
    },
    writeWorkspaceFile: async (agentId: string, file: { path: string; content: string }) => {
      const fullPath = join(runtimeDir, 'workspaces', agentId, file.path)
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, file.content, 'utf-8')
    },
  },
}

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
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({ runtime: appRuntime }),
  maybeGetAppServices: () => ({ runtime: appRuntime }),
  createAppServices: async () => ({ runtime: appRuntime }),
}))
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async () => [],
  }),
}))

import {
  applyAllManagedBlocks,
  applyAllManagedBlocksForRuntime,
  applyManagedBlocks,
  applyManagedBlocksForRuntime,
} from '../../src/core/agent-rules/managed-blocks'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function workspacePath(agentId: string): string {
  return join(runtimeDir, 'workspaces', agentId)
}

function agentsMdPath(agentId: string): string {
  return join(workspacePath(agentId), 'AGENTS.md')
}

function seedAgentsMd(agentId: string, content: string): void {
  mkdirSync(workspacePath(agentId), { recursive: true })
  writeFileSync(agentsMdPath(agentId), content, 'utf-8')
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(runtimeDir, { recursive: true })
})

describe('applyAllManagedBlocks - compact block missing', () => {
  it('with autoFix=true, appends one managed context block with one-blank-line separation and trailing newline', async () => {
    seedAgentsMd('main', '# Main\n')
    seedAgentsMd('pixel', '# Pixel - Image Artist\n\nResponsibilities go here.\n')

    const results = await applyAllManagedBlocks(true)
    expect(results.some((r) => r.status === 'fixed')).toBe(true)

    const mainFinal = readFileSync(agentsMdPath('main'), 'utf-8')
    expect(mainFinal).toContain(COMPACT_START)
    expect(mainFinal).toContain(COMPACT_END)
    expect(mainFinal).toContain(sectionMarker('orchestrator-rules'))
    expect(mainFinal).not.toContain(sectionMarker('mission-control'))
    expect(mainFinal).not.toContain('<!-- bakin:orchestrator-rules:start -->')

    const final = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(final.startsWith('# Pixel - Image Artist\n\nResponsibilities go here.\n\n<!-- bakin:'))
      .toBe(true)
    expect(final).toContain(COMPACT_START)
    expect(final).toContain(COMPACT_END)
    expect(final).toContain(sectionMarker('mission-control'))
    expect(final).toContain(sectionMarker('hard-rules'))
    expect(final).toContain(sectionMarker('dependency-pattern'))
    expect(final).not.toContain('<!-- bakin:mission-control:start -->')
    expect(final).not.toContain('<!-- bakin:hard-rules:start -->')
    expect(final.endsWith('\n')).toBe(true)
  })

  it('with autoFix=false, returns warn diagnostics without writing', async () => {
    seedAgentsMd('pixel', '# Pixel\n')

    const before = readFileSync(agentsMdPath('pixel'), 'utf-8')
    const results = await applyAllManagedBlocks(false)

    expect(results.some((r) => r.status === 'warn' && r.autoFixable)).toBe(true)
    expect(readFileSync(agentsMdPath('pixel'), 'utf-8')).toBe(before)
  })
})

describe('applyAllManagedBlocks - compact block present', () => {
  it('with body matching expected, returns ok, leaves file byte-equal', async () => {
    seedAgentsMd('main', '# Main\n')
    seedAgentsMd('pixel', '# Pixel\n\nProse.\n')
    seedAgentsMd('rolo', '# Rolo\n')

    await applyAllManagedBlocks(true)
    const mainAfterFirst = readFileSync(agentsMdPath('main'), 'utf-8')
    const pixelAfterFirst = readFileSync(agentsMdPath('pixel'), 'utf-8')
    const roloAfterFirst = readFileSync(agentsMdPath('rolo'), 'utf-8')

    const results = await applyAllManagedBlocks(true)
    expect(
      results.every((r) => r.status === 'ok' || r.status === 'fixed'),
    ).toBe(true)
    expect(results.filter((r) => r.status === 'ok').length).toBeGreaterThan(0)

    expect(readFileSync(agentsMdPath('main'), 'utf-8')).toBe(mainAfterFirst)
    expect(readFileSync(agentsMdPath('pixel'), 'utf-8')).toBe(pixelAfterFirst)
    expect(readFileSync(agentsMdPath('rolo'), 'utf-8')).toBe(roloAfterFirst)
  })

  it('with drifted logical section and autoFix=true, in-place updates while preserving surrounding content', async () => {
    const stale = `# Pixel

Prose before.

${COMPACT_START}
## Bakin Managed Context

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

${sectionMarker('mission-control')}
this is some stale content
${COMPACT_END}

Prose after.
`
    seedAgentsMd('pixel', stale)

    await applyAllManagedBlocks(true)
    const final = readFileSync(agentsMdPath('pixel'), 'utf-8')

    expect(final.startsWith('# Pixel\n\nProse before.\n\n<!-- bakin:managed-context:start -->')).toBe(true)
    expect(final).toContain('Prose after.')
    expect(final).not.toContain('this is some stale content')
    expect(final).toContain(sectionMarker('mission-control'))
    expect(final).toContain(sectionMarker('hard-rules'))
    expect(final).not.toContain('<!-- bakin:mission-control:start -->')
  })

  it('with drifted logical section and autoFix=false, returns warn, no write', async () => {
    const stale = `${COMPACT_START}
## Bakin Managed Context

> Auto-managed by \`bakin doctor\`. Do not edit this block manually.

${sectionMarker('mission-control')}
stale content
${COMPACT_END}
`
    seedAgentsMd('pixel', stale)
    const before = readFileSync(agentsMdPath('pixel'), 'utf-8')

    const results = await applyAllManagedBlocks(false)
    expect(
      results.some(
        (r) => r.status === 'warn' && r.check === 'agent-mission-control' && r.autoFixable,
      ),
    ).toBe(true)
    expect(readFileSync(agentsMdPath('pixel'), 'utf-8')).toBe(before)
  })
})

describe('applyAllManagedBlocks - malformed file', () => {
  it('returns error for malformed compact markers and does not rewrite the file', async () => {
    const broken = `# Pixel\n\n${COMPACT_START}\nstuck content with no end marker`
    seedAgentsMd('pixel', broken)

    const results = await applyAllManagedBlocks(true)

    expect(
      results.some((r) => r.status === 'error' && r.check === 'agent-managed-context'),
    ).toBe(true)

    const after = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(after).toBe(broken)
    expect(after).not.toContain(COMPACT_END)
  })

  it('returns error for malformed legacy markers and refuses compact conversion', async () => {
    const broken = `# Pixel\n\n<!-- bakin:mission-control:start -->\nstuck content with no end marker`
    seedAgentsMd('pixel', broken)

    const results = await applyAllManagedBlocks(true)

    expect(
      results.some((r) => r.status === 'error' && r.check === 'agent-mission-control'),
    ).toBe(true)

    const after = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(after).toBe(broken)
    expect(after).not.toContain(COMPACT_START)
  })
})

describe('applyAllManagedBlocks - legacy multi-block conversion', () => {
  it('converts legacy blocks into compact managed context and removes old markers', async () => {
    const legacy = `# Pixel

Prose before.

<!-- bakin:mission-control:start -->
legacy mission content
<!-- bakin:mission-control:end -->

<!-- bakin:hard-rules:start -->
legacy hard-rule content
<!-- bakin:hard-rules:end -->

Prose after.
`
    seedAgentsMd('pixel', legacy)

    const results = await applyAllManagedBlocks(true)
    expect(results.some((r) => r.status === 'fixed')).toBe(true)

    const final = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(final).toContain(COMPACT_START)
    expect(final).toContain(sectionMarker('mission-control'))
    expect(final).toContain(sectionMarker('hard-rules'))
    expect(final).not.toContain('<!-- bakin:mission-control:start -->')
    expect(final).not.toContain('<!-- bakin:hard-rules:start -->')
    expect(final).toContain('Prose before.')
    expect(final).toContain('Prose after.')
  })

  it('keeps role and capability targeted sections out of unrelated agents', async () => {
    seedAgentsMd('main', '# Main\n')
    seedAgentsMd('pixel', '# Pixel\n')
    seedAgentsMd('rolo', '# Rolo\n')

    await applyAllManagedBlocks(true)

    const main = readFileSync(agentsMdPath('main'), 'utf-8')
    expect(main).toContain(sectionMarker('orchestrator-rules'))
    expect(main).not.toContain(sectionMarker('mission-control'))

    const pixel = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(pixel).toContain(sectionMarker('media-delegation'))
    expect(pixel).toContain('Default to the core images plugin tools')
    expect(pixel).toContain('You cannot generate video. Ever.')
    // Specialists must NOT get the "delegate to Pixel/Rolo" rules — those are
    // for the agents that create specialist subtasks, not the specialists.
    expect(pixel).not.toContain('When Creating Pixel or Rolo Tasks')

    const rolo = readFileSync(agentsMdPath('rolo'), 'utf-8')
    expect(rolo).toContain(sectionMarker('media-delegation'))
    expect(rolo).toContain('Default to the core images plugin tools')
    expect(rolo).not.toContain('You cannot generate images. Ever.')
    expect(rolo).not.toContain('You cannot generate video. Ever.')
    expect(rolo).not.toContain('When Creating Pixel or Rolo Tasks')
  })

  it('gives a non-specialist subagent the Pixel/Rolo delegation rules', async () => {
    const files = new Map<string, string>([['chef:AGENTS.md', '# Chef\n']])
    const runtime = createMockRuntimeAdapter()
    runtime.agents.list = async () => [
      { id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' },
      { id: 'chef', name: 'Chef', role: 'Generalist', status: 'active' },
    ]
    runtime.agents.readWorkspaceFile = async (agentId, path) => {
      const content = files.get(`${agentId}:${path}`)
      return content === undefined ? null : { path, content }
    }
    runtime.agents.writeWorkspaceFile = async (agentId, file) => {
      files.set(`${agentId}:${file.path}`, file.content)
    }

    await applyAllManagedBlocksForRuntime(runtime, true)

    const chef = files.get('chef:AGENTS.md') ?? ''
    expect(chef).toContain('When Creating Pixel or Rolo Tasks')
    expect(chef).toContain('You cannot generate video. Ever.')
  })
})

describe('applyManagedBlocks - scopes', () => {
  it('subagents scope does not touch main agent`s AGENTS.md', async () => {
    seedAgentsMd('main', '# Main\n')
    seedAgentsMd('pixel', '# Pixel\n')

    await applyManagedBlocks(true, { scope: 'subagents' })

    const mainContent = readFileSync(agentsMdPath('main'), 'utf-8')
    expect(mainContent).not.toContain(COMPACT_START)

    const pixelContent = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(pixelContent).toContain(COMPACT_START)
    expect(pixelContent).toContain(sectionMarker('mission-control'))
  })

  it('orchestrator scope touches only the main agent`s AGENTS.md', async () => {
    seedAgentsMd('main', '# Main\n')
    seedAgentsMd('pixel', '# Pixel\n')

    await applyManagedBlocks(true, { scope: 'orchestrator' })

    const mainContent = readFileSync(agentsMdPath('main'), 'utf-8')
    expect(mainContent).toContain(COMPACT_START)
    expect(mainContent).toContain(sectionMarker('orchestrator-rules'))

    const pixelContent = readFileSync(agentsMdPath('pixel'), 'utf-8')
    expect(pixelContent).not.toContain(COMPACT_START)
  })
})

describe('applyManagedBlocks - orchestrator rules', () => {
  it('warns when the main AGENTS.md is missing', async () => {
    const results = await applyManagedBlocks(false, { scope: 'orchestrator' })
    const row = results.find((r) => r.check === 'orchestrator-rules')
    expect(row?.status).toBe('warn')
    expect(row?.message).toMatch(/AGENTS.md not found/)
  })

  it('warns when the orchestrator logical section is missing without autoFix', async () => {
    seedAgentsMd('main', '# Main\n\nNo block here.\n')
    const results = await applyManagedBlocks(false, { scope: 'orchestrator' })
    const row = results.find((r) => r.check === 'orchestrator-rules')
    expect(row?.status).toBe('warn')
    expect(row?.autoFixable).toBe(true)
    expect(row?.message).toMatch(/missing from main\/AGENTS.md managed context/)
  })

  it('adds the compact orchestrator managed context under autoFix when missing', async () => {
    seedAgentsMd('main', '# Main\n')
    const results = await applyManagedBlocks(true, { scope: 'orchestrator' })
    const row = results.find((r) => r.check === 'orchestrator-rules')
    expect(row?.status).toBe('fixed')
    const after = readFileSync(agentsMdPath('main'), 'utf-8')
    expect(after).toContain(COMPACT_START)
    expect(after).toContain(sectionMarker('orchestrator-rules'))
    expect(after).not.toContain('<!-- bakin:orchestrator-rules:start -->')
  })

  it('reports error when the legacy orchestrator block has a start marker but no end marker', async () => {
    seedAgentsMd(
      'main',
      '# Main\n\n<!-- bakin:orchestrator-rules:start -->\n(missing end)\n',
    )
    const results = await applyManagedBlocks(true, { scope: 'orchestrator' })
    const row = results.find((r) => r.check === 'orchestrator-rules')
    expect(row?.status).toBe('error')
    expect(row?.message).toMatch(/malformed legacy markers/)
  })
})

describe('applyAllManagedBlocks - missing AGENTS.md', () => {
  it('returns warn when an agent has no AGENTS.md, does not create one', async () => {
    mkdirSync(workspacePath('pixel'), { recursive: true })

    const results = await applyAllManagedBlocks(true)
    expect(results.some((r) => r.status === 'warn' && r.message.includes('AGENTS.md not found'))).toBe(true)
    expect(existsSync(agentsMdPath('pixel'))).toBe(false)
  })
})

describe('applyAllManagedBlocksForRuntime', () => {
  it('uses runtime agents and workspace files instead of OpenClaw paths', async () => {
    const files = new Map<string, string>([
      ['main:AGENTS.md', '# Main\n'],
      ['pixel:AGENTS.md', '# Pixel\n'],
    ])
    const runtime = createMockRuntimeAdapter()
    runtime.agents.list = async () => [
      { id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' },
      { id: 'pixel', name: 'Pixel', role: 'Image', status: 'active' },
    ]
    runtime.agents.readWorkspaceFile = async (agentId, path) => {
      const content = files.get(`${agentId}:${path}`)
      return content === undefined ? null : { path, content }
    }
    runtime.agents.writeWorkspaceFile = async (agentId, file) => {
      files.set(`${agentId}:${file.path}`, file.content)
    }

    const results = await applyAllManagedBlocksForRuntime(runtime, true)

    expect(results.some((r) => r.status === 'fixed')).toBe(true)
    expect(files.get('pixel:AGENTS.md')).toContain(COMPACT_START)
    expect(files.get('pixel:AGENTS.md')).toContain(sectionMarker('mission-control'))
    expect(files.get('main:AGENTS.md')).toContain(COMPACT_START)
    expect(files.get('main:AGENTS.md')).toContain(sectionMarker('orchestrator-rules'))
  })

  it('can scope runtime execution to subagents only', async () => {
    const files = new Map<string, string>([
      ['main:AGENTS.md', '# Main\n'],
      ['pixel:AGENTS.md', '# Pixel\n'],
    ])
    const runtime = createMockRuntimeAdapter()
    runtime.agents.list = async () => [
      { id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' },
      { id: 'pixel', name: 'Pixel', role: 'Image', status: 'active' },
    ]
    runtime.agents.readWorkspaceFile = async (agentId, path) => {
      const content = files.get(`${agentId}:${path}`)
      return content === undefined ? null : { path, content }
    }
    runtime.agents.writeWorkspaceFile = async (agentId, file) => {
      files.set(`${agentId}:${file.path}`, file.content)
    }

    const results = await applyManagedBlocksForRuntime(runtime, true, { scope: 'subagents' })

    expect(results.some((r) => r.status === 'fixed')).toBe(true)
    expect(files.get('pixel:AGENTS.md')).toContain(COMPACT_START)
    expect(files.get('pixel:AGENTS.md')).toContain(sectionMarker('mission-control'))
    expect(files.get('main:AGENTS.md')).toBe('# Main\n')
  })
})
