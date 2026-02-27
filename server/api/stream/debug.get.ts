import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const hlsDir = join(process.cwd(), 'public', 'streams')
  
  try {
    const files = await readdir(hlsDir)
    const m3u8Files = files.filter(f => f.endsWith('.m3u8'))
    
    const content: Record<string, string> = {}
    for (const file of m3u8Files.slice(0, 2)) {
      content[file] = await readFile(join(hlsDir, file), 'utf-8')
    }
    
    return { files, content }
  } catch (e) {
    return { error: String(e) }
  }
})
