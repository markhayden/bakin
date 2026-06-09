import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resetContentDir } from '../../src/core/content-dir'
import { setStoredProviderKey } from '../../packages/core/src/media/secret-store'

describe('OpenClaw runtime images adapter', () => {
  let testDir: string
  let openclaw: string
  let callsFile: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-images-test-'))
    // The shim's credential lookup reads the secret store (getContentDir) when
    // no env key is set — point it at the temp dir so it stays isolated.
    process.env.BAKIN_HOME = testDir
    resetContentDir()
    const binDir = join(testDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    openclaw = join(binDir, 'openclaw')
    callsFile = join(testDir, 'calls.txt')
    writeFileSync(openclaw, `#!/bin/sh
printf '%s\\n' "$@" >> "${callsFile}"
if [ "$1" = "infer" ] && [ "$2" = "image" ] && [ "$3" = "providers" ]; then
cat <<'JSON'
[
  {
    "available": true,
    "configured": true,
    "selected": true,
    "id": "openai",
    "label": "OpenAI",
    "defaultModel": "gpt-image-2",
    "models": ["gpt-image-2"],
    "capabilities": {
      "generate": { "maxCount": 4, "supportsSize": true },
      "output": { "formats": ["png", "jpeg", "webp"] }
    }
  }
]
JSON
exit 0
fi
if [ "$1" = "gateway" ] && [ "$2" = "restart" ]; then
printf 'MCPORTER_CALL_TIMEOUT=%s\\n' "$MCPORTER_CALL_TIMEOUT" >> "${callsFile}"
echo "{}"
exit 0
fi
if [ "$1" = "infer" ] && [ "$2" = "image" ] && { [ "$3" = "generate" ] || [ "$3" = "edit" ]; }; then
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    shift
    out="$1"
  fi
  shift
done
printf 'fake image' > "$out"
cat <<JSON
{"images":[{"filePath":"$out","mimeType":"image/png","width":1024,"height":1024,"provider":"openai","model":"openai/gpt-image-2"}]}
JSON
exit 0
fi
echo "{}"
`, 'utf-8')
    chmodSync(openclaw, 0o755)
  })

  const originalOpenAI = process.env.OPENAI_API_KEY
  const originalHome = process.env.BAKIN_HOME
  const originalMcporterCallTimeout = process.env.MCPORTER_CALL_TIMEOUT
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAI
    if (originalHome === undefined) delete process.env.BAKIN_HOME
    else process.env.BAKIN_HOME = originalHome
    if (originalMcporterCallTimeout === undefined) delete process.env.MCPORTER_CALL_TIMEOUT
    else process.env.MCPORTER_CALL_TIMEOUT = originalMcporterCallTimeout
    resetContentDir()
    mock.restore()
  })

  it('starts OpenClaw child processes with a long mcporter call timeout by default', async () => {
    delete process.env.MCPORTER_CALL_TIMEOUT
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    await runtime.restart()

    expect(readFileSync(callsFile, 'utf-8')).toContain('gateway\nrestart')
    expect(readFileSync(callsFile, 'utf-8')).toContain('MCPORTER_CALL_TIMEOUT=600000')
  })

  it('lists OpenClaw image providers through infer image providers', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const providers = await runtime.images!.providers()

    expect(providers).toEqual([
      expect.objectContaining({
        id: 'openai',
        label: 'OpenAI',
        configured: true,
        selected: true,
        defaultModel: 'gpt-image-2',
        models: ['gpt-image-2'],
      }),
    ])
    expect(readFileSync(callsFile, 'utf-8').split('\n').filter(Boolean).slice(0, 4)).toEqual([
      'infer',
      'image',
      'providers',
      '--json',
    ])
  })

  it('generates image files through OpenClaw infer image generate', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const result = await runtime.images!.generate({
      prompt: 'One blue square',
      provider: 'openai',
      model: 'gpt-image-2',
      width: 1024,
      height: 1024,
      outputFormat: 'png',
    })

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      images: [{ mimeType: 'image/png', provider: 'openai', model: 'gpt-image-2' }],
    })
    // The adapter owns the output path; assert the returned file exists.
    expect(existsSync(result.images[0]!.filePath)).toBe(true)
    expect(readFileSync(callsFile, 'utf-8')).toContain('openai/gpt-image-2')
    expect(readFileSync(callsFile, 'utf-8')).toContain('1024x1024')
    // OpenClaw has no quality flag; the adapter must never emit one (#379).
    expect(readFileSync(callsFile, 'utf-8')).not.toContain('--quality')
  })

  it('routes a reference-image generate through infer image edit with one --file per reference (#418)', async () => {
    const refA = join(testDir, 'ref-a.png')
    const refB = join(testDir, 'ref-b.png')
    writeFileSync(refA, 'a')
    writeFileSync(refB, 'b')
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const result = await runtime.images!.generate({
      prompt: 'On-brand social image',
      provider: 'openai',
      model: 'gpt-image-2',
      width: 1024,
      height: 1024,
      outputFormat: 'png',
      referenceImages: [refA, refB],
    })

    const calls = readFileSync(callsFile, 'utf-8')
    const argv = calls.split('\n')
    // Generate has no --file; references force the edit-style invocation.
    expect(argv.slice(0, 3)).toEqual(['infer', 'image', 'edit'])
    expect(calls).toContain(`--file\n${refA}`)
    expect(calls).toContain(`--file\n${refB}`)
    expect(existsSync(result.images[0]!.filePath)).toBe(true)
  })

  it('falls back to the direct shim when OpenClaw cannot serve the model natively', async () => {
    process.env.OPENAI_API_KEY = 'shim-key'
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('shim-img').toString('base64') }] }),
    } as unknown as Response)

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    // The mock binary advertises only gpt-image-2; gpt-image-1.5 is a gap.
    const result = await runtime.images!.generate({
      prompt: 'Premium hero',
      provider: 'openai',
      model: 'gpt-image-1.5',
      width: 1024,
      height: 1024,
    })

    expect(fetchSpy).toHaveBeenCalledWith('https://api.openai.com/v1/images/generations', expect.anything())
    expect(result.metadata).toMatchObject({ servedBy: 'shim', credentialSource: 'bakin-env' })
    expect(result.images[0]?.provider).toBe('openai')
    // Native generate must NOT have run for the unsupported model.
    expect(readFileSync(callsFile, 'utf-8')).not.toContain('generate')
  })

  it('labels the credential source as bakin-store when the key comes from the store', async () => {
    delete process.env.OPENAI_API_KEY
    setStoredProviderKey('openai', 'stored-key')
    spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('shim-img').toString('base64') }] }),
    } as unknown as Response)

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const result = await runtime.images!.generate({
      prompt: 'Premium hero', provider: 'openai', model: 'gpt-image-1.5', width: 1024, height: 1024,
    })
    expect(result.metadata).toMatchObject({ servedBy: 'shim', credentialSource: 'bakin-store' })
  })

  it('falls through to the native runtime as a last resort when no Bakin key is configured', async () => {
    // The model isn't in the runtime's advertised list AND there's no Bakin
    // key, but the runtime may still serve it (listings are often partial) —
    // so we attempt native rather than pre-empting it with an error.
    delete process.env.OPENAI_API_KEY
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'unused' } as unknown as Response)

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter({ settings: { binaryPath: openclaw } })

    const result = await runtime.images!.generate({
      prompt: 'x', provider: 'openai', model: 'gpt-image-1.5', width: 1024, height: 1024,
    })
    // Native path ran (mock serves any model); no direct provider HTTP call.
    expect(result.metadata).toMatchObject({ servedBy: 'runtime' })
    expect(readFileSync(callsFile, 'utf-8')).toContain('generate')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
