/**
 * Full-sandbox helpers: OpenClaw + Bakin in one container, with Bakin driven
 * via `docker exec`. Pure argv builders so the lifecycle layer stays testable.
 *
 * The OpenClaw gateway is the container's main process; these exec into the
 * running `sandbox` service. OpenClaw home is the shared mounted home, so the
 * same `mcp set`/`config set`/codex commands apply.
 *
 * Boundary: dev-rig module, exempt from provider-boundary rules.
 */
import type { Source } from './args'

/** Which sandbox-family compose service to exec into. */
export type SandboxService = 'sandbox' | 'sandbox-pi'

function execPrefix(composeFile: string, interactive: boolean, service: SandboxService): string[] {
  return ['docker', 'compose', '-f', composeFile, 'exec', interactive ? '-it' : '-T', service]
}

/** Run an OpenClaw CLI command (args after `openclaw`) inside the sandbox. */
export function sandboxExecArgs(composeFile: string, openclawArgs: string[], interactive: boolean): string[] {
  return [...execPrefix(composeFile, interactive, 'sandbox'), 'node', 'dist/index.js', ...openclawArgs]
}

/**
 * Run a Bakin CLI command inside the sandbox container.
 *   repo      → the mounted checkout via bun (/bakin/cli/bakin.ts)
 *   installed → the bakin binary on PATH (errors at runtime if absent — R3)
 */
export function sandboxBakinArgs(
  composeFile: string,
  source: Source,
  bakinArgs: string[],
  interactive: boolean,
  service: SandboxService = 'sandbox',
): string[] {
  const prefix = execPrefix(composeFile, interactive, service)
  return source === 'repo'
    ? [...prefix, 'bun', 'run', '/bakin/cli/bakin.ts', ...bakinArgs]
    : [...prefix, 'bakin', ...bakinArgs]
}

/** Interactive shell into the sandbox container. */
export function sandboxShellArgs(composeFile: string, service: SandboxService = 'sandbox'): string[] {
  return [...execPrefix(composeFile, true, service), 'sh']
}

/** Non-interactive Bakin onboarding used by --preconfigure. */
export function bakinOnboardArgs(): string[] {
  return ['onboard', '--yes']
}
