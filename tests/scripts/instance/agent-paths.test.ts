import { describe, expect, it } from 'bun:test'

import { CONTAINER_OPENCLAW_HOME, normalizeAgentPaths } from '../../../scripts/instance/agent-paths'

const HOST_HOME = '/Users/mark/repo/dev/openclaw-home'

describe('normalizeAgentPaths', () => {
  it('rewrites host-prefixed defaults.workspace and per-agent workspace/agentDir', () => {
    const config = {
      agents: {
        defaults: { workspace: `${HOST_HOME}/workspace` },
        list: [
          {
            id: 'main',
            workspace: `${HOST_HOME}/workspace`,
            agentDir: `${HOST_HOME}/agents/main/agent`,
            model: { primary: 'openai/gpt-5.5' },
          },
        ],
      },
      gateway: { bind: 'lan' },
    }

    const result = normalizeAgentPaths(config, HOST_HOME)
    expect(result.changed).toBe(true)
    const agents = result.config.agents as {
      defaults: { workspace: string }
      list: Array<{ id: string; workspace: string; agentDir: string; model: unknown }>
    }
    expect(agents.defaults.workspace).toBe(`${CONTAINER_OPENCLAW_HOME}/workspace`)
    expect(agents.list[0]!.workspace).toBe(`${CONTAINER_OPENCLAW_HOME}/workspace`)
    expect(agents.list[0]!.agentDir).toBe(`${CONTAINER_OPENCLAW_HOME}/agents/main/agent`)
    // unrelated fields untouched
    expect(agents.list[0]!.model).toEqual({ primary: 'openai/gpt-5.5' })
    expect((result.config.gateway as { bind: string }).bind).toBe('lan')
    // input is not mutated
    expect(config.agents.list[0]!.agentDir).toBe(`${HOST_HOME}/agents/main/agent`)
  })

  it('no-ops on container-form paths', () => {
    const config = {
      agents: {
        defaults: { workspace: `${CONTAINER_OPENCLAW_HOME}/workspace` },
        list: [{ id: 'main', agentDir: `${CONTAINER_OPENCLAW_HOME}/agents/main/agent` }],
      },
    }
    const result = normalizeAgentPaths(config, HOST_HOME)
    expect(result.changed).toBe(false)
    expect(result.config).toEqual(config)
  })

  it('matches only the host openclaw-home prefix, not arbitrary absolute paths', () => {
    const config = {
      agents: {
        list: [{ id: 'main', workspace: '/opt/some/other/workspace' }],
      },
    }
    const result = normalizeAgentPaths(config, HOST_HOME)
    expect(result.changed).toBe(false)
    expect((result.config.agents as { list: Array<{ workspace: string }> }).list[0]!.workspace)
      .toBe('/opt/some/other/workspace')
  })

  it('tolerates missing agents/list/defaults and non-string values', () => {
    expect(normalizeAgentPaths({}, HOST_HOME).changed).toBe(false)
    expect(normalizeAgentPaths({ agents: {} }, HOST_HOME).changed).toBe(false)
    expect(normalizeAgentPaths({ agents: { list: [{ agentDir: 42 }] } }, HOST_HOME).changed).toBe(false)
  })
})
