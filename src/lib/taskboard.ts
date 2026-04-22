/**
 * Re-export shim — all taskboard logic now lives in plugins/tasks/lib/flow-store.ts.
 * This file exists so server.ts dispatch (which imports from './src/lib/taskboard')
 * continues to work without changes.
 */
export {
  readTaskboard,
  createTask,
  moveTask,
  assignTask,
  deleteTask,
  addTaskLog,
  blockTask,
  updateTask,
  getTodoTasks,
  moveTaskToInProgress,
  getAgentTasks,
  setDependency,
  clearDependency,
  readAllColumns,
  VALID_TRANSITIONS,
} from '../../plugins/tasks/lib/flow-store'
