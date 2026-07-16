import type { AgentRuntimeAdapter } from './adapters/runtime'
import type { SearchAdapter } from './adapters/search'
import type { BakinTaskStore } from './tasks/store'

export interface AppServices {
  runtime: AgentRuntimeAdapter
  search: SearchAdapter
  tasks: BakinTaskStore
}
