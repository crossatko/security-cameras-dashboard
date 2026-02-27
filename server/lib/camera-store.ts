import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CameraRow {
  id: number
  name: string
  main_rtsp_url: string
  sub_rtsp_url: string
  created_at: number
}

const dbPath = process.env.DB_PATH || join(process.cwd(), 'data', 'nahledovka.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    main_rtsp_url TEXT NOT NULL,
    sub_rtsp_url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`)

const stmtList = db.prepare('SELECT id, name, main_rtsp_url, sub_rtsp_url, created_at FROM cameras ORDER BY id DESC')
const stmtGet = db.prepare('SELECT id, name, main_rtsp_url, sub_rtsp_url, created_at FROM cameras WHERE id = ?')
const stmtInsert = db.prepare(
  'INSERT INTO cameras (name, main_rtsp_url, sub_rtsp_url, created_at) VALUES (?, ?, ?, ?)'
)
const stmtDelete = db.prepare('DELETE FROM cameras WHERE id = ?')

export function listCameras(): CameraRow[] {
  return stmtList.all() as CameraRow[]
}

export function getCamera(id: number): CameraRow | undefined {
  return stmtGet.get(id) as CameraRow | undefined
}

export function createCamera(input: { name: string; mainRtspUrl: string; subRtspUrl: string }): CameraRow {
  const createdAt = Date.now()
  const info = stmtInsert.run(input.name, input.mainRtspUrl, input.subRtspUrl, createdAt)
  const id = Number(info.lastInsertRowid)
  const row = getCamera(id)
  if (!row) {
    throw new Error('Failed to read inserted camera')
  }
  return row
}

export function deleteCamera(id: number): boolean {
  const info = stmtDelete.run(id)
  return info.changes > 0
}
