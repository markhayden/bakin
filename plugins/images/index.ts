/**
 * Images plugin — provider-routed image generation primitives.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { BakinPlugin, HealthCheckResult, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { loadDefaultWorkflows } from '../workflows/lib/load-defaults'
import { DEFAULT_IMAGE_SETTINGS, listImageProviders, providerReadiness } from './lib/providers'
import { getImageProfile, listImageProfiles } from './lib/platform-profiles'
import { editImage, exportImage, generateImage, importImage } from './lib/tools'
import { recommendImageRoute } from './lib/routing'

const log = createLogger('images')

const okResponse = z.object({ ok: z.boolean() }).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()

const profileQuery = z.object({
  id: z.string().optional(),
})

const profileToolShape = {
  profileId: z.string().optional().describe('Optional surface profile id to return. Omit to list all profiles.'),
  includeProviders: z.boolean().default(true).describe('Include provider readiness and routable model metadata.'),
}

const imageProviderEnum = z.enum(['auto', 'openai', 'google'])
const imageQualityEnum = z.enum(['draft', 'standard', 'premium'])
const imageFormatEnum = z.enum(['jpg', 'png', 'webp'])

const recommendShape = {
  surface: z.string().optional().describe('Target surface profile id, such as instagram-feed-portrait or blog-hero.'),
  objective: z.string().optional().describe('Creative/business goal used for model routing, such as CTR, brand photography, typography, or landing page hero.'),
  provider: imageProviderEnum.optional().describe('Optional forced provider. Use auto to let the router choose.'),
  model: z.string().optional().describe('Optional model id. May be provider/model or a provider-specific model id.'),
  quality: imageQualityEnum.optional().describe('Requested quality tier.'),
}

const generateShape = {
  prompt: z.string().optional().describe('Provider-neutral image prompt. Required unless promptPacket is supplied.'),
  promptPacket: z.record(z.string(), z.unknown()).optional().describe('Structured prompt packet compiled into the provider prompt.'),
  taskId: z.string().min(1).describe('Task ID to link the generated image asset.'),
  surface: z.string().optional().describe('Image surface profile id, such as instagram-feed-portrait or google-display-landscape.'),
  provider: imageProviderEnum.optional().describe('Provider route. Defaults to auto routing.'),
  model: z.string().optional().describe('Provider model id, such as gpt-image-2 or gemini-3.1-flash-image.'),
  width: z.number().int().positive().optional().describe('Optional custom width. Defaults from surface profile.'),
  height: z.number().int().positive().optional().describe('Optional custom height. Defaults from surface profile.'),
  quality: imageQualityEnum.optional().describe('Generation quality tier.'),
  savePromptPacket: z.boolean().optional().describe('Save the full prompt packet as a linked text asset. Use for approval-gated workflows.'),
}

const importShape = {
  filePath: z.string().min(1).describe('Absolute path to an existing image file to import into Assets.'),
  taskId: z.string().min(1).describe('Task ID to link the imported image asset.'),
  description: z.string().optional().describe('Human-readable asset description.'),
  tags: z.array(z.string()).optional().describe('Asset tags.'),
}

const exportShape = {
  filename: z.string().min(1).describe('Canonical source image asset filename.'),
  taskId: z.string().min(1).describe('Task ID to link the exported variant asset.'),
  surface: z.string().optional().describe('Target surface profile id. Use custom with width and height for custom exports.'),
  width: z.number().int().positive().optional().describe('Override export width.'),
  height: z.number().int().positive().optional().describe('Override export height.'),
  format: imageFormatEnum.optional().describe('Output format.'),
  quality: z.number().int().min(1).max(100).optional().describe('JPEG/WebP quality from 1 to 100.'),
}

const editShape = {
  filename: z.string().min(1).describe('Canonical source image asset filename.'),
  prompt: z.string().min(1).describe('Image edit prompt.'),
  taskId: z.string().min(1).describe('Task ID to link the edited image asset.'),
}

const routes = [
  defineRoute({
    path: '/profiles',
    method: 'GET',
    summary: 'List image surface profiles',
    query: profileQuery,
    responses: { 200: okResponse, 404: errorResponse },
    handler: async (_req, _ctx, { query }) => {
      if (query.id) {
        const profile = getImageProfile(query.id)
        if (!profile) return Response.json({ error: `Unknown image profile: ${query.id}` }, { status: 404 })
        return Response.json({ ok: true, profile })
      }
      return Response.json({ ok: true, profiles: listImageProfiles() })
    },
  }),
  defineRoute({
    path: '/providers',
    method: 'GET',
    summary: 'List image providers and readiness',
    responses: { 200: okResponse },
    handler: async (_req, ctx) => Response.json({
      ok: true,
      providers: listImageProviders(),
      readiness: await providerReadiness(ctx as PluginContext),
    }),
  }),
]

async function checkImages(ctx: PluginContext): Promise<HealthCheckResult[]> {
  const rows: HealthCheckResult[] = []
  const readiness = await providerReadiness(ctx)
  const readyProviders = readiness.filter(provider => provider.routable)

  rows.push({
    check: 'images.assets',
    status: typeof ctx.assets.save === 'function' ? 'ok' : 'error',
    message: typeof ctx.assets.save === 'function'
      ? 'Images plugin can save generated files through the Assets plugin API.'
      : 'Images plugin cannot save generated files because ctx.assets.save is unavailable.',
    autoFixable: false,
  })

  rows.push({
    check: 'images.profiles',
    status: listImageProfiles().length > 0 ? 'ok' : 'error',
    message: `${listImageProfiles().length} image surface profiles registered.`,
    autoFixable: false,
  })

  rows.push({
    check: 'images.providers',
    status: readyProviders.length > 0 ? 'ok' : 'warn',
    message: readyProviders.length > 0
      ? `${readyProviders.map(provider => provider.label).join(', ')} configured for image generation.`
      : 'No image provider credentials found. Set OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_AI_API_KEY.',
    autoFixable: false,
  })

  return rows
}

const imagesPlugin = definePlugin({
  id: 'images',
  name: 'Images',
  version: '0.1.0',
  routes,
  settingsSchema: {
    fields: [
      {
        key: 'defaultProvider',
        label: 'Default provider',
        description: 'Provider routing policy for image generation.',
        type: 'select',
        default: DEFAULT_IMAGE_SETTINGS.defaultProvider,
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'openai', label: 'OpenAI' },
          { value: 'google', label: 'Google Gemini' },
        ],
      },
      {
        key: 'defaultSurface',
        label: 'Default surface',
        description: 'Surface profile used when a workflow does not specify a target platform.',
        type: 'select',
        default: DEFAULT_IMAGE_SETTINGS.defaultSurface,
        options: listImageProfiles().map(profile => ({ value: profile.id, label: profile.label })),
      },
      {
        key: 'quality',
        label: 'Default quality',
        description: 'Default generation quality tier.',
        type: 'select',
        default: DEFAULT_IMAGE_SETTINGS.quality,
        options: [
          { value: 'draft', label: 'Draft' },
          { value: 'standard', label: 'Standard' },
          { value: 'premium', label: 'Premium' },
        ],
      },
    ],
  },
  navItems: [],
  contentFiles: [],
  activate(ctx: PluginContext) {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const defaultsLoaded = loadDefaultWorkflows(ctx, join(moduleDir, 'defaults', 'workflows'), log)
    if (defaultsLoaded.registered.length > 0) {
      log.info(`Registered ${defaultsLoaded.registered.length} image workflow(s)`, {
        ids: defaultsLoaded.registered,
      })
    }

    ctx.registerExecTool({
      name: 'bakin_exec_images_recommend',
      description: 'Recommend a deterministic image provider, model, surface profile, dimensions, and quality tier for an image generation request.',
      label: 'Recommended an image route',
      parameters: recommendShape,
      handler: async (params) => recommendImageRoute(ctx, params as never),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_generate',
      description: 'Generate an image through a configured native image provider adapter, save it into Assets, and return the canonical image filename.',
      label: 'Generated an image',
      parameters: generateShape,
      handler: async (params, agent) => generateImage(ctx, params as never, agent),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_import',
      description: 'Import an existing local image file into the Assets pipeline and return the canonical image filename.',
      label: 'Imported an image',
      parameters: importShape,
      handler: async (params, agent) => importImage(ctx, params as never, agent),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_export',
      description: 'Export an existing image asset to a target surface profile by resizing, cropping, and format-converting it.',
      label: 'Exported an image',
      parameters: exportShape,
      handler: async (params, agent) => exportImage(ctx, params as never, agent),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_edit',
      description: 'Edit an existing image asset through a configured image provider. This tool is reserved for provider edit adapters.',
      label: 'Edited an image',
      parameters: editShape,
      handler: async () => editImage(),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_profiles',
      description: 'List image surface profiles and configured provider readiness. Use this before choosing dimensions or provider routes for image generation.',
      label: 'Listed image profiles',
      parameters: profileToolShape,
      handler: async (params) => {
        const profileId = typeof params.profileId === 'string' ? params.profileId : undefined
        const includeProviders = params.includeProviders !== false
        const profile = profileId ? getImageProfile(profileId) : null
        if (profileId && !profile) return { ok: false, error: `Unknown image profile: ${profileId}` }
        return {
          ok: true,
          ...(profile ? { profile } : { profiles: listImageProfiles() }),
          ...(includeProviders ? { providers: await providerReadiness(ctx) } : {}),
        }
      },
    })

    ctx.registerHealthCheck({
      id: 'readiness',
      name: 'Image generation readiness',
      run: async () => checkImages(ctx),
    })
  },
}) as unknown as BakinPlugin

export default imagesPlugin
