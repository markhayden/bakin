/**
 * GET /api/curated
 *
 * Returns the curated-agent catalog shipped inside the Bakin binary.
 * The Teams UI's "browse curated" view consumes this; one-click install
 * sends `source` straight to /api/agent-packages/install.
 *
 * No registry yet — bare-name install (`bakin agents install pixel`)
 * still errors out per spec. The catalog is just a static lookup table
 * the UI uses to surface suggestions.
 *
 * Schema lives at packages/host/src/data/curated-agents.json. The asset
 * file is read at request time rather than imported at module-load so
 * the response always reflects what's on disk (matters for dev mode
 * + test fixtures; in the binary the file is embedded by the compiler
 * via the embedded-assets manifest).
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

const CuratedAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().optional(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  source: z.string().min(1),
  ref: z.string().nullable().default(null),
  trust: z.enum(['official', 'verified', 'community']).default('community'),
  iconUrl: z.string().optional(),
})

const CuratedCatalogSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  agents: z.array(CuratedAgentSchema),
})

export type CuratedAgent = z.infer<typeof CuratedAgentSchema>
export type CuratedCatalog = z.infer<typeof CuratedCatalogSchema>

const CATALOG_PATH = join(import.meta.dir, '..', '..', 'data', 'curated-agents.json')

export async function get(_req: Request, _url: URL): Promise<Response> {
  if (!existsSync(CATALOG_PATH)) {
    return Response.json(
      { ok: false, error: 'Curated catalog missing from binary build' },
      { status: 500 },
    )
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'))
  } catch (err) {
    return Response.json(
      { ok: false, error: `Curated catalog malformed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
  const parsed = CuratedCatalogSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: `Curated catalog schema violation: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      },
      { status: 500 },
    )
  }
  return Response.json({ ok: true, catalog: parsed.data })
}
