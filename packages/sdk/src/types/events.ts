/**
 * Cross-plugin event bus contract. Lives in its own module so both the
 * plugin context and the conversation-turns contract can reference it
 * without an import cycle (context → conversation-turns → events).
 */
export interface EventBus {
  emit(event: string, data?: Record<string, unknown>): void
  on(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
  once(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
}
