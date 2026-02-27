import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const path = event.context.params?.path
  if (!path) {
    throw createError({ statusCode: 404 })
  }

  const filePath = join(process.cwd(), 'public', 'streams', path)
  
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')
  setHeader(event, 'Cache-Control', 'no-cache, no-store, must-revalidate')
  
  if (event.method === 'OPTIONS' || event.method === 'HEAD') {
    try {
      await stat(filePath)
      return ''
    } catch {
      throw createError({ statusCode: 404 })
    }
  }

  try {
    const content = await readFile(filePath)
    
    if (path.endsWith('.m3u8')) {
      setHeader(event, 'Content-Type', 'application/vnd.apple.mpegurl')
    } else if (path.endsWith('.ts')) {
      setHeader(event, 'Content-Type', 'video/mp2t')
    } else {
      setHeader(event, 'Content-Type', 'application/octet-stream')
    }
    
    return content
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'File not found: ' + filePath })
  }
})
