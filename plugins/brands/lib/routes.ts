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
import { buildBrandCard } from './card'
import { computeCompleteness, summarizeCompleteness } from './completeness'

/** Completeness over the manifest + the two scaffold-seeded guideline docs. */
function brandCompleteness(manifest: Parameters<typeof computeCompleteness>[0]) {
  return computeCompleteness(manifest, {
    voice: readDoc(manifest.id, 'guidelines', 'voice.md'),
    styleGuide: readDoc(manifest.id, 'guidelines', 'style-guide.md'),
  })
}

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
      const { brands, invalid } = listBrands()
      return Response.json({
        brands: brands.map((b) => ({
          ...b,
          counts: {
            guidelines: listDocs(b.id, 'guidelines').length,
            lessons: listDocs(b.id, 'lessons').length,
            assets: new Set([
              ...b.logos.map((l) => l.assetId),
              ...b.assetGroups.flatMap((g) => g.assetIds),
            ]).size,
          },
          completeness: summarizeCompleteness(brandCompleteness(b)),
        })),
        invalid,
        warnUnbranded,
      })
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
          const effective = await resolveEffectiveBrandId(task)
          if (!effective) continue
          if ('unresolved' in effective) {
            // Project-brand hook errored — the gate is deferring this task.
            perTask[task.id] = `project:${task.projectId ?? '?'}`
            continue
          }
          const read = getBrand(effective.brandId)
          if (read.status !== 'ok' || read.manifest.draft) perTask[task.id] = effective.brandId
        } catch {
          // Resolution failure for one task must not break the whole badge poll.
        }
      }
      return Response.json({ perTask })
    },
  }),

  defineRoute({
    path: '/builder',
    method: 'POST',
    summary: 'Build-my-brand: create a draft + dispatch the drafting task',
    description:
      'The cold-start flow (§9.1): questionnaire answers become guidelines/_intake.md on a draft brand (invisible to pickers/resolution/injection), and a NORMAL Bakin task dispatches to the chosen agent, which authors the brand via the draft-gated write tools. Publish makes it real.',
    body: z
      .object({
        id: brandIdSchema,
        name: z.string().min(1),
        agent: z.string().min(1),
        /** Optional in website mode — the agent extracts what-we-sell from the sources. */
        product: z.string().min(1).optional(),
        audience: z.string().optional(),
        tone: z.string().optional(),
        competitors: z.string().optional(),
        /** Website/style-guide URLs the agent mines. Required when no product is given. */
        urls: z.string().optional(),
        notes: z.string().optional(),
        /** Optional logo the operator uploaded in the wizard (already a managed assetId). */
        logoAssetId: z.string().optional(),
      })
      .refine((b) => Boolean(b.product?.trim()) || Boolean(b.urls?.trim()), {
        message: 'either product or urls is required — the agent needs SOMETHING to author from',
      }),
    responses: { 200: passthrough, 400: errorResponse, 409: errorResponse, 500: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const b = parsed.body
      // Track whether THIS call created the draft so a later failure can roll it
      // back — otherwise a half-authored orphan is left on disk and every retry
      // with the same id trips createBrand's 'exists' → 409, blocking the wizard.
      let createdHere = false
      try {
        const brand = createBrand({ id: b.id, name: b.name, draft: true })
        createdHere = true
        // Wire the uploaded logo onto the draft so it shows on the dashboard
        // immediately (the drafting agent fills the rest).
        if (b.logoAssetId) {
          const { updateBrand } = await import('./store')
          await updateBrand(brand.id, (m) => ({ ...m, logos: [{ assetId: b.logoAssetId!, variant: 'primary' }] }))
        }
        const intake = [
          '---',
          'description: Builder-flow intake — the raw material this brand was authored from',
          '---',
          '',
          `# Brand intake: ${b.name}`,
          '',
          ...(b.product ? [`- What we sell: ${b.product}`] : []),
          ...(b.audience ? [`- Audience: ${b.audience}`] : []),
          ...(b.tone ? [`- Tone words: ${b.tone}`] : []),
          ...(b.competitors ? [`- Competitors: ${b.competitors}`] : []),
          ...(b.urls ? [`- Source URLs to mine: ${b.urls}`] : []),
          ...(b.notes ? ['', '## Notes', '', b.notes] : []),
          '',
        ].join('\n')
        writeDoc(brand.id, 'guidelines', '_intake.md', intake)

        // Source mining is a numbered step of its own when URLs exist — the
        // website-mode flow may carry NOTHING except a name and these links.
        const miningStep = b.urls
          ? [
              `Fetch and READ each source URL from the intake (${b.urls}). Extract: the palette (real hex values from the site's CSS/design), voice and tone (how they actually write), terminology (product names, phrases they repeat, words they avoid), and logo candidates. Append a '## Source findings' section to _intake.md via bakin_exec_brands_write_doc recording what came from where.`,
            ]
          : []
        const steps = [
          `Read the intake: bakin_exec_brands_read_doc brandId="${brand.id}" kind="guidelines" name="_intake.md".`,
          ...miningStep,
          `Write voice.md (personality, sentences we would/would never write, audience) and style-guide.md (color usage, imagery, formatting) via bakin_exec_brands_write_doc.`,
          `Set description, palette (real hex colors), rules (absolute do/don'ts), and terminology via bakin_exec_brands_update_manifest.`,
          `Do NOT touch other brands. When done, complete this task — the operator reviews the draft on the Branding page and publishes it.`,
        ]

        // A NORMAL task — deliberately unbranded (a draft brand would trip
        // the dispatch brand gate); the description names the draft instead.
        const task = await ctx.tasks.create({
          title: `Author brand '${brand.id}' from its intake`,
          agent: b.agent,
          description: [
            `Author the DRAFT brand '${brand.id}' from its intake${b.urls ? ' and source URLs' : ' questionnaire'}.`,
            '',
            ...steps.map((s, i) => `${i + 1}. ${s}`),
          ].join('\n'),
          skipWorkflowReason: 'brand-builder authoring task — direct tool work, no workflow applies',
        })
        emitChanged(ctx, brand.id, 'brand.created')
        const current = getBrand(brand.id)
        return Response.json({ brand: current.status === 'ok' ? current.manifest : brand, taskId: task.id })
      } catch (err) {
        if (createdHere) {
          try {
            deleteBrand(b.id)
          } catch (cleanupErr) {
            log.warn('builder rollback failed to delete orphaned draft', cleanupErr, { brandId: b.id })
          }
        }
        return storeError(err)
      }
    },
  }),

  defineRoute({
    path: '/:brandId/publish',
    method: 'POST',
    summary: 'Publish a draft brand',
    description: 'Flips draft off — the brand becomes visible to pickers, resolution, and injection. Audited.',
    params: brandIdParams,
    body: { contentType: 'none' as const },
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const read = getBrand(parsed.params.brandId)
      if (read.status === 'missing') return Response.json({ error: 'brand not found' }, { status: 404 })
      if (read.status === 'invalid') return Response.json({ error: read.error }, { status: 422 })
      if (!read.manifest.draft) return Response.json({ error: 'brand is already published' }, { status: 400 })
      try {
        const { updateBrand } = await import('./store')
        const brand = await updateBrand(parsed.params.brandId, (m) => {
          const { draft: _draft, ...rest } = m
          return rest
        })
        try {
          ctx.activity.audit('brand.draft_published', 'system', { brandId: brand.id })
        } catch { /* activity surface unavailable (tests) */ }
        ctx.events.emit('brand.changed', { brandId: brand.id })
        return Response.json({ brand })
      } catch (err) {
        return storeError(err)
      }
    },
  }),

  defineRoute({
    path: '/import/preview',
    method: 'POST',
    summary: 'Validate + summarize a portable brand source — writes NOTHING',
    description:
      'The confirm step before install (S6): fetches github sources into a staging dir, validates the portable manifest, and returns name/palette/doc/asset counts. Zero writes to the brand store or asset store.',
    body: z.object({ source: z.string().min(1) }),
    responses: { 200: passthrough, 400: errorResponse },
    handler: async (_req, _ctx, parsed) => {
      const { materializeImportSource } = await import('./github-import')
      const { validatePortableDir } = await import('./portable')
      let materialized
      try {
        materialized = await materializeImportSource(parsed.body.source)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
      }
      try {
        const validated = validatePortableDir(materialized.dir)
        if (!validated.ok) return Response.json({ error: validated.error }, { status: 400 })
        const existing = getBrand(validated.portable.id)
        return Response.json({
          preview: {
            id: validated.portable.id,
            name: validated.portable.name,
            description: validated.portable.description,
            palette: validated.portable.palette,
            rules: validated.portable.rules?.length ?? 0,
            guidelines: validated.guidelines.length,
            lessons: validated.lessons.length,
            assets: validated.files.length,
            exists: existing.status !== 'missing',
            ...(materialized.provenance.commit ? { commit: materialized.provenance.commit } : {}),
          },
        })
      } finally {
        materialized.cleanup()
      }
    },
  }),

  defineRoute({
    path: '/import',
    method: 'POST',
    summary: 'Import a portable brand from a local path or github source',
    description:
      'Validates the portable manifest, ingests referenced files as managed assets, rewrites path refs → assetIds, stamps provenance ({repo, ref, commit}). Never writes on validation failure; existing ids require overwrite consent (local edits win). Private repos use the operator\'s ambient git credentials.',
    body: z.object({
      source: z.string().min(1),
      overwrite: z.boolean().optional(),
    }),
    responses: { 200: passthrough, 400: errorResponse, 409: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const { materializeImportSource } = await import('./github-import')
      const { importBrand } = await import('./portable')
      let materialized
      try {
        materialized = await materializeImportSource(parsed.body.source)
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
      }
      try {
        const result = await importBrand({
          sourceDir: materialized.dir,
          ctx: ctx as never,
          source: materialized.provenance.source,
          ref: materialized.provenance.ref,
          commit: materialized.provenance.commit,
          overwrite: parsed.body.overwrite,
        })
        emitChanged(ctx, result.brand.id, 'brand.imported')
        return Response.json(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return Response.json({ error: message }, { status: err instanceof BrandStoreError && err.code === 'exists' ? 409 : 400 })
      } finally {
        materialized.cleanup()
      }
    },
  }),

  defineRoute({
    path: '/import/check',
    method: 'GET',
    summary: "Drift check: is an installed brand behind its upstream repo?",
    description:
      'Compares the installed brand\'s provenance commit against the current upstream commit (S6). Read-only — refreshing is an explicit re-import.',
    query: z.object({ id: z.string().min(1) }),
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, _ctx, parsed) => {
      const read = getBrand(parsed.query.id)
      if (read.status !== 'ok') return Response.json({ error: 'brand not found' }, { status: 404 })
      const source = read.manifest.source
      if (!source) return Response.json({ error: 'brand was not imported from a source' }, { status: 400 })
      try {
        const { latestUpstreamCommit, isGithubSource } = await import('./github-import')
        if (!isGithubSource(source.repo)) {
          return Response.json({ error: 'brand source is not a github repo' }, { status: 400 })
        }
        const latest = await latestUpstreamCommit(source.repo, source.ref)
        return Response.json({
          brandId: read.manifest.id,
          installedCommit: source.commit ?? null,
          latestCommit: latest,
          drift: !!source.commit && source.commit !== latest,
        })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
      }
    },
  }),

  defineRoute({
    path: '/:brandId/export',
    method: 'POST',
    summary: 'Export a brand to a portable directory',
    description: 'Writes the portable layout (brand.json with relative file refs, guidelines/, lessons/, assets/) to destDir.',
    params: brandIdParams,
    body: z.object({ destDir: z.string().min(1) }),
    responses: { 200: passthrough, 400: errorResponse, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const { exportBrand } = await import('./portable')
      try {
        const result = await exportBrand(parsed.params.brandId, parsed.body.destDir, ctx as never)
        try {
          ctx.activity.audit('brand.exported', 'system', { brandId: parsed.params.brandId, dir: result.dir })
        } catch { /* activity surface unavailable (tests) */ }
        return Response.json(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return Response.json({ error: message }, { status: err instanceof BrandStoreError && err.code === 'missing' ? 404 : 400 })
      }
    },
  }),

  defineRoute({
    path: '/task-context/:taskId',
    method: 'GET',
    summary: "A task's effective brand + provenance + blocked state",
    description:
      'The task Brand panel source (#419): which brand applies (own / inherited from parent / project), and whether it currently resolves to a published brand.',
    params: z.object({ taskId: z.string().min(1) }),
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const task = await ctx.tasks.get(parsed.params.taskId)
      if (!task) return Response.json({ error: 'task not found' }, { status: 404 })
      const { resolveEffectiveBrand } = await import('../../../src/core/dispatch-context-blocks')
      const effective = await resolveEffectiveBrand(task)
      if (!effective) return Response.json({ brand: null })
      if ('unresolved' in effective) {
        // Project-brand hook errored — surface the blocked state honestly.
        return Response.json({
          brand: { brandId: `project:${effective.projectId}`, source: 'project', blocked: true, name: undefined },
        })
      }
      const read = getBrand(effective.brandId)
      const blocked = read.status !== 'ok' || !!read.manifest.draft
      return Response.json({
        brand: {
          brandId: effective.brandId,
          source: effective.source,
          blocked,
          name: read.status === 'ok' ? read.manifest.name : undefined,
        },
      })
    },
  }),

  defineRoute({
    path: '/injections/:taskId',
    method: 'GET',
    summary: "A task's recent brand.injected records",
    description:
      'Injection observability (#419, spec §5.5): what the agent actually saw per dispatch. Bounded read (7d window, post-filtered by taskId) — never an unbounded audit scan.',
    params: z.object({ taskId: z.string().min(1) }),
    responses: { 200: passthrough },
    handler: async (_req, _ctx, parsed) => {
      const { queryAuditEvents } = await import('../../../src/core/audit')
      const { getContentDir } = await import('../../../src/core/content-dir')
      const events = queryAuditEvents(getContentDir(), {
        kinds: ['brand.injected'],
        sinceMs: 7 * 24 * 60 * 60 * 1000,
        limit: 500,
      })
      const injections = events
        .filter((e) => (e.data as { taskId?: string } | undefined)?.taskId === parsed.params.taskId)
        .slice(-20)
        .reverse()
        .map((e) => ({ ts: e.ts, agent: e.agent, ...(e.data as Record<string, unknown>) }))
      return Response.json({ injections })
    },
  }),

  defineRoute({
    path: '/:brandId/activity',
    method: 'GET',
    summary: "A brand's recent activity",
    description:
      "Recent brand.* audit events scoped to one brand (created/updated/imported, injections into dispatches, lesson adds, blocks, publishes). Bounded 30d read, post-filtered by brandId — the Overview dashboard's activity feed.",
    params: brandIdParams,
    responses: { 200: passthrough },
    handler: async (_req, _ctx, parsed) => {
      const { queryAuditEvents } = await import('../../../src/core/audit')
      const { getContentDir } = await import('../../../src/core/content-dir')
      const events = queryAuditEvents(getContentDir(), {
        kinds: [
          'brand.created', 'brand.updated', 'brand.imported', 'brand.exported',
          'brand.injected', 'brand.lesson_added', 'brand.dispatch_blocked',
          'brand.asset_missing', 'brand.lessons_unavailable', 'brand.draft_published',
        ],
        sinceMs: 30 * 24 * 60 * 60 * 1000,
        // Scope to THIS brand inside the bounded scan — the tail read stops at 25
        // matches for this brand, so a busy neighbour can't push its events out of
        // the window before we filter (a fleet-wide cap + post-filter did exactly that).
        match: (e) => (e.data as { brandId?: string } | undefined)?.brandId === parsed.params.brandId,
        limit: 25,
      })
      const activity = events
        .reverse()
        .map((e) => ({ ts: e.ts, event: e.event, agent: e.agent, data: e.data as Record<string, unknown> }))
      return Response.json({ activity })
    },
  }),

  defineRoute({
    path: '/:brandId/integrity',
    method: 'GET',
    summary: "A brand's dangling-reference report",
    description: 'Shared integrity scan (lib/integrity.ts — same engine as the brands.integrity doctor check). Structured data, never message text.',
    params: brandIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const read = getBrand(parsed.params.brandId)
      if (read.status === 'missing') return Response.json({ error: 'brand not found' }, { status: 404 })
      const { scanBrandIntegrity } = await import('./integrity')
      const report = await scanBrandIntegrity(
        async (assetId) => (await ctx.assets.getAsset(assetId)) !== null,
        parsed.params.brandId,
      )
      return Response.json(report)
    },
  }),

  defineRoute({
    path: '/:brandId/card-preview',
    method: 'GET',
    summary: 'Render the exact dispatch card this brand would inject right now',
    description:
      'Debug/observability surface (#419): same pure builder as dispatch, current budget from settings. "What would inject now" vs the brand.injected audit\'s "what injected then".',
    params: brandIdParams,
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, _ctx, parsed) => {
      const [{ resolveBrandContextBudget }, { getSettings }] = await Promise.all([
        import('../../../src/core/dispatch-context-blocks'),
        import('../../../src/core/settings'),
      ])
      const maxBytes = resolveBrandContextBudget(getSettings().dispatch?.maxBrandContextBytes)
      const result = await buildBrandCard(parsed.params.brandId, { maxBytes })
      if ('notFound' in result) return Response.json({ error: 'brand not found (or draft)' }, { status: 404 })
      return Response.json({ ...result, maxBytes })
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
        completeness: brandCompleteness(read.manifest),
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
    path: '/:brandId/lessons',
    method: 'POST',
    summary: 'Append a brand lesson (collision-safe)',
    description:
      'The quick-add path (#419 §6): append-only — never overwrites an existing lesson with the same slug (suffixes a counter). Use this instead of PUT docs/lessons/<name> for banked learnings.',
    params: brandIdParams,
    body: z.object({ title: z.string().min(1), body: z.string().min(1) }),
    responses: { 200: passthrough, 404: errorResponse },
    handler: async (_req, ctx, parsed) => {
      const brand = getBrand(parsed.params.brandId)
      if (brand.status !== 'ok') return Response.json({ error: 'brand not found' }, { status: 404 })
      try {
        const { addLesson } = await import('./store')
        const name = addLesson(parsed.params.brandId, parsed.body.title, parsed.body.body)
        emitChanged(ctx, parsed.params.brandId, 'brand.lesson_added')
        return Response.json({ ok: true, lesson: name })
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
