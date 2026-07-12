import { describe, expect, it } from 'bun:test'

import { mergeThrowawaySettings } from '../../../scripts/instance/throwaway-settings'
import { RIG_ANTFLY_PORT, rigAntflySearchUrl } from '../../../scripts/instance/modes'
// Tests are not scanned by the provider-boundary rules — importing the
// adapter's own predicate pins the guest-mode guarantee against drift.
import { isLocalDefaultUrl } from '../../../packages/adapter-antfly/src/service'

describe('mergeThrowawaySettings', () => {
  it('writes adapter + search url into empty settings', () => {
    const out = JSON.parse(mergeThrowawaySettings(null, { runtimeAdapter: 'pi', searchUrl: 'http://127.0.0.1:3838' }))
    expect(out).toEqual({
      runtime: { adapter: 'pi' },
      search: { settings: { url: 'http://127.0.0.1:3838' } },
    })
  })

  it('deep-merges without dropping unknown keys', () => {
    const existing = JSON.stringify({
      dispatch: { paused: true },
      runtime: { adapter: 'openclaw', settings: { retry: { enabled: false } } },
      search: { adapter: 'antfly', settings: { enabled: true, url: 'http://127.0.0.1:3738' } },
    })
    const out = JSON.parse(mergeThrowawaySettings(existing, { runtimeAdapter: 'pi', searchUrl: 'http://127.0.0.1:3838' }))
    expect(out).toEqual({
      dispatch: { paused: true },
      runtime: { adapter: 'pi', settings: { retry: { enabled: false } } },
      search: { adapter: 'antfly', settings: { enabled: true, url: 'http://127.0.0.1:3838' } },
    })
  })

  it('omits the search patch when no url is given', () => {
    const out = JSON.parse(mergeThrowawaySettings(null, { runtimeAdapter: 'openclaw' }))
    expect(out).toEqual({ runtime: { adapter: 'openclaw' } })
  })

  it('recovers from a corrupt existing file by starting from the patch alone', () => {
    const out = JSON.parse(mergeThrowawaySettings('{nope', { runtimeAdapter: 'pi' }))
    expect(out.runtime.adapter).toBe('pi')
  })
})

describe('LaunchAgent clobber guard', () => {
  it('the rig search URL can never take the adapter out of guest mode', () => {
    // detectServiceMode returns 'guest' for any non-default URL BEFORE the
    // launchd/systemd branch — guest never provisions, spawns, or writes the
    // machine-global io.bakin.antfly unit. This is the structural guarantee
    // that the 2026-07-11 plist hijack cannot recur.
    expect(isLocalDefaultUrl(rigAntflySearchUrl())).toBe(false)
    expect(isLocalDefaultUrl(`http://127.0.0.1:${RIG_ANTFLY_PORT}`)).toBe(false)
    // Sanity: the guard actually discriminates (default IS local-managed).
    expect(isLocalDefaultUrl('http://127.0.0.1:3738')).toBe(true)
  })
})
