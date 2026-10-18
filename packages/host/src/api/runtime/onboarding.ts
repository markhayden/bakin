/**
 * `POST /api/runtime/onboarding/install` — one onboarding component install
 * as an operation (#895 D11): 202 `{ operationId, bootId }` (200 `attached`
 * for an identical live request); the result body is `{ ok, result }`.
 *
 * Options are explicit (the shared request schema — the web hub and the CLI
 * send the same shape) and nothing is auto-approved. A service claim is
 * honoured only with the `X-Bakin-Cli-Secret` this server wrote into its
 * `server.lock`: proof the request came from this home's operator.
 */
import { operationOriginFromRequest } from '@bakin/core/operations'
import { installableComponent } from '@/core/onboarding/index'
import { OnboardingInstallRequestSchema } from '@/core/onboarding/install-request'
import { componentInstallOperation } from '@/core/onboarding/operation'
import { CLI_SECRET_HEADER, cliSecretMatches } from '@/core/server-lock'
import { startOperationResponse } from '../operations'

export async function install(req: Request): Promise<Response> {
  const raw: unknown = await req.json().catch(() => undefined)
  const parsed = OnboardingInstallRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ ok: false, error: `Invalid onboarding install request: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ')}` }, { status: 400 })
  }
  const { component, options } = parsed.data
  if (options.allowServiceClaim && !cliSecretMatches(req.headers.get(CLI_SECRET_HEADER))) {
    return Response.json({ ok: false, error: "Claiming the search service needs this home's CLI: run `bakin install search` on the machine that runs this Bakin." }, { status: 403 })
  }
  return startOperationResponse(componentInstallOperation(installableComponent(component), options, operationOriginFromRequest(req)))
}
