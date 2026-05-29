/**
 * GET/POST/DELETE /api/secrets — manage the Bakin-owned provider secret store.
 *
 * Write-only / masked: GET reports only WHICH providers have a stored key,
 * never the value. POST sets a key; DELETE clears one. Provider-keyed and
 * generic (any provider id) — env vars still override the store at resolution
 * time, and runtime-owned credentials are never touched here.
 */
import { listStoredProviders, setStoredProviderKey, unsetStoredProviderKey } from '@bakin/core/media'

export async function get(_req: Request, _url: URL): Promise<Response> {
  // Masked: the actual key values never leave the server.
  return Response.json({ stored: listStoredProviders() })
}

export async function post(req: Request, _url: URL): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { provider?: unknown; apiKey?: unknown } | null
  const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!provider) return Response.json({ ok: false, error: 'provider is required' }, { status: 400 })
  if (!apiKey) return Response.json({ ok: false, error: 'apiKey is required' }, { status: 400 })
  setStoredProviderKey(provider, apiKey)
  return Response.json({ ok: true, provider, stored: true })
}

export async function del(req: Request, url: URL): Promise<Response> {
  const provider = (url.searchParams.get('provider') ?? '').trim()
  if (!provider) return Response.json({ ok: false, error: 'provider is required' }, { status: 400 })
  const removed = unsetStoredProviderKey(provider)
  return Response.json({ ok: true, provider, removed })
}
