// Bridge for the tray menu window only: it receives the items to draw and reports
// which one was chosen. Nothing else from the app is exposed to it.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('trayMenu', {
  onItems: callback => {
    if (typeof callback !== 'function') return
    ipcRenderer.on('qwen-audio-agent:tray-menu-items', (_event, items) => callback(items))
  },
  choose: id => ipcRenderer.send('qwen-audio-agent:tray-menu-choose', String(id)),
  close: () => ipcRenderer.send('qwen-audio-agent:tray-menu-close'),
})
