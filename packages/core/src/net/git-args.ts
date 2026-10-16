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
