/**
 * Is OpenClaw set up for this user? A read-only presence probe: one stat
 * of OpenClaw's config file in its home. The file is not parsed, the
 * gateway is not contacted and nothing is written — it answers "is there
 * an OpenClaw here to offer", not "is it reachable".
 */
import { existsSync, statSync } from 'node:fs'

import { getOpenClawPath } from './home'

export function isOpenClawPresent(): boolean {
  const config = getOpenClawPath('openclaw.json')
  try {
    return existsSync(config) && statSync(config).isFile()
  } catch {
    return false
  }
}
