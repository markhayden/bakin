import type { ImageSurfaceProfile } from '../types'

const CHECKED_AT = '2026-05-28'

export const IMAGE_SURFACE_PROFILES: ImageSurfaceProfile[] = [
  {
    id: 'instagram-feed-portrait',
    label: 'Instagram Feed Portrait',
    category: 'social',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    formats: ['jpg', 'png', 'webp'],
    safeZone: 'Keep critical subject detail away from the outer 5% crop edge.',
    source: {
      label: 'Meta Ads Guide',
      url: 'https://www.facebook.com/business/ads-guide/image/instagram-feed',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'instagram-square',
    label: 'Instagram Square',
    category: 'social',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    formats: ['jpg', 'png', 'webp'],
    source: {
      label: 'Meta Ads Guide',
      url: 'https://www.facebook.com/business/ads-guide/image/instagram-feed',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'instagram-story',
    label: 'Instagram Story/Reel',
    category: 'social',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    formats: ['jpg', 'png', 'webp'],
    safeZone: 'Avoid platform UI areas near the top and bottom edges.',
    source: {
      label: 'Meta Ads Guide',
      url: 'https://www.facebook.com/business/ads-guide/image/instagram-stories',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'google-display-landscape',
    label: 'Google Display Landscape',
    category: 'ads',
    aspectRatio: '1.91:1',
    width: 1200,
    height: 628,
    minWidth: 600,
    minHeight: 314,
    formats: ['jpg', 'png'],
    source: {
      label: 'Google Ads image assets',
      url: 'https://support.google.com/google-ads/answer/13676244',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'google-display-square',
    label: 'Google Display Square',
    category: 'ads',
    aspectRatio: '1:1',
    width: 1200,
    height: 1200,
    minWidth: 300,
    minHeight: 300,
    formats: ['jpg', 'png'],
    source: {
      label: 'Google Ads image assets',
      url: 'https://support.google.com/google-ads/answer/13676244',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'blog-hero',
    label: 'Blog Hero',
    category: 'web',
    aspectRatio: '16:9',
    width: 1600,
    height: 900,
    minWidth: 1200,
    formats: ['jpg', 'png', 'webp'],
    source: {
      label: 'Google Discover image guidance',
      url: 'https://developers.google.com/search/docs/appearance/google-discover',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'open-graph',
    label: 'Open Graph Share Image',
    category: 'web',
    aspectRatio: '1.91:1',
    width: 1200,
    height: 630,
    formats: ['jpg', 'png', 'webp'],
    source: {
      label: 'Open Graph protocol',
      url: 'https://ogp.me/',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'youtube-thumbnail',
    label: 'YouTube Thumbnail',
    category: 'video',
    aspectRatio: '16:9',
    width: 1280,
    height: 720,
    formats: ['jpg', 'png', 'webp'],
    source: {
      label: 'YouTube Help',
      url: 'https://support.google.com/youtube/answer/72431',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'pinterest-pin',
    label: 'Pinterest Pin',
    category: 'social',
    aspectRatio: '2:3',
    width: 1000,
    height: 1500,
    formats: ['jpg', 'png', 'webp'],
    source: {
      label: 'Pinterest product specs',
      url: 'https://help.pinterest.com/en-gb/business/article/pinterest-product-specs',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'linkedin-feed-landscape',
    label: 'LinkedIn Feed Landscape',
    category: 'social',
    aspectRatio: '1.91:1',
    width: 1200,
    height: 627,
    formats: ['jpg', 'png'],
    source: {
      label: 'LinkedIn single image ads',
      url: 'https://business.linkedin.com/marketing-solutions/success/ads-guide/single-image-ads',
      checkedAt: CHECKED_AT,
    },
  },
  {
    id: 'email-header',
    label: 'Email Header',
    category: 'email',
    aspectRatio: '3:1',
    width: 1200,
    height: 400,
    formats: ['jpg', 'png', 'webp'],
    source: {
      label: 'Bakin default profile',
      url: 'https://github.com/markhayden/bakin',
      checkedAt: CHECKED_AT,
    },
  },
]

export function listImageProfiles(): ImageSurfaceProfile[] {
  return IMAGE_SURFACE_PROFILES
}

export function getImageProfile(id: string): ImageSurfaceProfile | null {
  return IMAGE_SURFACE_PROFILES.find(profile => profile.id === id) ?? null
}
