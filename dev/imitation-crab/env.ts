import { homedir } from 'os'
import { join } from 'path'

/**
 * Chat modes:
 * - canned / echo: normal replies
 * - error: structural gateway error
 * - slow: reply after OPENCLAW_MOCK_CHAT_DELAY_MS (transport-latency testing)
 * - idle-timeout: codex app-server idle-timeout error (turn death, runtime_timeout)
 * - session-death: accept the turn, write an oversized-interrupted trajectory
 *   to the mock home, and never send a final frame — exercises the adapter's
 *   fail-fast watcher + forensics end to end
 */
export type MockChatMode = 'canned' | 'echo' | 'error' | 'slow' | 'idle-timeout' | 'session-death'
export type MockToolMode = 'ok' | 'error'

const DEFAULT_PORT = 18789
const DEFAULT_CHAT_DELAY_MS = 2000
const CHAT_MODES = new Set<MockChatMode>(['canned', 'echo', 'error', 'slow', 'idle-timeout', 'session-death'])
const TOOL_MODES = new Set<MockToolMode>(['ok', 'error'])

export function getChatDelayMs(): number {
  const raw = process.env.OPENCLAW_MOCK_CHAT_DELAY_MS
  if (!raw) return DEFAULT_CHAT_DELAY_MS
  const delay = Number(raw)
  if (!Number.isFinite(delay) || delay < 0) {
    throw new Error(`Invalid OPENCLAW_MOCK_CHAT_DELAY_MS: ${raw}`)
  }
  return delay
}

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

export function getToolMode(): MockToolMode {
  const mode = process.env.OPENCLAW_MOCK_TOOL_MODE || 'ok'
  if (!TOOL_MODES.has(mode as MockToolMode)) {
    throw new Error(`Invalid OPENCLAW_MOCK_TOOL_MODE: ${mode}`)
  }
  return mode as MockToolMode
}
