/**
 * Images plugin — provider-routed image generation primitives.
 */
import { z } from 'zod'
import type { BakinPlugin, HealthCheckResult, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { DEFAULT_IMAGE_SETTINGS, listImageProviders, providerReadinessFromEnv } from './lib/providers'
import { getImageProfile, listImageProfiles } from './lib/platform-profiles'

const okResponse = z.object({ ok: z.boolean() }).passthrough()
const errorResponse = z.object({ error: z.string() }).passthrough()

const profileQuery = z.object({
  id: z.string().optional(),
})

const profileToolShape = {
  profileId: z.string().optional().describe('Optional surface profile id to return. Omit to list all profiles.'),
  includeProviders: z.boolean().default(true).describe('Include provider readiness and routable model metadata.'),
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
    handler: async () => Response.json({
      ok: true,
      providers: listImageProviders(),
      readiness: providerReadinessFromEnv(),
    }),
  }),
]

function checkImages(ctx: PluginContext): HealthCheckResult[] {
  const rows: HealthCheckResult[] = []
  const readiness = providerReadinessFromEnv()
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
          ...(includeProviders ? { providers: providerReadinessFromEnv() } : {}),
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
