const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const fs = require('fs');
const { syncCromScpDataset } = require('./scripts/sync_crom_scp');

function getBundledDataDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app-data');
  }
  return __dirname;
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadContentJsonFiles() {
  const bundledDataDir = getBundledDataDir();
  const userDataDir = app.getPath('userData');

  const candidateDirs = [
    userDataDir,
    bundledDataDir
  ];

  const files = [];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const name of fs.readdirSync(dir)) {
      if (/^content_.*\.json$/i.test(name)) {
        files.push({
          name,
          fullPath: path.join(dir, name),
          sourceDir: dir
        });
      }
    }
  }

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const merged = [];

  for (const file of files) {
    const parsed = loadJsonFile(file.fullPath);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    merged.push({
      file: file.name,
      data: parsed
    });
  }

  return merged;
}

function sendToRenderer(channel, payload) {
  const windows = BrowserWindow.getAllWindows();

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
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
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Invalid path');
  }

  return shell.openPath(filePath);
});

ipcMain.handle('content:load-all', async () => {
  return loadContentJsonFiles();
});

ipcMain.handle('crom:sync-scp', async () => {
  const outputPath = path.join(app.getPath('userData'), 'content_crom_scp.json');

  console.log(`[Crom sync] IPC sync request received.`);

  sendToRenderer('crom:sync-log', {
    level: 'info',
    message: 'Crom sync request received.'
  });

  try {
    const result = await syncCromScpDataset(outputPath, {
      onProgress: (progress) => {
        const range = `SCP-${String(progress.current).padStart(3, '0')} through SCP-${String(progress.end).padStart(3, '0')}`;

        const message =
          progress.phase === 'batch-complete'
            ? `Batch ${progress.batchNumber}/${progress.totalBatches} complete: ${range}; added ${progress.addedThisBatch}, missing ${progress.missingThisBatch}, total ${progress.articleCount}`
            : progress.phase === 'batch-failed'
              ? `Batch ${progress.batchNumber}/${progress.totalBatches} failed: ${range}; ${progress.error}`
              : `Batch ${progress.batchNumber}/${progress.totalBatches}: requesting ${range}`;

        console.log(`[Crom sync] ${message}`);

        sendToRenderer('crom:sync-log', {
          level: progress.phase === 'batch-failed' ? 'error' : 'info',
          message,
          progress
        });
      }
    });

    sendToRenderer('crom:sync-log', {
      level: 'info',
      message: `Crom sync complete: ${result.articleCount} articles written to ${result.outputPath}`,
      result
    });

    return result;
  } catch (err) {
    console.error('[Crom sync] Sync failed:', err);

    sendToRenderer('crom:sync-log', {
      level: 'error',
      message: `Crom sync failed: ${err.message || String(err)}`
    });

    throw err;
  }
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