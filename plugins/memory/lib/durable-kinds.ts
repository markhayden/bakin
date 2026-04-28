export const CANONICAL_DURABLE_FILES = [
  'MEMORY.md',
  'DREAMS.md',
  'SOUL.md',
  'MEMORY-LOG.md',
  'USER.md',
  'IDENTITY.md',
  'AGENTS.md',
  'TOOLS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
] as const

export type DurableBasename = typeof CANONICAL_DURABLE_FILES[number]

export const DURABLE_KIND_BY_BASENAME: Record<string, string> = {
  'SOUL.md': 'soul',
  'AGENTS.md': 'rules',
  'TOOLS.md': 'tools',
  'IDENTITY.md': 'identity',
  'HEARTBEAT.md': 'heartbeat',
  'MEMORY.md': 'memory',
  'MEMORY-LOG.md': 'memory-log',
  'DREAMS.md': 'dreams',
  'USER.md': 'user',
  'BOOTSTRAP.md': 'bootstrap',
}

export function durableKindForBasename(basename: string): string | undefined {
  return DURABLE_KIND_BY_BASENAME[basename]
}
