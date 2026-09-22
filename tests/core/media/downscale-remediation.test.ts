/**
 * Prove-It regression for the #889 symptom: when sharp is unavailable, the
 * oversized-attachment error must NAME THE FIX. The original message told
 * the user to retry a vision call that could never succeed.
 *
 * Separate file from tests/core/media-downscale.test.ts because that suite
 * needs REAL sharp; this one mocks the loader to the degraded state.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-downscale-remediation-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/media/sharp-loader', () => ({
  loadSharp: async () => null,
}))

import { INLINE_ATTACHMENT_LIMIT_BYTES, prepareImageAttachment } from '../../../packages/core/src/media/downscale'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('prepareImageAttachment without sharp (#889)', () => {
  it('the oversized-attachment error names the remediation, not a hopeless retry', async () => {
    mkdirSync(testDir, { recursive: true })
    const big = join(testDir, 'big.png')
    writeFileSync(big, Buffer.alloc(INLINE_ATTACHMENT_LIMIT_BYTES + 1))

    const rejection = prepareImageAttachment(big, 'image/png')
    await expect(rejection).rejects.toThrow(/inline limit/)
    await expect(rejection).rejects.toThrow(/bakin install media/)
    await expect(rejection).rejects.toThrow(/retrying without it can never succeed/i)
  })
})
