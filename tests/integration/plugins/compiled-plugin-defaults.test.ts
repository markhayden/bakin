/**
 * Compile-and-run regression for plugin-shipped defaults (workflows,
 * workflow-skills, runtime-skills) inside a `bun build --compile` binary.
 *
 * The bug this pins: every loader located `defaults/**` relative to its own
 * module directory and returned silently when the directory was missing.
 * Inside a compiled binary that directory is `/$bunfs/root`, so compiled
 * installs ran with ZERO shipped workflows for months (found 2026-09-24).
 *
 * The fixture does exactly what the plugins do at activate — resolve through
 * src/core/plugin-resources.ts with `import.meta.url` — and the test asserts
 * PARITY: the binary registers the same set of files the checkout ships.
 * A teeth test pins the premise (module-relative paths stay dead in
 * binaries), so if bun ever changes that, the workaround gets revisited on
 * purpose instead of rotting.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const testDir = join(tmpdir(), `bakin-test-compiled-defaults-${Date.now()}-${Math.random().toString(16).slice(2)}`)
mkdirSync(testDir, { recursive: true })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { collectPluginDefaultAssets, emitManifest } from '../../../scripts/generate-embedded-assets'
import { listPluginDefaultFiles, shippedWorkflowFiles } from '../../../src/core/plugin-resources'

async function compile(entryFile: string, outName: string): Promise<string> {
  const outfile = join(testDir, outName)
  const proc = Bun.spawn(['bun', 'build', '--compile', `--outfile=${outfile}`, entryFile], {
    cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe',
  })
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`compile of ${entryFile} failed (exit ${code}): ${err.slice(-1200)}`)
  return outfile
}

async function run(binary: string): Promise<Record<string, unknown>> {
  // cwd is the temp dir on purpose: nothing plugin-shaped is reachable relatively.
  const proc = Bun.spawn([binary], { cwd: testDir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BAKIN_CONSOLE_FORMAT: 'silent' } })
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`binary exited ${code}: ${err.slice(-1200)}`)
  const last = out.trim().split('\n').pop() ?? '{}'
  return JSON.parse(last) as Record<string, unknown>
}

/** A defaults-only embedded manifest — what the real build carries for plugin defaults, without host/vendor outputs. */
function writeDefaultsManifest(): string {
  const outFile = join(testDir, 'manifest.ts')
  const assets = collectPluginDefaultAssets(REPO_ROOT)
  if (assets.length === 0) throw new Error('no plugin defaults found in the checkout')
  // The generator emits relative specifiers; from a (symlinked, on macOS)
  // temp dir those do not resolve, so pin them to absolute paths here.
  const source = emitManifest(assets, outFile).replace(
    /from '((?:\.\.\/)+[^']+)'/g,
    (_match, spec: string) => `from ${JSON.stringify(resolve(dirname(outFile), spec))}`,
  )
  writeFileSync(outFile, source)
  return outFile
}

function writeEntry(manifest: string): string {
  const entry = join(testDir, 'entry.ts')
  writeFileSync(entry, `
import { readFileSync } from 'fs'
import { EMBEDDED_ASSETS_STATIC } from ${JSON.stringify(manifest)}
import { setEmbeddedAssets } from ${JSON.stringify(join(REPO_ROOT, 'packages/host/src/api/_embedded-assets.ts'))}
import {
  RUNNING_FROM_BINARY, listPluginDefaultFiles, pluginDefaultsSource, pluginRootFromModuleUrl, shippedWorkflowFiles,
} from ${JSON.stringify(join(REPO_ROOT, 'src/core/plugin-resources.ts'))}

// server.ts does this first thing; the compiled binary's entry mirrors it.
setEmbeddedAssets(EMBEDDED_ASSETS_STATIC)

// EXACTLY what plugins/workflows/index.ts and plugins/images/index.ts do.
const root = pluginRootFromModuleUrl(import.meta.url)
const workflows = shippedWorkflowFiles('workflows', root)
const images = shippedWorkflowFiles('images', root)
// EXACTLY what plugin-registry does for a core plugin (config-relative root).
const skills = listPluginDefaultFiles({ pluginId: 'workflows', pluginPath: 'plugins/workflows', kind: 'workflow-skills' })
// EXACTLY what the plugin-assets onboarding component does.
const runtimeSkills = listPluginDefaultFiles({ pluginId: 'images', pluginPath: 'plugins/images', kind: 'runtime-skills' })

console.log(JSON.stringify({
  runningFromBinary: RUNNING_FROM_BINARY,
  root,
  source: pluginDefaultsSource(root),
  workflows: workflows.map(f => f.id),
  images: images.map(f => f.id),
  skills: skills.map(f => f.relPath),
  runtimeSkills: runtimeSkills.map(f => f.relPath),
  sources: [...workflows, ...images, ...skills, ...runtimeSkills].map(f => f.source),
  firstWorkflowHead: readFileSync(workflows[0]!.path, 'utf-8').slice(0, 200),
}))
`)
  return entry
}

function writeLegacyEntry(): string {
  const entry = join(testDir, 'legacy-entry.ts')
  writeFileSync(entry, `
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
// The pre-fix pattern (plugins/workflows/index.ts before 2026-09-24).
const moduleDir = dirname(fileURLToPath(import.meta.url))
console.log(JSON.stringify({ moduleDir, defaultsDirExists: existsSync(join(moduleDir, 'defaults', 'workflows')) }))
`)
  return entry
}

describe('compiled plugin defaults', () => {
  it('a compiled binary resolves the same shipped workflows, step skills and runtime skills the checkout ships', async () => {
    const binary = await compile(writeEntry(writeDefaultsManifest()), 'defaults-bin')
    const out = await run(binary)

    expect(out.runningFromBinary).toBe(true)
    expect(String(out.root).startsWith('/$bunfs/')).toBe(true)
    expect(out.source).toBe('embedded')

    // Parity with the checkout (disk resolution in THIS process).
    const wf = shippedWorkflowFiles('workflows', join(REPO_ROOT, 'plugins/workflows')).map(f => f.id)
    const img = shippedWorkflowFiles('images', join(REPO_ROOT, 'plugins/images')).map(f => f.id)
    const sk = listPluginDefaultFiles({ pluginId: 'workflows', pluginPath: 'plugins/workflows', kind: 'workflow-skills' }).map(f => f.relPath)
    const rs = listPluginDefaultFiles({ pluginId: 'images', pluginPath: 'plugins/images', kind: 'runtime-skills' }).map(f => f.relPath)
    expect(wf.length).toBeGreaterThanOrEqual(6)
    expect(img.length).toBeGreaterThanOrEqual(3)
    expect(out.workflows).toEqual(wf)
    expect(out.images).toEqual(img)
    expect(out.skills).toEqual(sk)
    expect(out.runtimeSkills).toEqual(rs)
    expect(new Set(out.sources as string[])).toEqual(new Set(['embedded']))
    // Bytes are readable straight out of the embedded copy.
    expect(String(out.firstWorkflowHead)).toMatch(/name:|id:|steps:/)
  }, 120_000)

  it('TEETH: module-relative defaults directories stay unreachable in compiled binaries (premise pin)', async () => {
    // If this starts passing `defaultsDirExists: true`, bun learned to give
    // compiled modules a real directory — revisit whether the embedded copies
    // are still needed instead of letting the workaround rot.
    const binary = await compile(writeLegacyEntry(), 'legacy-bin')
    const out = await run(binary)
    expect(String(out.moduleDir).startsWith('/$bunfs/')).toBe(true)
    expect(out.defaultsDirExists).toBe(false)
  }, 120_000)
})
