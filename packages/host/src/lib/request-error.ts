/**
 * One reader for failed-request bodies, shared by every host surface that
 * writes through the API.
 *
 * The ordering matters and is the whole point: the status MUST be checked
 * before the body is parsed. A non-JSON error body (a proxy's HTML 502, an
 * empty 504) makes `res.json()` throw, and a caller that parses first reports
 * `Unexpected token '<' is not valid JSON` instead of the real status. Three
 * separate copies of this pattern existed here; one of them had exactly that
 * bug, which is why it lives in one place now.
 */
export async function responseError(res: Response, fallback: string): Promise<Error> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: unknown } | null
    if (typeof body?.error === 'string' && body.error.trim() !== '') detail = body.error.trim()
  } catch {
    // A non-JSON error body carries no reason of its own; the status line
    // below is then the honest message.
    detail = ''
  }
  return new Error(detail || `${fallback} (HTTP ${res.status})`)
}

/**
 * Render a thrown request failure for display. A deadline abort surfaces as
 * `TimeoutError`/`AbortError`, whose raw message ("signal is aborted without
 * reason") tells the operator nothing.
 */
export function describeRequestError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name
  if (name === 'TimeoutError' || name === 'AbortError') return 'The request timed out'
  return err instanceof Error ? err.message : String(err)
}
