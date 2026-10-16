/**
 * An in-memory resource acquirer with the real semantics — canonical order,
 * reentrancy within the holding call chain, visible waiting, abort — but no
 * lock files. The SDK testing harness uses it so external-author tests never
 * touch a real Bakin home (`acquireResources` writes under it).
 */
import { heldInContext, sortResources, type acquireResources, type ResourceLease } from './resources'

export function createMemoryResourceAcquirer(pollMs = 10): typeof acquireResources {
  const held = new Map<string, { operationId?: string; title: string }>()
  return async (resources, opts) => {
    const wanted = sortResources(resources).filter((r) => !heldInContext(r))
    const taken: string[] = []
    const releaseTaken = () => {
      for (const r of [...taken].reverse()) held.delete(r)
      taken.length = 0
    }
    try {
      for (const resource of wanted) {
        let announced = false
        while (held.has(resource)) {
          if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('Aborted')
          if (!announced) {
            announced = true
            const holder = held.get(resource)!
            opts.onWait?.({ resource, holder: { pid: process.pid, acquiredAt: '', title: holder.title, ...(holder.operationId ? { operationId: holder.operationId } : {}) } })
          }
          await new Promise((resolve) => setTimeout(resolve, pollMs))
        }
        if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('Aborted')
        held.set(resource, { operationId: opts.identity.operationId, title: opts.identity.title })
        taken.push(resource)
      }
    } catch (err) {
      releaseTaken()
      throw err
    }
    const lease: ResourceLease = {
      resources: [...taken],
      release: releaseTaken,
    }
    return lease
  }
}
