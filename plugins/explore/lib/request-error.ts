/**
 * Render a thrown request failure for display. A deadline abort surfaces as
 * `TimeoutError`/`AbortError`, whose raw message ("signal is aborted without
 * reason") tells the operator nothing. Shared by every fetching component in
 * this plugin — three byte-identical copies lived here before.
 */
export function describeRequestError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'The request timed out'
  return err instanceof Error ? err.message : String(err)
}
