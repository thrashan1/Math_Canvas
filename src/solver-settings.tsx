import React, { useCallback, useEffect, useState } from 'react'

export type SolverPreferences = {
  darkMode: boolean
  onScreenKeyboard: boolean
  iconSize: 'small' | 'standard' | 'large'
  interfaceTextSize: 'small' | 'standard' | 'large'
  model: string
  defaultSubject: string
  answerStyle: 'both' | 'simple' | 'full'
  textSize: 'normal' | 'large'
}

type OllamaModel = { name: string; size?: number }

const STORAGE_KEY = 'mathcanvas.solver-preferences'
const OLLAMA_API = 'http://127.0.0.1:11434'
export const DEFAULT_SOLVER_PREFERENCES: SolverPreferences = {
  darkMode: false,
  onScreenKeyboard: false,
  iconSize: 'standard',
  interfaceTextSize: 'standard',
  model: 'qwen3-vl:4b',
  defaultSubject: 'Auto-detect',
  answerStyle: 'both',
  textSize: 'normal',
}

export const RECOMMENDED_MODELS = [
  { name: 'qwen3-vl:4b', title: 'Qwen3-VL 4B', description: 'Recommended · newer vision and reasoning model; good balance for 8 GB GPUs.', size: 'about 3 GB' },
  { name: 'qwen3-vl:8b', title: 'Qwen3-VL 8B', description: 'More capable, but slower and may exceed 8 GB GPU memory at long context.', size: 'about 6 GB' },
  { name: 'qwen3-vl:2b', title: 'Qwen3-VL 2B', description: 'Smallest and fastest option for lower memory or quicker responses.', size: 'about 1.5 GB' },
  { name: 'qwen2.5vl:3b', title: 'Qwen2.5-VL 3B', description: 'Previous-generation fallback; included for existing installations.', size: 'about 2 GB' },
] as const

function loadPreferences(): SolverPreferences {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return DEFAULT_SOLVER_PREFERENCES
    const value = JSON.parse(saved) as Partial<SolverPreferences>
    const sizes = ['small', 'standard', 'large'] as const
    return {
      darkMode: value.darkMode === true,
      onScreenKeyboard: value.onScreenKeyboard === true,
      iconSize: sizes.includes(value.iconSize as typeof sizes[number]) ? value.iconSize! : 'standard',
      interfaceTextSize: sizes.includes(value.interfaceTextSize as typeof sizes[number]) ? value.interfaceTextSize! : 'standard',
      model: typeof value.model === 'string' && value.model.trim() ? value.model : DEFAULT_SOLVER_PREFERENCES.model,
      defaultSubject: ['Auto-detect', 'Math', 'Chemistry', 'Physics'].includes(value.defaultSubject ?? '') ? value.defaultSubject! : DEFAULT_SOLVER_PREFERENCES.defaultSubject,
      answerStyle: value.answerStyle === 'simple' || value.answerStyle === 'full' ? value.answerStyle : 'both',
      textSize: value.textSize === 'large' ? 'large' : 'normal',
    }
  } catch {
    return DEFAULT_SOLVER_PREFERENCES
  }
}

export function useSolverPreferences() {
  const [preferences, setPreferences] = useState(loadPreferences)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    document.documentElement.dataset.theme = preferences.darkMode ? 'dark' : 'light'
    document.documentElement.dataset.iconSize = preferences.iconSize
    document.documentElement.dataset.interfaceTextSize = preferences.interfaceTextSize
  }, [preferences])
  const update = useCallback((patch: Partial<SolverPreferences>) => setPreferences((current) => ({ ...current, ...patch })), [])
  return [preferences, update] as const
}

function formatSize(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes)) return 'Size unavailable'
  const gibibytes = bytes / (1024 ** 3)
  return `${gibibytes >= 1 ? gibibytes.toFixed(1) : (bytes / (1024 ** 2)).toFixed(0)} ${gibibytes >= 1 ? 'GB' : 'MB'}`
}

export function SolverSettings({ preferences, onChange, onClose }: {
  preferences: SolverPreferences
  onChange: (patch: Partial<SolverPreferences>) => void
  onClose: () => void
}) {
  const [installed, setInstalled] = useState<OllamaModel[]>([])
  const [customModel, setCustomModel] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busyModel, setBusyModel] = useState('')
  const [progress, setProgress] = useState('')

  const refreshInstalled = useCallback(async () => {
    setError('')
    try {
      const response = await fetch(`${OLLAMA_API}/api/tags`)
      if (!response.ok) throw new Error(`Ollama returned ${response.status} while listing models.`)
      const result = await response.json() as { models?: OllamaModel[] }
      setInstalled(Array.isArray(result.models) ? result.models : [])
    } catch (cause) {
      setError(`Could not connect to local Ollama at 127.0.0.1:11434. Install and start Ollama to browse or install models. ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }, [])

  useEffect(() => { void refreshInstalled() }, [refreshInstalled])

  const installModel = async (model: string) => {
    const normalized = model.trim()
    if (!/^[\w.-]+(?:\/[\w.-]+)*:[\w.-]+$/.test(normalized) || normalized.length > 180) {
      setError('Enter a valid Ollama model tag, such as qwen3-vl:4b.')
      return
    }
    setBusyModel(normalized)
    setError('')
    setStatus('')
    setProgress('Starting download…')
    try {
      const response = await fetch(`${OLLAMA_API}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: normalized, stream: true }),
      })
      if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${(await response.text()).slice(0, 300)}`)
      if (!response.body) throw new Error('Ollama did not provide download progress.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let remainder = ''
      const handleLine = (line: string) => {
        if (!line.trim()) return
        const result = JSON.parse(line) as { status?: string; error?: string; completed?: number; total?: number }
        if (result.error) throw new Error(result.error)
        const percent = result.total && result.completed !== undefined ? ` · ${Math.floor(result.completed / result.total * 100)}%` : ''
        setProgress(`${result.status ?? 'Downloading model'}${percent}`)
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
      await refreshInstalled()
      onChange({ model: normalized })
      setStatus(`${normalized} is installed and selected.`)
      setProgress('')
    } catch (cause) {
      setProgress('')
      setError(`Could not install ${normalized}: ${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusyModel('')
    }
  }

  const useModel = (model: string) => {
    onChange({ model })
    setStatus(`${model} will be used for the next solution.`)
    setError('')
  }

  const allModels = new Map<string, OllamaModel>()
  installed.forEach((model) => allModels.set(model.name, model))

  return <div className="solver-settings-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="solver-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="solver-settings-title">
      <header className="solver-settings-heading"><div><span className="solver-kicker">LOCAL PREFERENCES</span><h2 id="solver-settings-title">Settings</h2></div><button type="button" aria-label="Close settings" onClick={onClose}>×</button></header>
      <div className="solver-settings-scroll">
        <section className="solver-settings-section">
          <h3>General</h3>
          <p>Adjust the appearance and equation-entry experience across MathCanvas.</p>
          <label className="solver-settings-toggle"><span><b>Dark mode</b><small>Use a darker workspace and interface.</small></span><input type="checkbox" checked={preferences.darkMode} onChange={(event) => onChange({ darkMode: event.target.checked })} /></label>
          <label className="solver-settings-toggle"><span><b>On-screen math keyboard</b><small>Open the math keyboard when editing an equation.</small></span><input type="checkbox" checked={preferences.onScreenKeyboard} onChange={(event) => onChange({ onScreenKeyboard: event.target.checked })} /></label>
          <label className="solver-settings-label">Toolbar icon size
            <span>Change the size of icons in the canvas toolbar.</span>
            <select value={preferences.iconSize} onChange={(event) => onChange({ iconSize: event.target.value as SolverPreferences['iconSize'] })}>
              <option value="small">Small</option><option value="standard">Standard</option><option value="large">Large</option>
            </select>
          </label>
          <label className="solver-settings-label">Interface text size
            <span>Scale the on-screen interface for comfortable reading.</span>
            <select value={preferences.interfaceTextSize} onChange={(event) => onChange({ interfaceTextSize: event.target.value as SolverPreferences['interfaceTextSize'] })}>
              <option value="small">Small</option><option value="standard">Standard</option><option value="large">Large</option>
            </select>
          </label>
        </section>
        <section className="solver-settings-section">
          <h3>AI models · local only</h3>
          <p>Models run on this computer through Ollama. No prompts, images, or solutions are sent to a cloud AI service.</p>
          <div className="solver-installed-list">
            <strong>Installed models</strong>
            {allModels.size ? [...allModels.values()].map((model) => <div className="solver-model-row" key={model.name}>
              <div><b>{model.name}</b><span>{formatSize(model.size)}{preferences.model === model.name ? ' · Current model' : ''}</span></div>
              <button type="button" className={preferences.model === model.name ? 'selected' : ''} onClick={() => useModel(model.name)}>{preferences.model === model.name ? 'In use' : 'Use'}</button>
            </div>) : <span className="solver-settings-muted">No models found yet. Install one below.</span>}
          </div>
          {!installed.some((model) => model.name === preferences.model) && <p className="solver-settings-muted">The selected model ({preferences.model}) is not installed yet. Install it below or choose an installed model.</p>}
          <strong className="solver-settings-subheading">Recommended vision models</strong>
          <div className="solver-recommended-list">{RECOMMENDED_MODELS.map((model) => {
            const installedModel = installed.find((entry) => entry.name === model.name || entry.name.startsWith(`${model.name}-`))
            const isBusy = busyModel === model.name
            return <div className="solver-recommended-model" key={model.name}>
              <div><b>{model.title}</b><span>{model.description}</span><small>{model.name} · {model.size} download</small></div>
              {installedModel
                ? <button type="button" className={preferences.model === installedModel.name ? 'selected' : ''} onClick={() => useModel(installedModel.name)}>{preferences.model === installedModel.name ? 'In use' : 'Use'}</button>
                : <button type="button" disabled={Boolean(busyModel)} onClick={() => void installModel(model.name)}>{isBusy ? 'Installing…' : 'Install & use'}</button>}
            </div>
          })}</div>
          <label className="solver-settings-label">Install another Ollama model
            <span>Enter a model tag from the Ollama library.</span>
            <div className="solver-custom-model"><input value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="e.g. qwen3-vl:4b" /><button type="button" disabled={!customModel.trim() || Boolean(busyModel)} onClick={() => void installModel(customModel)}>Install & use</button></div>
          </label>
          {progress && <p className="solver-settings-progress" role="status">{progress}</p>}
          {status && <p className="solver-settings-status" role="status">{status}</p>}
          {error && <p className="solver-settings-error" role="alert">{error}</p>}
          <button type="button" className="solver-settings-refresh" onClick={() => void refreshInstalled()}>Refresh installed models</button>
          <p className="solver-settings-note">Qwen models are open-weight and run locally. The 4B model is recommended for laptops with 8 GB graphics memory. Downloads require an internet connection; inference stays on-device.</p>
        </section>
        <section className="solver-settings-section">
          <h3>Problem solver</h3>
          <label className="solver-settings-label">Default subject
            <span>Preselected each time you open the solver.</span>
            <select value={preferences.defaultSubject} onChange={(event) => onChange({ defaultSubject: event.target.value })}>
              <option>Auto-detect</option><option>Math</option><option>Chemistry</option><option>Physics</option>
            </select>
          </label>
          <label className="solver-settings-label">Solution layout
            <span>Show both explanations or focus on one.</span>
            <select value={preferences.answerStyle} onChange={(event) => onChange({ answerStyle: event.target.value as SolverPreferences['answerStyle'] })}>
              <option value="both">Show simple and full solutions</option><option value="simple">Show simple solution only</option><option value="full">Show full solution only</option>
            </select>
          </label>
          <label className="solver-settings-label">Solution text size
            <span>Increase step text for easier reading.</span>
            <select value={preferences.textSize} onChange={(event) => onChange({ textSize: event.target.value as SolverPreferences['textSize'] })}>
              <option value="normal">Standard</option><option value="large">Larger text</option>
            </select>
          </label>
        </section>
      </div>
      <footer className="solver-settings-footer"><button type="button" className="primary" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}
