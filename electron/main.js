const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('../server/index.js');

let mainWindow;
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Sync launch-at-login with saved settings
  const settings = loadSettings();
  app.setLoginItemSettings({ openAtLogin: !!settings.launchOnStartup });

  await startServer();
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

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});
