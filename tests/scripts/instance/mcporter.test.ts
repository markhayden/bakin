import { describe, expect, it } from 'bun:test'

import {
  mcporterBakinUrlBase,
  mcporterConfigJson,
  mcporterWriteArgs,
  parseAgentIds,
} from '../../../scripts/instance/mcporter'

describe('parseAgentIds', () => {
  it('parses a JSON array of agents', () => {
    expect(parseAgentIds('[{"id":"main"},{"id":"pixel"}]')).toEqual(['main', 'pixel'])
  })
  it('parses a nested { agents: [...] } shape', () => {
    expect(parseAgentIds('{"agents":[{"id":"main"}]}')).toEqual(['main'])
  })
  it('ignores surrounding log noise', () => {
    expect(parseAgentIds('Container running\n[{"id":"main"}]\n')).toEqual(['main'])
  })
  it('returns [] on garbage', () => {
    expect(parseAgentIds('not json at all')).toEqual([])
  })
})

describe('mcporterConfigJson', () => {
  it('builds a bakin-<agent> entry per agent at the given base url', () => {
    const cfg = JSON.parse(mcporterConfigJson(['main', 'pixel'], 'http://host.docker.internal:3737'))
    expect(cfg.mcpServers['bakin-main'].url).toBe('http://host.docker.internal:3737/mcp?agent=main')
    expect(cfg.mcpServers['bakin-pixel'].url).toBe('http://host.docker.internal:3737/mcp?agent=pixel')
  })
})

describe('mcporterBakinUrlBase', () => {
  it('uses localhost in-container (sandbox) and host.docker.internal on the host', () => {
    expect(mcporterBakinUrlBase(true)).toBe('http://localhost:3737')
    expect(mcporterBakinUrlBase(false)).toBe('http://host.docker.internal:3737')
  })
})

describe('mcporterWriteArgs', () => {
  it('writes the config into the container via a shell-safe base64 round-trip', () => {
    const json = mcporterConfigJson(['main'], 'http://host.docker.internal:3737')
    const args = mcporterWriteArgs('/c/docker-compose.yml', 'openclaw-gateway', json)
    expect(args.slice(0, 7)).toEqual([
      'docker', 'compose', '-f', '/c/docker-compose.yml', 'exec', '-T', 'openclaw-gateway',
    ])
    const shellCmd = args[args.length - 1]
    expect(shellCmd).toContain('/home/node/.mcporter/mcporter.json')
    // the embedded base64 decodes back to the exact config
    const b64 = shellCmd.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1]
    expect(Buffer.from(b64, 'base64').toString('utf-8')).toBe(json)
  })
})
