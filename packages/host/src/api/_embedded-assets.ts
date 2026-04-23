/**
 * Runtime facade for the embedded-assets map.
 *
 * The heavy lifting lives in `_embedded-assets-static.ts` which contains
 * the generated `with { type: 'file' }` imports. That file is pulled
 * into the module graph only by server.ts so `bun build --compile` can
 * trace and embed the referenced bytes.
 *
 * Test modules import THIS file instead of the static one, so they
 * never see the file-typed imports that vite's define plugin doesn't
 * understand. In tests, EMBEDDED_ASSETS is simply an empty map and the
 * handlers fall back to disk.
 *
 * server.ts calls `setEmbeddedAssets(STATIC_MAP)` at boot to populate
 * the map from the generated static module.
 */

let internal: ReadonlyMap<string, string> = new Map()

export const EMBEDDED_ASSETS: {
  get(key: string): string | undefined
  has(key: string): boolean
  readonly size: number
} = {
  get: (key: string) => internal.get(key),
  has: (key: string) => internal.has(key),
  get size() { return internal.size },
}

export function setEmbeddedAssets(map: ReadonlyMap<string, string>): void {
  internal = map
}
