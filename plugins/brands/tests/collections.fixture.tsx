import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { PluginUiFixtureHost, DEFAULT_PLUGIN_UI_FIXTURE } from '@makinbakin/sdk/testing/ui'
import { BrandDetail } from '../components/brand-detail'
import { BrandRecoverPanel } from '../components/brand-recover'
function Fixture() { return <div data-collection-ready><BrandDetail brandId="acme" onBack={() => {}} /><section><h2>Recover a brand</h2><BrandRecoverPanel brandName="Acme" busy={false} error={null} onDetach={() => {}} dangling={[{ assetId: '20260704-logo-dark-a1b2c3d4', where: 'logo (dark)' }, { assetId: '20260704-hero-b2c3d4e5', where: 'group hero' }]} /></section></div> }
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/brands/acme?tab=guidelines', network: [
  { path: '/api/plugins/brands/acme', status: 200, json: { brand: { id: 'acme', name: 'Acme', palette: [], logos: [], assetGroups: [], createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-01-15T11:00:00Z' }, guidelines: [
    { name: 'publication-review-and-attribution-guidelines.md', description: 'Keep attribution and approval evidence together.', bytes: 1200 }, { name: 'voice.md', description: 'Warm and clear.', bytes: 900 },
  ], lessons: [{ name: 'launch-learnings.md', description: 'Lessons from the launch', bytes: 400 }], fingerprint: 'sha256:fixture' } },
] }} registrations={[{ id: 'brands', routes: { '/brands/acme': Fixture } }]} />)
