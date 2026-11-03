/**
 * CLI twin of the browser verification (#1007 D7.11): after `bakin update`
 * hands off to the restart, poll this home's server until a new boot
 * serves the expected version, and say so in one line.
 */
import { describeSelfUpdateVerification, verifySelfUpdate, type SelfUpdateVerification } from '@bakin/core/install-core/self-update-verify'
import { serverBaseUrl } from './http'

export interface CliVerifyOptions {
  expectedVersion: string
  oldBootId: string
  log: (line: string) => void
  baseUrl?: string
  fetch?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>
  timeoutMs?: number
  pollMs?: number
}

export async function verifySelfUpdateFromCli(options: CliVerifyOptions): Promise<SelfUpdateVerification> {
  options.log(`Waiting for Bakin ${options.expectedVersion} to come back…`)
  const verification = await verifySelfUpdate({
    expectedVersion: options.expectedVersion,
    oldBootId: options.oldBootId,
    baseUrl: options.baseUrl ?? serverBaseUrl(),
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    timeoutMs: options.timeoutMs,
    pollMs: options.pollMs,
  })
  options.log(describeSelfUpdateVerification(verification))
  return verification
}
