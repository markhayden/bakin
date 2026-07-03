/**
 * In-process asset-write notifications — the single choke all creation
 * paths converge on (createAsset / addVersion / upsert-changed), so the
 * enrichment queue (and any future subscriber) hears every content change
 * without the write paths knowing subscribers exist. Fire-and-forget by
 * contract: a subscriber failure NEVER blocks or fails the write.
 */
import { createLogger } from '../../../src/core/logger'

const log = createLogger('asset-events')

export interface AssetWrittenEvent {
  assetId: string
  version: number
  op: 'create' | 'add-version' | 'upsert'
}

type Subscriber = (event: AssetWrittenEvent) => void | Promise<void>

const subscribers = new Set<Subscriber>()

export function onAssetWritten(subscriber: Subscriber): () => void {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

export function emitAssetWritten(event: AssetWrittenEvent): void {
  for (const subscriber of subscribers) {
    try {
      const result = subscriber(event)
      if (result instanceof Promise) {
        result.catch((err) => log.warn('asset-written subscriber failed', { err: err instanceof Error ? err.message : String(err) }))
      }
    } catch (err) {
      log.warn('asset-written subscriber failed', { err: err instanceof Error ? err.message : String(err) })
    }
  }
}

/** Test-only. */
export function resetAssetEventSubscribersForTests(): void {
  subscribers.clear()
}
