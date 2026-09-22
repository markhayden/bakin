import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, DEFAULT_PLUGIN_UI_FIXTURE } from '@makinbakin/sdk/testing/ui'
import { Page, PageHeader, PageBody, ListRows } from '@makinbakin/sdk/patterns'
import { TaskAssets } from '../components/task-assets'
import { VersionRow } from '../components/versioned/VersionRow'
function Fixture() { return <Page data-collection-ready><PageHeader title="Asset supporting lists" /><PageBody>
  <section><h2>Task attachments</h2><TaskAssets taskId="review" /></section>
  <ListRows variant="separated" size="sm" aria-label="Version history"><VersionRow assetId="cover" assetType="documents" isCurrent={false} isSelected canDelete onSelect={() => {}} onPromote={() => {}} onDelete={() => {}} version={{ version: 2, file: 'cover.pdf', thumb: null, mimeType: 'application/pdf', size: 2048, width: 1200, height: 1600, created: '2026-01-15T11:00:00Z', description: 'Final cover', tags: [], op: 'edit', parentVersion: 1, tool: null, prompt: 'Prepare the launch cover for review.', promptHash: null, generation: null }} /></ListRows>
</PageBody></Page> }
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/assets', network: [
  { path: '/api/plugins/assets/versioned?taskId=review&includeChildren=true', status: 200, json: { assets: [{ assetId: 'cover', description: 'Seasonal publication cover and supporting attribution reference', type: 'documents', currentVersion: 2, versionCount: 2, hasThumb: false }] } },
] }} registrations={[{ id: 'assets', routes: { '/assets': Fixture } }]} />)
