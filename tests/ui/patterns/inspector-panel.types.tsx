import { InspectorPanel, InspectorPanelContent, InspectorPanelFooter, InspectorPanelHeader } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

export const validInspector = <InspectorPanel labelledBy="inspector-title"><InspectorPanelHeader title="Node" /><InspectorPanelContent>Fields</InspectorPanelContent><InspectorPanelFooter><Button>Apply</Button></InspectorPanelFooter></InspectorPanel>

// @ts-expect-error inspectors need an accessible name
export const invalidInspector = <InspectorPanel>Fields</InspectorPanel>
