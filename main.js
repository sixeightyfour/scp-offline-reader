const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { renderWikidotSourceToHtml } = require('./scripts/ftml_render');
const defaultComponents = require('./scripts/default_components');

app.commandLine.appendSwitch('disable-crash-reporter');

const { syncCromScpDataset } = require('./scripts/sync_crom_scp');

const {
  flattenContentFiles,
  cacheImagesForEntries,
  cancelActiveImageCacheJob,
  resolveCachedImage
} = require('./scripts/image_cache_service');

let mainWindow = null;

process.on('uncaughtException', (err) => {
  console.error('[main uncaughtException]', err && (err.stack || err));
});

process.on('unhandledRejection', (reason) => {
  console.error('[main unhandledRejection]', reason && (reason.stack || reason));
});

app.on('before-quit', () => {
  console.error('[app] before-quit');
});

app.on('will-quit', () => {
  console.error('[app] will-quit');
});

app.on('quit', (_event, exitCode) => {
  console.error('[app] quit', { exitCode });
});

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

  // Priority order matters:
  // userData first, bundled repo data second.
  // If the same filename exists in both places, userData wins.
  const candidateDirs = [userDataDir, bundledDataDir];

  const filesByName = new Map();

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const name of fs.readdirSync(dir)) {
      if (!/^content_.*\.json$/i.test(name)) continue;

      if (filesByName.has(name)) {
        console.warn('[content] skipped duplicate content file', {
          file: name,
          skippedPath: path.join(dir, name),
          keptPath: filesByName.get(name).fullPath
        });

        continue;
      }

      filesByName.set(name, {
        name,
        fullPath: path.join(dir, name),
        sourceDir: dir
      });
    }
  }

  const files = [...filesByName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  const merged = [];

  for (const file of files) {
    try {
      const parsed = loadJsonFile(file.fullPath);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn('[content] skipped non-object JSON file', file.fullPath);
        continue;
      }

      merged.push({
        file: file.name,
        sourceDir: file.sourceDir,
        data: parsed
      });

      console.log('[content] loaded', {
        file: file.name,
        sourceDir: file.sourceDir,
        count: Object.keys(parsed).length
      });
    } catch (err) {
      console.error('[content] failed to load JSON file', {
        file: file.fullPath,
        error: err && (err.stack || err.message || String(err))
      });
    }
  }

  console.log('[content] total files loaded', merged.length);

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
  mainWindow = new BrowserWindow({
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

  mainWindow.on('closed', () => {
    console.error('[mainWindow] closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-start-loading', () => {
    console.error('[webContents] did-start-loading');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.error('[webContents] did-finish-load');

    mainWindow.webContents.openDevTools({
      mode: 'detach'
    });
  });

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('[webContents] did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL
      });
    }
  );

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[webContents] render-process-gone', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[webContents] unresponsive');
  });

  mainWindow.webContents.on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      console.error(`[renderer console:${level}] ${message} (${sourceId}:${line})`);
    }
  );

  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch((err) => {
    console.error('[mainWindow.loadFile failed]', err && (err.stack || err));
  });
}

ipcMain.on('app:get-paths', (event) => {
  const bundledDataDir = getBundledDataDir();
  const userDataDir = app.getPath('userData');

  event.returnValue = {
    contentDir: bundledDataDir,
    userDataDir,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    bundledDataDir,
    userCacheDir: path.join(userDataDir, 'image_cache'),
    userManifestPath: path.join(userDataDir, 'image-manifest.json'),
    bundledCacheDir: path.join(bundledDataDir, 'image_cache'),
    bundledManifestPath: path.join(bundledDataDir, 'image-manifest.json')
  };
});

ipcMain.handle('app:open-external', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Invalid external URL');
  }

  await shell.openExternal(url);
});

ipcMain.handle('content:load-all', async () => {
  return loadContentJsonFiles();
});

ipcMain.handle('images:cache-all', async (event) => {
  const contentFiles = loadContentJsonFiles();
  const entries = flattenContentFiles(contentFiles);

  return cacheImagesForEntries({
    entries,
    userDataDir: app.getPath('userData'),
    onProgress: (progress) => {
      event.sender.send('images:cache-progress', progress);
    }
  });
});

ipcMain.handle('images:cancel-cache', async () => {
  return cancelActiveImageCacheJob();
});

ipcMain.handle('images:resolve-cached', async (_event, { url, entry }) => {
  return resolveCachedImage({
    url,
    entry,
    userDataDir: app.getPath('userData'),
    bundledDataDir: getBundledDataDir()
  });
});

ipcMain.handle('app:open-path', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('Invalid file path');
  }

  const userDataDir = path.resolve(app.getPath('userData'));
  const bundledDataDir = path.resolve(getBundledDataDir());
  const resolved = path.resolve(filePath);

  const allowed =
    resolved === userDataDir ||
    resolved.startsWith(userDataDir + path.sep) ||
    resolved === bundledDataDir ||
    resolved.startsWith(bundledDataDir + path.sep);

  if (!allowed) {
    throw new Error('Refusing to open a path outside app data directories');
  }

  await shell.openPath(resolved);
});

ipcMain.handle('crom:sync-scp', async () => {
  const outputPath = path.join(app.getPath('userData'), 'content_crom_scp.json');

  console.log('[Crom sync] IPC sync request received.');

  sendToRenderer('crom:sync-log', {
    level: 'info',
    message: 'Crom sync request received.'
  });

  try {
    const result = await syncCromScpDataset(outputPath, {
      onProgress: (progress) => {
        const range =
          `SCP-${String(progress.current).padStart(3, '0')} through ` +
          `SCP-${String(progress.end).padStart(3, '0')}`;

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
    console.error('[Crom sync] Sync failed:', err && (err.stack || err));

    sendToRenderer('crom:sync-log', {
      level: 'error',
      message: `Crom sync failed: ${err.message || String(err)}`
    });

    throw err;
  }
});

ipcMain.handle('tools:render-ftml-preview', async (_event, payload = {}) => {
  const source = String(payload.source || '');

  if (!source.trim()) {
    return '';
  }

  const info = {
    page: 'offline-editor-preview',
    slug: 'offline-editor-preview',
    key: 'offline-editor-preview',
    title: 'Offline Editor Preview',
    site: 'scp-wiki',
    rating: 0,
    score: 0,
    tags: [],
    includeStore: defaultComponents
  };

  const result = await renderWikidotSourceToHtml(source, info);

  if (typeof result === 'string') {
    return result;
  }

  if (result && typeof result === 'object') {
    return (
      result.html ||
      result.output ||
      result.rendered ||
      result.renderedHtml ||
      result.body ||
      ''
    );
  }

  return String(result || '');
});

app.whenReady().then(() => {
  console.error('[app] ready');

  createWindow();

  app.on('activate', () => {
    console.error('[app] activate');

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.error('[app] window-all-closed');

  if (process.platform !== 'darwin') {
    app.quit();
  }
});