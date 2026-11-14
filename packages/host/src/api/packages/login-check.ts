/**
 * POST /api/packages/login-check  { packageId }
 *
 * The explicit "Check login" trigger (spec provider-integrations §4.1): runs an
 * installed pack's declared login probe once (≤ 5 s; in-flight callers share
 * it) and answers the receipts readiness will read next. Not an operation —
 * bounded and synchronous. A fixed path with the id in the body, so Health
 * cards can name it as a shared decision control (ids never ride the path).
 */
import { z } from 'zod'
import { readLockfile } from '@bakin/core/agent-packages/lockfile'
import { PackageNotInstalledError } from '@/core/agent-packages/errors'
import { listInstalledLoginPacks, verifyInstalledPackLogins } from '@/core/agent-packages/login-verify'
import { runnableLoginSetup } from '@/core/agent-packages/login-setup'
import { parseJsonBodyWeb } from '@/core/middleware'

const BodySchema = z.object({
  /** A lockfile key (`<id>@<version>`) or a bare pack id. */
  packageId: z.string().min(1),
})

export async function post(req: Request, _url: URL): Promise<Response> {
  const parsed = BodySchema.safeParse(await parseJsonBodyWeb(req) ?? {})
  if (!parsed.success) return Response.json({ ok: false, error: 'packageId is required' }, { status: 400 })
  const { packageId } = parsed.data
  const bare = packageId.includes('@') ? packageId.slice(0, packageId.lastIndexOf('@')) : packageId
  const installed = readLockfile().packages
  const isInstalled = Boolean(installed[packageId]) || Object.keys(installed).some((key) => key === bare || key.startsWith(`${bare}@`))
  if (!isInstalled) return Response.json({ ok: false, error: new PackageNotInstalledError(packageId).message }, { status: 404 })
  const pack = listInstalledLoginPacks().find((candidate) => candidate.id === bare || candidate.key === packageId)
  if (!pack) return Response.json({ ok: false, error: `Package "${packageId}" declares no login requirement.`, code: 'no_login_requirement' }, { status: 400 })
  const results = await verifyInstalledPackLogins({ packId: pack.id })
  return Response.json({ ok: true, packId: pack.id, key: pack.key, receipts: results.map((r) => ({ name: r.entry.name, setup: runnableLoginSetup(pack.manifest, r.entry), ...r.receipt })) })
}
