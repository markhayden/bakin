/**
 * Cross-plugin hook registry for Bakin.
 *
 * Plugins register handlers for named hooks during activate().
 * Core modules and other plugins call hooks instead of importing
 * directly across plugin boundaries.
 */

type HookHandler = (data: unknown) => unknown | Promise<unknown>

export class HookRegistry {
  private handlers = new Map<string, HookHandler[]>()

  /**
   * Register a handler for a named hook. Returns an unsubscribe function.
   * Handlers can accept any input and return any output — type safety
   * is enforced at call sites, not at registration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(name: string, handler: (data: any) => any): () => void {
    if (!this.handlers.has(name)) {
      this.handlers.set(name, [])
    }
    const h = handler as HookHandler
    this.handlers.get(name)!.push(h)
    return () => {
      const arr = this.handlers.get(name)
      if (arr) {
        const idx = arr.indexOf(h)
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
    for (const handler of arr) {
      const out = await handler(result)
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
    for (const handler of arr) {
      await handler(data)
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
    return await arr[0](data) as R
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

  /** Drop every registered handler. Tests use this between cases. */
  clearAll(): void {
    this.handlers.clear()
  }
}
