'use client'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PluginHeader } from '@/components/plugin-header'
import { MemoryLog } from './memory-log'
import { AuditTimeline } from './audit-timeline'
import { AgentBrowser } from './agent-browser'
import { GatewayViewer } from './gateway-viewer'

export function MemoryTabs() {
  return (
    <div>
      <PluginHeader title="Memory" subtitle="Agent memory and audit trail" />
      <div className="mt-4" />
      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log">Log</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="gateway">Gateway</TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <MemoryLog />
        </TabsContent>
        <TabsContent value="timeline">
          <AuditTimeline />
        </TabsContent>
        <TabsContent value="agents">
          <AgentBrowser />
        </TabsContent>
        <TabsContent value="gateway">
          <GatewayViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
