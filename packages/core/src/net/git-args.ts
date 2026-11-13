/**
 * Git must finish before it returns. Bakin runs git inside directories it
 * will rename or delete moments later — plugin clones under the replace
 * transaction, agent-package staging dirs, the github source cache — and
 * git's own housekeeping does not respect that: after a fetch, merge or
 * checkout it may start `gc --auto`, which DETACHES by default and keeps
 * writing `.git/objects` after the foreground command exited. A rollback
 * that deleted the directory and renamed the backup into its place then
 * failed `ENOTEMPTY`, replacing the real error (#978, seen on CI).
 *
 * Every git Bakin spawns goes through `gitArgs`: automatic gc and background
 * maintenance are off for that invocation. Repositories Bakin manages are
 * small clones — they never need packing.
 */
export const GIT_FOREGROUND_ARGS: readonly string[] = [
  '-c', 'gc.auto=0',
  '-c', 'gc.autoDetach=false',
  '-c', 'maintenance.auto=false',
]

/** `git <args>` with the foreground-only config in front — `-c` options precede the subcommand (and any `-C <dir>`). */
export function gitArgs(args: readonly string[]): string[] {
  return [...GIT_FOREGROUND_ARGS, ...args]
}

/**
 * What git said went wrong, for a person: its own `fatal:` / `error:` lines
 * without the prefix, joined. A failed clone's stderr leads with progress
 * ("Cloning into '/var/folders/…/tmp-uuid'...") and may carry `remote:`
 * chatter; printed whole it buried the one sentence that mattered under a
 * temp path. With no such line, the last line git wrote; with nothing at
 * all, `fallback`. This formats — it never decides what KIND of failure it
 * was.
 */
export function gitFailureMessage(stderr: string, fallback: string): string {
  const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean)
  const said = lines.filter((line) => /^(fatal|error): /.test(line)).map((line) => line.replace(/^(fatal|error): /, ''))
  if (said.length > 0) return said.join('; ')
  return lines.at(-1) ?? fallback
}
