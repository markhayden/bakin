/**
 * Re-export shim — all taskboard logic now lives in plugins/tasks/taskboard.ts.
 * This file exists so server.ts dispatch (which imports from './src/lib/taskboard')
 * continues to work without changes.
 */
export {
  parseTaskboard,
  generateTaskId,
  withTaskboardLock,
  serializeTaskboard,
  readTaskboard,
  writeTaskboard,
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
} from '../../plugins/tasks/taskboard'
