import { describe, it, expect } from 'vitest'
import { getAssetType, getMimeType, ASSET_TYPES, EXTENSION_TO_TYPE } from '@bakin/assets/lib/constants'

describe('assets/constants', () => {
  describe('ASSET_TYPES', () => {
    it('contains all expected types', () => {
      expect(ASSET_TYPES).toEqual(['text', 'images', 'video', 'audio', 'plans', 'data', 'other'])
    })
  })

  describe('getAssetType', () => {
    it('maps image extensions correctly', () => {
      expect(getAssetType('photo.png')).toBe('images')
      expect(getAssetType('hero.jpg')).toBe('images')
      expect(getAssetType('logo.svg')).toBe('images')
      expect(getAssetType('banner.webp')).toBe('images')
      expect(getAssetType('icon.gif')).toBe('images')
    })

    it('maps video extensions correctly', () => {
      expect(getAssetType('intro.mp4')).toBe('video')
      expect(getAssetType('clip.mov')).toBe('video')
      expect(getAssetType('demo.webm')).toBe('video')
    })

    it('maps audio extensions correctly', () => {
      expect(getAssetType('voiceover.mp3')).toBe('audio')
      expect(getAssetType('sound.wav')).toBe('audio')
      expect(getAssetType('track.m4a')).toBe('audio')
    })

    it('maps text extensions correctly', () => {
      expect(getAssetType('post.md')).toBe('text')
      expect(getAssetType('notes.txt')).toBe('text')
    })

    it('maps plans extensions correctly', () => {
      expect(getAssetType('workflow.yaml')).toBe('plans')
      expect(getAssetType('config.yml')).toBe('plans')
    })

    it('maps data extensions correctly', () => {
      expect(getAssetType('export.json')).toBe('data')
      expect(getAssetType('report.csv')).toBe('data')
    })

    it('returns other for unknown extensions', () => {
      expect(getAssetType('archive.zip')).toBe('other')
      expect(getAssetType('binary.exe')).toBe('other')
      expect(getAssetType('noextension')).toBe('other')
    })

    it('handles case insensitivity via lowercase', () => {
      expect(getAssetType('PHOTO.PNG')).toBe('images')
      expect(getAssetType('Video.MP4')).toBe('video')
    })
  })

  describe('getMimeType', () => {
    it('returns correct MIME types', () => {
      expect(getMimeType('image.png')).toBe('image/png')
      expect(getMimeType('video.mp4')).toBe('video/mp4')
      expect(getMimeType('audio.mp3')).toBe('audio/mpeg')
      expect(getMimeType('doc.md')).toBe('text/markdown')
      expect(getMimeType('data.json')).toBe('application/json')
      expect(getMimeType('data.csv')).toBe('text/csv')
    })

    it('returns octet-stream for unknown types', () => {
      expect(getMimeType('file.zip')).toBe('application/octet-stream')
      expect(getMimeType('file.xyz')).toBe('application/octet-stream')
    })
  })
})
