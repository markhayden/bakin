/**
 * Plugin-contributed scheduled domain events (#191) — the fan-in side of the
 * `{pluginId}.scheduledEvents` hook convention (contract types + authoring
 * docs: @makinbakin/sdk `scheduled-events.ts`).
 *
 * Providers are discovered by hook-name suffix, invoked in parallel under a
 * per-provider timeout, and validated here at Schedule's boundary. A provider
 * that throws, times out, returns invalid rows, or lies about its pluginId is
 * dropped from THAT response and named in `droppedProviders` — honest
 * degrade, never a broken calendar (#191 acceptance criterion). Pure DI over
 * the hook surface; the occurrences route wires the live registry.
 */
import { z } from 'zod'
import type { ScheduledDomainEvent } from '@makinbakin/sdk'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('schedule:events')

export const SCHEDULED_EVENTS_SUFFIX = '.scheduledEvents'
export const RESCHEDULE_EVENT_SUFFIX = '.rescheduleEvent'
const DEFAULT_PROVIDER_TIMEOUT_MS = 2_000

const isoInstant = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'must be an ISO-8601 instant')

const scheduledDomainEventSchema = z
  .object({
    id: z.string().min(1),
    pluginId: z.string().min(1),
    title: z.string().min(1),
    startsAt: isoInstant.optional(),
    endsAt: isoInstant.optional(),
    dueAt: isoInstant.optional(),
    kind: z.string().min(1),
    status: z.string().optional(),
    url: z.string().optional(),
    reschedulable: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((event) => event.startsAt !== undefined || event.dueAt !== undefined, {
    message: 'one of startsAt/dueAt is required',
  })

/** The instant an event sorts/renders by. */
export function eventPrimaryInstant(event: ScheduledDomainEvent): string {
  return event.startsAt ?? event.dueAt!
}

export interface DomainEventsDeps {
  hooks: {
    getRegisteredHooks: () => string[]
    invoke: <R>(name: string, data: unknown) => Promise<R | undefined>
  }
  /** Per-provider budget; a slower provider is dropped from this response.
   *  Every drop logs the provider + elapsed ms — watch these while tuning. */
  timeoutMs?: number
}

export interface DomainEventsResult {
  events: ScheduledDomainEvent[]
  droppedProviders: string[]
}

export async function collectDomainEvents(
  fromIso: string,
  toIso: string,
  deps: DomainEventsDeps,
): Promise<DomainEventsResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS
  const providers = deps.hooks
    .getRegisteredHooks()
    .filter((name) => name.endsWith(SCHEDULED_EVENTS_SUFFIX))
    .map((name) => ({ name, pluginId: name.slice(0, -SCHEDULED_EVENTS_SUFFIX.length) }))

  const events: ScheduledDomainEvent[] = []
  const droppedProviders: string[] = []

  await Promise.all(providers.map(async ({ name, pluginId }) => {
    const startedAt = Date.now()
    try {
      const rows = await withTimeout(
        deps.hooks.invoke<ScheduledDomainEvent[]>(name, { from: fromIso, to: toIso }),
        timeoutMs,
      )
      if (rows === undefined) return // handler vanished between discovery and invoke
      const validated: ScheduledDomainEvent[] = []
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        const parsed = scheduledDomainEventSchema.safeParse(row)
        if (!parsed.success) throw new Error(`invalid event: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`)
        if (parsed.data.pluginId !== pluginId) {
          throw new Error(`event pluginId '${parsed.data.pluginId}' does not match provider '${pluginId}'`)
        }
        validated.push(parsed.data)
      }
      events.push(...validated)
    } catch (err) {
      droppedProviders.push(pluginId)
      log.warn('Scheduled-events provider dropped from response', {
        provider: pluginId,
        elapsedMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }))

  events.sort((a, b) => eventPrimaryInstant(a).localeCompare(eventPrimaryInstant(b)) || a.id.localeCompare(b.id))
  droppedProviders.sort()
  return { events, droppedProviders }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`provider timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}
