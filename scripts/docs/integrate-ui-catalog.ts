import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const DEFAULT_CATALOG_ROOT = join(REPO_ROOT, 'storybook-static-public')
const DEFAULT_DOCS_DIST = join(REPO_ROOT, 'docs/dist')
const REQUIRED_CATALOG_FILES = [
  'index.html',
  'iframe.html',
  'index.json',
  'bakin-fixtures.json',
] as const

interface StoryIndexEntry {
  importPath?: unknown
  tags?: unknown
}

interface StoryIndex {
  entries?: unknown
}

export interface PublicUiCatalogValidation {
  errors: string[]
  storyCount: number
}

function staticReferences(html: string): string[] {
  const references = new Set<string>()
  const patterns = [
    /(?:src|href)\s*=\s*["']([^"']+)["']/g,
    /url\(\s*["']?([^)'"\s]+)["']?\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ]

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      // Storybook's error UI contains template-string links to its own docs;
      // only concrete build-time references can be traversed here.
      if (!match[1].includes('${')) references.add(match[1])
    }
  }
  return [...references].sort()
}

function referencedArtifactPath(catalogRoot: string, htmlFile: string, reference: string): {
  error?: string
  path?: string
} {
  if (!reference || reference.startsWith('#') || reference.startsWith('data:')) return {}

  let url: URL
  try {
    const route = `/docs/ui/${htmlFile.replaceAll(sep, '/')}`
    url = new URL(reference, new URL(route, 'https://makinbakin.com'))
  } catch {
    return { error: `${htmlFile}: invalid static reference ${reference}` }
  }
  if (url.origin !== 'https://makinbakin.com') return {}
  if (url.pathname !== '/docs/ui' && !url.pathname.startsWith('/docs/ui/')) {
    return { error: `${htmlFile}: static reference ${reference} escapes /docs/ui/` }
  }

  let artifactRelativePath: string
  try {
    artifactRelativePath = decodeURIComponent(url.pathname.slice('/docs/ui/'.length))
  } catch {
    return { error: `${htmlFile}: invalid encoded static reference ${reference}` }
  }
  const path = resolve(catalogRoot, artifactRelativePath || 'index.html')
  const child = relative(catalogRoot, path)
  if (child === '..' || child.startsWith(`..${sep}`)) {
    return { error: `${htmlFile}: static reference ${reference} escapes /docs/ui/` }
  }
  return { path }
}

function htmlFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path)
    }
  }
  walk(root)
  return files.sort()
}

export function validatePublicUiCatalog(catalogRoot: string): PublicUiCatalogValidation {
  const root = resolve(catalogRoot)
  const errors: string[] = []
  let storyCount = 0

  if (!existsSync(root)) return { errors: [`catalog directory does not exist: ${root}`], storyCount }
  for (const file of REQUIRED_CATALOG_FILES) {
    if (!existsSync(join(root, file))) errors.push(`missing required catalog file: ${file}`)
  }

  const indexPath = join(root, 'index.json')
  if (existsSync(indexPath)) {
    try {
      const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as StoryIndex
      if (!index.entries || typeof index.entries !== 'object' || Array.isArray(index.entries)) {
        errors.push('index.json: entries must be an object')
      } else {
        const entries = Object.entries(index.entries as Record<string, StoryIndexEntry>)
        storyCount = entries.length
        if (storyCount === 0) errors.push('index.json: public catalog must contain at least one story')
        for (const [id, entry] of entries.sort(([left], [right]) => left.localeCompare(right))) {
          const tags = Array.isArray(entry.tags) ? entry.tags : []
          if (!tags.includes('public')) errors.push(`index.json: ${id} is not tagged public`)
          if (tags.includes('internal')) errors.push(`index.json: ${id} is tagged internal`)
          if (typeof entry.importPath !== 'string' || !entry.importPath.includes('/storybook/public/')) {
            errors.push(`index.json: ${id} references an internal story source`)
          }
        }
      }
    } catch (error) {
      errors.push(`index.json: ${error instanceof Error ? error.message : 'invalid JSON'}`)
    }
  }

  for (const htmlPath of htmlFiles(root)) {
    const htmlFile = relative(root, htmlPath)
    const html = readFileSync(htmlPath, 'utf-8')
    for (const reference of staticReferences(html)) {
      const resolvedReference = referencedArtifactPath(root, htmlFile, reference)
      if (resolvedReference.error) errors.push(resolvedReference.error)
      else if (resolvedReference.path && !existsSync(resolvedReference.path)) {
        errors.push(`${htmlFile}: missing static reference ${reference}`)
      }
    }
  }

  return { errors, storyCount }
}

export function integratePublicUiCatalog(options: {
  catalogRoot?: string
  docsDist?: string
} = {}): { storyCount: number; targetDir: string } {
  const catalogRoot = resolve(options.catalogRoot ?? DEFAULT_CATALOG_ROOT)
  const docsDist = resolve(options.docsDist ?? DEFAULT_DOCS_DIST)
  const targetDir = resolve(docsDist, 'ui')
  if (targetDir !== join(docsDist, 'ui')) throw new Error('Invalid docs UI catalog target')
  // This Starlight build intentionally has no root index: the existing
  // Cloudflare /docs/ redirect owns that route. Astro's 404 is the stable
  // marker that the site artifact exists without inventing a new docs route.
  if (!existsSync(join(docsDist, '404.html'))) {
    throw new Error(`Missing docs site build at ${docsDist}`)
  }

  const sourceValidation = validatePublicUiCatalog(catalogRoot)
  if (sourceValidation.errors.length > 0) {
    throw new Error(`Public UI catalog validation failed:\n${sourceValidation.errors.join('\n')}`)
  }

  rmSync(targetDir, { recursive: true, force: true })
  cpSync(catalogRoot, targetDir, { recursive: true })

  const combinedValidation = validatePublicUiCatalog(targetDir)
  if (combinedValidation.errors.length > 0) {
    throw new Error(`Combined docs UI catalog validation failed:\n${combinedValidation.errors.join('\n')}`)
  }
  return { storyCount: combinedValidation.storyCount, targetDir }
}

if (import.meta.main) {
  try {
    const result = integratePublicUiCatalog()
    console.log(`Published ${result.storyCount} public UI stories at docs/dist/ui/.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
