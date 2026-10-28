import React, { useCallback, useEffect, useRef, useState } from 'react'
import { parse, type ConstantNode, type MathNode, type OperatorNode, type ParenthesisNode, type SymbolNode } from 'mathjs'
import { convertLatexToMarkup } from 'mathlive'
import { SolverSettings, type SolverPreferences } from './solver-settings'

export type ProblemSolution = {
  title: string
  answer: string
  simpleSteps: string[]
  fullSteps: string[]
}

export type GeneratedTestProblemSet = { title: string; questions: string[]; answers: string[] }
type SolutionPreview = { title: string; answer: string; simpleSteps: string[]; fullSteps: string[] }
type Selection = { x: number; y: number; w: number; h: number }
type Props = {
  image: string
  preferences: SolverPreferences
  onPreferencesChange: (patch: Partial<SolverPreferences>) => void
  onBack: () => void
  onAddSteps: (kind: 'simple' | 'full', solution: ProblemSolution) => void
}

export function CanvasRegionSelection({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (region: Selection) => void }) {
  const startRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const [selection, setSelection] = useState<Selection>()

  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)) }
  }
  const updateSelection = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    setSelection({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) })
  }
  const selected = Boolean(selection && selection.w >= 8 && selection.h >= 8)

  return <div className="canvas-region-selector" onPointerDown={(event) => {
    if (event.button !== 0 || (event.target instanceof HTMLElement && event.target.closest('.canvas-region-actions'))) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointFromEvent(event)
    startRef.current = point
    updateSelection(point, point)
  }} onPointerMove={(event) => {
    if (startRef.current) updateSelection(startRef.current, pointFromEvent(event))
  }} onPointerUp={(event) => {
    if (!startRef.current) return
    updateSelection(startRef.current, pointFromEvent(event))
    startRef.current = undefined
  }} onPointerCancel={() => { startRef.current = undefined }}>
    <div className="canvas-region-shade" />
    {selection && <div className="canvas-selection-rect" style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }} />}
    <div className="canvas-region-toolbar">
      <span>{selected ? 'Canvas area selected' : 'Drag a rectangle around the problem on your canvas'}</span>
      <div className="canvas-region-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!selected} onClick={() => selection && onConfirm(selection)}>Confirm and solve</button>
      </div>
    </div>
  </div>
}

export function ProblemSolverPage({ image, preferences, onPreferencesChange, onBack, onAddSteps }: Props) {
  const [subject, setSubject] = useState(preferences.defaultSubject)
  const [extraInstructions, setExtraInstructions] = useState('')
  const [problemText, setProblemText] = useState('')
  const [solution, setSolution] = useState<ProblemSolution>()
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [streamedContent, setStreamedContent] = useState('')
  const startedRef = useRef(false)

  const solve = useCallback(async () => {
    setLoading(true)
    setError('')
    setSolution(undefined)
    setStreamedContent('')
    const controller = new AbortController()
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `solver-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const timeout = window.setTimeout(() => controller.abort(), 300_000)
    const onChunk = (text: string) => setStreamedContent((current) => current + text)
    try {
      const imageBase64 = image.slice(image.indexOf(',') + 1)
      const payload = { imageBase64, subject, instructions: extraInstructions.trim() }
      const typedMathSolution = subject !== 'Chemistry' && subject !== 'Physics'
        ? solveTypedMathEquation(problemText.trim())
        : undefined
      if (typedMathSolution) {
        setSolution(typedMathSolution)
        return
      }
      const systemPrompt = createSolverPrompt(payload.subject, payload.instructions, problemText.trim())
      let content: string
      if (window.mathCanvas?.solveProblem) {
        content = await window.mathCanvas.solveProblem(requestId, payload.imageBase64, systemPrompt, preferences.model, onChunk)
      } else {
        content = await streamOllamaSolution(payload.imageBase64, systemPrompt, preferences.model, onChunk, controller.signal)
      }
      setSolution(parseSolution(content))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (controller.signal.aborted) {
        void window.mathCanvas?.cancelProblem(requestId)
        setError('The local model took too long to respond. Try again after the model has loaded, or select a smaller problem area.')
      } else if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
        setError(`Could not reach Ollama on this computer. Install and start Ollama, then open Settings to install the selected model (${preferences.model}).`)
      } else {
        setError(`${message} If the model is not installed yet, open Settings and install ${preferences.model}.`)
      }
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }, [extraInstructions, image, preferences.model, problemText, subject])

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true
      void solve()
    }
  }, [solve])

  return <main className="solver-page">
    <header className="solver-topbar">
      <div className="solver-brand"><span className="brand-mark">∑</span>MathCanvas <span className="solver-divider">/</span> Problem solution</div>
      <div className="solver-top-actions"><span className="local-badge">LOCAL AI · NO API KEY</span><button type="button" onClick={() => setSettingsOpen(true)}>Settings</button><button type="button" onClick={onBack}>Back to canvas</button></div>
    </header>
    <div className="solver-content">
      <section className="solver-problem-card">
        <div className="solver-section-heading"><div><span className="solver-kicker">YOUR SNAPSHOT</span><h2>Problem</h2></div></div>
        <img className="solver-problem-image" src={image} alt="Selected problem snapshot" />
        <label className="solver-field">Problem text <span className="solver-field-optional">optional — correct any misread symbols or exponents</span>
          <textarea value={problemText} onChange={(event) => setProblemText(event.target.value)} placeholder="Type the problem exactly as written if the image is ambiguous, e.g. b = b^2 + 2." rows={2} />
          <span className="solver-field-optional">Typed single-variable linear and quadratic equations are solved locally when supported.</span>
        </label>
        <label className="solver-field">Subject
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option>Auto-detect</option><option>Math</option><option>Chemistry</option><option>Physics</option>
          </select>
        </label>
        <label className="solver-field">Optional focus
          <textarea value={extraInstructions} onChange={(event) => setExtraInstructions(event.target.value)} placeholder="For example: show the quadratic formula, balance using half-reactions, or explain each unit conversion." rows={3} />
        </label>
        <button type="button" className="primary solver-run-button" onClick={() => void solve()} disabled={loading}>{loading ? 'Working through it…' : problemText.trim() ? 'Solve with corrected problem text' : 'Solve again'}</button>
        <p className="solver-privacy-note">The snapshot is sent only to Ollama at 127.0.0.1 on this computer. Supported typed linear and quadratic equations are solved locally instead. No cloud AI service or API key is used. AI can make mistakes; check the work before relying on it.</p>
      </section>
      <section className={`solver-answer-card ${preferences.textSize === 'large' ? 'solver-answer-large' : ''}`}>
        <div className="solver-section-heading"><div><span className="solver-kicker">STEP-BY-STEP WORK</span><h1>{solution?.title || (loading ? 'Solving your problem' : 'Solution')}</h1></div></div>
        {loading && <div className="solver-loading"><span className="solver-spinner" /><div><strong>{streamedContent ? 'Writing the worked solution' : 'Reading the problem image'}</strong><p>Both versions are generated together. The student-facing steps appear here as the model writes them.</p></div></div>}
        {error && <div className="solver-error" role="alert"><strong>Could not solve the snapshot</strong><p>{error}</p><button type="button" onClick={() => void solve()}>Try again</button></div>}
        {(solution || loading) && (() => {
          const preview = previewSolution(streamedContent)
          const versions = [
            { kind: 'simple' as const, title: 'Simple solution', steps: solution?.simpleSteps ?? preview.simpleSteps },
            { kind: 'full' as const, title: 'Full solution', steps: solution?.fullSteps ?? preview.fullSteps },
          ]
          const orderedVersions = preferences.answerStyle === 'full' ? [...versions].reverse() : versions
          return <>
            {(solution?.answer || preview.answer) && <div className="solver-final-answer"><span>ANSWER</span><p><RichSolutionText text={solution?.answer ?? preview.answer} />{loading && !solution?.answer && <span className="solver-cursor" />}</p></div>}
            {loading && !streamedContent && <p className="solver-stream-hint">Waiting for the local model to start writing…</p>}
            {orderedVersions
              .filter((version) => preferences.answerStyle === 'both' || preferences.answerStyle === version.kind)
              .map((version) => <SolutionVersion key={version.kind} title={version.title} steps={version.steps} live={loading} onAdd={solution ? () => onAddSteps(version.kind, solution) : undefined} />)}
          </>
        })()}
        {!loading && !error && !solution && <p className="solver-empty">The local model did not return a usable solution. Try again or add a little more detail under Optional focus.</p>}
      </section>
    </div>
    {settingsOpen && <SolverSettings preferences={preferences} onChange={onPreferencesChange} onClose={() => setSettingsOpen(false)} />}
  </main>
}

export function TestProblemMakerPage({ image, preferences, onPreferencesChange, onBack, onAddToCanvas }: {
  image: string
  preferences: SolverPreferences
  onPreferencesChange: (patch: Partial<SolverPreferences>) => void
  onBack: () => void
  onAddToCanvas: (problemSet: GeneratedTestProblemSet) => void
}) {
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(5)
  const [generated, setGenerated] = useState<GeneratedTestProblemSet>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const activeRequest = useRef<{ id: string; controller: AbortController } | undefined>(undefined)

  useEffect(() => () => {
    const request = activeRequest.current
    if (!request) return
    request.controller.abort()
    void window.mathCanvas?.cancelProblem(request.id)
  }, [])

  const generate = async () => {
    setLoading(true)
    setError('')
    setGenerated(undefined)
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `maker-${Date.now()}`
    const controller = new AbortController()
    activeRequest.current = { id: requestId, controller }
    const timeout = window.setTimeout(() => controller.abort(), 300_000)
    try {
      const encodedImage = image.slice(image.indexOf(',') + 1)
      const binaryImage = atob(encodedImage)
      const sourceBytes = Uint8Array.from(binaryImage, (character) => character.charCodeAt(0))
      const source = new Blob([sourceBytes], { type: 'image/png' })
      const bitmap = await createImageBitmap(source)
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        bitmap.close()
        throw new Error('Could not prepare the canvas snapshot.')
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const compressedImage = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not compress the canvas snapshot.')), 'image/jpeg', 0.82))
      const bytes = new Uint8Array(await compressedImage.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      const base64 = btoa(binary)
      if (base64.length > 10_000_000) throw new Error('The canvas snapshot is too large to analyze. Zoom in on the relevant work and try again.')
      const prompt = `You are a careful math teacher creating a fresh practice test from a student's MathCanvas workspace image. Inspect the visible canvas to identify the concepts, methods, notation, and difficulty being studied. Create exactly ${count} new questions that practice those same concepts. Do not copy an existing question verbatim; change values or context while preserving the skill and level. Make each question self-contained and ensure every answer is correct. If the image is blank or unreadable, say that in the title and use the clearest visible context rather than inventing a topic. ${topic.trim() ? `Focus the set on: ${topic.trim()}.` : ''} Return the test questions in simple_steps, one question per array entry, and the matching answer key with concise worked reasoning in full_steps, one answer per question in the same order. Keep all mathematical notation readable in plain text or LaTeX. Set title to a short worksheet title. Set answer to a short reminder that the answer key follows the questions. Return only the required JSON object.`
      const content = window.mathCanvas?.solveProblem
        ? await window.mathCanvas.solveProblem(requestId, base64, prompt, preferences.model, () => {})
        : await streamOllamaSolution(base64, prompt, preferences.model, () => {}, controller.signal)
      const result = parseSolution(content)
      const questions = result.simpleSteps.slice(0, count)
      const answers = result.fullSteps.slice(0, count)
      if (questions.length !== count || answers.length !== count) throw new Error(`The model returned ${questions.length} questions and ${answers.length} answers; expected ${count} of each. Try generating again.`)
      setGenerated({ title: result.title, questions, answers })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (controller.signal.aborted) {
        void window.mathCanvas?.cancelProblem(requestId)
        setError('The local model took too long to respond. Wait for the model to load, then try again.')
      } else if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
        setError(`Could not reach Ollama on this computer. Install and start Ollama, then check that ${preferences.model} is installed.`)
      } else {
        setError(message)
      }
    } finally {
      window.clearTimeout(timeout)
      if (activeRequest.current?.id === requestId) activeRequest.current = undefined
      setLoading(false)
    }
  }

  const backToCanvas = () => {
    const request = activeRequest.current
    if (request) {
      request.controller.abort()
      void window.mathCanvas?.cancelProblem(request.id)
      activeRequest.current = undefined
    }
    onBack()
  }

  return <main className="solver-page">
    <header className="solver-topbar">
      <div className="solver-brand"><span className="brand-mark">∑</span>MathCanvas <span className="solver-divider">/</span> Test problem maker</div>
      <div className="solver-top-actions"><span className="local-badge">LOCAL AI · NO API KEY</span><button type="button" onClick={() => setSettingsOpen(true)}>Settings</button><button type="button" onClick={backToCanvas}>Back to canvas</button></div>
    </header>
    <div className="solver-content">
      <section className="solver-problem-card">
        <div className="solver-section-heading"><div><span className="solver-kicker">VISIBLE CANVAS SNAPSHOT</span><h2>Make a practice test</h2></div></div>
        <img className="solver-problem-image" src={image} alt="Visible MathCanvas workspace" />
        <label className="solver-field">Number of questions
          <select value={count} onChange={(event) => setCount(Number(event.target.value))}><option value={3}>3 questions</option><option value={5}>5 questions</option><option value={8}>8 questions</option></select>
        </label>
        <label className="solver-field">Focus (optional)
          <textarea value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="For example: factoring quadratics, graph intersections, or balancing forces." rows={3} />
        </label>
        <button type="button" className="primary solver-run-button" onClick={() => void generate()} disabled={loading}>{loading ? 'Creating questions…' : generated ? 'Generate another test' : 'Generate test from canvas'}</button>
        <p className="solver-privacy-note">The visible canvas snapshot is analyzed by Ollama on this computer. No cloud AI service or API key is used. Review generated questions and answers before using them.</p>
        {error && <div className="solver-error" role="alert"><strong>Could not make the test</strong><p>{error}</p></div>}
      </section>
      <section className="solver-answer-card">
        <div className="solver-section-heading"><div><span className="solver-kicker">PRACTICE QUESTIONS</span><h1>{generated?.title ?? (loading ? 'Reading the canvas' : 'Your test will appear here')}</h1></div></div>
        {loading && <div className="solver-loading"><span className="solver-spinner" /><div><strong>Analyzing the visible canvas</strong><p>Questions and a matching answer key are generated together.</p></div></div>}
        {generated && <>
          <h2>Questions</h2><ol className="test-problem-list">{generated.questions.map((question, index) => <li key={index}>{question}</li>)}</ol>
          <h2>Answer key</h2><ol className="test-problem-list">{generated.answers.map((answer, index) => <li key={index}>{answer}</li>)}</ol>
          <button type="button" className="primary solver-run-button" onClick={() => onAddToCanvas(generated)}>Add test and answer key to canvas</button>
        </>}
        {!generated && !loading && <p className="solver-empty">Choose the number of questions and an optional focus, then generate a fresh worksheet from the current canvas view.</p>}
      </section>
    </div>
    {settingsOpen && <SolverSettings preferences={preferences} onChange={onPreferencesChange} onClose={() => setSettingsOpen(false)} />}
  </main>
}

function createSolverPrompt(subject: string, instructions: string, problemText: string) {
  return `You are a precise, patient tutor solving an academic problem from an image. Solve it carefully; never guess illegible values or silently assume missing information. If the image is ambiguous, state exactly what is unclear and give a conditional solution only when useful.

Produce two distinct student-facing explanations for the SAME checked result:
1. simple_steps: a concise answer with the essential method and result.
2. full_steps: a thorough but focused derivation that shows equations, substitutions, intermediate calculations, units, and checks a student needs to learn and verify the work. Do not pad with repeated commentary.

Accuracy requirements: transcribe the given problem before solving; verify arithmetic and algebra by substitution or an independent check when possible. Read superscripts, subscripts, signs, decimal points, and variable names carefully. If a symbol is visually ambiguous and no correction is provided, identify the ambiguity and do not silently substitute another symbol or invent a solution. For chemistry, conserve each element and charge, balance the reaction, and include units/molar relationships. For physics, identify the governing law, define variables, track units/sign conventions, and check whether the result is physically sensible. Keep significant figures consistent with supplied values. If data are insufficient, explicitly say so rather than fabricate a numerical answer.

Math formatting: write every mathematical expression using LaTeX delimiters. Use \\( ... \\) for inline expressions and \\[ ... \\] for display equations; use proper LaTeX such as \\frac{a}{b}, \\sqrt{x}, x^{2}, x_{1}, \\pi, \\lim_{x\\to 0}, and \\frac{d}{dx}. Use display equations for important derivations and keep prose outside the delimiters. Do not use Markdown code fences for equations or rely on plain-text caret notation.

Return only valid JSON with properties in this order: title, simple_steps, full_steps, answer. Both step arrays must be non-empty. Do not include private chain-of-thought; provide only the concise educational derivation and verification a student can use. Subject preference: ${subject}. ${problemText ? `The student supplied this exact problem text; it is authoritative over uncertain visual OCR: ${problemText}` : 'No problem text was supplied. Transcribe the image carefully before solving.'} ${instructions ? `Additional user focus: ${instructions}` : ''}`
}

type Polynomial = number[]

export function solveTypedMathEquation(problemText: string): ProblemSolution | undefined {
  const normalized = problemText
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/([A-Za-z])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, variable: string, exponent: string) => {
      const digits: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' }
      return `${variable}^${[...exponent].map((digit) => digits[digit]).join('')}`
    })
  const sides = normalized.split('=')
  if (sides.length !== 2) return undefined

  const variables = new Set((normalized.match(/[A-Za-z_]\w*/g) ?? []).filter((name) => !['pi', 'e', 'tau'].includes(name)))
  if (variables.size !== 1) return undefined
  const variable = [...variables][0]
  let leftNode: MathNode
  let rightNode: MathNode
  try {
    leftNode = parse(sides[0])
    rightNode = parse(sides[1])
  } catch {
    return undefined
  }
  const left = polynomialFromNode(leftNode, variable)
  const right = polynomialFromNode(rightNode, variable)
  if (!left || !right) return undefined
  let coefficients = trimPolynomial(combinePolynomials(left, right, -1))
  if (coefficients.length > 3 || coefficients.some((coefficient) => !Number.isFinite(coefficient))) return undefined
  if (coefficients.length > 1 && coefficients[coefficients.length - 1] < 0) {
    coefficients = coefficients.map((coefficient) => -coefficient)
  }
  return buildPolynomialSolution(variable, coefficients)
}

function polynomialFromNode(node: MathNode, variable: string): Polynomial | undefined {
  if (node.type === 'ConstantNode') {
    const value = (node as ConstantNode).value
    return typeof value === 'number' && Number.isFinite(value) ? [value] : undefined
  }
  if (node.type === 'SymbolNode') return (node as SymbolNode).name === variable ? [0, 1] : undefined
  if (node.type === 'ParenthesisNode') return polynomialFromNode((node as ParenthesisNode).content, variable)
  if (node.type !== 'OperatorNode') return undefined

  const operator = node as OperatorNode
  const args = operator.args.map((argument) => polynomialFromNode(argument, variable))
  if (args.some((argument) => !argument)) return undefined
  if (args.length === 1) {
    if (operator.op === '+') return args[0]
    if (operator.op === '-') return args[0]?.map((coefficient) => -coefficient)
    return undefined
  }
  if (args.length !== 2) return undefined
  const left = args[0]!
  const right = args[1]!
  if (operator.op === '+') return combinePolynomials(left, right, 1)
  if (operator.op === '-') return combinePolynomials(left, right, -1)
  if (operator.op === '*') return multiplyPolynomials(left, right)
  if (operator.op === '/') {
    if (right.length !== 1 || right[0] === 0) return undefined
    return left.map((coefficient) => coefficient / right[0])
  }
  if (operator.op === '^') {
    if (right.length !== 1 || !Number.isInteger(right[0]) || right[0] < 0 || right[0] > 2) return undefined
    if (right[0] === 0) return [1]
    if (right[0] === 1) return left
    return multiplyPolynomials(left, left)
  }
  return undefined
}

function combinePolynomials(left: Polynomial, right: Polynomial, rightSign: number): Polynomial {
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => (left[index] ?? 0) + rightSign * (right[index] ?? 0))
}

function multiplyPolynomials(left: Polynomial, right: Polynomial): Polynomial | undefined {
  if (left.length + right.length - 2 > 2) return undefined
  const result = Array.from({ length: left.length + right.length - 1 }, () => 0)
  left.forEach((leftCoefficient, leftDegree) => right.forEach((rightCoefficient, rightDegree) => {
    result[leftDegree + rightDegree] += leftCoefficient * rightCoefficient
  }))
  return result
}

function trimPolynomial(coefficients: Polynomial): Polynomial {
  const result = [...coefficients]
  while (result.length > 1 && result[result.length - 1] === 0) result.pop()
  return result
}

function buildPolynomialSolution(variable: string, coefficients: Polynomial): ProblemSolution {
  const [constant = 0, linear = 0, quadratic = 0] = coefficients
  const equation = `\\(${formatPolynomial(variable, coefficients)} = 0\\)`
  const simpleSteps = [`Move all terms to one side: ${equation}.`]
  const fullSteps = [`Rewrite the equation in standard form: ${equation}.`]
  let answer: string

  if (quadratic === 0 && linear === 0) {
    answer = constant === 0 ? `Every real number is a solution for ${variable}.` : 'There is no solution.'
    simpleSteps.push(answer)
    fullSteps.push(constant === 0 ? 'Both sides reduce to the same expression, so the equation is an identity.' : `The left side is the nonzero constant ${formatNumber(constant)}, so it cannot equal zero.`)
  } else if (quadratic === 0) {
    const root = -constant / linear
    answer = `\\(${variable} = ${formatNumber(root)}\\)`
    simpleSteps.push(`Solve the linear equation to get ${answer}.`)
    fullSteps.push(`Isolate ${variable}: \\(${variable} = -(${formatNumber(constant)}) / ${formatNumber(linear)} = ${formatNumber(root)}\\).`)
  } else {
    const discriminant = linear * linear - 4 * quadratic * constant
    const discriminantText = `\\((${formatNumber(linear)})^{2} - 4(${formatNumber(quadratic)})(${formatNumber(constant)}) = ${formatNumber(discriminant)}\\)`
    const rootText = discriminant < 0
      ? `\\frac{${formatNumber(-linear)} \\pm i\\sqrt{${formatNumber(-discriminant)}}}{${formatNumber(2 * quadratic)}}`
      : discriminant === 0
        ? formatNumber(-linear / (2 * quadratic))
        : `\\frac{${formatNumber(-linear)} \\pm \\sqrt{${formatNumber(discriminant)}}}{${formatNumber(2 * quadratic)}}`
    simpleSteps.push(`The discriminant is Δ = ${discriminantText}.`)
    fullSteps.push(`The quadratic coefficients are \\(A = ${formatNumber(quadratic)}, B = ${formatNumber(linear)}, C = ${formatNumber(constant)}\\).`)
    fullSteps.push(`Calculate the discriminant using the coefficient values: ${discriminantText}.`)
    if (discriminant < 0) {
      const result = `\\(${variable} = ${rootText}\\)`
      simpleSteps.push(`There are no real roots; over the complex numbers, ${result}.`)
      fullSteps.push(`Since \\(Δ < 0\\), there are no real roots. Over the complex numbers, the quadratic formula gives ${result}.`)
      answer = `No real solutions. Over the complex numbers, ${result}.`
    } else {
      const result = `\\(${variable} = ${rootText}\\)`
      simpleSteps.push(`The solution${discriminant === 0 ? ' is' : 's are'} ${result}.`)
      fullSteps.push(`Apply the quadratic formula, \\(${variable} = \\frac{-B \\pm \\sqrt{Δ}}{2A}\\), to get ${result}.`)
      answer = result
    }
  }

  return { title: 'Verified equation solution', answer, simpleSteps, fullSteps }
}

function formatPolynomial(variable: string, coefficients: Polynomial): string {
  const terms: { negative: boolean; text: string }[] = []
  for (let degree = coefficients.length - 1; degree >= 0; degree--) {
    const coefficient = coefficients[degree]
    if (!coefficient) continue
    const magnitude = Math.abs(coefficient)
    const text = degree === 0
      ? formatNumber(magnitude)
      : `${magnitude === 1 ? '' : formatNumber(magnitude)}${variable}${degree === 1 ? '' : `^${degree}`}`
    terms.push({ negative: coefficient < 0, text })
  }
  return terms.length
    ? terms.map((term, index) => `${index === 0 ? (term.negative ? '- ' : '') : (term.negative ? ' - ' : ' + ')}${term.text}`).join('')
    : '0'
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(10)))
}

function parseSolution(content: string): ProblemSolution {
  const parsed = JSON.parse(content) as { title?: unknown; answer?: unknown; simple_steps?: unknown; full_steps?: unknown }
  const steps = (value: unknown) => Array.isArray(value) ? value.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).map((step) => step.trim()) : []
  const simpleSteps = steps(parsed.simple_steps)
  const fullSteps = steps(parsed.full_steps)
  if (typeof parsed.answer !== 'string' || !parsed.answer.trim() || !simpleSteps.length || !fullSteps.length) {
    throw new Error('The model response was missing its answer or solution steps. Try again.')
  }
  return { title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Worked solution', answer: parsed.answer.trim(), simpleSteps, fullSteps }
}

function RichSolutionText({ text }: { text: string }) {
  const segments = text.split(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g)
  return <>{segments.map((segment, index) => {
    const display = segment.startsWith('$$') || segment.startsWith('\\[')
    const isMath = display || segment.startsWith('\\(') || (segment.startsWith('$') && segment.endsWith('$'))
    if (!isMath) return <React.Fragment key={index}>{segment}</React.Fragment>
    const latex = segment.startsWith('$$') ? segment.slice(2, -2)
      : segment.startsWith('\\[') ? segment.slice(2, -2)
        : segment.startsWith('\\(') ? segment.slice(2, -2)
          : segment.slice(1, -1)
    try {
      return <span key={index} className={`solver-math ${display ? 'solver-math-display' : ''}`} dangerouslySetInnerHTML={{ __html: convertLatexToMarkup(latex) }} />
    } catch {
      return <span key={index}>{latex}</span>
    }
  })}</>
}

function SolutionVersion({ title, steps, live, onAdd }: { title: string; steps: string[]; live: boolean; onAdd?: () => void }) {
  return <section className="solver-version">
    <div className="solver-version-heading"><h3>{title}</h3>{live && <span className="solver-live-badge">LIVE</span>}</div>
    {steps.length
      ? <div className="solver-steps">{steps.map((step, index) => <div className="solver-step" key={`${index}-${step}`}><span>{index + 1}</span><p><RichSolutionText text={step} />{live && index === steps.length - 1 && <span className="solver-cursor" />}</p></div>)}</div>
      : <p className="solver-stream-hint">{live ? 'Being prepared…' : 'No steps available.'}</p>}
    {onAdd && <button type="button" className="solver-version-add" onClick={onAdd}>{title === 'Simple solution' ? 'Add simple solution' : 'Add full solution'}</button>}
  </section>
}

async function streamOllamaSolution(imageBase64: string, systemPrompt: string, model: string, onChunk: (text: string) => void, signal: AbortSignal) {
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      format: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          simple_steps: { type: 'array', items: { type: 'string' } },
          full_steps: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
        },
        required: ['title', 'simple_steps', 'full_steps', 'answer'],
      },
      options: { temperature: 0.1, top_p: 0.9, num_ctx: 8192 },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Read the attached problem image and solve it.', images: [imageBase64] },
      ],
    }),
    signal,
  })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Ollama returned ${response.status}: ${details.slice(0, 350)}`)
  }
  if (!response.body) throw new Error('Ollama did not provide a response stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let remainder = ''
  let content = ''
  const handleLine = (line: string) => {
    if (!line.trim()) return
    const result = JSON.parse(line) as { error?: string; message?: { content?: string } }
    if (result.error) throw new Error(`Ollama: ${result.error}`)
    if (typeof result.message?.content === 'string' && result.message.content) {
      content += result.message.content
      onChunk(result.message.content)
    }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      remainder += decoder.decode(value, { stream: !done })
      const lines = remainder.split('\n')
      remainder = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
      if (done) break
    }
    if (remainder.trim()) handleLine(remainder)
  } finally {
    reader.releaseLock()
  }
  if (!content.trim()) throw new Error('Ollama returned an empty solution.')
  return content
}

function previewSolution(content: string): SolutionPreview {
  return {
    title: readPartialJsonString(content, 'title'),
    simpleSteps: readPartialJsonStringArray(content, 'simple_steps'),
    fullSteps: readPartialJsonStringArray(content, 'full_steps'),
    answer: readPartialJsonString(content, 'answer'),
  }
}

function jsonPropertyValueStart(source: string, key: string) {
  const marker = JSON.stringify(key)
  const keyIndex = source.indexOf(marker)
  if (keyIndex < 0) return -1
  let index = keyIndex + marker.length
  while (index < source.length && /\s/.test(source[index])) index++
  if (source[index] !== ':') return -1
  index++
  while (index < source.length && /\s/.test(source[index])) index++
  return index
}

function readPartialJsonString(source: string, key: string) {
  const start = jsonPropertyValueStart(source, key)
  return start >= 0 && source[start] === '"' ? readJsonString(source, start).value : ''
}

function readPartialJsonStringArray(source: string, key: string) {
  const start = jsonPropertyValueStart(source, key)
  if (start < 0 || source[start] !== '[') return []
  const values: string[] = []
  let index = start + 1
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index++
    if (source[index] === ']' || index >= source.length || source[index] !== '"') break
    const result = readJsonString(source, index)
    if (result.value.trim()) values.push(result.value)
    if (!result.complete) break
    index = result.end
  }
  return values
}

function readJsonString(source: string, start: number) {
  let value = ''
  let index = start + 1
  while (index < source.length) {
    const character = source[index]
    if (character === '"') return { value, end: index + 1, complete: true }
    if (character !== '\\') {
      value += character
      index++
      continue
    }
    const escaped = source[index + 1]
    if (escaped === undefined) break
    const simpleEscapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
    if (escaped in simpleEscapes) {
      value += simpleEscapes[escaped]
      index += 2
    } else if (escaped === 'u' && /^[\da-f]{4}$/i.test(source.slice(index + 2, index + 6))) {
      value += String.fromCharCode(Number.parseInt(source.slice(index + 2, index + 6), 16))
      index += 6
    } else if (escaped === 'u' && index + 5 >= source.length) {
      break
    } else {
      value += escaped
      index += 2
    }
  }
  return { value, end: index, complete: false }
}
