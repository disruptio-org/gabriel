// The only bridge between the renderer and the shell. It exposes window
// controls and two document actions, and nothing else - no filesystem, no
// Node, no credential access. The document actions take an id the service
// resolves, never a path the renderer chose.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pi', {
  minimize: () => ipcRenderer.invoke('pi:minimize'),
  close: () => ipcRenderer.invoke('pi:close'),
  toggleMaximize: () => ipcRenderer.invoke('pi:toggleMaximize'),
  isMaximized: () => ipcRenderer.invoke('pi:isMaximized'),
  setPhase: (phase) => ipcRenderer.invoke('pi:phase', phase),
  // Documents. Both take an index id, never a path: the renderer cannot name a
  // file to open, only point at one the service already knows about. Each
  // resolves to false when the id is unknown or the shell refused.
  openDocument: (id) => ipcRenderer.invoke('pi:openDocument', id),
  revealDocument: (id) => ipcRenderer.invoke('pi:revealDocument', id),
  onMaximizeChange: (cb) => {
    const h = (_e, v) => cb(v)
    ipcRenderer.on('pi:maximized', h)
    return () => ipcRenderer.off('pi:maximized', h)
  },
})
