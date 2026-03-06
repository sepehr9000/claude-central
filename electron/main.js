const { app, BrowserWindow, shell, dialog, ipcMain, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { createServer } = require('../server/index.js');

let mainWindow;
let notesWindow;
let server;
const PORT = 31822;
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
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    icon: path.join(__dirname, '..', 'assets', 'icon.icns'),
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
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    icon: path.join(__dirname, '..', 'assets', 'icon.icns'),
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
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0b10',
    icon: path.join(__dirname, '..', 'assets', 'icon.icns'),
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
  try {
    const loc = execSync('defaults read com.apple.screencapture location', { encoding: 'utf-8' }).trim();
    if (loc && fs.existsSync(loc)) return loc;
  } catch {}
  return path.join(os.homedir(), 'Desktop');
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
      if (f.startsWith('Screenshot') && f.endsWith('.png')) {
        lastScreenshotFiles.add(f);
      }
    });
  } catch {}

  // Poll every second for new screenshot files
  screenshotInterval = setInterval(() => {
    try {
      const files = fs.readdirSync(folder);
      for (const filename of files) {
        if (!filename.startsWith('Screenshot') || !filename.endsWith('.png')) continue;
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

app.whenReady().then(async () => {
  // Sync launch-at-login with saved settings
  const settings = loadSettings();
  app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });

  await startServer();
  createWindow();
  startScreenshotWatcher();
  watchSettings();

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

app.on('before-quit', () => {
  stopScreenshotWatcher();
  if (server) {
    server.close();
  }
});
