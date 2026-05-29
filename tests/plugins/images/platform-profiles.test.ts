import { describe, expect, it } from 'bun:test'
import { getImageProfile, listImageProfiles } from '../../../plugins/images/lib/platform-profiles'

describe('image surface profiles', () => {
  it('contains the core launch surfaces with stable dimensions', () => {
    const byId = new Map(listImageProfiles().map(profile => [profile.id, profile]))

    expect(byId.get('instagram-feed-portrait')).toMatchObject({ width: 1080, height: 1350, aspectRatio: '4:5' })
    expect(byId.get('instagram-story')).toMatchObject({ width: 1080, height: 1920, aspectRatio: '9:16' })
    expect(byId.get('google-display-landscape')).toMatchObject({ width: 1200, height: 628, aspectRatio: '1.91:1' })
    expect(byId.get('blog-hero')).toMatchObject({ width: 1600, height: 900, aspectRatio: '16:9' })
    expect(byId.get('open-graph')).toMatchObject({ width: 1200, height: 630, aspectRatio: '1.91:1' })
    expect(byId.get('youtube-thumbnail')).toMatchObject({ width: 1280, height: 720, aspectRatio: '16:9' })
    expect(byId.get('pinterest-pin')).toMatchObject({ width: 1000, height: 1500, aspectRatio: '2:3' })
  })

  it('keeps every profile sourced and addressable by id', () => {
    for (const profile of listImageProfiles()) {
      expect(getImageProfile(profile.id)).toEqual(profile)
      expect(profile.source.url).toMatch(/^https:\/\//)
      expect(profile.source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(profile.formats.length).toBeGreaterThan(0)
      expect(profile.width).toBeGreaterThan(0)
      expect(profile.height).toBeGreaterThan(0)
    }
  })
})
