import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { all, create } from 'mathjs'
import { convertLatexToMarkup } from 'mathlive'
import { evaluateGraphDocument, findGraphIntersections, type GraphStudioDocument } from './graphing'
import { getBodyForces, getNetForce, getSimulatedBodies, PHYSICS_LOOP_SECONDS, PHYSICS_SCENE_HEIGHT, PHYSICS_SCENE_WIDTH, type PhysicsDocument, type PhysicsBody } from './physics'
import 'mathlive/fonts.css'
import 'mathlive/static.css'

const math = create(all, {})

export type Point = { x: number; y: number }
export type CanvasRect = { x: number; y: number; w: number; h: number }
export type RemoteCursor = { peerId: string; name: string; x: number; y: number; color: string; visible: boolean; selectedIds: string[]; marquee: CanvasRect | null }
export type CanvasTool = 'select' | 'pan' | 'draw' | 'eraser' | 'line' | 'shape' | 'text' | 'ruler' | 'protractor'
export type CanvasShapeType = 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'parallelogram' | 'pentagon' | 'hexagon' | 'star' | 'arrow'
export type ShapeOptions = { shapeType: CanvasShapeType; borderOn: boolean; fillOn: boolean; borderColor: string; fillColor: string; borderWidth: number }
export type TextOptions = { textColor: string; fillEnabled: boolean; fillColor: string }
export type PageErasePath = { points: Point[]; size: number }
export type LineOptions = { color: string; width: number; style: 'solid' | 'dashed' | 'dotted'; startArrow: boolean; endArrow: boolean }

type ItemBase = { id: string; x: number; y: number; w: number; h: number; locked?: boolean }
export type CanvasItem =
  | (ItemBase & { kind: 'stroke'; points: Point[]; color: string; size: number })
  | (ItemBase & { kind: 'line' | 'ruler'; color: string; width?: number; style?: 'solid' | 'dashed' | 'dotted'; startArrow?: boolean; endArrow?: boolean })
  | (ItemBase & { kind: 'shape'; color: string; fill: string; shapeType?: CanvasShapeType; borderOn?: boolean; fillOn?: boolean; borderColor?: string; fillColor?: string; borderWidth?: number })
  | (ItemBase & { kind: 'text'; text: string; fontSize: number; textColor?: string; fillEnabled?: boolean; fillColor?: string })
  | (ItemBase & { kind: 'equation'; latex: string; fontSize: number })
  | (ItemBase & { kind: 'graph'; expression: string; xMin: number; xMax: number; yMin: number; yMax: number; gridStep: number; studio?: GraphStudioDocument })
  | (ItemBase & { kind: 'physics'; studio: PhysicsDocument; playback: 'snapshot' | 'loop'; playing: boolean })
  | (ItemBase & { kind: 'table'; rows: number; cols: number; cells: string[]; header: boolean })
  | (ItemBase & { kind: 'page'; src: string; title: string; erasures?: PageErasePath[]; pdfDocumentId?: string; pdfTitle?: string; pdfPageNumber?: number; pdfPageCount?: number })
  | (ItemBase & { kind: 'protractor'; color: string })

export type CanvasViewport = { x: number; y: number; zoom: number }

export type NativeCanvasHandle = {
  getCenter: () => Point
  zoomToFit: () => void
  focusItem: (id: string) => void
  exportPng: () => Promise<Blob>
}

export const makeItemId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const defaultViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }

const makeBounds = (points: Point[]) => {
  if (!points.length) return { x: 0, y: 0, w: 1, h: 1 }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) }
}

const rectBounds = (item: Pick<ItemBase, 'x' | 'y' | 'w' | 'h'>) => ({
  x: Math.min(item.x, item.x + item.w),
  y: Math.min(item.y, item.y + item.h),
  w: Math.max(1, Math.abs(item.w)),
  h: Math.max(1, Math.abs(item.h)),
})

export const itemBounds = (item: CanvasItem) => item.kind === 'stroke' ? makeBounds(item.points) : rectBounds(item)

export const makeEquation = (x: number, y: number): Extract<CanvasItem, { kind: 'equation' }> => ({ id: makeItemId(), kind: 'equation', x, y, w: 360, h: 90, latex: 'x^2+y^2=r^2', fontSize: 30 })
export const makeGraph = (x: number, y: number, data: Pick<Extract<CanvasItem, { kind: 'graph' }>, 'expression' | 'xMin' | 'xMax' | 'yMin' | 'yMax' | 'gridStep'>): CanvasItem => ({ id: makeItemId(), kind: 'graph', x, y, w: 560, h: 400, ...data })
export const makeStudioGraph = (x: number, y: number, studio: GraphStudioDocument): Extract<CanvasItem, { kind: 'graph' }> => {
  const scale = Math.max(0.02, studio.scale)
  const xSpan = 514 / scale / 2
  const ySpan = 352 / scale / 2
  return {
    id: makeItemId(), kind: 'graph', x, y, w: 560, h: 400,
    expression: studio.rows.map((row) => row.expression).filter(Boolean).join('\n'),
    xMin: studio.centerX - xSpan, xMax: studio.centerX + xSpan,
    yMin: studio.centerY - ySpan, yMax: studio.centerY + ySpan,
    gridStep: Math.max(0.01, 80 / scale), studio,
  }
}
export const makePhysicsItem = (x: number, y: number, studio: PhysicsDocument, playback: 'snapshot' | 'loop' = 'snapshot'): Extract<CanvasItem, { kind: 'physics' }> => ({
  id: makeItemId(), kind: 'physics', x, y, w: 560, h: 380, studio, playback, playing: playback === 'loop',
})
export const makeTable = (x: number, y: number, rows: number, cols: number): CanvasItem => ({ id: makeItemId(), kind: 'table', x, y, w: 520, h: 260, rows, cols, cells: Array.from({ length: rows * cols }, () => ''), header: true })
export const makePage = (x: number, y: number, w: number, h: number, src: string, title: string): CanvasItem => ({ id: makeItemId(), kind: 'page', x, y, w, h, src, title, locked: false })

function translateItem(item: CanvasItem, dx: number, dy: number): CanvasItem {
  if (item.kind === 'stroke') return { ...item, x: item.x + dx, y: item.y + dy, points: item.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
  return { ...item, x: item.x + dx, y: item.y + dy }
}

function resizeItem(item: CanvasItem, startBounds: { x: number; y: number; w: number; h: number }, bounds: { x: number; y: number; w: number; h: number }): CanvasItem {
  const scaleX = bounds.w / startBounds.w
  const scaleY = bounds.h / startBounds.h
  if (item.kind === 'stroke') {
    return {
      ...item,
      x: bounds.x + (item.x - startBounds.x) * scaleX,
      y: bounds.y + (item.y - startBounds.y) * scaleY,
      w: item.w * scaleX,
      h: item.h * scaleY,
      points: item.points.map((point) => ({
        x: bounds.x + (point.x - startBounds.x) * scaleX,
        y: bounds.y + (point.y - startBounds.y) * scaleY,
      })),
    }
  }
  if (item.kind === 'text') {
    return {
      ...item,
      x: bounds.x + (item.x - startBounds.x) * scaleX,
      y: bounds.y + (item.y - startBounds.y) * scaleY,
      w: item.w * scaleX,
      h: item.h * scaleY,
      fontSize: Math.max(1, item.fontSize * Math.sqrt(scaleX * scaleY)),
    }
  }
  return {
    ...item,
    x: bounds.x + (item.x - startBounds.x) * scaleX,
    y: bounds.y + (item.y - startBounds.y) * scaleY,
    w: item.w * scaleX,
    h: item.h * scaleY,
  }
}

function normalizeRect(start: Point, end: Point) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.max(1, Math.abs(end.x - start.x)), h: Math.max(1, Math.abs(end.y - start.y)) }
}

function shapeAspectRatio(shapeType: CanvasShapeType) {
  return shapeType === 'triangle' ? 2 / Math.sqrt(3) : 1
}

function constrainedRect(start: Point, end: Point, aspectRatio = 1) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  const width = Math.max(Math.abs(dx), Math.abs(dy) * ratio, 1)
  const height = Math.max(width / ratio, 1)
  const signedWidth = dx < 0 ? -width : width
  const signedHeight = dy < 0 ? -height : height
  return { x: Math.min(start.x, start.x + signedWidth), y: Math.min(start.y, start.y + signedHeight), w: width, h: height }
}

function distanceToSegment(point: Point, a: Point, b: Point) {
  const abx = b.x - a.x, aby = b.y - a.y
  const apx = point.x - a.x, apy = point.y - a.y
  const length2 = abx * abx + aby * aby
  if (length2 === 0) return Math.hypot(apx, apy)
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / length2))
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t))
}

function pointInItem(point: Point, item: CanvasItem, tolerance = 8) {
  const bounds = itemBounds(item)
  if (item.kind === 'stroke') {
    for (let index = 1; index < item.points.length; index++) {
      if (distanceToSegment(point, item.points[index - 1], item.points[index]) <= tolerance / 1.5) return true
    }
    return false
  }
  if (item.kind === 'line' || item.kind === 'ruler') {
    return distanceToSegment(point, { x: item.x, y: item.y }, { x: item.x + item.w, y: item.y + item.h }) <= tolerance
  }
  if (item.kind === 'protractor') {
    const cx = bounds.x + bounds.w / 2
    const cy = bounds.y + bounds.h
    const radius = Math.min(bounds.w, bounds.h) / 2
    return Math.abs(Math.hypot(point.x - cx, point.y - cy) - radius) <= tolerance || (point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.w + tolerance && point.y >= cy - radius - tolerance && point.y <= cy + tolerance)
  }
  return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.w + tolerance && point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.h + tolerance
}

function itemAtPoint(point: Point, items: CanvasItem[], tolerance = 8) {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (!item.locked && pointInItem(point, item, tolerance)) return item
  }
  return undefined
}

type GraphMode = 'normal' | 'piecewise' | 'parametric' | 'polar'
type GraphRow = { expression: string; condition?: string }

function parseGraphDescriptor(raw: string): { mode: GraphMode; rows: GraphRow[] } {
  const trimmed = raw.trim()
  const first = trimmed.match(/^@(normal|piecewise|parametric|polar)\n?([\s\S]*)$/)
  if (!first) return { mode: 'normal', rows: trimmed.split(/\n+/).map((expression) => ({ expression })).filter((row) => row.expression) }
  const mode = first[1] as GraphMode
  const rows = (first[2] ?? '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (mode !== 'piecewise') return { expression: line }
    const [condition, expression] = line.split('=>')
    return { condition: condition?.trim(), expression: expression?.trim() ?? '' }
  }).filter((row) => row.expression)
  return { mode, rows }
}

function safeNumber(expression: string, scope: Record<string, number>) {
  try {
    const value = math.evaluate(expression.trim(), scope)
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function evaluateGraph(mode: GraphMode, rows: GraphRow[], x: number, t: number): Point | null {
  if (mode === 'parametric') {
    const [px, py] = rows[0]?.expression.split(',') ?? []
    const pointX = safeNumber(px ?? '', { x, t })
    const pointY = safeNumber(py ?? '', { x, t })
    return pointX === null || pointY === null ? null : { x: pointX, y: pointY }
  }
  if (mode === 'polar') {
    const radius = safeNumber(rows[0]?.expression ?? '', { x, t, theta: t })
    return radius === null ? null : { x: radius * Math.cos(t), y: radius * Math.sin(t) }
  }
  for (const row of rows) {
    if (mode === 'piecewise') {
      try {
        if (!Boolean(math.evaluate(row.condition ?? '', { x, t }))) continue
      } catch { continue }
    }
    const y = safeNumber(row.expression, { x, t })
    if (y !== null) return { x, y }
  }
  return null
}

function drawStudioGraph(context: CanvasRenderingContext2D, item: Extract<CanvasItem, { kind: 'graph' }>) {
  const document = item.studio
  if (!document) return
  const scale = Math.max(0.02, document.scale) * Math.min(item.w / 560, item.h / 400)
  const centerX = document.centerX, centerY = document.centerY
  const toX = (x: number) => item.w / 2 + (x - centerX) * scale
  const toY = (y: number) => item.h / 2 - (y - centerY) * scale
  const fromX = (x: number) => centerX + (x - item.w / 2) / scale
  const fromY = (y: number) => centerY - (y - item.h / 2) / scale
  const rawStep = 80 / scale
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rawStep) ?? magnitude * 10
  const xMin = fromX(0), xMax = fromX(item.w), yMin = fromY(item.h), yMax = fromY(0)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, item.w, item.h)
  context.strokeStyle = '#edf0f4'
  context.lineWidth = 1
  context.beginPath()
  for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) {
    context.moveTo(toX(x), 0); context.lineTo(toX(x), item.h)
  }
  for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) {
    context.moveTo(0, toY(y)); context.lineTo(item.w, toY(y))
  }
  context.stroke()
  context.strokeStyle = '#64748b'
  context.lineWidth = 1.25
  context.beginPath()
  if (centerX >= xMin && centerX <= xMax) { context.moveTo(toX(0), 0); context.lineTo(toX(0), item.h) }
  if (centerY >= yMin && centerY <= yMax) { context.moveTo(0, toY(0)); context.lineTo(item.w, toY(0)) }
  context.stroke()
  const evaluation = evaluateGraphDocument(document)
  context.save()
  context.beginPath(); context.rect(0, 0, item.w, item.h); context.clip()
  const samples = Math.max(300, Math.round(item.w * 1.2))
  for (const curve of evaluation.curves) {
    if (!curve.row.visible) continue
    context.strokeStyle = curve.row.color
    context.lineWidth = 2
    context.lineJoin = 'round'
    context.beginPath()
    let drawing = false
    let previousY: number | undefined
    for (let index = 0; index <= samples; index++) {
      const x = xMin + (xMax - xMin) * index / samples
      const y = curve.evaluate(x)
      if (y === null || previousY !== undefined && Math.abs(y - previousY) * scale > item.h * 3) { drawing = false; previousY = undefined; continue }
      const px = toX(x), py = toY(y)
      if (py < -item.h * 2 || py > item.h * 3) { drawing = false; previousY = y; continue }
      if (drawing) context.lineTo(px, py)
      else { context.moveTo(px, py); drawing = true }
      previousY = y
    }
    context.stroke()
  }
  context.fillStyle = '#111827'
  for (const intersection of findGraphIntersections(evaluation.curves, xMin, xMax)) {
    const px = toX(intersection.x), py = toY(intersection.y)
    if (px < 0 || px > item.w || py < 0 || py > item.h) continue
    context.beginPath(); context.arc(px, py, 4, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#fff'
    context.beginPath(); context.arc(px, py, 1.5, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#111827'
  }
  context.restore()
  context.fillStyle = '#64748b'
  context.font = '11px Segoe UI, Arial, sans-serif'
  context.fillText(document.rows.filter((row) => row.visible && row.expression.trim()).map((row) => row.expression).join(' · '), 10, item.h - 8, item.w - 20)
}

function drawGraph(context: CanvasRenderingContext2D, item: Extract<CanvasItem, { kind: 'graph' }>) {
  if (item.studio) {
    drawStudioGraph(context, item)
    return
  }
  const { mode, rows } = parseGraphDescriptor(item.expression)
  const pad = 46
  const plotW = Math.max(1, item.w - pad * 1.3)
  const plotH = Math.max(1, item.h - pad * 1.2)
  const xToPx = (x: number) => pad + ((x - item.xMin) / (item.xMax - item.xMin || 1)) * plotW
  const yToPx = (y: number) => pad / 2 + ((item.yMax - y) / (item.yMax - item.yMin || 1)) * plotH
  const step = Math.max(0.0001, item.gridStep)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, item.w, item.h)
  context.strokeStyle = '#e5e9ef'
  context.lineWidth = 1
  for (let x = Math.ceil(item.xMin / step) * step; x <= item.xMax + step * .1; x += step) {
    const px = xToPx(Number(x.toFixed(8)))
    context.beginPath(); context.moveTo(px, pad / 2); context.lineTo(px, pad / 2 + plotH); context.stroke()
  }
  for (let y = Math.ceil(item.yMin / step) * step; y <= item.yMax + step * .1; y += step) {
    const py = yToPx(Number(y.toFixed(8)))
    context.beginPath(); context.moveTo(pad, py); context.lineTo(pad + plotW, py); context.stroke()
  }
  context.strokeStyle = '#66707b'
  context.lineWidth = 1.4
  const axisX = Math.max(pad, Math.min(pad + plotW, xToPx(0)))
  const axisY = Math.max(pad / 2, Math.min(pad / 2 + plotH, yToPx(0)))
  context.beginPath(); context.moveTo(axisX, pad / 2); context.lineTo(axisX, pad / 2 + plotH); context.stroke()
  context.beginPath(); context.moveTo(pad, axisY); context.lineTo(pad + plotW, axisY); context.stroke()
  const colours = ['#2563eb', '#db2777', '#059669', '#7c3aed', '#ea580c', '#0891b2']
  const rowsToRender = mode === 'normal' || mode === 'piecewise' ? Math.max(1, rows.length) : 1
  context.save()
  context.beginPath()
  context.rect(pad, pad / 2, plotW, plotH)
  context.clip()
  for (let rowIndex = 0; rowIndex < rowsToRender; rowIndex++) {
    context.strokeStyle = colours[rowIndex % colours.length]
    context.lineWidth = 2.5
    context.lineCap = 'round'
    context.lineJoin = 'round'
    let drawing = false
    context.beginPath()
    const samples = 560
    for (let index = 0; index <= samples; index++) {
      const x = item.xMin + index / samples * (item.xMax - item.xMin)
      const t = mode === 'parametric' || mode === 'polar' ? -Math.PI * 2 + index / samples * Math.PI * 4 : x
      const point = evaluateGraph(mode, mode === 'normal' ? [rows[rowIndex] ?? { expression: '' }] : rows, x, t)
      if (!point || Math.abs(point.y) > 1e5 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        drawing = false
        continue
      }
      const px = xToPx(point.x), py = yToPx(point.y)
      if (px < -100 || px > item.w + 100 || py < -100 || py > item.h + 100) { drawing = false; continue }
      if (!drawing) { context.moveTo(px, py); drawing = true } else context.lineTo(px, py)
    }
    context.stroke()
  }
  context.restore()
  context.fillStyle = '#334155'
  context.font = '13px Segoe UI, Arial, sans-serif'
  context.fillText(mode === 'normal' ? rows.map((row) => row.expression).join(', ') : `${mode} · ${rows.map((row) => row.expression).join(' | ')}`, 12, 22)
  context.fillStyle = '#64748b'
  context.font = '11px Segoe UI, Arial, sans-serif'
  context.textAlign = 'right'; context.fillText(`x: ${item.xMin} to ${item.xMax}`, pad + plotW - 8, item.h - 10)
  context.textAlign = 'left'; context.fillText(`y: ${item.yMin} to ${item.yMax}`, 12, item.h - 10)
}

function drawRuler(context: CanvasRenderingContext2D, item: Extract<CanvasItem, { kind: 'line' | 'ruler' }>) {
  context.save()
  context.strokeStyle = item.color; context.fillStyle = item.color; context.lineWidth = 2
  context.beginPath(); context.moveTo(item.x, item.y); context.lineTo(item.x + item.w, item.y + item.h); context.stroke()
  const length = Math.hypot(item.w, item.h)
  const ux = item.w / (length || 1), uy = item.h / (length || 1)
  const nx = -uy, ny = ux
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    const x = item.x + item.w * t, y = item.y + item.h * t
    const mark = i % 5 === 0 ? 9 : 5
    context.beginPath(); context.moveTo(x - nx * mark, y - ny * mark); context.lineTo(x + nx * mark, y + ny * mark); context.stroke()
  }
  context.beginPath(); context.arc(item.x, item.y, 3, 0, Math.PI * 2); context.fill()
  context.beginPath(); context.arc(item.x + item.w, item.y + item.h, 3, 0, Math.PI * 2); context.fill()
  context.font = '13px Segoe UI, Arial, sans-serif'; context.textAlign = 'center'; context.fillText(`${length.toFixed(2)} u`, item.x + item.w / 2, item.y + item.h / 2 - 8)
  context.restore()
}

function drawProtractor(context: CanvasRenderingContext2D, item: Extract<CanvasItem, { kind: 'protractor' }>) {
  const bounds = itemBounds(item)
  const radius = Math.min(bounds.w, bounds.h) / 2
  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h
  context.save()
  context.fillStyle = 'rgba(37, 99, 235, .08)'; context.strokeStyle = item.color; context.lineWidth = 2
  context.beginPath(); context.arc(cx, cy, radius, Math.PI, 0); context.lineTo(bounds.x + bounds.w, cy); context.closePath(); context.fill(); context.stroke()
  context.font = '10px Segoe UI, Arial, sans-serif'; context.fillStyle = item.color; context.textAlign = 'center'
  for (let degrees = 0; degrees <= 180; degrees += 10) {
    const angle = Math.PI - degrees * Math.PI / 180
    const outerX = cx + radius * Math.cos(angle), outerY = cy - radius * Math.sin(angle)
    const innerRadius = degrees % 30 === 0 ? radius - 12 : radius - 7
    const innerX = cx + innerRadius * Math.cos(angle), innerY = cy - innerRadius * Math.sin(angle)
    context.beginPath(); context.moveTo(outerX, outerY); context.lineTo(innerX, innerY); context.stroke()
    if (degrees % 30 === 0) context.fillText(String(degrees), cx + (radius - 24) * Math.cos(angle), cy - (radius - 24) * Math.sin(angle) + 3)
  }
  context.restore()
}

function drawPhysicsItem(context: CanvasRenderingContext2D, item: Extract<CanvasItem, { kind: 'physics' }>, time = 0) {
  const studio = item.studio
  const bodies = item.playback === 'loop' && item.playing ? getSimulatedBodies(studio, time % PHYSICS_LOOP_SECONDS) : studio.bodies
  context.save()
  context.scale(item.w / PHYSICS_SCENE_WIDTH, item.h / PHYSICS_SCENE_HEIGHT)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, PHYSICS_SCENE_WIDTH, PHYSICS_SCENE_HEIGHT)
  context.strokeStyle = '#edf1f5'
  context.lineWidth = 1
  context.beginPath()
  for (let x = 0; x <= PHYSICS_SCENE_WIDTH; x += 40) { context.moveTo(x, 0); context.lineTo(x, PHYSICS_SCENE_HEIGHT) }
  for (let y = 0; y <= PHYSICS_SCENE_HEIGHT; y += 40) { context.moveTo(0, y); context.lineTo(PHYSICS_SCENE_WIDTH, y) }
  context.stroke()
  context.save()
  context.beginPath()
  context.rect(0, 0, PHYSICS_SCENE_WIDTH, PHYSICS_SCENE_HEIGHT)
  context.clip()
  for (const structure of studio.structures) {
    context.save()
    context.lineCap = 'round'
    context.strokeStyle = structure.type === 'string' ? '#64748b' : '#475569'
    context.lineWidth = structure.type === 'wall' ? 8 : structure.type === 'surface' ? 6 : 2
    if (structure.type === 'string') context.setLineDash([7, 5])
    context.beginPath()
    context.moveTo(structure.x1, structure.y1)
    context.lineTo(structure.x2, structure.y2)
    context.stroke()
    if (structure.type === 'surface') {
      const dx = structure.x2 - structure.x1, dy = structure.y2 - structure.y1
      const length = Math.max(1, Math.hypot(dx, dy))
      context.strokeStyle = '#cbd5e1'; context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(structure.x1 - dy / length * 8, structure.y1 + dx / length * 8)
      context.lineTo(structure.x2 - dy / length * 8, structure.y2 + dx / length * 8)
      context.stroke()
    }
    context.restore()
  }
  const forcesByBody = new Map(studio.bodies.map((body) => [body.id, getBodyForces(studio, body)]))
  const maxForce = Math.max(1, ...[...forcesByBody.values()].flat().map((force) => force.magnitude))
  const arrowScale = 48 / maxForce
  for (const body of bodies) {
    context.fillStyle = body.color
    context.strokeStyle = '#64748b'
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(body.x - body.radius, body.y - body.radius, body.radius * 2, body.radius * 2, 6)
    context.fill()
    context.stroke()
    context.fillStyle = '#334155'
    context.font = '600 12px Segoe UI, Arial, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(`${body.label} · ${body.mass} kg`, body.x, body.y, body.radius * 1.8)
    const forces = forcesByBody.get(body.id) ?? []
    for (const force of forces) {
      if (force.magnitude <= 0) continue
      const ux = force.x / force.magnitude, uy = force.y / force.magnitude
      const length = force.magnitude * arrowScale
      const endX = body.x + ux * length, endY = body.y + uy * length
      context.strokeStyle = force.color; context.fillStyle = force.color; context.lineWidth = 2.5
      context.beginPath(); context.moveTo(body.x, body.y); context.lineTo(endX, endY); context.stroke()
      context.beginPath(); context.moveTo(endX, endY); context.lineTo(endX - ux * 9 - uy * 5, endY - uy * 9 + ux * 5); context.lineTo(endX - ux * 9 + uy * 5, endY - uy * 9 - ux * 5); context.closePath(); context.fill()
      context.font = '600 11px Segoe UI, Arial, sans-serif'
      context.textAlign = ux > 0.35 ? 'left' : ux < -0.35 ? 'right' : 'center'
      context.fillText(`${force.label} ${Number(force.magnitude.toFixed(1))} N`, endX + ux * 7, endY + uy * 7)
    }
    if (studio.mode === 'static' && studio.autoBalanceForces !== false) {
      const net = getNetForce(studio, studio.bodies.find((candidate) => candidate.id === body.id) ?? body)
      const magnitude = Math.hypot(net.x, net.y)
      if (magnitude > 0.05) {
        const ux = -net.x / magnitude, uy = -net.y / magnitude
        const length = magnitude * arrowScale
        const endX = body.x + ux * length, endY = body.y + uy * length
        context.strokeStyle = '#16a34a'; context.fillStyle = '#16a34a'; context.setLineDash([5, 4])
        context.beginPath(); context.moveTo(body.x, body.y); context.lineTo(endX, endY); context.stroke(); context.setLineDash([])
        context.beginPath(); context.moveTo(endX, endY); context.lineTo(endX - ux * 9 - uy * 5, endY - uy * 9 + ux * 5); context.lineTo(endX - ux * 9 + uy * 5, endY - uy * 9 - ux * 5); context.closePath(); context.fill()
        context.font = '600 11px Segoe UI, Arial, sans-serif'; context.textAlign = ux > 0 ? 'left' : 'right'
        context.fillText(`Balance ${Number(magnitude.toFixed(1))} N`, endX + ux * 7, endY + uy * 7)
      }
    }
    if (studio.autoBalanceForces === false) {
      const speed = Math.hypot(body.vx, body.vy)
      if (speed > 0.01) {
        const length = Math.min(100, speed * 8)
        const ux = body.vx / speed, uy = -body.vy / speed
        const endX = body.x + ux * length, endY = body.y + uy * length
        context.strokeStyle = '#7c3aed'; context.fillStyle = '#7c3aed'; context.lineWidth = 2.5
        context.beginPath(); context.moveTo(body.x, body.y); context.lineTo(endX, endY); context.stroke()
        context.beginPath(); context.moveTo(endX, endY); context.lineTo(endX - ux * 9 - uy * 5, endY - uy * 9 + ux * 5); context.lineTo(endX - ux * 9 + uy * 5, endY - uy * 9 - ux * 5); context.closePath(); context.fill()
        context.font = '600 11px Segoe UI, Arial, sans-serif'
        context.textAlign = ux > 0.35 ? 'left' : ux < -0.35 ? 'right' : 'center'
        context.fillText(`Velocity ${Number(speed.toFixed(1))} m/s`, endX + ux * 7, endY + uy * 7)
      }
    }
  }
  context.restore()
  context.fillStyle = '#334155'
  context.font = '600 13px Segoe UI, Arial, sans-serif'
  context.textAlign = 'left'
  context.fillText(studio.mode === 'static' ? (studio.autoBalanceForces === false ? 'STATIC · VELOCITY VECTORS SHOWN' : 'STATIC · ΣF = 0 BALANCING FORCE SHOWN') : item.playing ? 'SIMULATION · PLAYING' : 'SIMULATION · PAUSED', 14, 22)
  context.restore()
}

function drawItem(context: CanvasRenderingContext2D, item: CanvasItem, images: Map<string, HTMLImageElement>, physicsTime = 0) {
  const bounds = itemBounds(item)
  if (item.kind === 'stroke') {
    if (!item.points.length) return
    context.save(); context.strokeStyle = item.color; context.fillStyle = item.color; context.lineWidth = item.size; context.lineCap = 'round'; context.lineJoin = 'round'
    if (item.points.length === 1) { context.beginPath(); context.arc(item.points[0].x, item.points[0].y, Math.max(0.35, item.size / 2), 0, Math.PI * 2); context.fill() }
    else { context.beginPath(); context.moveTo(item.points[0].x, item.points[0].y); for (let index = 1; index < item.points.length - 1; index++) { const current = item.points[index], next = item.points[index + 1]; context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2) } const last = item.points[item.points.length - 1]; context.lineTo(last.x, last.y); context.stroke() }
    context.restore(); return
  }
  if (item.kind === 'line') {
    context.save()
    context.strokeStyle = item.color
    context.fillStyle = item.color
    context.lineWidth = item.width ?? 2.5
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (item.style === 'dashed') context.setLineDash([8, 5])
    else if (item.style === 'dotted') context.setLineDash([1, 5])
    const sx = item.x, sy = item.y, ex = item.x + item.w, ey = item.y + item.h
    const angle = Math.atan2(ey - sy, ex - sx)
    const arrow = (x: number, y: number, rotation: number) => {
      const length = Math.max(9, (item.width ?? 2.5) * 4)
      context.beginPath(); context.moveTo(x, y)
      context.lineTo(x - length * Math.cos(rotation - Math.PI / 6), y - length * Math.sin(rotation - Math.PI / 6))
      context.lineTo(x - length * Math.cos(rotation + Math.PI / 6), y - length * Math.sin(rotation + Math.PI / 6))
      context.closePath(); context.fill()
    }
    context.beginPath(); context.moveTo(sx, sy); context.lineTo(ex, ey); context.stroke()
    context.setLineDash([])
    if (item.startArrow) arrow(sx, sy, angle + Math.PI)
    if (item.endArrow) arrow(ex, ey, angle)
    context.restore(); return
  }
  if (item.kind === 'ruler') { drawRuler(context, item); return }
  if (item.kind === 'shape') {
    const shape = item.shapeType ?? 'rectangle'
    const borderOn = item.borderOn ?? true
    // Older project files stored just `color` and `fill`. Keep their appearance,
    // while new shapes opt into fill explicitly.
    const fillOn = item.fillOn ?? Boolean(item.fill && item.fill !== 'transparent')
    const borderColor = item.borderColor ?? item.color ?? '#111827'
    const fillColor = item.fillColor ?? item.fill ?? '#ffffff'
    context.save()
    context.beginPath()
    const { x, y, w, h } = bounds
    if (shape === 'ellipse') context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    else if (shape === 'rounded-rectangle') {
      const radius = Math.min(16, w / 5, h / 5)
      if (typeof context.roundRect === 'function') context.roundRect(x, y, w, h, radius)
      else context.rect(x, y, w, h)
    } else if (shape === 'triangle') {
      context.moveTo(x + w / 2, y); context.lineTo(x + w, y + h); context.lineTo(x, y + h); context.closePath()
    } else if (shape === 'diamond') {
      context.moveTo(x + w / 2, y); context.lineTo(x + w, y + h / 2); context.lineTo(x + w / 2, y + h); context.lineTo(x, y + h / 2); context.closePath()
    } else if (shape === 'parallelogram') {
      const skew = w * .22; context.moveTo(x + skew, y); context.lineTo(x + w, y); context.lineTo(x + w - skew, y + h); context.lineTo(x, y + h); context.closePath()
    } else if (shape === 'pentagon' || shape === 'hexagon' || shape === 'star') {
      const count = shape === 'pentagon' ? 5 : shape === 'hexagon' ? 6 : 10
      for (let index = 0; index < count; index++) {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / count
        const radius = shape === 'star' && index % 2 === 1 ? .24 : .48
        const px = x + w / 2 + Math.cos(angle) * w * radius
        const py = y + h / 2 + Math.sin(angle) * h * radius
        if (!index) context.moveTo(px, py); else context.lineTo(px, py)
      }
      context.closePath()
    } else if (shape === 'arrow') {
      const head = Math.min(w * .35, h * .55)
      context.moveTo(x, y + h * .25); context.lineTo(x + w - head, y + h * .25); context.lineTo(x + w - head, y); context.lineTo(x + w, y + h / 2); context.lineTo(x + w - head, y + h); context.lineTo(x + w - head, y + h * .75); context.lineTo(x, y + h * .75); context.closePath()
    } else context.rect(x, y, w, h)
    if (fillOn) { context.fillStyle = fillColor; context.fill() }
    if (borderOn) { context.strokeStyle = borderColor; context.lineWidth = item.borderWidth ?? 2; context.lineJoin = 'round'; context.stroke() }
    context.restore(); return
  }
  if (item.kind === 'text') {
    context.save(); context.font = `${item.fontSize}px Segoe UI, Arial, sans-serif`; context.textBaseline = 'top'
    if (item.fillEnabled) { context.fillStyle = item.fillColor ?? '#ffffff'; context.fillRect(item.x, item.y, Math.max(1, item.w), Math.max(item.fontSize * 1.5, item.h)) }
    context.fillStyle = item.textColor ?? '#1f2937'
    if (item.text.length) item.text.split('\n').forEach((line, index) => context.fillText(line, item.x, item.y + index * (item.fontSize * 1.35)))
    context.restore(); return
  }
  if (item.kind === 'equation') {
    context.save(); context.fillStyle = '#fff'; context.strokeStyle = '#d7dce4'; context.lineWidth = 1; context.roundRect?.(item.x, item.y, item.w, item.h, 10); context.fill(); context.stroke(); context.fillStyle = '#111827'; context.font = `${item.fontSize}px Cambria Math, STIX Two Math, serif`; context.textBaseline = 'middle'; context.fillText(item.latex || ' ', item.x + 14, item.y + item.h / 2); context.restore(); return
  }
  if (item.kind === 'graph') { context.save(); context.translate(item.x, item.y); drawGraph(context, item); context.restore(); return }
  if (item.kind === 'physics') { context.save(); context.translate(item.x, item.y); drawPhysicsItem(context, item, physicsTime); context.restore(); return }
  if (item.kind === 'table') {
    context.save(); context.fillStyle = '#fff'; context.fillRect(item.x, item.y, item.w, item.h); context.strokeStyle = '#ccd3dc'; context.lineWidth = 1
    const cellW = item.w / item.cols, cellH = item.h / item.rows
    for (let row = 0; row <= item.rows; row++) { context.beginPath(); context.moveTo(item.x, item.y + row * cellH); context.lineTo(item.x + item.w, item.y + row * cellH); context.stroke() }
    for (let col = 0; col <= item.cols; col++) { context.beginPath(); context.moveTo(item.x + col * cellW, item.y); context.lineTo(item.x + col * cellW, item.y + item.h); context.stroke() }
    context.font = '14px Segoe UI, Arial, sans-serif'; context.fillStyle = '#1f2937'; context.textBaseline = 'middle'
    item.cells.forEach((cell, index) => { const col = index % item.cols, row = Math.floor(index / item.cols); if (item.header && row === 0) { context.fillStyle = '#f2f5f8'; context.fillRect(item.x + col * cellW + 1, item.y + 1, cellW - 2, cellH - 2); context.fillStyle = '#1f2937' } context.fillText(cell, item.x + col * cellW + 7, item.y + row * cellH + cellH / 2) })
    context.restore(); return
  }
  if (item.kind === 'page') {
    const image = images.get(item.id)
    context.save(); context.fillStyle = '#fff'; context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h)
    if (image) context.drawImage(image, bounds.x, bounds.y, bounds.w, bounds.h)
    else { context.strokeStyle = '#cbd5e1'; context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h); context.fillStyle = '#64748b'; context.font = '13px Segoe UI, Arial, sans-serif'; context.fillText('Loading imported page…', bounds.x + 16, bounds.y + 24) }
    if (item.erasures?.length) {
      // PDF pages are rasterized images, so the eraser restores the paper white
      // underneath each persisted stroke. The mask is page-local and moves/scales
      // with the page as a regular editable object.
      context.save(); context.beginPath(); context.rect(bounds.x, bounds.y, bounds.w, bounds.h); context.clip()
      context.strokeStyle = '#ffffff'; context.fillStyle = '#ffffff'; context.lineCap = 'round'; context.lineJoin = 'round'
      for (const erasure of item.erasures) {
        if (!erasure.points.length) continue
        context.lineWidth = Math.max(1, erasure.size * bounds.w)
        if (erasure.points.length === 1) {
          const point = erasure.points[0]; context.beginPath(); context.arc(bounds.x + point.x * bounds.w, bounds.y + point.y * bounds.h, context.lineWidth / 2, 0, Math.PI * 2); context.fill()
        } else {
          context.beginPath(); context.moveTo(bounds.x + erasure.points[0].x * bounds.w, bounds.y + erasure.points[0].y * bounds.h)
          for (let index = 1; index < erasure.points.length; index++) context.lineTo(bounds.x + erasure.points[index].x * bounds.w, bounds.y + erasure.points[index].y * bounds.h)
          context.stroke()
        }
      }
      context.restore()
    }
    context.restore(); return
  }
  if (item.kind === 'protractor') { drawProtractor(context, item); return }
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number, viewport: CanvasViewport, gridSize: number, gridVisible: boolean) {
  context.fillStyle = '#f8fafc'; context.fillRect(0, 0, width, height)
  if (!gridVisible) return
  const step = Math.max(4, gridSize * viewport.zoom)
  context.strokeStyle = 'rgba(148,163,184,.19)'; context.lineWidth = 1
  const offsetX = ((viewport.x % step) + step) % step
  const offsetY = ((viewport.y % step) + step) % step
  for (let x = offsetX; x < width; x += step) { context.beginPath(); context.moveTo(Math.round(x) + .5, 0); context.lineTo(Math.round(x) + .5, height); context.stroke() }
  for (let y = offsetY; y < height; y += step) { context.beginPath(); context.moveTo(0, Math.round(y) + .5); context.lineTo(width, Math.round(y) + .5); context.stroke() }
}

function cloneItem(item: CanvasItem): CanvasItem { return JSON.parse(JSON.stringify(item)) as CanvasItem }
function isRasterPdfPage(item: CanvasItem): item is Extract<CanvasItem, { kind: 'page' }> { return item.kind === 'page' && /\.pdf(?:\s|$)/i.test(item.title) }

function isEditableKind(item: CanvasItem) { return item.kind === 'text' || item.kind === 'equation' || item.kind === 'table' || item.kind === 'physics' }

function OverlayEditor({ item, onChange, onFinish }: { item: CanvasItem; onChange: (item: CanvasItem) => void; onFinish: () => void }) {
  const bounds = itemBounds(item)
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (item.kind !== 'text') return
    const input = textInputRef.current
    if (input) {
      input.focus({ preventScroll: true })
      const end = input.value.length
      input.setSelectionRange(end, end)
    }
  }, [item.id, item.kind])
  if (item.kind === 'text') {
    const lines = item.text.split('\n')
    const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0)
    const lineHeight = item.fontSize * 1.35
    const paddingX = item.fontSize * .4
    const paddingY = item.fontSize * .35
    const inputWidth = Math.max(80, Math.min(1600, Math.max(40, longestLine * item.fontSize * .62 + paddingX * 2)))
    const inputHeight = Math.max(24, item.fontSize * 1.5, lines.length * lineHeight + paddingY * 2)
    return <textarea ref={textInputRef} autoFocus className="canvas-editor text-editor" aria-label="Text box editor" placeholder="" value={item.text} rows={Math.max(1, lines.length || 1)} style={{ left: bounds.x, top: bounds.y, width: inputWidth, height: inputHeight, padding: `${paddingY}px ${paddingX}px`, resize: 'none', overflow: 'hidden', boxSizing: 'border-box', lineHeight: `${lineHeight}px`, whiteSpace: 'pre-wrap', fontSize: item.fontSize, fontFamily: 'Segoe UI, Arial, sans-serif', color: item.textColor ?? '#1f2937', caretColor: item.textColor ?? '#1f2937', background: item.fillEnabled ? (item.fillColor ?? '#ffffff') : 'transparent', pointerEvents: 'auto' }} onChange={(event) => { const text = event.target.value; const nextLines = text.split('\n'); const nextLongestLine = nextLines.reduce((longest, line) => Math.max(longest, line.length), 0); const nextWidth = Math.max(80, Math.min(1600, Math.max(40, nextLongestLine * item.fontSize * .62 + paddingX * 2))); const nextHeight = Math.max(24, item.fontSize * 1.5, nextLines.length * lineHeight + paddingY * 2); onChange({ ...item, text, w: nextWidth, h: nextHeight }) }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onFinish(); return } if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onFinish(); return } }} onBlur={onFinish} onPointerDown={(event) => event.stopPropagation()} />
  }
  if (item.kind === 'equation') {
    return React.createElement('math-field', {
      autoFocus: true,
      className: 'canvas-editor equation-editor',
      ref: (node: HTMLElement & { value: string } | null) => { if (node && node.value !== item.latex) node.value = item.latex },
      style: { left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h, fontSize: `${item.fontSize}px`, pointerEvents: 'auto' },
      virtualKeyboardMode: 'manual',
      onInput: (event: Event) => onChange({ ...item, latex: String((event.target as HTMLElement & { value: string }).value ?? '') }),
      onBlur: onFinish,
      onPointerDown: (event: PointerEvent) => event.stopPropagation(),
    })
  }
  const table = item as Extract<CanvasItem, { kind: 'table' }>
  return <div className="canvas-editor table-editor" style={{ left: bounds.x, top: bounds.y, width: bounds.w, height: bounds.h, pointerEvents: 'auto' }} onPointerDown={(event) => event.stopPropagation()}>
    <table><tbody>{Array.from({ length: table.rows }).map((_, row) => <tr key={row}>{Array.from({ length: table.cols }).map((_, col) => { const index = row * table.cols + col; return <td key={col}><input autoFocus={row === 0 && col === 0} value={table.cells[index] ?? ''} onChange={(event) => { const cells = [...table.cells]; cells[index] = event.target.value; onChange({ ...table, cells }) }} /></td> })}</tr>)}</tbody></table>
    <button className="editor-close" onClick={onFinish}>Done</button>
  </div>
}

type Interaction =
  | { mode: 'pan'; pointerId: number; startScreen: Point; startViewport: CanvasViewport }
  | { mode: 'draw'; pointerId: number; points: Point[]; source?: 'pointer' | 'hotkey' }
  | { mode: 'marquee'; pointerId: number; start: Point; current: Point; additive: boolean }
  | { mode: 'create'; pointerId: number; tool: 'line' | 'shape' | 'ruler' | 'protractor'; start: Point; current: Point; constrain: boolean }
  | { mode: 'drag'; pointerId: number; id: string; ids: string[]; start: Point; current: Point }
  | { mode: 'resize'; pointerId: number; ids: string[]; start: Point; startBounds: { x: number; y: number; w: number; h: number }; current: Point; constrain: boolean }
  | { mode: 'erase'; pointerId: number; erased: Set<string>; pageErase?: { id: string; points: Point[]; size: number } }

export type NativeCanvasProps = {
  items: CanvasItem[]
  selectedId?: string
  tool: CanvasTool
  gridSize: number
  gridVisible: boolean
  viewport: CanvasViewport
  brushSize: number
  brushColor: string
  textSize: number
  shapeOptions: ShapeOptions
  textOptions: TextOptions
  lineOptions: LineOptions
  selectedIds?: string[]
  remoteCursors?: RemoteCursor[]
  onItemsChange: (items: CanvasItem[]) => void
  onSelectionChange: (id?: string) => void
  onMultiSelectionChange?: (ids: string[]) => void
  onViewportChange: (viewport: CanvasViewport) => void
  onHoldDrawingChange?: (holding: boolean) => void
  onPointerWorldMove?: (point: Point) => void
  onPointerWorldLeave?: () => void
  onMarqueePresenceChange?: (bounds: CanvasRect | null) => void
  onOpenGraph?: (item: Extract<CanvasItem, { kind: 'graph' }>) => void
  onOpenPhysics?: (item: Extract<CanvasItem, { kind: 'physics' }>) => void
  onTogglePhysicsPlayback?: (id: string) => void
  drawHotkey?: string
}

export const NativeCanvas = forwardRef<NativeCanvasHandle, NativeCanvasProps>(function NativeCanvas({ items, selectedId, tool, gridSize, gridVisible, viewport, brushSize, brushColor, textSize, shapeOptions, textOptions, lineOptions, selectedIds = selectedId ? [selectedId] : [], remoteCursors = [], onItemsChange, onSelectionChange, onMultiSelectionChange, onViewportChange, onHoldDrawingChange, onPointerWorldMove, onPointerWorldLeave, onMarqueePresenceChange, onOpenGraph, onOpenPhysics, onTogglePhysicsPlayback, drawHotkey = 'd' }, ref) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef(items)
  const viewportRef = useRef(viewport)
  const interactionRef = useRef<Interaction | null>(null)
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const [editingId, setEditingId] = useState<string>()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const lastMarqueePresenceRef = useRef<CanvasRect | null>(null)
  const [imagesVersion, setImagesVersion] = useState(0)
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map())
  const renderFrame = useRef<number | null>(null)
  const physicsClocks = useRef(new Map<string, { time: number; lastFrame: number }>())
  const toolRef = useRef(tool)
  const heldDrawRef = useRef(false)
  const heldPanRef = useRef(false)
  const lastPointerScreenRef = useRef<Point | null>(null)
  const [graphHover, setGraphHover] = useState<{ x: number; y: number; label: string; color: string }>()
  const pointerInsideRef = useRef(false)
  const [holdingPan, setHoldingPan] = useState(false)
  useEffect(() => { toolRef.current = tool }, [tool])

  useLayoutEffect(() => { itemsRef.current = items }, [items])
  useLayoutEffect(() => { viewportRef.current = viewport }, [viewport])

  useEffect(() => {
    let disposed = false
    const missing = items.filter((item) => item.kind === 'page' && item.src && !imageCache.current.has(item.id)) as Array<Extract<CanvasItem, { kind: 'page' }>>
    if (!missing.length) return
    Promise.allSettled(missing.map((item) => new Promise<void>((resolve) => {
      const image = new Image()
      image.onload = () => { imageCache.current.set(item.id, image); resolve() }
      image.onerror = () => resolve()
      image.src = item.src
    }))).then(() => { if (!disposed) setImagesVersion((version) => version + 1) })
    return () => { disposed = true }
  }, [items])

  const getDpr = () => Math.min(2, window.devicePixelRatio || 1)
  const drawScene = () => {
    const surface = surfaceRef.current
    const canvas = canvasRef.current
    if (!surface || !canvas) return

    const rect = surface.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }

    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return

    const rawView = viewportRef.current ?? defaultViewport
    const safeView: CanvasViewport = {
      x: Number.isFinite(rawView.x) ? rawView.x : 0,
      y: Number.isFinite(rawView.y) ? rawView.y : 0,
      zoom: Number.isFinite(rawView.zoom) && rawView.zoom > 0 ? rawView.zoom : 1,
    }

    try {
      // Always clear in physical-pixel space first. This prevents a stale transform
      // from leaving the old frame visible or clearing the wrong area.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)

      // Draw the screen background in CSS pixels.
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawBackground(context, width, height, safeView, gridSize, gridVisible)

      // All document objects live in world coordinates.
      context.setTransform(dpr * safeView.zoom, 0, 0, dpr * safeView.zoom, dpr * safeView.x, dpr * safeView.y)
      const active = interactionRef.current
      const workingItems = itemsRef.current.filter((item) => item.kind !== 'equation' && !(active?.mode === 'erase' && active.erased.has(item.id)) && !(editingId && item.id === editingId && item.kind === 'text')).slice()
      if (active?.mode === 'erase' && active.pageErase) {
        const index = workingItems.findIndex((item) => item.id === active.pageErase!.id && item.kind === 'page')
        if (index >= 0) {
          const page = workingItems[index] as Extract<CanvasItem, { kind: 'page' }>
          workingItems[index] = { ...page, erasures: [...(page.erasures ?? []), { points: active.pageErase.points, size: active.pageErase.size }] }
        }
      }
      if (active?.mode === 'draw') workingItems.push({ id: '__draft__', kind: 'stroke', ...makeBounds(active.points), points: active.points, color: brushColor, size: brushSize } as CanvasItem)
      if (active?.mode === 'create') {
        const bounds = active.tool === 'shape' && active.constrain
          ? constrainedRect(active.start, active.current, shapeAspectRatio(shapeOptions.shapeType))
          : normalizeRect(active.start, active.current)
        if (active.tool === 'line' || active.tool === 'ruler') workingItems.push({ id: '__draft__', kind: active.tool, x: active.start.x, y: active.start.y, w: active.current.x - active.start.x, h: active.current.y - active.start.y, ...(active.tool === 'line' ? lineOptions : {}), color: active.tool === 'ruler' ? '#2563eb' : lineOptions.color } as CanvasItem)
        if (active.tool === 'shape') workingItems.push({ id: '__draft__', kind: 'shape', ...bounds, color: shapeOptions.borderColor, fill: shapeOptions.fillOn ? shapeOptions.fillColor : 'transparent', ...shapeOptions } as CanvasItem)
        if (active.tool === 'protractor') workingItems.push({ id: '__draft__', kind: 'protractor', ...bounds, color: '#2563eb' } as CanvasItem)
      }
      if (active?.mode === 'drag') {
        const moveIds = new Set(active.ids)
        for (let index = 0; index < workingItems.length; index++) {
          const current = workingItems[index]
          if (moveIds.has(current.id)) workingItems[index] = translateItem(current, active.current.x - active.start.x, active.current.y - active.start.y)
        }
      } else if (active?.mode === 'resize') {
        const targetBounds = active.constrain
          ? constrainedRect(active.startBounds, active.current, active.startBounds.w / active.startBounds.h)
          : normalizeRect(active.startBounds, active.current)
        for (let index = 0; index < workingItems.length; index++) {
          const current = workingItems[index]
          if (active.ids.includes(current.id)) workingItems[index] = resizeItem(current, active.startBounds, targetBounds)
        }
      }

      if (active?.mode === 'marquee') {
        const bounds = normalizeRect(active.start, active.current)
        context.save(); context.fillStyle = 'rgba(37,99,235,.06)'; context.strokeStyle = '#2563eb'; context.lineWidth = 1 / safeView.zoom; context.setLineDash([5 / safeView.zoom, 4 / safeView.zoom]); context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h); context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h); context.restore()
      }

      let renderFaults = 0
      const frameTime = performance.now()
      let hasPlayingPhysics = false
      for (const item of workingItems) {
        try {
          if (item.kind === 'physics') {
            const clock = physicsClocks.current.get(item.id) ?? { time: 0, lastFrame: frameTime }
            if (item.playback === 'loop' && item.playing) {
              clock.time = (clock.time + Math.min(0.04, Math.max(0, (frameTime - clock.lastFrame) / 1000))) % PHYSICS_LOOP_SECONDS
              hasPlayingPhysics = true
            }
            clock.lastFrame = frameTime
            physicsClocks.current.set(item.id, clock)
            drawItem(context, item, imageCache.current, clock.time)
          } else drawItem(context, item, imageCache.current)
        } catch {
          renderFaults += 1
          try {
            const bounds = itemBounds(item)
            context.save()
            context.strokeStyle = 'rgba(220,38,38,.65)'
            context.fillStyle = 'rgba(220,38,38,.06)'
            context.lineWidth = 1 / safeView.zoom
            context.setLineDash([4 / safeView.zoom, 4 / safeView.zoom])
            context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h)
            context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
            context.restore()
          } catch {
            // Ignore one bad item and keep rendering the rest.
          }
        }
      }

      if (selectedIds.length > 1) {
        const activeMove = interactionRef.current
        context.save(); context.strokeStyle = '#2563eb'; context.lineWidth = 1 / safeView.zoom; context.setLineDash([5 / safeView.zoom, 3 / safeView.zoom])
        for (const selected of workingItems.filter((item) => selectedIds.includes(item.id))) {
          const b = itemBounds(selected); context.strokeRect(b.x - 2 / safeView.zoom, b.y - 2 / safeView.zoom, b.w + 4 / safeView.zoom, b.h + 4 / safeView.zoom)
        }
        context.restore()
      }

      if (renderFaults) surface.dataset.renderFaults = String(renderFaults)
      else delete surface.dataset.renderFaults
      delete surface.dataset.renderError
      if (hasPlayingPhysics) requestRender()
    } catch (error) {
      // A renderer failure must never turn into a featureless grey editor.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.fillStyle = '#f8fafc'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.fillStyle = '#64748b'
      context.font = '12px Segoe UI, Arial, sans-serif'
      context.fillText('Canvas renderer error. Check the browser console.', 14, 24)
      surface.dataset.renderError = error instanceof Error ? error.message : 'Unknown renderer error'
    }
  }
  const requestRender = () => {
    if (renderFrame.current !== null) return
    renderFrame.current = requestAnimationFrame(() => {
      renderFrame.current = null
      drawScene()
    })
  }

  // Paint immediately after layout changes. The animation frame is still used
  // for high-frequency pointer updates, but static document changes no longer
  // depend on a delayed frame.
  useLayoutEffect(() => { drawScene() }, [items, viewport, gridSize, gridVisible, brushSize, brushColor, shapeOptions, textOptions, lineOptions, selectedId, selectedIds, editingId, imagesVersion])
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const observer = new ResizeObserver(() => requestRender())
    observer.observe(surface)
    requestRender()
    return () => observer.disconnect()
  }, [])

  const worldPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = surfaceRef.current!.getBoundingClientRect()
    const view = viewportRef.current
    const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1
    return { x: (event.clientX - rect.left - (Number.isFinite(view.x) ? view.x : 0)) / zoom, y: (event.clientY - rect.top - (Number.isFinite(view.y) ? view.y : 0)) / zoom }
  }
  const updateGraphHover = (point: Point | null) => {
    if (!point) { setGraphHover(undefined); return }
    const view = viewportRef.current
    const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1
    const item = [...itemsRef.current].reverse().find((candidate): candidate is Extract<CanvasItem, { kind: 'graph' }> => candidate.kind === 'graph' && Boolean(candidate.studio) && point.x >= candidate.x && point.x <= candidate.x + candidate.w && point.y >= candidate.y && point.y <= candidate.y + candidate.h)
    if (!item?.studio) { setGraphHover(undefined); return }
    const scale = Math.max(0.02, item.studio.scale) * Math.min(item.w / 560, item.h / 400)
    const x = item.studio.centerX + (point.x - item.x - item.w / 2) / scale
    const cursorY = item.studio.centerY - (point.y - item.y - item.h / 2) / scale
    const nearest = evaluateGraphDocument(item.studio).curves.filter((curve) => curve.row.visible)
      .map((curve) => ({ curve, y: curve.evaluate(x) }))
      .filter((entry): entry is { curve: ReturnType<typeof evaluateGraphDocument>['curves'][number]; y: number } => entry.y !== null && Math.abs(entry.y - cursorY) * scale * zoom < 26)
      .sort((a, b) => Math.abs(a.y - cursorY) - Math.abs(b.y - cursorY))[0]
    if (!nearest) { setGraphHover(undefined); return }
    const graphX = item.x + item.w / 2 + (x - item.studio.centerX) * scale
    const graphY = item.y + item.h / 2 - (nearest.y - item.studio.centerY) * scale
    setGraphHover({
      x: graphX * zoom + view.x + 10,
      y: graphY * zoom + view.y - 10,
      label: `${nearest.curve.label}: (${Number(x.toPrecision(5))}, ${Number(nearest.y.toPrecision(5))})`,
      color: nearest.curve.row.color,
    })
  }
  const worldPointFromScreen = (screen: Point): Point => worldPoint({ clientX: screen.x, clientY: screen.y })
  const snapped = (point: Point) => {
    if (!gridVisible) return point
    const step = Math.max(1, gridSize)
    return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step }
  }
  const setActiveInteraction = (next: Interaction | null) => {
    interactionRef.current = next
    setInteraction(next)
    const marquee = next?.mode === 'marquee' ? normalizeRect(next.start, next.current) : null
    const previous = lastMarqueePresenceRef.current
    if (marquee?.x !== previous?.x || marquee?.y !== previous?.y || marquee?.w !== previous?.w || marquee?.h !== previous?.h) {
      lastMarqueePresenceRef.current = marquee
      onMarqueePresenceChange?.(marquee)
    }
    if (next?.mode === 'draw' || next?.mode === 'create' || next?.mode === 'marquee' || next?.mode === 'erase' || next?.mode === 'resize') drawScene()
    else requestRender()
  }

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.canvas-editor, .canvas-context-menu')) return
    event.preventDefault()
    const surface = surfaceRef.current
    if (!surface) return
    const rect = surface.getBoundingClientRect()
    const point = worldPoint(event)
    const hit = [...itemsRef.current].reverse().find((item) => pointInItem(point, item, Math.max(8, 10 / viewportRef.current.zoom)))
    if (!hit) { setContextMenu(null); return }

    const currentIds = [...new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])]
    const ids = currentIds.includes(hit.id) ? currentIds : [hit.id]
    if (!currentIds.includes(hit.id)) {
      onSelectionChange(hit.id)
      onMultiSelectionChange?.([hit.id])
    }
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 208)),
      y: Math.max(8, Math.min(event.clientY - rect.top, rect.height - 224)),
      ids,
    })
  }

  const runContextAction = (action: 'edit' | 'duplicate' | 'delete' | 'lock' | 'front' | 'back') => {
    if (!contextMenu) return
    const chosen = itemsRef.current.filter((item) => contextMenu.ids.includes(item.id))
    const editable = chosen.length === 1 && !chosen[0].locked && isEditableKind(chosen[0])
    const unlocked = chosen.filter((item) => !item.locked)
    if (action === 'edit' && editable) {
      if (chosen[0].kind === 'physics') onOpenPhysics?.(chosen[0])
      else setEditingId(chosen[0].id)
    }
    if (action === 'duplicate' && unlocked.length) {
      const duplicates = unlocked.map((item) => ({ ...translateItem(item, 16, 16), id: makeItemId() }))
      onItemsChange([...itemsRef.current, ...duplicates])
      onSelectionChange(duplicates.at(-1)?.id)
      onMultiSelectionChange?.(duplicates.map((item) => item.id))
    }
    if (action === 'delete' && unlocked.length) {
      const removed = new Set(unlocked.map((item) => item.id))
      onItemsChange(itemsRef.current.filter((item) => !removed.has(item.id)))
      const remaining = chosen.filter((item) => item.locked).map((item) => item.id)
      onSelectionChange(remaining.at(-1))
      onMultiSelectionChange?.(remaining)
    }
    if (action === 'lock' && chosen.length) {
      const ids = new Set(chosen.map((item) => item.id))
      const locked = !chosen.every((item) => item.locked)
      onItemsChange(itemsRef.current.map((item) => ids.has(item.id) ? { ...item, locked } : item))
    }
    if (action === 'front' || action === 'back') {
      const ids = new Set(chosen.map((item) => item.id))
      const moving = itemsRef.current.filter((item) => ids.has(item.id))
      const rest = itemsRef.current.filter((item) => !ids.has(item.id))
      onItemsChange(action === 'front' ? [...rest, ...moving] : [...moving, ...rest])
    }
    setContextMenu(null)
  }

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (event.composedPath().includes(contextMenuRef.current as EventTarget)) return
      setContextMenu(null)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('keydown', keydown)
    }
  }, [contextMenu])

  useEffect(() => {
    const updateConstraint = (constrain: boolean) => {
      const active = interactionRef.current
      if ((active?.mode === 'create' && active.tool === 'shape' || active?.mode === 'resize') && active.constrain !== constrain) {
        setActiveInteraction({ ...active, constrain })
      }
    }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Shift') updateConstraint(true) }
    const keyup = (event: KeyboardEvent) => { if (event.key === 'Shift') updateConstraint(false) }
    const blur = () => updateConstraint(false)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const eraseAt = (point: Point, erased: Set<string>) => {
    const hit = itemAtPoint(point, itemsRef.current, Math.max(8, 12 / viewportRef.current.zoom))
    if (!hit || hit.locked || erased.has(hit.id)) return erased
    const next = new Set(erased); next.add(hit.id); return next
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    const screen = { x: event.clientX, y: event.clientY }
    lastPointerScreenRef.current = screen
    pointerInsideRef.current = true
    const world = worldPoint(event)
    const activeTool = heldPanRef.current ? 'pan' : heldDrawRef.current ? 'draw' : toolRef.current
    const point = activeTool === 'draw' || activeTool === 'text' ? world : snapped(world)
    if (event.button === 1 || activeTool === 'pan') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setActiveInteraction({ mode: 'pan', pointerId: event.pointerId, startScreen: screen, startViewport: viewportRef.current })
      return
    }
    if (activeTool === 'select') {
      const hit = itemAtPoint(world, itemsRef.current, Math.max(8, 10 / viewportRef.current.zoom))
      const additive = event.shiftKey || event.ctrlKey || event.metaKey
      if (hit && !hit.locked && additive) {
        // Shift/Ctrl/Cmd-click toggles an object in the current selection without
        // starting a drag. This makes picking scattered objects reliable and
        // avoids accidentally moving the existing group while adding to it.
        const currentIds = [...new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : [])]
          .filter((id) => itemsRef.current.some((candidate) => candidate.id === id && !candidate.locked))
        const nextIds = currentIds.includes(hit.id)
          ? currentIds.filter((id) => id !== hit.id)
          : [...currentIds, hit.id]
        const primary = nextIds.at(-1)
        onSelectionChange(primary)
        onMultiSelectionChange?.(nextIds)
        setActiveInteraction(null)
        event.preventDefault()
        return
      }
      if (hit && !hit.locked) {
        const alreadySelected = selectedIds.includes(hit.id) || selectedId === hit.id
        const dragIds = alreadySelected ? [...new Set([...selectedIds, ...(selectedId ? [selectedId] : [])])].filter((id) => itemsRef.current.some((candidate) => candidate.id === id && !candidate.locked)) : [hit.id]
        onSelectionChange(hit.id)
        if (!alreadySelected) onMultiSelectionChange?.([hit.id])
        event.currentTarget.setPointerCapture(event.pointerId)
        if (event.detail >= 2 && isEditableKind(hit) && dragIds.length === 1) setEditingId(hit.id)
        setActiveInteraction({ mode: 'drag', pointerId: event.pointerId, id: hit.id, ids: dragIds.length ? dragIds : [hit.id], start: world, current: world })
      } else {
        if (!additive) { onSelectionChange(undefined); onMultiSelectionChange?.([]) }
        event.currentTarget.setPointerCapture(event.pointerId)
        setActiveInteraction({ mode: 'marquee', pointerId: event.pointerId, start: world, current: world, additive })
      }
      return
    }
    if (activeTool === 'eraser') {
      event.currentTarget.setPointerCapture(event.pointerId)
      const target = itemAtPoint(world, itemsRef.current, Math.max(8, 12 / viewportRef.current.zoom))
      if (target && isRasterPdfPage(target)) {
        const size = Math.max(8 / viewportRef.current.zoom, brushSize * 2) / Math.max(1, target.w)
        const local = { x: (world.x - target.x) / target.w, y: (world.y - target.y) / target.h }
        setActiveInteraction({ mode: 'erase', pointerId: event.pointerId, erased: new Set(), pageErase: { id: target.id, points: [local], size } })
      } else setActiveInteraction({ mode: 'erase', pointerId: event.pointerId, erased: eraseAt(world, new Set()) })
      return
    }
    if (activeTool === 'text') {
      event.preventDefault()
      const item: CanvasItem = { id: makeItemId(), kind: 'text', x: point.x, y: point.y, w: 120, h: Math.max(24, textSize * 1.5), text: '', fontSize: textSize, ...textOptions }
      onItemsChange([...itemsRef.current, item]); onSelectionChange(item.id); setEditingId(item.id); return
    }
    if (activeTool === 'draw') { event.currentTarget.setPointerCapture(event.pointerId); setActiveInteraction({ mode: 'draw', pointerId: event.pointerId, points: [point], source: 'pointer' }); return }
    if (activeTool === 'line' || activeTool === 'shape' || activeTool === 'ruler' || activeTool === 'protractor') { event.currentTarget.setPointerCapture(event.pointerId); setActiveInteraction({ mode: 'create', pointerId: event.pointerId, tool: activeTool, start: point, current: point, constrain: event.shiftKey }) }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const screen = { x: event.clientX, y: event.clientY }
    lastPointerScreenRef.current = screen
    pointerInsideRef.current = true
    const currentWorldPoint = worldPoint(event)
    onPointerWorldMove?.(currentWorldPoint)
    updateGraphHover(currentWorldPoint)

    const active = interactionRef.current
    // Holding D is a genuine drawing input, even when no mouse button is down.
    if (heldDrawRef.current && !heldPanRef.current && (!active || active.mode !== 'draw')) {
      setActiveInteraction({ mode: 'draw', pointerId: -1, source: 'hotkey', points: [worldPoint(event)] })
      return
    }
    if (!active) return

    if (active.mode === 'draw' && active.source === 'hotkey') {
      const points = [...active.points]
      const samples = typeof event.nativeEvent.getCoalescedEvents === 'function' ? event.nativeEvent.getCoalescedEvents() : []
      const coalesced = samples.length ? samples : [event.nativeEvent]
      for (const sample of coalesced) {
        const p = worldPoint(sample)
        const previous = points[points.length - 1]
        if (!previous || Math.hypot(p.x - previous.x, p.y - previous.y) >= Math.max(.2, .65 / viewportRef.current.zoom)) points.push(p)
      }
      if (points.length !== active.points.length) setActiveInteraction({ ...active, points })
      return
    }

    if (active.pointerId !== event.pointerId) return
    if (active.mode === 'pan') {
      const next = { ...active.startViewport, x: active.startViewport.x + event.clientX - active.startScreen.x, y: active.startViewport.y + event.clientY - active.startScreen.y }
      onViewportChange(next); requestRender(); return
    }
    const point = active.mode === 'drag' || active.mode === 'marquee' || active.mode === 'erase' ? worldPoint(event) : snapped(worldPoint(event))
    if (active.mode === 'marquee') { setActiveInteraction({ ...active, current: point }); return }
    if (active.mode === 'draw') {
      const points = [...active.points]
      const samples = typeof event.nativeEvent.getCoalescedEvents === 'function' ? event.nativeEvent.getCoalescedEvents() : []
      const coalesced = samples.length ? samples : [event.nativeEvent]
      for (const sample of coalesced) {
        const p = worldPoint(sample)
        const previous = points[points.length - 1]
        if (!previous || Math.hypot(p.x - previous.x, p.y - previous.y) >= Math.max(.2, .65 / viewportRef.current.zoom)) points.push(p)
      }
      if (points.length !== active.points.length) setActiveInteraction({ ...active, points })
      else requestRender()
      return
    }
    if (active.mode === 'create' || active.mode === 'drag' || active.mode === 'resize') {
      if (active.mode === 'create' && active.tool === 'shape' || active.mode === 'resize') {
        setActiveInteraction({ ...active, current: point, constrain: event.shiftKey })
      } else setActiveInteraction({ ...active, current: point })
      return
    }
    if (active.mode === 'erase') {
      if (active.pageErase) {
        const page = itemsRef.current.find((item) => item.id === active.pageErase!.id && item.kind === 'page') as Extract<CanvasItem, { kind: 'page' }> | undefined
        if (!page) return
        const local = { x: (point.x - page.x) / page.w, y: (point.y - page.y) / page.h }
        const previous = active.pageErase.points[active.pageErase.points.length - 1]
        const travelled = Math.hypot((local.x - previous.x) * page.w, (local.y - previous.y) * page.h)
        if (travelled >= Math.max(.2, .55 / viewportRef.current.zoom)) setActiveInteraction({ ...active, pageErase: { ...active.pageErase, points: [...active.pageErase.points, local] } })
      } else {
        // If an erase drag began outside a PDF page, switch to page-aware
        // erasing as soon as the cursor reaches that page instead of deleting
        // the entire page object.
        const target = itemAtPoint(point, itemsRef.current, Math.max(8, 12 / viewportRef.current.zoom))
        if (target && isRasterPdfPage(target)) {
          const size = Math.max(8 / viewportRef.current.zoom, brushSize * 2) / Math.max(1, target.w)
          const local = { x: (point.x - target.x) / target.w, y: (point.y - target.y) / target.h }
          setActiveInteraction({ ...active, pageErase: { id: target.id, points: [local], size } })
        } else setActiveInteraction({ ...active, erased: eraseAt(point, active.erased) })
      }
    }
  }

  const completeInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    lastPointerScreenRef.current = { x: event.clientX, y: event.clientY }
    const active = interactionRef.current
    if (!active || active.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (active.mode === 'draw' && active.points.length >= 1) {
      const bounds = makeBounds(active.points)
      const item: CanvasItem = { id: makeItemId(), kind: 'stroke', ...bounds, points: active.points, color: brushColor, size: brushSize }
      onItemsChange([...itemsRef.current, item]); onSelectionChange(undefined)
    }
    if (active.mode === 'create') {
      const delta = Math.hypot(active.current.x - active.start.x, active.current.y - active.start.y)
      if (delta > 3) {
        const bounds = active.tool === 'shape' && active.constrain
          ? constrainedRect(active.start, active.current, shapeAspectRatio(shapeOptions.shapeType))
          : normalizeRect(active.start, active.current)
        const item: CanvasItem = active.tool === 'shape'
          ? { id: makeItemId(), kind: 'shape', ...bounds, color: shapeOptions.borderColor, fill: shapeOptions.fillOn ? shapeOptions.fillColor : 'transparent', ...shapeOptions }
          : active.tool === 'protractor'
            ? { id: makeItemId(), kind: 'protractor', ...bounds, color: '#2563eb' }
            : { id: makeItemId(), kind: active.tool, x: active.start.x, y: active.start.y, w: active.current.x - active.start.x, h: active.current.y - active.start.y, ...(active.tool === 'line' ? lineOptions : {}), color: active.tool === 'ruler' ? '#2563eb' : lineOptions.color }
        onItemsChange([...itemsRef.current, item]); onSelectionChange(item.id)
      }
    }
    if (active.mode === 'marquee') {
      const bounds = normalizeRect(active.start, active.current)
      const dragged = Math.hypot(active.current.x - active.start.x, active.current.y - active.start.y) > 3
      const hits = dragged ? itemsRef.current.filter((item) => {
        if (item.locked) return false
        const b = itemBounds(item)
        return b.x <= bounds.x + bounds.w && b.x + b.w >= bounds.x && b.y <= bounds.y + bounds.h && b.y + b.h >= bounds.y
      }).map((item) => item.id) : []
      const finalIds = active.additive
        ? [...new Set([...selectedIds, ...hits])]
        : hits
      if (onMultiSelectionChange) onMultiSelectionChange(finalIds)
      const primary = finalIds.at(-1)
      onSelectionChange(primary)
    }
    if (active.mode === 'drag') {
      const moving = new Set(active.ids)
      const dx = active.current.x - active.start.x, dy = active.current.y - active.start.y
      onItemsChange(itemsRef.current.map((candidate) => moving.has(candidate.id) ? translateItem(candidate, dx, dy) : candidate))
    }
    if (active.mode === 'resize') {
      const targetBounds = active.constrain
        ? constrainedRect(active.startBounds, active.current, active.startBounds.w / active.startBounds.h)
        : normalizeRect(active.startBounds, active.current)
      onItemsChange(itemsRef.current.map((item) => active.ids.includes(item.id) ? resizeItem(item, active.startBounds, targetBounds) : item))
    }
    if (active.mode === 'erase') {
      const shouldCommitMask = active.pageErase && active.pageErase.points.length > 0
      if (active.erased.size || shouldCommitMask) {
        const erasedIds = active.erased
        const nextItems = itemsRef.current.filter((item) => !erasedIds.has(item.id)).map((item) => {
          if (shouldCommitMask && item.kind === 'page' && item.id === active.pageErase!.id) return { ...item, erasures: [...(item.erasures ?? []), { points: active.pageErase!.points, size: active.pageErase!.size }] }
          return item
        })
        onItemsChange(nextItems)
        if (selectedIds.some((id) => erasedIds.has(id))) { onMultiSelectionChange?.([]); onSelectionChange(undefined) }
      }
    }
    setActiveInteraction(null)
  }

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const id = selectedId
    const ids = selectedIds.length > 1 ? selectedIds : id ? [id] : []
    const selected = itemsRef.current.filter((item) => ids.includes(item.id) && !item.locked)
    if (!selected.length) return
    const startBounds = selected.map(itemBounds).reduce((bounds, current) => ({
      x: Math.min(bounds.x, current.x),
      y: Math.min(bounds.y, current.y),
      w: Math.max(bounds.x + bounds.w, current.x + current.w) - Math.min(bounds.x, current.x),
      h: Math.max(bounds.y + bounds.h, current.y + current.h) - Math.min(bounds.y, current.y),
    }), itemBounds(selected[0]))
    const start = worldPoint(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    setActiveInteraction({ mode: 'resize', pointerId: event.pointerId, ids: selected.map((item) => item.id), start, startBounds, current: start, constrain: event.shiftKey })
  }

  const startEdit = (id?: string) => { if (id) { const item = itemsRef.current.find((candidate) => candidate.id === id); if (item && isEditableKind(item)) { if (item.kind === 'physics') onOpenPhysics?.(item); else setEditingId(id) } } }
  const endEdit = () => { const current = editingId ? itemsRef.current.find((item) => item.id === editingId) : undefined; if (current?.kind === 'text' && !current.text.trim()) { onItemsChange(itemsRef.current.filter((item) => item.id !== current.id)); if (selectedId === current.id) onSelectionChange(undefined) }; setEditingId(undefined) }

  useEffect(() => {
    const item = editingId ? itemsRef.current.find((candidate) => candidate.id === editingId) : undefined
    if (item?.kind !== 'equation') return
    const finishOnOutsidePointer = (event: PointerEvent) => {
      if (event.composedPath().some((target) => target instanceof Element && target.matches('.equation-editor, .ML__keyboard'))) return
      endEdit()
    }
    document.addEventListener('pointerdown', finishOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', finishOnOutsidePointer, true)
  }, [editingId])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      const current = viewportRef.current
      if (event.ctrlKey || event.metaKey) {
        const before = { x: (event.clientX - rect.left - current.x) / current.zoom, y: (event.clientY - rect.top - current.y) / current.zoom }
        const scale = Math.exp(-event.deltaY * 0.0025)
        const zoom = Math.min(8, Math.max(.15, current.zoom * scale))
        onViewportChange({ x: event.clientX - rect.left - before.x * zoom, y: event.clientY - rect.top - before.y * zoom, zoom })
      } else {
        onViewportChange({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY })
      }
    }
    surface.addEventListener('wheel', wheel, { passive: false })
    return () => surface.removeEventListener('wheel', wheel)
  }, [onViewportChange])

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable || !!target.closest('math-field, .canvas-editor, .modal-backdrop')
    }
    const isDrawKey = (event: KeyboardEvent) => event.code === `Key${drawHotkey.toUpperCase()}` || event.key.toLowerCase() === drawHotkey.toLowerCase()
    const finishHotkeyStroke = () => {
      const active = interactionRef.current
      if (active?.mode === 'draw' && active.source === 'hotkey' && active.points.length) {
        const item: CanvasItem = { id: makeItemId(), kind: 'stroke', ...makeBounds(active.points), points: active.points, color: brushColor, size: brushSize }
        onItemsChange([...itemsRef.current, item])
        onSelectionChange(undefined)
        setActiveInteraction(null)
      }
    }
    const down = (event: KeyboardEvent) => {
      if (!isDrawKey(event) || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || heldDrawRef.current) return
      heldDrawRef.current = true
      onHoldDrawingChange?.(true)
      event.preventDefault()
      const screen = lastPointerScreenRef.current
      if (screen && pointerInsideRef.current) {
        setActiveInteraction({ mode: 'draw', pointerId: -1, source: 'hotkey', points: [worldPointFromScreen(screen)] })
      } else {
        // The first move into the canvas while D is held starts the stroke.
        requestRender()
      }
    }
    const up = (event: KeyboardEvent) => {
      if (!isDrawKey(event) || !heldDrawRef.current) return
      heldDrawRef.current = false
      onHoldDrawingChange?.(false)
      event.preventDefault()
      finishHotkeyStroke()
      requestRender()
    }
    const blur = () => {
      if (!heldDrawRef.current) return
      heldDrawRef.current = false
      onHoldDrawingChange?.(false)
      finishHotkeyStroke()
      requestRender()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur) }
  }, [drawHotkey, onHoldDrawingChange, brushColor, brushSize, onItemsChange, onSelectionChange])

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable || !!target.closest('math-field, .canvas-editor, .modal-backdrop')
    }
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || !pointerInsideRef.current || heldPanRef.current) return
      heldPanRef.current = true
      setHoldingPan(true)
      event.preventDefault()
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !heldPanRef.current) return
      heldPanRef.current = false
      setHoldingPan(false)
      event.preventDefault()
    }
    const blur = () => {
      heldPanRef.current = false
      setHoldingPan(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (editingId) return
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && (event.target.isContentEditable || !!event.target.closest('math-field')))
      if (typing) return
      if (event.key === 'Enter' && selectedId) { const item = itemsRef.current.find((candidate) => candidate.id === selectedId); if (item && isEditableKind(item)) { event.preventDefault(); startEdit(selectedId) } }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [editingId, selectedId])

  useEffect(() => () => { if (renderFrame.current !== null) cancelAnimationFrame(renderFrame.current) }, [])

  useImperativeHandle(ref, () => ({
    getCenter: () => {
      const rect = surfaceRef.current?.getBoundingClientRect(), view = viewportRef.current
      return rect ? { x: (rect.width / 2 - view.x) / view.zoom, y: (rect.height / 2 - view.y) / view.zoom } : { x: 300, y: 300 }
    },
    zoomToFit: () => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      if (!rect || !itemsRef.current.length) return
      const bounds = itemsRef.current.map(itemBounds).reduce((all, current) => ({ x: Math.min(all.x, current.x), y: Math.min(all.y, current.y), right: Math.max(all.right, current.x + current.w), bottom: Math.max(all.bottom, current.y + current.h) }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity })
      const width = Math.max(1, bounds.right - bounds.x), height = Math.max(1, bounds.bottom - bounds.y)
      const zoom = Math.min(2, Math.max(.15, Math.min((rect.width - 100) / width, (rect.height - 100) / height)))
      onViewportChange({ x: (rect.width - width * zoom) / 2 - bounds.x * zoom, y: (rect.height - height * zoom) / 2 - bounds.y * zoom, zoom })
    },
    focusItem: (id: string) => {
      const rect = surfaceRef.current?.getBoundingClientRect()
      const item = itemsRef.current.find((candidate) => candidate.id === id)
      if (!rect || !item) return
      const bounds = itemBounds(item)
      const width = Math.max(1, bounds.w), height = Math.max(1, bounds.h)
      const zoom = Math.min(1.5, Math.max(.2, Math.min((rect.width - 80) / width, (rect.height - 80) / height)))
      onViewportChange({ x: (rect.width - width * zoom) / 2 - bounds.x * zoom, y: (rect.height - height * zoom) / 2 - bounds.y * zoom, zoom })
    },
    exportPng: () => exportItemsPng(itemsRef.current),
  }), [onViewportChange])

  const selectedBounds = useMemo(() => {
    const chosen = items.filter((item) => selectedIds.includes(item.id))
    if (!chosen.length && selectedId) {
      const item = items.find((candidate) => candidate.id === selectedId)
      if (item) chosen.push(item)
    }
    if (!chosen.length) return undefined
    const active = interactionRef.current
    const previewItems = chosen.map((item) => {
      if (active?.mode === 'drag' && active.ids.includes(item.id)) return translateItem(item, active.current.x - active.start.x, active.current.y - active.start.y)
      if (active?.mode === 'resize' && active.ids.includes(item.id)) {
        const bounds = active.constrain
          ? constrainedRect(active.startBounds, active.current, active.startBounds.w / active.startBounds.h)
          : normalizeRect(active.startBounds, active.current)
        return resizeItem(item, active.startBounds, bounds)
      }
      return item
    })
    const bounds = previewItems.map(itemBounds).reduce((acc, current) => ({ x: Math.min(acc.x, current.x), y: Math.min(acc.y, current.y), right: Math.max(acc.right, current.x + current.w), bottom: Math.max(acc.bottom, current.y + current.h) }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity })
    return { x: bounds.x, y: bounds.y, w: Math.max(1, bounds.right - bounds.x), h: Math.max(1, bounds.bottom - bounds.y) }
  }, [items, selectedId, selectedIds, interaction])
  const editingItem = editingId ? items.find((item) => item.id === editingId) : undefined

  const gridScale = gridSize
  const activeVisualTool = holdingPan ? 'pan' : heldDrawRef.current ? 'draw' : tool
  return <div ref={surfaceRef} className={`native-canvas tool-${activeVisualTool}`} onPointerEnter={(event) => { pointerInsideRef.current = true; lastPointerScreenRef.current = { x: event.clientX, y: event.clientY }; const point = worldPoint(event); onPointerWorldMove?.(point); updateGraphHover(point); const active = interactionRef.current; if (heldDrawRef.current && !heldPanRef.current && !(active?.mode === 'draw' && active.source === 'hotkey')) setActiveInteraction({ mode: 'draw', pointerId: -1, source: 'hotkey', points: [point] }) }} onPointerLeave={() => { pointerInsideRef.current = false; updateGraphHover(null); onPointerWorldLeave?.() }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={completeInteraction} onPointerCancel={completeInteraction} onContextMenu={onContextMenu} onDoubleClick={() => { if (tool !== 'select') return; const graph = itemsRef.current.find((item): item is Extract<CanvasItem, { kind: 'graph' }> => item.id === selectedId && item.kind === 'graph'); const physics = itemsRef.current.find((item): item is Extract<CanvasItem, { kind: 'physics' }> => item.id === selectedId && item.kind === 'physics'); if (graph) onOpenGraph?.(graph); else if (physics) onOpenPhysics?.(physics); else startEdit(selectedId) }} aria-label="Math workspace">
    <canvas ref={canvasRef} className="canvas-renderer" />
    <div className="canvas-overlay" aria-hidden={false}>
      {graphHover && <div className="canvas-graph-hover" style={{ left: graphHover.x, top: graphHover.y, borderColor: graphHover.color }}><span style={{ backgroundColor: graphHover.color }} />{graphHover.label}</div>}
      {items.filter((item): item is Extract<CanvasItem, { kind: 'physics' }> => item.kind === 'physics' && item.playback === 'loop').map((item) => <div key={`${item.id}-physics-controls`} className="physics-canvas-controls" style={{ left: (item.x + item.w - 8) * viewport.zoom + viewport.x, top: (item.y + 8) * viewport.zoom + viewport.y }}>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onTogglePhysicsPlayback?.(item.id) }} aria-label={`${item.playing ? 'Pause' : 'Play'} embedded physics simulation`}>{item.playing ? 'Ⅱ Pause' : '▶ Play'}</button>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenPhysics?.(item) }} aria-label="Edit physics simulation">Edit</button>
      </div>)}
      {remoteCursors.flatMap((cursor) => [
        ...cursor.selectedIds.flatMap((id) => {
          const item = items.find((candidate) => candidate.id === id)
          if (!item) return []
          const bounds = itemBounds(item)
          return [<div key={`${cursor.peerId}-selection-${id}`} className="remote-selection-overlay" style={{ left: bounds.x * viewport.zoom + viewport.x, top: bounds.y * viewport.zoom + viewport.y, width: bounds.w * viewport.zoom, height: bounds.h * viewport.zoom, borderColor: cursor.color, backgroundColor: `${cursor.color}14` }} aria-label={`${cursor.name} selected ${item.kind}`} />]
        }),
        ...(cursor.marquee ? [<div key={`${cursor.peerId}-marquee`} className="remote-marquee-overlay" style={{ left: cursor.marquee.x * viewport.zoom + viewport.x, top: cursor.marquee.y * viewport.zoom + viewport.y, width: cursor.marquee.w * viewport.zoom, height: cursor.marquee.h * viewport.zoom, borderColor: cursor.color, backgroundColor: `${cursor.color}22` }}><span style={{ backgroundColor: cursor.color }}>{cursor.name}</span></div>] : []),
        ...(cursor.visible ? [<div key={cursor.peerId} className="remote-cursor" style={{ left: cursor.x * viewport.zoom + viewport.x, top: cursor.y * viewport.zoom + viewport.y, color: cursor.color }} aria-label={`${cursor.name}'s cursor`}>
        <svg className="remote-cursor-icon" viewBox="0 0 18 24" aria-hidden="true"><path d="M1 1v18l5-5 4 8 3-1.5-4-8h7L1 1z" fill="currentColor" stroke="white" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <span className="remote-cursor-label" style={{ backgroundColor: cursor.color }}>{cursor.name}</span>
      </div>] : []),
      ])}
      {selectedBounds && !(editingId && editingItem?.kind === 'text') && <div className="selection-overlay" style={{ left: selectedBounds.x * viewport.zoom + viewport.x, top: selectedBounds.y * viewport.zoom + viewport.y, width: selectedBounds.w * viewport.zoom, height: selectedBounds.h * viewport.zoom, borderColor: (() => { const selected = items.find((item) => item.id === selectedId); return selectedIds.length === 1 && selected?.kind === 'shape' ? (selected.borderColor ?? selected.color) : '#1f6feb' })() }}><button className="resize-handle" type="button" aria-label="Resize selected item" onPointerDown={startResize} /></div>}
      {contextMenu && (() => {
        const chosen = items.filter((item) => contextMenu.ids.includes(item.id))
        const editable = chosen.length === 1 && !chosen[0].locked && isEditableKind(chosen[0])
        const allLocked = chosen.length > 0 && chosen.every((item) => item.locked)
        return <div ref={contextMenuRef} className="canvas-context-menu" role="menu" aria-label="Object actions" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
          <button type="button" role="menuitem" disabled={!editable} onClick={() => runContextAction('edit')}>Edit</button>
          <button type="button" role="menuitem" disabled={!chosen.some((item) => !item.locked)} onClick={() => runContextAction('duplicate')}>Duplicate</button>
          <div className="canvas-context-separator" role="separator" />
          <button type="button" role="menuitem" disabled={!chosen.length} onClick={() => runContextAction('front')}>Bring to front</button>
          <button type="button" role="menuitem" disabled={!chosen.length} onClick={() => runContextAction('back')}>Send to back</button>
          <div className="canvas-context-separator" role="separator" />
          <button type="button" role="menuitem" disabled={!chosen.length} onClick={() => runContextAction('lock')}>{allLocked ? 'Unlock' : 'Lock'}</button>
          <button type="button" role="menuitem" className="danger" disabled={!chosen.some((item) => !item.locked)} onClick={() => runContextAction('delete')}>Delete</button>
        </div>
      })()}
      <div className="editor-world-layer" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {editingItem && <OverlayEditor item={editingItem} onChange={(next) => onItemsChange(itemsRef.current.map((current) => current.id === next.id ? next : current))} onFinish={endEdit} />}
        {items.filter((item): item is Extract<CanvasItem, { kind: 'equation' }> => item.kind === 'equation' && item.id !== editingId).map((item) => (
          <div key={item.id} className="equation-preview" aria-label={`Equation: ${item.latex}`} style={{ left: item.x, top: item.y, width: item.w, height: item.h, fontSize: item.fontSize }} dangerouslySetInnerHTML={{ __html: convertLatexToMarkup(item.latex || '\\;', { defaultMode: 'math' }) }} />
        ))}
      </div>
      {interaction?.mode === 'draw' && <div className="draw-status" aria-hidden="true">{brushSize}px</div>}
    </div>
    <div className="canvas-grid-scale" data-grid={gridScale} aria-hidden="true" />
  </div>
})

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src
  })
}

async function exportItemsPng(items: CanvasItem[]) {
  const itemList = items.length ? items : [{ id: 'empty', kind: 'shape', x: 0, y: 0, w: 800, h: 600, color: '#fff', fill: '#fff' } as CanvasItem]
  const overall = itemList.map(itemBounds).reduce((all, current) => ({ x: Math.min(all.x, current.x), y: Math.min(all.y, current.y), right: Math.max(all.right, current.x + current.w), bottom: Math.max(all.bottom, current.y + current.h) }), { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity })
  const padding = 40
  const width = Math.min(6000, Math.max(320, Math.ceil(overall.right - overall.x + padding * 2)))
  const height = Math.min(6000, Math.max(240, Math.ceil(overall.bottom - overall.y + padding * 2)))
  const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2
  const context = canvas.getContext('2d')!; context.scale(2, 2); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.translate(padding - overall.x, padding - overall.y)
  const images = new Map<string, HTMLImageElement>()
  for (const item of items) if (item.kind === 'page') { try { images.set(item.id, await loadImage(item.src)) } catch {} }
  for (const item of items) drawItem(context, item, images)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas export failed')), 'image/png'))
}

export function migrateLegacySnapshot(snapshot: unknown): CanvasItem[] {
  const root = snapshot as { store?: Record<string, unknown>; document?: { store?: Record<string, unknown> } }
  const store = root?.store ?? root?.document?.store ?? {}
  const records = Object.values(store) as Array<Record<string, any>>
  const shapes = records.filter((record) => record?.typeName === 'shape' || record?.type)
  return shapes.flatMap((shape) => {
    const props = shape.props ?? {}
    const base = { id: makeItemId(), x: Number(shape.x) || 0, y: Number(shape.y) || 0, w: Number(props.w) || 200, h: Number(props.h) || 100, locked: Boolean(shape.isLocked) }
    if (shape.type === 'math-page') return [{ ...base, kind: 'page', src: String(props.src ?? ''), title: String(props.title ?? 'Imported page') } as CanvasItem]
    if (shape.type === 'math-equation') return [{ ...base, kind: 'equation', latex: String(props.latex ?? ''), fontSize: Number(props.fontSize) || 30 } as CanvasItem]
    if (shape.type === 'math-graph') return [{ ...base, kind: 'graph', expression: String(props.expression ?? 'x^2'), xMin: Number(props.xMin) || -5, xMax: Number(props.xMax) || 5, yMin: Number(props.yMin) || -5, yMax: Number(props.yMax) || 10, gridStep: Number(props.gridStep) || 1 } as CanvasItem]
    if (shape.type === 'math-table') return [{ ...base, kind: 'table', rows: Number(props.rows) || 5, cols: Number(props.cols) || 4, cells: Array.isArray(props.cells) ? props.cells.map(String) : [], header: props.header !== false } as CanvasItem]
    if (shape.type === 'text') return [{ ...base, kind: 'text', text: String(props.text ?? props.richText?.[0]?.text ?? ''), fontSize: Number(props.size) || 20 } as CanvasItem]
    if (shape.type === 'geo') return [{ ...base, kind: 'shape', color: '#334155', fill: 'rgba(37, 99, 235, .08)' } as CanvasItem]
    if (shape.type === 'draw') {
      const points = (props.segments?.flatMap((segment: any) => segment.points ?? []) ?? []).map((point: any) => ({ x: base.x + Number(point.x || 0), y: base.y + Number(point.y || 0) }))
      return points.length > 1 ? [{ id: base.id, kind: 'stroke', ...makeBounds(points), points, color: '#111827', size: 3, locked: base.locked } as CanvasItem] : []
    }
    if (shape.type === 'arrow' || shape.type === 'line') return [{ ...base, kind: 'line', color: '#111827' } as CanvasItem]
    return []
  })
}
