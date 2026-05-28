export type ImageProviderId = 'openai' | 'google'

export type ImageModelCapability =
  | 'generate'
  | 'edit'
  | 'reference-images'
  | 'text-rendering'
  | 'transparent-background'
  | 'responses-image-tool'

export interface ImageModelDescriptor {
  id: string
  provider: ImageProviderId
  label: string
  tier: 'budget' | 'standard' | 'premium'
  status: 'routable' | 'known'
  capabilities: ImageModelCapability[]
  defaultQuality: 'draft' | 'standard' | 'premium'
}

export interface ImageProviderDescriptor {
  id: ImageProviderId
  label: string
  envVars: string[]
  models: ImageModelDescriptor[]
}

export interface ImageProviderReadiness {
  id: ImageProviderId
  label: string
  configured: boolean
  routable: boolean
  envVars: string[]
  configuredEnvVars: string[]
  models: ImageModelDescriptor[]
}

export type ImageSurfaceCategory =
  | 'social'
  | 'ads'
  | 'web'
  | 'video'
  | 'email'

export interface ImageSurfaceProfile {
  id: string
  label: string
  category: ImageSurfaceCategory
  aspectRatio: string
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  formats: string[]
  safeZone?: string
  source: {
    label: string
    url: string
    checkedAt: string
  }
}

export interface ImagePluginSettings {
  defaultProvider?: 'auto' | ImageProviderId
  defaultSurface?: string
  fallbackOrder?: string[]
  quality?: 'draft' | 'standard' | 'premium'
}
