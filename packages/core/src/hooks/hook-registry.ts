/**
 * Cross-plugin hook registry for Bakin.
 *
 * Plugins register handlers for named hooks during activate().
 * Core modules and other plugins call hooks instead of importing
 * directly across plugin boundaries.
 */

type HookHandler = (data: unknown) => unknown | Promise<unknown>

interface HookEntry {
  handler: HookHandler
  /** Plugin id that registered this handler — null when registered by core. */
  pluginId: string | null
}

export class HookRegistry {
  private handlers = new Map<string, HookEntry[]>()

  /**
   * Register a handler for a named hook. Returns an unsubscribe function.
   * Handlers can accept any input and return any output — type safety
   * is enforced at call sites, not at registration.
   *
   * The optional `pluginId` (third arg) tags the entry with the plugin
   * that registered it, enabling `unregisterByPlugin()` for clean teardown
   * during plugin remove (#119). Core modules pass nothing and stay
   * untagged so they're never swept by plugin removal.
   */
  register(name: string, handler: (data: any) => any, pluginId?: string): () => void {
    if (!this.handlers.has(name)) {
      this.handlers.set(name, [])
    }
    const entry: HookEntry = {
      handler: handler as HookHandler,
      pluginId: pluginId ?? null,
    }
    this.handlers.get(name)!.push(entry)
    return () => {
      const arr = this.handlers.get(name)
      if (arr) {
        const idx = arr.indexOf(entry)
        if (idx >= 0) arr.splice(idx, 1)
      }
    }
  }

  /**
   * Call a hook. If multiple handlers are registered, the result of each
   * is passed to the next (waterfall). Returns the final result, or the
   * original data if no handlers are registered.
   */
  async call<T>(name: string, data: T): Promise<T> {
    const arr = this.handlers.get(name)
    if (!arr || arr.length === 0) return data
    let result = data
    for (const entry of arr) {
      const out = await entry.handler(result)
      if (out !== undefined && out !== null) {
        result = out as T
      }
    }
    return result
  }

  /**
   * Call all handlers for a hook, ignoring return values.
   * Used for notification-style hooks.
   */
  async callAll(name: string, data: Record<string, unknown>): Promise<void> {
    const arr = this.handlers.get(name)
    if (!arr) return
    for (const entry of arr) {
      await entry.handler(data)
    }
  }

  /**
   * Invoke a hook as an RPC-style call. Passes data to the first registered
   * handler and returns its result. Returns undefined if no handlers exist.
   * Use this instead of call() when input and output types differ.
   */
  async invoke<R>(name: string, data: unknown): Promise<R | undefined> {
    const arr = this.handlers.get(name)
    if (!arr || arr.length === 0) return undefined
    return await arr[0].handler(data) as R
  }

  /** Check if any handlers are registered for a hook. */
  has(name: string): boolean {
    const arr = this.handlers.get(name)
    return !!arr && arr.length > 0
  }

  /** List all registered hook names (for diagnostics). */
  getRegisteredHooks(): string[] {
    return [...this.handlers.keys()]
  }

  /**
   * Sweep every handler registered by `pluginId` across every hook name.
   * Used by `bakin plugins remove` to tear down a plugin's hook
   * subscriptions before deleting its files. Returns the count removed.
   */
  unregisterByPlugin(pluginId: string): number {
    let removed = 0
    for (const [name, arr] of this.handlers) {
      const kept = arr.filter(entry => {
        if (entry.pluginId === pluginId) {
          removed++
          return false
        }
        return true
      })
      if (kept.length === 0) {
        this.handlers.delete(name)
      } else if (kept.length !== arr.length) {
        this.handlers.set(name, kept)
      }
    }
    return removed
  }

  /** Drop every registered handler. Tests use this between cases. */
  clearAll(): void {
    this.handlers.clear()
  }
}
