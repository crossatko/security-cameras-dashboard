import { getStreamUrl } from '../lib/stream-manager'
import { createCamera } from '../lib/camera-store'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const name = String(body?.name || '').trim()
  const mainRtspUrl = String(body?.mainRtspUrl || '').trim()
  const subRtspUrl = String(body?.subRtspUrl || '').trim()

  if (!name || !mainRtspUrl || !subRtspUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Missing name/mainRtspUrl/subRtspUrl' })
  }

  const row = createCamera({ name, mainRtspUrl, subRtspUrl })

  return {
    id: row.id,
    name: row.name,
    mainStreamUrl: getStreamUrl(row.id, 'main'),
    subStreamUrl: getStreamUrl(row.id, 'sub')
  }
})
