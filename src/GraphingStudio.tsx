import React, { useEffect, useMemo, useRef, useState } from 'react'
import { evaluateGraphDocument, findGraphPointsOfInterest, graphPalette, makeGraphExpressionRow, type GraphPointOfInterest, type GraphStudioDocument } from './graphing'

type GraphingStudioProps = {
  initialDocument: GraphStudioDocument
  onAddToCanvas: (document: GraphStudioDocument) => void
  onClose: () => void
}

const cloneDocument = (document: GraphStudioDocument): GraphStudioDocument => JSON.parse(JSON.stringify(document)) as GraphStudioDocument
const format = (value: number) => Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : 'undefined'

function GraphPlot({ document, onViewportChange }: { document: GraphStudioDocument; onViewportChange: (centerX: number, centerY: number, scale: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [pointer, setPointer] = useState<{ x: number; y: number }>()
  const [dragging, setDragging] = useState(false)
  const [selectedPoint, setSelectedPoint] = useState<GraphPointOfInterest>()
  const evaluation = useMemo(() => evaluateGraphDocument(document), [document.rows, document.parameters])
  const xMin = document.centerX - size.width / 2 / document.scale
  const xMax = document.centerX + size.width / 2 / document.scale
  const pointsOfInterest = useMemo(() => findGraphPointsOfInterest(evaluation.curves, xMin, xMax), [evaluation.curves, xMin, xMax])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => setSize({ width: canvas.clientWidth, height: canvas.clientHeight })
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !size.width || !size.height) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const { width, height } = size
    const scale = Math.max(0.02, Math.min(document.scale, 100000))
    const centerX = document.centerX
    const centerY = document.centerY
    const toX = (x: number) => width / 2 + (x - centerX) * scale
    const toY = (y: number) => height / 2 - (y - centerY) * scale
    const fromX = (x: number) => centerX + (x - width / 2) / scale
    const fromY = (y: number) => centerY - (y - height / 2) / scale
    const stepSize = (target: number) => {
      const exponent = Math.floor(Math.log10(target))
      const magnitude = 10 ** exponent
      return [1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= target) ?? magnitude * 10
    }
    const step = stepSize(80 / scale)
    const xMin = fromX(0), xMax = fromX(width), yMin = fromY(height), yMax = fromY(0)

    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.strokeStyle = '#edf0f4'
    context.lineWidth = 1
    context.beginPath()
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      const px = toX(x)
      context.moveTo(px, 0)
      context.lineTo(px, height)
    }
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      const py = toY(y)
      context.moveTo(0, py)
      context.lineTo(width, py)
    }
    context.stroke()
    context.strokeStyle = '#5f6874'
    context.lineWidth = 1.5
    context.beginPath()
    if (centerX >= xMin && centerX <= xMax) { context.moveTo(toX(0), 0); context.lineTo(toX(0), height) }
    if (centerY >= yMin && centerY <= yMax) { context.moveTo(0, toY(0)); context.lineTo(width, toY(0)) }
    context.stroke()
    context.fillStyle = '#475569'
    context.font = '600 12px Inter, Segoe UI, Arial, sans-serif'
    if (toY(0) >= 0 && toY(0) <= height) context.fillText('x', width - 18, toY(0) - 7)
    if (toX(0) >= 0 && toX(0) <= width) context.fillText('y', toX(0) + 7, 15)
    context.fillStyle = '#64748b'
    context.font = '11px Inter, Segoe UI, Arial, sans-serif'
    context.textAlign = 'center'
    for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
      if (Math.abs(x) < step * 0.001) continue
      context.fillText(format(x), toX(x), Math.min(height - 5, Math.max(12, toY(0) + 14)))
    }
    context.textAlign = 'left'
    for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
      if (Math.abs(y) < step * 0.001) continue
      context.fillText(format(y), Math.min(width - 42, Math.max(3, toX(0) + 5)), toY(y) - 3)
    }

    context.save()
    context.beginPath()
    context.rect(0, 0, width, height)
    context.clip()
    const samples = Math.max(500, Math.ceil(width * 1.4))
    for (const curve of evaluation.curves) {
      if (!curve.row.visible) continue
      context.strokeStyle = curve.row.color
      context.lineWidth = 2.25
      context.lineJoin = 'round'
      context.lineCap = 'round'
      context.beginPath()
      let drawing = false
      let previousY: number | undefined
      for (let index = 0; index <= samples; index++) {
        const x = xMin + (xMax - xMin) * index / samples
        const y = curve.evaluate(x)
        if (y === null || Math.abs(y) > 1e10 || previousY !== undefined && Math.abs(y - previousY) * scale > height * 3) {
          drawing = false
          previousY = undefined
          continue
        }
        const px = toX(x), py = toY(y)
        if (py < -height * 2 || py > height * 3) { drawing = false; previousY = y; continue }
        if (drawing) context.lineTo(px, py)
        else { context.moveTo(px, py); drawing = true }
        previousY = y
      }
      context.stroke()
    }
    context.font = '11px Inter, Segoe UI, Arial, sans-serif'
    for (const point of pointsOfInterest) {
      const px = toX(point.x), py = toY(point.y)
      if (px < 0 || px > width || py < 0 || py > height) continue
      context.fillStyle = point.color
      context.beginPath()
      context.arc(px, py, 5, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#111827'
      context.fillText(point.label, px + 7, py - 7)
    }
    if (selectedPoint) {
      const px = toX(selectedPoint.x), py = toY(selectedPoint.y)
      context.strokeStyle = '#fff'
      context.lineWidth = 2
      context.beginPath()
      context.arc(px, py, 8, 0, Math.PI * 2)
      context.stroke()
    }
    if (pointer && !dragging) {
      const x = fromX(pointer.x)
      const y = fromY(pointer.y)
      const nearest = evaluation.curves.filter((curve) => curve.row.visible).map((curve) => ({ curve, value: curve.evaluate(x) })).filter((entry): entry is { curve: typeof evaluation.curves[number]; value: number } => entry.value !== null && Math.abs(toY(entry.value) - pointer.y) < 28).sort((a, b) => Math.abs(toY(a.value) - pointer.y) - Math.abs(toY(b.value) - pointer.y))[0]
      if (nearest) {
        const px = toX(x), py = toY(nearest.value)
        context.fillStyle = nearest.curve.row.color
        context.beginPath()
        context.arc(px, py, 5, 0, Math.PI * 2)
        context.fill()
      }
    }
    context.restore()
  }, [document, evaluation, pointsOfInterest, pointer, dragging, selectedPoint, size])

  const position = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = position(event)
    dragRef.current = { ...point, centerX: document.centerX, centerY: document.centerY }
    setDragging(true)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = position(event)
    setPointer(point)
    const drag = dragRef.current
    if (drag) onViewportChange(drag.centerX - (point.x - drag.x) / document.scale, drag.centerY + (point.y - drag.y) / document.scale, document.scale)
  }
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    const point = position(event)
    if (drag && Math.hypot(point.x - drag.x, point.y - drag.y) < 4) {
      const nearest = pointsOfInterest.map((candidate) => ({
        candidate,
        distance: Math.hypot(
          size.width / 2 + (candidate.x - document.centerX) * document.scale - point.x,
          size.height / 2 - (candidate.y - document.centerY) * document.scale - point.y,
        ),
      })).filter((entry) => entry.distance <= 12).sort((a, b) => a.distance - b.distance)[0]
      setSelectedPoint(nearest?.candidate)
    }
    dragRef.current = null
    setDragging(false)
  }
  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const point = position(event)
    const factor = Math.exp(-event.deltaY * 0.0013)
    const scale = Math.max(0.02, Math.min(100000, document.scale * factor))
    const beforeX = document.centerX + (point.x - size.width / 2) / document.scale
    const beforeY = document.centerY - (point.y - size.height / 2) / document.scale
    onViewportChange(beforeX - (point.x - size.width / 2) / scale, beforeY + (point.y - size.height / 2) / scale, scale)
  }
  const hoveredPointOfInterest = pointer && !dragging ? pointsOfInterest.find((point) => {
    const px = size.width / 2 + (point.x - document.centerX) * document.scale
    const py = size.height / 2 - (point.y - document.centerY) * document.scale
    return Math.hypot(px - pointer.x, py - pointer.y) <= 12
  }) : undefined
  const hovered = pointer && !dragging ? (() => {
    const x = document.centerX + (pointer.x - size.width / 2) / document.scale
    const y = document.centerY - (pointer.y - size.height / 2) / document.scale
    return evaluation.curves.filter((curve) => curve.row.visible).map((curve) => ({ curve, value: curve.evaluate(x) })).filter((entry): entry is { curve: typeof evaluation.curves[number]; value: number } => entry.value !== null && Math.abs(entry.value - y) * document.scale < 28).sort((a, b) => Math.abs(a.value - y) - Math.abs(b.value - y))[0]
  })() : undefined

  return <div className="graph-studio-plot">
    <canvas ref={canvasRef} aria-label="Interactive graph plot" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragRef.current = null; setDragging(false) }} onPointerLeave={() => { if (!dragRef.current) setPointer(undefined) }} onWheel={onWheel} />
    <div className="graph-studio-coordinates" aria-live="polite">{pointer && <><span>x = {format(document.centerX + (pointer.x - size.width / 2) / document.scale)}</span><span>y = {format(document.centerY - (pointer.y - size.height / 2) / document.scale)}</span>{hovered && <strong style={{ color: hovered.curve.row.color }}>{hovered.curve.label} = {format(hovered.value)}</strong>}</>}{(hoveredPointOfInterest ?? selectedPoint) && <strong>{(hoveredPointOfInterest ?? selectedPoint)!.label} ({format((hoveredPointOfInterest ?? selectedPoint)!.x)}, {format((hoveredPointOfInterest ?? selectedPoint)!.y)})</strong>}</div>
    <div className="graph-studio-view-actions"><button type="button" title="Zoom in" onClick={() => onViewportChange(document.centerX, document.centerY, Math.min(100000, document.scale * 1.25))}>+</button><button type="button" title="Zoom out" onClick={() => onViewportChange(document.centerX, document.centerY, Math.max(0.02, document.scale / 1.25))}>−</button><button type="button" onClick={() => onViewportChange(0, 0, 50)}>Reset view</button></div>
  </div>
}

export function GraphingStudio({ initialDocument, onAddToCanvas, onClose }: GraphingStudioProps) {
  const [document, setDocument] = useState(() => cloneDocument(initialDocument))
  const [saved, setSaved] = useState(false)
  const evaluation = useMemo(() => evaluateGraphDocument(document), [document.rows, document.parameters])
  const playing = useRef(new Set<string>())

  const update = (change: (current: GraphStudioDocument) => GraphStudioDocument) => {
    setSaved(false)
    setDocument((current) => change(current))
  }
  const updateRow = (id: string, change: (row: GraphStudioDocument['rows'][number]) => GraphStudioDocument['rows'][number]) => update((current) => ({ ...current, rows: current.rows.map((row) => row.id === id ? change(row) : row) }))
  const addRow = () => update((current) => ({ ...current, rows: [...current.rows, { ...makeGraphExpressionRow(), color: graphPalette[current.rows.length % graphPalette.length]! }] }))
  const changeViewport = (centerX: number, centerY: number, scale: number) => update((current) => ({ ...current, centerX, centerY, scale }))
  const updateParameter = (name: string, property: 'value' | 'min' | 'max' | 'step', value: number) => {
    if (!Number.isFinite(value)) return
    update((current) => {
      const existing = evaluation.parameters[name]
      if (!existing) return current
      const parameter = { ...existing, [property]: value }
      if (property === 'min' && parameter.min > parameter.max) parameter.max = parameter.min
      if (property === 'max' && parameter.max < parameter.min) parameter.min = parameter.max
      if (property === 'step' && parameter.step <= 0) return current
      parameter.value = Math.max(parameter.min, Math.min(parameter.max, parameter.value))
      return { ...current, parameters: { ...current.parameters, [name]: parameter } }
    })
  }

  useEffect(() => {
    if (!playing.current.size) return
    let frame = 0
    let previous = 0
    const animate = (now: number) => {
      if (now - previous > 45) {
        previous = now
        setDocument((current) => {
          const parameters = { ...current.parameters }
          for (const name of playing.current) {
            const parameter = evaluation.parameters[name]
            if (!parameter) continue
            const value = parameter.value + parameter.step * Math.max(0.03, (parameter.max - parameter.min) / 12)
            parameters[name] = { ...parameter, value: value > parameter.max ? parameter.min : value }
          }
          return { ...current, parameters }
        })
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [document, evaluation.parameters])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') onAddToCanvas(document)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [document, onAddToCanvas, onClose])

  const addToCanvas = () => {
    if (!evaluation.curves.length) return
    onAddToCanvas(document)
    setSaved(true)
  }

  return <div className="graph-studio" role="dialog" aria-modal="true" aria-label="Graphing calculator">
    <header className="graph-studio-header">
      <div className="graph-studio-brand"><span>ƒ</span><strong>Graphing Calculator</strong><small>MathCanvas</small></div>
      <div className="graph-studio-header-actions"><span className={saved ? 'graph-studio-saved' : ''}>{saved ? 'Added to canvas' : 'Changes stay here until added to canvas'}</span><button type="button" className="graph-studio-add" onClick={addToCanvas} disabled={!evaluation.curves.length}>Add to canvas</button><button type="button" className="graph-studio-close" aria-label="Close graphing calculator" onClick={onClose}>×</button></div>
    </header>
    <div className="graph-studio-body">
      <aside className="graph-studio-panel">
        <div className="graph-studio-section-title"><h2>Expressions</h2><button type="button" onClick={addRow}>＋</button></div>
        <div className="graph-studio-expressions">
          {document.rows.map((row, index) => <article className="graph-studio-expression" key={row.id} style={{ borderLeftColor: row.color }}>
            <div className="graph-studio-expression-controls">
              <button type="button" className={`graph-studio-visible ${row.visible ? '' : 'muted'}`} aria-label={`${row.visible ? 'Hide' : 'Show'} expression ${index + 1}`} onClick={() => updateRow(row.id, (current) => ({ ...current, visible: !current.visible }))}>{row.visible ? '◉' : '○'}</button>
              <input aria-label={`Expression ${index + 1}`} spellCheck={false} value={row.expression} placeholder="e.g. y = x^2" onChange={(event) => updateRow(row.id, (current) => ({ ...current, expression: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRow() } }} />
              <input aria-label={`Color for expression ${index + 1}`} type="color" value={row.color} onChange={(event) => updateRow(row.id, (current) => ({ ...current, color: event.target.value }))} />
              <button type="button" className="graph-studio-delete" aria-label={`Delete expression ${index + 1}`} onClick={() => update((current) => ({ ...current, rows: current.rows.filter((item) => item.id !== row.id) }))}>×</button>
            </div>
            {evaluation.values[row.id] && <div className="graph-studio-value">{evaluation.values[row.id]}</div>}
            {evaluation.errors[row.id] && <div className="graph-studio-error" role="alert">{evaluation.errors[row.id]}</div>}
          </article>)}
          {!document.rows.length && <p className="graph-studio-empty">Add an expression to get started. Try <code>y = x^2</code>.</p>}
        </div>
        <section className="graph-studio-parameters">
          <h2>Parameters</h2>
          {Object.entries(evaluation.parameters).length ? Object.entries(evaluation.parameters).map(([name, parameter]) => <div className="graph-studio-parameter" key={name}>
            <div className="graph-studio-parameter-heading"><strong>{name}</strong><input aria-label={`${name} value`} type="number" value={parameter.value} step="any" onChange={(event) => updateParameter(name, 'value', Number(event.target.value))} /><button type="button" aria-label={`${playing.current.has(name) ? 'Pause' : 'Animate'} ${name}`} onClick={() => { if (playing.current.has(name)) playing.current.delete(name); else playing.current.add(name); setDocument((current) => ({ ...current })) }}>{playing.current.has(name) ? 'Ⅱ' : '▶'}</button><button type="button" aria-label={`Reset ${name}`} onClick={() => updateParameter(name, 'value', parameter.initial)}>↺</button></div>
            <input aria-label={`${name} slider`} className="graph-studio-range" type="range" min={parameter.min} max={parameter.max} step={parameter.step} value={parameter.value} onChange={(event) => updateParameter(name, 'value', Number(event.target.value))} />
            <div className="graph-studio-parameter-bounds"><label>Min<input type="number" value={parameter.min} step="any" onChange={(event) => updateParameter(name, 'min', Number(event.target.value))} /></label><label>Max<input type="number" value={parameter.max} step="any" onChange={(event) => updateParameter(name, 'max', Number(event.target.value))} /></label><label>Step<input type="number" min="0.000001" value={parameter.step} step="any" onChange={(event) => updateParameter(name, 'step', Number(event.target.value))} /></label></div>
          </div>) : <p className="graph-studio-empty">Parameters used in expressions become sliders. Try <code>y = a sin(x)</code>.</p>}
        </section>
        <p className="graph-studio-help">Enter definitions like <code>f(x) = a(x - h)^2</code> or <code>a = 2</code>. Drag to pan; scroll to zoom; hover near a curve to inspect coordinates.</p>
      </aside>
      <main className="graph-studio-main"><GraphPlot document={document} onViewportChange={changeViewport} /></main>
    </div>
  </div>
}
