/**
 * Images plugin — provider-routed image generation primitives.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { ExecToolResult, HealthCheckRunInput, PluginContext } from '@bakin/core/plugin-types'
import { healthError, healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { loadDefaultWorkflows } from '@bakin/core/workflows/load-defaults'
import { DEFAULT_IMAGE_SETTINGS, listImageProviders, providerReadiness } from './lib/providers'
import { getImageProfile, listImageProfiles, IMAGE_SURFACE_IDS } from './lib/platform-profiles'
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

const imageProviderRoute = z.string().min(1)
const imageQualityEnum = z.enum(['draft', 'standard', 'premium'])
const imageFormatEnum = z.enum(['jpg', 'png', 'webp'])
// Valid surface ids ship IN the tool schema (derived from the profile
// table) so the model picks a real one instead of guessing 'square' and
// bouncing off a free-string rejection into a discovery call.
const surfaceEnum = z.enum(IMAGE_SURFACE_IDS)
// export additionally accepts 'custom' (with explicit width/height).
const exportSurfaceEnum = z.enum([...IMAGE_SURFACE_IDS, 'custom'] as [string, ...string[]])

const recommendShape = {
  surface: surfaceEnum.optional().describe('Target surface profile id.'),
  objective: z.string().optional().describe('Creative/business goal used for model routing, such as CTR, brand photography, typography, or landing page hero.'),
  provider: imageProviderRoute.optional().describe('Optional forced provider. Use auto to let the router choose, or pass a runtime provider id such as openai, google, openrouter, fal, or xai.'),
  model: z.string().optional().describe('Optional model id. May be provider/model or a provider-specific model id.'),
  quality: imageQualityEnum.optional().describe('Requested quality tier.'),
}

const generateShape = {
  prompt: z.string().optional().describe('Provider-neutral image prompt. Required unless promptPacket is supplied.'),
  promptPacket: z.record(z.string(), z.unknown()).optional().describe('Structured prompt packet compiled into the provider prompt.'),
  taskId: z.string().min(1).optional().describe('Task ID to link the generated image asset. Omit during an interactive chat turn — the asset auto-binds to the chat you are replying in.'),
  surface: surfaceEnum.optional().describe('Image surface profile id. Omit to default from the routed dimensions.'),
  provider: imageProviderRoute.optional().describe('Provider route. Defaults to auto routing.'),
  model: z.string().optional().describe('Provider model id, such as gpt-image-2 or gemini-3.1-flash-image-preview.'),
  width: z.number().int().positive().optional().describe('Optional custom width. Defaults from surface profile.'),
  height: z.number().int().positive().optional().describe('Optional custom height. Defaults from surface profile.'),
  quality: imageQualityEnum.optional().describe('Generation quality tier (honored only on the direct-provider path).'),
  referenceImages: z.array(z.string()).optional().describe('Reference/context images to condition the generation: managed assetIds, local file paths, and/or media:// attachment URIs (mix freely; max 4). Loose paths and media URIs are auto-imported as assets. Requires a model with the reference-images capability on the native runtime.'),
  brandId: z.string().optional().describe('Brand to condition this generation (#419): the brand palette + identity merge into the prompt and its default reference images fill empty referenceImages slots. Unknown or draft brands are hard errors. Pass this for ANY branded task.'),
  versionOf: z.string().optional().describe('Iteration/re-roll: append the render as a new VERSION of this existing asset instead of minting a new asset. Use this whenever you regenerate or correct your own prior output for the same deliverable.'),
  allowNewAsset: z.boolean().optional().describe('Set true ONLY when a generate that references your own same-task output is a deliberately separate companion image (e.g. same style, different scene) — not an iteration.'),
}

const editShape = {
  prompt: z.string().min(1).describe('Edit instruction, e.g. "add a capybara in the foreground".'),
  assetId: z.string().min(1).describe('Managed image assetId to edit. Edits the current version and appends a new one. Import a loose local file first to get an assetId.'),
  taskId: z.string().min(1).optional().describe('Task ID to link the edited image asset. Omit during an interactive chat turn — the edit auto-binds to the chat you are replying in.'),
  surface: surfaceEnum.optional().describe('Output surface profile id for sizing.'),
  provider: imageProviderRoute.optional().describe('Provider route. Defaults to auto routing.'),
  model: z.string().optional().describe('Provider model id.'),
  width: z.number().int().positive().optional().describe('Optional custom width.'),
  height: z.number().int().positive().optional().describe('Optional custom height.'),
  quality: imageQualityEnum.optional().describe('Edit quality tier (honored only on the direct-provider path).'),
  referenceImages: z.array(z.string()).optional().describe('Additional reference/context images alongside the edited asset: managed assetIds and/or local file paths (max 4). Loose paths are auto-imported. Requires a model with the reference-images capability.'),
  brandId: z.string().optional().describe('Brand to condition this edit (#419): palette + identity merge into the edit instruction. Unknown or draft brands are hard errors.'),
}

const importShape = {
  filePath: z.string().min(1).describe('Absolute path to an existing image file to import into Assets.'),
  taskId: z.string().min(1).describe('Task ID to link the imported image asset.'),
  description: z.string().optional().describe('Human-readable asset description.'),
  tags: z.array(z.string()).optional().describe('Asset tags.'),
}

const exportShape = {
  assetId: z.string().min(1).describe('Managed image assetId to export. The export attaches to this asset (not a new asset).'),
  taskId: z.string().min(1).describe('Task ID for audit linkage.'),
  surface: exportSurfaceEnum.optional().describe('Target surface profile id. Use custom with width and height for custom exports.'),
  width: z.number().int().positive().optional().describe('Override export width.'),
  height: z.number().int().positive().optional().describe('Override export height.'),
  format: imageFormatEnum.optional().describe('Output format.'),
  quality: z.number().int().min(1).max(100).optional().describe('JPEG/WebP quality from 1 to 100.'),
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
      // The runtime's capability descriptor (P4.1) — how generation is served
      // on this runtime: native / shimmed / unavailable. Per-provider detail
      // below refines it; this is the top-level truth UIs and agents gate on.
      imageGen: (await ctx.runtime.capabilities()).imageGen,
      // Adapter identity for UI copy — surfaces derive the runtime's display
      // name from here instead of hardcoding a provider (R29).
      runtimeName: ctx.runtime.name,
      providers: listImageProviders(),
      readiness: await providerReadiness(ctx as PluginContext),
    }),
  }),
]

export async function checkImages(ctx: PluginContext): Promise<HealthCheckRunInput> {
  // Readiness derives from the runtime's capability descriptor (P4.1);
  // per-provider readiness refines the message, never overrides the mode.
  const imageGen = (await ctx.runtime.capabilities()).imageGen
  const readiness = await providerReadiness(ctx)
  const readyProviders = readiness.filter(provider => provider.routable)

  const profiles = listImageProfiles()
  return healthObserved([
    typeof ctx.assets.createAsset === 'function'
      ? healthHealthy({ key: 'assets', summary: 'Generated images can be saved through Assets.' })
      : healthError({
          key: 'assets', summary: 'The Assets save API is unavailable.',
          incident: {
            key: 'assets-unavailable', title: 'Images cannot save generated files',
            impact: 'Image generation may succeed but its output cannot be stored as a managed asset.',
            disposition: 'action_required', resources: [{ kind: 'plugin', id: 'assets', label: 'Assets' }],
            resolution: { key: 'review-assets', type: 'navigate', label: 'Review Assets', href: '/assets' },
          },
        }),
    profiles.length > 0
      ? healthHealthy({ key: 'profiles', summary: `${profiles.length} image surface profiles are registered.`, evidence: { count: profiles.length } })
      : healthError({
          key: 'profiles', summary: 'No image surface profiles are registered.',
          incident: {
            key: 'profiles-missing', title: 'Image surface profiles are missing',
            impact: 'Images cannot choose reliable dimensions for supported output surfaces.',
            disposition: 'action_required',
            resolution: { key: 'restart', type: 'instructions', label: 'Restore profiles', steps: ['Restore the built-in Images plugin files, then restart Bakin.'] },
          },
        }),
    imageGen.mode !== 'unavailable' && readyProviders.length > 0
      ? healthHealthy({
          key: 'providers',
          summary: `Image generation is ${imageGen.mode}: ${readyProviders.map((provider) => provider.label).join(', ')} configured.`,
          evidence: { mode: imageGen.mode, providers: readyProviders.map((provider) => provider.id) },
        })
      : healthWarning({
          key: 'providers',
          summary: imageGen.mode === 'unavailable'
            ? 'No authenticated image generation path is available.'
            : 'The runtime reports image generation, but no provider route resolved.',
          evidence: { mode: imageGen.mode, providers: readyProviders.map((provider) => provider.id) },
          incident: {
            key: 'providers-unavailable', title: 'Image generation is not configured',
            impact: 'Image generation and editing requests are unavailable; other Bakin work can continue.',
            disposition: 'advisory', resources: [{ kind: 'capability', id: 'image-generation', label: 'Image generation' }],
            resolution: { key: 'configure-images', type: 'navigate', label: 'Review runtime settings', href: '/settings' },
          },
        }),
  ])
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
        description: 'Provider routing policy for image generation. Runtime image providers are used first when configured.',
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
      handler: async (params) => await recommendImageRoute(ctx, params as never) as ExecToolResult,
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_generate',
      description: 'Generate an image through a configured runtime image provider, save it as a NEW managed asset (v1), and return its assetId. Pass referenceImages to create a new image conditioned on existing assets/files (e.g. "in the style of these"); to revise an existing asset in place use bakin_exec_images_edit instead. In an interactive chat: omit taskId and, after it returns, deliver the image by embedding ![desc](/api/assets/<assetId>) in your reply — text alone delivers nothing.',
      label: 'Generated an image',
      parameters: generateShape,
      handler: async (params, agent) => generateImage(ctx, params as never, agent),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_edit',
      description: 'Edit a managed image asset (by assetId) through the runtime image provider — edits the current version, appends a NEW VERSION to that same asset, and returns the assetId. Pass referenceImages to supply extra context images alongside the edited asset.',
      label: 'Edited an image',
      parameters: editShape,
      handler: async (params, agent) => editImage(ctx, params as never, agent),
    })
    ctx.registerExecTool({
      name: 'bakin_exec_images_import',
      description: 'Import an existing local image file as a new managed asset (v1) and return its assetId.',
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
      description: 'Checks managed-asset saving, surface profiles, and configured image provider routes.',
      group: { key: 'images', label: 'Images' },
      run: async () => checkImages(ctx),
    })
  },
})

export default imagesPlugin
