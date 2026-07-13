import { describe, expect, it } from 'bun:test'

import {
  resolveRequestActivityClass,
  type ActivityRouteMetadata,
} from '../../src/core/rest-activity-class'
import { coreRoutes } from '../../packages/host/src/core-routes'

function classify(
  pathname: string,
  method = 'GET',
  routes: readonly ActivityRouteMetadata[] = [],
) {
  return resolveRequestActivityClass(method, pathname, () => routes)
}

describe('REST activity classification', () => {
  it('marks only actual host status endpoints as routine', () => {
    expect(classify('/api/agents/health')).toBe('routine')
    expect(classify('/api/update/status')).toBe('routine')
    expect(classify('/api/dispatch')).toBe('routine')
    expect(classify('/api/plugins/manifest')).toBe('routine')
    expect(classify('/api/agents/pixel')).toBe('routine')
    expect(classify('/api/agents/pixel/status')).toBe('routine')

    expect(classify('/api/agents/avatar')).toBe('user')
    expect(classify('/api/agents/settings')).toBe('user')
    expect(classify('/api/agents/pixel', 'POST')).toBe('user')
    expect(classify('/api/dispatch', 'POST')).toBe('user')
  })

  it('uses exact plugin route metadata before an earlier parameter route', () => {
    const routes: ActivityRouteMetadata[] = [
      { path: '/:agentId', method: 'GET', activityClass: 'routine' },
      { path: '/settings', method: 'GET', activityClass: 'user' },
    ]

    expect(classify('/api/plugins/team/settings', 'GET', routes)).toBe('user')
    expect(classify('/api/plugins/team/pixel', 'GET', routes)).toBe('routine')
  })

  it('does not borrow parameter metadata when the winning exact route omits it', () => {
    const routes: ActivityRouteMetadata[] = [
      { path: '/:brandId', method: 'GET', activityClass: 'routine' },
      { path: '/blocked-tasks', method: 'GET' },
    ]

    expect(classify('/api/plugins/brands/blocked-tasks', 'GET', routes)).toBe('user')
  })

  it('honors system metadata and otherwise uses the explicit request-boundary default', () => {
    const routes: ActivityRouteMetadata[] = [
      { path: '/reconcile', method: 'POST', activityClass: 'system' },
    ]

    expect(classify('/api/plugins/assets/reconcile', 'POST', routes)).toBe('system')
    expect(classify('/api/tasks')).toBe('user')
  })

  it('publishes routine metadata on host-owned cadence route declarations', () => {
    for (const path of [
      '/api/agents/health',
      '/api/agents/:id',
      '/api/agents/:id/status',
      '/api/dispatch',
      '/api/plugins/manifest',
      '/api/update/status',
    ]) {
      const route = coreRoutes.find((candidate) => (
        candidate.method === 'GET' && candidate.path === path
      ))
      expect(route?.activityClass).toBe('routine')
    }
  })
})
