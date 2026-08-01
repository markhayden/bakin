/** Exact browser dimensions paired with one named fixture viewport. */
export interface PluginUiFixtureViewport {
  /** CSS viewport width in pixels. */
  width: number
  /** CSS viewport height in pixels. */
  height: number
}

/** Supported deterministic viewport profiles. */
export type PluginUiFixtureViewportName = keyof typeof PLUGIN_UI_VIEWPORTS

/** One exact response served by the fixture-owned fetch implementation. */
export interface PluginUiFixtureNetworkResponse {
  /** HTTP method. Defaults to `GET`. */
  method?: string
  /** Root-relative pathname plus optional query string matched exactly. */
  path: string
  /** HTTP response status. */
  status: number
  /** Additional response headers. */
  headers?: Record<string, string>
  /** JSON payload; sets the JSON content type and takes precedence over `body`. */
  json?: unknown
  /** Raw response body used when `json` is omitted. */
  body?: string
}

/** Complete deterministic browser environment consumed by the fixture host. */
export interface PluginUiRuntimeFixture {
  /** ISO date returned by zero-argument `Date` construction and `Date.now()`. */
  fixedNow: string
  /** Root-relative initial path, query string, and optional hash. */
  route: string
  /** Stable seed used for `Math.random()`. */
  randomSeed: string
  /** Color preference exposed to the document and `matchMedia`. */
  colorScheme: 'dark' | 'light'
  /** Reduced-motion preference exposed to the document and `matchMedia`. */
  reducedMotion: boolean
  /** Named viewport intent; the browser runner applies its actual dimensions. */
  viewport: PluginUiFixtureViewportName
  /** Complete network allowlist. Unlisted requests throw. */
  network: readonly PluginUiFixtureNetworkResponse[]
}

/** Canonical desktop and minimum-supported mobile dimensions for plugin UI tests. */
export const PLUGIN_UI_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 320, height: 800 },
} as const satisfies Record<string, PluginUiFixtureViewport>

/** Stable zero-user-state defaults for a plugin UI browser fixture. */
export const DEFAULT_PLUGIN_UI_FIXTURE: PluginUiRuntimeFixture = {
  fixedNow: '2026-01-15T12:00:00.000Z',
  route: '/',
  randomSeed: 'bakin-plugin-ui',
  colorScheme: 'dark',
  reducedMotion: true,
  viewport: 'desktop',
  network: [],
}

/** Validate and normalize a fixture's root-relative application route. */
export function normalizePluginUiFixtureRoute(route: string): string {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('://')) {
    throw new Error('Plugin UI fixture route must be a root-relative application path')
  }
  const parsed = new URL(route, 'http://plugin-ui-fixture.local')
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Create a repeatable pseudo-random sequence from a stable string seed. */
export function createDeterministicRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x6d2b79f5
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Create repeatable, monotonically increasing fixture identifiers. */
export function createDeterministicIdFactory(prefix: string): () => string {
  let sequence = 0
  return () => `${prefix}-${String(++sequence).padStart(4, '0')}`
}

function requestParts(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  baseUrl: URL,
): { method: string; path: string } {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const inputUrl = request ? request.url : input instanceof URL ? input.href : String(input)
  const url = new URL(inputUrl, baseUrl)
  return {
    method: (init?.method ?? request?.method ?? 'GET').toUpperCase(),
    path: `${url.pathname}${url.search}`,
  }
}

/**
 * Build a fetch replacement that serves only explicitly declared responses.
 * Any unhandled method/path pair rejects with an author-facing fixture error.
 */
export function createPluginUiFixtureFetch(
  responses: readonly PluginUiFixtureNetworkResponse[],
  baseUrl = new URL('http://plugin-ui-fixture.local/'),
): typeof fetch {
  const routes = new Map<string, PluginUiFixtureNetworkResponse>()
  for (const response of responses) {
    const key = `${(response.method ?? 'GET').toUpperCase()} ${response.path}`
    if (routes.has(key)) throw new Error(`Duplicate plugin UI fixture response: ${key}`)
    routes.set(key, response)
  }

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = requestParts(input, init, baseUrl)
    const key = `${request.method} ${request.path}`
    const fixture = routes.get(key)
    if (!fixture) throw new Error(`Unhandled plugin UI fixture request: ${key}`)
    const headers = new Headers(fixture.headers)
    let body: BodyInit | null = fixture.body ?? null
    if (fixture.json !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(fixture.json)
    }
    if (fixture.status === 204 || fixture.status === 205 || fixture.status === 304) body = null
    return new Response(body, { status: fixture.status, headers })
  }) as typeof fetch
}

function deterministicUuidFactory(): () => `${string}-${string}-${string}-${string}-${string}` {
  let sequence = 0
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
}

function fixedDateConstructor(NativeDate: DateConstructor, fixedNow: number): DateConstructor {
  function FixedDate(this: unknown, ...args: unknown[]): string | Date {
    if (!new.target) return new NativeDate(fixedNow).toString()
    if (args.length === 0) return new NativeDate(fixedNow)
    return Reflect.construct(NativeDate, args, new.target) as Date
  }
  Object.setPrototypeOf(FixedDate, NativeDate)
  FixedDate.prototype = NativeDate.prototype
  Object.defineProperty(FixedDate, 'now', { value: () => fixedNow })
  return FixedDate as DateConstructor
}

/**
 * Install deterministic browser globals and return an idempotent restoration
 * function. Use one active fixture host per browser document.
 */
export function installPluginUiFixture(
  overrides: Partial<PluginUiRuntimeFixture> = {},
  target: typeof globalThis = globalThis,
): () => void {
  const fixture: PluginUiRuntimeFixture = { ...DEFAULT_PLUGIN_UI_FIXTURE, ...overrides }
  const route = normalizePluginUiFixtureRoute(fixture.route)
  const fixedNow = new Date(fixture.fixedNow).valueOf()
  if (!Number.isFinite(fixedNow)) throw new Error(`Invalid plugin UI fixture date: ${fixture.fixedNow}`)

  const NativeDate = target.Date
  const nativeRandom = target.Math.random
  const nativeFetch = target.fetch
  const nativeMatchMedia = target.matchMedia
  const originalHistoryState = target.history?.state
  const root = target.document?.documentElement ?? null
  const originalRootClass = root?.getAttribute('class')
  const originalScheme = root?.getAttribute('data-bakin-color-scheme')
  const originalMotion = root?.getAttribute('data-bakin-reduced-motion')
  const originalRoute = root?.getAttribute('data-bakin-fixture-route')
  const originalViewport = root?.getAttribute('data-bakin-fixture-viewport')
  const cryptoObject = target.crypto
  const ownUuidDescriptor = cryptoObject
    ? Object.getOwnPropertyDescriptor(cryptoObject, 'randomUUID')
    : undefined

  target.Date = fixedDateConstructor(NativeDate, fixedNow)
  target.Math.random = createDeterministicRandom(fixture.randomSeed)
  target.fetch = createPluginUiFixtureFetch(
    fixture.network,
    target.location ? new URL(target.location.href) : undefined,
  )
  if (cryptoObject) {
    Object.defineProperty(cryptoObject, 'randomUUID', {
      configurable: true,
      value: deterministicUuidFactory(),
    })
  }
  if (target.history) {
    target.history.replaceState({ ...target.history.state, bakinFixtureRoute: route }, '')
  }
  if (root) {
    root.classList.toggle('dark', fixture.colorScheme === 'dark')
    root.setAttribute('data-bakin-color-scheme', fixture.colorScheme)
    root.setAttribute('data-bakin-reduced-motion', String(fixture.reducedMotion))
    root.setAttribute('data-bakin-fixture-route', route)
    root.setAttribute('data-bakin-fixture-viewport', fixture.viewport)
  }
  if (nativeMatchMedia) {
    target.matchMedia = ((query: string): MediaQueryList => {
      if (query === '(prefers-reduced-motion: reduce)') {
        return mediaQueryList(query, fixture.reducedMotion)
      }
      if (query === '(prefers-color-scheme: dark)') {
        return mediaQueryList(query, fixture.colorScheme === 'dark')
      }
      if (query === '(prefers-color-scheme: light)') {
        return mediaQueryList(query, fixture.colorScheme === 'light')
      }
      return nativeMatchMedia.call(target, query)
    }) as typeof target.matchMedia
  }

  let restored = false
  return () => {
    if (restored) return
    restored = true
    target.Date = NativeDate
    target.Math.random = nativeRandom
    target.fetch = nativeFetch
    if (nativeMatchMedia) target.matchMedia = nativeMatchMedia
    if (cryptoObject) {
      if (ownUuidDescriptor) Object.defineProperty(cryptoObject, 'randomUUID', ownUuidDescriptor)
      else Reflect.deleteProperty(cryptoObject, 'randomUUID')
    }
    if (target.history) target.history.replaceState(originalHistoryState, '')
    if (root) {
      restoreAttribute(root, 'class', originalRootClass)
      restoreAttribute(root, 'data-bakin-color-scheme', originalScheme)
      restoreAttribute(root, 'data-bakin-reduced-motion', originalMotion)
      restoreAttribute(root, 'data-bakin-fixture-route', originalRoute)
      restoreAttribute(root, 'data-bakin-fixture-viewport', originalViewport)
    }
  }
}

function restoreAttribute(element: Element, name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

function mediaQueryList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }
}
