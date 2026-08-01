/**
 * GET/POST/DELETE /api/secrets — manage the Bakin-owned integration secret store.
 *
 * Write-only / masked: GET reports only WHICH secret names each provider has
 * stored, never a value. POST sets one named secret (legacy `apiKey` body
 * shape targets the `apiKey` name); DELETE clears one. Provider ids and
 * secret names are validated (safe slug, not a reserved object key) and the
 * value length is bounded. env vars still override the store at resolution
 * time, and runtime-owned credentials are never touched here.
 */
import { z } from 'zod'
import {
  isValidProviderId,
  isValidSecretName,
  listStoredProviders,
  listStoredSecrets,
  setStoredSecret,
  unsetStoredSecret,
} from '@bakin/core/media'
import { injectSecretEnvForSlot } from '@/core/secret-env'

const secretValue = z.string().min(1).max(8192)

const setBody = z.union([
  z.object({
    provider: z.string().refine(isValidProviderId, 'invalid provider id'),
    name: z.string().refine(isValidSecretName, 'invalid secret name'),
    value: secretValue,
  }),
  // Legacy body shape: { provider, apiKey } targets the `apiKey` secret name.
  z.object({
    provider: z.string().refine(isValidProviderId, 'invalid provider id'),
    apiKey: secretValue,
  }).transform(({ provider, apiKey }) => ({ provider, name: 'apiKey', value: apiKey })),
])

function badRequest(error: string): Response {
  return Response.json({ ok: false, error }, { status: 400 })
}

export async function get(_req: Request, _url: URL): Promise<Response> {
  // Masked: the actual values never leave the server.
  // `stored` = providers with an apiKey (the images/providers view);
  // `secrets` = every stored secret NAME per provider.
  return Response.json({ stored: listStoredProviders(), secrets: listStoredSecrets() })
}

export async function post(req: Request, _url: URL): Promise<Response> {
  const parsed = setBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'invalid request')
  const { provider, name, value } = parsed.data
  setStoredSecret(provider, name, value)
  // D18 (#687): take effect NOW — the guided-key journey must not require a
  // server restart. Unset-only; a real env var still wins.
  const injectedEnv = injectSecretEnvForSlot(provider, name)
  return Response.json({ ok: true, provider, name, stored: true, injectedEnv })
}

export async function del(_req: Request, url: URL): Promise<Response> {
  const provider = (url.searchParams.get('provider') ?? '').trim()
  if (!isValidProviderId(provider)) return badRequest('invalid provider id')
  const name = (url.searchParams.get('name') ?? 'apiKey').trim()
  if (!isValidSecretName(name)) return badRequest('invalid secret name')
  const removed = unsetStoredSecret(provider, name)
  return Response.json({ ok: true, provider, name, removed })
}
