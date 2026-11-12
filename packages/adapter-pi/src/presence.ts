/**
 * Is Pi installed for this user? A read-only presence probe: one stat of
 * Pi's own agent directory, which the pi CLI creates on first use. Nothing
 * is initialized, read as content or written — it answers "is there a Pi
 * here to offer", not "can it run a turn".
 */
import { existsSync, statSync } from 'node:fs'

import { getPiAgentDir } from './home'

export function isPiPresent(): boolean {
  const dir = getPiAgentDir()
  try {
    return existsSync(dir) && statSync(dir).isDirectory()
  } catch {
    return false
  }
}
