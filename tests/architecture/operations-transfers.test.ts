/**
 * One transfer primitive (#895 G3): every artifact download — archives,
 * tarballs, binaries, model files, release indexes — streams through
 * `packages/core/src/net/download.ts`, which owns the stall guard, the attempt
 * deadline, fresh-request retries, abort and the transfer events operations
 * render. Installer modules never buffer a body (`arrayBuffer()`/`blob()`),
 * never `Bun.write` a response, never hand-roll node:http(s) GETs, and nothing
 * imports the deleted Whiskit copy.
 *
 * Pure scanner: reads source as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Modules that install artifacts. A new installer joins this list. */
const INSTALLER_MODULES = [
  'packages/adapter-antfly/src/installer.ts',
  'packages/adapter-antfly/src/models.ts',
  'packages/core/src/media/installer.ts',
  'src/core/agent-packages/bin-installer.ts',
  'src/core/agent-packages/requirements-installer.ts',
  'src/core/whiskit/consumer-install.ts',
  'src/core/whiskit/managed-bun.ts',
  'src/core/whiskit/resolver.ts',
  'src/core/plugins/upgrade-artifact.ts',
  'src/core/plugins/upgrade-github.ts',
  'packages/host/src/api/plugins/install/resolve-source.ts',
]

const BUFFERED_OR_RAW = [
  { name: 'buffers a body', re: /\.(arrayBuffer|blob)\(\)/ },
  { name: 'Bun.write of a response', re: /Bun\.write\(/ },
  { name: 'hand-rolled node:http(s) GET', re: /from ['"](node:)?https?['"]/ },
]

function codeOf(file: string): string {
  return readFileSync(join(ROOT, file), 'utf-8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
}

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(name)) yield full
  }
}

describe('artifact transfers ride the one primitive', () => {
  it('lists only installer modules that exist', () => {
    expect(INSTALLER_MODULES.filter((f) => !existsSync(join(ROOT, f)))).toEqual([])
  })

  it.each(INSTALLER_MODULES)('%s neither buffers nor hand-rolls a download', (file) => {
    const code = codeOf(file)
    expect(BUFFERED_OR_RAW.filter(({ re }) => re.test(code)).map(({ name }) => name)).toEqual([])
  })

  // A file promotion rides the ONE verify-then-commit helper. Directory
  // promotions (the media and requirements installers' staging dirs) are a
  // different operation and stay as renames — this pins the files only.
  const FILE_COMMITTERS = [
    'packages/adapter-antfly/src/installer.ts',
    'src/core/agent-packages/bin-installer.ts',
    'src/core/agent-packages/requirements-installer.ts',
    'src/core/whiskit/managed-bun.ts',
  ]
  it.each(FILE_COMMITTERS)('%s commits its file through commitFileAtomic', (file) => {
    expect(codeOf(file)).toMatch(/\bcommitFileAtomic\b/)
  })

  it('the antfly installer never bare-renames the staged binary into place (#890)', () => {
    expect(codeOf('packages/adapter-antfly/src/installer.ts')).not.toMatch(/renameSync\(extractedBinary/)
  })

  it('the Whiskit download copy is gone and nothing imports it', () => {
    expect(existsSync(join(ROOT, 'src/core/whiskit/download.ts'))).toBe(false)
    const self = 'tests/architecture/operations-transfers.test.ts'
    const importers: string[] = []
    for (const root of ['src', 'packages', 'plugins', 'cli', 'scripts', 'tests']) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const rel = relative(ROOT, file)
        if (rel !== self && /whiskit\/download['"]/.test(readFileSync(file, 'utf-8'))) importers.push(rel)
      }
    }
    expect(importers).toEqual([])
  })

  it('the primitive has no onProgress callback left', () => {
    expect(codeOf('packages/core/src/net/download.ts')).not.toMatch(/onProgress/)
  })

  it('has teeth: the patterns catch the shapes they ban', () => {
    expect(BUFFERED_OR_RAW[0].re.test('const bytes = new Uint8Array(await res.arrayBuffer())')).toBe(true)
    expect(BUFFERED_OR_RAW[1].re.test('await Bun.write(dest, res)')).toBe(true)
    expect(BUFFERED_OR_RAW[2].re.test("import { get } from 'node:https'")).toBe(true)
  })
})
