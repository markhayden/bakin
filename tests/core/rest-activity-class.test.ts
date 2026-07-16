import { describe, expect, it } from 'bun:test'

import {
  resolveRequestActivity,
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

function resolve(
  pathname: string,
  method = 'GET',
  routes: readonly ActivityRouteMetadata[] = [],
) {
  return resolveRequestActivity(method, pathname, () => routes)
}

describe('REST activity classification', () => {
  it('marks host monitoring and shell snapshot reads as routine', () => {
    expect(classify('/api/agents/health')).toBe('routine')
    expect(classify('/api/update/status')).toBe('routine')
    expect(classify('/api/dispatch')).toBe('routine')
    expect(classify('/api/plugins/manifest')).toBe('routine')
    expect(classify('/api/agents/pixel')).toBe('routine')
    expect(classify('/api/agents/pixel/status')).toBe('routine')
    expect(classify('/api/activity')).toBe('routine')
    expect(classify('/api/context-report')).toBe('routine')
    expect(classify('/api/settings')).toBe('routine')
    expect(classify('/api/state')).toBe('routine')
    expect(classify('/api/version')).toBe('routine')
    expect(classify('/api/agent-packages')).toBe('routine')
    expect(classify('/api/plugins/health/assets/client.js')).toBe('routine')
    expect(classify('/api/plugin-settings/chat')).toBe('routine')

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
    expect(resolve('/api/plugins/team/settings', 'GET', routes).routePattern).toBe('/api/plugins/team/settings')
    expect(resolve('/api/plugins/team/pixel', 'GET', routes).routePattern).toBe('/api/plugins/team/:agentId')
  })

  it('resolves declared parameter routes to stable plugin route patterns', () => {
    const routes: ActivityRouteMetadata[] = [
      { path: '/', method: 'GET' },
      { path: '/summary', method: 'GET' },
      { path: '/:taskId', method: 'GET' },
      { path: '/:taskId/runs', method: 'GET' },
    ]

    expect(resolve('/api/plugins/tasks', 'GET', routes).routePattern).toBe('/api/plugins/tasks')
    expect(resolve('/api/plugins/tasks/task-a', 'GET', routes).routePattern).toBe('/api/plugins/tasks/:taskId')
    expect(resolve('/api/plugins/tasks/task-b', 'GET', routes).routePattern).toBe('/api/plugins/tasks/:taskId')
    expect(resolve('/api/plugins/tasks/task-a/runs', 'GET', routes).routePattern).toBe('/api/plugins/tasks/:taskId/runs')
    expect(resolve('/api/plugins/tasks/summary', 'GET', routes).routePattern).toBe('/api/plugins/tasks/summary')
  })

  it('omits route patterns for unknown paths and method mismatches', () => {
    const routes: ActivityRouteMetadata[] = [
      { path: '/chats/:chatId', method: 'GET' },
    ]

    expect(resolve('/api/plugins/chat/not-declared', 'GET', routes).routePattern).toBeUndefined()
    expect(resolve('/api/plugins/chat/chats/chat-1', 'POST', routes).routePattern).toBeUndefined()
    expect(resolve('/api/not-a-plugin/task-1', 'GET', routes).routePattern).toBeUndefined()
  })

  it('treats the external messaging nav summary as shell traffic', () => {
    expect(classify('/api/plugins/messaging/plans/summary')).toBe('routine')
    expect(classify('/api/plugins/messaging/plans/summary', 'POST')).toBe('user')
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
      '/api/activity',
      '/api/settings',
      '/api/state',
      '/api/version',
      '/api/agent-packages',
      '/api/plugins/manifest',
      '/api/plugins/:pluginId/assets/:path',
      '/api/update/status',
    ]) {
      const route = coreRoutes.find((candidate) => (
        candidate.method === 'GET' && candidate.path === path
      ))
      expect(route?.activityClass).toBe('routine')
    }
  })
})
