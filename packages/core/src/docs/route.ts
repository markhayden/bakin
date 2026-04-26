import type { APIRoute } from '../plugin-types'

export type DocsAwareAPIRoute = APIRoute & {
  summary: string
  description: string
  visibility: NonNullable<APIRoute['visibility']>
  stability: NonNullable<APIRoute['stability']>
}

export function defineApiRoute<const T extends DocsAwareAPIRoute>(route: T): T {
  return route
}

export const definePluginRoute = defineApiRoute
