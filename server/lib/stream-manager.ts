import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

interface StreamProcess {
  id: number
  name: string
  mainUrl: string
  subUrl: string
  mainProcess?: ChildProcess
  subProcess?: ChildProcess
}

const streams = new Map<number, StreamProcess>()
const hlsDir = join(process.cwd(), 'public', 'streams')

async function ensureHlsDir() {
  try {
    await mkdir(hlsDir, { recursive: true })
  } catch {}
}

async function startFFmpeg(rtspUrl: string, outputPath: string): Promise<ChildProcess> {
  await ensureHlsDir()
  
  console.log(`[FFmpeg] Starting: ${outputPath}`)
  
  const args = [
    '-rtsp_transport', 'tcp',
    // Keep probing minimal to reduce startup delay, but not so low that RTSP
    // streams fail to initialize on some cameras.
    '-analyzeduration', '0',
    '-probesize', '256k',
    '-i', rtspUrl,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-sc_threshold', '0',
    '-bf', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '2',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
    '-flush_packets', '1',
    outputPath
  ]

  const proc = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let frameCount = 0
  let lastLog = Date.now()
  
  proc.stderr.on('data', (data) => {
    const msg = data.toString()
    
    if (msg.includes('frame=')) {
      frameCount++
      if (Date.now() - lastLog > 5000) {
        console.log(`[FFmpeg ${outputPath}] frames: ${frameCount}, msg: ${msg.slice(0, 100)}`)
        lastLog = Date.now()
      }
    }
    if (msg.includes('error') || msg.includes('Error') || msg.includes('failed')) {
      console.error(`[FFmpeg ${outputPath}]`, msg.slice(-300))
    }
  })

  proc.on('exit', (code) => {
    console.log(`[FFmpeg ${outputPath}] exited with code ${code}`)
  })

  return proc
}

export async function addStream(
  id: number,
  name: string,
  mainUrl: string,
  subUrl: string,
  which: 'main' | 'sub' | 'both' = 'both'
) {
  const stream = streams.get(id)

  if (!stream) {
    streams.set(id, { id, name, mainUrl, subUrl })
  } else {
    stream.name = name
    stream.mainUrl = mainUrl
    stream.subUrl = subUrl
  }

  const s = streams.get(id)!
  const mainPath = join(hlsDir, `cam${id}_main.m3u8`)
  const subPath = join(hlsDir, `cam${id}_sub.m3u8`)

  if (which === 'main' || which === 'both') {
    s.mainProcess?.kill()
    s.mainProcess = await startFFmpeg(mainUrl, mainPath)
  }

  if (which === 'sub' || which === 'both') {
    s.subProcess?.kill()
    s.subProcess = await startFFmpeg(subUrl, subPath)
  }

  console.log(`[StreamManager] Ensured stream ${name} (id: ${id}, which: ${which})`)
}

export function removeStream(id: number) {
  const stream = streams.get(id)
  if (!stream) return

  stream.mainProcess?.kill()
  stream.subProcess?.kill()
  streams.delete(id)
  console.log(`[StreamManager] Stopped stream ${stream.name} (id: ${id})`)
}

export function getStreamUrl(id: number, type: 'main' | 'sub'): string {
  return `/api/streams/cam${id}_${type}.m3u8`
}
