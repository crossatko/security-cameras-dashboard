import { getStreamUrl, removeStream } from '../../lib/stream-manager'
import { updateCamera } from '../../lib/camera-store'

export default defineEventHandler(async (event) => {
  const id = parseInt(event.context.params?.id || '0')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }

  const body = await readBody(event)
  const name = String(body?.name || '').trim()
  const mainRtspUrl = String(body?.mainRtspUrl || '').trim()
  const subRtspUrl = String(body?.subRtspUrl || '').trim()

  if (!name || !mainRtspUrl || !subRtspUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing name/mainRtspUrl/subRtspUrl' })
  }

  // Restart stream processes on next play with the new URLs.
  removeStream(id)

  try {
    const row = updateCamera(id, { name, mainRtspUrl, subRtspUrl })
    return {
      id: row.id,
      name: row.name,
      mainRtspUrl: row.main_rtsp_url,
      subRtspUrl: row.sub_rtsp_url,
      mainStreamUrl: getStreamUrl(row.id, 'main'),
      subStreamUrl: getStreamUrl(row.id, 'sub')
    }
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Camera not found' })
  }
})
