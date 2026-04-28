import type { RuntimeMemoryEntry, RuntimeMemoryPathMatch, RuntimeMemoryTier } from '@bakin/core/adapters/runtime'
import type { PluginContext } from '../../../src/lib/plugin-types'

export type RuntimeMemorySourceKind =
  | 'durable'
  | 'skill'
  | 'daily_note'
  | 'session_store'
  | 'session_jsonl'
  | 'checkpoint'
  | 'dream_phase'
  | 'dream_signal'

export async function findRuntimeMemoryTier(
  ctx: PluginContext,
  sourceKind: RuntimeMemorySourceKind,
): Promise<RuntimeMemoryTier | null> {
  const tiers = await ctx.runtime.memory.listTiers()
  return tiers.find((tier) => tierSourceKind(tier) === sourceKind) ?? null
}

export async function listRuntimeMemoryEntries(
  ctx: PluginContext,
  sourceKind: RuntimeMemorySourceKind,
  agentId?: string,
): Promise<RuntimeMemoryEntry[]> {
  const tier = await findRuntimeMemoryTier(ctx, sourceKind)
  if (!tier) return []
  return ctx.runtime.memory.listEntries(tier.id, agentId ? { agentId } : undefined)
}

export async function getRuntimeMemoryEntry(
  ctx: PluginContext,
  sourceKind: RuntimeMemorySourceKind,
  id: string,
  agentId: string,
): Promise<RuntimeMemoryEntry | null> {
  const tier = await findRuntimeMemoryTier(ctx, sourceKind)
  if (!tier) return null
  return ctx.runtime.memory.getEntry(tier.id, id, { agentId })
}

export async function getRuntimeMemoryTierId(
  ctx: PluginContext,
  sourceKind: RuntimeMemorySourceKind,
): Promise<string | null> {
  return (await findRuntimeMemoryTier(ctx, sourceKind))?.id ?? null
}

export function resolvedSourceKind(match: RuntimeMemoryPathMatch): RuntimeMemorySourceKind | null {
  const value = match.metadata?.sourceKind
  return isRuntimeMemorySourceKind(value) ? value : null
}

export function entryMtimeMs(entry: RuntimeMemoryEntry): number {
  const explicit = entry.metadata?.mtimeMs
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  const parsed = entry.updatedAt ? Date.parse(entry.updatedAt) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

export function entrySizeBytes(entry: RuntimeMemoryEntry): number {
  const explicit = entry.metadata?.sizeBytes
  return typeof explicit === 'number' && Number.isFinite(explicit) ? explicit : Buffer.byteLength(entry.content, 'utf-8')
}

export function metadataString(entry: RuntimeMemoryEntry | RuntimeMemoryPathMatch, key: string): string | null {
  const value = entry.metadata?.[key]
  return typeof value === 'string' ? value : null
}

export function metadataBoolean(entry: RuntimeMemoryEntry | RuntimeMemoryPathMatch, key: string): boolean {
  return entry.metadata?.[key] === true
}

function tierSourceKind(tier: RuntimeMemoryTier): RuntimeMemorySourceKind | null {
  const value = tier.metadata?.sourceKind
  return isRuntimeMemorySourceKind(value) ? value : null
}

function isRuntimeMemorySourceKind(value: unknown): value is RuntimeMemorySourceKind {
  return value === 'durable'
    || value === 'skill'
    || value === 'daily_note'
    || value === 'session_store'
    || value === 'session_jsonl'
    || value === 'checkpoint'
    || value === 'dream_phase'
    || value === 'dream_signal'
}
