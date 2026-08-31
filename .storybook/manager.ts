import { addons } from 'storybook/manager-api'
import { themes } from 'storybook/theming'

// Match the manager chrome to the dark docs pages.
addons.setConfig({ theme: themes.dark })
