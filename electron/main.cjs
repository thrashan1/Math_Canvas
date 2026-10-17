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
