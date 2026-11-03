/**
 * The dev rig's compose file interpolates `${BUN_VERSION:?…}` on EVERY parse
 * (the image build pins bun to `.bun-version`), so a direct `docker compose -f
 * dev/docker/docker-compose.yml …` from a shell without the export aborts —
 * `down` included. Every tracked caller goes through `scripts/dev/compose.sh`
 * (or exports the variable itself, as the OpenClaw CLI shim does). Pure text
 * scanner: imports no app module.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SCAN = ['cmd', 'scripts', 'dev/docker', 'package.json', '.github/workflows']
const ALLOWED = new Set(['scripts/dev/compose.sh', 'dev/docker/openclaw-shim.sh'])

function* walk(path: string): Generator<string> {
  const st = statSync(path)
  if (st.isFile()) { yield path; return }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist') continue
    yield* walk(join(path, name))
  }
}

describe('dev rig compose entrypoint', () => {
  it('no tracked script invokes docker compose on the rig file directly', () => {
    const offenders: string[] = []
    for (const root of SCAN) {
      for (const file of walk(join(ROOT, root))) {
        if (!/\.(sh|ts|mjs|json|yml|yaml)$|\/cmd\/[^/.]+$/.test(file)) continue
        const rel = relative(ROOT, file)
        if (ALLOWED.has(rel)) continue
        const src = readFileSync(file, 'utf-8')
        for (const m of src.matchAll(/docker compose\b[^\n]*docker-compose\.yml/g)) {
          offenders.push(`${rel}: ${m[0].slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the shim exports BUN_VERSION before its compose call', () => {
    const shim = readFileSync(join(ROOT, 'dev/docker/openclaw-shim.sh'), 'utf-8')
    expect(shim.indexOf('export BUN_VERSION=')).toBeGreaterThan(-1)
    expect(shim.indexOf('export BUN_VERSION=')).toBeLessThan(shim.indexOf('docker compose'))
  })
})
