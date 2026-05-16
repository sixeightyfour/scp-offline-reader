const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scpApp', {
  paths: ipcRenderer.sendSync('app:get-paths'),

  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  openPath: (filePath) => ipcRenderer.invoke('app:open-path', filePath),

  loadContent: () => ipcRenderer.invoke('content:load-all'),
  syncCromScp: () => ipcRenderer.invoke('crom:sync-scp'),

  onCromSyncLog: (callback) => {
    ipcRenderer.on('crom:sync-log', (_event, payload) => {
      callback(payload);
    });
  }
});