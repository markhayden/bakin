/**
 * GET/POST/DELETE /api/secrets — manage the Bakin-owned provider secret store.
 *
 * Write-only / masked: GET reports only WHICH providers have a stored key,
 * never the value. POST sets a key; DELETE clears one. Provider ids are
 * validated (safe slug, not a reserved object key) and the key length is
 * bounded. env vars still override the store at resolution time, and
 * runtime-owned credentials are never touched here.
 */
import { z } from 'zod'
import { isValidProviderId, listStoredProviders, setStoredProviderKey, unsetStoredProviderKey } from '@bakin/core/media'

const setBody = z.object({
  provider: z.string().refine(isValidProviderId, 'invalid provider id'),
  apiKey: z.string().min(1).max(8192),
})

function badRequest(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 })
}

export async function get(_req: Request, _url: URL): Promise<Response> {
  // Masked: the actual key values never leave the server.
  return Response.json({ stored: listStoredProviders() })
}

export async function post(req: Request, _url: URL): Promise<Response> {
  const parsed = setBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'invalid request')
  setStoredProviderKey(parsed.data.provider, parsed.data.apiKey)
  return Response.json({ ok: true, provider: parsed.data.provider, stored: true })
}

export async function del(_req: Request, url: URL): Promise<Response> {
  const provider = (url.searchParams.get('provider') ?? '').trim()
  if (!isValidProviderId(provider)) return badRequest('invalid provider id')
  const removed = unsetStoredProviderKey(provider)
  return Response.json({ ok: true, provider, removed })
}
