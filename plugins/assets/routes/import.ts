/**
 * HTTP handlers for the explicit-import flow (D7). Scan is on-demand and
 * readdir-only; import creates versioned assets (op:'import') and consumes
 * sources. Every scan reseeds the live unmanaged tracker so the badge
 * self-corrects; every import path is an explicit user action — nothing
 * here is ever called automatically.
 */
import { ASSET_TYPES, type AssetType } from '../lib/constants'
import { scanUnmanaged, importUnmanagedFile, type ImportResult } from '../lib/import-unmanaged'
import { reseedUnmanaged } from '../lib/unmanaged-tracker'

interface ActivityCtx { activity?: { audit: (event: string, agent: string, data: Record<string, unknown>) => void } }

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function parseType(value: unknown): AssetType | undefined {
  return typeof value === 'string' && (ASSET_TYPES as readonly string[]).includes(value)
    ? (value as AssetType)
    : undefined
}

/** GET /import/scan — list unmanaged files (reseeds the badge tracker). */
export async function handleImportScan(): Promise<Response> {
  try {
    const files = scanUnmanaged()
    reseedUnmanaged(files.map(f => f.relPath))
    return Response.json({ files, count: files.length })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}

/** POST /import — import named paths or everything ({ paths?, all?, type? }). */
export async function handleImport(req: Request, ctx?: ActivityCtx): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { paths?: unknown; all?: unknown; type?: unknown }
  const type = parseType(body.type)
  const all = body.all === true
  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : []
  if (!all && paths.length === 0) {
    return Response.json({ error: 'Provide paths[] or all: true' }, { status: 400 })
  }

  try {
    const targets = all ? scanUnmanaged().map(f => f.relPath) : paths
    const results: ImportResult[] = []
    for (const rel of targets) {
      results.push(await importUnmanagedFile(rel, type ? { type } : undefined))
    }
    // Reseed from a fresh scan so the badge reflects what's left.
    reseedUnmanaged(scanUnmanaged().map(f => f.relPath))
    const imported = results.filter(r => r.ok)
    for (const r of imported) {
      ctx?.activity?.audit('asset.imported', 'user', { assetId: r.assetId, from: r.relPath })
    }
    return Response.json({
      ok: results.every(r => r.ok),
      imported: imported.length,
      failed: results.length - imported.length,
      results,
    })
  } catch (err) {
    return Response.json({ error: errMsg(err) }, { status: 500 })
  }
}
