import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'apps/docs')
const docsContentRoot = join(docsRoot, 'src/content/docs')

interface Frontmatter {
  title?: string
  description?: string
}

function walkMarkdown(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkMarkdown(path, files)
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) files.push(path)
  }
  return files
}

function parseFrontmatter(file: string): Frontmatter {
  const text = readFileSync(file, 'utf8')
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  return (yaml.load(match[1]) ?? {}) as Frontmatter
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const errors: string[] = []

for (const file of walkMarkdown(docsContentRoot)) {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const text = readFileSync(file, 'utf8')
  const frontmatter = parseFrontmatter(file)
  if (!frontmatter.title) errors.push(`${rel}: missing frontmatter title`)
  if (!frontmatter.description) errors.push(`${rel}: missing frontmatter description`)
  if (/\bTODO\b|placeholder/i.test(text.replace(/--column=todo/g, '--column=column-name'))) {
    errors.push(`${rel}: contains TODO/placeholder language`)
  }
}

const requiredPublicFiles = [
  '.generated/coverage.json',
  'public/robots.txt',
  'public/_redirects',
  'public/llms.txt',
  'public/llms-full.txt',
  'public/llms/plugin-authoring.md',
  'public/llms/agent-authoring.md',
  'public/llms/sdk-reference.md',
  'public/llms/api.md',
  'public/llms/cli.md',
  'public/llms/hooks.md',
  'public/llms/exec-tools.md',
  'public/llms/core-plugins.md',
  'public/llms/settings.md',
]

for (const file of requiredPublicFiles) {
  if (!existsSync(join(docsRoot, file))) errors.push(`apps/docs/${file}: required docs asset missing`)
}

if (errors.length > 0) {
  fail(`Docs validation failed:\n${errors.map(e => `- ${e}`).join('\n')}`)
}

console.log(`Docs validation passed (${walkMarkdown(docsContentRoot).length} pages checked)`)
