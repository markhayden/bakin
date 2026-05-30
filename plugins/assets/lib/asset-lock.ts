/**
 * Per-asset mutation lock.
 *
 * Manifest mutations (addVersion / promote / delete / relink / retype) are
 * read-modify-write on a single `manifest.json`. Two concurrent mutations on the
 * same asset would race — lost update, duplicate version number. This serializes
 * all mutations for a given `assetId` behind an in-process async mutex.
 *
 * Single-process by design (single user); an in-memory keyed chain suffices.
 * Mutations on DIFFERENT assets still run concurrently.
 */
const tails = new Map<string, Promise<unknown>>()

/** Run `fn` once any prior locked operation on `assetId` has settled. */
export function withAssetLock<T>(assetId: string, fn: () => Promise<T>): Promise<T> {
  const prior = tails.get(assetId) ?? Promise.resolve()
  // Chain regardless of the prior op's success — a failed mutation must not
  // wedge the asset's queue.
  const result = prior.then(() => fn(), () => fn())
  // Tail swallows outcome so the next op chains cleanly off it.
  const tail = result.then(() => {}, () => {})
  tails.set(assetId, tail)
  void tail.finally(() => {
    if (tails.get(assetId) === tail) tails.delete(assetId)
  })
  return result
}
