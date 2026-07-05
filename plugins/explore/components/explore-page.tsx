import { Suspense } from 'react'
import { Compass } from 'lucide-react'
import { PluginHeader, EmptyState } from '@makinbakin/sdk/components'

export function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <div className="p-6 flex flex-col flex-1 gap-6">
        <PluginHeader
          title="Explore"
          subtitle="Do more with Bakin — official agents, plugins, and packs"
        />
        <EmptyState
          icon={Compass}
          title="The storefront is coming"
          description="Browse curated agents, plugins, and packs — and install them without touching a terminal."
        />
      </div>
    </Suspense>
  )
}
