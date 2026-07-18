import type { Preview } from '@storybook/react-vite'

// This is the exact compiled stylesheet served by today's Bakin host. T12
// replaces this bridge with the generated @makinbakin/sdk/styles.css artifact.
import '../packages/host/public/globals.css'

const preview: Preview = {
  parameters: {
    layout: 'centered',
  },
}

export default preview
