/**
 * Teeth for `globalThis.BASE_UI_ANIMATIONS_DISABLED = true` in tests/setup.ts.
 *
 * happy-dom ≥20.12 ships Element.getAnimations(); Base UI feature-detects it and
 * defers every close through requestAnimationFrame + Promise, which lands after a
 * synchronous test returns (act gate → wedged --isolate worker, #753/#760). The
 * preload flips Base UI's own test-environment switch to restore synchronous
 * closes. This file proves the switch is both load-bearing and honored.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-base-ui-animations-disabled')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@makinbakin/sdk/ui'

afterEach(() => cleanup())

describe('Base UI animations in the happy-dom harness', () => {
  it('happy-dom ships Element.getAnimations, so the switch is load-bearing', () => {
    // If this fails, happy-dom dropped the Web Animations API and the switch in
    // tests/setup.ts can be removed together with this file.
    expect(typeof document.createElement('div').getAnimations).toBe('function')
  })

  it('the preload sets BASE_UI_ANIMATIONS_DISABLED', () => {
    expect(globalThis.BASE_UI_ANIMATIONS_DISABLED).toBe(true)
  })

  it('a Base UI dialog leaves the DOM synchronously when closed', () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Teeth</DialogTitle>
          <DialogClose>Close</DialogClose>
        </DialogContent>
      </Dialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    // No frame, no microtask: the synchronous path is what the whole suite was
    // written against. If Base UI stops honoring the switch, this is the line.
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
