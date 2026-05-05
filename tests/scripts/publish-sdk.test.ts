import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PUBLIC_SDK_PACKAGE_NAME,
  distTagForVersion,
  parseArgs,
  publishSdkPackage,
  type CommandRunner,
  type SdkPackageBuilder,
} from '../../scripts/publish-sdk'

const testRoot = join(tmpdir(), `bakin-test-publish-sdk-${Date.now()}`)

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function packageBuilder(): SdkPackageBuilder {
  return async ({ version, outDir }) => {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'package.json'), JSON.stringify({
      name: PUBLIC_SDK_PACKAGE_NAME,
      version,
    }, null, 2))
  }
}

describe('parseArgs', () => {
  it('resolves version, package dir, and default npm dist-tag', () => {
    expect(parseArgs([
      '--version',
      '0.1.0-rc.1',
      '--package-dir',
      '/tmp/bakin-sdk-package',
      '--dry-run',
    ])).toEqual({
      version: '0.1.0-rc.1',
      packageDir: '/tmp/bakin-sdk-package',
      tag: 'next',
      dryRun: true,
      keepPackageDir: false,
    })
  })

  it('can resolve a tag-triggered workflow version from env', () => {
    expect(parseArgs([], { GITHUB_REF: 'refs/tags/v0.2.0' }).version).toBe('0.2.0')
    expect(parseArgs([], { GITHUB_REF_NAME: 'v0.3.0-rc.2' }).tag).toBe('next')
  })

  it('rejects malformed versions and dist-tags', () => {
    expect(() => parseArgs(['--version', '0.1.0-beta.1'])).toThrow('version must')
    expect(() => parseArgs(['--version', '0.1.0', '--tag', 'beta'])).toThrow('dist-tag')
    expect(() => parseArgs(['--version', '--dry-run'])).toThrow('requires a value')
  })
})

describe('distTagForVersion', () => {
  it('routes rc builds to next and stable builds to latest', () => {
    expect(distTagForVersion('0.1.0-rc.1')).toBe('next')
    expect(distTagForVersion('0.1.0')).toBe('latest')
  })
})

describe('publishSdkPackage', () => {
  it('builds the package and performs no npm calls in dry-run mode', async () => {
    const calls: string[] = []
    const result = await publishSdkPackage({
      version: '0.1.0-rc.1',
      packageDir: join(testRoot, 'dry-run-package'),
      tag: 'next',
      dryRun: true,
      keepPackageDir: false,
    }, {
      builder: packageBuilder(),
      runner: ((cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`)
        return { status: 0, stdout: '', stderr: '' }
      }) satisfies CommandRunner,
    })

    expect(result).toBe('dry-run')
    expect(calls).toEqual([])
  })

  it('exits successfully when the npm version already exists', async () => {
    const calls: string[] = []
    const result = await publishSdkPackage({
      version: '0.1.0',
      packageDir: join(testRoot, 'existing-package'),
      tag: 'latest',
      dryRun: false,
      keepPackageDir: false,
    }, {
      builder: packageBuilder(),
      runner: ((cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`)
        return { status: 0, stdout: '"0.1.0"\n', stderr: '' }
      }) satisfies CommandRunner,
    })

    expect(result).toBe('exists')
    expect(calls).toEqual([`npm view ${PUBLIC_SDK_PACKAGE_NAME}@0.1.0 version --json`])
  })

  it('publishes with provenance after an npm 404 pre-check', async () => {
    const calls: string[] = []
    const result = await publishSdkPackage({
      version: '0.1.0-rc.1',
      packageDir: join(testRoot, 'new-package'),
      tag: 'next',
      dryRun: false,
      keepPackageDir: false,
    }, {
      builder: packageBuilder(),
      runner: ((cmd, args, cwd) => {
        calls.push(`${cwd}: ${cmd} ${args.join(' ')}`)
        if (args[0] === 'view') {
          return { status: 1, stdout: '', stderr: 'npm ERR! code E404\nnpm ERR! 404 Not Found' }
        }
        return { status: 0, stdout: 'published\n', stderr: '' }
      }) satisfies CommandRunner,
    })

    expect(result).toBe('published')
    expect(calls[0]).toContain(`npm view ${PUBLIC_SDK_PACKAGE_NAME}@0.1.0-rc.1 version --json`)
    expect(calls[1]).toContain('npm publish --provenance --access public --tag next')
  })

  it('fails loudly on unexpected npm view and publish errors', async () => {
    await expect(publishSdkPackage({
      version: '0.1.0',
      packageDir: join(testRoot, 'view-error-package'),
      tag: 'latest',
      dryRun: false,
      keepPackageDir: false,
    }, {
      builder: packageBuilder(),
      runner: (() => ({ status: 1, stdout: '', stderr: 'network failed' })) satisfies CommandRunner,
    })).rejects.toThrow('Could not check npm package')

    await expect(publishSdkPackage({
      version: '0.1.1',
      packageDir: join(testRoot, 'publish-error-package'),
      tag: 'latest',
      dryRun: false,
      keepPackageDir: false,
    }, {
      builder: packageBuilder(),
      runner: ((_, args) => args[0] === 'view'
        ? { status: 1, stdout: '', stderr: 'npm ERR! code E404' }
        : { status: 1, stdout: '', stderr: 'publish failed' }) satisfies CommandRunner,
    })).rejects.toThrow('npm publish failed')
  })
})
