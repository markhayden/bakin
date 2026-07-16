// @vitest-environment jsdom
/**
 * Route-shadow detection + real 404 (routing overhaul PR3, task 3.4).
 *
 * Pins: the collision matcher's semantics, HOST_STATIC_ROUTE_PATHS staying
 * in sync with the router.ts wiring (it's a deliberate literal copy — a
 * direct import would close an ESM cycle), and the NotFoundPage render.
 */
import { describe, test, expect, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-route-shadow-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

mock.module('@tanstack/react-router', () => ({
  ...require('../shims/tanstack-router'),
  // The shim's Link stub predates React 19's element shape and is not
  // renderable (and the shim itself must stay free of value-level react
  // imports — they crash bun when required inside mock factories). Build a
  // real element here instead.
  Link: (props: { to?: string; className?: string; children?: unknown }) =>
    createElement('a', { href: props.to, className: props.className }, props.children as never),
}))

import { createElement } from 'react'
import { render } from '@testing-library/react'
import '../rtl-settle'

import {
  HOST_STATIC_ROUTE_PATHS,
  findShadowingHostPaths,
  routesCollide,
} from '../../packages/host/src/lib/route-shadow'
import { NotFoundPage } from '../../packages/host/src/components/not-found'

describe('routesCollide', () => {
  test('literal collisions', () => {
    expect(routesCollide('/tasks', '/tasks')).toBe(true)
    expect(routesCollide('/tasks/x', '/tasks')).toBe(false)
    expect(routesCollide('/other', '/tasks')).toBe(false)
  })

  test('dynamic segments match anything, on either side', () => {
    expect(routesCollide('/team/:x', '/team/$id')).toBe(true)
    expect(routesCollide('/chat/anything', '/chat/$chatId')).toBe(true)
    expect(routesCollide('/team/:x/extra', '/team/$id')).toBe(false)
  })

  test('findShadowingHostPaths surfaces every collision', () => {
    expect(findShadowingHostPaths('/tasks')).toEqual(['/tasks'])
    expect(findShadowingHostPaths('/chat/:id')).toEqual(['/chat/new', '/chat/$chatId'])
    expect(findShadowingHostPaths('/my-plugin/page')).toEqual([])
  })
})

describe('HOST_STATIC_ROUTE_PATHS stays in sync with router.ts', () => {
  test('every route module wired in router.ts appears in the list', () => {
    const routerSrc = readFileSync(join(process.cwd(), 'packages/host/src/router.ts'), 'utf8')
    const routeFiles = [...routerSrc.matchAll(/from '\.\/routes\/([^']+)'/g)]
      .map((m) => m[1])
      .filter((f) => f !== '__root' && f !== 'plugin-catchall')
    expect(routeFiles.length).toBeGreaterThan(15)
    for (const file of routeFiles) {
      const src = readFileSync(join(process.cwd(), 'packages/host/src/routes', `${file}.tsx`), 'utf8')
      const path = /path:\s*'([^']+)'/.exec(src)?.[1]
      expect(path).toBeDefined()
      expect(HOST_STATIC_ROUTE_PATHS).toContain(
        path === '/' ? '/' : (path!.replace(/\/$/, '') as (typeof HOST_STATIC_ROUTE_PATHS)[number]),
      )
    }
  })
})

describe('NotFoundPage', () => {
  test('renders the path, heading, and a way home', () => {
    const happy = (window as unknown as { happyDOM?: { setURL: (u: string) => void } }).happyDOM
    happy?.setURL('http://localhost:3737/definitely/not/a/page')
    const { container } = render(<NotFoundPage />)
    expect(container.querySelector('[data-testid="not-found"]')).not.toBeNull()
    expect(container.textContent).toContain('Page not found')
    expect(container.textContent).toContain('/definitely/not/a/page')
    const home = container.querySelector('a')
    expect(home?.textContent).toContain('Back to Tasks')
  })
})
