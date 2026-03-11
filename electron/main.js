const { app, BrowserWindow, shell, dialog, ipcMain, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, exec } = require('child_process');
const { createServer } = require('../server/index.js');

let mainWindow;
let notesWindow;
let server;
const PORT = 31822;

// Claude session monitor state
let claudeMonitorInterval = null;
const overlayWindows = new Map();
const windowReadyState = new Map();
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'session-manager-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function startServer() {
  const staticDir = path.join(__dirname, '..', 'client', 'dist');
  const expressApp = createServer(staticDir);

  return new Promise((resolve, reject) => {
    server = expressApp.listen(PORT, '127.0.0.1', () => {
      console.log(`Server started on http://127.0.0.1:${PORT}`);
      resolve();
    });
    server.on('error', reject);
  });
}

function getIconPath() {
  if (process.platform === 'win32') return path.join(__dirname, '..', 'assets', 'icon.ico');
  if (process.platform === 'linux') return path.join(__dirname, '..', 'assets', 'icon.png');
  return path.join(__dirname, '..', 'assets', 'icon.icns');
}

function getTitleBarStyle() {
  return process.platform === 'darwin' ? 'hiddenInset' : 'default';
}

function openMdEditor(url) {
  // Extract filename from URL for the title
  const params = new URL(url).searchParams;
  const filePath = params.get('path') || '';
  const fileName = filePath.split('/').pop() || 'Editor';

  const editorWindow = new BrowserWindow({
    width: 700,
    height: 650,
    minWidth: 400,
    minHeight: 300,
    title: fileName,
    titleBarStyle: getTitleBarStyle(),
    backgroundColor: '#1a1a2e',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  editorWindow.loadURL(url);
}

function openNotesWindow() {
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.focus();
    return;
  }

  notesWindow = new BrowserWindow({
    width: 520,
    height: 620,
    minWidth: 350,
    minHeight: 300,
    title: 'Notes',
    titleBarStyle: getTitleBarStyle(),
    backgroundColor: '#1a1a2e',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'notes-preload.js'),
    },
  });

  notesWindow.loadURL(`http://127.0.0.1:${PORT}/notes.html`);

  notesWindow.on('closed', () => {
    notesWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: 'Session Manager',
    titleBarStyle: getTitleBarStyle(),
    backgroundColor: '#0a0b10',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'main-preload.js'),
    },
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev && process.env.VITE_DEV) {
    mainWindow.loadURL('http://localhost:3001');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('/notes.html')) {
      openNotesWindow();
      return { action: 'deny' };
    }
    if (url.includes('/md-editor.html')) {
      openMdEditor(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: Show native save dialog, return chosen path
ipcMain.handle('notes-save-dialog', async (event, content) => {
  const result = await dialog.showSaveDialog(notesWindow, {
    title: 'Save Notes',
    defaultPath: path.join(os.homedir(), 'Desktop', 'notes.md'),
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { canceled: true };
  fs.writeFileSync(result.filePath, content);
  return { canceled: false, filePath: result.filePath };
});

// IPC: Save to an already-chosen path
ipcMain.handle('notes-save-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: Show native folder picker dialog
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Folder',
    properties: ['openDirectory'],
    defaultPath: os.homedir(),
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

// Screenshot path-to-clipboard watcher
let screenshotInterval = null;
let lastScreenshotFiles = new Set();

function getScreenshotFolder() {
  if (process.platform === 'darwin') {
    try {
      const loc = execSync('defaults read com.apple.screencapture location', { encoding: 'utf-8' }).trim();
      if (loc && fs.existsSync(loc)) return loc;
    } catch {}
    return path.join(os.homedir(), 'Desktop');
  } else if (process.platform === 'win32') {
    // Windows default screenshot folder
    const pictures = path.join(os.homedir(), 'Pictures', 'Screenshots');
    if (fs.existsSync(pictures)) return pictures;
    return path.join(os.homedir(), 'Desktop');
  } else {
    // Linux: common screenshot locations
    const xdgPictures = path.join(os.homedir(), 'Pictures');
    if (fs.existsSync(xdgPictures)) return xdgPictures;
    return path.join(os.homedir(), 'Desktop');
  }
}

function isScreenshotFile(filename) {
  if (process.platform === 'darwin') {
    return filename.startsWith('Screenshot') && filename.endsWith('.png');
  } else if (process.platform === 'win32') {
    return filename.startsWith('Screenshot') && filename.endsWith('.png');
  } else {
    // Linux: various naming conventions
    return filename.endsWith('.png') && (
      filename.startsWith('Screenshot') ||
      filename.startsWith('screenshot') ||
      filename.startsWith('Scr_')
    );
  }
}

function startScreenshotWatcher() {
  const settings = loadSettings();
  if (settings.screenshotClipboard === false) return;

  const folder = getScreenshotFolder();
  console.log(`Watching for screenshots in: ${folder}`);

  stopScreenshotWatcher();

  // Seed with existing screenshots so we don't trigger on old files
  try {
    const files = fs.readdirSync(folder);
    files.forEach(f => {
      if (isScreenshotFile(f)) {
        lastScreenshotFiles.add(f);
      }
    });
  } catch {}

  // Poll every second for new screenshot files
  screenshotInterval = setInterval(() => {
    try {
      const files = fs.readdirSync(folder);
      for (const filename of files) {
        if (!isScreenshotFile(filename)) continue;
        if (lastScreenshotFiles.has(filename)) continue;

        lastScreenshotFiles.add(filename);
        const fullPath = path.join(folder, filename);
        clipboard.writeText(fullPath);
        const notif = new Notification({
          title: 'Screenshot path copied',
          body: filename,
          silent: true,
        });
        notif.show();
      }
    } catch {}
  }, 1000);
}

function stopScreenshotWatcher() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
  }
}

// Watch settings file for changes to screenshot toggle
let settingsWatcher = null;
function watchSettings() {
  const settingsPath = SETTINGS_FILE;
  if (settingsWatcher) settingsWatcher.close();
  try {
    settingsWatcher = fs.watch(settingsPath, () => {
      const s = loadSettings();
      if (s.screenshotClipboard === false) {
        stopScreenshotWatcher();
      } else if (!screenshotInterval) {
        startScreenshotWatcher();
  watchSettings();
      }
    });
  } catch {}
}

// --- Claude Session Monitor ---

function isClaudeSession(content) {
  // Claude Code terminals have the status bar with bypass permissions toggle
  return content.includes('bypass permissions');
}

function isClaudeReady(content) {
  // Claude Code shows ❯ or > on its own line when waiting for input.
  // Below the prompt there's a status bar (⏵⏵ bypass permissions...) and blank lines.
  // Check if any line in the last ~15 lines is just the prompt character.
  const lines = content.split('\n');
  const tail = lines.slice(-15);
  for (const line of tail) {
    const trimmed = line.trim();
    if (trimmed === '>' || trimmed === '❯') return true;
  }
  return false;
}

function startClaudeMonitor() {
  if (claudeMonitorInterval) return;
  const scriptPath = path.join(__dirname, 'poll-terminals.applescript');
  if (!fs.existsSync(scriptPath)) return;

  claudeMonitorInterval = setInterval(() => {
    exec(`osascript "${scriptPath}"`, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        // No terminal windows or error — hide all overlays
        for (const [id, overlay] of overlayWindows) {
          if (!overlay.isDestroyed()) overlay.hide();
        }
        return;
      }

      const windowChunks = stdout.split('<<<SEP>>>').filter(Boolean);
      const activeIds = new Set();

      for (const chunk of windowChunks) {
        const pipeIdx = chunk.indexOf('|');
        if (pipeIdx === -1) continue;
        const windowId = chunk.slice(0, pipeIdx).trim();

        const rest = chunk.slice(pipeIdx + 1);
        const pipeIdx2 = rest.indexOf('|');
        if (pipeIdx2 === -1) continue;
        const boundsStr = rest.slice(0, pipeIdx2);
        const content = rest.slice(pipeIdx2 + 1);

        if (!isClaudeSession(content)) continue;
        activeIds.add(windowId);

        const bounds = boundsStr.split(',').map(Number);
        if (bounds.length < 4) continue;

        const ready = isClaudeReady(content);
        const wasReady = windowReadyState.get(windowId) || false;

        if (ready && !wasReady) {
          // Transition: working → ready
          showOverlay(windowId, bounds);
          playReadySound();
        } else if (ready && wasReady) {
          // Still ready — update position
          updateOverlayPosition(windowId, bounds);
        } else if (!ready) {
          // Working — hide
          hideOverlay(windowId);
        }

        windowReadyState.set(windowId, ready);
      }

      // Clean up overlays for closed windows
      for (const [id] of overlayWindows) {
        if (!activeIds.has(id)) {
          hideOverlay(id);
          windowReadyState.delete(id);
        }
      }
    });
  }, 2500);
}

function stopClaudeMonitor() {
  if (claudeMonitorInterval) {
    clearInterval(claudeMonitorInterval);
    claudeMonitorInterval = null;
  }
  for (const [id, overlay] of overlayWindows) {
    if (!overlay.isDestroyed()) overlay.close();
  }
  overlayWindows.clear();
  windowReadyState.clear();
}

function showOverlay(windowId, bounds) {
  const overlaySize = 80;
  const x = bounds[2] - overlaySize - 16;
  const y = bounds[3] - overlaySize - 16;

  if (overlayWindows.has(windowId)) {
    const existing = overlayWindows.get(windowId);
    if (!existing.isDestroyed()) {
      existing.setPosition(x, y);
      existing.show();
      return;
    }
  }

  const overlay = new BrowserWindow({
    width: overlaySize,
    height: overlaySize,
    x, y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    type: 'panel',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  overlay.setIgnoreMouseEvents(true);
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadURL(`http://127.0.0.1:${PORT}/sprite-overlay.html`);
  overlayWindows.set(windowId, overlay);
}

function hideOverlay(windowId) {
  const overlay = overlayWindows.get(windowId);
  if (overlay && !overlay.isDestroyed()) {
    overlay.hide();
  }
}

function updateOverlayPosition(windowId, bounds) {
  const overlay = overlayWindows.get(windowId);
  if (!overlay || overlay.isDestroyed()) return;
  const overlaySize = 80;
  const x = bounds[2] - overlaySize - 16;
  const y = bounds[3] - overlaySize - 16;
  overlay.setPosition(x, y);
}

function playReadySound() {
  exec('afplay /System/Library/Sounds/Tink.aiff');
}

// --- End Claude Session Monitor ---

app.whenReady().then(async () => {
  // Sync launch-at-login with saved settings
  const settings = loadSettings();
  app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });

  await startServer();
  createWindow();
  startScreenshotWatcher();
  startClaudeMonitor();
  watchSettings();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopScreenshotWatcher();
  stopClaudeMonitor();
  if (server) {
    server.close();
  }
});
