/**
 * Codex OAuth for the OpenClaw dev rig.
 *
 * D3: each fresh instance mints its OWN token via an interactive browser OAuth
 * flow. The token is never copied to the repo, never backed up, never reused
 * across homes — `reset` (which wipes the mounted home) is the only thing that
 * forces re-auth. There is deliberately no backup/restore code here.
 *
 * Verbs confirmed against the live image (tasks/probe-findings.md):
 *   models auth list            → detect an existing profile
 *   models auth login --provider openai-codex --set-default
 */
import type { RunResult } from './runner'

/** Runs an OpenClaw CLI command (args after `openclaw`) — lifecycle supplies the container exec. */
export type OpenClawExec = (args: string[], opts?: { interactive?: boolean }) => Promise<RunResult>

export function codexLoginArgs(): string[] {
  // --set-default applies the provider's recommended model, so we never
  // hardcode a model id (avoids fabricating model metadata).
  return ['models', 'auth', 'login', '--provider', 'openai-codex', '--set-default']
}

export function hasCodexProfile(authListStdout: string): boolean {
  return /openai-codex/.test(authListStdout)
}

/**
 * Ensure the mounted home has a Codex profile. If absent, run the interactive
 * browser OAuth flow (stdio inherited). Returns whether auth already existed.
 */
export async function ensureCodexAuth(exec: OpenClawExec): Promise<{ alreadyAuthed: boolean }> {
  const list = await exec(['models', 'auth', 'list'])
  if (list.code === 0 && hasCodexProfile(list.stdout)) {
    return { alreadyAuthed: true }
  }

  const login = await exec(codexLoginArgs(), { interactive: true })
  if (login.code !== 0) {
    throw new Error(
      `Codex OAuth login failed (exit ${login.code}): ${login.stderr.trim() || 'no output'}. `
        + `Re-run \`instance up\` to retry the browser flow.`,
    )
  }
  return { alreadyAuthed: false }
}
