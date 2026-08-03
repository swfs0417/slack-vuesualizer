export const WORKSPACE_COLLECTIONS = [
  'users',
  'channels',
  'dms',
  'groups',
  'mpims',
] as const

export type WorkspaceCollection = typeof WORKSPACE_COLLECTIONS[number]
