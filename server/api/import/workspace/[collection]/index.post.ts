import { mongo } from '~~/server/utils/mongo'
import { WORKSPACE_COLLECTIONS } from '~~/shared/workspaceCollections'

export default defineEventHandler(async (event) => {
  const collection = event.context.params!.collection

  if (!WORKSPACE_COLLECTIONS.some(name => name === collection)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unsupported workspace collection',
    })
  }

  if (!event.context.mongouuid) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Workspace not initialized',
    })
  }

  const { data } = await readBody<{ data: any[] }>(event)
  if (data.length > 0) {
    const db = await mongo(event.context.mongouuid)
    await db.collection(collection).insertMany(data)
  }

  event.node.res.statusCode = 201
  return 'ok'
})
