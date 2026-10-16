/**
 * Readiness → targeted health rerun wiring (#908 §4.7, D8): every readiness
 * transition (state or routing) reruns the three channel checks so the
 * Health incident appears within seconds of a failure and clears within
 * seconds of a verified recovery — never at the next 30-minute sweep.
 * Debounced so a burst of transitions (connecting → connected) costs one run.
 * Pure wiring; the subscription and the runner are injected for tests.
 */
export interface ReadinessChangeLike {
  stateChanged: boolean
  routingChanged: boolean
}

export interface ChannelHealthRerunDeps {
  subscribe(listener: (change: ReadinessChangeLike) => void): () => void
  run(): Promise<unknown>
  checkIds: readonly string[]
  debounceMs?: number
  onError?(err: unknown): void
}

export const CHANNEL_HEALTH_RERUN_DEBOUNCE_MS = 1_000

/** Returns the teardown (unsubscribe + cancel a pending run). */
export function wireChannelHealthReruns(deps: ChannelHealthRerunDeps): () => void {
  const debounceMs = deps.debounceMs ?? CHANNEL_HEALTH_RERUN_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const unsubscribe = deps.subscribe((change) => {
    if (stopped || (!change.stateChanged && !change.routingChanged)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (stopped) return
      deps.run().catch((err) => deps.onError?.(err))
    }, debounceMs)
  })
  return () => {
    stopped = true
    unsubscribe()
    if (timer) clearTimeout(timer)
    timer = null
  }
}
