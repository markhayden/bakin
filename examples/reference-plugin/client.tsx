/** Browser entry loaded by Bakin after the manifest lazy-loads this plugin. */
import { registerPlugin } from '@makinbakin/sdk'
import { referenceBookmarksRegistration } from './client-registration'

registerPlugin(referenceBookmarksRegistration)
