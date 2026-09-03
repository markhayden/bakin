import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getContentDir } from './content-dir'

function secret(): Buffer {
  const home = getContentDir()
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const path = join(home, 'mcp-secret')
  try {
    writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const value = readFileSync(path)
  if (value.length !== 32) throw new Error('Invalid MCP credential secret')
  return value
}

/** Provision only to the named agent. Never place credentials in URLs or logs. */
export function getMcpCredential(agentId: string): string {
  return createHmac('sha256', secret()).update(agentId).digest('base64url')
}

export function verifyMcpCredential(agentId: string, authorization: string | undefined): boolean {
  if (!agentId || !authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return false
  const supplied = Buffer.from(authorization.slice(7))
  let value: Buffer
  try { value = readFileSync(join(getContentDir(), 'mcp-secret')) }
  catch { return false }
  if (value.length !== 32) return false
  const expected = Buffer.from(createHmac('sha256', value).update(agentId).digest('base64url'))
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
