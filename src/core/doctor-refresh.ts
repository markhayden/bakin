/** Background refresh scheduling; evidence and single-flight execution stay in doctor-execution. */
interface CheckFreshness {
  id: string
  maxAgeMs: number
  completedAt: number | null
  failed: boolean
}
interface RefreshDependencies {
  checks(): CheckFreshness[]
  run(id: string, afterInFlight: boolean): Promise<unknown>
  project(): void
  onError(error: unknown): void
}

export function createDoctorRefreshCoordinator(deps: RefreshDependencies) {
  const dirty = new Set<string>()
  const running = new Set<string>()
  const retryAfter = new Map<string, number>()
  let stopped = false
  return {
    invalidate(ids: readonly string[]) {
      if (!stopped) for (const id of ids) dirty.add(id)
    },
    async tick(now: number): Promise<void> {
      if (stopped) return
      // Projection owns time-dependent state such as snooze expiry, even when
      // no browser reads the report and no diagnostic needs to run.
      deps.project()
      const checks = deps.checks()
      const live = new Set(checks.map((check) => check.id))
      for (const id of dirty) if (!live.has(id)) dirty.delete(id)
      for (const id of retryAfter.keys()) if (!live.has(id)) retryAfter.delete(id)
      await Promise.all(checks.map(async (check) => {
        const due = check.completedAt === null
          || now - check.completedAt >= (check.failed ? 30_000 : check.maxAgeMs)
        if ((!due && !dirty.has(check.id)) || running.has(check.id)
          || now < (retryAfter.get(check.id) ?? 0)) return
        const invalidated = dirty.delete(check.id)
        running.add(check.id)
        try {
          await deps.run(check.id, invalidated)
        } catch (error) {
          dirty.add(check.id)
          retryAfter.set(check.id, now + 30_000)
          deps.onError(error)
        } finally {
          running.delete(check.id)
        }
      }))
    },
    stop() { stopped = true; dirty.clear(); retryAfter.clear() },
  }
}

/** Only durable transitions invalidate checks; chunks, progress and Health output cannot loop. */
export function healthChecksAffectedByEvent(
  event: Readonly<Record<string, unknown>>,
  checks: ReadonlyArray<{ id: string; localId: string; owner: { id: string; kind: string } }>,
): string[] {
  // Plugin envelopes name the event inside; other producers use type and may
  // also supply an event verb (for example taskboard + change).
  const name = String(event.type === 'plugin-event' ? event.event ?? '' : event.type ?? event.event ?? '')
  const file = typeof event.file === 'string' ? event.file : ''
  const owners = new Set<string>()
  const system = new Set<string>()
  let all = false
  if (file === 'settings.json' || name === 'settings.changed') all = true
  if (name === 'taskboard' || /^workflow\.(gate_|complete|failed)/.test(name)) {
    owners.add('tasks'); owners.add('workflows')
    system.add('restart-recovery'); system.add('execution-safety')
  }
  if (/^(budget\.|spend\.)/.test(name)) {
    owners.add('spend'); system.add('spend.policy-available')
  }
  if (/^(search\.rebuild\.(complete|failed)|reindex\.batch_complete)$/.test(name)) {
    for (const id of ['search', 'search-consistency', 'search-spin', 'search-canary']) system.add(id)
  }
  if (name === 'plugin:manifest-changed' || name === 'dev:plugin:reload') {
    for (const id of ['plugin-assets', 'plugin-artifacts', 'plugin-registry']) system.add(id)
    if (typeof event.pluginId === 'string') owners.add(event.pluginId)
  }
  if (name === 'plugin:settings-changed' && typeof event.pluginId === 'string') owners.add(event.pluginId)
  if (file) {
    const folder = file.split('/')[0]
    if (['assets', 'brands', 'workflows', 'tasks', 'schedule', 'team'].includes(folder)) owners.add(folder)
    if (folder === 'heartbeats') system.add('runtime')
    if (folder === 'plugin-settings') owners.add(file.split('/')[1]?.replace(/\.json$/, '') ?? '')
  }
  return checks.filter((check) => all || owners.has(check.owner.id)
    || (check.owner.id === 'health' && system.has(check.localId))).map((check) => check.id)
}
