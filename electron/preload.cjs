const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mathCanvas', {
  saveAs: (json) => ipcRenderer.invoke('project:saveAs', json),
  save: (filePath, json) => ipcRenderer.invoke('project:save', filePath, json),
  open: () => ipcRenderer.invoke('project:open'),
  autosave: (json) => ipcRenderer.invoke('project:autosave', json),
  loadAutosave: () => ipcRenderer.invoke('project:loadAutosave'),
  exportText: (text) => ipcRenderer.invoke('project:exportText', text),
})
