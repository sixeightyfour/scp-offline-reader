const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

function getBundledDataDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app-data');
  }
  return __dirname;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    title: 'SCP Reader',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  // win.webContents.openDevTools();
}

ipcMain.on('app:get-paths', (event) => {
  const bundledDataDir = getBundledDataDir();

  event.returnValue = {
    contentDir: bundledDataDir,
    userDataDir: app.getPath('userData'),
    userCacheDir: path.join(app.getPath('userData'), 'image-cache'),
    userManifestPath: path.join(app.getPath('userData'), 'image-manifest.json'),
    bundledCacheDir: path.join(bundledDataDir, 'image_cache'),
    bundledManifestPath: path.join(bundledDataDir, 'image-manifest.json'),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    bundledDataDir
  };
});

ipcMain.handle('app:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Invalid external URL');
  }

  await shell.openExternal(url);
});

ipcMain.handle('app:open-path', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Invalid file path');
  }

  return shell.openPath(filePath);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});