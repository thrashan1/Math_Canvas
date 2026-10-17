import { all, create, type EvalFunction } from 'mathjs'

const math = create(all, {})
const palette = ['#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ef6c00', '#00838f', '#4e342e']

export type GraphExpressionRow = { id: string; expression: string; color: string; visible: boolean }
export type GraphParameter = { value: number; min: number; max: number; step: number; initial: number }
export type GraphStudioDocument = {
  rows: GraphExpressionRow[]
  parameters: Record<string, GraphParameter>
  centerX: number
  centerY: number
  scale: number
}
export type GraphCurve = { row: GraphExpressionRow; label: string; evaluate: (x: number) => number | null }
export type GraphEvaluation = { curves: GraphCurve[]; errors: Record<string, string>; values: Record<string, string>; parameters: Record<string, GraphParameter> }

export const makeGraphExpressionRow = (expression = ''): GraphExpressionRow => ({
  id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `graph-row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  expression,
  color: palette[0],
  visible: true,
})

export const makeGraphStudioDocument = (): GraphStudioDocument => ({
  rows: [makeGraphExpressionRow('y = x^2')],
  parameters: {},
  centerX: 0,
  centerY: 0,
  scale: 50,
})

export function legacyGraphToStudio(expression: string): GraphStudioDocument {
  const document = makeGraphStudioDocument()
  const trimmed = expression.trim()
  const match = trimmed.match(/^@(?:normal|piecewise|parametric|polar)\n?([\s\S]*)$/)
  const expressions = match ? (match[1] ?? '').split(/\n+/).filter(Boolean) : trimmed.split(/\n+/).filter(Boolean)
  document.rows = (expressions.length ? expressions : ['y = x^2']).map((line, index) => {
    const row = makeGraphExpressionRow(line)
    row.color = palette[index % palette.length]!
    return row
  })
  return document
}

const builtins = new Set([
  'abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'ceil', 'cbrt', 'cos', 'cosh',
  'cot', 'csc', 'exp', 'expm1', 'floor', 'log', 'log10', 'log2', 'max', 'min', 'mod', 'pow', 'round',
  'sec', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc', 'pi', 'e', 'tau', 'true', 'false',
])

function parseExpression(expression: string) {
  const definition = expression.match(/^\s*([A-Za-z_]\w*)\s*(?:\(\s*([A-Za-z_]\w*)\s*\))?\s*=\s*(.+)$/)
  if (definition) {
    if (definition[1] === 'x' && !definition[2]) throw new Error('"x" is reserved for the graph variable.')
    return {
      name: definition[1]!,
      parameter: definition[2],
      source: definition[3]!,
      isY: definition[1] === 'y' && !definition[2],
    }
  }
  return { source: expression.trim(), isY: false as const }
}

function findSymbols(source: string) {
  const symbols = new Set<string>()
  try {
    math.parse(source).traverse((node) => {
      if (node.type === 'SymbolNode' && 'name' in node && typeof node.name === 'string') symbols.add(node.name)
    })
  } catch {
    for (const name of source.match(/[A-Za-z_]\w*/g) ?? []) symbols.add(name)
  }
  return symbols
}

function isNumericLiteral(source: string) {
  try {
    const node = math.parse(source)
    let literal = true
    node.traverse((child) => {
      if (child.type !== 'ConstantNode' && child.type !== 'ParenthesisNode' && child.type !== 'OperatorNode' && child.type !== 'UnaryOperatorNode') literal = false
    })
    return literal
  } catch {
    return false
  }
}

function formatValue(value: unknown) {
  if (typeof value === 'number' && !Number.isFinite(value)) return 'undefined'
  return math.format(value, { precision: 10 })
}

export function evaluateGraphDocument(document: GraphStudioDocument): GraphEvaluation {
  const errors: Record<string, string> = {}
  const values: Record<string, string> = {}
  const scope: Record<string, unknown> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 }
  const parsedRows = document.rows.map((row) => {
    try {
      if (!row.expression.trim()) return { row, parsed: null }
      return { row, parsed: parseExpression(row.expression) }
    } catch (error) {
      errors[row.id] = error instanceof Error ? error.message : String(error)
      return { row, parsed: null }
    }
  })

  const definitions = parsedRows.filter((entry) => entry.parsed?.name && entry.parsed.parameter)
  const scalarDefinitions = parsedRows.filter((entry) => entry.parsed?.name && !entry.parsed.parameter && entry.parsed.name !== 'y')
  const mentioned = new Set<string>()
  for (const { parsed } of parsedRows) if (parsed) findSymbols(parsed.source).forEach((name) => mentioned.add(name))
  const definedNames = new Set([...definitions, ...scalarDefinitions].map((entry) => entry.parsed!.name!))
  const parameterNames = new Set<string>()
  for (const entry of scalarDefinitions) {
    const { parsed, row } = entry
    if (parsed?.name && isNumericLiteral(parsed.source)) parameterNames.add(parsed.name)
  }
  for (const name of mentioned) {
    if (!definedNames.has(name) && !builtins.has(name) && name !== 'x' && name !== 'y' && name !== 't' && name !== 'theta') parameterNames.add(name)
  }

  const parameters: Record<string, GraphParameter> = {}
  for (const name of parameterNames) {
    const stored = document.parameters[name]
    const declaration = scalarDefinitions.find((entry) => entry.parsed?.name === name)?.parsed?.source
    let initial = stored?.value
    if (!Number.isFinite(initial) && declaration && isNumericLiteral(declaration)) {
      try { initial = Number(math.evaluate(declaration)) } catch { initial = 1 }
    }
    if (!Number.isFinite(initial)) initial = 1
    const min = Number.isFinite(stored?.min) ? stored.min : Math.min(-10, initial - 1)
    const max = Number.isFinite(stored?.max) ? stored.max : Math.max(10, initial + 1)
    const step = Number.isFinite(stored?.step) && stored.step > 0 ? stored.step : 0.1
    const initialValue = Number.isFinite(stored?.initial) ? stored.initial : initial
    parameters[name] = { value: Math.max(min, Math.min(max, initial)), min, max, step, initial: initialValue }
    scope[name] = parameters[name]!.value
  }

  const compiledFunctions = new Map<string, { parameter: string; code: EvalFunction }>()
  for (const { parsed, row } of definitions) {
    if (!parsed?.name || !parsed.parameter) continue
    try {
      compiledFunctions.set(parsed.name, { parameter: parsed.parameter, code: math.compile(parsed.source) })
    } catch (error) {
      errors[row.id] = error instanceof Error ? error.message : String(error)
    }
  }
  for (const [name, definition] of compiledFunctions) {
    scope[name] = (value: number) => definition.code.evaluate({ ...scope, [definition.parameter]: value })
  }

  for (const { parsed, row } of scalarDefinitions) {
    if (!parsed?.name || parameterNames.has(parsed.name)) {
      if (parsed?.name && parsed.name !== 'y') values[row.id] = `= ${formatValue(scope[parsed.name])}`
      continue
    }
    try {
      const value = math.evaluate(parsed.source, scope)
      scope[parsed.name] = value
      values[row.id] = `= ${formatValue(value)}`
    } catch (error) {
      errors[row.id] = error instanceof Error ? error.message : String(error)
    }
  }

  const curves: GraphCurve[] = []
  for (const { parsed, row } of parsedRows) {
    if (!parsed || parsed.name && parsed.name !== 'y' && !parsed.parameter) continue
    try {
      const code = math.compile(parsed.source)
      const parameter = parsed.parameter ?? (parsed.isY ? 'x' : 'x')
      const probe = code.evaluate({ ...scope, [parameter]: 0, x: 0, y: 0 })
      if (typeof probe !== 'number') throw new Error('Expression must evaluate to a real number.')
      curves.push({
        row,
        label: parsed.name && parsed.parameter ? `${parsed.name}(${parameter})` : 'y',
        evaluate: (x) => {
          try {
            const result = code.evaluate({ ...scope, [parameter]: x, x, y: x })
            return typeof result === 'number' && Number.isFinite(result) ? result : null
          } catch {
            return null
          }
        },
      })
    } catch (error) {
      errors[row.id] = error instanceof Error ? error.message : String(error)
    }
  }

  return { curves, errors, values, parameters }
}

export function findGraphIntersections(curves: GraphCurve[], xMin: number, xMax: number, samples = 320) {
  const intersections: Array<{ x: number; y: number; first: string; second: string }> = []
  const visible = curves.filter((curve) => curve.row.visible)
  const refineIntersection = (first: GraphCurve, second: GraphCurve, left: number, right: number, leftDifference: number) => {
    let low = left
    let high = right
    let lowDifference = leftDifference
    let bestX = Math.abs(leftDifference) < Math.abs(first.evaluate(right)! - second.evaluate(right)!) ? left : right
    let bestResidual = Infinity

    for (let iteration = 0; iteration < 80; iteration++) {
      const middle = low + (high - low) / 2
      if (middle === low || middle === high) break
      const firstY = first.evaluate(middle)
      const secondY = second.evaluate(middle)
      if (firstY === null || secondY === null) return null
      const difference = firstY - secondY
      if (!Number.isFinite(difference)) return null
      if (Math.abs(difference) < bestResidual) {
        bestX = middle
        bestResidual = Math.abs(difference)
      }
      if (difference === 0) return { x: middle, y: firstY }
      if (difference * lowDifference < 0) {
        high = middle
      } else {
        low = middle
        lowDifference = difference
      }
    }

    const firstY = first.evaluate(bestX)
    const secondY = second.evaluate(bestX)
    if (firstY === null || secondY === null) return null
    const residual = Math.abs(firstY - secondY)
    const tolerance = Number.EPSILON * 128 * Math.max(1, Math.abs(firstY), Math.abs(secondY))
    if (residual > tolerance) return null
    return { x: bestX, y: firstY / 2 + secondY / 2 }
  }

  for (let a = 0; a < visible.length; a++) {
    for (let b = a + 1; b < visible.length; b++) {
      const first = visible[a]!, second = visible[b]!
      let lastX: number | undefined
      let lastDifference: number | undefined
      for (let index = 0; index <= samples; index++) {
        const x = xMin + (xMax - xMin) * index / samples
        const y1 = first.evaluate(x), y2 = second.evaluate(x)
        const difference = y1 === null || y2 === null ? NaN : y1 - y2
        if (Number.isFinite(difference) && lastDifference !== undefined && lastX !== undefined && difference * lastDifference < 0) {
          const intersection = refineIntersection(first, second, lastX, x, lastDifference)
          if (intersection) {
            const deduplicationTolerance = Number.EPSILON * 128 * Math.max(1, Math.abs(intersection.x))
            if (!intersections.some((point) => Math.abs(point.x - intersection.x) <= deduplicationTolerance && point.first === first.row.id && point.second === second.row.id)) {
              intersections.push({ ...intersection, first: first.row.id, second: second.row.id })
            }
          }
        }
        lastX = Number.isFinite(difference) ? x : undefined
        lastDifference = Number.isFinite(difference) ? difference : undefined
      }
    }
  }
  return intersections
}

export function nearestGraphPoints(curves: GraphCurve[], x: number, y: number, xPerPixel: number, yPerPixel: number) {
  return curves.flatMap((curve) => {
    if (!curve.row.visible) return []
    const value = curve.evaluate(x)
    if (value === null || Math.abs(value - y) * yPerPixel > 28) return []
    return [{ row: curve.row, x, y: value, distance: Math.abs(value - y) * yPerPixel }]
  }).sort((a, b) => a.distance - b.distance).slice(0, 1)
}

export const graphPalette = palette
