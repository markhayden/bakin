import {
  DEFAULT_PLUGIN_UI_FIXTURE,
  PLUGIN_UI_VIEWPORTS,
  createDeterministicIdFactory,
  createDeterministicRandom,
  createPluginUiFixtureFetch,
  installPluginUiFixture,
  normalizePluginUiFixtureRoute,
  type PluginUiFixtureNetworkResponse,
  type PluginUiFixtureViewport,
} from '@makinbakin/sdk/testing/ui'

export type StoryFixtureViewport = PluginUiFixtureViewport
export type StoryFixtureNetworkResponse = PluginUiFixtureNetworkResponse

export interface StoryFixture {
  fixedNow: string
  route: string
  randomSeed: string
  colorScheme: 'dark' | 'light'
  /**
   * `'system'` (the default) gives a human browsing Storybook real motion
   * (their `prefers-reduced-motion` preference wins) while every automated
   * context — the visual harness, the story-test runner, anything driving
   * the page via WebDriver — resolves to frozen motion and stays
   * deterministic. Real motion in the story-test runner proved flaky:
   * overlay plays assert visibility mid-transition and axe scans catch
   * base-ui transition states. Stories that depend on a specific motion
   * state keep pinning an explicit boolean.
   */
  reducedMotion: boolean | 'system'
  network: readonly StoryFixtureNetworkResponse[]
}

export const BAKIN_STORY_VIEWPORTS = PLUGIN_UI_VIEWPORTS

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
  fixedNow: DEFAULT_PLUGIN_UI_FIXTURE.fixedNow,
  route: DEFAULT_PLUGIN_UI_FIXTURE.route,
  fontFamilies: {
    sans: 'Space Grotesk',
    mono: 'JetBrains Mono',
  },
  viewports: BAKIN_STORY_VIEWPORTS,
  colorScheme: DEFAULT_PLUGIN_UI_FIXTURE.colorScheme,
  reducedMotion: 'system',
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

export const normalizeFixtureRoute = normalizePluginUiFixtureRoute
export { createDeterministicIdFactory, createDeterministicRandom }

export function createFixtureFetch(
  responses: readonly StoryFixtureNetworkResponse[],
  baseUrl = new URL('http://storybook.local/'),
): typeof fetch {
  return createPluginUiFixtureFetch(responses, baseUrl)
}

export function installDeterministicBrowserFixture(
  overrides: Partial<StoryFixture> = {},
  target: typeof globalThis = globalThis,
): () => void {
  const fixture: StoryFixture = { ...DEFAULT_STORY_FIXTURE, ...overrides }
  // Resolve 'system' before the fixture shims matchMedia: automation
  // (navigator.webdriver — the visual harness and the story-test runner) is
  // always deterministic reduced motion; a human browsing session follows
  // their real prefers-reduced-motion preference, so spinners actually spin.
  const automated = Boolean((target as { navigator?: { webdriver?: boolean } }).navigator?.webdriver)
  const reducedMotion = fixture.reducedMotion === 'system'
    ? automated || (target.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
    : fixture.reducedMotion
  const cleanup = installPluginUiFixture({
    ...DEFAULT_PLUGIN_UI_FIXTURE,
    ...fixture,
    reducedMotion,
    viewport: 'desktop',
  }, target)
  void target.document?.fonts?.load('400 16px Space Grotesk')
  void target.document?.fonts?.load('400 16px JetBrains Mono')
  return cleanup
}
