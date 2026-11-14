/**
 * A login receipt's reason in words — shared by the login TUI screens and
 * the plain (piped) `bakin packages login-check` lines, so it stays free of
 * Ink.
 */
const LOGIN_REASON_TEXT: Record<string, string> = {
  'never-checked': 'not checked yet',
  stale: 'its inputs changed since the last check',
  exit: 'the check command reported no login',
  'no-match': 'no logged-in account in the check output',
  'account-mismatch': 'the configured account is not logged in',
  timeout: 'the check timed out',
  killed: 'the check was killed',
  'spawn-error': 'the check could not start',
  'binary-missing': 'the binary is not installed',
  'binary-unverifiable': 'the binary does not match its pin',
  'expect-timeout': 'reading the check output timed out',
  'expect-error': 'the check output could not be read',
}

export function loginReasonText(reason: string | undefined): string {
  return reason ? LOGIN_REASON_TEXT[reason] ?? reason : 'not verified'
}
