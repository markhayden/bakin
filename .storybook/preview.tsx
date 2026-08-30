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
  // Every entry gets an autodocs page: props tables from TS types plus
  // per-story source panels. Public entries are the contract surface;
  // internal entries only ever render in the maintainer build.
  tags: ['autodocs'],
  beforeEach: (context) => installDeterministicBrowserFixture(
    context.parameters.bakinFixture ?? DEFAULT_STORY_FIXTURE,
  ),
  initialGlobals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    options: {
      // The three-tier sidebar: raw material, then components, then assembly.
      storySort: { order: ['Tokens', 'Components', 'Recipes'] },
    },
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
