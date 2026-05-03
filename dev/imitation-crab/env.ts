import { homedir } from 'os'
import { join } from 'path'

export type MockChatMode = 'canned' | 'echo' | 'error'

const DEFAULT_PORT = 18789
const CHAT_MODES = new Set<MockChatMode>(['canned', 'echo', 'error'])

export function getMockHome(): string {
  return process.env.IMITATION_CRAB_HOME
    || process.env.OPENCLAW_MOCK_HOME
    || join(homedir(), '.imitationcrab')
}

export function getGatewayPort(): number {
  const raw = process.env.IMITATION_CRAB_PORT || process.env.OPENCLAW_MOCK_PORT
  if (!raw) return DEFAULT_PORT

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid imitation-crab gateway port: ${raw}`)
  }
  return port
}

export function getGatewayUrl(): string {
  return `http://127.0.0.1:${getGatewayPort()}`
}

export function getChatMode(): MockChatMode {
  const mode = process.env.OPENCLAW_MOCK_CHAT_MODE || 'canned'
  if (!CHAT_MODES.has(mode as MockChatMode)) {
    throw new Error(`Invalid OPENCLAW_MOCK_CHAT_MODE: ${mode}`)
  }
  return mode as MockChatMode
}
