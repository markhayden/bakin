/**
 * Compile-and-run regression for the import-map vendor set (#948, P14).
 *
 * On a checkout the static handler can serve `/vendor/*` from disk, so a
 * vendor bundle missing from the tracked embedded-assets manifest
 * (`packages/host/src/api/_embedded-assets-static.ts`) only shows up in the
 * compiled binary — as a 404 behind an import-map entry, which breaks every
 * plugin at module load. This compiles the REAL server, runs it from a cwd
 * with no source tree against a throwaway home, and asserts the zod vendor
 * bundle and the import map that names it come out of the binary itself.
 *
 * The runtime is pinned to Pi inside the throwaway home (PI_HOME + a
 * throwaway OPENCLAW_HOME) with dispatch paused and a guest search URL, so
 * the boot provisions nothing and sends nothing outside its temp dir — the
 * 2026-10-20 verify-boot incident is the reason every one of those is set.
 *
 * No content-dir mocks needed: the binary is a SEPARATE process with
 * BAKIN_HOME pointed at a temp dir; this test file never imports
 * server-reachable code. Real HTTP goes through Bun.fetch (the happy-dom
 * preload replaces global fetch).
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const EMBEDDED_MANIFEST = join(REPO_ROOT, 'packages/host/src/api/_embedded-assets-static.ts')
const testDir = join(tmpdir(), `bakin-test-compiled-vendor-${Date.now()}-${Math.random().toString(16).slice(2)}`)
mkdirSync(testDir, { recursive: true })

const realFetch: typeof fetch = (Bun as unknown as { fetch?: typeof fetch }).fetch ?? fetch

/** Mirrors scripts/build-binary.ts: the compile externals the shipped binary carries. */
const COMPILE_EXTERNALS = ['playwright', 'playwright-core', 'chromium-bidi', 'sharp']

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/** The tracked manifest must name every file the checkout has built, or the compile embeds a stale set. */
function assertManifestCurrent(): string {
  const manifest = readFileSync(EMBEDDED_MANIFEST, 'utf-8')
  const refs = [...manifest.matchAll(/from '([^']+)' with \{ type: 'file' \}/g)].map((m) => m[1]!)
  const missing = refs.filter((rel) => !existsSync(join(REPO_ROOT, 'packages/host/src/api', rel)))
  if (missing.length > 0) {
    throw new Error(`embedded manifest is stale — ${missing.length} entries missing on disk (${missing.slice(0, 3).join(', ')}). Run: bun run build:host && bun run build:plugins && bun run build:assets-manifest`)
  }
  return manifest
}

async function compileServer(): Promise<string> {
  const outfile = join(testDir, 'bakin-bin')
  const proc = Bun.spawn([
    'bun', 'build', '--compile', `--outfile=${outfile}`,
    ...COMPILE_EXTERNALS.flatMap((pkg) => ['--external', pkg]),
    join(REPO_ROOT, 'server.ts'),
  ], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`bun build --compile failed (exit ${code}): ${err.slice(-1500)}`)
  return outfile
}

interface BootedBinary { baseUrl: string; stop(): Promise<string> }

async function bootBinary(binary: string): Promise<BootedBinary> {
  const home = join(testDir, 'home')
  const cwd = join(testDir, 'empty-cwd')
  mkdirSync(join(home, 'pi'), { recursive: true })
  mkdirSync(cwd, { recursive: true })
  writeFileSync(join(home, 'settings.json'), JSON.stringify({
    search: { settings: { url: 'http://127.0.0.1:39999' } },
    runtime: { adapter: 'pi' },
    dispatch: { paused: true },
  }))
  const port = await freePort()
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  Object.assign(env, {
    BAKIN_HOME: home,
    PI_HOME: join(home, 'pi'),
    OPENCLAW_HOME: join(home, 'openclaw'),
    BAKIN_RUNTIME_ADAPTER: 'pi',
    BAKIN_SKIP_ONBOARDING_CHECK: '1',
    BAKIN_DISABLE_FILE_LOG: '1',
    BAKIN_CONSOLE_FORMAT: 'json',
    PORT: String(port),
    BAKIN_URL: `http://127.0.0.1:${port}`,
    NODE_ENV: 'test',
  })
  const proc = Bun.spawn([binary, 'serve'], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const chunks: string[] = []
  const drain = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
    if (!stream) return
    for await (const chunk of stream) chunks.push(new TextDecoder().decode(chunk))
  }
  void drain(proc.stdout)
  void drain(proc.stderr)
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 60_000
  let exited: number | null = null
  void proc.exited.then((code) => { exited = code })
  for (;;) {
    if (exited !== null) throw new Error(`binary exited ${exited} before boot:\n${chunks.join('').slice(-2000)}`)
    try {
      const res = await realFetch(`${baseUrl}/api/plugins/manifest`)
      if (res.status === 200) break
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      proc.kill()
      throw new Error(`binary did not boot within 60s:\n${chunks.join('').slice(-2000)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return {
    baseUrl,
    async stop() {
      proc.kill()
      await proc.exited
      return chunks.join('')
    },
  }
}

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('compiled vendor assets', () => {
  it('the compiled binary serves the zod vendor bundle and an import map that names it, from a cwd without the source tree', async () => {
    const manifest = assertManifestCurrent()
    // The manifest is what the compile embeds: a vendor bundle absent here is
    // absent from every shipped binary, whatever the checkout serves.
    expect(manifest).toContain("vendor/zod.js")

    const binary = await compileServer()
    const booted = await bootBinary(binary)
    try {
      const zod = await realFetch(`${booted.baseUrl}/vendor/zod.js`)
      expect(zod.status).toBe(200)
      expect(zod.headers.get('content-type') ?? '').toMatch(/javascript/)
      const zodSource = await zod.text()
      expect(zodSource).toContain('_zod.def')

      const shell = await realFetch(`${booted.baseUrl}/`)
      expect(shell.status).toBe(200)
      const html = await shell.text()
      const map = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)
      expect(map).not.toBeNull()
      const imports = (JSON.parse(map![1]!) as { imports: Record<string, string> }).imports
      // Stamped with the cache-busting version token in production builds.
      expect(imports['zod']).toMatch(/^\/vendor\/zod\.js(\?v=.+)?$/)
      // Every mapped vendor file resolves out of the binary — one dead entry breaks every plugin.
      for (const target of new Set(Object.values(imports))) {
        const res = await realFetch(`${booted.baseUrl}${target}`)
        expect({ target, status: res.status }).toEqual({ target, status: 200 })
      }

      // Control: nothing is served from disk — an unknown vendor path is a 404, not a checkout file.
      const missing = await realFetch(`${booted.baseUrl}/vendor/not-a-bundle.js`)
      expect(missing.status).toBe(404)
    } finally {
      await booted.stop()
    }
  }, 240_000)
})
