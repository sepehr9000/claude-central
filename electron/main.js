const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { createServer } = require('../server/index.js');

let mainWindow;
let server;
const PORT = 31822; // Fixed port for the embedded server

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
    title: 'Claude Session Manager',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0b10',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In dev mode, load from Vite dev server; in production, load from embedded server
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev && process.env.VITE_DEV) {
    mainWindow.loadURL('http://localhost:3001');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
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
