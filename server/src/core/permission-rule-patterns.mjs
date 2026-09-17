// Core re-export so the task layer can use the rule shapes shared with the
// web UI without importing `shared` directly (see dependency-boundaries test).
export {
  DANGEROUS_COMMAND,
  READ_KINDS,
  WRITE_KINDS,
  isDangerousCommand,
  operationPaths,
  suggestRule,
} from '../../../shared/permission-rule-patterns.mjs'
