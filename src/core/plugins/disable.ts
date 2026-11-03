/**
 * Plugin containment (self-healing PR1, re-homing row 98): an installed USER
 * plugin can be disabled — it stays on disk and in the lock ledger, the
 * loader never activates it, Explore and the Health card show it as
 * disabled — and enabled again. The flag is ONE ledger field
 * (`disabled: true`); nothing moves on disk, so it is not a replace
 * transaction, but it IS an install-state write: callers own
 * `install-state` (the routes take it with `holdNow`; a concurrent install
 * answers 409 `install_busy`). Core plugins are never disableable.
 */
import { assertResourceHeld } from '@bakin/core/operations'
import { readPluginLockfile, updatePlugin, writePluginLockfile, isPluginDisabled } from '@bakin/core/plugins/lockfile'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { isCorePlugin } from '../plugin-registry'

const log = createLogger('plugin-disable')

export type PluginEnableRefusal = 'core_plugin' | 'not_installed'

export class PluginEnableRefusedError extends Error {
  constructor(readonly kind: PluginEnableRefusal, message: string) {
    super(message)
    this.name = 'PluginEnableRefusedError'
  }
}

export interface PluginEnabledChange {
  id: string
  disabled: boolean
  /** False when the ledger already said so (idempotent). */
  changed: boolean
}

/** Flip the ledger's `disabled` mark for an installed user plugin. Requires install-state. */
export function setPluginEnabled(pluginId: string, enabled: boolean): PluginEnabledChange {
  assertResourceHeld('install-state', 'setPluginEnabled')
  if (isCorePlugin(pluginId)) {
    throw new PluginEnableRefusedError('core_plugin', `"${pluginId}" is a core plugin — it ships with Bakin and cannot be disabled.`)
  }
  const lock = readPluginLockfile()
  const entry = lock.plugins[pluginId]
  if (!entry) {
    throw new PluginEnableRefusedError('not_installed', `"${pluginId}" is not an installed plugin.`)
  }
  const disabled = !enabled
  if (isPluginDisabled(entry) === disabled) return { id: pluginId, disabled, changed: false }
  const { disabled: _previous, ...rest } = entry
  writePluginLockfile(updatePlugin({ ...lock, plugins: { ...lock.plugins, [pluginId]: rest } }, pluginId, disabled ? { disabled: true } : {}))
  appendAudit(getContentDir(), disabled ? 'plugin.disabled' : 'plugin.enabled', 'system', { pluginId })
  log.info(`Plugin "${pluginId}" ${disabled ? 'disabled' : 'enabled'} in the ledger`)
  return { id: pluginId, disabled, changed: true }
}
