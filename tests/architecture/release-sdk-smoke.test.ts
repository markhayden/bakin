import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { SDK_EXPORTS, SDK_STYLES_EXPORT } from '../../scripts/build-sdk-package'

const repoRoot = resolve(import.meta.dir, '../..')
const workflow = yaml.load(readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')) as {
  jobs: Record<string, { steps: Array<{ name: string; run?: string }> }>
}
const smokeScript = workflow.jobs['smoke-sdk'].steps.find(
  (step) => step.name === 'Install exact SDK version and import subpaths',
)?.run ?? ''
const sdkPackage = JSON.parse(readFileSync(resolve(repoRoot, 'packages/sdk/package.json'), 'utf8')) as {
  exports: Record<string, string>
}

describe('release SDK smoke coverage', () => {
  it('imports every JavaScript subpath in the SDK export map, with no retired entries', () => {
    const loop = smokeScript.match(/for subpath in ([^;]+); do/)
    expect(loop).not.toBeNull()
    const subpaths = loop![1].trim().split(/\s+/).map((subpath) => `./${subpath}`)
    const expected = SDK_EXPORTS.map((entry) => entry.exportPath).filter((key) => key !== '.')
    expect(subpaths.sort()).toEqual(expected.sort())
    expect(smokeScript).toContain("await import('@makinbakin/sdk/${subpath}')")
  })

  it('keeps the source and published SDK export maps aligned', () => {
    expect(Object.keys(sdkPackage.exports).sort()).toEqual(
      [...SDK_EXPORTS.map((entry) => entry.exportPath), SDK_STYLES_EXPORT].sort(),
    )
  })

  it('checks the root registration function and the separately resolved stylesheet', () => {
    expect(smokeScript).toContain("typeof m.registerPlugin !== 'function'")
    expect(smokeScript).toContain("Bun.resolveSync('@makinbakin/sdk/styles.css', process.cwd())")
  })
})
