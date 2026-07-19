import type { Preview } from '@storybook/react-vite'

import '@fontsource/space-grotesk/latin-400.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-600.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'

// The host, public package, and Storybook all load this one compiled artifact.
import '@makinbakin/sdk/styles.css'
import '../storybook/fixtures/runtime.css'
import {
  BAKIN_STORYBOOK_VIEWPORTS,
  DEFAULT_STORY_FIXTURE,
  installDeterministicBrowserFixture,
} from '../storybook/fixtures'

const preview: Preview = {
  beforeEach: (context) => installDeterministicBrowserFixture(
    context.parameters.bakinFixture ?? DEFAULT_STORY_FIXTURE,
  ),
  initialGlobals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    layout: 'centered',
    a11y: {
      test: 'error',
      options: {
        runOnly: [
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22a',
          'wcag22aa',
          'best-practice',
        ],
      },
    },
    bakinFixture: DEFAULT_STORY_FIXTURE,
    viewport: {
      options: BAKIN_STORYBOOK_VIEWPORTS,
    },
  },
}

export default preview
