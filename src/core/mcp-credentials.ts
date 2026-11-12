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

/**
 * What `getMcpCredential` would answer, WITHOUT creating the secret: for a
 * process that only checks. With no secret on disk no credential was ever
 * provisioned, so the answer is one that can never match a provisioned
 * entry — tool access then reads as not current (needs provisioning), and
 * nothing is written.
 */
export function readMcpCredential(agentId: string): string {
  let value: Buffer
  try {
    value = readFileSync(join(getContentDir(), 'mcp-secret'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return UNPROVISIONED_MCP_CREDENTIAL
    throw error
  }
  if (value.length !== 32) throw new Error('Invalid MCP credential secret')
  return createHmac('sha256', value).update(agentId).digest('base64url')
}

/** Not a credential: real ones are 43 base64url characters. */
export const UNPROVISIONED_MCP_CREDENTIAL = 'unprovisioned'

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
