/**
 * OpenClaw tool-access provisioning (P1.3) — the config transforms relocated
 * out of core. Golden bytes for the per-agent `mcp.servers` entries, plus the
 * prune (deprovision) and read-only verify paths.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure config-transform suite (no storage), but the isolation guard requires
// the content-dir resolvers be mocked so nothing can ever leak.
const testDir = join(tmpdir(), `bakin-test-oc-provision-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import {
  applyBakinMcpEntries,
  removeBakinMcpEntries,
  verifyBakinMcpEntries,
  serverName,
  mcpUrl,
  type BakinMcpConfig,
} from '../../packages/adapter-openclaw/src/tool-access-provisioning'

const BASE = 'http://localhost:3737'

describe('applyBakinMcpEntries', () => {
  it('writes byte-identical mcp.servers entries for every agent, preserving foreign entries', () => {
    const config: BakinMcpConfig = {
      mcp: { servers: { existing: { url: 'http://localhost:9999/mcp' } } },
    }
    const changes = applyBakinMcpEntries(config, ['main', 'pixel', 'patch'], BASE)

    expect(changes).toEqual(['added bakin-main', 'added bakin-pixel', 'added bakin-patch'])
    expect(config.mcp!.servers).toEqual({
      existing: { url: 'http://localhost:9999/mcp' },
      'bakin-main': { url: 'http://localhost:3737/mcp?agent=main', description: 'Bakin MCP for main' },
      'bakin-pixel': { url: 'http://localhost:3737/mcp?agent=pixel', description: 'Bakin MCP for pixel' },
      'bakin-patch': { url: 'http://localhost:3737/mcp?agent=patch', description: 'Bakin MCP for patch' },
    })
  })

  it('updates changed URLs and prunes stale Bakin-owned entries', () => {
    const config: BakinMcpConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main', description: 'Bakin MCP for main' },
          'bakin-old': { url: 'http://localhost:3737/mcp?agent=old', description: 'Bakin MCP for old' },
        },
      },
    }
    const changes = applyBakinMcpEntries(config, ['main'], 'http://localhost:4000')

    expect(changes).toContain('updated bakin-main')
    expect(changes).toContain('removed bakin-old (agent no longer in runtime config)')
    expect(config.mcp!.servers!['bakin-main'].url).toBe('http://localhost:4000/mcp?agent=main')
    expect(config.mcp!.servers!['bakin-old']).toBeUndefined()
  })

  it('never prunes a bakin-* entry the user owns (no Bakin description tag)', () => {
    const config: BakinMcpConfig = {
      mcp: {
        servers: {
          'bakin-docs': { url: 'http://localhost:9000/mcp', description: 'my own docs server' },
          'bakin-bare': { url: 'http://localhost:9001/mcp' },
        },
      },
    }
    const changes = applyBakinMcpEntries(config, ['main'], BASE)
    expect(changes).toEqual(['added bakin-main'])
    expect(config.mcp!.servers!['bakin-docs']).toBeDefined()
    expect(config.mcp!.servers!['bakin-bare']).toBeDefined()
  })

  it('is idempotent — no changes when entries are already current', () => {
    const config: BakinMcpConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main', description: 'Bakin MCP for main' },
        },
      },
    }
    expect(applyBakinMcpEntries(config, ['main'], BASE)).toEqual([])
  })

  it('initializes mcp.servers on a bare config', () => {
    const config: BakinMcpConfig = {}
    applyBakinMcpEntries(config, ['main'], BASE)
    expect(config.mcp!.servers!['bakin-main'].url).toBe('http://localhost:3737/mcp?agent=main')
  })
})

describe('removeBakinMcpEntries', () => {
  it('removes only Bakin-owned entries, leaving foreign ones (even bakin-* named)', () => {
    const config: BakinMcpConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main', description: 'Bakin MCP for main' },
          'bakin-docs': { url: 'http://localhost:9000/mcp', description: 'my own docs server' },
          other: { url: 'http://localhost:8080/mcp' },
        },
      },
    }
    const changes = removeBakinMcpEntries(config)
    expect(changes).toEqual(['removed bakin-main'])
    expect(config.mcp!.servers).toEqual({
      'bakin-docs': { url: 'http://localhost:9000/mcp', description: 'my own docs server' },
      other: { url: 'http://localhost:8080/mcp' },
    })
  })

  it('no-ops on a config with no servers', () => {
    expect(removeBakinMcpEntries({})).toEqual([])
  })
})

describe('verifyBakinMcpEntries', () => {
  it('reports correct/missing entries and stale keys without mutating', () => {
    const config: BakinMcpConfig = {
      mcp: {
        servers: {
          'bakin-main': { url: 'http://localhost:3737/mcp?agent=main', description: 'Bakin MCP for main' },
          'bakin-stale': { url: 'http://localhost:3737/mcp?agent=stale', description: 'Bakin MCP for stale' },
        },
      },
    }
    const status = verifyBakinMcpEntries(config, ['main', 'pixel'], BASE)

    expect(status.agentEntries.find((e) => e.name === 'bakin-main')?.correct).toBe(true)
    expect(status.agentEntries.find((e) => e.name === 'bakin-pixel')?.correct).toBe(false)
    expect(status.staleEntries).toEqual(['bakin-stale'])
    // untouched
    expect(config.mcp!.servers!['bakin-stale']).toBeDefined()
  })
})

describe('helpers', () => {
  it('serverName / mcpUrl', () => {
    expect(serverName('rolo')).toBe('bakin-rolo')
    expect(mcpUrl('rolo', BASE)).toBe('http://localhost:3737/mcp?agent=rolo')
  })
})
