/**
 * Typed agent-package errors — the discriminants the REST dispatchers map to
 * HTTP statuses via `instanceof` (CLAUDE.md bans classifying errors by
 * message text). MigrationRequiredError stays in sync.ts (it carries sync
 * flow context); these two are the shared not-installed / dependents cases.
 */

/** The lockfile has no entry for the package (→ 404 on REST surfaces). */
export class PackageNotInstalledError extends Error {
  constructor(public readonly packageId: string) {
    super(`Package "${packageId}" is not installed.`)
    this.name = 'PackageNotInstalledError'
  }
}

/** Removal refused: other installed packages still depend on it (→ 409). */
export class PackageStillRequiredError extends Error {
  constructor(
    public readonly packageId: string,
    public readonly dependents: readonly string[],
  ) {
    super(
      `Refusing to remove "${packageId}" — still required by [${dependents.join(', ')}]. ` +
        `Remove the dependents first, or pass --force.`,
    )
    this.name = 'PackageStillRequiredError'
  }
}
