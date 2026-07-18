export interface StoryFixtureViewport {
  width: number
  height: number
}

export interface StoryFixtureNetworkResponse {
  method?: string
  path: string
  status: number
  headers?: Record<string, string>
  json?: unknown
  body?: string
}

export interface StoryFixture {
  fixedNow: string
  route: string
  randomSeed: string
  colorScheme: 'dark' | 'light'
  reducedMotion: boolean
  network: readonly StoryFixtureNetworkResponse[]
}

export const BAKIN_STORY_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 320, height: 800 },
} as const satisfies Record<string, StoryFixtureViewport>

export const BAKIN_STORYBOOK_VIEWPORTS = {
  desktop: {
    name: 'Desktop 1440 × 900',
    styles: { width: '1440px', height: '900px' },
    type: 'desktop',
  },
  mobile: {
    name: 'Mobile 320 × 800',
    styles: { width: '320px', height: '800px' },
    type: 'mobile',
  },
} as const

export const STORY_FIXTURE_MANIFEST = {
  schemaVersion: 1,
  generatedBy: 'storybook/fixtures',
  fixedNow: '2026-01-15T12:00:00.000Z',
  route: '/',
  fontFamilies: {
    sans: 'Inter',
    mono: 'JetBrains Mono',
  },
  viewports: BAKIN_STORY_VIEWPORTS,
  colorScheme: 'dark',
  reducedMotion: true,
  network: 'reject-unhandled',
} as const

export const DEFAULT_STORY_FIXTURE: StoryFixture = {
  fixedNow: STORY_FIXTURE_MANIFEST.fixedNow,
  route: STORY_FIXTURE_MANIFEST.route,
  randomSeed: 'bakin-story',
  colorScheme: STORY_FIXTURE_MANIFEST.colorScheme,
  reducedMotion: STORY_FIXTURE_MANIFEST.reducedMotion,
  network: [],
}

export function normalizeFixtureRoute(route: string): string {
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('://')) {
    throw new Error('Story fixture route must be a root-relative application path')
  }
  const parsed = new URL(route, 'http://storybook.local')
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

export function createDeterministicIdFactory(prefix: string): () => string {
  let sequence = 0
  return () => `${prefix}-${String(++sequence).padStart(4, '0')}`
}

function requestParts(input: RequestInfo | URL, init: RequestInit | undefined, baseUrl: URL): { method: string; path: string } {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const inputUrl = request ? request.url : input instanceof URL ? input.href : String(input)
  const url = new URL(inputUrl, baseUrl)
  return {
    method: (init?.method ?? request?.method ?? 'GET').toUpperCase(),
    path: `${url.pathname}${url.search}`,
  }
}

export function createFixtureFetch(
  responses: readonly StoryFixtureNetworkResponse[],
  baseUrl = new URL('http://storybook.local/'),
): typeof fetch {
  const routes = new Map<string, StoryFixtureNetworkResponse>()
  for (const response of responses) {
    const key = `${(response.method ?? 'GET').toUpperCase()} ${response.path}`
    if (routes.has(key)) throw new Error(`Duplicate story fixture response: ${key}`)
    routes.set(key, response)
  }

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = requestParts(input, init, baseUrl)
    const key = `${request.method} ${request.path}`
    const fixture = routes.get(key)
    if (!fixture) throw new Error(`Unhandled story fixture request: ${key}`)
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
    return new NativeDate(...args as [string | number])
  }
  Object.setPrototypeOf(FixedDate, NativeDate)
  FixedDate.prototype = NativeDate.prototype
  Object.defineProperty(FixedDate, 'now', { value: () => fixedNow })
  return FixedDate as DateConstructor
}

export function installDeterministicBrowserFixture(
  overrides: Partial<StoryFixture> = {},
  target: typeof globalThis = globalThis,
): () => void {
  const fixture: StoryFixture = { ...DEFAULT_STORY_FIXTURE, ...overrides }
  const route = normalizeFixtureRoute(fixture.route)
  const fixedNow = new Date(fixture.fixedNow).valueOf()
  if (!Number.isFinite(fixedNow)) throw new Error(`Invalid story fixture date: ${fixture.fixedNow}`)

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
  const cryptoObject = target.crypto
  const ownUuidDescriptor = cryptoObject ? Object.getOwnPropertyDescriptor(cryptoObject, 'randomUUID') : undefined

  target.Date = fixedDateConstructor(NativeDate, fixedNow)
  target.Math.random = createDeterministicRandom(fixture.randomSeed)
  target.fetch = createFixtureFetch(fixture.network, target.location ? new URL(target.location.href) : undefined)
  if (cryptoObject) {
    Object.defineProperty(cryptoObject, 'randomUUID', {
      configurable: true,
      value: deterministicUuidFactory(),
    })
  }
  // Preserve Storybook's iframe URL. The route follows Bakin's shipped
  // path/query taxonomy and is fixture state until the real-host router
  // harness lands in T40; it is deliberately not a second navigation API.
  if (target.history) {
    target.history.replaceState({ ...target.history.state, bakinFixtureRoute: route }, '')
  }
  if (root) {
    root.classList.toggle('dark', fixture.colorScheme === 'dark')
    root.setAttribute('data-bakin-color-scheme', fixture.colorScheme)
    root.setAttribute('data-bakin-reduced-motion', String(fixture.reducedMotion))
    root.setAttribute('data-bakin-fixture-route', route)
  }
  void target.document?.fonts?.load('400 16px Inter')
  void target.document?.fonts?.load('400 16px JetBrains Mono')
  if (nativeMatchMedia) {
    target.matchMedia = ((query: string): MediaQueryList => {
      if (query === '(prefers-reduced-motion: reduce)') return mediaQueryList(query, fixture.reducedMotion)
      if (query === '(prefers-color-scheme: dark)') return mediaQueryList(query, fixture.colorScheme === 'dark')
      if (query === '(prefers-color-scheme: light)') return mediaQueryList(query, fixture.colorScheme === 'light')
      return nativeMatchMedia.call(target, query)
    }) as typeof target.matchMedia
  }

  return () => {
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
      if (originalRootClass === null) root.removeAttribute('class')
      else root.setAttribute('class', originalRootClass)
      if (originalScheme === null) root.removeAttribute('data-bakin-color-scheme')
      else root.setAttribute('data-bakin-color-scheme', originalScheme)
      if (originalMotion === null) root.removeAttribute('data-bakin-reduced-motion')
      else root.setAttribute('data-bakin-reduced-motion', originalMotion)
      if (originalRoute === null) root.removeAttribute('data-bakin-fixture-route')
      else root.setAttribute('data-bakin-fixture-route', originalRoute)
    }
  }
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
