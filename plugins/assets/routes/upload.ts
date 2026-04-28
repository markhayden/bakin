/**
 * POST /api/plugins/assets/upload — multipart file upload.
 * Accepts one or more files, auto-detects asset type, creates sidecar metadata.
 */
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { PluginContext } from '@bakin/core/plugin-types'
import { getAssetType } from '../lib/constants'
import { saveAsset, type SaveAssetResult } from '../lib/save-asset'
import type { AssetSource } from '../lib/sidecar'

interface UploadSettings {
  maxFileSize?: number
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
  const rawTaskId = String(formData.get('taskId') || '').trim() || '_unlinked'
  if (rawTaskId !== '_unlinked' && (rawTaskId.includes('/') || rawTaskId.includes('\\') || rawTaskId.includes('..'))) {
    return Response.json({ error: 'Invalid taskId' }, { status: 400 })
  }
  const taskId = rawTaskId
  const description = (formData.get('description') as string) || undefined
  const tagsRaw = formData.get('tags') as string
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined
  const sourceStr = String(formData.get('source') || 'upload')
  const source: AssetSource = (['agent', 'upload', 'clipboard'].includes(sourceStr) ? sourceStr : 'upload') as AssetSource

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

  const results: SaveAssetResult[] = []
  const tmpDir = join(tmpdir(), `bakin-upload-${randomUUID()}`)
  mkdirSync(tmpDir, { recursive: true })

  try {
    for (const file of files) {
      const tmpPath = join(tmpDir, `${randomUUID()}-${file.name}`)

      // Write uploaded file to temp location
      const buffer = Buffer.from(await file.arrayBuffer())
      writeFileSync(tmpPath, buffer)

      const assetType = getAssetType(file.name)

      const result = await saveAsset({
        filePath: tmpPath,
        taskId,
        type: assetType,
        agent: 'user',
        description,
        tags,
        source,
        originalFilename: file.name,
      })

      results.push(result)

      // Clean up temp file
      try { unlinkSync(tmpPath) } catch { /* best-effort */ }

      if (result.ok) {
        ctx.activity.log('user', `Uploaded "${file.name}"`, { taskId: taskId !== '_unlinked' ? taskId : undefined })
        ctx.activity.audit('uploaded', 'user', { path: result.path, source, taskId })
      }
    }
  } finally {
    // Clean up temp directory
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }

  const allOk = results.every(r => r.ok)
  const status = allOk ? 200 : 207 // 207 Multi-Status if partial failure

  if (results.length === 1) {
    return Response.json(results[0], { status: results[0].ok ? 200 : 500 })
  }

  return Response.json({ results, ok: allOk }, { status })
}
