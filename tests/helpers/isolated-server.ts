/**
 * Boot a REAL Bakin server from source in its own process against a
 * throwaway home (the `/verify` recipe, as a helper): temp BAKIN_HOME +
 * PI_HOME, the Pi adapter, a guest search URL (never the machine's antfly
 * service), onboarding gate skipped, file log off. Returns the base URL and
 * a `stop()` that kills by pid and removes the home.
 *
 * Real HTTP must bypass the happy-dom fetch shim the suite preloads, so
 * every request goes through `Bun.fetch`.
 */
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const REPO_ROOT = join(import.meta.dir, '..', '..')

export const realFetch: typeof fetch = (Bun as unknown as { fetch?: typeof fetch }).fetch ?? fetch

export interface IsolatedServerOptions {
  /** Merged into the temp home's settings.json (the guest search URL is always set). */
  settings?: Record<string, unknown>
  /** Extra env for the SERVER process only. */
  env?: Record<string, string | undefined>
  /** Vars to REMOVE from the server env (e.g. DISCORD_BOT_TOKEN inherited from the shell). */
  unsetEnv?: string[]
  bootTimeoutMs?: number
}

export interface IsolatedServer {
  home: string
  port: number
  baseUrl: string
  /** The exact env the server was started with (for spawning CLIs that must differ). */
  env: Record<string, string>
  logs(): Promise<string>
  stop(): Promise<void>
}

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

export async function startIsolatedServer(options: IsolatedServerOptions = {}): Promise<IsolatedServer> {
  const home = join(tmpdir(), `bakin-isolated-${Date.now()}-${randomUUID()}`)
  mkdirSync(join(home, 'pi'), { recursive: true })
  const settings = { search: { settings: { url: 'http://127.0.0.1:39999' } }, runtime: { adapter: 'pi' }, ...(options.settings ?? {}) }
  writeFileSync(join(home, 'settings.json'), JSON.stringify(settings, null, 2))
  const port = await freePort()
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  for (const key of options.unsetEnv ?? []) delete env[key]
  Object.assign(env, {
    BAKIN_HOME: home,
    PI_HOME: join(home, 'pi'),
    BAKIN_RUNTIME_ADAPTER: 'pi',
    BAKIN_SKIP_ONBOARDING_CHECK: '1',
    BAKIN_DISABLE_FILE_LOG: '1',
    BAKIN_CONSOLE_FORMAT: 'json',
    PORT: String(port),
    NODE_ENV: 'test',
  })
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  const proc = Bun.spawn(['bun', 'run', 'server.ts', 'serve'], { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' })
  let exitCode: number | null = null
  void proc.exited.then((code) => { exitCode = code })
  const chunks: string[] = []
  const collect = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value))
    }
  }
  void collect(proc.stdout)
  void collect(proc.stderr)

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + (options.bootTimeoutMs ?? 60_000)
  for (;;) {
    try {
      const res = await realFetch(`${baseUrl}/api/channels`, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) break
    } catch {
      // not up yet
    }
    if (exitCode !== null) throw new Error(`isolated server exited ${exitCode} before boot:\n${chunks.join('').slice(-2000)}`)
    if (Date.now() > deadline) {
      proc.kill()
      throw new Error(`isolated server did not boot within the deadline:\n${chunks.join('').slice(-2000)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return {
    home,
    port,
    baseUrl,
    env,
    logs: async () => chunks.join(''),
    stop: async () => {
      proc.kill('SIGTERM')
      const exited = proc.exited
      const timer = setTimeout(() => proc.kill('SIGKILL'), 5_000)
      await exited.catch(() => {})
      clearTimeout(timer)
      rmSync(home, { recursive: true, force: true })
    },
  }
}

/** Run the source CLI in ITS OWN process with ITS OWN env; returns stdout/stderr/exit. */
export async function runCli(args: string[], env: Record<string, string | undefined>): Promise<{ code: number; stdout: string; stderr: string }> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (value !== undefined) merged[key] = value
  const proc = Bun.spawn(['bun', 'run', 'cli/bakin.ts', ...args], { cwd: REPO_ROOT, env: merged, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code, stdout, stderr }
}
