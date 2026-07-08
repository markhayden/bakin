/**
 * Brands plugin REST surface (#419, spec §7.3).
 *
 * CRUD on brand records + guideline/lesson doc CRUD. Creation scaffolds
 * starter guidelines (skipped for drafts — the builder flow writes its own
 * intake). Every mutation emits `brand.changed` (SSE) and a structured audit
 * event.
 */
import { z } from 'zod'
import { defineRoute } from '@bakin/core/routing'
import type { PluginContextLite } from '@bakin/core/routing'
import { createLogger } from '../../../src/core/logger'
import {
  BrandStoreError,
  createBrand,
  deleteBrand,
  deleteDoc,
  getBrand,
  listBrands,
  listDocs,
  readDoc,
  saveManifest,
  writeDoc,
  type BrandDocKind,
} from './store'
import { brandIdSchema, brandManifestSchema } from './schemas'
import { computeBrandFingerprint } from './fingerprint'
import { scaffoldBrand } from './scaffold'

const log = createLogger('brands')

const passthrough = z.object({}).passthrough()
const errorResponse = z.object({ error: z.string() })

const brandIdParams = z.object({ brandId: z.string().min(1) })
const docParams = z.object({
  brandId: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
})

const createBrandBody = z.object({
  id: brandIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  draft: z.boolean().optional(),
})

/** Manifest PUT body: the manifest minus identity/timestamps (server-owned). */
const manifestPutBody = brandManifestSchema.omit({ id: true, createdAt: true, updatedAt: true })

function storeError(err: unknown): Response {
  if (err instanceof BrandStoreError) {
    const status = err.code === 'exists' ? 409 : err.code === 'missing' ? 404 : 400
    return Response.json({ error: err.message }, { status })
  }
  const message = err instanceof Error ? err.message : String(err)
  log.error('brands route failed', err instanceof Error ? err : new Error(message))
  return Response.json({ error: message }, { status: 500 })
}

function emitChanged(ctx: PluginContextLite, brandId: string, auditEvent: string): void {
  try {
    ctx.events.emit('brand.changed', { brandId })
    ctx.activity.audit(auditEvent, 'system', { brandId })
  } catch {
    log.warn('brand.changed emit unavailable', { brandId })
  }
}

function parseKind(kind: string): BrandDocKind | null {
  return kind === 'guidelines' || kind === 'lessons' ? kind : null
}

export const brandRoutes = [
  defineRoute({
    path: '/',
    method: 'GET',
    summary: 'List brands',
    description:
      'All brand manifests plus honestly-surfaced invalid entries (never silently skipped). Carries the effective warnUnbranded flag so the tasks UI needs no separate settings fetch.',
    responses: { 200: passthrough },
    handler: async (_req, ctx) => {
      let warnUnbranded = false
      try {
        warnUnbranded = Boolean(ctx.getSettings<{ warnUnbranded?: boolean }>().warnUnbranded)
      } catch {
        log.warn('brands settings unavailable; warnUnbranded defaults off')
      }
      return Response.json({ ...listBrands(), warnUnbranded })
    },
  }),

  defineRoute({
    path: '/',
    method: 'POST',
    summary: 'Create a brand',
    description:
      'Creates the brand directory + manifest and scaffolds starter guideline templates (skipped for drafts — the builder flow seeds its own intake).',
    body: createBrandBody,
    responses: { 200: passthrough, 400: errorResponse, 409: errorResponse },
    handler: async (_req, ctx, parsed) => {
      try {
        const brand = createBrand(parsed.body)
        const scaffolded = parsed.body.draft ? [] : scaffoldBrand(brand.id)
        emitChanged(ctx, brand.id, 'brand.created')
        return Response.json({ brand, scaffolded })
      } catch (err) {
        return storeError(err)
      }
    },
  }),

  defineRoute({
    path: '/blocked-tasks',
    method: 'GET',
    summary: 'Todo tasks currently deferring on a missing/draft brand',
    description:
      'Derived state for the board badge (#419) — effective brand resolved server-side (own → ancestry → project hook), never task metadata. Side-effect free.',
    responses: { 200: passthrough },
    handler: async (_req, ctx) => {
      const { resolveEffectiveBrandId } = await import('../../../src/core/dispatch-context-blocks')
      const todo = await ctx.tasks.list({ column: 'todo' })
      const perTask: Record<string, string> = {}
      for (const task of todo) {
        try {
          const brandId = await resolveEffectiveBrandId(task)
          if (!brandId) continue
          const read = getBrand(brandId)
          if (read.status !== 'ok' || read.manifest.draft) perTask[task.id] = brandId
        } catch {
          // Resolution failure for one task must not break the whole badge poll.
        }
      }
      return Response.json({ perTask })
    },
  }),

  defineRoute({
    path: '/:brandId',
    method: 'GET',
    summary: 'Get a brand',
    description: 'Manifest + guideline/lesson doc listings (with frontmatter descriptions) + content fingerprint.',
    params: brandIdParams,
    responses: { 200: passthrough, 404: errorResponse, 422: errorResponse },
    handler: async (_req, _ctx, parsed) => {
      const read = getBrand(parsed.params.brandId)
      if (read.status === 'missing') return Response.json({ error: 'brand not found' }, { status: 404 })
      if (read.status === 'invalid') return Response.json({ error: read.error }, { status: 422 })
      return Response.json({
        brand: read.manifest,
        guidelines: listDocs(read.manifest.id, 'guidelines'),
        lessons: listDocs(read.manifest.id, 'lessons'),
        fingerprint: computeBrandFingerprint(read.manifest.id),
      })
    },
  }),

  defineRoute({
    path: '/:brandId',
    method: 'PUT',
    summary: 'Replace a brand manifest',
    description: 'Full validated manifest replace. Identity + timestamps are server-owned (id immutable).',
    params: brandIdParams,
    body: manifestPutBody,
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const current = getBrand(parsed.params.brandId)
      if (current.status === 'missing') return Response.json({ error: 'brand not found' }, { status: 404 })
      if (current.status === 'invalid') return Response.json({ error: current.error }, { status: 422 })
      try {
        const brand = saveManifest({
          ...parsed.body,
          id: current.manifest.id,
          createdAt: current.manifest.createdAt,
          updatedAt: current.manifest.updatedAt,
        })
        emitChanged(ctx, brand.id, 'brand.updated')
        return Response.json({ brand })
      } catch (err) {
        return storeError(err)
      }
    },
  }),

  defineRoute({
    path: '/:brandId',
    method: 'DELETE',
    summary: 'Delete a brand',
    description: 'Removes the brand directory. The UI applies the linked-task deletion guard before calling this.',
    params: brandIdParams,
    body: { contentType: 'none' as const },
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      if (!deleteBrand(parsed.params.brandId)) {
        return Response.json({ error: 'brand not found' }, { status: 404 })
      }
      emitChanged(ctx, parsed.params.brandId, 'brand.deleted')
      return Response.json({ ok: true })
    },
  }),

  defineRoute({
    path: '/:brandId/docs/:kind/:name',
    method: 'GET',
    summary: 'Read a guideline or lesson doc',
    params: docParams,
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, _ctx, parsed) => {
      const kind = parseKind(parsed.params.kind)
      if (!kind) return Response.json({ error: `invalid doc kind: ${parsed.params.kind}` }, { status: 400 })
      try {
        const content = readDoc(parsed.params.brandId, kind, parsed.params.name)
        if (content === null) return Response.json({ error: 'doc not found' }, { status: 404 })
        return Response.json({ name: parsed.params.name, content })
      } catch (err) {
        return storeError(err)
      }
    },
  }),

  defineRoute({
    path: '/:brandId/docs/:kind/:name',
    method: 'PUT',
    summary: 'Write a guideline or lesson doc',
    params: docParams,
    body: z.object({ content: z.string() }),
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const kind = parseKind(parsed.params.kind)
      if (!kind) return Response.json({ error: `invalid doc kind: ${parsed.params.kind}` }, { status: 400 })
      const brand = getBrand(parsed.params.brandId)
      if (brand.status !== 'ok') return Response.json({ error: 'brand not found' }, { status: 404 })
      try {
        writeDoc(parsed.params.brandId, kind, parsed.params.name, parsed.body.content)
        emitChanged(ctx, parsed.params.brandId, 'brand.updated')
        return Response.json({ ok: true })
      } catch (err) {
        return storeError(err)
      }
    },
  }),

  defineRoute({
    path: '/:brandId/docs/:kind/:name',
    method: 'DELETE',
    summary: 'Delete a guideline or lesson doc',
    params: docParams,
    body: { contentType: 'none' as const },
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const kind = parseKind(parsed.params.kind)
      if (!kind) return Response.json({ error: `invalid doc kind: ${parsed.params.kind}` }, { status: 400 })
      try {
        if (!deleteDoc(parsed.params.brandId, kind, parsed.params.name)) {
          return Response.json({ error: 'doc not found' }, { status: 404 })
        }
        emitChanged(ctx, parsed.params.brandId, 'brand.updated')
        return Response.json({ ok: true })
      } catch (err) {
        return storeError(err)
      }
    },
  }),
]
