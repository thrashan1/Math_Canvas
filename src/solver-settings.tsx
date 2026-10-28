import React, { useCallback, useEffect, useState } from 'react'

export type SolverPreferences = {
  darkMode: boolean
  theme: BuiltinThemeId | 'custom'
  customTheme: ThemeColors
  themeSeed: string
  layoutPreset: 'default' | 'top-heavy' | 'left-heavy' | 'right-heavy' | 'bottom-heavy' | 'floating' | 'photoshop' | 'paint' | 'onenote' | 'focus'
  onScreenKeyboard: boolean
  iconSize: 'small' | 'standard' | 'large'
  interfaceTextSize: 'small' | 'standard' | 'large'
  model: string
  defaultSubject: string
  answerStyle: 'both' | 'simple' | 'full'
  textSize: 'normal' | 'large'
}

type OllamaModel = { name: string; size?: number }

type ThemeColors = { app: string; surface: string; canvas: string; accent: string; active: string; border: string; text: string }
const THEME_COLOR_KEYS = ['app', 'surface', 'canvas', 'accent', 'active', 'border', 'text'] as const
const BUILTIN_THEME_IDS = ['light', 'dark', 'paper', 'midnight', 'mint', 'pink', 'blue', 'pastel', 'rose', 'ocean', 'forest', 'lavender', 'solarized', 'high-contrast', 'gray', 'silver', 'smoke', 'graphite', 'charcoal', 'deep-ocean', 'emerald-night', 'plum-night', 'burgundy-night', 'indigo-night', 'twilight', 'dusk', 'denim'] as const
type BuiltinThemeId = typeof BUILTIN_THEME_IDS[number]

const THEME_PALETTES: Record<BuiltinThemeId, ThemeColors> = {
  light: { app: '#e9edf2', surface: '#ffffff', canvas: '#f8fafc', accent: '#1f6feb', active: '#e4efff', border: '#d8dee7', text: '#1f2937' },
  dark: { app: '#111827', surface: '#1f2937', canvas: '#111827', accent: '#60a5fa', active: '#1e3a5f', border: '#374151', text: '#e2e8f0' },
  paper: { app: '#e9e1d1', surface: '#fffaf0', canvas: '#fffdf6', accent: '#9a6b27', active: '#f2e3c7', border: '#dfd3bc', text: '#433d32' },
  midnight: { app: '#0c1425', surface: '#17243b', canvas: '#111b2e', accent: '#78aaff', active: '#263b5d', border: '#2c4264', text: '#dce8fa' },
  mint: { app: '#e6f2ec', surface: '#f7fff9', canvas: '#fbfffc', accent: '#20845d', active: '#d8f1e4', border: '#c4dfd0', text: '#244438' },
  pink: { app: '#f8eaf0', surface: '#fff8fb', canvas: '#fffafd', accent: '#c13f79', active: '#f9dce9', border: '#ecc8d8', text: '#4b2c3b' },
  blue: { app: '#e7effb', surface: '#f8fbff', canvas: '#fcfdff', accent: '#2866c7', active: '#dce9ff', border: '#c8d8ef', text: '#263b5b' },
  pastel: { app: '#f2edf8', surface: '#fffcff', canvas: '#fffefe', accent: '#8065c4', active: '#ece4fb', border: '#ddd3ef', text: '#403755' },
  rose: { app: '#f5e7e5', surface: '#fff9f7', canvas: '#fffdfb', accent: '#b44b51', active: '#f5dede', border: '#e7c9c6', text: '#4a3032' },
  ocean: { app: '#e3eff2', surface: '#f6fcfd', canvas: '#fcffff', accent: '#087e8b', active: '#d3eef0', border: '#c2dfe2', text: '#203d43' },
  forest: { app: '#e8eee6', surface: '#f8fcf6', canvas: '#fcfefa', accent: '#4b773b', active: '#deecd8', border: '#cbdcc4', text: '#344332' },
  lavender: { app: '#efebf7', surface: '#fbf9ff', canvas: '#fefcff', accent: '#7655b5', active: '#e8e0f7', border: '#d8cdec', text: '#3e3454' },
  solarized: { app: '#eee8d5', surface: '#fdf6e3', canvas: '#fffbef', accent: '#268bd2', active: '#e5e9d8', border: '#d9d2b8', text: '#586e75' },
  'high-contrast': { app: '#e5e7eb', surface: '#ffffff', canvas: '#ffffff', accent: '#0037b3', active: '#d6e2ff', border: '#475569', text: '#111827' },
  gray: { app: '#c4c6c9', surface: '#d3d5d8', canvas: '#e4e5e7', accent: '#555b63', active: '#b5b8bc', border: '#aeb1b5', text: '#282b30' },
  silver: { app: '#a5a8ac', surface: '#b7babf', canvas: '#c9ccd0', accent: '#454a50', active: '#999da2', border: '#8e9297', text: '#22252a' },
  smoke: { app: '#777a7e', surface: '#85888d', canvas: '#92959a', accent: '#f1f3f5', active: '#666a70', border: '#a4a7ab', text: '#ffffff' },
  graphite: { app: '#505358', surface: '#5d6066', canvas: '#696d73', accent: '#f1f3f5', active: '#73777e', border: '#81858c', text: '#f5f6f7' },
  charcoal: { app: '#303236', surface: '#3b3e43', canvas: '#45494f', accent: '#e5e7eb', active: '#50545b', border: '#666a71', text: '#f3f4f6' },
  'deep-ocean': { app: '#0f2338', surface: '#172f49', canvas: '#1b3853', accent: '#52c7df', active: '#234b64', border: '#31536a', text: '#e0f3f8' },
  'emerald-night': { app: '#14251e', surface: '#1c3328', canvas: '#223b30', accent: '#67d39b', active: '#294b39', border: '#385d49', text: '#e4f2e9' },
  'plum-night': { app: '#261a32', surface: '#342342', canvas: '#3d2a4c', accent: '#d29df4', active: '#4b315e', border: '#634777', text: '#f3e8fa' },
  'burgundy-night': { app: '#2c171d', surface: '#3b2028', canvas: '#472731', accent: '#f08a9c', active: '#552e3a', border: '#70414c', text: '#f8e9eb' },
  'indigo-night': { app: '#1a1f3a', surface: '#242b4c', canvas: '#2b3459', accent: '#98a8ff', active: '#353f6a', border: '#4a5684', text: '#ecefff' },
  twilight: { app: '#c4cbd7', surface: '#d2d8e1', canvas: '#e1e5eb', accent: '#526b91', active: '#b5c0d0', border: '#aab4c2', text: '#293547' },
  dusk: { app: '#c9bfce', surface: '#d7cfda', canvas: '#e5e0e7', accent: '#735d7c', active: '#bdb0c5', border: '#b4a9ba', text: '#382f3e' },
  denim: { app: '#b9c9d8', surface: '#cbd7e2', canvas: '#dce4eb', accent: '#3c628b', active: '#a9bfd3', border: '#9aafc3', text: '#293b4d' },
}

function isDarkTheme(theme: SolverPreferences['theme']) {
  if (theme === 'custom') return false
  const color = THEME_PALETTES[theme].app
  const channels = color.slice(1).match(/.{2}/g)?.map((part) => {
    const value = parseInt(part, 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }) ?? [1, 1, 1]
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] < .24
}

const STORAGE_KEY = 'mathcanvas.solver-preferences'
const OLLAMA_API = 'http://127.0.0.1:11434'
export const DEFAULT_SOLVER_PREFERENCES: SolverPreferences = {
  darkMode: false,
  theme: 'light',
  customTheme: THEME_PALETTES.light,
  themeSeed: '#1f6feb',
  layoutPreset: 'default',
  onScreenKeyboard: false,
  iconSize: 'standard',
  interfaceTextSize: 'standard',
  model: 'qwen3-vl:4b',
  defaultSubject: 'Auto-detect',
  answerStyle: 'both',
  textSize: 'normal',
}

export function getThemeWorkspaceBackground(preferences: Pick<SolverPreferences, 'theme' | 'customTheme'>) {
  return preferences.theme === 'custom' ? preferences.customTheme.app : THEME_PALETTES[preferences.theme].app
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
    const themes = [...BUILTIN_THEME_IDS, 'custom'] as const
    const layouts = ['default', 'top-heavy', 'left-heavy', 'right-heavy', 'bottom-heavy', 'floating', 'photoshop', 'paint', 'onenote', 'focus'] as const
    const theme = themes.includes(value.theme as typeof themes[number]) ? value.theme! : value.darkMode ? 'dark' : 'light'
    const validColor = (color: unknown): color is string => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)
    const savedColors = value.customTheme as Partial<ThemeColors> | undefined
    const customTheme = Object.fromEntries((['app', 'surface', 'canvas', 'accent', 'active', 'border', 'text'] as const).map((key) => [key, validColor(savedColors?.[key]) ? savedColors[key] : DEFAULT_SOLVER_PREFERENCES.customTheme[key]])) as ThemeColors
    return {
      darkMode: isDarkTheme(theme),
      theme,
      customTheme,
      themeSeed: validColor(value.themeSeed) ? value.themeSeed : DEFAULT_SOLVER_PREFERENCES.themeSeed,
      layoutPreset: layouts.includes(value.layoutPreset as typeof layouts[number]) ? value.layoutPreset! : 'default',
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
    const dark = isDarkTheme(preferences.theme)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.dataset.colorTheme = preferences.theme
    document.documentElement.dataset.variableTheme = 'true'
    document.documentElement.dataset.layout = preferences.layoutPreset
    document.documentElement.dataset.iconSize = preferences.iconSize
    document.documentElement.dataset.interfaceTextSize = preferences.interfaceTextSize
    const palette = preferences.theme === 'custom' ? preferences.customTheme : THEME_PALETTES[preferences.theme]
    const root = document.documentElement.style
    root.setProperty('--mc-app', palette.app)
    root.setProperty('--mc-surface', palette.surface)
    root.setProperty('--mc-canvas', palette.canvas)
    root.setProperty('--mc-accent', palette.accent)
    root.setProperty('--mc-active', palette.active)
    root.setProperty('--mc-border', palette.border)
    root.setProperty('--mc-text', palette.text)
  }, [preferences])
  const update = useCallback((patch: Partial<SolverPreferences>) => setPreferences((current) => {
    const next = { ...current, ...patch }
    if (patch.theme) next.darkMode = isDarkTheme(patch.theme)
    else if (patch.darkMode !== undefined) next.theme = patch.darkMode ? 'dark' : 'light'
    return next
  }), [])
  return [preferences, update] as const
}

function formatSize(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes)) return 'Size unavailable'
  const gibibytes = bytes / (1024 ** 3)
  return `${gibibytes >= 1 ? gibibytes.toFixed(1) : (bytes / (1024 ** 2)).toFixed(0)} ${gibibytes >= 1 ? 'GB' : 'MB'}`
}

function blendHex(first: string, second: string, secondWeight: number) {
  const a = first.slice(1).match(/.{2}/g)?.map((part) => parseInt(part, 16)) ?? [255, 255, 255]
  const b = second.slice(1).match(/.{2}/g)?.map((part) => parseInt(part, 16)) ?? [31, 111, 235]
  return `#${a.map((value, index) => Math.round(value * (1 - secondWeight) + b[index] * secondWeight).toString(16).padStart(2, '0')).join('')}`
}

function makeAutoTheme(seed: string): ThemeColors {
  const channels = seed.slice(1).match(/.{2}/g)?.map((part) => {
    const value = parseInt(part, 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }) ?? [1, 1, 1]
  const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
  const accent = luminance > .3 ? blendHex(seed, '#152238', .55) : seed
  return {
    app: blendHex('#ffffff', seed, .09),
    surface: blendHex('#ffffff', seed, .035),
    canvas: blendHex('#ffffff', seed, .015),
    accent,
    active: blendHex('#ffffff', seed, .18),
    border: blendHex('#ffffff', seed, .25),
    text: '#263445',
  }
}

function makeThemeCode(colors: ThemeColors) {
  const encoded = btoa(JSON.stringify({ version: 1, colors }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `MC-THEME-1:${encoded}`
}

function parseThemeCode(code: string): ThemeColors {
  const match = /^MC-THEME-1:([A-Za-z0-9_-]+)$/.exec(code.trim())
  if (!match) throw new Error('Theme code format not recognized. It should start with MC-THEME-1:.')
  const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - match[1].length % 4) % 4)
  let payload: unknown
  try {
    payload = JSON.parse(atob(base64))
  } catch {
    throw new Error('Theme code is malformed or incomplete.')
  }
  if (!payload || typeof payload !== 'object' || !('version' in payload) || payload.version !== 1 || !('colors' in payload) || !payload.colors || typeof payload.colors !== 'object') {
    throw new Error('Unsupported theme code version or missing colors.')
  }
  const colors = payload.colors as Record<string, unknown>
  if (!THEME_COLOR_KEYS.every((key) => typeof colors[key] === 'string' && /^#[\da-f]{6}$/i.test(colors[key] as string))) {
    throw new Error('Theme code must contain valid six-digit hex colors for every theme color.')
  }
  return Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, colors[key]])) as ThemeColors
}

export function SolverSettings({ preferences, onChange, onClose }: {
  preferences: SolverPreferences
  onChange: (patch: Partial<SolverPreferences>) => void
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'appearance' | 'workspace' | 'ai' | 'solver'>('appearance')
  const [experimentalPage, setExperimentalPage] = useState(false)
  const [themeCodeInput, setThemeCodeInput] = useState('')
  const [themeCodeStatus, setThemeCodeStatus] = useState('')
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

  const tabs = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'workspace', label: 'Layout' },
    { id: 'ai', label: 'AI & Models' },
    { id: 'solver', label: 'Solver' },
  ] as const
  const layouts = [
    { id: 'default', title: 'Default', description: 'Tools left, inspector right.' },
    { id: 'top-heavy', title: 'Top heavy', description: 'Tools in a horizontal top strip.' },
    { id: 'left-heavy', title: 'Left heavy', description: 'Math tools and layers dock left.' },
    { id: 'right-heavy', title: 'Right heavy', description: 'Inspector-first layout with a wide right dock.' },
    { id: 'bottom-heavy', title: 'Bottom heavy', description: 'Inspector and tools dock below the canvas.' },
    { id: 'floating', title: 'Floating toolbar', description: 'Keep drawing tools over the canvas.' },
    { id: 'photoshop', title: 'Photoshop', description: 'Creative-suite tool rail and expanded panels.' },
    { id: 'paint', title: 'Microsoft Paint', description: 'Compact drawing ribbon with familiar docking.' },
    { id: 'onenote', title: 'OneNote', description: 'Notebook-inspired ribbon and workspace panels.' },
    { id: 'focus', title: 'Focus', description: 'Compact sidebars for a less cluttered workspace.' },
  ] as const
  const experimentalThemes = [
    { id: 'mint', title: 'Mint', description: 'Fresh green accents' },
    { id: 'pink', title: 'Pink', description: 'Soft rose and berry' },
    { id: 'blue', title: 'Blue', description: 'Classic cool blue' },
    { id: 'pastel', title: 'Pastel', description: 'Gentle lavender tones' },
    { id: 'rose', title: 'Rose', description: 'Warm blush palette' },
    { id: 'ocean', title: 'Ocean', description: 'Teal and sea-glass' },
    { id: 'forest', title: 'Forest', description: 'Muted botanical green' },
    { id: 'lavender', title: 'Lavender', description: 'Soft purple surfaces' },
    { id: 'solarized', title: 'Solarized', description: 'Warm, low-glare colors' },
    { id: 'high-contrast', title: 'High contrast', description: 'Sharper borders and contrast' },
  ] as const
  const neutralThemes = [
    { id: 'gray', title: 'Gray', description: 'Soft, neutral mid-gray surfaces' },
    { id: 'silver', title: 'Silver', description: 'Cooler gray, still bright' },
    { id: 'smoke', title: 'Smoke', description: 'Quiet, dim neutral gray' },
    { id: 'graphite', title: 'Graphite', description: 'Dark matte gray surfaces' },
    { id: 'charcoal', title: 'Charcoal', description: 'Deep neutral, lighter than midnight' },
  ] as const
  const darkColorThemes = [
    { id: 'deep-ocean', title: 'Deep ocean', description: 'Dark navy with a bright teal accent' },
    { id: 'emerald-night', title: 'Emerald night', description: 'Forest-dark green with mint accents' },
    { id: 'plum-night', title: 'Plum night', description: 'Deep violet with soft lilac accents' },
    { id: 'burgundy-night', title: 'Burgundy night', description: 'Warm wine-dark surfaces and rose accents' },
    { id: 'indigo-night', title: 'Indigo night', description: 'Inky indigo with periwinkle accents' },
  ] as const
  const inBetweenThemes = [
    { id: 'twilight', title: 'Twilight', description: 'Cool slate between light and dark' },
    { id: 'dusk', title: 'Dusk', description: 'Muted mauve-gray with a gentle violet accent' },
    { id: 'denim', title: 'Denim', description: 'Soft, mid-tone blue-gray' },
  ] as const
  const updateAutoTheme = (seed: string) => onChange({ themeSeed: seed, theme: 'custom', customTheme: makeAutoTheme(seed) })
  const customThemeCode = makeThemeCode(preferences.customTheme)
  const importThemeCode = () => {
    try {
      const customTheme = parseThemeCode(themeCodeInput)
      onChange({ theme: 'custom', customTheme })
      setThemeCodeStatus('Theme imported and applied.')
    } catch (cause) {
      setThemeCodeStatus(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const copyThemeCode = async () => {
    try {
      await navigator.clipboard.writeText(customThemeCode)
      setThemeCodeStatus('Theme code copied.')
    } catch (cause) {
      setThemeCodeStatus(`Could not copy theme code: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  return <div className="solver-settings-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="solver-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="solver-settings-title">
      <header className="solver-settings-heading"><div><span className="solver-kicker">{experimentalPage ? 'EXPERIMENTAL' : 'LOCAL PREFERENCES'}</span><h2 id="solver-settings-title">{experimentalPage ? 'Experimental themes' : 'Settings'}</h2></div><div className="solver-settings-heading-actions">{experimentalPage && <button type="button" onClick={() => setExperimentalPage(false)}>Back to settings</button>}<button type="button" aria-label="Close settings" onClick={onClose}>×</button></div></header>
      {!experimentalPage && <nav className="solver-settings-tabs" role="tablist" aria-label="Settings categories">
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-selected={activeTab === tab.id} aria-controls={`settings-panel-${tab.id}`} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </nav>}
      <div className="solver-settings-scroll">
        {experimentalPage && <section className="solver-settings-section experimental-theme-page">
          <div className="experimental-theme-intro"><h3>Try something adventurous</h3><p>These themes are experimental. Your choice is saved locally, and you can return to a standard theme at any time.</p></div>
          <div className="settings-theme-grid experimental-theme-grid">
            {experimentalThemes.map((theme) => {
              const palette = THEME_PALETTES[theme.id]
              return <button key={theme.id} type="button" className={`settings-theme-card${preferences.theme === theme.id ? ' selected' : ''}`} aria-pressed={preferences.theme === theme.id} onClick={() => onChange({ theme: theme.id })}>
                <span className="experimental-theme-swatch" style={{ background: palette.app, borderColor: palette.border }}><i style={{ background: palette.accent }} /><i style={{ background: palette.surface }} /><i style={{ background: palette.active }} /></span>
                <b>{theme.title}</b><small>{theme.description}</small>
              </button>
            })}
          </div>
          <div className="experimental-neutral-heading"><h3>Dark color themes</h3><p>Deep, tinted palettes with softened surfaces and readable accent colors.</p></div>
          <div className="settings-theme-grid experimental-theme-grid">
            {darkColorThemes.map((theme) => {
              const palette = THEME_PALETTES[theme.id]
              return <button key={theme.id} type="button" className={`settings-theme-card${preferences.theme === theme.id ? ' selected' : ''}`} aria-pressed={preferences.theme === theme.id} onClick={() => onChange({ theme: theme.id })}>
                <span className="experimental-theme-swatch" style={{ background: palette.app, borderColor: palette.border }}><i style={{ background: palette.accent }} /><i style={{ background: palette.surface }} /><i style={{ background: palette.active }} /></span>
                <b>{theme.title}</b><small>{theme.description}</small>
              </button>
            })}
          </div>
          <div className="experimental-neutral-heading"><h3>In between</h3><p>Mid-tone palettes for a softer transition between bright and dark themes.</p></div>
          <div className="settings-theme-grid experimental-theme-grid">
            {inBetweenThemes.map((theme) => {
              const palette = THEME_PALETTES[theme.id]
              return <button key={theme.id} type="button" className={`settings-theme-card${preferences.theme === theme.id ? ' selected' : ''}`} aria-pressed={preferences.theme === theme.id} onClick={() => onChange({ theme: theme.id })}>
                <span className="experimental-theme-swatch" style={{ background: palette.app, borderColor: palette.border }}><i style={{ background: palette.accent }} /><i style={{ background: palette.surface }} /><i style={{ background: palette.active }} /></span>
                <b>{theme.title}</b><small>{theme.description}</small>
              </button>
            })}
          </div>
          <div className="experimental-neutral-heading"><h3>Neutral & darker</h3><p>Muted gray presets that step gradually from light into dark without a strong color tint.</p></div>
          <div className="settings-theme-grid experimental-theme-grid">
            {neutralThemes.map((theme) => {
              const palette = THEME_PALETTES[theme.id]
              return <button key={theme.id} type="button" className={`settings-theme-card${preferences.theme === theme.id ? ' selected' : ''}`} aria-pressed={preferences.theme === theme.id} onClick={() => onChange({ theme: theme.id })}>
                <span className="experimental-theme-swatch" style={{ background: palette.app, borderColor: palette.border }}><i style={{ background: palette.accent }} /><i style={{ background: palette.surface }} /><i style={{ background: palette.active }} /></span>
                <b>{theme.title}</b><small>{theme.description}</small>
              </button>
            })}
          </div>
          <section className="experimental-builder">
            <div><h3>Auto theme builder</h3><p>Pick one color and MathCanvas derives a coordinated accent, active state, panel tint, and borders.</p></div>
            <label className="experimental-seed-picker">Seed color<input type="color" value={preferences.themeSeed} onChange={(event) => updateAutoTheme(event.target.value)} /></label>
            <button type="button" className="primary" onClick={() => updateAutoTheme(preferences.themeSeed)}>Generate from this color</button>
          </section>
          <section className="experimental-builder">
            <div><h3>Custom theme builder</h3><p>Set each workspace color yourself. Changes preview immediately and are saved as your custom theme.</p></div>
            <div className="custom-theme-colors">
              {([
                ['app', 'Workspace background'],
                ['surface', 'Panels and toolbar'],
                ['canvas', 'Canvas surround'],
                ['accent', 'Accent color'],
                ['active', 'Selected tool'],
                ['border', 'Borders'],
                ['text', 'Interface text'],
              ] as const).map(([key, label]) => <label key={key}>{label}<input type="color" value={preferences.customTheme[key]} onChange={(event) => onChange({ theme: 'custom', customTheme: { ...preferences.customTheme, [key]: event.target.value } })} /></label>)}
            </div>
            <button type="button" className="primary" onClick={() => onChange({ theme: 'custom' })}>Use custom theme</button>
            <section className="theme-code-tools" aria-label="Custom theme code import and export">
              <h4>Theme code</h4>
              <p>Copy a compact code to share this custom palette, or paste a code to import someone else’s theme.</p>
              <label>Export code<textarea readOnly value={customThemeCode} onFocus={(event) => event.currentTarget.select()} /></label>
              <button type="button" onClick={() => void copyThemeCode()}>Copy theme code</button>
              <label>Import code<textarea value={themeCodeInput} onChange={(event) => { setThemeCodeInput(event.target.value); setThemeCodeStatus('') }} placeholder="Paste an MC-THEME-1 code" /></label>
              <button type="button" className="primary" disabled={!themeCodeInput.trim()} onClick={importThemeCode}>Import and apply</button>
              {themeCodeStatus && <p className="theme-code-status" role="status">{themeCodeStatus}</p>}
            </section>
          </section>
        </section>}
        {!experimentalPage && <>
        <section className="solver-settings-section" role="tabpanel" id="settings-panel-appearance" aria-labelledby="settings-tab-appearance" hidden={activeTab !== 'appearance'}>
          <h3>Appearance</h3>
          <p>Choose the color theme and interface sizing used across MathCanvas.</p>
          <div className="settings-theme-grid" aria-label="Color themes">
            {([
              { id: 'light', title: 'Light', description: 'Clean, bright interface' },
              { id: 'dark', title: 'Dark', description: 'Dim neutral surfaces' },
              { id: 'paper', title: 'Paper', description: 'Warm notebook tones' },
              { id: 'midnight', title: 'Midnight', description: 'Deep blue dark theme' },
            ] as const).map((theme) => <button key={theme.id} type="button" className={`settings-theme-card theme-${theme.id}${preferences.theme === theme.id ? ' selected' : ''}`} aria-pressed={preferences.theme === theme.id} onClick={() => onChange({ theme: theme.id })}>
              <span className="settings-theme-preview" aria-hidden="true"><i /><i /><i /></span><b>{theme.title}</b><small>{theme.description}</small>
            </button>)}
          </div>
          <button type="button" className="experimental-themes-button" onClick={() => setExperimentalPage(true)}>More experimental themes <span aria-hidden="true">→</span></button>
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
        <section className="solver-settings-section" role="tabpanel" id="settings-panel-workspace" aria-labelledby="settings-tab-workspace" hidden={activeTab !== 'workspace'}>
          <h3>Workspace layout</h3>
          <p>Choose where toolbars and panels sit. Presets change the arrangement, not your canvas content.</p>
          <div className="settings-layout-grid">
            {layouts.map((layout) => <button key={layout.id} type="button" className={`settings-layout-card${preferences.layoutPreset === layout.id ? ' selected' : ''}`} aria-pressed={preferences.layoutPreset === layout.id} onClick={() => onChange({ layoutPreset: layout.id })}>
              <span className={`settings-layout-preview layout-preview-${layout.id}`} aria-hidden="true"><i /><i /><i /></span>
              <b>{layout.title}</b><small>{layout.description}</small>
            </button>)}
          </div>
        </section>
        <section className="solver-settings-section" role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai" hidden={activeTab !== 'ai'}>
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
        <section className="solver-settings-section" role="tabpanel" id="settings-panel-solver" aria-labelledby="settings-tab-solver" hidden={activeTab !== 'solver'}>
          <h3>Problem solver</h3>
          <label className="solver-settings-toggle"><span><b>On-screen math keyboard</b><small>Open the math keyboard when editing an equation.</small></span><input type="checkbox" checked={preferences.onScreenKeyboard} onChange={(event) => onChange({ onScreenKeyboard: event.target.checked })} /></label>
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
        </>}
      </div>
      <footer className="solver-settings-footer"><button type="button" className="primary" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}
