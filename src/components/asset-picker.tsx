'use client'

/**
 * The app-aware asset chooser's focused home is `AssetLibraryPicker` in
 * `@makinbakin/sdk/patterns` (kit-additions batch): the presentation-only
 * patterns AssetPicker composed with the assets plugin's listing + upload
 * wiring. This module keeps the frozen `@makinbakin/sdk/components` barrel's
 * historical names intact until P-final deletes the barrel wholesale.
 */
export { AssetLibraryPicker as AssetPicker } from '@makinbakin/sdk/patterns'
export type {
  AssetLibraryAsset as AssetPickerAsset,
  AssetLibraryPickerProps as AssetPickerProps,
} from '@makinbakin/sdk/patterns'
