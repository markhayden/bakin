/**
 * Runtime fixtures for onboarding scenarios: what a Pi home or an OpenClaw
 * home looks like on disk, built inside a harness home. Nothing here
 * imports app code — the shapes are the on-disk contracts the adapters
 * read, so a fixture that drifts from them fails the baseline scenarios.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { join } from 'path'

import type { OnboardingHome } from './harness'

export type RuntimeAdapterName = 'pi' | 'openclaw'

/** Record a runtime choice the way a previous run would have: in settings. */
export function storeAdapter(home: OnboardingHome, adapter: string): void {
  const settings = home.readSettings()
  const runtime = (settings.runtime ?? {}) as Record<string, unknown>
  home.writeSettings({ ...settings, runtime: { ...runtime, adapter } })
}

export function storedAdapter(home: OnboardingHome): unknown {
  if (!existsSync(home.settingsPath)) return undefined
  const settings = home.readSettings()
  return (settings.runtime as Record<string, unknown> | undefined)?.adapter
}

// ---------------------------------------------------------------------------
// Pi
// ---------------------------------------------------------------------------

export interface PiFixtureOptions {
  /** `true` writes a fake credential; `false` leaves Pi installed but logged out. */
  auth: boolean
  /**
   * `true` also registers a custom provider with one model, so the fake
   * credential has something it can run. Without it the credential exists
   * but no model is runnable.
   */
  runnableModel?: boolean
}

export const PI_FAKE_PROVIDER = 'fakeai'
export const PI_FAKE_MODEL = 'fake-model'

/** A Pi home as the pi CLI leaves it: an agent dir, optionally logged in. */
export function seedPi(home: OnboardingHome, options: PiFixtureOptions): void {
  const agentDir = join(home.piHome, 'agent')
  mkdirSync(agentDir, { recursive: true })
  if (options.auth) {
    // Not a real credential: a made-up provider and key, never sent anywhere.
    writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ [PI_FAKE_PROVIDER]: { type: 'api_key', key: 'not-a-real-key' } }))
  }
  if (options.runnableModel) {
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
      providers: {
        [PI_FAKE_PROVIDER]: {
          name: 'Fake AI (onboarding fixture)',
          // Port 9 (discard): never called by onboarding; refused if it were.
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          apiKey: 'not-a-real-key',
          models: [
            { id: PI_FAKE_MODEL, name: 'Fake Model', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 32000, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } },
          ],
        },
      },
    }))
  }
}

// ---------------------------------------------------------------------------
// OpenClaw
// ---------------------------------------------------------------------------

export interface OpenClawFixtureOptions {
  /**
   * `valid`: one declared orchestrator. `empty`: an explicit registry with
   * no agents. `duplicate`: a legacy list naming the same id twice.
   */
  roster?: 'valid' | 'empty' | 'duplicate'
  /** `up` serves a health endpoint for this home; `down` leaves the port dead. */
  gateway?: 'up' | 'down'
  /** `true` gives the main agent a (fake) provider credential. */
  auth?: boolean
}

export interface OpenClawFixture {
  /** Every invocation of the stand-in `openclaw` command, one line each. */
  cliCalls(): string[]
  /** Paths the gateway stand-in was asked for. */
  gatewayRequests(): string[]
  stop(): Promise<void>
}

export const OPENCLAW_FAKE_PROVIDER = 'fakeai'
export const OPENCLAW_FAKE_MODEL = 'fakeai/fake-model'

function openClawConfig(home: OnboardingHome, roster: NonNullable<OpenClawFixtureOptions['roster']>): Record<string, unknown> {
  const workspace = join(home.openclawHome, 'workspace')
  const model = { primary: OPENCLAW_FAKE_MODEL }
  const defaults = { model, workspace }
  if (roster === 'empty') return { agents: { ownership: 'explicit', defaults, entries: {} } }
  if (roster === 'duplicate') {
    return { agents: { defaults, list: [{ id: 'main', name: 'Main', model }, { id: 'main', name: 'Main again', model }] } }
  }
  return { agents: { ownership: 'explicit', defaults, entries: { main: { identity: { name: 'Main' }, model } } } }
}

/**
 * The stand-in `openclaw` command. It answers exactly the two read-only
 * subcommands the adapter runs during onboarding checks and refuses
 * everything else, so nothing depends on a developer's installed OpenClaw
 * and an unexpected CLI call shows up as a failure, not as a silent no-op.
 */
function writeOpenClawCli(home: OnboardingHome, recordPath: string, auth: boolean): void {
  const models = JSON.stringify({ models: [{ key: OPENCLAW_FAKE_MODEL, name: 'Fake Model', available: auth, input: 'text', contextWindow: 100000 }] })
  const profiles = JSON.stringify({ profiles: auth ? [{ provider: OPENCLAW_FAKE_PROVIDER, type: 'api_key' }] : [] })
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${recordPath}'`,
    'case "$*" in',
    `  "models list"*) printf '%s\\n' '${models}' ;;`,
    `  "models auth list"*) printf '%s\\n' '${profiles}' ;;`,
    '  *) echo "openclaw fixture: unsupported command: $*" >&2; exit 64 ;;',
    'esac',
    '',
  ].join('\n')
  const path = home.env.OPENCLAW_PATH!
  writeFileSync(path, script)
  chmodSync(path, 0o755)
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

/**
 * An OpenClaw home plus its two outside-the-files dependencies: a gateway
 * health endpoint (served from this process, declared to the harness as
 * the scenario's own endpoint) and the CLI stand-in. Does NOT store the
 * adapter choice — call `storeAdapter` for scenarios that need one.
 */
export async function seedOpenClaw(home: OnboardingHome, options: OpenClawFixtureOptions = {}): Promise<OpenClawFixture> {
  const roster = options.roster ?? 'valid'
  const auth = options.auth ?? true
  mkdirSync(join(home.openclawHome, 'workspace'), { recursive: true })
  writeFileSync(join(home.openclawHome, 'openclaw.json'), JSON.stringify(openClawConfig(home, roster), null, 2))
  if (auth) {
    const agentDir = join(home.openclawHome, 'agents', 'main', 'agent')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'auth-profiles.json'), JSON.stringify([{ provider: OPENCLAW_FAKE_PROVIDER, apiKey: 'not-a-real-key', label: 'onboarding fixture' }]))
  }

  const cliRecord = join(home.root, 'harness-record', 'openclaw-cli.log')
  writeOpenClawCli(home, cliRecord, auth)

  const gatewayRequests: string[] = []
  let server: Server | null = null
  if ((options.gateway ?? 'up') === 'up') {
    server = createServer((req, res) => {
      gatewayRequests.push(req.url ?? '')
      if (req.url === '/health' || req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
        return
      }
      res.writeHead(404)
      res.end()
    })
    const port = await listen(server)
    home.allowEndpoint(`127.0.0.1:${port}`)
    const settings = home.readSettings()
    const runtime = (settings.runtime ?? {}) as Record<string, unknown>
    const runtimeSettings = (runtime.settings ?? {}) as Record<string, unknown>
    home.writeSettings({ ...settings, runtime: { ...runtime, settings: { ...runtimeSettings, gatewayPort: port } } })
  }

  return {
    cliCalls: () => existsSync(cliRecord) ? readFileSync(cliRecord, 'utf-8').split('\n').filter(Boolean) : [],
    gatewayRequests: () => [...gatewayRequests],
    stop: async () => {
      if (!server) return
      const live = server
      live.closeAllConnections()
      await new Promise<void>((resolve) => live.close(() => resolve()))
    },
  }
}
