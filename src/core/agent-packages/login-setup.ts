/**
 * The login `setup` command as the operator can paste it. A pack's setup
 * names its own binary (`gog auth setup …`), but Bakin installs that binary
 * into its bin dir, which only the SERVER's PATH carries (secret-env) — the
 * operator's shell does not, so the command as written answers
 * "command not found". Every surface that shows a setup command (readiness
 * and its remediation lines, the install's login item, the login-check
 * route, the CLI consent) shows it through this one rewrite: each command
 * word that is one of the pack's declared bins becomes that bin's path.
 */
import { homedir } from 'os'
import { join } from 'path'
import type { LoginRequirement, Manifest } from '../../../packages/core/src/agent-packages/manifest'
import { getBakinPaths } from '@/core/content-dir'

/** `~/…` under the operator's home (how they would type it), quoted when the path has a space. */
function shellPath(abs: string): string {
  const home = process.env.HOME || homedir()
  const shown = abs.startsWith(`${home}/`) ? `~/${abs.slice(home.length + 1)}` : abs
  if (!/\s/.test(shown)) return shown
  return shown.startsWith('~/') ? `~/"${shown.slice(2)}"` : `"${shown}"`
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Rewrite each command word naming one of `bins` to its path in `binDir`. Pure. */
export function rewriteSetupCommand(setup: string, bins: readonly string[], binDir: string): string {
  let out = setup
  for (const name of bins) {
    // A command word: at the start, or after a shell separator / `$(`.
    const word = new RegExp(`(^|&&|\\|\\||;|\\||\\$\\(|\\n)(\\s*)${escapeRegExp(name)}(?=\\s|$|;|&|\\|)`, 'g')
    out = out.replace(word, (_match, sep: string, space: string) => `${sep}${space}${shellPath(join(binDir, name))}`)
  }
  return out
}

/** The login entry's setup command, runnable from the operator's shell. */
export function runnableLoginSetup(manifest: Manifest, entry: LoginRequirement): string {
  const bins = manifest.kind === 'skill-pack' ? (manifest.requires?.bins ?? []).map((bin) => bin.name) : []
  return bins.length === 0 ? entry.setup : rewriteSetupCommand(entry.setup, bins, getBakinPaths().bin)
}
