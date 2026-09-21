/**
 * The sharp loader's two raw import legs (#889), isolated so tests can mock
 * them per-case (a `mock.module('sharp', …)` factory evaluates eagerly and
 * cannot model per-test availability, and the repo's devDependency sharp
 * would otherwise satisfy the bundled leg in every test).
 */

/** Bare import — resolves on dev trees/npm installs, fails in compiled binaries. */
export function importBundledSharp(): Promise<unknown> {
  return import('sharp')
}

/** Disk import of the media store's self-contained bundle. */
export function importStoreBundle(entry: string): Promise<unknown> {
  return import(entry)
}
