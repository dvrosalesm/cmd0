const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cmd0', {
  onFocus: (cb) => ipcRenderer.on('widget:focus', cb),
  onNeedKey: (cb) => ipcRenderer.on('agent:need-key', cb),
  onReady: (cb) => ipcRenderer.on('agent:ready', cb),
  onKeyError: (cb) => ipcRenderer.on('agent:key-error', (_e, msg) => cb(msg)),
  setKey: (key, model) => ipcRenderer.send('agent:set-key', key, model),
  prompt: (text) => ipcRenderer.send('agent:prompt', text),
  promptWithImage: (text, imageBase64) => ipcRenderer.send('agent:prompt-image', text, imageBase64),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('agent:done', cb),
  screenshot: () => ipcRenderer.invoke('screenshot'),
  cancel: () => ipcRenderer.send('agent:cancel'),
  steer: (text) => ipcRenderer.send('agent:steer', text),
  relaunchSafe: () => ipcRenderer.send('relaunch-safe'),
  isSafeMode: () => ipcRenderer.invoke('is-safe-mode'),
  move: (dx, dy) => ipcRenderer.send('widget:move', { dx, dy }),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  readClipboardFiles: () => ipcRenderer.invoke('read-clipboard-files'),
  snapshot: (name) => ipcRenderer.invoke('snapshot', name),
  restoreSnapshot: (name) => ipcRenderer.invoke('restore-snapshot', name),
  listSnapshots: () => ipcRenderer.invoke('list-snapshots'),
});
