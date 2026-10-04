/**
 * The generated OpenAPI document (`docs/public/openapi.json`, written by
 * `bun run docs:generate`), imported as a module so Vite inlines it at build
 * time. Never locate it through `import.meta.url` + `node:fs`: Astro 7
 * prerenders from `dist/.prerender/chunks/`, where that relative path points
 * at a file that does not exist.
 */
import spec from '../../public/openapi.json'

export type OpenApiParameter = {
  name: string
  in: string
  required?: boolean
  description?: string
  schema?: unknown
  example?: unknown
}

export type OpenApiOperation = {
  operationId?: string
  tags?: string[]
  summary?: string
  description?: string
  parameters?: OpenApiParameter[]
  requestBody?: {
    description?: string
    required?: boolean
    content?: Record<string, { schema?: unknown; example?: unknown }>
  }
  responses?: Record<string, {
    description?: string
    content?: Record<string, { schema?: unknown; example?: unknown }>
  }>
  security?: Array<Record<string, string[]>>
  'x-bakin-visibility'?: string
  'x-bakin-stability'?: string
}

export type OpenApiSpec = {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
}

export const openApiSpec = spec as unknown as OpenApiSpec
