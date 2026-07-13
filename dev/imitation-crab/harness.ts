import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AppServices } from '@bakin/core/app-services'
import { createMockSearchAdapter } from '@bakin/core/adapters/search/testing'
import { createFileBakinTaskStore } from '@bakin/core/tasks/store'
import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import { getGatewayPort, getMockHome, type MockChatMode, type MockToolMode } from './env'
import { installCliShim } from './cli-shim-install'
import { handleGatewayRequest, handleGatewayRpcRequest, startGateway, type ImitationCrabGateway } from './gateway'
import { seed } from './seed'

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export interface ImitationCrabEnvironmentOptions {
  home?: string
  port?: number
  chatMode?: MockChatMode
  toolMode?: MockToolMode
  forceSeed?: boolean
  cleanupHome?: boolean
}

export interface ImitationCrabEnvironment {
  home: string
  port: number
  gatewayUrl: string
  shimPath: string
  cleanup(): void
  restoreEnv(): void
}

export interface ImitationCrabHarnessOptions extends ImitationCrabEnvironmentOptions {
  startGateway?: boolean
  interceptFetch?: boolean
  /**
   * Forwarded to the adapter's initialize so provisionToolAccess writes the
   * per-agent `bakin-<agent>` MCP entries into the mock home's openclaw.json
   * (the runtime-conformance provisioning pins need a provisionable target).
   */
  bakinMcpBaseUrl?: string
}

export interface ImitationCrabHarness {
  env: ImitationCrabEnvironment
  gateway: ImitationCrabGateway | null
  services: AppServices
  close(): Promise<void>
}

function restoreProcessEnv(original: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key]
  }
  Object.assign(process.env, original)
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) result[key.toLowerCase()] = value
    return result
  }
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = String(value)
  }
  return result
}

function requestBodyToString(body: BodyInit | null | undefined): string {
  if (!body) return ''
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return String(body)
}

function installGatewayFetchInterceptor(gatewayUrl: string): () => void {
  const originalFetch = globalThis.fetch
  const interceptedFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url
    if (!url.startsWith(gatewayUrl)) {
      return originalFetch(input, init)
    }

    const parsedUrl = new URL(url)
    const response = await handleGatewayRequest({
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      url: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: normalizeHeaders(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
      body: requestBodyToString(init?.body),
    })
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  interceptedFetch.preconnect = typeof originalFetch.preconnect === 'function'
    ? originalFetch.preconnect.bind(originalFetch)
    : (() => {})
  globalThis.fetch = interceptedFetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

function installGatewayWebSocketInterceptor(gatewayUrl: string): () => void {
  const originalWebSocket = globalThis.WebSocket
  void gatewayUrl

  class ImitationCrabWebSocket {
    readyState = 0
    private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

    constructor(readonly url: string) {
      queueMicrotask(() => {
        this.readyState = 1
        this.emit('open', {})
        this.emitMessage({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'imitation-crab' },
        })
      })
    }

    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
      const listeners = this.listeners.get(type) ?? new Set()
      listeners.add(listener)
      this.listeners.set(type, listeners)
    }

    removeEventListener(type: string, listener: (event: { data?: string }) => void): void {
      this.listeners.get(type)?.delete(listener)
    }

    send(raw: string): void {
      let frame: { id?: string; method?: string; params?: Record<string, unknown> }
      try {
        frame = JSON.parse(raw)
      } catch {
        return
      }
      const id = typeof frame.id === 'string' ? frame.id : ''
      const method = typeof frame.method === 'string' ? frame.method : ''
      const params = frame.params ?? {}
      handleGatewayRpcRequest(method, params, { requestId: id, push: (pushed) => this.emitMessage(pushed) })
        .then((response) => {
          this.emitMessage({
            type: 'res',
            id,
            ok: response.ok,
            ...(response.ok ? { payload: response.payload } : { error: response.error }),
          })
        })
        .catch((err) => {
          this.emitMessage({
            type: 'res',
            id,
            ok: false,
            error: { message: err instanceof Error ? err.message : String(err) },
          })
        })
    }

    close(): void {
      this.readyState = 3
      this.emit('close', {})
    }

    private emitMessage(frame: Record<string, unknown>): void {
      this.emit('message', { data: JSON.stringify(frame) })
    }

    private emit(type: string, event: { data?: string }): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }

  globalThis.WebSocket = ImitationCrabWebSocket as unknown as typeof WebSocket

  return () => {
    globalThis.WebSocket = originalWebSocket
  }
}

export function prepareImitationCrabEnvironment(options: ImitationCrabEnvironmentOptions = {}): ImitationCrabEnvironment {
  const originalEnv = { ...process.env }
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'bakin-imitation-crab-'))
  const cleanupHome = options.cleanupHome ?? options.home === undefined

  process.env.IMITATION_CRAB_HOME = home
  process.env.OPENCLAW_MOCK_HOME = home
  process.env.BAKIN_HOME = home
  process.env.OPENCLAW_HOME = home
  if (options.port !== undefined) process.env.IMITATION_CRAB_PORT = String(options.port)
  if (options.chatMode) process.env.OPENCLAW_MOCK_CHAT_MODE = options.chatMode
  if (options.toolMode) process.env.OPENCLAW_MOCK_TOOL_MODE = options.toolMode

  const port = getGatewayPort()
  const gatewayUrl = `http://127.0.0.1:${port}`
  seed(options.forceSeed ?? true)
  const shimPath = installCliShim(getMockHome())

  process.env.OPENCLAW_PATH = shimPath
  process.env.OPENCLAW_BASE_URL = gatewayUrl

  return {
    home,
    port,
    gatewayUrl,
    shimPath,
    cleanup: () => {
      if (cleanupHome) rmSync(home, { recursive: true, force: true })
    },
    restoreEnv: () => restoreProcessEnv(originalEnv),
  }
}

export async function createImitationCrabHarness(options: ImitationCrabHarnessOptions = {}): Promise<ImitationCrabHarness> {
  const env = prepareImitationCrabEnvironment(options)
  const gateway = options.startGateway
    ? await startGateway(env.port, { registerSignals: false })
    : null
  const restoreFetch = options.interceptFetch === false
    ? () => {}
    : installGatewayFetchInterceptor(env.gatewayUrl)
  const restoreWebSocket = installGatewayWebSocketInterceptor(env.gatewayUrl)

  const runtime = createOpenClawRuntimeAdapter({
    settings: {
      binaryPath: env.shimPath,
      gatewayUrl: 'http://127.0.0.1',
      gatewayPort: env.port,
    },
  })
  const search = createMockSearchAdapter()
  const tasks = createFileBakinTaskStore(join(env.home, 'tasks'))

  await runtime.initialize({
    contentDir: env.home,
    logger,
    ...(options.bakinMcpBaseUrl ? { bakinMcpBaseUrl: options.bakinMcpBaseUrl } : {}),
  })
  await search.initialize({ contentDir: env.home, logger })

  const services: AppServices = {
    runtime,
    search,
    tasks,
  }

  return {
    env,
    gateway,
    services,
    close: async () => {
      await runtime.shutdown()
      await search.shutdown()
      await gateway?.close()
      restoreWebSocket()
      restoreFetch()
      env.cleanup()
      env.restoreEnv()
    },
  }
}
