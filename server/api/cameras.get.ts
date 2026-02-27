import { getStreamUrl } from '../lib/stream-manager'
import { listCameras } from '../lib/camera-store'

export default defineEventHandler(() => {
  return listCameras().map((c) => ({
    id: c.id,
    name: c.name,
    mainStreamUrl: getStreamUrl(c.id, 'main'),
    subStreamUrl: getStreamUrl(c.id, 'sub')
  }))
})
