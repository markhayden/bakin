import { expect, test } from 'playwright/test'

const story = '/iframe.html?id=components-forms-plugin-settings-renderer--compact-list-composition&viewMode=story'

test('compact settings preserve container packing, control alignment, and label activation', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

  for (const scenario of [
    { viewport: 1280, frame: 1024, text: 100, columns: 3 },
    { viewport: 1280, frame: 600, text: 100, columns: 2 },
    { viewport: 1280, frame: 320, text: 100, columns: 1 },
    { viewport: 320, frame: 320, text: 100, columns: 1 },
    { viewport: 1280, frame: 1024, text: 200, columns: 2 },
    { viewport: 320, frame: 320, text: 200, columns: 1 },
  ]) {
    await test.step(JSON.stringify(scenario), async () => {
      await page.setViewportSize({ width: scenario.viewport, height: 1000 })
      await page.goto(story, { waitUntil: 'networkidle' })
      const enabled = page.getByRole('switch', { name: 'Enabled', exact: true })
      // The story's label-click/reset interaction must finish before resizing.
      await expect(page.locator('#storybook-root')).toHaveAttribute('data-story-ready', 'true')
      await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      await expect(enabled).toBeChecked()
      await page.evaluate(({ frame, text }) => {
        document.documentElement.style.fontSize = `${text}%`
        const container = document.querySelector<HTMLElement>('[data-testid="compact-settings-frame"]')!
        container.style.inlineSize = `${frame}px`
      }, scenario)
      await page.evaluate(async () => document.fonts.ready)

      const geometry = await page.getByRole('group', { name: 'Delivery rules row 1' }).evaluate((row) => {
        const rect = (element: Element) => {
          const { top, right, bottom, left, height } = element.getBoundingClientRect()
          return { top, right, bottom, left, height }
        }
        return {
          columns: getComputedStyle(row.firstElementChild!).gridTemplateColumns.split(' ').length,
          row: rect(row),
          fields: [...row.querySelectorAll('[data-slot="field"]')].map((field) => ({
            horizontal: field.getAttribute('data-orientation') === 'horizontal',
            label: rect(field.querySelector('[data-slot="field-label"]')!),
            control: rect(field.querySelector('input:not([type="hidden"]), [role="switch"], [role="combobox"]')!),
          })),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      expect(geometry.columns).toBe(scenario.columns)
      expect(geometry.fields).toHaveLength(8)
      expect(geometry.overflow).toBe(false)
      for (let offset = 0; offset < geometry.fields.length; offset += scenario.columns) {
        const line = geometry.fields.slice(offset, offset + scenario.columns)
        const vertical = line.filter((field) => !field.horizontal)
        for (const field of line) {
          for (const box of [field.label, field.control]) {
            expect(box.left).toBeGreaterThanOrEqual(geometry.row.left)
            expect(box.right).toBeLessThanOrEqual(geometry.row.right)
            expect(box.height).toBeGreaterThan(0)
          }
          if (field.horizontal) {
            expect(Math.abs(field.control.top + field.control.height / 2 - field.label.top - field.label.height / 2)).toBeLessThan(1)
            expect(field.control.right).toBeLessThanOrEqual(field.label.left)
            // The entire toggle belongs below the shared label track.
            for (const peer of vertical) expect(field.label.top).toBeGreaterThanOrEqual(peer.label.bottom)
            if (vertical.length > 0) {
              const trackHeight = Math.max(...line.map((peer) => peer.horizontal
                ? Math.max(peer.label.height, peer.control.height) : peer.control.height))
              expect(Math.abs(field.control.top + field.control.height / 2 - vertical[0]!.control.top - trackHeight / 2)).toBeLessThan(1)
            }
          } else {
            expect(field.label.bottom).toBeLessThanOrEqual(field.control.top)
            for (const peer of vertical) expect(Math.abs(field.control.top - peer.control.top)).toBeLessThan(1)
          }
        }
        for (let index = 1; index < line.length; index++) {
          expect(Math.max(line[index - 1]!.label.right, line[index - 1]!.control.right))
            .toBeLessThanOrEqual(Math.min(line[index]!.label.left, line[index]!.control.left))
        }
        if (offset > 0) {
          const previous = geometry.fields.slice(offset - scenario.columns, offset)
          expect(Math.min(...line.map((field) => Math.min(field.label.top, field.control.top))))
            .toBeGreaterThan(Math.max(...previous.map((field) => Math.max(field.label.bottom, field.control.bottom))))
        }
      }
      await testInfo.attach(`compact-${scenario.viewport}-${scenario.frame}-${scenario.text}`, {
        body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
      })
      await enabled.focus()
      await page.keyboard.press('Space')
      await expect(enabled).not.toBeChecked()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('textbox', { name: 'Name shown to collaborators before they approve delivery' })).toBeFocused()
      await page.getByText('Enabled', { exact: true }).click()
      await expect(enabled).toBeChecked()
    })
  }
  expect(errors).toEqual([])
})
