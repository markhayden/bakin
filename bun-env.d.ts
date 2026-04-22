/**
 * Minimal type declarations for Bun built-in modules Bakin uses.
 *
 * We avoid importing the full `bun-types` (or `@types/bun`) package because
 * it globally augments `typeof fetch` with Bun-specific methods
 * (`preconnect`, `preload`, etc.) which breaks our Vitest mock assertions
 * that assert `MockInstance<...> as typeof fetch`.
 *
 * Declare only the Bun module surfaces we actually use here. When a new
 * Bun module gets adopted (e.g. `bun:jsc`, `bun:test`), add its module
 * declaration to this file rather than pulling in bun-types wholesale.
 */

declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string, options?: { readonly?: boolean; create?: boolean })
    prepare<Row = unknown, Params = unknown[]>(sql: string): Statement<Row, Params>
    exec(sql: string): void
    transaction<F extends (...args: unknown[]) => unknown>(fn: F): F
    close(): void
  }

  export interface Statement<Row = unknown, Params = unknown[]> {
    get(...params: Params extends unknown[] ? Params : never[]): Row | undefined
    all(...params: Params extends unknown[] ? Params : never[]): Row[]
    run(...params: Params extends unknown[] ? Params : never[]): { changes: number; lastInsertRowid: number | bigint }
    finalize(): void
  }
}

/**
 * Minimal global `Bun` typing for build scripts (`packages/host/build.ts`,
 * per-plugin builders in Phase E). Covers only `Bun.build()`. If we reach
 * for more Bun globals, extend here rather than pulling in the full
 * `bun-types` package.
 */
declare namespace Bun {
  interface BuildConfig {
    entrypoints: string[]
    outdir?: string
    target?: 'browser' | 'bun' | 'node'
    format?: 'esm' | 'cjs' | 'iife'
    naming?: string | { entry?: string; chunk?: string; asset?: string }
    sourcemap?: 'none' | 'inline' | 'external' | 'linked' | boolean
    external?: string[]
    minify?: boolean | { whitespace?: boolean; identifiers?: boolean; syntax?: boolean }
    splitting?: boolean
    publicPath?: string
    define?: Record<string, string>
    loader?: Record<string, 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'toml' | 'text' | 'file' | 'napi' | 'wasm'>
  }

  interface BuildResult {
    success: boolean
    outputs: Array<{ path: string; kind: string; hash?: string; sourcemap?: { path: string } | null }>
    logs: unknown[]
  }

  function build(config: BuildConfig): Promise<BuildResult>

  interface Subprocess {
    readonly exited: Promise<number>
    readonly stdout: ReadableStream<Uint8Array>
    readonly stderr: ReadableStream<Uint8Array>
    readonly stdin: WritableStream<Uint8Array> | null
    readonly pid: number
    kill(signal?: number | string): void
  }

  interface SpawnOptions {
    stdin?: 'inherit' | 'pipe' | 'ignore'
    stdout?: 'inherit' | 'pipe' | 'ignore'
    stderr?: 'inherit' | 'pipe' | 'ignore'
    cwd?: string
    env?: Record<string, string | undefined>
  }

  function spawn(cmd: string[], options?: SpawnOptions): Subprocess

  function resolveSync(specifier: string, from: string): string
}
