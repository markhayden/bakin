import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { getChatMode, getGatewayPort, getGatewayUrl, getMockHome, getToolMode } from '../../dev/imitation-crab/env'

describe('imitation-crab env', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('uses explicit mock home and gateway port when configured', () => {
    const home = join(tmpdir(), 'configured-crab-home')
    process.env.IMITATION_CRAB_HOME = home
    process.env.IMITATION_CRAB_PORT = '19001'

    expect(getMockHome()).toBe(home)
    expect(getGatewayPort()).toBe(19001)
    expect(getGatewayUrl()).toBe('http://127.0.0.1:19001')
  })

  it('fails loud on invalid gateway port, chat mode, and tool mode', () => {
    process.env.IMITATION_CRAB_PORT = 'not-a-port'
    expect(() => getGatewayPort()).toThrow('Invalid imitation-crab gateway port')

    process.env.OPENCLAW_MOCK_CHAT_MODE = 'surprise'
    expect(() => getChatMode()).toThrow('Invalid OPENCLAW_MOCK_CHAT_MODE')

    process.env.OPENCLAW_MOCK_TOOL_MODE = 'surprise'
    expect(() => getToolMode()).toThrow('Invalid OPENCLAW_MOCK_TOOL_MODE')
  })
})
