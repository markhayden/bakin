import type { OperationPlan } from '@makinbakin/sdk/types'

/**
 * The media store install as an operation (#895). Everything before `commit`
 * happens in a private staging dir, so cancel is safe until the atomic swap.
 * The caller declares the `media-store` resource (the installer asserts it).
 */
export const MEDIA_PLAN: OperationPlan = {
  stages: [
    { id: 'prepare', kind: 'preparing', label: 'Prepare staging' },
    { id: 'download', kind: 'downloading', label: 'Download pinned sharp packages' },
    { id: 'extract', kind: 'extracting', label: 'Unpack the packages' },
    { id: 'bundle', kind: 'building', label: 'Bundle sharp' },
    { id: 'verify', kind: 'verifying', label: 'Probe-verify with a real resize' },
    { id: 'commit', kind: 'committing', label: 'Commit the store' },
  ],
  pointOfNoReturn: 'commit',
}
