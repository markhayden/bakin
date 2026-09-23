/** The server's plain-words reason for a refused action, when it sent one; a bare machine code is not a sentence. */
export async function refusalMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; error?: unknown }
    if (typeof body.message === 'string' && body.message) return body.message
    if (typeof body.error === 'string' && body.error && !/^[a-z0-9_]+$/.test(body.error)) return body.error
  } catch {
    // Non-JSON failure body — the fallback names the status.
  }
  return fallback
}
