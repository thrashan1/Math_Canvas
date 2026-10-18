const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mathCanvas', {
  saveAs: (json) => ipcRenderer.invoke('project:saveAs', json),
  save: (filePath, json) => ipcRenderer.invoke('project:save', filePath, json),
  open: () => ipcRenderer.invoke('project:open'),
  autosave: (json) => ipcRenderer.invoke('project:autosave', json),
  loadAutosave: () => ipcRenderer.invoke('project:loadAutosave'),
  exportText: (text) => ipcRenderer.invoke('project:exportText', text),
  solveProblem: (requestId, imageBase64, systemPrompt, model, onChunk) => {
    const handleChunk = (_event, payload) => {
      if (payload?.requestId === requestId && typeof payload.text === 'string') onChunk(payload.text)
    }
    ipcRenderer.on('solver:chunk', handleChunk)
    return ipcRenderer.invoke('solver:solve', requestId, imageBase64, systemPrompt, model)
      .finally(() => ipcRenderer.removeListener('solver:chunk', handleChunk))
  },
  cancelProblem: (requestId) => ipcRenderer.invoke('solver:cancel', requestId),
})
