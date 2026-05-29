import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('OpenClaw runtime images adapter', () => {
  let testDir: string
  let openclaw: string
  let callsFile: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-images-test-'))
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
if [ "$1" = "infer" ] && [ "$2" = "image" ] && [ "$3" = "generate" ]; then
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
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAI
    mock.restore()
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
    const outputPath = join(testDir, 'generated.png')

    const result = await runtime.images!.generate({
      prompt: 'One blue square',
      provider: 'openai',
      model: 'gpt-image-2',
      width: 1024,
      height: 1024,
      outputPath,
      outputFormat: 'png',
    })

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      images: [{ filePath: outputPath, mimeType: 'image/png', provider: 'openai', model: 'gpt-image-2' }],
    })
    expect(existsSync(outputPath)).toBe(true)
    expect(readFileSync(callsFile, 'utf-8')).toContain('openai/gpt-image-2')
    expect(readFileSync(callsFile, 'utf-8')).toContain('1024x1024')
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
})
