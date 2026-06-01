/**
 * POST /api/plugins/assets/upload — multipart file upload.
 * Accepts one or more files, auto-detects asset type, and creates a versioned
 * asset (v1) per file via the asset service. The manifest write triggers search
 * reindex + the asset.changed SSE event, so the grid refreshes on its own.
 */
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { PluginContext } from '@bakin/core/plugin-types'
import { getAssetType } from '../lib/constants'
import { createAsset } from '../lib/asset-service'
import type { AssetSource } from '../lib/manifest'

interface UploadSettings {
  maxFileSize?: number
}

interface UploadResult {
  ok: boolean
  assetId?: string
  filename: string
  error?: string
}

export async function handleUpload(req: Request, ctx: PluginContext): Promise<Response> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }

  const settings = ctx.getSettings<UploadSettings>()
  const maxFileSizeMB = settings.maxFileSize ?? 50
  const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024

  // Extract and validate form fields
  const rawTaskId = String(formData.get('taskId') || '').trim()
  if (rawTaskId && (rawTaskId.includes('/') || rawTaskId.includes('\\') || rawTaskId.includes('..'))) {
    return Response.json({ error: 'Invalid taskId' }, { status: 400 })
  }
  const taskId = rawTaskId || null
  const description = (formData.get('description') as string) || undefined
  const tagsRaw = formData.get('tags') as string
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined
  const sourceStr = String(formData.get('source') || 'upload')
  const sourceKind: AssetSource['kind'] = sourceStr === 'clipboard' ? 'clipboard' : 'upload'

  // Collect all file entries
  const files: File[] = []
  for (const [key, value] of formData.entries()) {
    // FormDataEntryValue is `string | File`; at runtime File from happy-dom
    // and the native File may not share an instanceof identity, so we sniff
    // for the shape instead (name + size + arrayBuffer).
    if ((key === 'file' || key === 'files') && typeof value !== 'string' && value !== null) {
      const f = value as unknown as { name?: string; size?: number }
      if (typeof f.name === 'string' && typeof f.size === 'number') {
        files.push(value as unknown as File)
      }
    }
  }

  if (files.length === 0) {
    return Response.json({ error: 'No file(s) provided — use "file" or "files" form field' }, { status: 400 })
  }

  // Validate file sizes
  for (const file of files) {
    if (file.size > maxFileSizeBytes) {
      return Response.json(
        { error: `File "${file.name}" exceeds ${maxFileSizeMB}MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)` },
        { status: 413 },
      )
    }
    if (file.size === 0) {
      return Response.json({ error: `File "${file.name}" is empty` }, { status: 400 })
    }
  }

  const results: UploadResult[] = []
  const tmpDir = join(tmpdir(), `bakin-upload-${randomUUID()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    for (const file of files) {
      const tmpPath = join(tmpDir, `${randomUUID()}-${file.name}`)

      // Write uploaded file to temp location
      const buffer = Buffer.from(await file.arrayBuffer())
      writeFileSync(tmpPath, buffer)

      try {
        const { assetId } = await createAsset({
          sourceFilePath: tmpPath,
          type: getAssetType(file.name),
          agent: 'user',
          taskId,
          slug: file.name,
          op: 'upload',
          description,
          tags,
          source: { kind: sourceKind, path: null },
        })
        results.push({ ok: true, assetId, filename: file.name })
        ctx.activity.log('user', `Uploaded "${file.name}"`, taskId ? { taskId } : {})
        ctx.activity.audit('uploaded', 'user', { assetId, source: sourceKind, taskId })
      } catch (err) {
        results.push({ ok: false, filename: file.name, error: err instanceof Error ? err.message : String(err) })
      } finally {
        try { unlinkSync(tmpPath) } catch { /* best-effort */ }
      }
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }

  const allOk = results.every(r => r.ok)

  if (results.length === 1) {
    return Response.json(results[0], { status: results[0].ok ? 200 : 500 })
  }

  return Response.json({ results, ok: allOk }, { status: allOk ? 200 : 207 })
}
