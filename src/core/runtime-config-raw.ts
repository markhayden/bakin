import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'

const log = createLogger('runtime-config-raw')

export type RuntimeConfigRawReason =
  | 'onboarding.runtime.integrity'
  | 'onboarding.llm.check'
  | 'onboarding.channels.check'

interface RawConfigAllowlistEntry {
  reason: RuntimeConfigRawReason
  key: string | RegExp
  tracking: string
}

export const RAW_RUNTIME_CONFIG_ALLOWLIST: RawConfigAllowlistEntry[] = [
  {
    reason: 'onboarding.runtime.integrity',
    key: '*',
    tracking: 'adapter-layer:runtime-integrity',
  },
  {
    reason: 'onboarding.llm.check',
    key: /^agents\.[^.]+\.authProfiles$/,
    tracking: 'adapter-layer:onboarding-credential-checks',
  },
  {
    reason: 'onboarding.channels.check',
    key: 'channels',
    tracking: 'adapter-layer:onboarding-credential-checks',
  },
]

function findAllowlistEntry(reason: RuntimeConfigRawReason, key: string): RawConfigAllowlistEntry | null {
  return RAW_RUNTIME_CONFIG_ALLOWLIST.find((entry) => {
    if (entry.reason !== reason) return false
    return typeof entry.key === 'string' ? entry.key === key : entry.key.test(key)
  }) ?? null
}

function recordRawConfigAccess(entry: RawConfigAllowlistEntry, key: string): void {
  try {
    appendAudit(getContentDir(), 'runtime.config.raw', 'system', {
      key,
      reason: entry.reason,
      tracking: entry.tracking,
    }, 'system')
  } catch (err) {
    log.warn('Failed to audit runtime config raw access', err, {
      key,
      reason: entry.reason,
      tracking: entry.tracking,
    })
  }
}

export async function readAllowedRuntimeConfigRaw<T>(
  runtime: AgentRuntimeAdapter,
  key: string,
  reason: RuntimeConfigRawReason,
): Promise<T | null> {
  const entry = findAllowlistEntry(reason, key)
  if (!entry) {
    throw new Error(`runtime.config.raw is not allowlisted for reason '${reason}' and key '${key}'`)
  }

  recordRawConfigAccess(entry, key)
  const value = await runtime.config.raw<T | null>(key, reason)
  return value ?? null
}
