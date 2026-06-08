const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scpApp', {
  paths: ipcRenderer.sendSync('app:get-paths'),

  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  openPath: (filePath) => ipcRenderer.invoke('app:open-path', filePath),

  loadContent: () => ipcRenderer.invoke('content:load-all'),

  syncCromScp: () => ipcRenderer.invoke('crom:sync-scp'),

  cacheAllImages: () => ipcRenderer.invoke('images:cache-all'),

  cancelImageCache: () => ipcRenderer.invoke('images:cancel-cache'),

  resolveCachedImage: (url, entry) =>
    ipcRenderer.invoke('images:resolve-cached', { url, entry }),

  renderFtmlPreview: (source) =>
    ipcRenderer.invoke('tools:render-ftml-preview', { source }),

  onCromSyncLog: (callback) => {
    const listener = (_event, payload) => callback(payload);

    ipcRenderer.on('crom:sync-log', listener);

    return () => {
      ipcRenderer.removeListener('crom:sync-log', listener);
    };
  },

  onImageCacheProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);

    ipcRenderer.on('images:cache-progress', listener);

    return () => {
      ipcRenderer.removeListener('images:cache-progress', listener);
    };
  }
});