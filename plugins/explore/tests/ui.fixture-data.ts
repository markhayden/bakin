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

catalogEntries.push(...[
  { id: 'github', name: 'GitHub', category: 'Engineering', description: 'Lets your agents work GitHub the way you do — read issues and pull requests, watch CI runs, inspect diffs, and open PRs — through the official gh command line tool.' },
  { id: 'google-workspace', name: 'Google Workspace', category: 'Productivity', description: 'Lets your agents work your Google account — search Gmail, read and add calendar events, find files in Drive, and read or update Sheets and Docs — through the open-source gog command line tool.' },
  { id: 'documents', name: 'Word & Excel Documents', category: 'Productivity', description: 'Lets your agents read and write real Word and Excel files — pull the text out of a .docx, turn a spreadsheet into data they can reason over, and hand back a formatted document or workbook. Fully local, no Office install, no API key.' },
].map(entry => ({
  ...catalogEntries[0]!, ...entry, kind: 'skill-pack' as const, capability: entry.id,
  source: `github:markhayden/bakin-bits-official#packs/${entry.id}`,
})))
