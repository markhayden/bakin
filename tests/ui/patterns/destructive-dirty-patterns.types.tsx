import {
  ConfirmDialog,
  DangerZone,
  SaveBar,
  UnsavedChangesDialog,
} from '@makinbakin/sdk/patterns'

export const validDestructivePatterns = (
  <>
    <ConfirmDialog open title="Repair runtime?" confirmTone="primary" onConfirm={() => {}} onCancel={() => {}} />
    <SaveBar dirty onSave={() => {}} onDiscard={() => {}} />
    <DangerZone description="Delete it." confirmLabel="Delete" confirmValue="item" onConfirm={() => {}} />
    <UnsavedChangesDialog open canSaveInPlace={false} onSave={() => {}} onDiscard={() => {}} onCancel={() => {}} />
  </>
)

// @ts-expect-error confirmation tone is a finite semantic choice
export const invalidConfirmTone = <ConfirmDialog open title="Invalid" confirmTone="warning" onConfirm={() => {}} onCancel={() => {}} />
// @ts-expect-error danger-zone heading levels preserve page hierarchy
export const invalidDangerHeading = <DangerZone headingLevel={1} description="Delete" confirmLabel="Delete" confirmValue="item" onConfirm={() => {}} />
// @ts-expect-error dirty state is boolean
export const invalidDirtyState = <SaveBar dirty="yes" onSave={() => {}} onDiscard={() => {}} />
// @ts-expect-error save availability is boolean
export const invalidSaveAvailability = <UnsavedChangesDialog open canSaveInPlace="sometimes" onSave={() => {}} onDiscard={() => {}} onCancel={() => {}} />
