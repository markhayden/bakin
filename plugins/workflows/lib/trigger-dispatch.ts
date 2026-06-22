/**
 * Fire-and-forget dispatch trigger so the next workflow step's agent starts
 * immediately. Shared by the step/gate routes and the activate-body exec tools.
 */
export function triggerDispatch(): void {
  const port = Number(process.env.PORT || 3737)
  fetch(`http://localhost:${port}/api/dispatch`, { method: 'POST' }).catch(() => {})
}
