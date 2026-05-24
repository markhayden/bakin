/**
 * Codex auth for the OpenClaw dev rig.
 *
 * The Codex provider plugin (id `codex`) is an app-server harness: it reads
 * ChatGPT credentials from CODEX_HOME/auth.json written by the *Codex CLI's own*
 * browser OAuth. OpenClaw exposes no managed auth method for it — both `models
 * auth login` and `models auth setup-token` report "no provider plugins" because
 * the provider's auth method list is empty (cliSessionKeys: ["codex-cli"]). So we
 * drive the bundled Codex CLI `login` directly.
 *
 * CODEX_HOME lives inside the mounted ~/.openclaw volume so the credentials
 * persist across the throwaway login container AND the long-running gateway reads
 * the same file (its app-server inherits CODEX_HOME from the container env).
 *
 * D3: each fresh instance mints its OWN token via the browser flow; `reset`
 * (which wipes the mounted home, incl. CODEX_HOME) is the only thing that forces
 * re-auth. There is deliberately no backup/restore code here.
 */
import { join } from 'node:path'

import type { RunResult } from './runner'

/** Runs an OpenClaw CLI command (args after `openclaw`) — lifecycle supplies the container exec. */
export type OpenClawExec = (args: string[]) => Promise<RunResult>

/** CODEX_HOME inside the container, kept under the mounted ~/.openclaw volume so auth persists. */
export const CODEX_HOME_CONTAINER = '/home/node/.openclaw/codex'

/** Bundled Codex CLI entrypoint (run via `node`). */
export const CODEX_CLI_ENTRY = '/app/node_modules/@openai/codex/bin/codex.js'

/** The Codex provider's default model id (from the plugin catalog — not fabricated). */
export const CODEX_DEFAULT_MODEL = 'openai/gpt-5.5'

/** Codex CLI args (after `node <CODEX_CLI_ENTRY>`) for the interactive ChatGPT OAuth. */
export function codexLoginArgs(): string[] {
  return ['login']
}

/** Host path to the Codex auth file; its presence means this instance is already authed. */
export function codexAuthFile(openclawHome: string): string {
  return join(openclawHome, 'codex', 'auth.json')
}
