import type { ExploreCatalogEntry } from '../types'

export const catalogEntries: ExploreCatalogEntry[] = [
  { id: 'editorial', name: 'Editorial research and publication review', category: 'Research and publishing', description: 'Coordinate research, attribution and cross-team review before publishing a finished campaign.', installed: false, updateAvailable: null, installedVersion: null, runtimes: ['*'] },
  { id: 'pixel', name: 'Pixel', category: 'Creative', description: 'Image artist and brand production assistant.', installed: true, updateAvailable: true, installedVersion: '1.2.0', runtimes: ['*'] },
  { id: 'jessica', name: 'Jessica', category: 'Planning', description: 'Coordinate the team and keep projects moving.', installed: true, updateAvailable: false, installedVersion: '1.0.0', runtimes: ['*'] },
  { id: 'archive', name: 'Archive assistant', category: 'Research', description: 'Review archived material with a runtime-specific integration.', installed: false, updateAvailable: null, installedVersion: null, runtimes: ['openclaw'] },
].map(entry => ({ ...entry, kind: 'agent', emoji: '📦', tags: [], useCases: ['Review publication evidence'],
  source: `github:markhayden/bakin-bits-official#agents/${entry.id}`, ref: null, trust: 'official', builtin: false,
  dependencies: [], defaultSelected: false, screenshots: [],
}))
