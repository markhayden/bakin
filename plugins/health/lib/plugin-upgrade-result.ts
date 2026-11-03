/**
 * What a settled plugin-upgrade operation means, from the body the upgrade
 * route answers (#895): a preview that needs consent, one that is ready to
 * commit with its token, a finished commit, a failure, or an unconfirmable
 * outcome. Shared by the System tab's inventory and the Updates tab (#1007).
 */

/** A binary download an upgrade asks consent for (name, version, pinned sha, size hint). */
export interface PluginUpgradeBin {
  name: string
  version: string
  sha256: string
  sizeBytes?: number
}

export interface PluginUpgradeResult {
  message: string
  awaitingConsent: boolean
  permissions: string[]
  bins: PluginUpgradeBin[]
  consentToken?: string
  noop: boolean
  /** A preview with nothing new to consent to: commit with `consentToken` to apply it. */
  ready?: boolean
}

export class SystemMutationOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SystemMutationOutcomeUnknownError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUpgradeBin(value: unknown): value is PluginUpgradeBin {
  return isRecord(value) && typeof value.name === 'string' && typeof value.version === 'string' && typeof value.sha256 === 'string'
}

/** What a settled upgrade operation means — from the body the route answers (its result). */
export function interpretPluginUpgrade(
  pluginId: string,
  result: { httpStatus: number; body: unknown } | undefined,
): PluginUpgradeResult {
  const body = result?.body
  if (isRecord(body) && typeof body.consentToken === 'string' && (body.awaitingConsent === true || body.ready === true)) {
    const permissions = Array.isArray(body.declaredPermissions) ? body.declaredPermissions.filter((p): p is string => typeof p === 'string') : []
    const bins = Array.isArray(body.declaredBins) ? body.declaredBins.filter(isUpgradeBin) : []
    if (body.ready === true) {
      return { awaitingConsent: false, ready: true, permissions, bins, consentToken: body.consentToken, noop: false, message: `Updating ${pluginId}…` }
    }
    return {
      awaitingConsent: true,
      permissions,
      bins,
      consentToken: body.consentToken,
      noop: false,
      message: body.manifestChanged === true
        ? 'This update changed since you previewed it. Review it again.'
        : bins.length > 0 && permissions.length === 0
          ? 'This update downloads binaries.'
          : bins.length > 0
            ? 'This update requests permissions and downloads binaries.'
            : 'This update requests permissions.',
    }
  }
  if (!result || result.httpStatus >= 400 || (isRecord(body) && body.ok === false)) {
    const message = isRecord(body) && typeof body.error === 'string' && body.error.length > 0
      ? body.error
      : `Plugin update failed (${result?.httpStatus ?? 'no result'})`
    throw new Error(message)
  }
  if (!isRecord(body)
    || body.ok !== true
    || typeof body.noop !== 'boolean'
    || !Array.isArray(body.declaredPermissions)
    || !body.declaredPermissions.every((permission) => typeof permission === 'string')) {
    throw new SystemMutationOutcomeUnknownError(
      'The plugin update finished, but Bakin could not confirm the result. Refresh live data before trying again.',
    )
  }
  const noop = body.noop
  return {
    awaitingConsent: false,
    permissions: body.declaredPermissions,
    bins: [],
    noop,
    message: noop
      ? `${pluginId} is already current.`
      : `${pluginId} was updated and reactivated.`,
  }
}
