import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  getBodyForces, getNetForce, getSimulatedBodies, makePhysicsDocument, makePhysicsId,
  PHYSICS_LOOP_SECONDS, PHYSICS_SCENE_HEIGHT, PHYSICS_SCENE_WIDTH,
  stepPhysics, type PhysicsBody, type PhysicsDocument, type PhysicsForce, type PhysicsStructure,
} from './physics'

type PhysicsStudioProps = {
  initialDocument: PhysicsDocument
  editing: boolean
  onAddToCanvas: (document: PhysicsDocument, playback: 'snapshot' | 'loop') => void
  onClose: () => void
}

type PlacementTool = 'select' | 'body' | 'wall' | 'surface' | 'string' | 'force'
type Selection = { kind: 'body' | 'structure' | 'force'; id: string } | null
type LineDrawing = { tool: 'wall' | 'surface' | 'string'; x1: number; y1: number; x2: number; y2: number }

const cloneDocument = (document: PhysicsDocument): PhysicsDocument => JSON.parse(JSON.stringify(document)) as PhysicsDocument
const format = (value: number) => Number.isFinite(value) ? Number(value.toFixed(2)).toString() : '0'
const bodyColors = ['#eff6ff', '#fef3c7', '#dcfce7', '#fae8ff', '#ffe4e6']
const forceColors = ['#2563eb', '#dc2626', '#7c3aed', '#ea580c', '#0891b2']

function drawArrow(context: CanvasRenderingContext2D, x: number, y: number, vectorX: number, vectorY: number, color: string, label: string, scale: number, dashed = false) {
  const length = Math.hypot(vectorX, vectorY)
  if (!length) return
  const unitX = vectorX / length
  const unitY = vectorY / length
  const endX = x + unitX * length
  const endY = y + unitY * length
  context.save()
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = 2.5 / scale
  context.setLineDash(dashed ? [5 / scale, 4 / scale] : [])
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(endX, endY)
  context.stroke()
  context.setLineDash([])
  context.beginPath()
  context.moveTo(endX, endY)
  context.lineTo(endX - unitX * 9 / scale - unitY * 5 / scale, endY - unitY * 9 / scale + unitX * 5 / scale)
  context.lineTo(endX - unitX * 9 / scale + unitY * 5 / scale, endY - unitY * 9 / scale - unitX * 5 / scale)
  context.closePath()
  context.fill()
  context.font = `600 ${11 / scale}px Segoe UI, Arial, sans-serif`
  context.textAlign = unitX > 0.35 ? 'left' : unitX < -0.35 ? 'right' : 'center'
  context.textBaseline = 'middle'
  context.fillText(label, endX + unitX * 8 / scale, endY + unitY * 8 / scale, 145 / scale)
  context.restore()
}

function SceneCanvas({ document, bodies, tool, selection, onSelect, onAdd, onMove }: {
  document: PhysicsDocument
  bodies: PhysicsBody[]
  tool: PlacementTool
  selection: Selection
  onSelect: (selection: Selection) => void
  onAdd: (tool: Exclude<PlacementTool, 'select'>, x1: number, y1: number, x2?: number, y2?: number) => void
  onMove: (selection: Exclude<Selection, null>, dx: number, dy: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pointerRef = useRef<{ id: number; x: number; y: number; selection: Selection; drawing?: LineDrawing } | null>(null)
  const [drawing, setDrawing] = useState<LineDrawing | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const resultForces = useMemo(() => new Map(document.bodies.map((body) => [body.id, { vectors: getBodyForces(document, body), net: getNetForce(document, body) }])), [document])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => setSize({ width: canvas.clientWidth, height: canvas.clientHeight }))
    observer.observe(canvas)
    setSize({ width: canvas.clientWidth, height: canvas.clientHeight })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !size.width || !size.height) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#f8fafc'
    context.fillRect(0, 0, size.width, size.height)
    const scale = Math.min(size.width / PHYSICS_SCENE_WIDTH, size.height / PHYSICS_SCENE_HEIGHT)
    const offsetX = (size.width - PHYSICS_SCENE_WIDTH * scale) / 2
    const offsetY = (size.height - PHYSICS_SCENE_HEIGHT * scale) / 2
    context.save()
    context.translate(offsetX, offsetY)
    context.scale(scale, scale)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, PHYSICS_SCENE_WIDTH, PHYSICS_SCENE_HEIGHT)
    context.strokeStyle = '#edf1f5'
    context.lineWidth = 1
    context.beginPath()
    for (let x = 0; x <= PHYSICS_SCENE_WIDTH; x += 40) { context.moveTo(x, 0); context.lineTo(x, PHYSICS_SCENE_HEIGHT) }
    for (let y = 0; y <= PHYSICS_SCENE_HEIGHT; y += 40) { context.moveTo(0, y); context.lineTo(PHYSICS_SCENE_WIDTH, y) }
    context.stroke()

    for (const structure of document.structures) {
      context.save()
      context.lineCap = 'round'
      if (structure.type === 'string') {
        context.strokeStyle = '#64748b'
        context.lineWidth = 2
        context.setLineDash([7, 5])
      } else {
        context.strokeStyle = structure.type === 'wall' ? '#475569' : '#64748b'
        context.lineWidth = structure.type === 'wall' ? 8 : 6
      }
      context.beginPath()
      context.moveTo(structure.x1, structure.y1)
      context.lineTo(structure.x2, structure.y2)
      context.stroke()
      if (structure.type === 'surface') {
        const dx = structure.x2 - structure.x1, dy = structure.y2 - structure.y1
        const length = Math.max(1, Math.hypot(dx, dy))
        context.strokeStyle = '#cbd5e1'
        context.lineWidth = 1.5
        context.setLineDash([])
        context.beginPath()
        context.moveTo(structure.x1 - dy / length * 8, structure.y1 + dx / length * 8)
        context.lineTo(structure.x2 - dy / length * 8, structure.y2 + dx / length * 8)
        context.stroke()
      }
      if (selection?.kind === 'structure' && selection.id === structure.id) {
        context.strokeStyle = '#2563eb'
        context.lineWidth = 2
        context.setLineDash([5, 4])
        context.beginPath()
        context.moveTo(structure.x1, structure.y1)
        context.lineTo(structure.x2, structure.y2)
        context.stroke()
      }
      context.restore()
    }
    if (drawing) {
      context.save()
      context.strokeStyle = drawing.tool === 'surface' ? '#2563eb' : drawing.tool === 'wall' ? '#475569' : '#0f766e'
      context.lineWidth = drawing.tool === 'wall' ? 8 : drawing.tool === 'surface' ? 6 : 2
      context.setLineDash(drawing.tool === 'string' ? [7, 5] : [5, 4])
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(drawing.x1, drawing.y1)
      context.lineTo(drawing.x2, drawing.y2)
      context.stroke()
      context.restore()
    }

    const largestForce = Math.max(1, ...document.bodies.flatMap((body) => resultForces.get(body.id)?.vectors.map((force) => force.magnitude) ?? []))
    const arrowScale = 55 / largestForce
    for (const body of bodies) {
      const selected = selection?.kind === 'body' && selection.id === body.id
      context.save()
      context.fillStyle = body.color
      context.strokeStyle = selected ? '#2563eb' : '#64748b'
      context.lineWidth = selected ? 3 : 1.8
      context.beginPath()
      context.roundRect(body.x - body.radius, body.y - body.radius, body.radius * 2, body.radius * 2, 6)
      context.fill()
      context.stroke()
      context.fillStyle = '#334155'
      context.font = '600 12px Segoe UI, Arial, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(`${body.label} · ${format(body.mass)} kg`, body.x, body.y)
      context.restore()
      const forces = resultForces.get(body.id)
      for (const force of forces?.vectors ?? []) {
        if (force.magnitude <= 0) continue
        drawArrow(context, body.x, body.y, force.x * arrowScale, force.y * arrowScale, force.color, `${force.label} ${format(force.magnitude)} N · ${format(force.angle)}°`, scale)
      }
      if (document.mode === 'static' && forces && Math.hypot(forces.net.x, forces.net.y) > 0.05) {
        if (document.autoBalanceForces !== false) drawArrow(context, body.x, body.y, -forces.net.x * arrowScale, -forces.net.y * arrowScale, '#16a34a', `Balance ${format(Math.hypot(forces.net.x, forces.net.y))} N`, scale, true)
      }
      if (document.autoBalanceForces === false) {
        const speed = Math.hypot(body.vx, body.vy)
        if (speed > 0.01) drawArrow(context, body.x, body.y, body.vx / speed * Math.min(110, speed * 10), -body.vy / speed * Math.min(110, speed * 10), '#7c3aed', `Velocity ${format(speed)} m/s · ${format(Math.atan2(body.vy, body.vx) * 180 / Math.PI)}°`, scale)
      }
    }

    for (const force of document.forces) {
      if (selection?.kind !== 'force' || selection.id !== force.id) continue
      const body = bodies.find((candidate) => candidate.id === force.bodyId)
      if (body) {
        context.strokeStyle = '#0f172a'
        context.lineWidth = 1
        context.setLineDash([3, 3])
        context.beginPath()
        context.arc(body.x, body.y, body.radius + 8, 0, Math.PI * 2)
        context.stroke()
        context.setLineDash([])
      }
    }
    context.restore()
  }, [document, bodies, size, selection, resultForces, drawing])

  const toWorld = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / PHYSICS_SCENE_WIDTH, rect.height / PHYSICS_SCENE_HEIGHT)
    return { x: (event.clientX - rect.left - (rect.width - PHYSICS_SCENE_WIDTH * scale) / 2) / scale, y: (event.clientY - rect.top - (rect.height - PHYSICS_SCENE_HEIGHT * scale) / 2) / scale }
  }
  const hitTest = (x: number, y: number): Selection => {
    for (const body of [...document.bodies].reverse()) if (Math.hypot(body.x - x, body.y - y) <= body.radius + 8) return { kind: 'body', id: body.id }
    for (const force of [...document.forces].reverse()) {
      const body = document.bodies.find((candidate) => candidate.id === force.bodyId)
      if (!body) continue
      const radians = force.angle * Math.PI / 180
      const length = Math.min(90, force.magnitude * 1.5)
      const endX = body.x + Math.cos(radians) * length
      const endY = body.y - Math.sin(radians) * length
      const segmentX = endX - body.x, segmentY = endY - body.y
      const t = Math.max(0, Math.min(1, ((x - body.x) * segmentX + (y - body.y) * segmentY) / (segmentX * segmentX + segmentY * segmentY || 1)))
      if (Math.hypot(x - body.x - t * segmentX, y - body.y - t * segmentY) < 10) return { kind: 'force', id: force.id }
    }
    for (const structure of [...document.structures].reverse()) {
      const dx = structure.x2 - structure.x1, dy = structure.y2 - structure.y1
      const t = Math.max(0, Math.min(1, ((x - structure.x1) * dx + (y - structure.y1) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(x - structure.x1 - t * dx, y - structure.y1 - t * dy) < 12) return { kind: 'structure', id: structure.id }
    }
    return null
  }
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = toWorld(event)
    if (tool === 'wall' || tool === 'surface' || tool === 'string') {
      const anchor = tool === 'string'
        ? document.bodies.find((body) => body.id === selection?.id) ?? document.bodies[0]
        : undefined
      const x1 = anchor?.x ?? point.x
      const y1 = anchor?.y ?? point.y
      const nextDrawing = { tool, x1, y1, x2: point.x, y2: point.y }
      pointerRef.current = { id: event.pointerId, x: point.x, y: point.y, selection: null, drawing: nextDrawing }
      setDrawing(nextDrawing)
      return
    }
    if (tool !== 'select') {
      onAdd(tool, point.x, point.y)
      return
    }
    const hit = hitTest(point.x, point.y)
    onSelect(hit)
    pointerRef.current = { id: event.pointerId, ...point, selection: hit }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    const point = toWorld(event)
    if (pointer.drawing) {
      const nextDrawing = { ...pointer.drawing, x2: point.x, y2: point.y }
      pointerRef.current = { ...pointer, ...point, drawing: nextDrawing }
      setDrawing(nextDrawing)
      return
    }
    if (!pointer.selection) return
    onMove(pointer.selection, point.x - pointer.x, point.y - pointer.y)
    pointerRef.current = { ...pointer, ...point }
  }
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current
    if (pointer?.id !== event.pointerId) return
    if (pointer.drawing) {
      const end = toWorld(event)
      onAdd(pointer.drawing.tool, pointer.drawing.x1, pointer.drawing.y1, end.x, end.y)
      setDrawing(null)
    }
    pointerRef.current = null
  }
  const onPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerRef.current?.id !== event.pointerId) return
    pointerRef.current = null
    setDrawing(null)
  }

  return <canvas ref={canvasRef} className={`physics-scene-canvas tool-${tool}`} aria-label="Physics simulation scene" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} />
}

export function PhysicsStudio({ initialDocument, editing, onAddToCanvas, onClose }: PhysicsStudioProps) {
  const [document, setDocument] = useState(() => cloneDocument(initialDocument))
  const [selection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<PlacementTool>('select')
  const [saved, setSaved] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [simulatedBodies, setSimulatedBodies] = useState(() => cloneDocument(initialDocument).bodies)
  const elapsedRef = useRef(0)
  const frameTimeRef = useRef<number | undefined>(undefined)

  const update = (change: (current: PhysicsDocument) => PhysicsDocument) => {
    setSaved(false)
    setDocument((current) => change(current))
    setSimulatedBodies(cloneDocument(document).bodies)
    setElapsed(0)
    elapsedRef.current = 0
    setPlaying(false)
  }
  useEffect(() => { setSimulatedBodies(document.bodies) }, [document.bodies])
  useEffect(() => {
    if (!playing || document.mode !== 'simulation') return
    let frame = 0
    const animate = (now: number) => {
      const previous = frameTimeRef.current ?? now
      const dt = Math.min(0.04, Math.max(0, (now - previous) / 1000))
      frameTimeRef.current = now
      elapsedRef.current += dt
      setElapsed(elapsedRef.current)
      setSimulatedBodies((current) => stepPhysics(document, current, dt))
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => { cancelAnimationFrame(frame); frameTimeRef.current = undefined }
  }, [document, playing])

  const editBody = (id: string, changes: Partial<PhysicsBody>) => update((current) => ({
    ...current,
    bodies: current.bodies.map((body) => body.id === id ? { ...body, ...changes } : body),
    structures: current.structures.map((structure) => structure.bodyId === id ? { ...structure, x1: changes.x ?? bodyPosition(current, id).x, y1: changes.y ?? bodyPosition(current, id).y } : structure),
  }))
  const bodyPosition = (current: PhysicsDocument, id: string) => current.bodies.find((body) => body.id === id) ?? { x: 0, y: 0 }
  const addObject = (x = 500 + Math.random() * 80 - 40, y = 180 + Math.random() * 80) => {
    const body: PhysicsBody = { id: makePhysicsId(), label: `Object ${document.bodies.length + 1}`, x, y, radius: 24, mass: 2, friction: 0.3, color: bodyColors[document.bodies.length % bodyColors.length]!, vx: 0, vy: 0 }
    update((current) => ({ ...current, bodies: [...current.bodies, { ...body, label: `Object ${current.bodies.length + 1}` }] }))
    setSelection({ kind: 'body', id: body.id })
  }
  const addStructure = (type: PhysicsStructure['type'], x1: number, y1: number, x2 = x1 + 100, y2 = y1) => {
    const id = makePhysicsId()
    if (Math.hypot(x2 - x1, y2 - y1) < 24) {
      x2 = x1 + 100
      y2 = y1
    }
    update((current) => {
      const selectedBody = selection?.kind === 'body' ? current.bodies.find((body) => body.id === selection.id) : undefined
      const attachedBody = type === 'string' ? selectedBody ?? current.bodies[0] : undefined
      const structure: PhysicsStructure = {
        id, type,
        label: `${type[0]!.toUpperCase()}${type.slice(1)} ${current.structures.filter((item) => item.type === type).length + 1}`,
        x1: attachedBody?.x ?? x1, y1: attachedBody?.y ?? y1,
        x2, y2,
        friction: type === 'surface' ? 0.3 : 0,
        ...(attachedBody ? { bodyId: attachedBody.id, tension: 15 } : {}),
      }
      return { ...current, structures: [...current.structures, structure] }
    })
    setSelection({ kind: 'structure', id })
  }
  const addForce = (x: number, y: number) => {
    const body = selection?.kind === 'body' ? document.bodies.find((candidate) => candidate.id === selection.id) : document.bodies.find((candidate) => Math.hypot(candidate.x - x, candidate.y - y) < candidate.radius + 25) ?? document.bodies[0]
    if (!body) return
    const force: PhysicsForce = { id: makePhysicsId(), label: `F${document.forces.length + 1}`, bodyId: body.id, magnitude: 20, angle: 45, color: forceColors[document.forces.length % forceColors.length]! }
    setSelection({ kind: 'force', id: force.id })
    update((current) => ({ ...current, forces: [...current.forces, force] }))
  }
  const addAt = (placement: Exclude<PlacementTool, 'select'>, x1: number, y1: number, x2?: number, y2?: number) => {
    if (placement === 'body') { addObject(x1, y1); setTool('select') }
    if (placement === 'wall' || placement === 'surface' || placement === 'string') { addStructure(placement, x1, y1, x2, y2); setTool('select') }
    if (placement === 'force') { addForce(x1, y1); setTool('select') }
  }
  const moveSelection = (selected: Exclude<Selection, null>, dx: number, dy: number) => {
    if (!dx && !dy) return
    if (selected.kind === 'body') {
      update((current) => ({
        ...current,
        bodies: current.bodies.map((body) => body.id === selected.id ? { ...body, x: body.x + dx, y: body.y + dy } : body),
        structures: current.structures.map((structure) => structure.bodyId === selected.id ? { ...structure, x1: structure.x1 + dx, y1: structure.y1 + dy } : structure),
      }))
    } else if (selected.kind === 'structure') {
      update((current) => ({ ...current, structures: current.structures.map((structure) => structure.id === selected.id ? { ...structure, x1: structure.x1 + dx, y1: structure.y1 + dy, x2: structure.x2 + dx, y2: structure.y2 + dy } : structure) }))
    } else {
      update((current) => ({ ...current, forces: current.forces.map((force) => force.id === selected.id ? { ...force, angle: force.angle + Math.atan2(-dy, dx) * 180 / Math.PI } : force) }))
    }
  }
  const editStructure = (id: string, changes: Partial<PhysicsStructure>) => update((current) => ({ ...current, structures: current.structures.map((structure) => structure.id === id ? { ...structure, ...changes } : structure) }))
  const editForce = (id: string, changes: Partial<PhysicsForce>) => update((current) => ({ ...current, forces: current.forces.map((force) => force.id === id ? { ...force, ...changes } : force) }))
  const editStructureAngle = (structure: PhysicsStructure, angle: number) => {
    const radians = angle * Math.PI / 180
    const length = Math.hypot(structure.x2 - structure.x1, structure.y2 - structure.y1)
    if (structure.type === 'string') {
      editStructure(structure.id, { x2: structure.x1 + length * Math.cos(radians), y2: structure.y1 - length * Math.sin(radians) })
      return
    }
    const centerX = (structure.x1 + structure.x2) / 2
    const centerY = (structure.y1 + structure.y2) / 2
    editStructure(structure.id, {
      x1: centerX - length / 2 * Math.cos(radians),
      y1: centerY + length / 2 * Math.sin(radians),
      x2: centerX + length / 2 * Math.cos(radians),
      y2: centerY - length / 2 * Math.sin(radians),
    })
  }
  const removeSelection = () => {
    if (!selection) return
    update((current) => ({
      ...current,
      bodies: selection.kind === 'body' ? current.bodies.filter((body) => body.id !== selection.id) : current.bodies,
      structures: selection.kind === 'structure' ? current.structures.filter((structure) => structure.id !== selection.id) : current.structures.filter((structure) => structure.bodyId !== selection.id),
      forces: selection.kind === 'force' ? current.forces.filter((force) => force.id !== selection.id) : selection.kind === 'body' ? current.forces.filter((force) => force.bodyId !== selection.id) : current.forces,
    }))
    setSelection(null)
  }
  const togglePlayback = () => {
    if (document.mode !== 'simulation') return
    if (elapsedRef.current >= PHYSICS_LOOP_SECONDS) {
      setSimulatedBodies(cloneDocument(document).bodies)
      elapsedRef.current = 0
      setElapsed(0)
    }
    setPlaying((current) => !current)
  }
  const resetSimulation = () => {
    setPlaying(false)
    setElapsed(0)
    elapsedRef.current = 0
    setSimulatedBodies(cloneDocument(document).bodies)
  }
  useEffect(() => {
    if (document.mode !== 'simulation' || !playing || elapsed < PHYSICS_LOOP_SECONDS) return
    setPlaying(false)
  }, [document.mode, elapsed, playing])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Delete' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLSelectElement)) removeSelection()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onAddToCanvas(document, 'snapshot')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const selectedBody = selection?.kind === 'body' ? document.bodies.find((body) => body.id === selection.id) : undefined
  const selectedStructure = selection?.kind === 'structure' ? document.structures.find((item) => item.id === selection.id) : undefined
  const selectedForce = selection?.kind === 'force' ? document.forces.find((item) => item.id === selection.id) : undefined
  const insert = (playback: 'snapshot' | 'loop') => {
    onAddToCanvas(document, playback)
    setSaved(true)
  }

  return <div className="physics-studio" role="dialog" aria-modal="true" aria-label="Physics simulator">
    <header className="physics-studio-header">
      <div className="physics-studio-brand"><span>ΣF</span><strong>2D Physics Simulator</strong><small>MathCanvas</small></div>
      <div className="physics-studio-actions">
        <span className={saved ? 'physics-studio-saved' : ''}>{saved ? 'Added to canvas' : editing ? 'Edit scene, then update the canvas item' : 'Build a scene and insert it on the canvas'}</span>
        <button type="button" className="physics-insert-button" onClick={() => insert('snapshot')}>{editing ? 'Update snapshot' : 'Add snapshot'}</button>
        <button type="button" className="physics-loop-button" disabled={document.mode !== 'simulation'} onClick={() => insert('loop')}>{editing ? 'Update looping simulation' : 'Add looping simulation'}</button>
        <button type="button" className="physics-close-button" aria-label="Close physics simulator" onClick={onClose}>×</button>
      </div>
    </header>
    <div className="physics-studio-toolbar" role="toolbar" aria-label="Add scene elements">
      <span>ADD TO SCENE</span>
      <button type="button" className={tool === 'body' ? 'selected' : ''} onClick={() => setTool(tool === 'body' ? 'select' : 'body')}>＋ Object</button>
      <button type="button" className={tool === 'string' ? 'selected' : ''} onClick={() => setTool(tool === 'string' ? 'select' : 'string')}>╲ String</button>
      <button type="button" className={tool === 'surface' ? 'selected' : ''} onClick={() => setTool(tool === 'surface' ? 'select' : 'surface')}>━ Surface</button>
      <button type="button" className={tool === 'wall' ? 'selected' : ''} onClick={() => setTool(tool === 'wall' ? 'select' : 'wall')}>┃ Wall</button>
      <button type="button" className={tool === 'force' ? 'selected' : ''} onClick={() => setTool(tool === 'force' ? 'select' : 'force')}>↗ Force arrow</button>
      <span className="physics-toolbar-spacer" />
      <label className="physics-mode-switch">Scene mode
        <select value={document.mode} onChange={(event) => { const mode = event.target.value as PhysicsDocument['mode']; update((current) => ({ ...current, mode })) }}>
          <option value="static">Static · solve forces</option>
          <option value="simulation">Simulation · ΣF = ma</option>
        </select>
      </label>
    </div>
    <div className="physics-studio-layout">
      <main className="physics-studio-stage">
        <SceneCanvas document={document} bodies={document.mode === 'simulation' ? simulatedBodies : document.bodies} tool={tool} selection={selection} onSelect={setSelection} onAdd={addAt} onMove={moveSelection} />
        <div className="physics-stage-hud"><span>{document.mode === 'static' ? 'STATIC FORCE DIAGRAM' : `SIMULATION · ${elapsed.toFixed(2)} s`}</span><span>{tool === 'select' ? 'Drag objects and structures to reposition' : 'Click the scene to place this element'}</span></div>
        {document.mode === 'simulation' && <div className="physics-stage-playback">
          <button type="button" className="physics-play-button" onClick={togglePlayback}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button>
          <button type="button" onClick={resetSimulation}>Reset</button>
          <input aria-label="Simulation time" type="range" min="0" max={PHYSICS_LOOP_SECONDS} step="0.05" value={Math.min(elapsed, PHYSICS_LOOP_SECONDS)} onChange={(event) => {
            const next = Number(event.target.value)
            setPlaying(false)
            elapsedRef.current = next
            setElapsed(next)
            setSimulatedBodies(getSimulatedBodies(document, next))
          }} />
          <output>{elapsed.toFixed(2)} / {PHYSICS_LOOP_SECONDS.toFixed(1)} s</output>
        </div>}
      </main>
      <aside className="physics-inspector">
        <div className="physics-inspector-title"><div><h2>Scene</h2><p>{document.bodies.length} objects · {document.structures.length} structures</p></div>
          {selection && <button type="button" className="physics-delete-selection" onClick={removeSelection} title="Delete selected element">Delete</button>}
        </div>
        <div className="physics-inspector-scroll">
          <section className="physics-inspector-section">
            <h3>Environment</h3>
            <label>Gravity <span className="physics-inline-input"><input type="number" min="0" max="40" step="0.1" value={document.gravity} onChange={(event) => update((current) => ({ ...current, gravity: Math.max(0, Number(event.target.value) || 0) }))} /> m/s²</span></label>
                <label className="physics-checkbox-label"><input type="checkbox" checked={document.autoBalanceForces !== false} onChange={(event) => update((current) => ({ ...current, autoBalanceForces: event.target.checked }))} /> Auto balance forces</label>
              </section>
          {selectedBody && <section className="physics-inspector-section">
            <h3>Object · {selectedBody.label}</h3>
            <label>Name<input value={selectedBody.label} onChange={(event) => editBody(selectedBody.id, { label: event.target.value })} /></label>
            <label>Mass <span className="physics-inline-input"><input type="number" min="0.1" max="10000" step="0.1" value={selectedBody.mass} onChange={(event) => editBody(selectedBody.id, { mass: Math.max(0.1, Number(event.target.value) || 0.1) })} /> kg</span></label>
            <label>Radius <span className="physics-inline-input"><input type="number" min="8" max="100" step="1" value={selectedBody.radius} onChange={(event) => editBody(selectedBody.id, { radius: Math.max(8, Number(event.target.value) || 8) })} /> px</span></label>
            <label>Surface friction (μ) <span className="physics-inline-input"><input type="number" min="0" max="5" step="0.05" value={selectedBody.friction} onChange={(event) => editBody(selectedBody.id, { friction: Math.max(0, Number(event.target.value) || 0) })} /></span></label>
            <label>Initial velocity · x <span className="physics-inline-input"><input type="number" step="0.1" value={selectedBody.vx} onChange={(event) => editBody(selectedBody.id, { vx: Number(event.target.value) || 0 })} /> m/s</span></label>
            <label>Initial velocity · y <span className="physics-inline-input"><input type="number" step="0.1" value={selectedBody.vy} onChange={(event) => editBody(selectedBody.id, { vy: Number(event.target.value) || 0 })} /> m/s</span></label>
            <label>Appearance<input aria-label="Object color" type="color" value={selectedBody.color} onChange={(event) => editBody(selectedBody.id, { color: event.target.value })} /></label>
            <div className="physics-body-net"><span>Net force</span><strong>{format(Math.hypot(getNetForce(document, selectedBody).x, getNetForce(document, selectedBody).y))} N</strong></div>
          </section>}
          {selectedStructure && <section className="physics-inspector-section">
            <h3>{selectedStructure.type} · {selectedStructure.label}</h3>
            <label>Name<input value={selectedStructure.label} onChange={(event) => editStructure(selectedStructure.id, { label: event.target.value })} /></label>
            {selectedStructure.type !== 'string' && <label>Friction (μ) <span className="physics-inline-input"><input type="number" min="0" max="5" step="0.05" value={selectedStructure.friction} onChange={(event) => editStructure(selectedStructure.id, { friction: Math.max(0, Number(event.target.value) || 0) })} /></span></label>}
            <label>Angle <span className="physics-inline-input"><input type="number" min="-360" max="360" step="1" value={Math.round(Math.atan2(-(selectedStructure.y2 - selectedStructure.y1), selectedStructure.x2 - selectedStructure.x1) * 180 / Math.PI)} onChange={(event) => editStructureAngle(selectedStructure, Number(event.target.value) || 0)} /> °</span></label>
            {selectedStructure.type === 'string' && <>
              <label>Attached object<select value={selectedStructure.bodyId ?? ''} onChange={(event) => editStructure(selectedStructure.id, { bodyId: event.target.value || undefined })}><option value="">No object</option>{document.bodies.map((body) => <option key={body.id} value={body.id}>{body.label}</option>)}</select></label>
              <label>Tension <span className="physics-inline-input"><input type="number" min="0" max="10000" step="0.1" value={selectedStructure.tension ?? 0} onChange={(event) => editStructure(selectedStructure.id, { tension: Math.max(0, Number(event.target.value) || 0) })} /> N</span></label>
            </>}
          </section>}
          {selectedForce && <section className="physics-inspector-section">
            <h3>Force arrow · {selectedForce.label}</h3>
            <label>Name<input value={selectedForce.label} onChange={(event) => editForce(selectedForce.id, { label: event.target.value })} /></label>
            <label>Object<select value={selectedForce.bodyId} onChange={(event) => editForce(selectedForce.id, { bodyId: event.target.value })}>{document.bodies.map((body) => <option key={body.id} value={body.id}>{body.label}</option>)}</select></label>
            <label>Magnitude <span className="physics-inline-input"><input type="number" min="0" max="100000" step="0.1" value={selectedForce.magnitude} onChange={(event) => editForce(selectedForce.id, { magnitude: Math.max(0, Number(event.target.value) || 0) })} /> N</span></label>
            <label>Angle <span className="physics-inline-input"><input type="number" min="-360" max="360" step="1" value={selectedForce.angle} onChange={(event) => editForce(selectedForce.id, { angle: Number(event.target.value) || 0 })} /> °</span></label>
            <label>Arrow color<input aria-label="Force arrow color" type="color" value={selectedForce.color} onChange={(event) => editForce(selectedForce.id, { color: event.target.value })} /></label>
          </section>}
          {!selection && <section className="physics-inspector-section physics-inspector-empty"><h3>Force summary</h3>
            {document.bodies.map((body) => {
              const net = getNetForce(document, body)
              const magnitude = Math.hypot(net.x, net.y)
              const status = magnitude < 0.05
                ? 'ΣF = 0 · Balanced'
                : document.autoBalanceForces !== false
                  ? `Auto-balanced with ${format(magnitude)} N`
                  : `Needs ${format(magnitude)} N balancing force`
              return <div className="physics-net-row" key={body.id}><span>{body.label}</span><strong>{format(magnitude)} N</strong><small>{status}</small></div>
            })}
            <p>Choose an object or force arrow in the scene to edit its properties. Auto balance applies a counter-force; turn it off to see velocity arrows and let forces accelerate objects.</p>
          </section>}
          <section className="physics-inspector-section physics-scene-list">
            <h3>Objects</h3>
            {document.bodies.map((body) => <button type="button" key={body.id} className={selection?.id === body.id ? 'selected' : ''} onClick={() => setSelection({ kind: 'body', id: body.id })}><span className="physics-object-swatch" style={{ background: body.color }} />{body.label}<small>{format(body.mass)} kg</small></button>)}
            {!document.bodies.length && <p>No objects. Add one from the toolbar.</p>}
          </section>
          <p className="physics-inspector-help">Angles are measured counterclockwise from +x. Velocity x is right-positive and y is up-positive. Set an object's initial velocity, turn off auto balance, and run Simulation mode for projectile motion. Drag to draw surfaces and walls; drag a force arrow to rotate it.</p>
        </div>
      </aside>
    </div>
  </div>
}

export { makePhysicsDocument }
