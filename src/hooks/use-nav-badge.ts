'use client'

import { useEffect } from 'react'
import type { NavBadge } from '@makinbakin/sdk/types'
import { setNavBadge } from '../../packages/sdk/src/register'

/**
 * Sync a nav item's badge to the value passed each render. Calls
 * `setNavBadge(pluginId, navItemId, badge)` only when the badge's value
 * actually changes — the effect is keyed on a serialization of `count` +
 * `tone`, not the object identity (which a parent recreates every render).
 *
 * This is the recommended glue for a badge provider: keep your own summary
 * hook (fetch + refresh) per plugin, derive a `NavBadge | null`, and pass it
 * here. Teardown is handled by `unregisterPlugin`, so this does not clear on
 * unmount (which would flicker on dev hot-reload).
 */
export function useNavBadge(pluginId: string, navItemId: string, badge: NavBadge | null): void {
  // `key` captures the badge's value; `badge` itself is intentionally not a
  // dep — its object identity changes every render, but the effect should
  // only re-run (and re-call setNavBadge) when count/tone actually change.
  const key = badge ? `${badge.count ?? ''}:${badge.tone ?? ''}` : 'null'
  useEffect(() => {
    setNavBadge(pluginId, navItemId, badge)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: keyed on `key`, not `badge` identity (see above)
  }, [pluginId, navItemId, key])
}
