import React, { useCallback, useEffect, useRef, useState } from 'react'
import { all, create } from 'mathjs'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { CanvasItem, CanvasShapeType, CanvasTool, CanvasViewport, NativeCanvas, NativeCanvasHandle, LineOptions, RemoteCursor, ShapeOptions, TextOptions, defaultViewport, makeEquation, makePage, makePhysicsItem, makeStudioGraph, makeTable, makeItemId, migrateLegacySnapshot } from './canvas'
import type { CollaborationPeer, FirebaseCollaboration } from './collaboration'
import { GraphingStudio } from './GraphingStudio'
import { PhysicsStudio, makePhysicsDocument } from './PhysicsStudio'
import type { PhysicsDocument } from './physics'
import { legacyGraphToStudio, makeGraphStudioDocument, type GraphStudioDocument } from './graphing'
import { autosave, downloadBlob, exportText, loadAutosave, openProject, saveProject, saveProjectToPath, listRecoverySnapshots, loadRecoverySnapshot, RecoverySnapshotMeta } from './platform'
import { ProblemSolverPage, CanvasRegionSelection, type ProblemSolution } from './ProblemSolver'
import { SolverSettings, useSolverPreferences } from './solver-settings'

GlobalWorkerOptions.workerSrc = pdfWorker
const math = create(all, {})
const AUTOSAVE_MS = 900
type Panel = 'none' | 'function' | 'table' | 'measure' | 'calculator' | 'science'
type GraphMode = 'normal' | 'piecewise' | 'parametric' | 'polar'
type CanvasExportFormat = 'png' | 'jpeg' | 'pdf' | 'project' | 'equations'
type PdfLibraryDocument = { id: string; fileName: string; data: Uint8Array; pageCount: number; previews: { pageNumber: number; src: string }[]; addedPageNumbers: number[]; loading: boolean; importing: boolean; error?: string }
type ProjectEnvelope = { version: 3 | 4; savedAt: string; canvas: { items: CanvasItem[]; viewport: CanvasViewport; gridVisible: boolean }; app: { lastFilePath?: string; gridUnits: number; drawHotkey: string; brushSize?: number; brushColor?: string; textSize?: number; shapeOptions?: ShapeOptions; textOptions?: TextOptions; lineOptions?: LineOptions } }

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable || !!target.closest('.math-field, math-field, .graph-studio, .physics-studio')
}


function cloneCanvasItem(item: CanvasItem): CanvasItem { return JSON.parse(JSON.stringify(item)) as CanvasItem }
function translateCanvasItem(item: CanvasItem, dx: number, dy: number): CanvasItem {
  if (item.kind === 'stroke') return { ...item, x: item.x + dx, y: item.y + dy, points: item.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
  return { ...item, x: item.x + dx, y: item.y + dy }
}

function parseColor(color: string) {
  if (color.toLowerCase() === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 }
  const hex = color.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    }
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+)\s*)?\)$/i)
  if (rgb) return { red: Number(rgb[1]), green: Number(rgb[2]), blue: Number(rgb[3]), alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) }
  return { red: 17, green: 24, blue: 39, alpha: 1 }
}

function colorHex(color: string) {
  const { red, green, blue } = parseColor(color)
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

function colorWithOpacity(color: string, opacity: number) {
  const { red, green, blue } = parseColor(color)
  const alpha = Math.max(0, Math.min(100, opacity)) / 100
  return alpha === 1 ? colorHex(color) : `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${alpha})`
}

function colorWithHue(color: string, hex: string) {
  return colorWithOpacity(hex, parseColor(color).alpha * 100)
}

async function convertPngToJpeg(blob: Blob) {
  const image = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create an image canvas')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('JPEG conversion failed')), 'image/jpeg', 0.92))
  } finally {
    image.close()
  }
}

async function createPdfFromJpeg(jpeg: Blob) {
  const image = await createImageBitmap(jpeg)
  const imageWidth = image.width
  const imageHeight = image.height
  image.close()
  const jpegBytes = new Uint8Array(await jpeg.arrayBuffer())
  const pageWidth = 612
  const pageHeight = 792
  const margin = 36
  const scale = Math.min((pageWidth - margin * 2) / imageWidth, (pageHeight - margin * 2) / imageHeight)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  const x = (pageWidth - drawWidth) / 2
  const y = (pageHeight - drawHeight) / 2
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let offset = 0
  const append = (chunk: Uint8Array) => { chunks.push(chunk); offset += chunk.length }
  const appendText = (text: string) => append(encoder.encode(text))
  const objectOffsets: number[] = [0]

  appendText('%PDF-1.4\n')
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  ]
  for (const object of objects) {
    objectOffsets.push(offset)
    appendText(object)
  }
  objectOffsets.push(offset)
  appendText(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`)
  append(jpegBytes)
  appendText('\nendstream\nendobj\n')
  const content = `q\n${drawWidth} 0 0 ${drawHeight} ${x} ${y} cm\n/Im0 Do\nQ\n`
  objectOffsets.push(offset)
  appendText(`5 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`)
  const xrefOffset = offset
  appendText(`xref\n0 ${objectOffsets.length}\n0000000000 65535 f \n${objectOffsets.slice(1).map((objectOffset) => `${String(objectOffset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objectOffsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  const output = new ArrayBuffer(offset)
  const outputBytes = new Uint8Array(output)
  let cursor = 0
  for (const chunk of chunks) { outputBytes.set(chunk, cursor); cursor += chunk.length }
  return new Blob([output], { type: 'application/pdf' })
}

function wrapTextLine(value: string, maxLength: number) {
  const words = value.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > maxLength && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function ColorControl({ label, color, disabled = false, onChange, className = '' }: { label: string; color: string; disabled?: boolean; onChange: (color: string) => void; className?: string }) {
  const opacity = Math.round(parseColor(color).alpha * 100)
  return <div className={`color-control ${className}`}>
    <label>{label} <input type="color" value={colorHex(color)} disabled={disabled} onChange={(event) => onChange(colorWithHue(color, event.target.value))} /></label>
    <label className="opacity-control"><span>Opacity</span><input type="range" min="0" max="100" step="1" value={opacity} disabled={disabled} aria-label={`${label} opacity`} onChange={(event) => onChange(colorWithOpacity(color, Number(event.target.value)))} /><span>{opacity}%</span></label>
  </div>
}

export function App() {
  const [solverPreferences, updateSolverPreferences] = useSolverPreferences()
  const canvasRef = useRef<NativeCanvasHandle>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collaborationRef = useRef<FirebaseCollaboration | null>(null)
  const history = useRef<{ past: CanvasItem[][]; future: CanvasItem[][] }>({ past: [], future: [] })
  const [items, setItems] = useState<CanvasItem[]>([])
  const [viewport, setViewport] = useState<CanvasViewport>(defaultViewport)
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [tool, setTool] = useState<CanvasTool>('select')
  const [panel, setPanel] = useState<Panel>('none')
  const [graphStudioItemId, setGraphStudioItemId] = useState<string>()
  const [physicsStudioItemId, setPhysicsStudioItemId] = useState<string>()
  const [status, setStatus] = useState('Loading workspace…')
  const [filePath, setFilePath] = useState<string>()
  const [gridUnits, setGridUnits] = useState(1)
  const [gridVisible, setGridVisible] = useState(true)
  const [holdDrawing, setHoldDrawing] = useState(false)
  const [brushSize, setBrushSize] = useState(3)
  const [brushColor, setBrushColor] = useState('#111827')
  const [textSize, setTextSize] = useState(20)
  const [shapeOptions, setShapeOptions] = useState<ShapeOptions>({ shapeType: 'rectangle', borderOn: true, fillOn: false, borderColor: '#111827', fillColor: '#fde68a', borderWidth: 2 })
  const [textOptions, setTextOptions] = useState<TextOptions>({ textColor: '#111827', fillEnabled: false, fillColor: '#ffffff' })
  const [lineOptions, setLineOptions] = useState<LineOptions>({ color: '#111827', width: 2.5, style: 'solid', startArrow: false, endArrow: false })
  const [ready, setReady] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [showSolverSettings, setShowSolverSettings] = useState(false)
  const [solverCaptureError, setSolverCaptureError] = useState('')
  const [canvasCaptureActive, setCanvasCaptureActive] = useState(false)
  const [solverImage, setSolverImage] = useState<string>()
  const [solverInsertionPoint, setSolverInsertionPoint] = useState<{ x: number; y: number }>({ x: 260, y: 180 })
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [showCollaboration, setShowCollaboration] = useState(false)
  const [collaborationAvailable, setCollaborationAvailable] = useState(false)
  const [collaborationActive, setCollaborationActive] = useState(false)
  const [collaborationName, setCollaborationName] = useState('')
  const [collaborationStatus, setCollaborationStatus] = useState('Not connected')
  const [collaborationPeers, setCollaborationPeers] = useState<CollaborationPeer[]>([])
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([])
  const [collaborationRoomCode, setCollaborationRoomCode] = useState('')
  const [collaborationRequests, setCollaborationRequests] = useState<CollaborationPeer[]>([])
  const [collaborationBusy, setCollaborationBusy] = useState(false)
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshotMeta[]>([])
  const [pdfLibrary, setPdfLibrary] = useState<PdfLibraryDocument[]>([])
  const pdfImportQueue = useRef<{ file: File; id: string }[]>([])
  const pdfImporting = useRef(false)
  const drawHotkey = 'd'
  const toolRef = useRef(tool)
  const copyBufferRef = useRef<CanvasItem[] | null>(null)
  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => {
    const selected = items.find((item) => item.id === selectedId)
    if (selected?.kind === 'shape') setShapeOptions({
      shapeType: selected.shapeType ?? 'rectangle', borderOn: selected.borderOn ?? true,
      fillOn: selected.fillOn ?? Boolean(selected.fill && selected.fill !== 'transparent'),
      borderColor: selected.borderColor ?? selected.color ?? '#111827',
      fillColor: selected.fillColor ?? selected.fill ?? '#fde68a', borderWidth: selected.borderWidth ?? 2,
    })
    if (selected?.kind === 'text') setTextOptions({ textColor: selected.textColor ?? '#111827', fillEnabled: selected.fillEnabled ?? false, fillColor: selected.fillColor ?? '#ffffff' })
    if (selected?.kind === 'line') setLineOptions({ color: selected.color ?? '#111827', width: selected.width ?? 2.5, style: selected.style ?? 'solid', startArrow: selected.startArrow ?? false, endArrow: selected.endArrow ?? false })
  }, [items, selectedId])

  // The primary selection is also kept inside the multi-selection, unless it is cleared.
  useEffect(() => {
    setSelectedIds((current) => selectedId ? (current.includes(selectedId) ? current : [selectedId]) : (current.length ? [] : current))
  }, [selectedId])

  const projectJson = useCallback(() => JSON.stringify({ version: 4, savedAt: new Date().toISOString(), canvas: { items, viewport, gridVisible }, app: { lastFilePath: filePath, gridUnits, drawHotkey, brushSize, brushColor, textSize, shapeOptions, textOptions, lineOptions } satisfies ProjectEnvelope['app'] } satisfies ProjectEnvelope), [brushColor, brushSize, drawHotkey, filePath, gridUnits, gridVisible, items, lineOptions, shapeOptions, textOptions, textSize, viewport])
  const resetHistory = () => { history.current = { past: [], future: [] } }
  const commitItems = useCallback((next: CanvasItem[]) => setItems((current) => { history.current.past = [...history.current.past.slice(-59), current]; history.current.future = []; return next }), [])
  const updateItems = useCallback((update: (current: CanvasItem[]) => CanvasItem[]) => setItems((current) => { const next = update(current); history.current.past = [...history.current.past.slice(-59), current]; history.current.future = []; return next }), [])
  const appendItem = useCallback((item: CanvasItem) => { updateItems((current) => [...current, item]); setSelectedId(item.id) }, [updateItems])

  useEffect(() => { collaborationRef.current?.setItems(items) }, [items])
  useEffect(() => {
    const selection = [...new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])]
    collaborationRef.current?.updateSelection(selection)
  }, [selectedId, selectedIds])
  useEffect(() => () => collaborationRef.current?.dispose(), [])

  const collaborationCallbacks = () => ({
    initialItems: items,
    onItems: commitItems,
    onPeers: setCollaborationPeers,
    onCursors: setRemoteCursors,
    onJoinRequest: (peer: CollaborationPeer) => setCollaborationRequests((current) => current.some((entry) => entry.peerId === peer.peerId) ? current : [...current, peer]),
    onJoinRequestRemoved: (peerId: string) => setCollaborationRequests((current) => current.filter((entry) => entry.peerId !== peerId)),
    onStatus: setCollaborationStatus,
  })

  const openCollaborationPanel = async () => {
    setShowCollaboration(true)
    try {
      const { isFirebaseConfigured } = await import('./collaboration')
      setCollaborationAvailable(isFirebaseConfigured())
    } catch (error) {
      setCollaborationStatus(`Could not load online collaboration: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const startCollaborationHost = async () => {
    setCollaborationBusy(true)
    setCollaborationStatus('Connecting to Firebase…')
    try {
      const { FirebaseCollaboration } = await import('./collaboration')
      const session = await FirebaseCollaboration.host(collaborationName, collaborationCallbacks())
      collaborationRef.current?.dispose()
      collaborationRef.current = session
      session.updateSelection(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])
      setCollaborationRoomCode(session.code)
      setCollaborationActive(true)
      setCollaborationPeers([])
      setRemoteCursors([])
      setCollaborationRequests([])
      setCollaborationStatus(`Hosting “${session.roomName}”. Share the invite code and approve incoming requests.`)
    } catch (error) {
      setCollaborationStatus(`Could not start room: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCollaborationBusy(false)
    }
  }

  const joinCollaborationRoom = async () => {
    setCollaborationBusy(true)
    setCollaborationStatus('Connecting to Firebase…')
    try {
      const { FirebaseCollaboration } = await import('./collaboration')
      const session = await FirebaseCollaboration.join(collaborationRoomCode, collaborationName, collaborationCallbacks())
      collaborationRef.current?.dispose()
      collaborationRef.current = session
      session.updateSelection(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])
      setCollaborationRoomCode(session.code)
      setCollaborationActive(true)
      setRemoteCursors([])
      setCollaborationStatus(`Requesting access to “${session.roomName}”…`)
    } catch (error) {
      setCollaborationStatus(`Could not join room: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCollaborationBusy(false)
    }
  }

  const answerCollaborationRequest = async (peerId: string, approved: boolean) => {
    try {
      if (!collaborationRef.current) throw new Error('The collaboration room is not active.')
      await collaborationRef.current.approve(peerId, approved)
      setCollaborationRequests((current) => current.filter((peer) => peer.peerId !== peerId))
    } catch (error) {
      setCollaborationStatus(`Could not respond to join request: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const leaveCollaboration = async () => {
    try {
      await collaborationRef.current?.leave()
      collaborationRef.current = null
      setCollaborationActive(false)
      setCollaborationPeers([])
      setRemoteCursors([])
      setCollaborationRequests([])
      setCollaborationRoomCode('')
      setCollaborationStatus('Not connected')
    } catch (error) {
      setCollaborationStatus(`Could not leave room: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const copyCollaborationCode = async () => {
    try {
      await navigator.clipboard.writeText(collaborationRoomCode)
      setCollaborationStatus('Invite code copied to clipboard.')
    } catch (error) {
      setCollaborationStatus(`Could not copy the invite code: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const restoreProject = useCallback((json: string, restoredPath?: string) => {
    const parsed = JSON.parse(json) as Partial<ProjectEnvelope> & { snapshot?: unknown }
    if ((parsed.version === 3 || parsed.version === 4) && parsed.canvas?.items) {
      setItems(parsed.canvas.items.map((item) => item.kind === 'page' ? { ...item, locked: false } : item)); setViewport(parsed.canvas.viewport ?? defaultViewport); setGridVisible(parsed.canvas.gridVisible ?? true); setGridUnits(parsed.app?.gridUnits ?? 1); setBrushSize(parsed.app?.brushSize ?? 3); setBrushColor((parsed.app as any)?.brushColor ?? '#111827'); setTextSize(parsed.app?.textSize ?? 20); setShapeOptions((parsed.app as any)?.shapeOptions ?? { shapeType: 'rectangle', borderOn: true, fillOn: false, borderColor: '#111827', fillColor: '#fde68a', borderWidth: 2 }); setTextOptions((parsed.app as any)?.textOptions ?? { textColor: '#111827', fillEnabled: false, fillColor: '#ffffff' }); setLineOptions((parsed.app as any)?.lineOptions ?? { color: '#111827', width: 2.5, style: 'solid', startArrow: false, endArrow: false }); setFilePath(restoredPath ?? parsed.app?.lastFilePath); setSelectedId(undefined); setSelectedIds([]); resetHistory(); return true
    }
    if (parsed.snapshot) {
      const migrated = migrateLegacySnapshot(parsed.snapshot)
      setItems(migrated.map((item) => item.kind === 'page' ? { ...item, locked: false } : item)); setViewport(defaultViewport); setGridVisible(true); setGridUnits(parsed.app?.gridUnits ?? 1); setBrushSize(parsed.app?.brushSize ?? 3); setBrushColor((parsed.app as any)?.brushColor ?? '#111827'); setTextSize(parsed.app?.textSize ?? 20); setShapeOptions((parsed.app as any)?.shapeOptions ?? { shapeType: 'rectangle', borderOn: true, fillOn: false, borderColor: '#111827', fillColor: '#fde68a', borderWidth: 2 }); setTextOptions((parsed.app as any)?.textOptions ?? { textColor: '#111827', fillEnabled: false, fillColor: '#ffffff' }); setLineOptions((parsed.app as any)?.lineOptions ?? { color: '#111827', width: 2.5, style: 'solid', startArrow: false, endArrow: false }); setFilePath(restoredPath ?? parsed.app?.lastFilePath); setSelectedId(undefined); setSelectedIds([]); resetHistory(); setStatus(migrated.length ? 'Opened and migrated legacy project' : 'Opened legacy project'); return true
    }
    return false
  }, [])

  useEffect(() => {
    let active = true
    void loadAutosave().then((result) => {
      if (!active) return
      if (result.exists && result.json) { try { setStatus(restoreProject(result.json) ? 'Restored from autosave' : 'New document') } catch { setStatus('New document') } } else setStatus('New document')
      setReady(true)
    }).catch(() => { if (active) { setStatus('New document'); setReady(true) } })
    return () => { active = false }
  }, [restoreProject])
  useEffect(() => {
    if (!ready) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void autosave(projectJson()).then(() => setStatus('Saved locally')).catch(() => setStatus('Autosave failed')) }, AUTOSAVE_MS)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [items, viewport, gridVisible, gridUnits, filePath, brushSize, brushColor, textSize, shapeOptions, textOptions, lineOptions, projectJson, ready])

  const openRecovery = useCallback(async () => { const snapshots = await listRecoverySnapshots(); setRecoverySnapshots(snapshots); setShowRecovery(true) }, [])
  const restoreRecovery = useCallback(async (id: string) => {
    const json = await loadRecoverySnapshot(id)
    if (!json) { setStatus('Recovery snapshot could not be loaded'); return }
    try {
      if (restoreProject(json)) { setShowRecovery(false); setStatus('Restored recovery snapshot') }
      else setStatus('Recovery snapshot format is not supported')
    } catch { setStatus('Recovery snapshot is damaged or unsupported') }
  }, [restoreProject])
  const saveAs = useCallback(async () => {
    setStatus('Saving…')
    try {
      const result = await saveProject(projectJson())
      if (!result.canceled) { setFilePath(result.filePath); setStatus('Saved') }
      else setStatus('Save cancelled')
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [projectJson])
  const save = useCallback(async () => {
    if (!filePath) { await saveAs(); return }
    setStatus('Saving…')
    try {
      const result = await saveProjectToPath(filePath, projectJson())
      if (!result.canceled) setStatus('Saved')
      else setStatus('Save cancelled')
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [filePath, projectJson, saveAs])
  const open = useCallback(async () => { const result = await openProject(); if (result.canceled || !result.json) return; try { setStatus(restoreProject(result.json, result.filePath) ? 'Opened' : 'Unsupported project format') } catch { setStatus('Could not open project') } }, [restoreProject])
  const newDocument = useCallback(() => { setItems([]); setViewport(defaultViewport); setSelectedId(undefined); setSelectedIds([]); setFilePath(undefined); resetHistory(); setStatus('New document') }, [])
  const undo = useCallback(() => setItems((current) => { const previous = history.current.past.pop(); if (!previous) return current; history.current.future = [current, ...history.current.future].slice(0, 60); setSelectedId(undefined); setSelectedIds([]); return previous }), [])
  const redo = useCallback(() => setItems((current) => { const next = history.current.future.shift(); if (!next) return current; history.current.past = [...history.current.past, current].slice(-60); setSelectedId(undefined); setSelectedIds([]); return next }), [])
  const deleteSelected = useCallback(() => { const ids = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []); if (!ids.size) return; updateItems((current) => current.filter((item) => !ids.has(item.id) || item.locked)); setSelectedId(undefined); setSelectedIds([]) }, [selectedId, selectedIds, updateItems])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const mod = event.ctrlKey || event.metaKey
      if (mod && key === 's') {
        event.preventDefault()
        if (event.shiftKey) void saveAs()
        else void save()
        return
      }
      if (isTypingTarget(event.target)) return
      if (mod && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if (mod && key === 'y') { event.preventDefault(); redo(); return }
      if (mod && key === 'c' && (selectedIds.length || selectedId)) {
        const ids = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])
        const copied = items.filter((candidate) => ids.has(candidate.id)).map(cloneCanvasItem)
        if (copied.length) { event.preventDefault(); copyBufferRef.current = copied; void navigator.clipboard?.writeText(`MathCanvasItems:${JSON.stringify(copied)}`) }
        return
      }
      if (mod && key === 'v') { return }
      if (mod && key === 'a') { event.preventDefault(); const ids = items.filter((item) => !item.locked).map((item) => item.id); setSelectedIds(ids); setSelectedId(ids.at(-1)); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedIds.length || selectedId)) { event.preventDefault(); deleteSelected(); return }
      if (event.key.startsWith('Arrow') && (selectedIds.length || selectedId)) {
        const ids = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])
        const chosen = items.filter((candidate) => ids.has(candidate.id))
        if (!chosen.length || chosen.some((item) => item.locked)) return
        event.preventDefault()
        const amount = event.shiftKey ? gridUnits * 32 : 4
        const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0
        const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0
        updateItems((current) => current.map((candidate) => ids.has(candidate.id) ? translateCanvasItem(candidate, dx, dy) : candidate))
        return
      }
      if (event.repeat) return
      const shortcuts: Record<string, CanvasTool> = { v: 'select', h: 'pan', p: 'draw', e: 'eraser', l: 'line', r: 'ruler', g: 'shape', t: 'text' }
      if (shortcuts[key] && !mod) setTool(shortcuts[key])
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [appendItem, deleteSelected, gridUnits, items, redo, save, saveAs, selectedId, selectedIds, undo, updateItems])

  useEffect(() => {
    const pasteImages = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('.canvas-editor, .modal-backdrop'))) return
      const clipboard = event.clipboardData
      const customText = clipboard?.getData('text/plain') ?? ''
      if (customText.startsWith('MathCanvasItems:') || customText.startsWith('MathCanvasItem:')) {
        event.preventDefault()
        try {
          const multi = customText.startsWith('MathCanvasItems:')
          const raw = customText.slice(multi ? 'MathCanvasItems:'.length : 'MathCanvasItem:'.length)
          const parsed = JSON.parse(raw) as CanvasItem | CanvasItem[]
          const copied = Array.isArray(parsed) ? parsed : [parsed]
          const nextItems = copied.map((item) => { const next = cloneCanvasItem(item); next.id = makeItemId(); next.x += 28; next.y += 28; if (next.kind === 'page') next.locked = false; return next })
          updateItems((current) => [...current, ...nextItems]); setSelectedIds(nextItems.map((item) => item.id)); setSelectedId(nextItems.at(-1)?.id)
          return
        } catch { /* Invalid app clipboard payload: continue and check for images. */ }
      }
      const files = Array.from(clipboard?.items ?? []).filter((entry) => entry.kind === 'file' && entry.type.startsWith('image/')).map((entry) => entry.getAsFile()).filter((file): file is File => !!file)
      if (files.length) {
        event.preventDefault()
        files.forEach((file) => void importImage(file))
        setStatus('Pasted image from clipboard')
        return
      }
      // Clipboard APIs can be blocked in some embedded contexts. Still allow a
      // same-session paste for objects copied inside MathCanvas.
      if (!customText && copyBufferRef.current?.length) {
        event.preventDefault()
        const pasted = copyBufferRef.current.map((item) => { const next = cloneCanvasItem(item); next.id = makeItemId(); next.x += 28; next.y += 28; if (next.kind === 'page') next.locked = false; return next })
        updateItems((current) => [...current, ...pasted]); setSelectedIds(pasted.map((item) => item.id)); setSelectedId(pasted.at(-1)?.id)
      }
    }
    window.addEventListener('paste', pasteImages)
    return () => window.removeEventListener('paste', pasteImages)
  })

  const center = () => canvasRef.current?.getCenter() ?? { x: 260, y: 180 }
  const startProblemSolver = () => {
    setSolverCaptureError('')
    setSolverInsertionPoint(center())
    setCanvasCaptureActive(true)
  }
  const confirmCanvasCapture = (region: { x: number; y: number; w: number; h: number }) => {
    try {
      const image = canvasRef.current?.captureRegion(region)
      if (!image) throw new Error('Canvas is not ready for capture')
      setSolverImage(image)
      setCanvasCaptureActive(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSolverCaptureError(`Could not capture canvas selection: ${message}`)
    }
  }
  const addSolverSteps = (kind: 'simple' | 'full', solution: ProblemSolution) => {
    const sourceSteps = kind === 'simple' ? solution.simpleSteps : solution.fullSteps
    const rawLines = [`${solution.title}`, ...sourceSteps.map((step, index) => `${index + 1}. ${step}`), `Answer: ${solution.answer}`]
    const lines = rawLines.flatMap((line) => wrapTextLine(line, 78))
    const item: CanvasItem = {
      id: makeItemId(), kind: 'text', x: solverInsertionPoint.x - 400, y: solverInsertionPoint.y - 100,
      w: 800, h: Math.max(40, lines.length * 25), text: lines.join('\n'), fontSize: 18,
      textColor: '#111827', fillEnabled: true, fillColor: '#ffffff',
    }
    appendItem(item)
    setSolverImage(undefined)
    setStatus(`Added ${kind} solution steps to canvas`)
  }

  const openGraphingStudio = useCallback((item?: Extract<CanvasItem, { kind: 'graph' }>) => {
    setGraphStudioItemId(item?.id)
    setPanel('function')
  }, [])
  const openPhysicsStudio = useCallback((item?: Extract<CanvasItem, { kind: 'physics' }>) => {
    setPhysicsStudioItemId(item?.id ?? '__new__')
  }, [])
  const addEquation = useCallback(() => { const point = center(); appendItem(makeEquation(point.x - 180, point.y - 45)) }, [appendItem])
  const insertCalculatorEquation = useCallback((expression: string, result: string, angleMode: 'rad' | 'deg', evaluationX?: number) => {
    const point = center()
    const evaluation = evaluationX === undefined ? '' : `\\big|_{x=${math.parse(String(evaluationX)).toTex()}}`
    const latex = `${math.parse(expression).toTex()}${evaluation}=${math.parse(result).toTex()}${angleMode === 'deg' ? '\\quad\\mathrm{DEG}' : ''}`
    appendItem({ ...makeEquation(point.x - 280, point.y - 45), w: 560, latex, fontSize: 28 })
    setPanel('none')
  }, [appendItem])
  const insertScienceFormula = useCallback((latex: string) => {
    const point = center()
    appendItem({ ...makeEquation(point.x - 280, point.y - 45), w: 560, latex, fontSize: 28 })
    setPanel('none')
  }, [appendItem])
  const applyGraphStudioDocument = useCallback((document: GraphStudioDocument) => {
    const existing = items.find((item): item is Extract<CanvasItem, { kind: 'graph' }> => item.kind === 'graph' && item.id === graphStudioItemId)
    if (existing) {
      updateItems((current) => current.map((item) => item.id === existing.id && item.kind === 'graph' ? { ...makeStudioGraph(item.x, item.y, document), id: item.id, w: item.w, h: item.h, locked: item.locked } : item))
      setSelectedId(existing.id)
      setSelectedIds([existing.id])
      return
    }
    const point = center()
    const item = makeStudioGraph(point.x - 280, point.y - 200, document)
    appendItem(item)
    setGraphStudioItemId(item.id)
  }, [appendItem, graphStudioItemId, items, updateItems])
  const applyPhysicsDocument = useCallback((document: PhysicsDocument, playback: 'snapshot' | 'loop') => {
    const existing = items.find((item): item is Extract<CanvasItem, { kind: 'physics' }> => item.kind === 'physics' && item.id === physicsStudioItemId)
    if (existing) {
      updateItems((current) => current.map((item) => item.id === existing.id && item.kind === 'physics'
        ? { ...item, studio: document, playback, playing: playback === 'loop' }
        : item))
      setSelectedId(existing.id)
      setSelectedIds([existing.id])
      return
    }
    const point = center()
    const item = makePhysicsItem(point.x - 280, point.y - 190, document, playback)
    appendItem(item)
    setPhysicsStudioItemId(item.id)
  }, [appendItem, items, physicsStudioItemId, updateItems])
  const addTable = useCallback((rows: number, cols: number) => { const point = center(); appendItem(makeTable(point.x - 260, point.y - 130, rows, cols)); setPanel('none') }, [appendItem])
  const importImage = async (file: File) => { const src = await fileToDataUrl(file); const dims = await getImageDimensions(src); const scale = Math.min(1, 780 / Math.max(dims.w, dims.h)); const point = center(); appendItem(makePage(point.x - dims.w * scale / 2, point.y - dims.h * scale / 2, dims.w * scale, dims.h * scale, src, file.name)); setStatus(`Imported ${file.name}`) }
  const openNextPdfImport = async () => {
    if (pdfImporting.current) return
    const queued = pdfImportQueue.current.shift()
    if (!queued) return
    pdfImporting.current = true
    const { file, id } = queued
    setStatus(`Preparing ${file.name}…`)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const loadingTask = getDocument({ data: data.slice() })
      const pdf = await loadingTask.promise
      const pageCount = pdf.numPages
      setPdfLibrary((current) => current.map((document) => document.id === id ? { ...document, data, pageCount } : document))
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const page = await pdf.getPage(pageNumber)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(0.32, 190 / base.width, 250 / base.height)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        const preview = { pageNumber, src: canvas.toDataURL('image/png') }
        setPdfLibrary((current) => current.map((entry) => entry.id === id ? { ...entry, previews: [...entry.previews, preview] } : entry))
      }
      await loadingTask.destroy()
      setPdfLibrary((current) => current.map((document) => document.id === id ? { ...document, loading: false } : document))
      setStatus(`Ready to import pages from ${file.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPdfLibrary((current) => current.map((document) => document.id === id ? { ...document, loading: false, error: message } : document))
      setStatus(`Could not prepare ${file.name}: ${message}`)
    } finally {
      pdfImporting.current = false
      if (pdfImportQueue.current.length) void openNextPdfImport()
    }
  }
  const importPdfPages = async (pdfDocument: PdfLibraryDocument, pageNumbers: number[]) => {
    if (pdfDocument.loading || pdfDocument.importing || !pageNumbers.length) return
    const currentImport = pdfDocument
    setPdfLibrary((current) => current.map((document) => document.id === currentImport.id ? { ...document, importing: true } : document))
    try {
      const loadingTask = getDocument({ data: currentImport.data.slice() })
      const pdf = await loadingTask.promise
      const existingPageCount = items.filter((item) => item.kind === 'page').length
      const pdfDocumentId = currentImport.id
      const pages: CanvasItem[] = []
      for (const pageNumber of pageNumbers) {
        const page = await pdf.getPage(pageNumber)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(1.35, 760 / base.width)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
        const point = center()
        const offset = existingPageCount + pages.length
        const pageItem = makePage(point.x - viewport.width / 2, point.y - viewport.height / 2 + offset * (viewport.height + 40), viewport.width, viewport.height, canvas.toDataURL('image/png'), `${currentImport.fileName} page ${pageNumber}`) as Extract<CanvasItem, { kind: 'page' }>
        pages.push({ ...pageItem, pdfDocumentId, pdfTitle: currentImport.fileName, pdfPageNumber: pageNumber, pdfPageCount: currentImport.pageCount })
      }
      await loadingTask.destroy()
      updateItems((current) => [...current, ...pages])
      setSelectedIds(pages.map((page) => page.id))
      setSelectedId(pages.at(-1)?.id)
      setStatus(`Imported ${pages.length} PDF page${pages.length === 1 ? '' : 's'} from ${currentImport.fileName}`)
      setPdfLibrary((current) => current.flatMap((document) => {
        if (document.id !== currentImport.id) return [document]
        const addedPageNumbers = [...new Set([...document.addedPageNumbers, ...pageNumbers])]
        return addedPageNumbers.length === document.pageCount ? [] : [{ ...document, addedPageNumbers, importing: false }]
      }))
    } catch (error) {
      setStatus(`Could not import pages from ${currentImport.fileName}: ${error instanceof Error ? error.message : String(error)}`)
      setPdfLibrary((current) => current.map((document) => document.id === currentImport.id ? { ...document, importing: false } : document))
    }
  }
  const importFiles = (files: FileList | null) => {
    if (!files) return
    const pdfFiles: File[] = []
    Array.from(files).forEach((file) => {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) pdfFiles.push(file)
      else if (file.type.startsWith('image/')) void importImage(file).catch((error) => setStatus(`Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`))
    })
    if (pdfFiles.length) {
      const documents = pdfFiles.map((file) => ({ file, id: makeItemId() }))
      setPdfLibrary((current) => [...current, ...documents.map(({ file, id }) => ({ id, fileName: file.name, data: new Uint8Array(), pageCount: 0, previews: [], addedPageNumbers: [], loading: true, importing: false }))])
      pdfImportQueue.current.push(...documents)
      void openNextPdfImport()
    }
  }
  const exportMathText = async () => { const lines = items.filter((item): item is Extract<CanvasItem, { kind: 'equation' }> => item.kind === 'equation').map((item) => `Equation: ${item.latex}`); await exportText(lines.length ? lines.join('\n') : 'MathCanvas') }
  const exportCanvas = async (format: CanvasExportFormat) => {
    try {
      if (format === 'project') { await saveAs(); return }
      if (format === 'equations') { await exportMathText(); setStatus('Equations exported'); return }
      const png = await canvasRef.current?.exportPng()
      if (!png) throw new Error('Canvas is not ready to export')
      if (format === 'png') { downloadBlob(png, 'MathCanvas.png'); setStatus('PNG exported'); return }
      const jpeg = await convertPngToJpeg(png)
      if (format === 'jpeg') { downloadBlob(jpeg, 'MathCanvas.jpg'); setStatus('JPEG exported'); return }
      downloadBlob(await createPdfFromJpeg(jpeg), 'MathCanvas.pdf')
      setStatus('PDF exported')
    } catch (error) {
      setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const selectedAction = (action: 'front' | 'back' | 'lock') => { const ids = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []); if (!ids.size) return; updateItems((current) => { const selected = current.filter((item) => ids.has(item.id)); if (!selected.length) return current; if (action === 'lock') return current.map((item) => ids.has(item.id) ? { ...item, locked: !item.locked } : item); const rest = current.filter((item) => !ids.has(item.id)); return action === 'front' ? [...rest, ...selected] : [...selected, ...rest] }) }
  const selectedItem = items.find((item) => item.id === selectedId)
  const graphStudioItem = graphStudioItemId ? items.find((item): item is Extract<CanvasItem, { kind: 'graph' }> => item.id === graphStudioItemId && item.kind === 'graph') : undefined
  const graphStudioDocument = graphStudioItem ? graphStudioItem.studio ?? legacyGraphToStudio(graphStudioItem.expression) : makeGraphStudioDocument()
  const physicsStudioItem = physicsStudioItemId && physicsStudioItemId !== '__new__' ? items.find((item): item is Extract<CanvasItem, { kind: 'physics' }> => item.id === physicsStudioItemId && item.kind === 'physics') : undefined
  const physicsStudioDocument = physicsStudioItem?.studio ?? makePhysicsDocument()
  const changeShapeOptions = (patch: Partial<ShapeOptions>) => {
    const next = { ...shapeOptions, ...patch }
    setShapeOptions(next)
    const ids = new Set(selectedIds.length ? selectedIds : selectedItem?.kind === 'shape' ? [selectedItem.id] : [])
    if (ids.size) setItems((current) => current.map((item) => ids.has(item.id) && item.kind === 'shape' ? { ...item, ...next, color: next.borderColor, fill: next.fillOn ? next.fillColor : 'transparent' } : item))
  }
  const changeTextOptions = (patch: Partial<TextOptions>) => {
    const next = { ...textOptions, ...patch }
    setTextOptions(next)
    const ids = new Set(selectedIds.length ? selectedIds : selectedItem?.kind === 'text' ? [selectedItem.id] : [])
    if (ids.size) setItems((current) => current.map((item) => ids.has(item.id) && item.kind === 'text' ? { ...item, ...next } : item))
  }
  const changeLineOptions = (patch: Partial<LineOptions>) => {
    const next = { ...lineOptions, ...patch }
    setLineOptions(next)
    const ids = new Set([...selectedIds, ...(selectedItem?.kind === 'line' ? [selectedItem.id] : [])])
    if (ids.size) setItems((current) => current.map((item) => ids.has(item.id) && item.kind === 'line' ? { ...item, ...next, color: next.color } : item))
  }
  const changeSelectedStrokeColor = (color: string) => {
    const ids = new Set([...selectedIds, ...(selectedItem?.kind === 'stroke' ? [selectedItem.id] : [])])
    if (ids.size) setItems((current) => current.map((item) => ids.has(item.id) && item.kind === 'stroke' ? { ...item, color } : item))
  }
  const changeTextSize = (size: number) => {
    setTextSize(size)
    const ids = new Set(selectedIds.length ? selectedIds : selectedItem?.kind === 'text' ? [selectedItem.id] : [])
    if (ids.size) setItems((current) => current.map((item) => ids.has(item.id) && item.kind === 'text' ? { ...item, fontSize: size, w: Math.max(40, (item.text.length + 1) * size * .62), h: Math.max(24, size * 1.5) } : item))
  }
  const shapeToolbar = tool === 'shape' || (tool === 'select' && selectedItem?.kind === 'shape')
  const lineToolbar = tool === 'line' || (tool === 'select' && selectedItem?.kind === 'line')
  const strokeToolbar = tool === 'select' && selectedItem?.kind === 'stroke'
  const activeInkColor = strokeToolbar && selectedItem?.kind === 'stroke' ? selectedItem.color : brushColor
  const changeInkColor = (color: string) => strokeToolbar ? changeSelectedStrokeColor(color) : setBrushColor(color)

  if (solverImage) return <ProblemSolverPage image={solverImage} preferences={solverPreferences} onPreferencesChange={updateSolverPreferences} onBack={() => setSolverImage(undefined)} onAddSteps={addSolverSteps} />
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">∑</span><span>MathCanvas</span></div><div className="doc-title">{filePath ? filePath.split(/[\\/]/).pop() : 'Untitled math problem'}</div><div className="top-actions"><button onClick={newDocument}>New</button><button onClick={open}>Open</button><button onClick={() => void openCollaborationPanel()}>{collaborationActive ? 'Collaborating' : 'Collaborate'}</button><button onClick={() => void openRecovery()}>Recovery</button><button className="primary" title="Save (Ctrl+S)" onClick={() => void save()}>Save</button><button title="Save As (Ctrl+Shift+S)" onClick={() => void saveAs()}>Save As</button><span className="save-status">{status}</span></div></header>
    <div className="workspace">
      <aside className="leftbar" aria-label="Canvas tools">
        <ToolButton label="Select (V; Shift/Ctrl-click to multi-select)" icon="⌁" active={tool === 'select'} onClick={() => setTool('select')} /><ToolButton label="Pan (H or Space)" icon="✋" active={tool === 'pan'} onClick={() => setTool('pan')} /><ToolButton label="Pen (P)" icon="✎" active={tool === 'draw'} onClick={() => setTool('draw')} /><ToolButton label="Eraser (E)" icon="⌫" active={tool === 'eraser'} onClick={() => setTool('eraser')} /><ToolButton label="Line (L)" icon="╱" active={tool === 'line'} onClick={() => setTool('line')} /><ToolButton label="Rectangle (G)" icon="□" active={tool === 'shape'} onClick={() => setTool('shape')} /><ToolButton label="Text (T)" icon="T" active={tool === 'text'} onClick={() => setTool('text')} />
        <ToolButton label="Table" icon="▦" onClick={() => setPanel('table')} />
        <ToolButton label="AI problem solver" icon="✦" onClick={() => void startProblemSolver()} />
        <ToolButton label="Graphing calculator" icon="ƒ" active={panel === 'function'} onClick={() => openGraphingStudio()} />
        <ToolButton label="Physics simulator" icon="ΣF" active={Boolean(physicsStudioItemId)} onClick={() => openPhysicsStudio()} />
        <div className="bar-spacer" /><ToolButton label="Settings" icon="⚙" onClick={() => setShowSolverSettings(true)} /><ToolButton label="Toggle grid" icon="#" active={gridVisible} onClick={() => setGridVisible((visible) => !visible)} /><ToolButton label="Fit canvas" icon="⌖" onClick={() => canvasRef.current?.zoomToFit()} />
      </aside>
      <main className="canvas-area">
        <NativeCanvas ref={canvasRef} items={items} selectedId={selectedId} tool={tool} gridSize={gridUnits * 32} gridVisible={gridVisible} viewport={viewport} brushSize={brushSize} brushColor={brushColor} textSize={textSize} shapeOptions={shapeOptions} textOptions={textOptions} lineOptions={lineOptions} selectedIds={selectedIds} remoteCursors={remoteCursors} onPointerWorldMove={(point) => collaborationRef.current?.updateCursor(point)} onPointerWorldLeave={() => collaborationRef.current?.updateCursor(null)} onMarqueePresenceChange={(bounds) => collaborationRef.current?.updateMarquee(bounds)} onItemsChange={commitItems} onSelectionChange={setSelectedId} onMultiSelectionChange={(ids) => { setSelectedIds(ids); setSelectedId(ids.at(-1)) }} onViewportChange={setViewport} onHoldDrawingChange={setHoldDrawing} onOpenGraph={openGraphingStudio} onOpenPhysics={openPhysicsStudio} onTogglePhysicsPlayback={(id) => updateItems((current) => current.map((item) => item.kind === 'physics' && item.id === id ? { ...item, playing: !item.playing } : item))} drawHotkey={drawHotkey} /><div className="canvas-hud"><span>{gridVisible ? `Grid ${gridUnits}` : 'Grid off'}</span><span>{holdDrawing ? `Holding ${drawHotkey.toUpperCase()} · DRAW` : `Hold ${drawHotkey.toUpperCase()} to draw`}</span><button title="Save (Ctrl+S)" onClick={() => void save()}>Save</button></div>
        {canvasCaptureActive && <CanvasRegionSelection onCancel={() => setCanvasCaptureActive(false)} onConfirm={confirmCanvasCapture} />}
        {!rightPanelVisible && <button type="button" className="rightbar-toggle rightbar-restore" aria-label="Show Math tools panel" aria-expanded={false} onClick={() => setRightPanelVisible(true)}>‹</button>}
      </main>
      {rightPanelVisible && <aside className="rightbar">
        <div className="rightbar-heading"><h3>Math tools</h3><button type="button" className="rightbar-toggle" aria-label="Hide Math tools panel" aria-expanded={true} onClick={() => setRightPanelVisible(false)}>›</button></div>
        <section>
          <h4>Measurement</h4>
          <div className="field-row">
            <label>Grid unit</label>
            <select value={gridUnits} onChange={(event) => setGridUnits(Number(event.target.value))}>
              <option value={0.25}>0.25</option><option value={0.5}>0.5</option><option value={1}>1</option><option value={2}>2</option><option value={5}>5</option><option value={10}>10</option>
            </select>
          </div>
          <div className="measure-tool-row">
            <button type="button" className={tool === 'ruler' ? 'panel-button active-preset' : 'panel-button'} onClick={() => setTool('ruler')}>Ruler</button>
            <button type="button" className={tool === 'protractor' ? 'panel-button active-preset' : 'panel-button'} onClick={() => setTool('protractor')}>Protractor</button>
          </div>
          <p className="hint">The grid snaps placement and drawing. Use the ruler or protractor for measured work.</p>
        </section>
        <section>
          <h4>Pen & text</h4>
          <div className="style-group">
            <h5>Pen</h5>
            <label className="range-label">Brush <span>{brushSize.toFixed(1)} px</span><input type="range" min="0.5" max="24" step="0.5" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
            <div className="brush-preset-row">{[0.5, 1, 2, 3, 5, 8].map((size) => <button key={size} className={brushSize === size ? 'active-preset' : ''} onClick={() => setBrushSize(size)}>{size}</button>)}</div>
            <ColorControl className="color-label" label="Ink color" color={activeInkColor} onChange={changeInkColor} />
            <div className="color-presets">{['#111827', '#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#f59e0b', '#ffffff'].map((color) => {
              return <button type="button" key={color} aria-label={`Ink ${color}`} title={color} style={{ background: colorWithOpacity(color, parseColor(activeInkColor).alpha * 100) }} className={colorHex(activeInkColor) === color ? 'selected-color' : ''} onClick={() => changeInkColor(colorWithHue(activeInkColor, color))} />
            })}</div>
            {strokeToolbar && <p className="hint">Ink color edits the selected pen stroke.</p>}
          </div>
          {lineToolbar && <div className="style-group">
            <h5>Line</h5>
            <ColorControl className="color-label" label="Line color" color={lineOptions.color} onChange={(color) => changeLineOptions({ color })} />
            <div className="style-field-row">
              <label>Width<select value={lineOptions.width} onChange={(event) => changeLineOptions({ width: Number(event.target.value) })}><option value="1">1 px</option><option value="1.5">1.5 px</option><option value="2.5">2.5 px</option><option value="4">4 px</option><option value="6">6 px</option><option value="8">8 px</option></select></label>
              <label>Style<select value={lineOptions.style} onChange={(event) => changeLineOptions({ style: event.target.value as LineOptions['style'] })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
            </div>
            <div className="style-toggle-row">
              <label><input type="checkbox" checked={lineOptions.startArrow} onChange={(event) => changeLineOptions({ startArrow: event.target.checked })} /> Start arrow</label>
              <label><input type="checkbox" checked={lineOptions.endArrow} onChange={(event) => changeLineOptions({ endArrow: event.target.checked })} /> End arrow</label>
            </div>
          </div>}
          {shapeToolbar && <div className="style-group">
            <h5>Shape</h5>
            <label className="style-select-label">Type<select value={shapeOptions.shapeType} onChange={(event) => changeShapeOptions({ shapeType: event.target.value as CanvasShapeType })}><option value="rectangle">Rectangle</option><option value="rounded-rectangle">Rounded rectangle</option><option value="ellipse">Ellipse / circle</option><option value="triangle">Triangle</option><option value="diamond">Diamond</option><option value="parallelogram">Parallelogram</option><option value="pentagon">Pentagon</option><option value="hexagon">Hexagon</option><option value="star">Star</option><option value="arrow">Arrow</option></select></label>
            <div className="style-toggle-row">
              <label><input type="checkbox" checked={shapeOptions.borderOn} onChange={(event) => changeShapeOptions({ borderOn: event.target.checked })} /> Border</label>
              <label><input type="checkbox" checked={shapeOptions.fillOn} onChange={(event) => changeShapeOptions({ fillOn: event.target.checked })} /> Fill</label>
            </div>
            <ColorControl className="color-label" label="Border color" color={shapeOptions.borderColor} disabled={!shapeOptions.borderOn} onChange={(borderColor) => changeShapeOptions({ borderColor })} />
            <label className="style-select-label">Border width<select value={shapeOptions.borderWidth} onChange={(event) => changeShapeOptions({ borderWidth: Number(event.target.value) })}><option value="1">1 px</option><option value="2">2 px</option><option value="3">3 px</option><option value="4">4 px</option><option value="6">6 px</option></select></label>
            <ColorControl className="color-label" label="Fill color" color={shapeOptions.fillColor} disabled={!shapeOptions.fillOn} onChange={(fillColor) => changeShapeOptions({ fillColor })} />
          </div>}
          <div className="style-group">
            <h5>Text</h5>
            <label className="range-label">Text size <span>{textSize} px</span><input type="range" min="8" max="72" step="1" value={textSize} onChange={(event) => changeTextSize(Number(event.target.value))} /></label>
            <ColorControl className="color-label" label="Text color" color={textOptions.textColor} onChange={(textColor) => changeTextOptions({ textColor })} />
            <label className="style-toggle-row"><span><input type="checkbox" checked={textOptions.fillEnabled} onChange={(event) => changeTextOptions({ fillEnabled: event.target.checked })} /> Background fill</span></label>
            <ColorControl className="color-label" label="Background color" color={textOptions.fillColor} disabled={!textOptions.fillEnabled} onChange={(fillColor) => changeTextOptions({ fillColor })} />
            {tool === 'text' && <p className="hint">Click the canvas to add text. Press Enter for a new line, Ctrl/Cmd+Enter to finish.</p>}
          </div>
          <p className="hint">D draws while held. Smaller than 1 px is supported for light work.</p>
        </section>
        <section>
          <h4>Quick tools</h4>
          <button className="panel-button" onClick={addEquation}>+ Equation</button>
          <button className="panel-button" onClick={() => openGraphingStudio()}>Graphing calculator</button>
          {selectedItem?.kind === 'graph' && <button className="panel-button" onClick={() => openGraphingStudio(selectedItem)}>Edit selected graph</button>}
          <button className="panel-button" onClick={() => openPhysicsStudio()}>2D Physics simulator</button>
          {selectedItem?.kind === 'physics' && <button className="panel-button" onClick={() => openPhysicsStudio(selectedItem)}>Edit selected physics scene</button>}
          <button className="panel-button" onClick={() => setPanel('calculator')}>+ Calculator</button>
          <button className="panel-button" onClick={() => setPanel('science')}>Equation bank</button>
        </section>
        <section>
          <h4>Canvas controls</h4>
          <div className="hotkey-row"><span className={`hotkey-key ${holdDrawing ? 'pressed' : ''}`}>D</span><span>Hold D to draw, release to return. Scroll pans. Ctrl + scroll zooms.</span></div>
          <button className="panel-button" onClick={undo}>Undo</button>
          <button className="panel-button" onClick={redo}>Redo</button>
        </section>
        <section>
          <h4>Layers</h4>
          <LayerPanel items={items} selectedId={selectedId} selectedIds={selectedIds} onSelect={(id) => { setSelectedId(id); setSelectedIds([id]) }} onFront={() => selectedAction('front')} onBack={() => selectedAction('back')} onLock={() => selectedAction('lock')} onDelete={deleteSelected} />
        </section>
        <section>
          <h4>PDF pages</h4>
          <PdfPageNavigator
            pdfLibrary={pdfLibrary}
            pages={items.filter((item): item is Extract<CanvasItem, { kind: 'page' }> => item.kind === 'page' && typeof item.pdfPageNumber === 'number')}
            selectedIds={selectedIds}
            onChoose={(page) => { setSelectedId(page.id); setSelectedIds([page.id]); canvasRef.current?.focusItem(page.id) }}
            onImportPage={(pdf, pageNumber) => void importPdfPages(pdf, [pageNumber])}
            onImportAll={(pdf) => void importPdfPages(pdf, Array.from({ length: pdf.pageCount }, (_, index) => index + 1).filter((pageNumber) => !pdf.addedPageNumbers.includes(pageNumber)))}
          />
        </section>
        <section><h4>Canvas</h4><p className="hint">Imported images and PDF pages can be moved by default. Lock a layer when you want to keep it fixed.</p></section>
        <section>
          <h4>Import</h4>
          <input ref={importRef} type="file" multiple accept="image/*,.pdf,application/pdf" hidden onChange={(event) => { importFiles(event.target.files); event.target.value = '' }} />
          <button className="panel-button" onClick={() => importRef.current?.click()}>Import images / PDFs</button>
        </section>
        <section>
          <h4>Export</h4>
          <ExportMenu onExport={(format) => void exportCanvas(format)} />
        </section>
      </aside>}
    </div>
    {panel === 'function' && <GraphingStudio initialDocument={graphStudioDocument} onAddToCanvas={applyGraphStudioDocument} onClose={() => { setPanel('none'); setGraphStudioItemId(undefined) }} />}{panel === 'table' && <TablePanel onClose={() => setPanel('none')} onCreate={addTable} />}{panel === 'measure' && <MeasurePanel onClose={() => setPanel('none')} onTool={setTool} />}{panel === 'calculator' && <CalculatorPanel onClose={() => setPanel('none')} onInsert={insertCalculatorEquation} />}{panel === 'science' && <SciencePanel onClose={() => setPanel('none')} onInsert={insertScienceFormula} />}
    {physicsStudioItemId !== undefined && <PhysicsStudio key={physicsStudioItemId} initialDocument={physicsStudioDocument} editing={Boolean(physicsStudioItem)} onAddToCanvas={applyPhysicsDocument} onClose={() => setPhysicsStudioItemId(undefined)} />}
    {showRecovery && <RecoveryPanel snapshots={recoverySnapshots} onClose={() => setShowRecovery(false)} onRefresh={() => void openRecovery()} onRestore={(id) => void restoreRecovery(id)} />}
    {showCollaboration && <CollaborationPanel
      available={collaborationAvailable}
      active={collaborationActive}
      name={collaborationName}
      roomCode={collaborationRoomCode}
      status={collaborationStatus}
      peers={collaborationPeers}
      requests={collaborationRequests}
      busy={collaborationBusy}
      onNameChange={setCollaborationName}
      onHost={() => void startCollaborationHost()}
      onRoomCodeChange={setCollaborationRoomCode}
      onCopyCode={() => void copyCollaborationCode()}
      onJoin={() => void joinCollaborationRoom()}
      onAnswer={(peerId, approved) => void answerCollaborationRequest(peerId, approved)}
      onLeave={() => void leaveCollaboration()}
      onClose={() => setShowCollaboration(false)}
    />}
    {solverCaptureError && <Modal title="Screen capture unavailable" onClose={() => setSolverCaptureError('')}><p className="hint">{solverCaptureError}</p><div className="modal-actions"><button onClick={() => setSolverCaptureError('')}>Close</button></div></Modal>}
    {showSolverSettings && <SolverSettings preferences={solverPreferences} onChange={updateSolverPreferences} onClose={() => setShowSolverSettings(false)} />}
  </div>
}

function PdfPageNavigator({ pdfLibrary, pages, selectedIds, onChoose, onImportPage, onImportAll }: { pdfLibrary: PdfLibraryDocument[]; pages: Extract<CanvasItem, { kind: 'page' }>[]; selectedIds: string[]; onChoose: (page: Extract<CanvasItem, { kind: 'page' }>) => void; onImportPage: (pdf: PdfLibraryDocument, pageNumber: number) => void; onImportAll: (pdf: PdfLibraryDocument) => void }) {
  const groups = new Map<string, Extract<CanvasItem, { kind: 'page' }>[]>()
  for (const page of pages) {
    const key = page.pdfDocumentId ?? page.pdfTitle ?? page.title
    groups.set(key, [...(groups.get(key) ?? []), page])
  }
  return <div className="pdf-navigator">
    {pdfLibrary.map((pdf) => {
      const remainingCount = pdf.pageCount - pdf.addedPageNumbers.length
      const busy = pdf.loading || pdf.importing || Boolean(pdf.error)
      return <div className="pdf-group pdf-library-group" key={pdf.id}>
        <div className="pdf-library-heading">
          <strong>{pdf.fileName}</strong>
          {!pdf.error && <span>{pdf.loading ? `Loading previews (${pdf.previews.length}/${pdf.pageCount || '…'})` : `${remainingCount} page${remainingCount === 1 ? '' : 's'} to add`}</span>}
        </div>
        {pdf.error
          ? <p className="hint">Could not load this PDF: {pdf.error}</p>
          : <div className="pdf-page-grid">{pdf.previews.map((page) => {
            const added = pdf.addedPageNumbers.includes(page.pageNumber)
            return <div className={`pdf-library-page ${added ? 'added' : ''}`} key={page.pageNumber}>
              <img src={page.src} alt={`Preview of page ${page.pageNumber}`} loading="lazy" />
              <span>Page {page.pageNumber}{added ? ' · Added' : ''}</span>
              <button type="button" disabled={busy || added} onClick={() => onImportPage(pdf, page.pageNumber)}>{added ? 'Added' : 'Add page'}</button>
            </div>
          })}</div>}
        {!pdf.error && <button className="panel-button pdf-import-all" disabled={busy || remainingCount === 0} onClick={() => onImportAll(pdf)}>{pdf.importing ? 'Importing pages…' : pdf.addedPageNumbers.length ? `Import remaining (${remainingCount})` : `Import all (${remainingCount})`}</button>}
      </div>
    })}
    {pages.length > 0 && <div className="pdf-group">
      <strong>On workspace</strong>
      <div className="pdf-page-grid">{[...groups.entries()].map(([key, entries]) => entries.sort((a, b) => (a.pdfPageNumber ?? 0) - (b.pdfPageNumber ?? 0)).map((page) => <button key={`${key}-${page.id}`} className={`pdf-page-thumb ${selectedIds.includes(page.id) ? 'selected' : ''}`} title={`Go to page ${page.pdfPageNumber ?? ''}`} onClick={() => onChoose(page)}><img src={page.src} alt="" loading="lazy" /><span>Page {page.pdfPageNumber ?? '?'}</span></button>))}</div>
    </div>}
    {!pdfLibrary.length && !pages.length && <p className="hint">Imported PDF files appear here. Add selected pages to the workspace, or add all pages at once.</p>}
  </div>
}

function CollaborationPanel({ available, active, name, roomCode, status, peers, requests, busy, onNameChange, onRoomCodeChange, onCopyCode, onHost, onJoin, onAnswer, onLeave, onClose }: {
  available: boolean
  active: boolean
  name: string
  roomCode: string
  status: string
  peers: CollaborationPeer[]
  requests: CollaborationPeer[]
  busy: boolean
  onNameChange: (name: string) => void
  onRoomCodeChange: (code: string) => void
  onCopyCode: () => void
  onHost: () => void
  onJoin: () => void
  onAnswer: (peerId: string, approved: boolean) => void
  onLeave: () => void
  onClose: () => void
}) {
  return <Modal title="Online collaboration" onClose={onClose}>
    <div className="collaboration-panel">
      <p className="hint">Firebase coordinates room invites and WebRTC connection setup. Canvas changes travel directly between peers and are not stored in Firebase. The host approves each join request. Direct connections may not work on every network because there is no TURN relay.</p>
      {!available && <p className="collaboration-warning">Firebase client configuration is missing. Check <code>src/firebase-client-config.ts</code> or your <code>.env.local</code> overrides.</p>}
      <label className="collaboration-name">Display name<input value={name} maxLength={60} placeholder="Your name" onChange={(event) => onNameChange(event.target.value)} disabled={active} /></label>
      <p className="collaboration-status" role="status">{status}</p>
      {active ? <>
        <div className="collaboration-room-code"><span>Invite code</span><code>{roomCode}</code><button disabled={!roomCode} onClick={onCopyCode}>Copy code</button></div>
        <h4>Connected peers</h4>
        {peers.length ? <ul className="collaboration-list">{peers.map((peer) => <li key={peer.peerId}>{peer.name}</li>)}</ul> : <p className="hint">No other peers are connected yet.</p>}
        {requests.length > 0 && <><h4>Access requests</h4><ul className="collaboration-list">{requests.map((request) => <li key={request.peerId}><span>{request.name}</span><span className="collaboration-request-actions"><button className="primary" onClick={() => onAnswer(request.peerId, true)}>Allow</button><button onClick={() => onAnswer(request.peerId, false)}>Deny</button></span></li>)}</ul></>}
        <div className="modal-actions"><button onClick={onClose}>Close</button><button className="danger-button" onClick={onLeave}>Leave room</button></div>
      </> : <>
        <div className="collaboration-actions"><button className="primary" disabled={!available || busy} onClick={onHost}>Host a room</button></div>
        <label className="collaboration-name">Join with invite code<input value={roomCode} maxLength={16} placeholder="16-character code" onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, ''))} /></label>
        <button className="panel-button" disabled={!available || busy || roomCode.length !== 16} onClick={onJoin}>Request to join</button>
        <div className="modal-actions"><button onClick={onClose}>Close</button></div>
      </>}
    </div>
  </Modal>
}

function RecoveryPanel({ snapshots, onClose, onRefresh, onRestore }: { snapshots: RecoverySnapshotMeta[]; onClose: () => void; onRefresh: () => void; onRestore: (id: string) => void }) {
  const formatDate = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
  return <Modal title="Recovery snapshots" onClose={onClose} wide>
    <p className="hint recovery-note">The latest document autosaves separately. Recovery snapshots are saved about every two minutes and the five newest versions are kept. Restoring a snapshot replaces the current canvas, so save your current work first if needed.</p>
    <div className="recovery-list">{snapshots.map((snapshot) => <div className="recovery-row" key={snapshot.id}>
      <div className="recovery-details"><strong>{formatDate(snapshot.createdAt)}</strong><span>{snapshot.label} · {formatSize(snapshot.sizeBytes)}</span></div>
      <button className="primary" onClick={() => onRestore(snapshot.id)}>Restore</button>
    </div>)}
    {!snapshots.length && <p className="hint">No recovery snapshots are available yet. The first snapshot is created during autosave; more are added while you continue working.</p>}</div>
    <div className="modal-actions"><button onClick={onRefresh}>Refresh</button><button onClick={onClose}>Close</button></div>
  </Modal>
}

function LayerPanel({ items, selectedId, selectedIds = [], onSelect, onFront, onBack, onLock, onDelete }: { items: CanvasItem[]; selectedId?: string; selectedIds?: string[]; onSelect: (id: string) => void; onFront: () => void; onBack: () => void; onLock: () => void; onDelete: () => void }) {
  const label = (item: CanvasItem) => { if (item.kind === 'equation') return `Equation · ${item.latex || 'blank'}`; if (item.kind === 'graph') return `Graph · ${item.expression || 'graph'}`; if (item.kind === 'table') return `Table · ${item.rows}×${item.cols}`; if (item.kind === 'page') return `Problem · ${item.title}`; if (item.kind === 'shape') return `Shape · ${item.shapeType ?? 'rectangle'}`; return ({ stroke: 'Pen stroke', line: 'Line', ruler: 'Ruler', text: 'Text', protractor: 'Protractor' } as Record<string, string>)[item.kind] ?? item.kind }
  return <><div className="layer-actions"><button onClick={onFront}>Front</button><button onClick={onBack}>Back</button><button onClick={onLock}>Lock</button><button onClick={onDelete}>Delete</button></div><div className="layer-list">{[...items].reverse().slice(0, 30).map((item) => <button key={item.id} className={`layer-row ${selectedIds.includes(item.id) || selectedId === item.id ? 'selected' : ''}`} onClick={() => onSelect(item.id)}><span className="layer-icon">{item.locked ? '🔒' : '◇'}</span><span className="layer-name">{label(item)}</span></button>)}{!items.length && <p className="hint">Nothing on this canvas yet.</p>}</div></>
}
function ToolButton({ label, icon, onClick, active }: { label: string; icon: string; onClick: () => void; active?: boolean }) { return <button className={`tool-button ${active ? 'active' : ''}`} onClick={onClick} title={label} aria-label={label}>{icon}</button> }
function ExportMenu({ onExport }: { onExport: (format: CanvasExportFormat) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const choose = (format: CanvasExportFormat) => { setOpen(false); onExport(format) }
  return <div className="export-menu-wrap" ref={menuRef}>
    <button className="panel-button export-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>{open ? 'Choose export format' : 'Export canvas'}</button>
    {open && <div className="export-menu" role="menu" aria-label="Export format">
      <button role="menuitem" onClick={() => choose('png')}>PNG image (.png)</button>
      <button role="menuitem" onClick={() => choose('jpeg')}>JPEG image (.jpg)</button>
      <button role="menuitem" onClick={() => choose('pdf')}>PDF document (.pdf)</button>
      <button role="menuitem" onClick={() => choose('project')}>MathCanvas project (.mathcanvas)</button>
      <button role="menuitem" onClick={() => choose('equations')}>Equations (.txt)</button>
    </div>}
  </div>
}
function encodeGraph(mode: GraphMode, rows: Array<{ expression: string; condition?: string }>) { return `@${mode}\n${rows.map((row) => mode === 'piecewise' ? `${row.condition ?? ''} => ${row.expression}` : row.expression).join('\n')}` }

function FunctionPanel({ onClose, onCreate, onInsert }: {
  onClose: () => void
  onCreate: (data: { expression: string; xMin: number; xMax: number; yMin: number; yMax: number; gridStep: number }) => void
  onInsert: (expression: string, result: string, angleMode: 'rad' | 'deg', evaluationX?: number) => void
}) {
  const [tab, setTab] = useState<'graph' | 'evaluate'>('graph')
  const [mode, setMode] = useState<GraphMode>('normal')
  const [rows, setRows] = useState<Array<{ expression: string; condition?: string }>>([{ expression: 'x^2' }])
  const [xMin, setXMin] = useState(-5), [xMax, setXMax] = useState(5), [yMin, setYMin] = useState(-5), [yMax, setYMax] = useState(10), [gridStep, setGridStep] = useState(1)
  const [graphError, setGraphError] = useState('')
  const [evaluationExpression, setEvaluationExpression] = useState('x^2')
  const [evaluationX, setEvaluationX] = useState(2)
  const update = (index: number, key: 'expression' | 'condition', value: string) => {
    setGraphError('')
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }
  const applyMode = (next: GraphMode) => {
    setGraphError('')
    setMode(next)
    setRows(next === 'parametric' ? [{ expression: 'cos(t), sin(t)' }] : next === 'polar' ? [{ expression: '1 + cos(theta)' }] : next === 'piecewise' ? [{ condition: 'x < 0', expression: '-x' }, { condition: 'x >= 0', expression: 'x' }] : [{ expression: 'x^2' }])
  }
  const addGraphToCanvas = () => {
    const activeRows = rows.filter((row) => row.expression.trim())
    if (!activeRows.length) {
      setGraphError('Enter at least one expression to graph.')
      return
    }
    if (![xMin, xMax, yMin, yMax, gridStep].every(Number.isFinite) || xMin >= xMax || yMin >= yMax || gridStep <= 0) {
      setGraphError('Set finite axis bounds with a minimum below the maximum, and use a positive grid step.')
      return
    }
    try {
      activeRows.forEach((row) => {
        if (mode === 'parametric') {
          const coordinates = row.expression.split(',')
          if (coordinates.length !== 2 || coordinates.some((coordinate) => !coordinate.trim())) throw new Error('Parametric rows need an x(t), y(t) pair.')
          coordinates.forEach((coordinate) => math.parse(coordinate))
        } else {
          math.parse(row.expression)
        }
        if (mode === 'piecewise') {
          if (!row.condition?.trim()) throw new Error('Add a condition for every piecewise expression.')
          math.parse(row.condition)
        }
      })
      onCreate({ expression: encodeGraph(mode, activeRows), xMin, xMax, yMin, yMax, gridStep })
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error))
    }
  }
  let evaluationResult = ''
  let evaluationError = ''
  if (!Number.isFinite(evaluationX)) {
    evaluationError = 'Enter a finite x value.'
  } else if (evaluationExpression.trim()) {
    try {
      const value = math.evaluate(evaluationExpression, { x: evaluationX })
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('The result is undefined or not finite.')
      evaluationResult = math.format(value, { precision: 12 })
    } catch (error) {
      evaluationError = error instanceof Error ? error.message : String(error)
    }
  }
  return <Modal wide draggable title="Graphing calculator" onClose={onClose}>
    <div className="graphing-tabs" role="tablist" aria-label="Graphing calculator modes">
      <button type="button" role="tab" aria-selected={tab === 'graph'} className={tab === 'graph' ? 'active' : ''} onClick={() => setTab('graph')}>Graph</button>
      <button type="button" role="tab" aria-selected={tab === 'evaluate'} className={tab === 'evaluate' ? 'active' : ''} onClick={() => setTab('evaluate')}>Evaluate</button>
    </div>
    {tab === 'graph' ? <div className="function-layout" role="tabpanel">
      <div className="function-controls">
        <label>Type<select value={mode} onChange={(event) => applyMode(event.target.value as GraphMode)}><option value="normal">y = f(x)</option><option value="piecewise">Piecewise</option><option value="parametric">Parametric</option><option value="polar">Polar</option></select></label>
        {rows.map((row, index) => <div className="function-row" key={index}>
          {mode === 'piecewise' && <input aria-label={`Condition ${index + 1}`} value={row.condition ?? ''} onChange={(event) => update(index, 'condition', event.target.value)} placeholder="condition" />}
          <input aria-label={`Expression ${index + 1}`} value={row.expression} onChange={(event) => update(index, 'expression', event.target.value)} placeholder={mode === 'parametric' ? 'x(t), y(t)' : mode === 'polar' ? 'r(θ)' : 'expression'} />
          {(mode === 'normal' || mode === 'piecewise') && <button className="icon-delete" onClick={() => { setGraphError(''); setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)) }} aria-label="Remove function">×</button>}
        </div>)}
        {(mode === 'normal' || mode === 'piecewise') && <button className="small-button" onClick={() => { setGraphError(''); setRows((current) => [...current, mode === 'piecewise' ? { condition: '', expression: '' } : { expression: '' }]) }}>+ Add function</button>}
        <div className="two-col"><label>X min<input type="number" value={xMin} onChange={(event) => { setGraphError(''); setXMin(Number(event.target.value)) }} /></label><label>X max<input type="number" value={xMax} onChange={(event) => { setGraphError(''); setXMax(Number(event.target.value)) }} /></label></div>
        <div className="two-col"><label>Y min<input type="number" value={yMin} onChange={(event) => { setGraphError(''); setYMin(Number(event.target.value)) }} /></label><label>Y max<input type="number" value={yMax} onChange={(event) => { setGraphError(''); setYMax(Number(event.target.value)) }} /></label></div>
        <label>Grid step<input type="number" min="0.01" step="0.25" value={gridStep} onChange={(event) => { setGraphError(''); setGridStep(Number(event.target.value)) }} /></label>
        <div className="math-expression-preview"><code>{encodeGraph(mode, rows).replaceAll('\n', ' · ')}</code></div>
        {graphError && <p className="graphing-error" role="alert">{graphError}</p>}
        <div className="modal-actions"><button onClick={onClose}>Close</button><button className="primary" onClick={addGraphToCanvas}>Add graph to canvas</button></div>
      </div>
      <FunctionPreview mode={mode} rows={rows} xMin={xMin} xMax={xMax} yMin={yMin} yMax={yMax} />
    </div> : <div className="graphing-evaluate" role="tabpanel">
      <p className="hint">Evaluate a function at a chosen x-value. The result updates as you type.</p>
      <label>Expression<input value={evaluationExpression} onChange={(event) => setEvaluationExpression(event.target.value)} placeholder="e.g. sin(x) + x^2" /></label>
      <label>x value<input type="number" value={evaluationX} onChange={(event) => setEvaluationX(Number(event.target.value))} /></label>
      <div className={`graphing-result${evaluationError ? ' has-error' : ''}`} aria-live="polite">
        <span>{evaluationError ? 'Expression error' : 'Result'}</span>
        <strong>{evaluationError || evaluationResult || 'Enter an expression'}</strong>
      </div>
      <div className="modal-actions"><button onClick={onClose}>Close</button><button className="primary" disabled={!evaluationExpression.trim() || Boolean(evaluationError) || !evaluationResult} onClick={() => onInsert(evaluationExpression, evaluationResult, 'rad', evaluationX)}>Add result to canvas</button></div>
    </div>}
  </Modal>
}

function FunctionPreview({ mode, rows, xMin, xMax, yMin, yMax }: { mode: GraphMode; rows: Array<{ expression: string; condition?: string }>; xMin: number; xMax: number; yMin: number; yMax: number }) {
  const w = 380, h = 300, pad = 38, xToPx = (x: number) => pad + ((x - xMin) / (xMax - xMin || 1)) * (w - pad * 1.3), yToPx = (y: number) => pad / 2 + ((yMax - y) / (yMax - yMin || 1)) * (h - pad * 1.2)
  const value = (expression: string, variables: Record<string, number>) => { try { const next = math.evaluate(expression, variables); return typeof next === 'number' && Number.isFinite(next) ? next : null } catch { return null } }
  const pair = (row: { expression: string; condition?: string }, x: number, t: number) => { if (mode === 'parametric') { const [px, py] = row.expression.split(','); const a = value(px ?? '', { x, t }), b = value(py ?? '', { x, t }); return a === null || b === null ? null : [a, b] } if (mode === 'polar') { const r = value(row.expression, { t, theta: t }); return r === null ? null : [r * Math.cos(t), r * Math.sin(t)] } if (mode === 'piecewise') { try { if (!Boolean(math.evaluate(row.condition ?? '', { x }))) return null } catch { return null } } const y = value(row.expression, { x, t }); return y === null ? null : [x, y] }
  const paths = rows.slice(0, 6).map((row) => { const points: string[] = []; for (let index = 0; index <= 300; index++) { const x = xMin + index / 300 * (xMax - xMin), t = mode === 'normal' || mode === 'piecewise' ? x : -Math.PI * 2 + index / 300 * Math.PI * 4, p = pair(row, x, t); if (p) points.push(`${xToPx(p[0]).toFixed(1)},${yToPx(p[1]).toFixed(1)}`) } return points.join(' ') })
  return <div className="function-preview"><div className="preview-title">Live preview</div><svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><defs><clipPath id="function-preview-plot"><rect x="38" y="16" width="330" height="269" /></clipPath></defs><rect width={w} height={h} fill="#fff" rx="10" />{Array.from({ length: 11 }).map((_, index) => <line key={`x${index}`} x1={xToPx(xMin + index / 10 * (xMax - xMin))} x2={xToPx(xMin + index / 10 * (xMax - xMin))} y1="16" y2="285" stroke="#edf0f4" />)}{Array.from({ length: 9 }).map((_, index) => <line key={`y${index}`} x1="38" x2="368" y1={16 + index / 8 * 269} y2={16 + index / 8 * 269} stroke="#edf0f4" />)}<line x1={xToPx(0)} x2={xToPx(0)} y1="16" y2="285" stroke="#64748b" /><line x1="38" x2="368" y1={yToPx(0)} y2={yToPx(0)} stroke="#64748b" /><g clipPath="url(#function-preview-plot)">{paths.map((points, index) => <polyline key={index} points={points} fill="none" stroke={['#2563eb', '#db2777', '#059669', '#7c3aed', '#ea580c'][index % 5]} strokeWidth="2.2" />)}</g></svg></div>
}

function TablePanel({ onClose, onCreate }: { onClose: () => void; onCreate: (rows: number, cols: number) => void }) { const [rows, setRows] = useState(5), [cols, setCols] = useState(4); return <Modal title="Insert table" onClose={onClose}><div className="two-col"><label>Rows<input type="number" min="1" max="50" value={rows} onChange={(event) => setRows(Math.max(1, Number(event.target.value)))} /></label><label>Columns<input type="number" min="1" max="30" value={cols} onChange={(event) => setCols(Math.max(1, Number(event.target.value)))} /></label></div><p className="hint">Cells stay editable on the canvas.</p><div className="modal-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onCreate(rows, cols)}>Insert table</button></div></Modal> }
function MeasurePanel({ onClose, onTool }: { onClose: () => void; onTool: (tool: CanvasTool) => void }) { const choose = (tool: CanvasTool) => { onTool(tool); onClose() }; return <Modal title="Measurement tools" onClose={onClose}><p className="hint">Place measurement tools directly on the canvas. They stay editable, selectable and export with the workspace.</p><div className="measure-card"><strong>Ruler</strong><span>Drag between two points to show a snapped distance.</span><button className="small-button" onClick={() => choose('ruler')}>Use ruler</button></div><div className="measure-card"><strong>Protractor</strong><span>Drag out a semicircle with 15° marks for angle work.</span><button className="small-button" onClick={() => choose('protractor')}>Use protractor</button></div></Modal> }

function removeCalculatorEntry(expression: string, start: number, end = start) {
  if (start !== end) return { expression: expression.slice(0, start) + expression.slice(end), caret: start }
  if (start === 0) return { expression, caret: 0 }
  const beforeCaret = expression.slice(0, start)
  const functionName = beforeCaret.match(/(?:atan2|asin|acos|atan|sin|cos|tan|cot|sec|csc|log10|log|exp|sqrt|cbrt|abs)\($/i)
  const constant = beforeCaret.match(/(?:Infinity|NaN|pi|tau|phi)$/i)
  const identifier = beforeCaret.match(/[A-Za-z_]\w*$/)
  const match = functionName ?? constant ?? identifier
  const removeLength = match?.[0].length ?? 1
  const caret = start - removeLength
  return { expression: expression.slice(0, caret) + expression.slice(start), caret }
}

function CalculatorPanel({ onClose, onInsert }: { onClose: () => void; onInsert: (expression: string, result: string, angleMode: 'rad' | 'deg') => void }) {
  const [expression, setExpression] = useState('')
  const [result, setResult] = useState('')
  const [angleMode, setAngleMode] = useState<'rad' | 'deg'>('rad')
  const [history, setHistory] = useState<Array<{ expression: string; result: string; angleMode: 'rad' | 'deg' }>>([])
  const expressionInput = useRef<HTMLInputElement>(null)
  const keys: Array<{ label: string; value: string }> = [
    { label: 'sin', value: 'sin(' }, { label: 'cos', value: 'cos(' }, { label: 'tan', value: 'tan(' }, { label: 'sin⁻¹', value: 'asin(' }, { label: 'cos⁻¹', value: 'acos(' },
    { label: 'tan⁻¹', value: 'atan(' }, { label: 'cot', value: 'cot(' }, { label: 'sec', value: 'sec(' }, { label: 'csc', value: 'csc(' }, { label: 'ln', value: 'log(' },
    { label: 'log₁₀', value: 'log10(' }, { label: 'eˣ', value: 'exp(' }, { label: '√', value: 'sqrt(' }, { label: '∛', value: 'cbrt(' }, { label: '|x|', value: 'abs(' },
    { label: '7', value: '7' }, { label: '8', value: '8' }, { label: '9', value: '9' }, { label: '÷', value: '/' }, { label: 'xʸ', value: '^' },
    { label: '4', value: '4' }, { label: '5', value: '5' }, { label: '6', value: '6' }, { label: '×', value: '*' }, { label: 'x²', value: '^2' },
    { label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' }, { label: '−', value: '-' }, { label: 'x³', value: '^3' },
    { label: '0', value: '0' }, { label: '.', value: '.' }, { label: '(', value: '(' }, { label: ')', value: ')' }, { label: 'π', value: 'pi' },
    { label: 'e', value: 'e' }, { label: '!', value: '!' }, { label: '1/x', value: '1/(' }, { label: '+', value: '+' }, { label: '⌫', value: 'BACKSPACE' },
  ]
  const calculate = () => {
    try {
      const toRadians = (value: number) => angleMode === 'deg' ? value * Math.PI / 180 : value
      const fromRadians = (value: number) => angleMode === 'deg' ? value * 180 / Math.PI : value
      const value = math.evaluate(expression, {
        sin: (value: number) => Math.sin(toRadians(value)),
        cos: (value: number) => Math.cos(toRadians(value)),
        tan: (value: number) => Math.tan(toRadians(value)),
        asin: (value: number) => fromRadians(Math.asin(value)),
        acos: (value: number) => fromRadians(Math.acos(value)),
        atan: (value: number) => fromRadians(Math.atan(value)),
        atan2: (y: number, x: number) => fromRadians(Math.atan2(y, x)),
        cot: (value: number) => 1 / Math.tan(toRadians(value)),
        sec: (value: number) => 1 / Math.cos(toRadians(value)),
        csc: (value: number) => 1 / Math.sin(toRadians(value)),
      })
      const text = typeof value === 'number' ? String(Number(value.toFixed(12))) : String(value)
      setResult(text)
      setHistory((current) => [{ expression, result: text, angleMode }, ...current].slice(0, 12))
      return text
    } catch {
      setResult('Check expression')
      return undefined
    }
  }
  const add = (value: string) => setExpression((current) => current + value)
  const backspace = (start = expressionInput.current?.selectionStart ?? expression.length, end = expressionInput.current?.selectionEnd ?? start) => {
    const next = removeCalculatorEntry(expression, start, end)
    setExpression(next.expression)
    setResult('')
    requestAnimationFrame(() => {
      expressionInput.current?.focus()
      expressionInput.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  const insertEquation = () => {
    const calculated = calculate()
    if (calculated !== undefined) onInsert(expression, calculated, angleMode)
  }
  return <Modal wide draggable title="Calculator" onClose={onClose}>
    <div className="calculator-layout">
      <div>
        <div className="calc-screen">
          <div className="calc-toolbar" role="group" aria-label="Angle unit">
            <span>Angle</span>
            {(['rad', 'deg'] as const).map((mode) => <button key={mode} type="button" className={`calc-angle-button ${angleMode === mode ? 'active' : ''}`} aria-pressed={angleMode === mode} onClick={() => { setAngleMode(mode); setResult('') }}>{mode.toUpperCase()}</button>)}
          </div>
          <input ref={expressionInput} aria-label="Calculator expression" value={expression} onChange={(event) => { setExpression(event.target.value); setResult('') }} onKeyDown={(event) => {
            if (event.key === 'Enter') calculate()
            else if (event.key === 'Backspace') {
              event.preventDefault()
              backspace(event.currentTarget.selectionStart ?? expression.length, event.currentTarget.selectionEnd ?? expression.length)
            }
          }} placeholder="sin(30) + pi" />
          <div className="calc-result" aria-live="polite">{result || ' '}</div>
        </div>
        <div className="calc-grid">
          {keys.map(({ label, value }) => <button key={label} type="button" className="calc-key" aria-label={label === 'BACKSPACE' ? 'Backspace' : label} onClick={() => { if (value === 'BACKSPACE') backspace(); else { add(value); setResult('') } }}>{label}</button>)}
          <button type="button" className="calc-key danger" onClick={() => { setExpression(''); setResult('') }}>C</button>
          <button type="button" className="calc-key equals" onClick={calculate}>=</button>
        </div>
      </div>
      <div className="calc-history"><h4>History</h4>{history.map((item, index) => <button key={index} onClick={() => { setExpression(item.expression); setResult(item.result); setAngleMode(item.angleMode) }}>{item.expression} = {item.result} · {item.angleMode.toUpperCase()}</button>)}{!history.length && <p className="hint">Your calculations appear here.</p>}</div>
    </div>
    <div className="modal-actions"><button onClick={insertEquation}>Insert equation</button><button className="primary" onClick={calculate}>Calculate</button></div>
  </Modal>
}

type ScienceSubject = 'Mathematics' | 'Physics' | 'Chemistry'
type ScienceFormula = { subject: ScienceSubject; topic: string; name: string; expression: string; latex: string }

const SCIENCE_FORMULAS: ScienceFormula[] = [
  { subject: 'Mathematics', topic: 'Algebra', name: 'Quadratic formula', expression: 'x = (-b ± √(b² - 4ac)) / 2a', latex: 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}' },
  { subject: 'Mathematics', topic: 'Algebra', name: 'Difference of squares', expression: 'a² - b² = (a - b)(a + b)', latex: 'a^2-b^2=(a-b)(a+b)' },
  { subject: 'Mathematics', topic: 'Algebra', name: 'Arithmetic sequence', expression: 'aₙ = a₁ + (n - 1)d', latex: 'a_n=a_1+(n-1)d' },
  { subject: 'Mathematics', topic: 'Algebra', name: 'Geometric sequence', expression: 'aₙ = a₁rⁿ⁻¹', latex: 'a_n=a_1r^{n-1}' },
  { subject: 'Mathematics', topic: 'Geometry & trigonometry', name: 'Pythagorean theorem', expression: 'a² + b² = c²', latex: 'a^2+b^2=c^2' },
  { subject: 'Mathematics', topic: 'Geometry & trigonometry', name: 'Circle area', expression: 'A = πr²', latex: 'A=\\pi r^2' },
  { subject: 'Mathematics', topic: 'Geometry & trigonometry', name: 'Circle circumference', expression: 'C = 2πr', latex: 'C=2\\pi r' },
  { subject: 'Mathematics', topic: 'Geometry & trigonometry', name: 'Sine rule', expression: 'a / sin(A) = b / sin(B) = c / sin(C)', latex: '\\frac{a}{\\sin A}=\\frac{b}{\\sin B}=\\frac{c}{\\sin C}' },
  { subject: 'Mathematics', topic: 'Calculus', name: 'Power rule', expression: 'd/dx (xⁿ) = nxⁿ⁻¹', latex: '\\frac{d}{dx}x^n=nx^{n-1}' },
  { subject: 'Mathematics', topic: 'Calculus', name: 'Product rule', expression: '(fg)′ = f′g + fg′', latex: '(fg)\\prime=f\\prime g+fg\\prime' },
  { subject: 'Mathematics', topic: 'Calculus', name: 'Fundamental theorem of calculus', expression: '∫ₐᵇ f(x) dx = F(b) - F(a)', latex: '\\int_a^b f(x)\\,dx=F(b)-F(a)' },
  { subject: 'Mathematics', topic: 'Statistics', name: 'Mean', expression: 'x̄ = (Σxᵢ) / n', latex: '\\bar{x}=\\frac{\\sum_{i=1}^n x_i}{n}' },
  { subject: 'Mathematics', topic: 'Statistics', name: 'Sample standard deviation', expression: 's = √(Σ(xᵢ - x̄)² / (n - 1))', latex: 's=\\sqrt{\\frac{\\sum_{i=1}^n(x_i-\\bar{x})^2}{n-1}}' },
  { subject: 'Physics', topic: 'Mechanics', name: 'Newton’s second law', expression: 'F = ma', latex: 'F=ma' },
  { subject: 'Physics', topic: 'Mechanics', name: 'Momentum', expression: 'p = mv', latex: 'p=mv' },
  { subject: 'Physics', topic: 'Mechanics', name: 'Centripetal acceleration', expression: 'a = v² / r', latex: 'a=\\frac{v^2}{r}' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Average speed', expression: 'speed = distance / time', latex: '\\text{speed}=\\frac{\\text{distance}}{\\text{time}}' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Average velocity', expression: 'v̄ = Δx / Δt', latex: '\\bar{v}=\\frac{\\Delta x}{\\Delta t}' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Acceleration', expression: 'a = Δv / Δt = (v - u) / t', latex: 'a=\\frac{\\Delta v}{\\Delta t}=\\frac{v-u}{t}' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Position at constant velocity', expression: 'x = x₀ + vt', latex: 'x=x_0+vt' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Final velocity', expression: 'v = u + at', latex: 'v=u+at' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Displacement from initial velocity', expression: 's = ut + ½at²', latex: 's=ut+\\frac{1}{2}at^2' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Displacement from final velocity', expression: 's = vt - ½at²', latex: 's=vt-\\frac{1}{2}at^2' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Displacement from average velocity', expression: 's = ½(u + v)t', latex: 's=\\frac{1}{2}(u+v)t' },
  { subject: 'Physics', topic: 'Kinematics', name: 'Velocity without time', expression: 'v² = u² + 2as', latex: 'v^2=u^2+2as' },
  { subject: 'Physics', topic: 'Projectile motion', name: 'Horizontal position', expression: 'x = (u cos θ)t', latex: 'x=(u\\cos\\theta)t' },
  { subject: 'Physics', topic: 'Projectile motion', name: 'Vertical position', expression: 'y = (u sin θ)t - ½gt²', latex: 'y=(u\\sin\\theta)t-\\frac{1}{2}gt^2' },
  { subject: 'Physics', topic: 'Projectile motion', name: 'Time of flight (same launch and landing height)', expression: 'T = 2u sin θ / g', latex: 'T=\\frac{2u\\sin\\theta}{g}' },
  { subject: 'Physics', topic: 'Projectile motion', name: 'Horizontal range (same launch and landing height)', expression: 'R = u² sin(2θ) / g', latex: 'R=\\frac{u^2\\sin(2\\theta)}{g}' },
  { subject: 'Physics', topic: 'Projectile motion', name: 'Maximum height', expression: 'H = u² sin² θ / (2g)', latex: 'H=\\frac{u^2\\sin^2\\theta}{2g}' },
  { subject: 'Physics', topic: 'Energy & waves', name: 'Kinetic energy', expression: 'Eₖ = ½mv²', latex: 'E_k=\\frac{1}{2}mv^2' },
  { subject: 'Physics', topic: 'Energy & waves', name: 'Gravitational potential energy', expression: 'Eₚ = mgh', latex: 'E_p=mgh' },
  { subject: 'Physics', topic: 'Energy & waves', name: 'Wave speed', expression: 'v = fλ', latex: 'v=f\\lambda' },
  { subject: 'Physics', topic: 'Energy & waves', name: 'Hooke’s law', expression: 'F = -kx', latex: 'F=-kx' },
  { subject: 'Physics', topic: 'Electricity & magnetism', name: 'Ohm’s law', expression: 'V = IR', latex: 'V=IR' },
  { subject: 'Physics', topic: 'Electricity & magnetism', name: 'Electric power', expression: 'P = IV', latex: 'P=IV' },
  { subject: 'Physics', topic: 'Electricity & magnetism', name: 'Coulomb’s law', expression: 'F = kq₁q₂ / r²', latex: 'F=k\\frac{q_1q_2}{r^2}' },
  { subject: 'Physics', topic: 'Thermodynamics', name: 'Heat transfer', expression: 'Q = mcΔT', latex: 'Q=mc\\Delta T' },
  { subject: 'Physics', topic: 'Thermodynamics', name: 'Ideal gas law', expression: 'PV = nRT', latex: 'PV=nRT' },
  { subject: 'Chemistry', topic: 'Stoichiometry', name: 'Amount of substance', expression: 'n = m / M', latex: 'n=\\frac{m}{M}' },
  { subject: 'Chemistry', topic: 'Stoichiometry', name: 'Concentration', expression: 'c = n / V', latex: 'c=\\frac{n}{V}' },
  { subject: 'Chemistry', topic: 'Stoichiometry', name: 'Dilution', expression: 'C₁V₁ = C₂V₂', latex: 'C_1V_1=C_2V_2' },
  { subject: 'Chemistry', topic: 'Gases & solutions', name: 'Ideal gas law', expression: 'PV = nRT', latex: 'PV=nRT' },
  { subject: 'Chemistry', topic: 'Gases & solutions', name: 'Combined gas law', expression: 'P₁V₁ / T₁ = P₂V₂ / T₂', latex: '\\frac{P_1V_1}{T_1}=\\frac{P_2V_2}{T_2}' },
  { subject: 'Chemistry', topic: 'Gases & solutions', name: 'pH', expression: 'pH = -log₁₀[H⁺]', latex: 'pH=-\\log_{10}[H^+]' },
  { subject: 'Chemistry', topic: 'Thermodynamics & equilibrium', name: 'Gibbs free energy', expression: 'ΔG = ΔH - TΔS', latex: '\\Delta G=\\Delta H-T\\Delta S' },
  { subject: 'Chemistry', topic: 'Thermodynamics & equilibrium', name: 'Equilibrium constant', expression: 'Kₐ = [products] / [reactants]', latex: 'K=\\frac{[\\mathrm{products}]}{[\\mathrm{reactants}]}' },
  { subject: 'Chemistry', topic: 'Thermodynamics & equilibrium', name: 'Arrhenius equation', expression: 'k = Ae⁻ᴱᵃ⁄ᴿᵀ', latex: 'k=Ae^{-E_a/(RT)}' },
]

function SciencePanel({ onClose, onInsert }: { onClose: () => void; onInsert: (latex: string) => void }) {
  const subjects = [...new Set(SCIENCE_FORMULAS.map(({ subject }) => subject))]
  const [subject, setSubject] = useState<ScienceSubject>('Physics')
  const topics = [...new Set(SCIENCE_FORMULAS.filter((formula) => formula.subject === subject).map(({ topic }) => topic))]
  const [topic, setTopic] = useState('Mechanics')
  const formulas = SCIENCE_FORMULAS.filter((formula) => formula.subject === subject && formula.topic === topic)

  return <Modal wide draggable title="Formula library" onClose={onClose}>
    <div className="formula-filters">
      <label>Subject<select value={subject} onChange={(event) => {
        const nextSubject = event.target.value as ScienceSubject
        setSubject(nextSubject)
        setTopic(SCIENCE_FORMULAS.find((formula) => formula.subject === nextSubject)?.topic ?? '')
      }}>{subjects.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Topic<select value={topic} onChange={(event) => setTopic(event.target.value)}>{topics.map((option) => <option key={option}>{option}</option>)}</select></label>
    </div>
    <div className="formula-catalog">
      {formulas.map((formula) => <article className="formula-card" key={formula.name}>
        <div><strong>{formula.name}</strong><span>{formula.expression}</span></div>
        <button className="small-button" onClick={() => onInsert(formula.latex)}>Insert</button>
      </article>)}
    </div>
    <p className="hint">Choose a subject and topic, then insert a formula as an editable canvas equation.</p>
  </Modal>
}
function Modal({ title, onClose, children, wide, draggable = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; draggable?: boolean }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; baseOffset: { x: number; y: number } } | null>(null)
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height, baseOffset: offset }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    const minX = 8 - current.left
    const maxX = window.innerWidth - 8 - current.left - current.width
    const minY = 8 - current.top
    const maxY = window.innerHeight - 8 - current.top - current.height
    setOffset({
      x: current.baseOffset.x + Math.max(minX, Math.min(maxX, dx)),
      y: current.baseOffset.y + Math.max(minY, Math.min(maxY, dy)),
    })
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><div className={`modal ${wide ? 'wide' : ''} ${draggable ? 'modal-draggable' : ''}`} style={draggable ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}><div className="modal-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><h3>{title}</h3><button onClick={onClose} aria-label="Close">×</button></div>{children}</div></div>
}
async function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) }) }
async function getImageDimensions(src: string) { return new Promise<{ w: number; h: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight }); image.onerror = reject; image.src = src }) }
