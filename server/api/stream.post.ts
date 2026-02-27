import { addStream, getStreamUrl } from '../lib/stream-manager'
import { getCamera } from '../lib/camera-store'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  const id = typeof body.id === 'number' ? body.id : parseInt(String(body?.id || '0'))
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const which = body.which === 'main' || body.which === 'sub' || body.which === 'both' ? body.which : 'both'

  const row = getCamera(id)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Camera not found' })
  }

  await addStream(id, row.name, row.main_rtsp_url, row.sub_rtsp_url, which)
  
  return {
    id,
    name: row.name,
    mainStreamUrl: getStreamUrl(id, 'main'),
    subStreamUrl: getStreamUrl(id, 'sub')
  }
})
