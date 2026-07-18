import type { Preview } from '@storybook/react-vite'

import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'

// This is the exact compiled stylesheet served by today's Bakin host. T12
// replaces this bridge with the generated @makinbakin/sdk/styles.css artifact.
import '../packages/host/public/globals.css'
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
    bakinFixture: DEFAULT_STORY_FIXTURE,
    viewport: {
      options: BAKIN_STORYBOOK_VIEWPORTS,
    },
  },
}

export default preview
