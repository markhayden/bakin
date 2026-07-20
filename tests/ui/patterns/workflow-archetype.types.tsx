import {
  WorkflowPage,
  WorkflowPageActions,
  WorkflowPageBody,
  WorkflowPageCanvas,
  WorkflowPageToolbar,
} from '@makinbakin/sdk/patterns'

export const validWorkflow = (
  <WorkflowPage width="wide">
    <WorkflowPageBody layout="canvas" mode="document">
      <WorkflowPageToolbar labelledBy="workflow-tools-title">Tools</WorkflowPageToolbar>
      <WorkflowPageCanvas labelledBy="workflow-title" orientation="horizontal">Graph</WorkflowPageCanvas>
      <WorkflowPageActions label="Workflow changes">Actions</WorkflowPageActions>
    </WorkflowPageBody>
  </WorkflowPage>
)

// @ts-expect-error workflow pages intentionally exclude narrow content width
export const invalidWorkflowWidth = <WorkflowPage width="content">Invalid</WorkflowPage>
// @ts-expect-error workflow canvases need an accessible name
export const invalidWorkflowCanvas = <WorkflowPageCanvas>Graph</WorkflowPageCanvas>
// @ts-expect-error graph orientation is a finite choice
export const invalidWorkflowOrientation = <WorkflowPageCanvas label="Graph" orientation="radial">Graph</WorkflowPageCanvas>
// @ts-expect-error workflow toolbars need an accessible name
export const invalidWorkflowToolbar = <WorkflowPageToolbar>Tools</WorkflowPageToolbar>
// @ts-expect-error workflow actions need an accessible name
export const invalidWorkflowActions = <WorkflowPageActions>Actions</WorkflowPageActions>
// @ts-expect-error workspace layout is a finite choice
export const invalidWorkflowLayout = <WorkflowPageBody layout="split">Invalid</WorkflowPageBody>
// @ts-expect-error workflow scroll ownership is a finite choice
export const invalidWorkflowMode = <WorkflowPageBody mode="viewport">Invalid</WorkflowPageBody>
