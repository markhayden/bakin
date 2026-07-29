import { ConversationPage, ConversationPageBody, ConversationPageComposer, ConversationPageTimeline, InspectorPanel, InspectorPanelContent, InspectorPanelFooter, InspectorPanelHeader, PageHeader } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

export const validConversation = <ConversationPage width="full" mode="contained"><PageHeader title="Chat" /><ConversationPageBody mode="contained"><ConversationPageTimeline labelledBy="chat-title">Messages</ConversationPageTimeline><ConversationPageComposer>Composer</ConversationPageComposer></ConversationPageBody></ConversationPage>
export const validInspector = <InspectorPanel labelledBy="inspector-title"><InspectorPanelHeader title="Node" /><InspectorPanelContent>Fields</InspectorPanelContent><InspectorPanelFooter><Button>Apply</Button></InspectorPanelFooter></InspectorPanel>

// @ts-expect-error conversation pages use the finite PageShell width scale
export const invalidConversationWidth = <ConversationPage width="viewport">Invalid</ConversationPage>
// @ts-expect-error conversation timelines need an accessible name
export const invalidTimeline = <ConversationPageTimeline>Messages</ConversationPageTimeline>
// @ts-expect-error inspectors need an accessible name
export const invalidInspector = <InspectorPanel>Fields</InspectorPanel>
// @ts-expect-error scroll ownership is a finite choice
export const invalidMode = <ConversationPageBody mode="viewport">Invalid</ConversationPageBody>
// @ts-expect-error page containment is the same finite choice
export const invalidPageMode = <ConversationPage mode="viewport">Invalid</ConversationPage>
