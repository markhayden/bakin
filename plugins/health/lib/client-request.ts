import type { ZodType } from 'zod'

interface ClientRequestContext {
  signal: AbortSignal
}

async function responsePayload(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

async function requestPayload(
  url: string,
  context: ClientRequestContext,
  label: string,
): Promise<unknown> {
  const response = await fetch(url, { signal: context.signal })
  if (!response.ok) throw new Error(`${label} could not be loaded (${response.status})`)
  return await responsePayload(response, label)
}

export async function requestJsonWithGuard<T>(
  url: string,
  context: ClientRequestContext,
  label: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const payload = await requestPayload(url, context, label)
  if (!validate(payload)) throw new Error(`${label} returned an invalid response`)
  return payload
}

export async function requestJsonWithSchema<T>(
  url: string,
  context: ClientRequestContext,
  label: string,
  schema: ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await requestPayload(url, context, label))
  if (!parsed.success) throw new Error(`${label} returned an invalid response`)
  return parsed.data
}
