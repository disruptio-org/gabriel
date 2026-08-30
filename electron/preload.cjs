// The only bridge between the renderer and the shell. It exposes window
// controls and nothing else - no filesystem, no Node, no credential access.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pi', {
  minimize: () => ipcRenderer.invoke('pi:minimize'),
  close: () => ipcRenderer.invoke('pi:close'),
  toggleMaximize: () => ipcRenderer.invoke('pi:toggleMaximize'),
  isMaximized: () => ipcRenderer.invoke('pi:isMaximized'),
  setPhase: (phase) => ipcRenderer.invoke('pi:phase', phase),
  onMaximizeChange: (cb) => {
    const h = (_e, v) => cb(v)
    ipcRenderer.on('pi:maximized', h)
    return () => ipcRenderer.off('pi:maximized', h)
  },
})
