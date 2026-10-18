/**
 * Fire-and-forget dispatch trigger so the next workflow step's agent starts
 * immediately. Shared by the step/gate routes and the activate-body exec tools.
 */
export function triggerDispatch(): void {
  // In-process (a no-op until the dispatcher starts) — never an HTTP call to
  // a guessed port, which from a test reached the live server's dispatcher.
  void import('../../../src/core/task-service').then(({ triggerDispatch: kick }) => kick(), () => {})
}
