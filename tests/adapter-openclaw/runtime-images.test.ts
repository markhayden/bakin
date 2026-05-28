import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
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

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
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
})
