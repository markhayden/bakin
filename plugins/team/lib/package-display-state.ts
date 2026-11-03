/**
 * The package state a Team surface shows for a row (#1007 B): the server's
 * install state, overlaid with `update-available` when the updates engine's
 * record for the package offers an unskipped update. ONE derivation for the
 * grid badge and the detail card — a scheduled engine pass that changes the
 * record changes both.
 */
import { isUpdateOffered } from '@makinbakin/sdk/types'
import type { PackageStateRow } from '../types'

export function packageDisplayState(row: PackageStateRow): PackageStateRow['state'] {
  return row.update && isUpdateOffered(row.update) ? 'update-available' : row.state
}
