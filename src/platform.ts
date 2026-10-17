export type ProjectIoResult = { canceled: boolean; filePath?: string; json?: string }
export type RecoverySnapshotMeta = {
  id: string
  createdAt: number
  label: string
  itemCount: number
  sizeBytes: number
}

type RecoveryRecord = RecoverySnapshotMeta & { json: string; version: 1 }
type RecoveryDbRecord = Partial<RecoveryRecord> & { id: string; lastRecoveryAt?: number; json?: string }

type NativeBridge = {
  saveAs(json: string): Promise<ProjectIoResult>
  save(filePath: string, json: string): Promise<ProjectIoResult>
  open(): Promise<ProjectIoResult>
  autosave(json: string): Promise<{ filePath?: string }>
  loadAutosave(): Promise<{ exists: boolean; json?: string }>
  exportText(text: string): Promise<ProjectIoResult>
}

function native(): NativeBridge | null {
  return typeof window !== 'undefined' && window.mathCanvas ? window.mathCanvas : null
}

const AUTOSAVE_KEY = 'mathcanvas.autosave.v3'
const DB_NAME = 'mathcanvas-recovery-v1'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const RECOVERY_INTERVAL_MS = 2 * 60 * 1000
const MAX_RECOVERY_SNAPSHOTS = 5
const META_ID = '__meta__'

function openRecoveryDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open recovery storage'))
    request.onblocked = () => reject(new Error('Recovery storage is blocked by another tab'))
  })
}

function snapshotLabel(json: string): { label: string; itemCount: number } {
  try {
    const parsed = JSON.parse(json) as { canvas?: { items?: unknown[] }; savedAt?: string }
    const count = Array.isArray(parsed.canvas?.items) ? parsed.canvas.items.length : 0
    return { label: count ? `${count} canvas item${count === 1 ? '' : 's'}` : 'Empty canvas', itemCount: count }
  } catch {
    return { label: 'Recovery snapshot', itemCount: 0 }
  }
}

/** Save the latest state in IndexedDB (which supports much larger projects than localStorage).
 * Keep a small, time-spaced recovery history instead of duplicating every autosave. */
async function saveRecoveryState(json: string): Promise<void> {
  const db = await openRecoveryDb()
  const now = Date.now()
  const info = snapshotLabel(json)
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put({ id: 'current', version: 1, createdAt: now, label: 'Latest autosave', itemCount: info.itemCount, sizeBytes: json.length, json } satisfies RecoveryDbRecord)
    const metaRequest = store.get(META_ID)
    metaRequest.onsuccess = () => {
      const meta = metaRequest.result as RecoveryDbRecord | undefined
      if (!meta?.lastRecoveryAt || now - meta.lastRecoveryAt >= RECOVERY_INTERVAL_MS) {
        const id = `recovery-${now}`
        store.put({ id, version: 1, createdAt: now, label: info.label, itemCount: info.itemCount, sizeBytes: json.length, json } satisfies RecoveryRecord)
        store.put({ id: META_ID, lastRecoveryAt: now })
        const allRequest = store.getAll()
        allRequest.onsuccess = () => {
          const oldRecords = (allRequest.result as RecoveryDbRecord[])
            .filter((record) => record.id.startsWith('recovery-'))
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            .slice(MAX_RECOVERY_SNAPSHOTS)
          oldRecords.forEach((record) => store.delete(record.id))
        }
      }
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not save recovery data')) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Recovery save was interrupted')) }
  })
}

export async function listRecoverySnapshots(): Promise<RecoverySnapshotMeta[]> {
  try {
    const db = await openRecoveryDb()
    const rows = await new Promise<RecoveryDbRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as RecoveryDbRecord[])
      request.onerror = () => reject(request.error ?? new Error('Could not list recovery snapshots'))
      tx.oncomplete = () => db.close()
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not read recovery snapshots')) }
    })
    return rows.filter((record) => record.id.startsWith('recovery-') && typeof record.json === 'string')
      .map(({ id, createdAt = 0, label = 'Recovery snapshot', itemCount = 0, sizeBytes = 0 }) => ({ id, createdAt, label, itemCount, sizeBytes }))
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function loadRecoverySnapshot(id: string): Promise<string | undefined> {
  if (!id.startsWith('recovery-')) return undefined
  try {
    const db = await openRecoveryDb()
    return await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve(typeof request.result?.json === 'string' ? request.result.json as string : undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not load recovery snapshot'))
      tx.oncomplete = () => db.close()
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not read recovery snapshot')) }
    })
  } catch {
    return undefined
  }
}

export async function autosave(json: string) {
  const bridge = native()
  if (bridge) {
    // The desktop file autosave is the primary latest-state copy. Recovery history
    // is best-effort and must never make a successful desktop autosave fail.
    const result = await bridge.autosave(json)
    try { await saveRecoveryState(json) } catch { /* keep the main autosave usable */ }
    return result
  }
  try {
    await saveRecoveryState(json)
    return { filePath: 'browser://indexeddb-autosave' }
  } catch (error) {
    // Compatibility fallback for older browsers that lack IndexedDB.
    localStorage.setItem(AUTOSAVE_KEY, json)
    return { filePath: 'browser://local-autosave', warning: error instanceof Error ? error.message : 'IndexedDB unavailable' }
  }
}

export async function loadAutosave() {
  const bridge = native()
  if (bridge) {
    const desktop = await bridge.loadAutosave()
    if (desktop.exists && desktop.json) return desktop
  }
  try {
    const db = await openRecoveryDb()
    const cached = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get('current')
      request.onsuccess = () => resolve(typeof request.result?.json === 'string' ? request.result.json as string : undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not load autosave'))
      tx.oncomplete = () => db.close()
      tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Could not read autosave')) }
    })
    if (cached) return { exists: true, json: cached }
  } catch { /* fall through to old localStorage autosave */ }
  const json = localStorage.getItem(AUTOSAVE_KEY)
  return json ? { exists: true, json } : { exists: false }
}

export async function saveProject(json: string): Promise<ProjectIoResult> {
  const bridge = native()
  if (bridge) return bridge.saveAs(json)
  downloadBlob(new Blob([json], { type: 'application/json' }), 'MathCanvas.mathcanvas')
  return { canceled: false, filePath: 'download://MathCanvas.mathcanvas' }
}

export async function saveProjectToPath(filePath: string, json: string): Promise<ProjectIoResult> {
  const bridge = native()
  if (bridge && !filePath.startsWith('download://')) return bridge.save(filePath, json)
  const fileName = filePath.startsWith('download://') ? filePath.slice('download://'.length) : filePath
  downloadBlob(new Blob([json], { type: 'application/json' }), fileName || 'MathCanvas.mathcanvas')
  return { canceled: false, filePath }
}

export async function openProject(): Promise<ProjectIoResult> {
  const bridge = native()
  if (bridge) return bridge.open()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.mathcanvas,.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve({ canceled: true })
      resolve({ canceled: false, filePath: file.name, json: await file.text() })
    }
    input.click()
  })
}

export async function exportText(text: string): Promise<ProjectIoResult> {
  const bridge = native()
  if (bridge) return bridge.exportText(text)
  downloadBlob(new Blob([text], { type: 'text/plain' }), 'math-work.txt')
  return { canceled: false, filePath: 'download://math-work.txt' }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
