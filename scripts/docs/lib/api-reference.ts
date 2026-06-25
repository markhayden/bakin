/**
 * Docs generator — REST API reference.
 *
 * Renders the curl examples + the OpenApiReference component wrappers (api.mdx)
 * from typed route OpenAPI operations. Pure formatting over the operation
 * objects the orchestrator builds via packages/core/src/openapi.
 */
import { escapeHtml, generatedPageNote } from './doc-utils'

export type OpenApiOperation = Record<string, unknown>

export function tagOrder(tag: string): string {
  return tag === 'Core' ? '00 Core' : `10 ${tag}`
}

export function isGenericObjectSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
  const record = schema as Record<string, unknown>
  const properties = record.properties
  return record.type === 'object' &&
    record.additionalProperties === true &&
    (!properties || (typeof properties === 'object' && !Array.isArray(properties) && Object.keys(properties).length === 0))
}

export function sampleOpenApiValue(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'value'
  const record = schema as Record<string, unknown>
  if (record.example !== undefined) return record.example
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0]
  switch (record.type) {
    case 'boolean':
      return true
    case 'integer':
    case 'number':
      return 1
    case 'array':
      return [sampleOpenApiValue(record.items)]
    case 'object': {
      const properties = record.properties
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined
      return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, sampleOpenApiValue(value)]))
    }
    case 'string':
    default:
      return 'value'
  }
}

export function firstOpenApiContent(content?: Record<string, { schema?: unknown; example?: unknown }>): { contentType: string; schema?: unknown; example?: unknown } | undefined {
  if (!content) return undefined
  const [contentType, value] = Object.entries(content)[0] ?? []
  if (!contentType || !value) return undefined
  return { contentType, ...value }
}

export function curlForOperation(method: string, path: string, operation: OpenApiOperation): string {
  const params = (operation.parameters as Array<{ name: string; in: string }> | undefined) ?? []
  let urlPath = path.replace(/\{([^}]+)\}/g, (_match, name) => `<${name}>`)
  const query = params.filter(param => param.in === 'query')
  if (query.length) {
    urlPath += `?${query.map(param => `${param.name}=<${param.name}>`).join('&')}`
  }
  const lines = ['curl -sS']
  if (method !== 'GET') lines.push(`  -X ${method}`)
  lines.push(`  'http://localhost:3737${urlPath}'`)
  const requestBody = operation.requestBody as { content?: Record<string, { schema?: unknown; example?: unknown }> } | undefined
  const body = firstOpenApiContent(requestBody?.content)
  if (body) {
    if (body.example === undefined && isGenericObjectSchema(body.schema)) return lines.join(' \\\n')
    const sample = body.example ?? sampleOpenApiValue(body.schema)
    if (sample === undefined) return lines.join(' \\\n')
    lines.push(`  -H 'Content-Type: ${body.contentType}'`)
    lines.push(`  --data '${JSON.stringify(sample)}'`)
  }
  return lines.join(' \\\n')
}

export function renderApiReference(groups: Map<string, Array<{ operationId: string; curl: string }>>): string {
  const groupLines = [...groups.keys()]
    .sort((a, b) => tagOrder(a).localeCompare(tagOrder(b)))
    .flatMap(tag => {
      const operations = groups.get(tag) ?? []
      return [
        `## ${tag}`,
        '',
        `<OpenApiReference tag="${escapeHtml(tag)}" summary />`,
        '',
        ...operations.flatMap(operation => [
          `<OpenApiReference operationId="${escapeHtml(operation.operationId)}">`,
          '```sh frame="terminal" showLineNumbers',
          operation.curl,
          '```',
          '</OpenApiReference>',
          '',
        ]),
      ]
    })

  return [
    '---',
    'title: API',
    'description: Generated OpenAPI-backed reference for documented Bakin HTTP API routes.',
    '---',
    '',
    "import OpenApiReference from '../../../../components/OpenApiReference.astro'",
    '',
    '<OpenApiReference intro />',
    '',
    ...groupLines,
    generatedPageNote(),
    '',
  ].join('\n')
}
