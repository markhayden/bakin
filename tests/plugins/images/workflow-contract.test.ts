import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'

const repoRoot = join(__dirname, '..', '..', '..')

function readWorkflow(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf-8')
}

describe('images workflow contract', () => {
  it('ships image-generation from the images plugin with the new tools', () => {
    const raw = readWorkflow('plugins/images/defaults/workflows/image-generation.yaml')
    const parsed = yaml.load(raw) as { id: string; steps: Array<Record<string, unknown>> }

    expect(parsed.id).toBe('image-generation')
    expect(raw).toContain('bakin_exec_images_recommend')
    expect(raw).toContain('bakin_exec_images_generate')
    expect(raw).toContain('$preferred(pixel,$assigned)')
    expect(raw).toContain('assetId')
    expect(raw).not.toContain('image_filename')
    expect(raw).not.toContain('bakin_exec_gen_image')
    expect(raw).not.toContain('imagePath')
    expect(raw).not.toContain('thumbnailPath')
    expect(raw).not.toContain('Nano Banana')
  })

  it('keeps social post as a composite workflow using asset ids', () => {
    const raw = readWorkflow('plugins/workflows/defaults/workflows/image-social-post.yaml')

    expect(raw).toContain('workflow_id: image-generation')
    expect(raw).toContain('finalOutput.assetId')
    expect(raw).toContain('imageAssetId')
    expect(raw).not.toContain('bakin_exec_gen_image')
    expect(raw).not.toContain('imagePath')
    expect(raw).not.toContain('Nano Banana')
  })
})
