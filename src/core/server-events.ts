import { createLogger } from './logger'

const log = createLogger('server-events')

/** In-process observers of server state changes, including direct SSE producers. */
type Observer = (event: Readonly<Record<string, unknown>>) => void
const observers = new Set<Observer>()
export function onServerEvent(observer: Observer): () => void {
  observers.add(observer)
  return () => { observers.delete(observer) }
}
export function observeServerEvent(event: Readonly<Record<string, unknown>>): void {
  for (const observer of observers) {
    try { observer(event) } catch (error) {
      log.warn('Server event observer failed', error)
    }
  }
}
