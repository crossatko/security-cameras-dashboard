import { removeStream } from '../../lib/stream-manager'
import { deleteCamera as deleteCameraRow } from '../../lib/camera-store'

export default defineEventHandler((event) => {
  const id = parseInt(event.context.params?.id || '0')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }

  removeStream(id)
  const ok = deleteCameraRow(id)
  if (!ok) {
    throw createError({ statusCode: 404, statusMessage: 'Camera not found' })
  }

  return { success: true }
})
