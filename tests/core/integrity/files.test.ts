/** verifyFileSha256 — always hashes; never trusts size alone; never throws. */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, utimesSync, writeFileSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'
import { verifyFileSha256 } from '../../../packages/core/src/integrity/files'

const dir = join(tmpdir(), `bakin-test-integrity-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const file = join(dir, 'model.bin')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

beforeEach(() => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('verifyFileSha256', () => {
  it('ok when the bytes match the pin (case-insensitive pin)', async () => {
    writeFileSync(file, 'weights')
    expect(await verifyFileSha256(file, sha('weights').toUpperCase(), { bytes: 7 })).toEqual({ ok: true, sha256: sha('weights') })
  })

  it('same-size, same-mtime corruption is caught — nothing but the hash is proof', async () => {
    writeFileSync(file, 'weights')
    const { atime, mtime } = statSync(file)
    expect((await verifyFileSha256(file, sha('weights'))).ok).toBe(true)
    writeFileSync(file, 'weighTs') // same length
    utimesSync(file, atime, mtime) // same mtime
    expect(await verifyFileSha256(file, sha('weights'), { bytes: 7 })).toMatchObject({ ok: false, reason: 'hash-mismatch' })
  })

  it('a wrong size, a missing file and a directory are failed verdicts, never exceptions', async () => {
    writeFileSync(file, 'weights')
    expect(await verifyFileSha256(file, sha('weights'), { bytes: 8 })).toMatchObject({ ok: false, reason: 'size-mismatch' })
    expect(await verifyFileSha256(join(dir, 'nope'), sha('x'))).toMatchObject({ ok: false, reason: 'missing' })
    mkdirSync(join(dir, 'sub'))
    expect(await verifyFileSha256(join(dir, 'sub'), sha('x'))).toMatchObject({ ok: false, reason: 'not-a-file' })
  })
})
