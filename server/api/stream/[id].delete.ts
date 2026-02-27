import { removeStream } from '../../lib/stream-manager'

export default defineEventHandler(async (event) => {
  const id = parseInt(event.context.params?.id || '0')
  removeStream(id)
  return { success: true }
})
