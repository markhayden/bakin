/**
 * Docs generator — shared leaf helpers.
 *
 * Path resolution + the stable-file writer (strips the H1 that the frontmatter
 * already renders, normalizes trailing newline) + the HTML/markdown escapers +
 * the generated-page note + object flattening. Pure except writeStableFile's
 * one disk write; every renderer module imports from here.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { APP_VERSION } from '../../../packages/core/src/constants'

export const docsBasePath = '/docs'

export function writeStableFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const stableContents = path.includes('/docs/src/content/docs/')
    ? contents.replace(/^(---\n[\s\S]*?\n---\n\n)# [^\n]+\n\n/, '$1')
    : contents
  writeFileSync(path, stableContents.trimEnd() + '\n', 'utf8')
}

export function docsPath(path: string): string {
  return `${docsBasePath}${path.startsWith('/') ? path : `/${path}`}`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/</g, '&lt;')
}

export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

export function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function generatedPageNote(): string {
  const generatedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())
  return [
    '<aside class="generated-page-note" aria-label="Generated page metadata">',
    `  <span>Generated ${generatedDate} · Bakin ${APP_VERSION}</span>`,
    '</aside>',
  ].filter(Boolean).join('\n')
}

export function flattenObject(value: unknown, prefix = ''): Array<{ key: string; value: unknown }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ key: prefix, value }]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) return flattenObject(child, next)
    return [{ key: next, value: child }]
  })
}
