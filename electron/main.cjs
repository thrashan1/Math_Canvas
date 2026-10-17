const fs = require('fs/promises')
const path = require('path')

const electron = require('electron')

if (typeof electron === 'string') {
  const { spawn } = require('child_process')
  const projectPath = path.resolve(__dirname, '..')
  const child = spawn(electron, [projectPath, ...process.argv.slice(2)], {
    cwd: projectPath,
    stdio: 'inherit',
    windowsHide: false,
  })

  child.on('error', (error) => {
    console.error(`Could not start MathCanvas with Electron: ${error.message}`)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
} else {
  initializeElectron(electron)
}

function initializeElectron({ app, BrowserWindow, dialog, ipcMain }) {
  let win
  const solverRequests = new Map()

  function createWindow() {
    win = new BrowserWindow({
      width: 1500,
      height: 950,
      minWidth: 1050,
      minHeight: 700,
      backgroundColor: '#eef1f5',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    const devUrl = 'http://127.0.0.1:5173'
    win.loadURL(devUrl).catch(() => {
      win.loadFile(path.join(__dirname, '../dist/index.html'))
    })

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }

  app.whenReady().then(() => {
    ipcMain.handle('solver:cancel', (_event, requestId) => {
      solverRequests.get(requestId)?.abort()
    })

    ipcMain.handle('solver:solve', async (event, requestId, imageBase64, systemPrompt) => {
      if (typeof requestId !== 'string' || !requestId || requestId.length > 100) {
        throw new Error('The problem-solving request ID is invalid.')
      }
      if (typeof imageBase64 !== 'string' || !imageBase64 || imageBase64.length > 10_000_000) {
        throw new Error('The selected image is empty or too large. Select a smaller problem area.')
      }
      if (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.length > 12_000) {
        throw new Error('The problem-solving instructions are invalid.')
      }
      const controller = new AbortController()
      solverRequests.set(requestId, controller)
      const timeout = setTimeout(() => controller.abort(), 300_000)
      try {
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen2.5vl:3b',
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
          signal: controller.signal,
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
        const handleLine = (line) => {
          if (!line.trim()) return
          let result
          try {
            result = JSON.parse(line)
          } catch (error) {
            throw new Error(`Ollama returned an invalid response stream: ${error.message}`)
          }
          if (result.error) throw new Error(`Ollama: ${result.error}`)
          const text = result.message?.content
          if (typeof text === 'string' && text) {
            content += text
            event.sender.send('solver:chunk', { requestId, text })
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
      } finally {
        clearTimeout(timeout)
        if (solverRequests.get(requestId) === controller) solverRequests.delete(requestId)
      }
    })

    ipcMain.handle('project:saveAs', async (_event, json) => {
      const result = await dialog.showSaveDialog(win, {
        title: 'Save MathCanvas Project',
        defaultPath: 'MathCanvas.mathcanvas',
        filters: [{ name: 'MathCanvas project', extensions: ['mathcanvas'] }],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      await fs.writeFile(result.filePath, json, 'utf8')
      return { canceled: false, filePath: result.filePath }
    })

    ipcMain.handle('project:save', async (_event, filePath, json) => {
      await fs.writeFile(filePath, json, 'utf8')
      return { canceled: false, filePath }
    })

    ipcMain.handle('project:open', async () => {
      const result = await dialog.showOpenDialog(win, {
        title: 'Open MathCanvas Project',
        properties: ['openFile'],
        filters: [{ name: 'MathCanvas project', extensions: ['mathcanvas', 'json'] }],
      })
      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      const filePath = result.filePaths[0]
      const json = await fs.readFile(filePath, 'utf8')
      return { canceled: false, filePath, json }
    })

    ipcMain.handle('project:autosave', async (_event, json) => {
      const filePath = path.join(app.getPath('userData'), 'autosave.mathcanvas')
      await fs.writeFile(filePath, json, 'utf8')
      return { filePath }
    })

    ipcMain.handle('project:loadAutosave', async () => {
      const filePath = path.join(app.getPath('userData'), 'autosave.mathcanvas')
      try {
        const json = await fs.readFile(filePath, 'utf8')
        return { exists: true, json }
      } catch {
        return { exists: false }
      }
    })

    ipcMain.handle('project:exportText', async (_event, text) => {
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Text',
        defaultPath: 'math-work.txt',
        filters: [{ name: 'Text', extensions: ['txt'] }],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      await fs.writeFile(result.filePath, text, 'utf8')
      return { canceled: false, filePath: result.filePath }
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

}
